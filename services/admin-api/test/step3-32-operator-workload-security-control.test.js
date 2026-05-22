import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

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
    correlationIdFactory: () => `corr_step3_32_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-32-${crypto.randomUUID()}`;
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
      "x-correlation-id": `corr_step3_32_operator_${crypto.randomUUID()}`,
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
  const tenant = await client.createTenant({ name: `Step 3.32 ${tier} Tenant`, tier });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.32 ${tier} Operator`,
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

test("Step 3.32 operator can queue communicator environment counts within tier quota", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");

    const before = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/workload-control");
    assert.equal(before.payload.control.quota.maxWorkloadEnvironments, 10);
    assert.equal(before.payload.control.guardrails.cdrRequired, true);
    assert.equal(before.payload.control.guardrails.terminalDataStored, false);
    const zangiCatalog = before.payload.control.catalog.find((app) => app.key === "zangi");
    assert.equal(zangiCatalog.nativeRuntimeRequired, true);
    assert.equal(zangiCatalog.runtimeGate.runtimeClass, "android_workload");
    assert.equal(zangiCatalog.runtimeGate.ready, false);
    assert.ok(zangiCatalog.runtimeGate.blockers.includes("kvm_device"));

    const desiredCounts = {
      whatsapp: 3,
      signal: 2,
      telegram: 0,
      threema: 0,
      zangi: 1,
      matrix_client: 0,
      matrix_server: 0,
      duckduckgo_browser: 1,
      libreoffice: 1,
      exodus: 1
    };
    const queued = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/workload-control/requests", {
      method: "POST",
      body: { action: "scale_to_counts", desiredCounts }
    });
    assert.equal(queued.status, 201);
    assert.equal(queued.payload.request.totalRequested, 9);
    assert.equal(queued.payload.request.controlPlaneOnly, true);
    assert.equal(queued.payload.request.sideEffectAllowed, false);
    assert.equal(queued.payload.request.productionExecutionAllowed, false);
    assert.equal(queued.payload.request.desiredCounts.whatsapp, 3);
    assert.equal(queued.payload.request.executionPlan.cdr.required, true);
    assert.ok(queued.payload.request.executionPlan.stages.includes("cdr_policy_attached"));
    assert.ok(queued.payload.request.executionPlan.stages.includes("panic_policy_checked"));

    const after = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/workload-control");
    assert.equal(after.payload.control.latestRequest.state, "queued_control_plane_update");
    assert.equal(after.payload.control.latestDesiredCounts.signal, 2);
    assert.ok(after.payload.control.catalog.some((app) => app.key === "exodus" && app.category === "wallet"));
    assert.equal(after.payload.control.latestDesiredCounts.exodus, 1);

    const audit = app.services.audit.list().filter((event) => event.operatorId === seeded.operator.id);
    assert.ok(audit.some((event) => event.action === "operator_portal.workload_control_requested"));
  } finally {
    await close();
  }
});

test("Step 3.32 Zangi native runtime is blocked until Android host gates pass", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    const execution = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/workload-execution/zangi");
    assert.equal(execution.payload.execution.runtime.kind, "android_workload");
    assert.equal(execution.payload.execution.runtime.runner, "real_android_workload_runner_required");
    assert.equal(execution.payload.execution.runtime.substrate.androidRuntime.ready, false);
    assert.ok(execution.payload.execution.blockers.includes("android_kvm_device_not_ready"));
    assert.ok(execution.payload.execution.warnings.includes("native_zangi_requires_android_workload_not_chromium_download_page"));

    const start = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/workload-execution/zangi/start", {
      method: "POST"
    });
    assert.equal(start.payload.request.state, "blocked");
    assert.equal(start.payload.request.launchAllowed, false);
    assert.equal(start.payload.request.productionExecutionAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.32 destructive workload recreate requests expose CDR and panic execution plan without side effects", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    const queued = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/workload-control/requests", {
      method: "POST",
      body: {
        action: "rotate_app",
        rotateApp: "whatsapp",
        desiredCounts: {
          whatsapp: 2,
          signal: 1
        }
      }
    });
    assert.equal(queued.status, 201);
    assert.equal(queued.payload.request.state, "queued_destructive_recreate_control_plane");
    assert.equal(queued.payload.request.deleteRecreateMode, "queued_control_plane");
    assert.equal(queued.payload.request.destructiveCleanupAllowed, false);
    assert.equal(queued.payload.request.executionPlan.targetApp, "whatsapp");
    assert.equal(queued.payload.request.executionPlan.cdr.fileIngressEgressBlockedWithoutDecision, true);
    assert.equal(queued.payload.request.executionPlan.panicPolicy.destructiveActionRequiresSessionUnlock, true);
    assert.ok(queued.payload.request.executionPlan.targetRefs.includes(`workload-slot://${seeded.operator.id}/whatsapp`));
  } finally {
    await close();
  }
});

