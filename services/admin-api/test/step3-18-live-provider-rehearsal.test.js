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
    correlationIdFactory: () => `corr_step3_18_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-18-${crypto.randomUUID()}`;
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

async function createApprovedBaseline(client, suffix = "sandbox") {
  const tenant = await client.createTenant({ name: `Step 3.18 Tenant ${suffix}`, tier: "PRO" });
  const operator = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.18 Operator ${suffix}`,
    tier: "PRO"
  });
  const provider = await client.createProvider({
    providerType: "hetzner",
    apiSecret: `stored-reference-only-step3-18-${suffix}`,
    regions: ["fsn1"],
    billingHealth: { status: "healthy" },
    testConnection: { mode: "mock", status: "passed" }
  });
  const approval = await client.createProvisioningApproval({
    operatorId: operator.operator.id,
    reasonCode: "step3_18_live_provider_rehearsal",
    evidenceRefs: ["release://step3-18/provider-rehearsal"]
  });
  const approved = await client.updateProvisioningApprovalStatus(approval.approval.id, {
    status: "approved_for_execution",
    evidenceRefs: ["release://step3-18/provider-rehearsal"],
    note: "Approved for rehearsal only"
  });
  return { operator: operator.operator, provider: provider.provider, approval: approved.approval };
}

test("Step 3.18 runs Hetzner adapter sandbox rehearsal without runtime token or provider side effects", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operator, provider, approval } = await createApprovedBaseline(client);

    const result = await client.runProviderLiveRehearsal("hetzner", {
      providerId: provider.id,
      operatorId: operator.id,
      approvalId: approval.id,
      region: "fsn1",
      idempotencyKey: "step3-18-sandbox-rehearsal",
      rehearsalMode: "adapter_sandbox",
      liveConfirmed: true,
      cleanupConfirmed: true
    });

    assert.equal(result.rehearsal.status, "smoke_passed");
    assert.equal(result.rehearsal.rehearsalMode, "adapter_sandbox");
    assert.equal(result.rehearsal.sideEffectAllowed, false);
    assert.equal(result.rehearsal.productionExecutionAllowed, false);
    assert.deepEqual(result.rehearsal.resources.map((resource) => resource.role), ["G1", "G2", "WORKLOAD"]);
    assert.ok(result.rehearsal.resources.every((resource) => resource.providerResourceId.startsWith("sandbox://")));
    assert.ok(result.rehearsal.phases.some((phase) => phase.name === "cleanup_rollback" && phase.status === "passed"));
    assert.equal(JSON.stringify(result).includes("stored-reference-only-step3-18"), false);

    const listed = await client.listLiveProviderRehearsals();
    assert.ok(listed.rehearsals.some((item) => item.id === result.rehearsal.id));
    assert.ok(app.services.audit.list().some((event) => event.action === "live_cloud.provider_rehearsal_completed"));
  } finally {
    await close();
  }
});

test("Step 3.18 blocks live provider rehearsal unless explicit live smoke env gate is enabled", async () => {
  const env = {
    SYLION_PROVIDER_MODE: "live",
    SYLION_LIVE_ALLOWED: "true",
    HETZNER_API_TOKEN: "env-token-step3-18-secret",
    SYLION_LIVE_ALLOWLIST_OPERATORS: "*",
    SYLION_LIVE_ALLOWED_REGIONS: "fsn1",
    SYLION_LIVE_MAX_SERVERS: "3"
  };
  const { baseUrl, close } = await startTestServer({ env });
  try {
    const client = await loginClient(baseUrl);
    const { operator, provider, approval } = await createApprovedBaseline(client, "blocked-live");

    const result = await client.runProviderLiveRehearsal("hetzner", {
      providerId: provider.id,
      operatorId: operator.id,
      approvalId: approval.id,
      region: "fsn1",
      idempotencyKey: "step3-18-live-blocked",
      rehearsalMode: "live_provider",
      liveConfirmed: true,
      cleanupConfirmed: true
    });

    assert.equal(result.rehearsal.status, "blocked_human_gate");
    assert.ok(result.rehearsal.gate.blockers.includes("live_smoke_env_flag_disabled"));
    assert.equal(result.rehearsal.resources.length, 0);
    assert.equal(JSON.stringify(result).includes("env-token-step3-18-secret"), false);
  } finally {
    await close();
  }
});

test("Step 3.18 live provider rehearsal calls create, list, and cleanup only behind live smoke gate", async () => {
  const calls = [];
  const env = {
    SYLION_PROVIDER_MODE: "live",
    SYLION_LIVE_ALLOWED: "true",
    SYLION_LIVE_SMOKE_ALLOWED: "true",
    HETZNER_API_TOKEN: "env-token-step3-18-live-secret",
    SYLION_LIVE_ALLOWLIST_OPERATORS: "*",
    SYLION_LIVE_ALLOWED_REGIONS: "fsn1",
    SYLION_LIVE_MAX_SERVERS: "3"
  };
  const adapter = {
    async createVpsSet(input) {
      calls.push(["create", input]);
      return [
        { role: "G1", providerResourceId: "hcloud-18-g1", rollback: { action: "delete_server", providerResourceId: "hcloud-18-g1", idempotencyKey: input.idempotencyKey } },
        { role: "G2", providerResourceId: "hcloud-18-g2", rollback: { action: "delete_server", providerResourceId: "hcloud-18-g2", idempotencyKey: input.idempotencyKey } },
        { role: "WORKLOAD", providerResourceId: "hcloud-18-workload", rollback: { action: "delete_server", providerResourceId: "hcloud-18-workload", idempotencyKey: input.idempotencyKey } }
      ];
    },
    async listVpsSet(input) {
      calls.push(["list", input]);
      return [
        { role: "G1", providerResourceId: "hcloud-18-g1", status: "running" },
        { role: "G2", providerResourceId: "hcloud-18-g2", status: "running" },
        { role: "WORKLOAD", providerResourceId: "hcloud-18-workload", status: "running" }
      ];
    },
    async deleteVpsSet(input) {
      calls.push(["delete", input]);
      return input.actions.map((action) => ({ ...action, status: "delete_requested" }));
    }
  };
  const { baseUrl, close } = await startTestServer({
    env,
    adapterFactory: () => adapter
  });
  try {
    const client = await loginClient(baseUrl);
    const { operator, provider, approval } = await createApprovedBaseline(client, "live-gated");

    const result = await client.runProviderLiveRehearsal("hetzner", {
      providerId: provider.id,
      operatorId: operator.id,
      approvalId: approval.id,
      region: "fsn1",
      idempotencyKey: "step3-18-live-gated",
      rehearsalMode: "live_provider",
      liveConfirmed: true,
      cleanupConfirmed: true
    });

    assert.equal(result.rehearsal.status, "smoke_passed");
    assert.equal(result.rehearsal.sideEffectAllowed, true);
    assert.equal(result.rehearsal.productionExecutionAllowed, false);
    assert.deepEqual(calls.map(([name]) => name), ["create", "list", "delete"]);
    assert.equal(JSON.stringify(result).includes("env-token-step3-18-live-secret"), false);
  } finally {
    await close();
  }
});
