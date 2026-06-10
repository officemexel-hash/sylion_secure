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

async function loginClient(
  baseUrl,
  email = "admin@sylion.local",
  password = "ChangeMe-LocalOnly-1!"
) {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_step3_14_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-14-${crypto.randomUUID()}`;
  const enrollment = await anon.createEnrollmentOptions({ email, password });
  await anon.verifyEnrollment({
    challengeId: enrollment.challenge.id,
    credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
  });
  const loginOptions = await anon.createWebAuthnLoginOptions({ email, password });
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

async function createReadyPipeline(client) {
  const tenant = await client.createTenant({
    name: `Harness Tenant ${crypto.randomUUID()}`,
    tier: "PRO"
  });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Harness Operator",
    tier: "PRO",
    requestedTemplates: ["whatsapp", "signal", "telegram"]
  });
  const lab = await client.createLocalLabVpsSet(created.provisioningDraft.id);
  return { tenant: tenant.tenant, operator: created.operator, pipeline: lab.pipeline };
}

test("Step 3.14 runs the local operator environment harness, injects failure, rolls back, and keeps secrets denied", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { pipeline } = await createReadyPipeline(client);

    const created = await client.createLocalOperatorEnvironment(pipeline.id);
    assert.equal(created.environment.status, "planned");
    assert.equal(created.environment.localProvider.resources.length, 3);
    assert.equal(created.environment.mockFirecracker.runtimes.length, 3);
    assert.equal(created.environment.productionExecutionAllowed, false);

    const started = await client.startLocalOperatorEnvironment(created.environment.id);
    assert.equal(started.environment.status, "environment_ready");
    assert.ok(
      started.environment.localProvider.resources.every((resource) => resource.status === "running")
    );
    assert.ok(
      started.environment.mockFirecracker.runtimes.every((runtime) => runtime.status === "running")
    );

    const secrets = await client.checkOperatorEnvironmentSecretsRelease(created.environment.id);
    assert.equal(secrets.check.allowed, false);
    assert.ok(
      secrets.check.blockers.includes("production_secret_release_not_enabled_in_local_lab")
    );

    const failed = await client.injectOperatorEnvironmentFailure(created.environment.id, {
      failureType: "firecracker_start_failed",
      reason: "step3_14_negative_test"
    });
    assert.equal(failed.environment.status, "environment_failed");
    assert.equal(failed.environment.failure.type, "firecracker_start_failed");
    assert.ok(
      failed.environment.mockFirecracker.runtimes.some((runtime) => runtime.status === "failed")
    );

    const rolledBack = await client.rollbackOperatorEnvironment(created.environment.id, {
      reason: "step3_14_cleanup"
    });
    assert.equal(rolledBack.environment.status, "rolled_back");
    assert.ok(
      rolledBack.environment.localProvider.resources.every(
        (resource) => resource.status === "released"
      )
    );
    assert.ok(
      rolledBack.environment.mockFirecracker.runtimes.every(
        (runtime) => runtime.status === "stopped"
      )
    );

    const events = await client.listOperatorEnvironmentEvents(created.environment.id);
    assert.ok(events.events.some((event) => event.type === "environment_started"));
    assert.ok(events.events.some((event) => event.type === "failure_injected"));
    assert.ok(events.events.some((event) => event.type === "rollback_completed"));

    const auditActions = app.services.audit.list().map((event) => event.action);
    assert.ok(auditActions.includes("operator_environment.local_started"));
    assert.ok(auditActions.includes("operator_environment.failure_injected"));
    assert.ok(auditActions.includes("operator_environment.rollback_completed"));

    const monitoringEvents = app.services.monitoring.list({ operatorId: pipeline.operatorId });
    assert.ok(
      monitoringEvents.some(
        (event) =>
          event.signal === "health_status" && event.summary === "operator_environment healthy"
      )
    );
    assert.ok(monitoringEvents.some((event) => event.signal === "microvm_crash_loop"));
  } finally {
    await close();
  }
});

test("Step 3.14 blocks readonly users from mutating local operator environments", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const admin = await loginClient(baseUrl);
    const { pipeline } = await createReadyPipeline(admin);
    const created = await admin.createLocalOperatorEnvironment(pipeline.id);

    const readonly = await loginClient(baseUrl, "readonly@sylion.local", "ReadOnly-LocalOnly-1!");
    const listed = await readonly.listOperatorEnvironments();
    assert.ok(listed.environments.some((environment) => environment.id === created.environment.id));

    await assert.rejects(
      () => readonly.startLocalOperatorEnvironment(created.environment.id),
      (error) => error.status === 403
    );
  } finally {
    await close();
  }
});
