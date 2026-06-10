import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startTestServer(envOverrides = {}) {
  const app = createApp({ liveExecutionOptions: { env: { ...process.env, ...envOverrides } } });
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
    correlationIdFactory: () => `corr_step3_29_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-29-${crypto.randomUUID()}`;
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

async function operatorRequest(baseUrl, token, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "content-type": "application/json",
      "x-correlation-id": `corr_step3_29_operator_${crypto.randomUUID()}`,
      authorization: `Bearer ${token}`
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "operator request failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function operatorPost(baseUrl, token, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": `corr_step3_29_operator_${crypto.randomUUID()}`,
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "operator post failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function seedReadyOperator(client) {
  const tenant = await client.createTenant({ name: "Step 3.29 Tenant", tier: "PRO" });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Step 3.29 Operator",
    tier: "PRO",
    requestedTemplates: ["whatsapp", "signal", "telegram"]
  });
  const environment = await client.createLocalOperatorEnvironment(created.provisioningDraft.id);
  await client.startLocalOperatorEnvironment(environment.environment.id);
  const pixel = await client.registerDevice({
    type: "pixel_grapheneos",
    serial: `pixel-step3-29-${crypto.randomUUID()}`,
    model: "Pixel GrapheneOS ADB unlocked lab",
    assignedOperatorId: created.operator.id,
    posture: { state: "adb_lab_ready", os: "GrapheneOS" }
  });
  await client.registerDevice({
    type: "laptop_web_terminal",
    serial: `laptop-step3-29-${crypto.randomUUID()}`,
    model: "Laptop web thin client",
    assignedOperatorId: created.operator.id,
    posture: { state: "browser_lab_ready" }
  });
  return {
    tenant: tenant.tenant,
    operator: created.operator,
    environment: environment.environment,
    pixel: pixel.device
  };
}

test("Step 3.29 exposes Pixel -> G1 -> G2 -> WORKLOAD -> communicator microVM path", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operator, pixel } = await seedReadyOperator(client);

    const adminPath = await client.getOperatorConnectionPath(operator.id, "pixel_grapheneos");
    assert.equal(adminPath.path.operatorId, operator.id);
    assert.equal(adminPath.path.terminalMode, "pixel_grapheneos");
    assert.equal(adminPath.path.state, "local_lab_connected");
    assert.deepEqual(
      adminPath.path.nodes.map((node) => node.role),
      ["TERMINAL", "G1", "G2", "WORKLOAD"]
    );
    assert.deepEqual(
      adminPath.path.segments.map((segment) => segment.id),
      ["T0", "T1", "T2"]
    );
    assert.ok(adminPath.path.segments.every((segment) => segment.protocol === "ipsec_ikev2"));
    assert.ok(
      adminPath.path.segments.every((segment) => segment.authentication === "mutual_certificate")
    );
    assert.ok(
      adminPath.path.segments.every((segment) => segment.productionExecutionAllowed === false)
    );
    assert.equal(adminPath.path.baseline.microVmIsolation, "firecracker_microvm_per_communicator");
    assert.deepEqual(
      adminPath.path.microVmSlots.map((slot) => slot.templateKey),
      ["whatsapp", "signal", "telegram"]
    );
    assert.ok(adminPath.path.microVmSlots.every((slot) => slot.targetVpsRole === "WORKLOAD"));
    assert.ok(adminPath.path.microVmSlots.every((slot) => slot.cdrRequired === true));
    assert.ok(adminPath.path.microVmSlots.every((slot) => slot.secretsReleaseAllowed === false));
    assert.equal(adminPath.path.terminalOperationalDataStored, false);
    assert.equal(adminPath.path.productionExecutionAllowed, false);
    assert.equal(JSON.stringify(adminPath).includes("private"), false);
    assert.equal(JSON.stringify(adminPath).includes("secretMaterial"), false);

    const session = await client.request("/operator-api/sessions/local-simulator", {
      method: "POST",
      body: {
        operatorId: operator.id,
        terminalMode: "pixel_grapheneos",
        deviceId: pixel.id
      }
    });
    const operatorPath = await operatorRequest(
      baseUrl,
      session.session.token,
      "/operator-api/connection-path"
    );
    assert.equal(operatorPath.path.deviceId, pixel.id);
    assert.equal(operatorPath.path.nodes[0].label, "Pixel GrapheneOS terminal");
    assert.equal(operatorPath.path.microVmSlots.length, 3);
    assert.ok(
      [...operatorPath.path.blockers, ...(operatorPath.path.deferredBlockers || [])].includes(
        "puli_ax_physical_package_validation_pending"
      )
    );

    const vpn = await operatorRequest(baseUrl, session.session.token, "/operator-api/vpn-status");
    assert.deepEqual(vpn.vpn.path, [
      "Pixel GrapheneOS terminal",
      "Puli AX IPsec gateway",
      "G1 network gateway",
      "G2 access broker",
      "WORKLOAD microVM layer"
    ]);
    assert.equal(vpn.vpn.segments.length, 3);
    assert.equal(vpn.vpn.microVmSlots.length, 3);
  } finally {
    await close();
  }
});

