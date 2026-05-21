import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startTestServer() {
  const app = createApp();
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function loginClient(baseUrl) {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_step3_30_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-30-${crypto.randomUUID()}`;
  const enrollment = await anon.createEnrollmentOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  await anon.verifyEnrollment({
    challengeId: enrollment.challenge.id,
    credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
  });
  const loginOptions = await anon.createWebAuthnLoginOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  const session = await anon.verifyWebAuthnLogin({
    challengeId: loginOptions.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${loginOptions.challenge.id}:${credentialId}`,
      signCounter: 1
    }
  });
  return anon.withToken(session.token);
}

async function seedOperatorWithRouter(client) {
  const tenant = await client.createTenant({ name: "Step 3.30 Tenant", tier: "PRO" });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Step 3.30 Operator",
    tier: "PRO",
    requestedTemplates: ["whatsapp", "signal", "telegram"]
  });
  const router = await client.registerDevice({
    type: "puli_ax_router",
    serial: `puli-step3-30-${crypto.randomUUID()}`,
    model: "GL.iNet GL-XE3000 Puli AX",
    firmwareVersion: "OpenWrt 23.05.5",
    assignedOperatorId: created.operator.id,
    posture: { state: "router_lab_pending" },
    qualificationStatus: "needs_evidence"
  });
  return { tenant: tenant.tenant, operator: created.operator, router: router.device };
}

test("Step 3.30 generates Puli AX router package without secrets and with IPsec T0/T1/T2 refs", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operator, router } = await seedOperatorWithRouter(client);

    const generated = await client.generateRouterPackage(operator.id, {
      routerDeviceId: router.id,
      firmwareTarget: "openwrt-23.05+",
      evidenceRefs: ["evidence://router/bench-ready"]
    });
    const pkg = generated.package;
    assert.equal(pkg.operatorId, operator.id);
    assert.equal(pkg.routerDeviceId, router.id);
    assert.equal(pkg.status, "ready_for_router_install");
    assert.equal(pkg.manifest.targetHardware, "GL.iNet GL-XE3000 Puli AX");
    assert.equal(pkg.manifest.secretsIncluded, false);
    assert.equal(pkg.manifest.privateKeyMaterialIncluded, false);
    assert.deepEqual(pkg.manifest.ipsecProfiles.map((profile) => profile.id), ["T0", "T1", "T2"]);
    assert.ok(pkg.manifest.ipsecProfiles.every((profile) => profile.protocol === "ipsec_ikev2"));
    assert.ok(pkg.manifest.ipsecProfiles.every((profile) => profile.authentication === "mutual_certificate"));
    assert.equal(JSON.stringify(pkg).includes("BEGIN PRIVATE KEY"), false);
    assert.equal(JSON.stringify(pkg).includes("apiKey"), false);

    const path = await client.getOperatorConnectionPath(operator.id, "pixel_grapheneos");
    assert.equal(path.path.router.packageStatus, "ready_for_router_install");
    assert.equal(path.path.router.packageId, pkg.id);
    assert.equal(path.path.router.readyForPhysicalSmoke, false);
    assert.ok(path.path.blockers.includes("router_posture_validation_required"));
  } finally {
    await close();
  }
});

test("Step 3.30 validates router posture only when OpenWrt, strongSwan, kill switch and DNS gates pass", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operator, router } = await seedOperatorWithRouter(client);
    const generated = await client.generateRouterPackage(operator.id, { routerDeviceId: router.id });

    const blocked = await client.validateRouterPosture(operator.id, {
      packageId: generated.package.id,
      routerDeviceId: router.id,
      evidence: {
        model: "GL.iNet GL-XE3000 Puli AX",
        firmwareVersion: "OpenWrt 23.05.5",
        strongSwanInstalled: true,
        nftablesKillSwitch: false,
        dnsTunnelOnly: false
      },
      evidenceRefs: ["evidence://router/partial"]
    });
    assert.equal(blocked.posture.status, "blocked");
    assert.ok(blocked.posture.blockers.includes("nftablesKillSwitch_required"));
    assert.ok(blocked.posture.blockers.includes("dnsTunnelOnly_required"));
    assert.equal(blocked.posture.productionExecutionAllowed, false);

    const validated = await client.validateRouterPosture(operator.id, {
      packageId: generated.package.id,
      routerDeviceId: router.id,
      evidence: {
        model: "GL.iNet GL-XE3000 Puli AX",
        firmwareVersion: "OpenWrt 23.05.5",
        strongSwanInstalled: true,
        nftablesKillSwitch: true,
        dnsTunnelOnly: true,
        wanAdminDisabled: true,
        sshKeyAuthOnly: true,
        lanWanBypassBlocked: true,
        signedFirmwareVerified: true,
        packageInstalled: true
      },
      evidenceRefs: ["evidence://router/full-benchtop"]
    });
    assert.equal(validated.posture.status, "validated_for_physical_smoke");
    assert.equal(validated.posture.blockers.length, 0);
    assert.ok(validated.posture.checks.every((check) => check.status === "passed"));

    const path = await client.getOperatorConnectionPath(operator.id, "pixel_grapheneos");
    assert.equal(path.path.router.postureStatus, "validated_for_physical_smoke");
    assert.equal(path.path.router.readyForPhysicalSmoke, true);
    assert.equal(path.path.productionExecutionAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.30 rejects router package or posture payloads that contain secrets", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operator, router } = await seedOperatorWithRouter(client);
    await assert.rejects(
      () => client.generateRouterPackage(operator.id, {
        routerDeviceId: router.id,
        evidenceRefs: ["secret://private-key-not-allowed"]
      }),
      /must not contain secrets/
    );
    const generated = await client.generateRouterPackage(operator.id, { routerDeviceId: router.id });
    await assert.rejects(
      () => client.validateRouterPosture(operator.id, {
        packageId: generated.package.id,
        routerDeviceId: router.id,
        evidence: {
          model: "GL.iNet GL-XE3000 Puli AX",
          firmwareVersion: "OpenWrt 23.05.5",
          privateKey: "-----BEGIN PRIVATE KEY-----"
        }
      }),
      /must not contain secrets/
    );
  } finally {
    await close();
  }
});
