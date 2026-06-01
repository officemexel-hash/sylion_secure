import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";
import { PROHIBITED_CELLULAR_ACTIONS } from "../src/modules/terminalAdmission/terminalAdmissionPolicyService.js";

async function startTestServer() {
  const app = createApp();
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function loginClient(baseUrl) {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_step3_106_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-106-${crypto.randomUUID()}`;
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

async function createOperatorWithDevices(client) {
  const tenant = await client.createTenant({ name: "Step 3.106 Tenant", tier: "PHANTOM" });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Step 3.106 Operator",
    tier: "PHANTOM"
  });
  const operatorId = created.operator.id;
  const pixel = await client.registerDevice({
    type: "pixel_grapheneos",
    serial: `pixel-step3-106-${crypto.randomUUID()}`,
    model: "Pixel GrapheneOS Wi-Fi-only terminal",
    assignedOperatorId: operatorId,
    posture: { state: "wifi_only_lab_ready", os: "GrapheneOS" }
  });
  const router = await client.registerDevice({
    type: "puli_ax_router",
    serial: `puli-step3-106-${crypto.randomUUID()}`,
    model: "GL.iNet GL-XE3000 Puli AX",
    firmwareVersion: "OpenWrt 23.05 test evidence",
    assignedOperatorId: operatorId,
    posture: { state: "bench_validated" }
  });
  const fido2 = await client.registerDevice({
    type: "fido2_key",
    serial: `fido-step3-106-${crypto.randomUUID()}`,
    model: "FIDO2 key placeholder",
    assignedOperatorId: operatorId,
    posture: { state: "configured_for_operator" }
  });
  await client.request(`/operators/${operatorId}/router-package`, {
    method: "POST",
    body: { routerDeviceId: router.device.id, evidenceRefs: ["evidence://step3-106-router-package"] }
  });
  await client.request(`/operators/${operatorId}/router-posture`, {
    method: "POST",
    body: {
      routerDeviceId: router.device.id,
      evidence: {
        model: "GL.iNet GL-XE3000 Puli AX",
        firmwareVersion: "OpenWrt 23.05",
        strongSwanInstalled: true,
        nftablesKillSwitch: true,
        dnsTunnelOnly: true,
        wanAdminDisabled: true,
        sshKeyAuthOnly: true,
        lanWanBypassBlocked: true,
        signedFirmwareVerified: true,
        packageInstalled: true
      },
      evidenceRefs: ["evidence://step3-106-router-posture"]
    }
  });
  return { operatorId, pixel: pixel.device, router: router.device, fido2: fido2.device };
}

test("Step 3.106 blocks every prohibited cellular identity action in product policy", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    for (const action of PROHIBITED_CELLULAR_ACTIONS) {
      await assert.rejects(
        () => client.request("/cellular/policy/evaluate-action", {
          method: "POST",
          body: { action, reason: "negative policy test" }
        }),
        (error) => error.status === 403 && error.payload.error.details.action === action
      );
    }
  } finally {
    await close();
  }
});

test("Step 3.106 records cellular inventory without exposing raw IMEI, IMSI or ICCID", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operatorId, router } = await createOperatorWithDevices(client);
    const rawImei = "123456789012345";
    const rawImsi = "260011234567890";
    const rawIccid = "8948012345678901234";
    const response = await client.request(`/operators/${operatorId}/cellular-inventory`, {
      method: "POST",
      body: {
        routerDeviceId: router.id,
        provider: "test-provider",
        country: "PL",
        carrier: "test-carrier",
        apn: "internet",
        modem: { model: "RM520N-GL", firmware: "test-fw", imei: rawImei },
        sim: { status: "READY", profileRef: "sim-profile-ref", imsi: rawImsi, iccid: rawIccid },
        network: { registration: "registered", signalQuality: "good", roaming: false },
        evidenceRefs: ["evidence://step3-106-cellular-inventory"]
      }
    });
    const serialized = JSON.stringify(response);
    assert.equal(response.inventory.rawValuesRedacted, true);
    assert.equal(response.inventory.modem.imeiHash, createHash("sha256").update(rawImei).digest("hex"));
    assert.equal(response.inventory.sim.imsiHash, createHash("sha256").update(rawImsi).digest("hex"));
    assert.equal(response.inventory.sim.iccidHash, createHash("sha256").update(rawIccid).digest("hex"));
    assert.equal(serialized.includes(rawImei), false);
    assert.equal(serialized.includes(rawImsi), false);
    assert.equal(serialized.includes(rawIccid), false);
    assert.equal(JSON.stringify(app.services.audit.list()).includes(rawImei), false);
    assert.equal(JSON.stringify(app.services.audit.list()).includes(rawImsi), false);
    assert.equal(JSON.stringify(app.services.audit.list()).includes(rawIccid), false);
  } finally {
    await close();
  }
});

test("Step 3.106 terminal admission requires Pixel, Puli AX, FIDO2 and route evidence before G1 eligibility", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operatorId, pixel, router, fido2 } = await createOperatorWithDevices(client);

    const blocked = await client.request(`/operators/${operatorId}/terminal-admission/evaluate`, {
      method: "POST",
      body: {
        terminalMode: "pixel_grapheneos",
        terminalDeviceId: pixel.id,
        routerDeviceId: router.id,
        evidence: {
          pixelCellularDisabled: true,
          pixelWifiOnly: true,
          routerPairingVerified: true,
          terminalDataStored: false
        }
      }
    });
    assert.equal(blocked.admission.decision, "blocked");
    assert.ok(blocked.admission.blockers.includes("fido2_device_required"));
    assert.ok(blocked.admission.blockers.includes("fido2_user_verification_required"));
    assert.ok(blocked.admission.blockers.includes("ipsec_to_g1_evidence_required"));

    const eligible = await client.request(`/operators/${operatorId}/terminal-admission/evaluate`, {
      method: "POST",
      body: {
        terminalMode: "pixel_grapheneos",
        terminalDeviceId: pixel.id,
        routerDeviceId: router.id,
        fido2DeviceId: fido2.id,
        evidence: {
          pixelCellularDisabled: true,
          pixelWifiOnly: true,
          routerPairingVerified: true,
          fido2UserVerified: true,
          ipsecToG1Established: true,
          certificateChainTrusted: true,
          terminalDataStored: false
        }
      }
    });
    assert.equal(eligible.admission.decision, "eligible_for_g1");
    assert.deepEqual(eligible.admission.blockers, []);
    assert.equal(eligible.admission.productionExecutionAllowed, true);
    assert.deepEqual(eligible.admission.path, [
      "Pixel GrapheneOS terminal",
      "Puli AX access router",
      "G1 IPsec ingress gateway",
      "G2 access broker",
      "WORKLOAD Firecracker/container layer"
    ]);
  } finally {
    await close();
  }
});
