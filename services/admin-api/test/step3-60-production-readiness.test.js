import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startTestServer(env = {}) {
  const app = createApp({ liveExecutionOptions: { env } });
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
    correlationIdFactory: () => `corr_step3_60_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-60-${crypto.randomUUID()}`;
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

test("Step 3.60 production readiness exposes operator cost, route evidence and app blockers", async () => {
  const env = {
    SYLION_PIXEL_G1_READY: "true",
    SYLION_G1_G2_READY: "true",
    SYLION_G2_AX102_READY: "true",
    SYLION_LAPTOP_G1_READY: "true",
    SYLION_DUCKDUCKGO_LIVE_HTTP_STATUS: "200",
    SYLION_DUCKDUCKGO_NATIVE_EVIDENCE_READY: "true",
    SYLION_DUCKDUCKGO_FACTUAL_STATE_VERIFIED: "true",
    SYLION_SIGNAL_LIVE_HTTP_STATUS: "502",
    SYLION_SUBSCRIPTION_TOKEN_FLOW_READY: "false"
  };
  const { baseUrl, close } = await startTestServer(env);
  try {
    const client = await loginClient(baseUrl);
    const tenant = await client.createTenant({ name: "Step 3.60 Tenant", tier: "PRO" });
    const operator = await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Step 3.60 Operator",
      tier: "PRO"
    });
    await client.registerWorkloadNativeHost({
      hostId: "AX102-U-TEST",
      serverNumber: "2983993",
      productId: "AX102-U",
      region: "HEL1",
      publicIpv4: "65.109.123.72",
      evidence: {
        bootstrap: {
          kvmDevice: true,
          virtualizationFlags: 1,
          firecrackerBinary: "present",
          jailerBinary: "present"
        },
        hardware: { auditd: true, apparmor: true },
        firecrackerSmoke: { microvmStarted: true },
        firecrackerInstall: { firecrackerVersion: "1.8.0", jailerVersion: "1.8.0" }
      },
      productionBlockers: ["hsm_fido2_physical_ceremony_deferred"]
    });

    const readiness = await client.getProductionReadiness();
    assert.equal(readiness.readiness.summary.operators, 1);
    assert.equal(readiness.readiness.summary.productionExecutionAllowed, false);
    assert.equal(readiness.readiness.summary.productionGates, 10);
    assert.ok(readiness.readiness.summary.productionGatesBlocked >= 8);
    assert.equal(readiness.readiness.sessionBroker.selectedProtocol, "adr_pending");
    assert.ok(readiness.readiness.sessionBroker.blockers.includes("g2_session_broker_adr_pending"));
    const zangiGate = readiness.readiness.productionGates.find((gate) => gate.id === "gate_01_zangi_android_native_functional");
    assert.equal(zangiGate.state, "blocked");
    assert.equal(zangiGate.productionExecutionAllowed, false);
    assert.equal(zangiGate.humanGateRequired, true);
    assert.ok(zangiGate.verifyHow.includes("Pixel"));
    const guacamoleGate = readiness.readiness.productionGates.find((gate) => gate.id === "gate_03_guacamole_broker");
    assert.ok(guacamoleGate.blockers.includes("g2_session_broker_adr_pending"));
    const row = readiness.readiness.operators[0];
    assert.equal(row.operatorId, operator.operator.id);
    assert.equal(row.tier, "PRO");
    assert.equal(row.cost.minimumSubscriptionMonths, 6);
    assert.equal(row.cost.workloadTenancy, "shared_dedicated_pool_allowed");
    assert.equal(row.infrastructure.workloadNative.serverNumber, "2983993");
    assert.equal(row.path.pixel, "ready");
    assert.equal(row.path.laptop, "ready");
    assert.equal(row.path.g1g2, "ready");
    assert.equal(row.path.g2Workload, "ready");
    assert.equal(row.sessionBroker.noVncProductionApproved, false);
    assert.equal(row.subscription.tokenState, "planned");

    const duck = row.apps.find((app) => app.key === "duckduckgo_browser");
    assert.equal(duck.state, "ready");
    assert.equal(duck.factualStateVerified, true);
    assert.equal(duck.url, "https://duckduckgo.sylion.internal/vnc.html");
    assert.equal(duck.cdrRequired, true);
    assert.equal(duck.terminalDataStored, false);
    assert.equal(duck.productionExecutionAllowed, false);

    const signal = row.apps.find((app) => app.key === "signal");
    assert.equal(signal.state, "not_built");
    assert.ok(row.blockers.includes("signal:signal_native_workload_not_built"));
  } finally {
    await close();
  }
});

