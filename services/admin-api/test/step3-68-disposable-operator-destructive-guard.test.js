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
    correlationIdFactory: () => `corr_step3_68_${crypto.randomUUID()}`
  });
  const session = await anon.login({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!",
    fido2Verified: true
  });
  return anon.withToken(session.token);
}

async function createTenant(client, tier = "PRO") {
  const tenant = await client.createTenant({ name: `Step 3.68 Tenant ${crypto.randomUUID()}`, tier });
  return tenant.tenant;
}

test("Step 3.68 disposable operator creation requires explicit destructive lab markers", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const tenant = await createTenant(client);

    await assert.rejects(
      () => client.createOperator({
        tenantId: tenant.id,
        displayName: "OP-DESTRUCTIVE-001",
        tier: "PRO",
        disposable: true,
        destructiveTestScope: "operator_teardown_lab"
      }),
      (error) => {
        assert.equal(error.status, 422);
        assert.match(error.message, /DISPOSABLE/);
        return true;
      }
    );

    const created = await client.createOperator({
      tenantId: tenant.id,
      displayName: "OP-DESTRUCTIVE-001 DISPOSABLE",
      tier: "PRO",
      disposable: true,
      destructiveTestScope: "operator_teardown_lab"
    });
    assert.equal(created.operator.disposable, true);
    assert.equal(created.operator.destructiveTest.scope, "operator_teardown_lab");
    assert.equal(created.operator.destructiveTest.deletionProtection, false);
    assert.ok(created.operator.labels.includes("DISPOSABLE"));
    assert.ok(created.operator.labels.includes("DESTRUCTIVE_LAB"));
    assert.equal(created.operator.destructiveTest.liveProviderMutationAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.68 destructive teardown plan is plan-only, audited and scoped to disposable operator", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const tenant = await createTenant(client, "SOVEREIGN");
    const created = await client.createOperator({
      tenantId: tenant.id,
      displayName: "OP-DESTRUCTIVE-001 DISPOSABLE",
      tier: "SOVEREIGN",
      disposable: true,
      destructiveTestScope: "operator_teardown_lab",
      labels: ["lab"]
    });

    const plan = await client.createDisposableTeardownPlan(created.operator.id, {
      requestedAction: "operator_teardown",
      reason: "human regression destructive lab"
    });
    assert.equal(plan.plan.operatorId, created.operator.id);
    assert.equal(plan.plan.state, "planned_human_gate_required");
    assert.equal(plan.plan.guardrails.providerMutationAllowed, false);
    assert.equal(plan.plan.guardrails.productionExecutionAllowed, false);
    assert.equal(plan.plan.guardrails.auditRetentionRequired, true);
    assert.equal(plan.plan.secretMaterialAccepted, false);
    assert.ok(plan.plan.resourceDiff.some((item) => item.layer === "g1" && item.operation === "destroy"));
    assert.ok(plan.plan.resourceDiff.some((item) => item.layer === "audit" && item.operation === "preserve"));
    assert.match(plan.plan.confirmationPhrase, new RegExp(`^DESTROY_DISPOSABLE_OPERATOR:${created.operator.id}$`));

    const listed = await client.listDisposableTeardownPlans(created.operator.id);
    assert.equal(listed.plans.length, 1);
    assert.equal(listed.plans[0].id, plan.plan.id);

    const audit = app.services.audit.list().filter((event) => event.operatorId === created.operator.id);
    assert.ok(audit.some((event) => event.action === "operator.disposable_teardown_plan_created"));
    assert.equal(JSON.stringify(audit).includes("human regression destructive lab"), true);
  } finally {
    await close();
  }
});