test("Step 3.29 live evidence clears current path blockers while physical gates stay deferred", async () => {
  const { baseUrl, close } = await startTestServer({
    SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true",
    SYLION_PULI_AX_PHYSICAL_READY: "false"
  });
  try {
    const client = await loginClient(baseUrl);
    const { operator, pixel } = await seedReadyOperator(client);
    const session = await client.request("/operator-api/sessions/local-simulator", {
      method: "POST",
      body: {
        operatorId: operator.id,
        terminalMode: "pixel_grapheneos",
        deviceId: pixel.id
      }
    });
    const token = session.session.token;
    await operatorPost(baseUrl, token, "/operator-api/vpn-evidence", {
      vpnConnected: true,
      vpnSession: "test-live-path",
      vpnInterface: "tun1",
      dnsThroughTunnel: true,
      certificateTrusted: true,
      reachableHosts: [
        "admin.sylion.internal",
        "operator.sylion.internal",
        "signal.sylion.internal",
        "10.42.0.12"
      ]
    });
    await operatorPost(baseUrl, token, "/operator-api/streaming-readiness", {
      protocol: "guacamole",
      g2StreamGatewayReady: true,
      publicInternetExposure: false,
      tlsInternalOnly: true,
      guacdTls: true,
      g2ToWorkloadEncrypted: true,
      inputProxyReady: true,
      sources: {
        whatsapp: true,
        signal: true,
        telegram: true,
        duckduckgo_browser: true,
        libreoffice: true
      }
    });
    await operatorPost(baseUrl, token, "/operator-api/streaming-runtime-manifest", {
      gateway: {
        process: "sylion-g2-guacamole-session-broker",
        bindAddress: "10.42.0.12",
        port: 443,
        protocol: "guacamole",
        tlsMode: "internal_tls_only",
        guacdTls: true,
        g2ToWorkloadEncrypted: true,
        workloadMicroVmLink: "host_local_tap_or_vsock",
        publicInternetExposure: false
      },
      sources: {
        signal: { bindAddress: "10.44.0.13", port: 5913, cdrRequired: true },
        duckduckgo_browser: { bindAddress: "10.44.0.13", port: 5901, cdrRequired: true }
      }
    });
    const operatorPath = await operatorRequest(baseUrl, token, "/operator-api/connection-path");
    assert.equal(operatorPath.path.state, "live_private_path_ready");
    assert.equal(operatorPath.path.liveEvidence.vpnEvidenceReady, true);
    assert.equal(operatorPath.path.liveEvidence.streamGatewayReady, true);
    assert.equal(operatorPath.path.liveEvidence.terminalCertificateTrusted, true);
    assert.equal(operatorPath.path.liveEvidence.dnsThroughTunnel, true);
    assert.ok(!operatorPath.path.blockers.includes("real_ipsec_profile_not_deployed"));
    assert.ok(!operatorPath.path.blockers.includes("dns_leak_and_kill_switch_tests_required"));
    assert.ok(
      !operatorPath.path.blockers.includes(
        "firecracker_host_qualification_required_for_real_launch"
      )
    );
    assert.ok(
      operatorPath.path.deferredBlockers.includes("puli_ax_physical_package_validation_pending")
    );
    assert.ok(operatorPath.path.deferredBlockers.includes("fido2_operator_unlock_required"));
    assert.equal(operatorPath.path.productionExecutionAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.29 keeps laptop terminal path separate and production-blocked", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operator } = await seedReadyOperator(client);
    const session = await client.request("/operator-api/sessions/local-simulator", {
      method: "POST",
      body: {
        operatorId: operator.id,
        terminalMode: "laptop_web_terminal"
      }
    });
    const path = await operatorRequest(
      baseUrl,
      session.session.token,
      "/operator-api/connection-path"
    );
    assert.equal(path.path.terminalMode, "laptop_web_terminal");
    assert.equal(path.path.nodes[0].label, "Laptop web terminal");
    assert.equal(path.path.terminalOperationalDataStored, false);
    assert.equal(path.path.secretsReleaseAllowed, false);
    assert.equal(path.path.sideEffectAllowed, false);
    assert.equal(path.path.productionExecutionAllowed, false);
    assert.ok(
      path.path.segments.every(
        (segment) => segment.killSwitch.includes("drop") || segment.killSwitch.includes("block")
      )
    );
  } finally {
    await close();
  }
});
