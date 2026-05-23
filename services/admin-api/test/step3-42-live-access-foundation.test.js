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
    correlationIdFactory: () => `corr_step3_42_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-42-${crypto.randomUUID()}`;
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
      "x-correlation-id": `corr_step3_42_operator_${crypto.randomUUID()}`,
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
  const tenant = await client.createTenant({ name: `Step 3.42 ${tier} Tenant`, tier });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.42 ${tier} Operator`,
    tier
  });
  const pixel = await client.registerDevice({
    type: "pixel_grapheneos",
    serial: `pixel-step3-42-${crypto.randomUUID()}`,
    model: "Pixel GrapheneOS live access test",
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

test("Step 3.42 live access foundation blocks Pixel path until VPN, CA, DNS and G2 gateway evidence pass", async () => {
  const { baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_INTERNAL_CA_CERT_PEM: "-----BEGIN CERTIFICATE-----\\nstep342\\n-----END CERTIFICATE-----",
        SYLION_INTERNAL_CA_SHA256: "SHA256:step3-42",
        SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true"
      }
    }
  });
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    const foundation = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/live-access-foundation");
    assert.equal(foundation.foundation.state, "blocked_before_live_access");
    assert.ok(foundation.foundation.blockers.includes("t0_pixel_to_g1_ipsec"));
    assert.ok(foundation.foundation.blockers.includes("pixel_internal_ca_trust"));
    assert.equal(foundation.foundation.guardrails.noTerminalOperationalData, true);
    assert.equal(foundation.foundation.guardrails.g1G2BypassAllowed, false);
    assert.equal(foundation.foundation.guardrails.baselineTransport, "ipsec_ikev2");
    assert.equal(foundation.foundation.guardrails.cdrRequired, true);
    assert.equal(foundation.foundation.productionExecutionAllowed, false);
    assert.ok(foundation.foundation.appGateways.some((app) => app.templateKey === "zangi" && app.runtimeClass === "android_workload_required"));
  } finally {
    await close();
  }
});

test("Step 3.42 live VPN evidence promotes foundation to workload broker readiness without enabling production execution", async () => {
  const { baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL: "true",
        SYLION_G1_G2_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_GATEWAY_READY: "true",
        SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true"
      }
    }
  });
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    await operatorRequest(baseUrl, seeded.session.token, "/operator-api/vpn-evidence", {
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
    const foundation = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/live-access-foundation");
    assert.equal(foundation.foundation.state, "live_access_ready_for_workload_broker");
    assert.deepEqual(foundation.foundation.blockers, []);
    assert.equal(foundation.foundation.vpn.evidenceReady, true);
    assert.equal(foundation.foundation.ca.trustedOnPixel, true);
    assert.ok(foundation.foundation.checks.some((check) => check.key === "puli_ax_physical_router" && check.status === "deferred"));
    assert.ok(foundation.foundation.checks.some((check) => check.key === "hsm_fido2_physical_enforcement" && check.status === "deferred"));
    assert.ok(foundation.foundation.appGateways.every((app) => app.brokerState === "ready_for_session_broker"));
    assert.equal(foundation.foundation.productionExecutionAllowed, false);
    assert.equal(JSON.stringify(foundation).includes("private"), false);
  } finally {
    await close();
  }
});
