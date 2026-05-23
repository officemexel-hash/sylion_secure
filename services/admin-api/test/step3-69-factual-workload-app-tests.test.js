import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startTestServer(env = {}) {
  const app = createApp({ liveExecutionOptions: { env } });
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
    correlationIdFactory: () => `corr_step3_69_${crypto.randomUUID()}`
  });
  const session = await anon.login({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!",
    fido2Verified: true
  });
  return anon.withToken(session.token);
}

async function seedOperator(client, tier = "PRO") {
  const tenant = await client.createTenant({ name: `Step 3.69 ${tier} Tenant`, tier });
  const operator = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.69 ${tier} Operator`,
    tier
  });
  return operator.operator;
}

test("Step 3.69 messenger factual PASS requires bootstrap plus send/receive, not just visible UI", async () => {
  const { app, baseUrl, close } = await startTestServer({
    SYLION_SIGNAL_LIVE_HTTP_STATUS: "200",
    SYLION_SIGNAL_NATIVE_EVIDENCE_READY: "true"
  });
  try {
    const client = await loginClient(baseUrl);
    const operator = await seedOperator(client);

    await assert.rejects(
      () => client.recordWorkloadFactualTest({
        operatorId: operator.id,
        appKey: "signal",
        terminalMode: "pixel_grapheneos",
        runtimeMode: "desktop",
        result: "passed",
        checks: {
          uiVisible: { status: "passed", evidence: "QR/link screen visible" }
        }
      }),
      (error) => {
        assert.equal(error.status, 422);
        assert.ok(error.payload.error.details.missingRequired.includes("accountBootstrap"));
        assert.ok(error.payload.error.details.missingRequired.includes("sendReceive"));
        return true;
      }
    );

    await assert.rejects(
      () => client.recordWorkloadFactualTest({
        operatorId: operator.id,
        appKey: "signal",
        terminalMode: "pixel_grapheneos",
        runtimeMode: "web",
        result: "passed",
        checks: {
          uiVisible: { status: "passed" },
          accountBootstrap: { status: "passed", mode: "web_link_only" },
          sendReceive: { status: "passed" }
        }
      }),
      (error) => {
        assert.equal(error.status, 422);
        assert.match(error.message, /web-link-only/);
        return true;
      }
    );

    const blocked = await client.recordWorkloadFactualTest({
      operatorId: operator.id,
      appKey: "signal",
      terminalMode: "pixel_grapheneos",
      runtimeMode: "desktop",
      result: "blocked",
      checks: {
        uiVisible: { status: "passed", evidence: "Signal link screen visible in workload stream" },
        accountBootstrap: { status: "blocked", mode: "android_native_required", note: "Disposable account not bootstrapped yet" },
        sendReceive: { status: "not_run" }
      },
      evidenceArtifactIds: ["artifact://pixel/signal-link-screen"],
      note: "Signal is visible but not functionally proven"
    });
    assert.equal(blocked.test.factualStateVerified, false);
    assert.ok(blocked.test.blockers.includes("accountBootstrap_not_passed"));
    assert.ok(blocked.test.blockers.includes("sendReceive_not_passed"));
    assert.equal(blocked.test.linkedProblemId?.startsWith("problem_"), true);

    const readiness = await client.getProductionReadiness();
    const signal = readiness.readiness.operators[0].apps.find((item) => item.key === "signal");
    assert.equal(signal.httpStatus, 200);
    assert.equal(signal.factualStateVerified, false);
    assert.equal(signal.latestFactualTest.result, "blocked");
    assert.ok(signal.blockers.includes("factual_state_not_verified"));
    assert.ok(signal.blockers.includes("accountBootstrap_not_passed"));

    const audit = app.services.audit.list().filter((event) => event.operatorId === operator.id);
    assert.ok(audit.some((event) => event.action === "release.workload_factual_test_recorded"));
    assert.equal(JSON.stringify(audit).includes("otp"), false);
  } finally {
    await close();
  }
});

test("Step 3.69 non-messenger factual PASS can promote app readiness only with required checks", async () => {
  const { baseUrl, close } = await startTestServer({
    SYLION_PIXEL_G1_READY: "true",
    SYLION_G1_G2_READY: "true",
    SYLION_G2_AX102_READY: "true",
    SYLION_DUCKDUCKGO_LIVE_HTTP_STATUS: "200",
    SYLION_DUCKDUCKGO_NATIVE_EVIDENCE_READY: "true"
  });
  try {
    const client = await loginClient(baseUrl);
    const operator = await seedOperator(client);
    const passed = await client.recordWorkloadFactualTest({
      operatorId: operator.id,
      appKey: "duckduckgo_browser",
      terminalMode: "pixel_grapheneos",
      runtimeMode: "firecracker_gui",
      result: "passed",
      checks: {
        uiVisible: { status: "passed", evidence: "DuckDuckGo search field visible" },
        browsing: { status: "passed", evidence: "Opened example.org through workload browser" }
      },
      latencyMs: 430
    });
    assert.equal(passed.test.factualStateVerified, true);
    assert.equal(passed.test.blockers.length, 0);

    const readiness = await client.getProductionReadiness();
    const duck = readiness.readiness.operators[0].apps.find((item) => item.key === "duckduckgo_browser");
    assert.equal(duck.state, "ready");
    assert.equal(duck.factualStateVerified, true);
    assert.equal(duck.latestFactualTest.id, passed.test.id);
    assert.equal(duck.latestFactualTest.result, "passed");
    assert.equal(duck.terminalDataStored, false);
    assert.equal(duck.cdrRequired, true);
  } finally {
    await close();
  }
});

test("Step 3.69 factual app tests reject OTP, seed or token fields", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const operator = await seedOperator(client);
    await assert.rejects(
      () => client.recordWorkloadFactualTest({
        operatorId: operator.id,
        appKey: "whatsapp",
        terminalMode: "pixel_grapheneos",
        runtimeMode: "android_native",
        result: "blocked",
        checks: {
          uiVisible: { status: "passed" },
          accountBootstrap: { status: "blocked", otp: "123456" },
          sendReceive: { status: "not_run" }
        }
      }),
      (error) => {
        assert.equal(error.status, 422);
        assert.ok(error.payload.error.details.fields.includes("checks.accountBootstrap.otp"));
        return true;
      }
    );
  } finally {
    await close();
  }
});