test("Step 3.32 operator workload control denies counts above subscription quota", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "STANDARD");
    const denied = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/workload-control/requests", {
      method: "POST",
      expectOk: false,
      body: {
        action: "scale_to_counts",
        desiredCounts: {
          whatsapp: 3,
          signal: 2,
          telegram: 1
        }
      }
    });
    assert.equal(denied.status, 422);
    assert.match(denied.payload.error.message, /quota/i);
    assert.equal(denied.payload.error.details.maxWorkloadEnvironments, 3);
  } finally {
    await close();
  }
});

test("Step 3.32 operator unlock policy stores only write-only layer password metadata", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    const secretPhrase = "Layer passphrase local only 12345";

    const saved = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/settings/unlock", {
      method: "POST",
      body: {
        sessionHours: 12,
        g1Password: secretPhrase,
        g2Password: `${secretPhrase} g2`,
        workloadPassword: `${secretPhrase} workload`,
        fido2RequiredAtSessionEnd: true
      }
    });
    assert.equal(saved.payload.policy.sessionHours, 12);
    assert.equal(saved.payload.policy.layers.g1.passwordSet, true);
    assert.equal(saved.payload.policy.layers.g2.passwordMaterialStored, false);
    assert.equal(saved.payload.policy.layers.workload.passwordSet, true);
    assert.equal(JSON.stringify(saved.payload).includes(secretPhrase), false);

    const nextSession = await client.request("/operator-api/sessions/local-simulator", {
      method: "POST",
      body: {
        operatorId: seeded.operator.id,
        terminalMode: "pixel_grapheneos"
      }
    });
    assert.equal(nextSession.session.sessionHours, 12);

    const serializedAudit = JSON.stringify(app.services.audit.list().filter((event) => event.operatorId === seeded.operator.id));
    assert.equal(serializedAudit.includes(secretPhrase), false);
    assert.match(serializedAudit, /operator_portal\.unlock_policy_updated/);
  } finally {
    await close();
  }
});

test("Step 3.32 operator safety controls keep panic codes write-only", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    const panicCode = "Panic level one local only 12345";

    const saved = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/settings/safety", {
      method: "POST",
      body: {
        backupEnabled: true,
        backupCadenceHours: 24,
        inactivityWipeEnabled: true,
        inactivityWipeDays: 10,
        data_wipeCode: panicCode,
        environment_destroyCode: `${panicCode} destroy`
      }
    });
    assert.equal(saved.payload.policy.backup.enabled, true);
    assert.equal(saved.payload.policy.backup.workloadDataIncluded, false);
    assert.equal(saved.payload.policy.inactivityWipe.afterDays, 10);
    assert.equal(saved.payload.policy.panicCodes.data_wipe.codeSet, true);
    assert.equal(saved.payload.policy.panicCodes.environment_destroy.codeMaterialStored, false);
    assert.equal(JSON.stringify(saved.payload).includes(panicCode), false);

    const serializedAudit = JSON.stringify(app.services.audit.list().filter((event) => event.operatorId === seeded.operator.id));
    assert.equal(serializedAudit.includes(panicCode), false);
    assert.match(serializedAudit, /operator_portal\.safety_policy_updated/);
  } finally {
    await close();
  }
});

test("Step 3.32 jurisdiction, Matrix and subscription requests are quota and control-plane gated", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const standard = await seedOperator(client, "STANDARD");
    const denied = await operatorRequest(baseUrl, standard.session.token, "/operator-api/settings/jurisdiction", {
      method: "POST",
      expectOk: false,
      body: {
        mode: "scheduled",
        regions: ["de", "fi"]
      }
    });
    assert.equal(denied.status, 422);
    assert.match(denied.payload.error.message, /subscription/i);

    const pro = await seedOperator(client, "PRO");
    const jurisdiction = await operatorRequest(baseUrl, pro.session.token, "/operator-api/settings/jurisdiction", {
      method: "POST",
      body: {
        mode: "scheduled",
        regions: ["de", "fi"]
      }
    });
    assert.equal(jurisdiction.payload.policy.mode, "scheduled");
    assert.equal(jurisdiction.payload.policy.productionExecutionAllowed, false);

    const matrix = await operatorRequest(baseUrl, pro.session.token, "/operator-api/matrix-server/requests", {
      method: "POST",
      body: {
        hostname: "matrix.operator.example",
        federation: true
      }
    });
    assert.equal(matrix.status, 201);
    assert.equal(matrix.payload.request.state, "queued_addon_and_dns_review");
    assert.equal(matrix.payload.request.terminalDataStored, false);

    const billing = await operatorRequest(baseUrl, pro.session.token, "/operator-api/subscription/requests", {
      method: "POST",
      body: {
        action: "upgrade",
        targetTier: "SOVEREIGN"
      }
    });
    assert.equal(billing.status, 201);
    assert.equal(billing.payload.request.state, "queued_billing_review");
    assert.equal(billing.payload.request.billingExecutionAllowed, false);
  } finally {
    await close();
  }
});