test("Step 3.68 destructive teardown rejects non-disposable operators before side effects", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const tenant = await createTenant(client);
    const created = await client.createOperator({
      tenantId: tenant.id,
      displayName: "Real Operator Must Survive",
      tier: "PRO"
    });

    await assert.rejects(
      () => client.createDisposableTeardownPlan(created.operator.id, {
        requestedAction: "operator_teardown",
        reason: "negative safety test"
      }),
      (error) => {
        assert.equal(error.status, 422);
        assert.equal(error.payload.error.details.sideEffectPrevented, true);
        return true;
      }
    );

    const after = await client.request(`/operators?tenantId=${encodeURIComponent(tenant.id)}`);
    assert.equal(after.operators[0].status, "draft");
    assert.equal(after.operators[0].disposable, false);
    const audit = app.services.audit.list().filter((event) => event.operatorId === created.operator.id);
    assert.ok(audit.some((event) => event.action === "operator.disposable_teardown_rejected"));
  } finally {
    await close();
  }
});

test("Step 3.68 destructive teardown requires exact confirmation and preserves audit", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const tenant = await createTenant(client);
    const created = await client.createOperator({
      tenantId: tenant.id,
      displayName: "OP-DESTRUCTIVE-001 DISPOSABLE",
      tier: "PRO",
      disposable: true,
      destructiveTestScope: "operator_teardown_lab"
    });
    const plan = await client.createDisposableTeardownPlan(created.operator.id, {
      requestedAction: "environment_destroy"
    });

    await assert.rejects(
      () => client.executeDisposableTeardown(created.operator.id, {
        planId: plan.plan.id,
        confirmation: "wrong"
      }),
      (error) => {
        assert.equal(error.status, 422);
        assert.equal(error.payload.error.details.confirmationMaterialStored, false);
        return true;
      }
    );

    const beforeExecute = await client.request(`/operators?tenantId=${encodeURIComponent(tenant.id)}`);
    assert.equal(beforeExecute.operators[0].status, "draft");

    const executed = await client.executeDisposableTeardown(created.operator.id, {
      planId: plan.plan.id,
      confirmation: plan.plan.confirmationPhrase,
      reason: "approved disposable lab teardown"
    });
    assert.equal(executed.job.state, "completed_control_plane_teardown");
    assert.equal(executed.job.providerMutationAllowed, false);
    assert.equal(executed.job.auditRetention, "preserved");
    assert.ok(executed.job.resourceResults.every((item) => item.scope === "operator_only" || item.scope === "operator_evidence"));
    assert.ok(executed.job.resourceResults.some((item) => item.layer === "audit" && item.result === "preserved"));

    const afterExecute = await client.request(`/operators?tenantId=${encodeURIComponent(tenant.id)}`);
    assert.equal(afterExecute.operators[0].status, "revoked");
    assert.equal(afterExecute.operators[0].teardown.state, "completed_control_plane");
    assert.equal(afterExecute.operators[0].teardown.providerMutationAllowed, false);

    const serializedAudit = JSON.stringify(app.services.audit.list().filter((event) => event.operatorId === created.operator.id));
    assert.match(serializedAudit, /operator\.disposable_teardown_rejected/);
    assert.match(serializedAudit, /operator\.disposable_teardown_completed/);
    assert.equal(serializedAudit.includes(plan.plan.confirmationPhrase), false);
  } finally {
    await close();
  }
});

test("Step 3.68 disposable teardown requests reject plaintext secret fields", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const tenant = await createTenant(client);
    const created = await client.createOperator({
      tenantId: tenant.id,
      displayName: "OP-DESTRUCTIVE-001 DISPOSABLE",
      tier: "PRO",
      disposable: true,
      destructiveTestScope: "operator_teardown_lab"
    });

    await assert.rejects(
      () => client.createDisposableTeardownPlan(created.operator.id, {
        requestedAction: "operator_teardown",
        panicCode: "do-not-store-this"
      }),
      (error) => {
        assert.equal(error.status, 422);
        assert.ok(error.payload.error.details.fields.includes("panicCode"));
        return true;
      }
    );
  } finally {
    await close();
  }
});
