import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";
import { HetznerLiveAdapter } from "../src/modules/live/hetznerLiveAdapter.js";

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

test("Step 3.18 Hetzner adapter attempts partial cleanup when create fails mid-baseline", async () => {
  const calls = [];
  const transport = async (url, options = {}) => {
    calls.push([options.method || "GET", url]);
    if (options.method === "POST" && calls.filter(([method]) => method === "POST").length === 1) {
      return {
        ok: true,
        async json() {
          return { server: { id: 1818, name: "partial-g1", datacenter: { location: { name: "fsn1" } } } };
        }
      };
    }
    if (options.method === "POST") {
      return {
        ok: false,
        status: 422,
        async json() {
          return { error: { code: "invalid_input" } };
        }
      };
    }
    if (options.method === "DELETE") {
      return { ok: true, status: 204 };
    }
    return { ok: false, status: 500 };
  };
  const adapter = new HetznerLiveAdapter({ token: "test-token-with-safe-length", transport });
  await assert.rejects(
    () => adapter.createVpsSet({
      operatorId: "op_partial_cleanup",
      region: "fsn1",
      idempotencyKey: "step3-18-partial-cleanup"
    }),
    /partial cleanup was attempted/
  );
  assert.equal(calls.filter(([method]) => method === "DELETE").length, 1);
  assert.ok(calls.some(([method, url]) => method === "DELETE" && url.includes("/servers/1818")));
});

test("Step 3.18 Hetzner adapter emits DNS-safe server names for live provider create", async () => {
  const bodies = [];
  const transport = async (url, options = {}) => {
    if (options.method === "POST") {
      bodies.push(JSON.parse(options.body));
      return {
        ok: true,
        async json() {
          return {
            server: {
              id: 9000 + bodies.length,
              name: bodies.at(-1).name,
              datacenter: { location: { name: "fsn1" } }
            }
          };
        }
      };
    }
    return { ok: false, status: 500 };
  };
  const adapter = new HetznerLiveAdapter({ token: "test-token-with-safe-length", transport });
  await adapter.createVpsSet({
    operatorId: "op_partial_cleanup_unsafe",
    region: "fsn1",
    idempotencyKey: "step3-18-live_create_with_underscores"
  });
  assert.equal(bodies.length, 3);
  for (const body of bodies) {
    assert.match(body.name, /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/);
    assert.equal(body.name.includes("_"), false);
    assert.ok(body.name.length <= 63);
  }
});
