import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startTestServer(liveWorkloadStatusProvider) {
  const app = createApp({ liveExecutionOptions: { liveWorkloadStatusProvider } });
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
    correlationIdFactory: () => `corr_step3_87_${crypto.randomUUID()}`
  });
  const session = await anon.login({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!",
    fido2Verified: true
  });
  return anon.withToken(session.token);
}

async function operatorRequest(baseUrl, token, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "content-type": "application/json",
      "x-correlation-id": `corr_step3_87_operator_${crypto.randomUUID()}`,
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

test("Step 3.87 operator app switcher gets sanitized live AX102/G2 status", async () => {
  const fakeStatus = {
    generatedAt: "2026-05-24T08:00:00.000Z",
    source: "real_g2_and_ax102_metadata_probe",
    workloadHost: "AX102",
    g2Gateway: "G2",
    apps: [
      {
        key: "signal",
        evidenceKey: "signal",
        name: "Signal",
        host: "signal.sylion.internal",
        launchUrl: "https://signal.sylion.internal/vnc.html?autoconnect=true&resize=remote&path=websockify",
        runtime: "firecracker_desktop",
        class: "communicator",
        transport: { state: "reachable_auth_required", rootHttpStatus: 302, targetHttpStatus: 401, authRequired: true, sylionHeadersObserved: true },
        workload: { state: "ready", evidencePresent: true, checkedAt: "2026-05-24T07:59:00.000Z", streamReady: true, streamAuthRequired: true, appRunning: true, appCrashed: false, visibleWindow: true, vncBannerReady: true },
        functionalState: "ui_ready_account_test_required",
        operatorAction: "bootstrap_account_then_run_send_receive_human_test",
        blockers: ["communicator_account_send_receive_not_proven", "token_like_field_should_not_be_added"],
        cdrRequired: true,
        terminalDataStored: false,
        secretsPrinted: false
      },
      {
        key: "zangi",
        evidenceKey: "zangi",
        name: "Zangi",
        host: "zangi.sylion.internal",
        launchUrl: "https://zangi.sylion.internal/vnc.html?autoconnect=true&resize=remote&path=websockify",
        runtime: "android_native_required",
        class: "communicator",
        transport: { state: "reachable", rootHttpStatus: 302, targetHttpStatus: 200, authRequired: false, sylionHeadersObserved: true },
        workload: { state: "blocked", evidencePresent: false },
        functionalState: "blocked_android_native_provenance",
        operatorAction: "approve_android_image_and_zangi_apk_then_run_android_native_test",
        blockers: ["approved_android_image_or_zangi_apk_missing"],
        cdrRequired: true,
        terminalDataStored: false,
        secretsPrinted: false
      }
    ],
    summary: {
      totalApps: 2,
      transportReady: 2,
      workloadUiReady: 1,
      functionalReady: 0,
      accountTestRequired: ["signal"],
      blocked: ["zangi"],
      productionExecutionAllowed: false
    }
  };
  const { baseUrl, close } = await startTestServer(async () => fakeStatus);
  try {
    const client = await loginClient(baseUrl);
    const tenant = await client.createTenant({ name: "Step 3.87 Tenant", tier: "PRO" });
    const created = await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Step 3.87 Operator",
      tier: "PRO"
    });
    const session = await client.request("/operator-api/sessions/local-simulator", {
      method: "POST",
      body: {
        operatorId: created.operator.id,
        terminalMode: "pixel_grapheneos"
      }
    });

    const result = await operatorRequest(baseUrl, session.session.token, "/operator-api/live-workload-status");
    assert.equal(result.status.operatorId, created.operator.id);
    assert.equal(result.status.summary.workloadUiReady, 1);
    const signal = result.status.apps.find((app) => app.key === "signal");
    assert.equal(signal.transport.authRequired, true);
    assert.equal(signal.workload.state, "ready");
    assert.equal(signal.functionalState, "ui_ready_account_test_required");
    assert.equal(signal.productionExecutionAllowed, false);
    assert.equal(signal.terminalDataStored, false);
    assert.equal(signal.cdrRequired, true);
    assert.ok(signal.blockers.includes("redacted_sensitive_blocker"));
    assert.equal(JSON.stringify(result).includes("token_like_field_should_not_be_added"), false);
    const zangi = result.status.apps.find((app) => app.key === "zangi");
    assert.equal(zangi.functionalState, "blocked_android_native_provenance");
    assert.equal(JSON.stringify(result).includes("password"), false);
    assert.equal(JSON.stringify(result).includes("privateKey"), false);
  } finally {
    await close();
  }
});