test("Step 3.60 production readiness rejects transport-only app evidence", async () => {
  const env = {
    SYLION_PIXEL_G1_READY: "true",
    SYLION_G1_G2_READY: "true",
    SYLION_G2_AX102_READY: "true",
    SYLION_DUCKDUCKGO_LIVE_HTTP_STATUS: "200",
    SYLION_DUCKDUCKGO_NATIVE_EVIDENCE_READY: "true"
  };
  const { baseUrl, close } = await startTestServer(env);
  try {
    const client = await loginClient(baseUrl);
    const tenant = await client.createTenant({ name: "Step 3.60 Factual Tenant", tier: "PRO" });
    await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Step 3.60 Factual Operator",
      tier: "PRO"
    });
    await client.registerWorkloadNativeHost({
      hostId: "AX102-U-FACTUAL",
      serverNumber: "2983993",
      productId: "AX102-U",
      region: "HEL1",
      publicIpv4: "65.109.123.72",
      evidence: {
        bootstrap: {
          kvmDevice: true,
          virtualizationFlags: 1,
          firecrackerBinary: "present",
          jailerBinary: "present"
        },
        hardware: { auditd: true, apparmor: true },
        firecrackerSmoke: { microvmStarted: true },
        firecrackerInstall: { firecrackerVersion: "1.8.0", jailerVersion: "1.8.0" }
      }
    });

    const readiness = await client.getProductionReadiness();
    assert.equal(readiness.readiness.productionGates.length, 10);
    assert.ok(readiness.readiness.productionGates.every((gate) => gate.productionExecutionAllowed === false));
    const row = readiness.readiness.operators[0];
    const duck = row.apps.find((app) => app.key === "duckduckgo_browser");
    assert.equal(duck.httpStatus, 200);
    assert.equal(duck.evidenceReady, true);
    assert.equal(duck.factualStateVerified, false);
    assert.equal(duck.state, "unknown_or_blocked");
    assert.ok(duck.blockers.includes("factual_state_not_verified"));
    assert.ok(row.blockers.includes("duckduckgo_browser:factual_state_not_verified"));
  } finally {
    await close();
  }
});

test("Step 3.60 production readiness rejects env-only factual claims for communicators and wallet workloads", async () => {
  const env = {
    SYLION_PIXEL_G1_READY: "true",
    SYLION_G1_G2_READY: "true",
    SYLION_G2_AX102_READY: "true",
    SYLION_SIGNAL_LIVE_HTTP_STATUS: "200",
    SYLION_SIGNAL_NATIVE_EVIDENCE_READY: "true",
    SYLION_SIGNAL_FACTUAL_STATE_VERIFIED: "true",
    SYLION_EXODUS_LIVE_HTTP_STATUS: "200",
    SYLION_EXODUS_NATIVE_EVIDENCE_READY: "true",
    SYLION_EXODUS_FACTUAL_STATE_VERIFIED: "true"
  };
  const { baseUrl, close } = await startTestServer(env);
  try {
    const client = await loginClient(baseUrl);
    const tenant = await client.createTenant({ name: "Step 3.60 Env Claim Tenant", tier: "PRO" });
    await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Step 3.60 Env Claim Operator",
      tier: "PRO"
    });
    await client.registerWorkloadNativeHost({
      hostId: "AX102-U-ENV-CLAIM",
      serverNumber: "2983993",
      productId: "AX102-U",
      region: "HEL1",
      publicIpv4: "65.109.123.72",
      evidence: {
        bootstrap: {
          kvmDevice: true,
          virtualizationFlags: 1,
          firecrackerBinary: "present",
          jailerBinary: "present"
        },
        hardware: { auditd: true, apparmor: true },
        firecrackerSmoke: { microvmStarted: true },
        firecrackerInstall: { firecrackerVersion: "1.8.0", jailerVersion: "1.8.0" }
      }
    });

    const readiness = await client.getProductionReadiness();
    const row = readiness.readiness.operators[0];
    const signal = row.apps.find((app) => app.key === "signal");
    const exodus = row.apps.find((app) => app.key === "exodus");
    assert.equal(signal.httpStatus, 200);
    assert.equal(signal.evidenceReady, true);
    assert.equal(signal.factualStateVerified, false);
    assert.ok(signal.blockers.includes("factual_state_not_verified"));
    assert.equal(exodus.factualStateVerified, false);
    assert.ok(exodus.blockers.includes("factual_state_not_verified"));
  } finally {
    await close();
  }
});
