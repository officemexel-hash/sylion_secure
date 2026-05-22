import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startTestServer(options = {}) {
  const app = createApp(options);
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
    correlationIdFactory: () => `corr_step3_43_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-43-${crypto.randomUUID()}`;
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

async function operatorRequest(baseUrl, token, path, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": `corr_step3_43_operator_${crypto.randomUUID()}`,
      authorization: `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
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

async function seedOperator(client, tier = "PRO") {
  const tenant = await client.createTenant({ name: `Step 3.43 ${tier} Tenant`, tier });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.43 ${tier} Operator`,
    tier
  });
  const pixel = await client.registerDevice({
    type: "pixel_grapheneos",
    serial: `pixel-step3-43-${crypto.randomUUID()}`,
    model: "Pixel GrapheneOS thin stream test",
    assignedOperatorId: created.operator.id,
    posture: { state: "adb_lab_ready", os: "GrapheneOS" }
  });
  const session = await client.request("/operator-api/sessions/local-simulator", {
    method: "POST",
    body: {
      operatorId: created.operator.id,
      terminalMode: "pixel_grapheneos",
      deviceId: pixel.device.id
    }
  });
  return { tenant, operator: created.operator, pixel: pixel.device, session: session.session };
}

async function recordLiveVpnEvidence(baseUrl, token) {
  return operatorRequest(baseUrl, token, "/operator-api/vpn-evidence", {
    method: "POST",
    body: {
      vpnConnected: true,
      vpnSession: "SYLION",
      vpnInterface: "tun1",
      dnsThroughTunnel: true,
      certificateTrusted: true,
      reachableHosts: [
        "admin.sylion.internal",
        "operator.sylion.internal",
        "signal.sylion.internal",
        "10.42.0.12"
      ]
    }
  });
}

test("Step 3.43 streaming session is blocked until live access and G2 stream gateway are ready", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    const session = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/streaming-sessions", {
      method: "POST",
      body: {
        templateKey: "signal",
        width: 390,
        height: 844,
        dpr: 3
      }
    });
    assert.equal(session.session.state, "stream_session_blocked");
    assert.ok(session.session.blockers.includes("live_access:t0_pixel_to_g1_ipsec"));
    assert.ok(session.session.blockers.includes("g2_stream_gateway_not_ready"));
    assert.equal(session.session.stream.renderingMode, "server_side_pixels_only");
    assert.equal(session.session.security.terminalDataStored, false);
    assert.equal(session.session.security.g1G2BypassAllowed, false);
    assert.equal(session.session.productionExecutionAllowed, false);
    assert.equal(session.session.stream.targetHeight, 1280);
  } finally {
    await close();
  }
});

test("Step 3.43 Signal, DuckDuckGo and LibreOffice can become ready for G2 thin streaming without terminal data", async () => {
  const { baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL: "true",
        SYLION_G1_G2_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_GATEWAY_READY: "true",
        SYLION_G2_STREAM_GATEWAY_READY: "true",
        SYLION_WORKLOAD_STREAM_SOURCE_READY: "true",
        SYLION_REAL_IPSEC_READY: "true",
        SYLION_KVM_READY: "true",
        SYLION_FIRECRACKER_BIN: "/usr/local/bin/firecracker",
        SYLION_FIRECRACKER_KERNEL: "image://kernel",
        SYLION_SIGNAL_ROOTFS: "image://rootfs",
        SYLION_SIGNAL_WORKLOAD_IMAGE_REF: "image://workload",
        SYLION_SIGNAL_PACKAGE_REF: "package://signal",
        SYLION_SIGNAL_ACCOUNT_REF: "account://signal",
        SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true",
        SYLION_ENABLE_SIGNAL_PRODUCTION_EXECUTION: "true"
      }
    }
  });
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    await recordLiveVpnEvidence(baseUrl, seeded.session.token);
    for (const templateKey of ["signal", "duckduckgo_browser", "libreoffice"]) {
      const session = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/streaming-sessions", {
        method: "POST",
        body: {
          templateKey,
          width: 390,
          height: 844,
          dpr: 3
        }
      });
      assert.equal(session.session.state, "stream_session_ready");
      assert.equal(session.session.blockers.length, 0);
      assert.match(session.session.launchUrl, /^https:\/\/.+\.sylion\.internal\/stream\//);
      assert.equal(session.session.stream.operationalDataOnTerminal, false);
      assert.deepEqual(session.session.stream.terminalReceives, ["video_pixels", "audio_optional", "input_events"]);
      assert.ok(session.session.stream.terminalForbidden.includes("message_database"));
      assert.ok(session.session.stream.terminalForbidden.includes("wallet_seed"));
      assert.equal(session.session.security.fileIngressEgress, "blocked_without_cdr_decision");
      assert.equal(session.session.productionExecutionAllowed, false);
    }
  } finally {
    await close();
  }
});

test("Step 3.43 Zangi and Exodus remain blocked by app-specific streaming gates", async () => {
  const { baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL: "true",
        SYLION_G1_G2_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_GATEWAY_READY: "true",
        SYLION_G2_STREAM_GATEWAY_READY: "true",
        SYLION_WORKLOAD_STREAM_SOURCE_READY: "true",
        SYLION_REAL_IPSEC_READY: "true",
        SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true"
      }
    }
  });
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    await recordLiveVpnEvidence(baseUrl, seeded.session.token);
    const zangi = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/streaming-sessions", {
      method: "POST",
      body: { templateKey: "zangi", width: 390, height: 844, dpr: 3 }
    });
    assert.equal(zangi.session.state, "stream_session_blocked");
    assert.ok(zangi.session.blockers.includes("android_native_stream_runner_required"));

    const exodus = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/streaming-sessions", {
      method: "POST",
      body: { templateKey: "exodus", width: 390, height: 844, dpr: 3 }
    });
    assert.equal(exodus.session.state, "stream_session_blocked");
    assert.ok(exodus.session.blockers.includes("operator_wallet_risk_acceptance_required"));
    assert.equal(JSON.stringify(exodus).includes("wallet_seed_value"), false);
  } finally {
    await close();
  }
});
