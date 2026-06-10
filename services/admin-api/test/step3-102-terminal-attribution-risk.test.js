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
    correlationIdFactory: () => `corr_step3_102_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-102-${crypto.randomUUID()}`;
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
      "x-correlation-id": `corr_step3_102_operator_${crypto.randomUUID()}`,
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
  const tenant = await client.createTenant({ name: `Step 3.102 ${tier} Tenant`, tier });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.102 ${tier} Operator`,
    tier
  });
  const serial = `pixel-step3-102-${crypto.randomUUID()}`;
  const pixel = await client.registerDevice({
    type: "pixel_grapheneos",
    serial,
    model: "Pixel GrapheneOS terminal attribution test",
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
  return {
    tenant,
    operator: created.operator,
    pixel: pixel.device,
    serial,
    session: session.session
  };
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

test("Step 3.102 terminal attribution assessment is honest and metadata-only by default", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    const response = await operatorRequest(
      baseUrl,
      seeded.session.token,
      "/operator-api/terminal-attribution-risk"
    );
    const assessment = response.assessment;
    assert.equal(assessment.mode, "metadata_only_terminal_attribution_risk_assessment");
    assert.equal(assessment.decision, "not_proven_until_required_evidence_passes");
    assert.equal(assessment.observerStartingPoint, "firecracker_or_workload_ip_only");
    assert.ok(
      assessment.matrixServerObservation.shouldSee.includes(
        "workload_egress_ip_or_tor_exit_if_operator_policy_enabled"
      )
    );
    assert.ok(assessment.matrixServerObservation.mustNotSee.includes("pixel_public_ip"));
    assert.ok(assessment.matrixServerObservation.mustNotSee.includes("pixel_location"));
    assert.ok(assessment.blockers.includes("matrix_canary_source_ip_probe_required"));
    assert.ok(assessment.blockers.includes("x_forwarded_for_strip_evidence_required"));
    assert.ok(assessment.blockers.includes("workload_dns_leak_test_required"));
    assert.equal(assessment.guardrails.anonymityClaimAllowed, false);
    assert.equal(assessment.matrixServerObservation.contentInspected, false);
    assert.equal(assessment.matrixServerObservation.messageContentStored, false);
    assert.equal(assessment.matrixServerObservation.terminalDataStored, false);
    assert.equal(JSON.stringify(assessment).includes(seeded.serial), false);
    assert.equal(JSON.stringify(assessment).includes("secret chat body"), false);
  } finally {
    await close();
  }
});

test("Step 3.102 complete canary evidence blocks direct Pixel attribution but keeps residual risks", async () => {
  const { baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_G1_G2_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_GATEWAY_READY: "true",
        SYLION_MATRIX_CANARY_SOURCE_IP_EVIDENCED: "true",
        SYLION_MATRIX_X_FORWARDED_FOR_STRIPPED: "true",
        SYLION_WORKLOAD_DNS_LEAK_TEST_PASSED: "true",
        SYLION_WORKLOAD_WEBRTC_LEAK_TEST_PASSED: "true",
        SYLION_BROWSER_GEOLOCATION_DENIED: "true",
        SYLION_MATRIX_CLIENT_METADATA_REVIEWED: "true"
      }
    }
  });
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    await recordLiveVpnEvidence(baseUrl, seeded.session.token);
    const response = await operatorRequest(
      baseUrl,
      seeded.session.token,
      "/operator-api/terminal-attribution-risk"
    );
    const assessment = response.assessment;
    assert.equal(
      assessment.decision,
      "direct_terminal_attribution_blocked_residual_correlation_risk_remains"
    );
    assert.deepEqual(assessment.blockers, []);
    assert.ok(assessment.controls.every((control) => control.status === "passed"));
    assert.ok(assessment.shortAnswer.includes("workload egress"));
    assert.equal(assessment.humanGate.required, true);
    assert.ok(assessment.residualRisks.some((risk) => risk.id === "provider_logs"));
    assert.ok(assessment.residualRisks.some((risk) => risk.id === "timing_correlation"));
    assert.equal(assessment.guardrails.metadataOnly, true);
    assert.equal(assessment.guardrails.g1G2BypassAllowed, false);
    assert.equal(assessment.guardrails.productionExecutionAllowed, false);
  } finally {
    await close();
  }
});
