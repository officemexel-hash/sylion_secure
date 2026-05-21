import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startTestServer(liveExecutionOptions = {}) {
  const app = createApp({ liveExecutionOptions });
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
    correlationIdFactory: () => `corr_step3_15_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-15-${crypto.randomUUID()}`;
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

async function createApprovedBaseline(client, providerType = "hetzner") {
  const tenant = await client.createTenant({ name: `Step 3.15 Tenant ${providerType}`, tier: "PRO" });
  const operator = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.15 Operator ${providerType}`,
    tier: "PRO"
  });
  const provider = await client.createProvider({
    providerType,
    apiSecret: `test-secret-never-leak-step3-15-${providerType}`,
    regions: providerType === "ovh" ? ["waw"] : ["fsn1"],
    billingHealth: { status: "healthy" },
    testConnection: { mode: "mock", status: "passed" }
  });
  const approval = await client.createProvisioningApproval({
    operatorId: operator.operator.id,
    reasonCode: "live_provider_unlock_review",
    evidenceRefs: ["release://step3-15/live-provider-unlock"]
  });
  const approved = await client.updateProvisioningApprovalStatus(approval.approval.id, {
    status: "approved_for_execution",
    evidenceRefs: ["release://step3-15/live-provider-unlock"],
    note: "Approved for gated Step 3.15 test"
  });
  return { operator: operator.operator, provider: provider.provider, approval: approved.approval };
}

test("Step 3.15 creates rollback plans for blocked live requests without leaking provider secrets", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operator, provider, approval } = await createApprovedBaseline(client);

    const blocked = await client.requestProviderLiveVpsSet("hetzner", {
      providerId: provider.id,
      operatorId: operator.id,
      approvalId: approval.id,
      region: "fsn1",
      idempotencyKey: "step3-15-blocked-live",
      liveConfirmed: true
    });

    assert.equal(blocked.request.status, "blocked_human_gate");
    assert.equal(blocked.request.rollbackReady, false);
    assert.ok(blocked.request.rollbackPlanId);
    assert.ok(blocked.request.gate.rollbackPlanRequiredBeforeMutation);
    assert.equal(JSON.stringify(blocked).includes("test-secret-never-leak-step3-15"), false);

    const plans = await client.listLiveRollbackPlans();
    assert.ok(plans.plans.some((plan) => plan.id === blocked.request.rollbackPlanId));
    assert.ok(app.services.audit.list().some((event) => event.action === "live_cloud.rollback_plan_created"));
  } finally {
    await close();
  }
});

test("Step 3.15 Hetzner V2 sanitizes resources, preserves 3 VPS baseline, and records rollback metadata", async () => {
  const calls = [];
  const env = {
    SYLION_PROVIDER_MODE: "live",
    SYLION_LIVE_ALLOWED: "true",
    HETZNER_API_TOKEN: "test-token-only-in-env-step3-15",
    SYLION_LIVE_ALLOWLIST_OPERATORS: "*",
    SYLION_LIVE_ALLOWED_REGIONS: "fsn1",
    SYLION_LIVE_MAX_SERVERS: "3"
  };
  const { baseUrl, close } = await startTestServer({
    env,
    adapterFactory: () => ({
      async createVpsSet(input) {
        calls.push(input);
        return [
          { role: "G1", providerResourceId: "hcloud-g1", rawProviderResponse: { token: "leak" }, rollback: { action: "delete_server", providerResourceId: "hcloud-g1", idempotencyKey: input.idempotencyKey } },
          { role: "G2", providerResourceId: "hcloud-g2", secret: "bad", rollback: { action: "delete_server", providerResourceId: "hcloud-g2", idempotencyKey: input.idempotencyKey } },
          { role: "WORKLOAD", providerResourceId: "hcloud-workload", name: "workload", rollback: { action: "delete_server", providerResourceId: "hcloud-workload", idempotencyKey: input.idempotencyKey } }
        ];
      }
    })
  });
  try {
    const client = await loginClient(baseUrl);
    const { operator, provider, approval } = await createApprovedBaseline(client);

    const executed = await client.requestProviderLiveVpsSet("hetzner", {
      providerId: provider.id,
      operatorId: operator.id,
      approvalId: approval.id,
      region: "fsn1",
      idempotencyKey: "step3-15-executed-live",
      liveConfirmed: true
    });

    assert.equal(executed.request.status, "executed_provider_mutation");
    assert.equal(executed.request.resources.length, 3);
    assert.deepEqual(executed.request.resources.map((resource) => resource.role), ["G1", "G2", "WORKLOAD"]);
    assert.equal(executed.request.rollbackReady, true);
    assert.equal(JSON.stringify(executed).includes("test-token-only-in-env-step3-15"), false);
    assert.equal(JSON.stringify(executed).includes("rawProviderResponse"), false);
    assert.equal(JSON.stringify(executed).includes("\"secret\":\"bad\""), false);
    assert.equal(calls.length, 1);

    const idempotent = await client.requestProviderLiveVpsSet("hetzner", {
      providerId: provider.id,
      operatorId: operator.id,
      approvalId: approval.id,
      region: "fsn1",
      idempotencyKey: "step3-15-executed-live",
      liveConfirmed: true
    });
    assert.equal(idempotent.request.id, executed.request.id);
    assert.equal(calls.length, 1);
  } finally {
    await close();
  }
});

test("Step 3.15 OVH adapter is visible but blocked by the live unlock gate", async () => {
  const env = {
    SYLION_PROVIDER_MODE: "live",
    SYLION_LIVE_ALLOWED: "true",
    HETZNER_API_TOKEN: "hetzner-token-not-used-for-ovh",
    SYLION_LIVE_ALLOWLIST_OPERATORS: "*",
    SYLION_LIVE_ALLOWED_REGIONS: "waw",
    SYLION_LIVE_MAX_SERVERS: "3"
  };
  const { baseUrl, close } = await startTestServer({ env });
  try {
    const client = await loginClient(baseUrl);
    const { operator, provider, approval } = await createApprovedBaseline(client, "ovh");

    const blocked = await client.requestProviderLiveVpsSet("ovh", {
      providerId: provider.id,
      operatorId: operator.id,
      approvalId: approval.id,
      region: "waw",
      idempotencyKey: "step3-15-ovh-blocked",
      liveConfirmed: true
    });

    assert.equal(blocked.request.status, "blocked_human_gate");
    assert.ok(blocked.request.gate.blockers.includes("ovh_live_adapter_not_implemented"));
    assert.equal(blocked.request.sideEffectAllowed, false);
    assert.equal(blocked.request.executionAllowed, false);
  } finally {
    await close();
  }
});
