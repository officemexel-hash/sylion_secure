import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";
import { EnvSecretProvider } from "../src/modules/secrets/envSecretProvider.js";

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
    correlationIdFactory: () => `corr_step3_16_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-16-${crypto.randomUUID()}`;
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
  return { client: anon.withToken(session.token), credentialId };
}

async function stepUp(client, credentialId) {
  const options = await client.createStepUpOptions();
  await client.verifyStepUp({
    challengeId: options.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${options.challenge.id}:${credentialId}`,
      signCounter: 2
    }
  });
}

async function createApprovedBaseline(client) {
  const tenant = await client.createTenant({ name: "Step 3.16 Tenant", tier: "PRO" });
  const operator = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Step 3.16 Operator",
    tier: "PRO"
  });
  const provider = await client.createProvider({
    providerType: "hetzner",
    apiSecret: "stored-reference-only-step3-16",
    regions: ["fsn1"],
    billingHealth: { status: "healthy" },
    testConnection: { mode: "mock", status: "passed" }
  });
  const approval = await client.createProvisioningApproval({
    operatorId: operator.operator.id,
    reasonCode: "step3_16_hetzner_sandbox",
    evidenceRefs: ["release://step3-16/hetzner-sandbox"]
  });
  const approved = await client.updateProvisioningApprovalStatus(approval.approval.id, {
    status: "approved_for_execution",
    evidenceRefs: ["release://step3-16/hetzner-sandbox"],
    note: "Approved for gated sandbox adapter test"
  });
  return { operator: operator.operator, provider: provider.provider, approval: approved.approval };
}

test("Step 3.16 resolves Hetzner token through EnvSecretProvider without exposing plaintext", async () => {
  const secretProvider = new EnvSecretProvider({
    env: { HETZNER_API_TOKEN: "env-token-step3-16-secret" }
  });
  assert.equal(secretProvider.hasProviderSecret("hetzner"), true);
  assert.equal(secretProvider.status().providers.hetzner.configured, true);
  assert.equal(
    JSON.stringify(secretProvider.status()).includes("env-token-step3-16-secret"),
    false
  );
});

test("Step 3.16 reconciles and executes Hetzner rollback through gated sandbox adapter", async () => {
  const calls = [];
  const env = {
    SYLION_PROVIDER_MODE: "live",
    SYLION_LIVE_ALLOWED: "true",
    HETZNER_API_TOKEN: "env-token-step3-16-secret",
    SYLION_LIVE_ALLOWLIST_OPERATORS: "*",
    SYLION_LIVE_ALLOWED_REGIONS: "fsn1",
    SYLION_LIVE_MAX_SERVERS: "3"
  };
  const adapter = {
    async createVpsSet(input) {
      calls.push(["create", input]);
      return [
        {
          role: "G1",
          providerResourceId: "hcloud-16-g1",
          rollback: {
            action: "delete_server",
            providerResourceId: "hcloud-16-g1",
            idempotencyKey: input.idempotencyKey
          }
        },
        {
          role: "G2",
          providerResourceId: "hcloud-16-g2",
          rollback: {
            action: "delete_server",
            providerResourceId: "hcloud-16-g2",
            idempotencyKey: input.idempotencyKey
          }
        },
        {
          role: "WORKLOAD",
          providerResourceId: "hcloud-16-workload",
          rollback: {
            action: "delete_server",
            providerResourceId: "hcloud-16-workload",
            idempotencyKey: input.idempotencyKey
          }
        }
      ];
    },
    async listVpsSet(input) {
      calls.push(["list", input]);
      return [
        { role: "G1", providerResourceId: "hcloud-16-g1", status: "running" },
        { role: "G2", providerResourceId: "hcloud-16-g2", status: "running" },
        { role: "WORKLOAD", providerResourceId: "hcloud-16-workload", status: "running" }
      ];
    },
    async deleteVpsSet(input) {
      calls.push(["delete", input]);
      return input.actions.map((action) => ({ ...action, status: "delete_requested" }));
    }
  };
  const { app, baseUrl, close } = await startTestServer({
    env,
    adapterFactory: () => adapter
  });
  try {
    const { client, credentialId } = await loginClient(baseUrl);
    const { operator, provider, approval } = await createApprovedBaseline(client);

    const summary = await client.getLiveExecutionSummary();
    assert.equal(summary.summary.secretProvider.providers.hetzner.configured, true);
    assert.equal(JSON.stringify(summary).includes("env-token-step3-16-secret"), false);

    const executed = await client.requestProviderLiveVpsSet("hetzner", {
      providerId: provider.id,
      operatorId: operator.id,
      approvalId: approval.id,
      region: "fsn1",
      idempotencyKey: "step3-16-executed-live",
      liveConfirmed: true
    });
    assert.equal(executed.request.status, "executed_provider_mutation");
    assert.equal(executed.request.rollbackReady, true);

    const reconciled = await client.reconcileProviderLiveVpsSet("hetzner", {
      providerId: provider.id,
      operatorId: operator.id
    });
    assert.equal(reconciled.reconciliation.status, "in_sync");
    assert.deepEqual(reconciled.reconciliation.drift, []);

    await stepUp(client, credentialId);
    const rolledBack = await client.executeLiveRollbackPlan(executed.request.rollbackPlanId, {
      liveConfirmed: true
    });
    assert.equal(rolledBack.plan.status, "rollback_executed");
    assert.equal(rolledBack.plan.results.length, 3);
    assert.ok(calls.some(([name]) => name === "create"));
    assert.ok(calls.some(([name]) => name === "list"));
    assert.ok(calls.some(([name]) => name === "delete"));
    assert.equal(JSON.stringify(rolledBack).includes("env-token-step3-16-secret"), false);
    assert.ok(
      app.services.audit.list().some((event) => event.action === "live_cloud.rollback_executed")
    );
  } finally {
    await close();
  }
});

test("Step 3.16 blocks reconciliation when runtime provider secret is absent", async () => {
  const env = {
    SYLION_PROVIDER_MODE: "live",
    SYLION_LIVE_ALLOWED: "true",
    SYLION_LIVE_ALLOWLIST_OPERATORS: "*",
    SYLION_LIVE_ALLOWED_REGIONS: "fsn1",
    SYLION_LIVE_MAX_SERVERS: "3"
  };
  const { baseUrl, close } = await startTestServer({ env });
  try {
    const { client } = await loginClient(baseUrl);
    const { operator, provider } = await createApprovedBaseline(client);
    const reconciled = await client.reconcileProviderLiveVpsSet("hetzner", {
      providerId: provider.id,
      operatorId: operator.id
    });
    assert.equal(reconciled.reconciliation.status, "blocked_human_gate");
    assert.ok(reconciled.reconciliation.gate.blockers.includes("hetzner_api_token_missing"));
  } finally {
    await close();
  }
});
