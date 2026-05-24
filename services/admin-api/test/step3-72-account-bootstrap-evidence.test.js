import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startTestServer(options = {}) {
  const app = createApp(options);
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
    correlationIdFactory: () => `corr_step3_72_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-72-${crypto.randomUUID()}`;
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

async function operatorRequest(baseUrl, token, path, { method = "GET", body, expectOk = true } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": `corr_step3_72_operator_${crypto.randomUUID()}`,
      authorization: `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (expectOk && !response.ok) {
    const error = new Error(payload?.error?.message || "operator request failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return { status: response.status, payload };
}

async function seedOperator(client, tier = "PRO") {
  const tenant = await client.createTenant({ name: `Step 3.72 ${tier} Tenant`, tier });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.72 ${tier} Operator`,
    tier
  });
  const session = await client.request("/operator-api/sessions/local-simulator", {
    method: "POST",
    body: {
      operatorId: created.operator.id,
      terminalMode: "pixel_grapheneos"
    }
  });
  return { tenant, operator: created.operator, session: session.session };
}

test("Step 3.72 operator account bootstrap records pass/fail evidence without secrets or production claim", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client);

    const overview = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/account-bootstrap");
    assert.ok(overview.payload.bootstrap.catalog.some((item) => item.key === "signal"));
    assert.equal(overview.payload.bootstrap.guardrails.noOtpStored, true);
    assert.equal(overview.payload.bootstrap.guardrails.adminQaReviewRequiredForProductionReadiness, true);

    const created = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/account-bootstrap/sessions", {
      method: "POST",
      body: {
        appKey: "signal",
        mode: "physical_mobile_companion",
        runtimeMode: "desktop",
        approvedPhoneProviderRef: "provider-ref://qa-number-pool/test-only"
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.payload.session.appKey, "signal");
    assert.equal(created.payload.session.state, "awaiting_human_bootstrap");
    assert.ok(created.payload.session.requiredChecks.includes("sendReceive"));
    assert.equal(created.payload.session.humanHandoff.privateInputEntry, "directly_inside_workload_ui_only");
    assert.ok(created.payload.session.humanHandoff.neverCollect.includes("otp_or_sms_code"));
    assert.ok(created.payload.session.humanHandoff.orderedSteps.some((step) => /directly in the workload UI/i.test(step)));
    assert.equal(created.payload.session.productionExecutionAllowed, false);

    const incomplete = await operatorRequest(baseUrl, seeded.session.token, `/operator-api/account-bootstrap/sessions/${created.payload.session.id}/evidence`, {
      method: "POST",
      body: {
        result: "blocked",
        checks: {
          uiVisible: { status: "passed", evidence: "Pixel noVNC canvas visible" },
          accountBootstrap: { status: "not_run" },
          sendReceive: { status: "not_run" }
        },
        evidenceArtifactIds: ["artifact://pixel/signal-visible"]
      }
    });
    assert.equal(incomplete.payload.session.state, "blocked_pending_fix");
    assert.equal(incomplete.payload.session.factualCandidate, false);
    assert.ok(incomplete.payload.session.blockers.includes("accountBootstrap_not_passed"));

    const passed = await operatorRequest(baseUrl, seeded.session.token, `/operator-api/account-bootstrap/sessions/${created.payload.session.id}/evidence`, {
      method: "POST",
      body: {
        result: "passed",
        checks: {
          uiVisible: { status: "passed", evidence: "Pixel noVNC canvas visible" },
          accountBootstrap: { status: "passed", evidence: "Disposable account linked by operator" },
          sendReceive: { status: "passed", evidence: "QA contact send/receive confirmed" }
        },
        evidenceArtifactIds: ["artifact://pixel/signal-functional"],
        latencyMs: 420
      }
    });
    assert.equal(passed.payload.session.state, "evidence_passed_pending_admin_qa_review");
    assert.equal(passed.payload.session.factualCandidate, true);
    assert.equal(passed.payload.session.adminQaReviewRequired, true);
    assert.equal(passed.payload.session.terminalDataStored, false);

    const queue = await client.request("/release/account-bootstrap-evidence");
    assert.ok(queue.sessions.some((session) => session.id === passed.payload.session.id));
    const promoted = await client.request(`/release/account-bootstrap-evidence/${passed.payload.session.id}/promote`, {
      method: "POST",
      body: {
        note: "Admin QA reviewed metadata-only operator bootstrap evidence"
      }
    });
    assert.equal(promoted.test.factualStateVerified, true);
    assert.equal(promoted.test.appKey, "signal");
    assert.equal(promoted.session.state, "promoted_to_factual_test");
    assert.equal(promoted.session.promotedFactualTestId, promoted.test.id);

    const audit = app.services.audit.list().filter((event) => event.operatorId === seeded.operator.id);
    assert.ok(audit.some((event) => event.action === "operator_portal.account_bootstrap_requested"));
    assert.ok(audit.some((event) => event.action === "operator_portal.account_bootstrap_evidence_recorded"));
    assert.ok(audit.some((event) => event.action === "operator_portal.account_bootstrap_promoted_to_factual_test"));
  } finally {
    await close();
  }
});

test("Step 3.72 account bootstrap rejects phone numbers, OTP fields, seeds and incomplete PASS", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client);
    const rejectedSecret = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/account-bootstrap/sessions", {
      method: "POST",
      expectOk: false,
      body: {
        appKey: "telegram",
        mode: "approved_test_number_provider",
        runtimeMode: "web",
        phoneNumber: "+48000000000"
      }
    });
    assert.equal(rejectedSecret.status, 422);
    assert.match(rejectedSecret.payload.error.message, /must not store phone numbers/i);

    const created = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/account-bootstrap/sessions", {
      method: "POST",
      body: { appKey: "telegram", mode: "approved_test_number_provider", runtimeMode: "web" }
    });
    const rejectedPass = await operatorRequest(baseUrl, seeded.session.token, `/operator-api/account-bootstrap/sessions/${created.payload.session.id}/evidence`, {
      method: "POST",
      expectOk: false,
      body: {
        result: "passed",
        checks: {
          uiVisible: { status: "passed" },
          accountBootstrap: { status: "passed" },
          sendReceive: { status: "not_run" }
        }
      }
    });
    assert.equal(rejectedPass.status, 422);
    assert.match(rejectedPass.payload.error.message, /PASS requires every required check/i);

    const rejectedOtp = await operatorRequest(baseUrl, seeded.session.token, `/operator-api/account-bootstrap/sessions/${created.payload.session.id}/evidence`, {
      method: "POST",
      expectOk: false,
      body: {
        result: "blocked",
        checks: { uiVisible: { status: "passed" } },
        otp: "123456"
      }
    });
    assert.equal(rejectedOtp.status, 422);
    assert.match(rejectedOtp.payload.error.message, /must not store phone numbers/i);

    const rejectedSecretNote = await operatorRequest(baseUrl, seeded.session.token, `/operator-api/account-bootstrap/sessions/${created.payload.session.id}/evidence`, {
      method: "POST",
      expectOk: false,
      body: {
        result: "blocked",
        checks: {
          uiVisible: { status: "passed", evidence: "sms code 123456" }
        },
        note: "telefon: +48 600 000 000"
      }
    });
    assert.equal(rejectedSecretNote.status, 422);
    assert.match(rejectedSecretNote.payload.error.message, /must not contain phone numbers/i);
  } finally {
    await close();
  }
});
