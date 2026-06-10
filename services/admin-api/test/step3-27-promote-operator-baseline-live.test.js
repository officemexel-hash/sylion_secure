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
    correlationIdFactory: () => `corr_step3_27_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-27-${crypto.randomUUID()}`;
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

async function createApprovedOperatorBaseline(client, suffix = "default") {
  const tenant = await client.createTenant({ name: `Step 3.27 Tenant ${suffix}`, tier: "PRO" });
  const operator = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.27 Operator ${suffix}`,
    tier: "PRO",
    requestedTemplates: ["whatsapp", "signal", "telegram"]
  });
  const provider = await client.createProvider({
    providerType: "hetzner",
    apiSecret: `test-secret-never-leak-step3-27-${suffix}`,
    regions: ["fsn1"],
    billingHealth: { status: "healthy" },
    testConnection: { mode: "mock", status: "passed" }
  });
  const approval = await client.createProvisioningApproval({
    operatorId: operator.operator.id,
    reasonCode: "operator_baseline_live_promotion",
    evidenceRefs: ["release://step3-27/promote-baseline-live"]
  });
  const approved = await client.updateProvisioningApprovalStatus(approval.approval.id, {
    status: "approved_for_execution",
    evidenceRefs: ["release://step3-27/promote-baseline-live"],
    note: "Approved for gated baseline promotion test"
  });
  return {
    operator: operator.operator,
    provisioningDraft: operator.provisioningDraft,
    baselineProvisioning: operator.baselineProvisioning,
    provider: provider.provider,
    approval: approved.approval
  };
}

test("Step 3.27 promotes automatic local baseline only through the live human gate", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operator, provider, approval, provisioningDraft, baselineProvisioning } =
      await createApprovedOperatorBaseline(client, "blocked");
    assert.equal(provisioningDraft.status, "local_lab_ready");
    assert.equal(baselineProvisioning.liveCloudMutationAllowed, false);

    const blocked = await client.promoteOperatorBaselineToLive(operator.id, "hetzner", {
      providerId: provider.id,
      approvalId: approval.id,
      region: "fsn1",
      idempotencyKey: "step3-27-blocked-live",
      liveConfirmed: true
    });

    assert.equal(blocked.promotion.mode, "operator_baseline_to_live");
    assert.equal(blocked.promotion.localBaselineId, provisioningDraft.id);
    assert.deepEqual(blocked.promotion.requestedRoles, ["G1", "G2", "WORKLOAD"]);
    assert.deepEqual(blocked.promotion.requestedWorkloads, ["whatsapp", "signal", "telegram"]);
    assert.equal(blocked.request.status, "blocked_human_gate");
    assert.equal(blocked.request.executionAllowed, false);
    assert.equal(blocked.request.sideEffectAllowed, false);
    assert.equal(blocked.request.productionExecutionAllowed, false);
    assert.ok(blocked.request.rollbackPlanId);
    assert.ok(blocked.request.gate.blockers.includes("provider_mode_not_live"));
    assert.equal(JSON.stringify(blocked).includes("test-secret-never-leak-step3-27"), false);
    assert.ok(
      app.services.audit.list().some((event) => event.action === "live_cloud.vps_set_blocked")
    );
  } finally {
    await close();
  }
});

test("Step 3.27 executes provider mutation only after automatic baseline, approval, env allowlist and explicit confirmation", async () => {
  const calls = [];
  const env = {
    SYLION_PROVIDER_MODE: "live",
    SYLION_LIVE_ALLOWED: "true",
    HETZNER_API_TOKEN: "test-token-only-in-env-step3-27",
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
          { role: "G1", providerResourceId: "hcloud-327-g1" },
          { role: "G2", providerResourceId: "hcloud-327-g2" },
          { role: "WORKLOAD", providerResourceId: "hcloud-327-workload" }
        ];
      }
    })
  });
  try {
    const client = await loginClient(baseUrl);
    const { operator, provider, approval } = await createApprovedOperatorBaseline(
      client,
      "executed"
    );

    const executed = await client.promoteOperatorBaselineToLive(operator.id, "hetzner", {
      providerId: provider.id,
      approvalId: approval.id,
      region: "fsn1",
      idempotencyKey: "step3-27-executed-live",
      liveConfirmed: true,
      serverType: "cx22",
      image: "ubuntu-24.04"
    });

    assert.equal(executed.request.status, "executed_provider_mutation");
    assert.equal(executed.request.resources.length, 3);
    assert.deepEqual(
      executed.request.resources.map((resource) => resource.role),
      ["G1", "G2", "WORKLOAD"]
    );
    assert.equal(executed.request.rollbackReady, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].operatorId, operator.id);
    assert.equal(calls[0].region, "fsn1");
    assert.equal(calls[0].serverType, "cx22");
    assert.equal(JSON.stringify(executed).includes("test-token-only-in-env-step3-27"), false);

    const idempotent = await client.promoteOperatorBaselineToLive(operator.id, "hetzner", {
      providerId: provider.id,
      approvalId: approval.id,
      region: "fsn1",
      idempotencyKey: "step3-27-executed-live",
      liveConfirmed: true
    });
    assert.equal(idempotent.request.id, executed.request.id);
    assert.equal(calls.length, 1);
  } finally {
    await close();
  }
});

test("Step 3.27 rejects live promotion when subscription blocks automatic local baseline", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const tenant = await client.createTenant({ name: "Step 3.27 Limit Tenant", tier: "STANDARD" });
    const operator = await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Step 3.27 Limit Operator",
      tier: "STANDARD",
      requestedTemplates: [
        "whatsapp",
        "signal",
        "telegram",
        "threema",
        "zangi",
        "duckduckgo_browser",
        "libreoffice",
        "exodus",
        "matrix_client",
        "matrix_server",
        "signal"
      ]
    });
    assert.equal(operator.baselineProvisioning, null);
    const provider = await client.createProvider({
      providerType: "hetzner",
      apiSecret: "test-secret-never-leak-step3-27-limit",
      regions: ["fsn1"],
      billingHealth: { status: "healthy" },
      testConnection: { mode: "mock", status: "passed" }
    });
    const approval = await client.createProvisioningApproval({
      operatorId: operator.operator.id,
      reasonCode: "operator_baseline_live_promotion_without_local_lab",
      evidenceRefs: ["release://step3-27/promote-baseline-live"]
    });
    const approved = await client.updateProvisioningApprovalStatus(approval.approval.id, {
      status: "approved_for_execution",
      evidenceRefs: ["release://step3-27/promote-baseline-live"],
      note: "Approved to verify rejection path"
    });

    await assert.rejects(
      () =>
        client.promoteOperatorBaselineToLive(operator.operator.id, "hetzner", {
          providerId: provider.provider.id,
          approvalId: approved.approval.id,
          region: "fsn1",
          idempotencyKey: "step3-27-no-local-baseline",
          liveConfirmed: true
        }),
      (error) => {
        assert.equal(error.status, 422);
        assert.match(error.message, /automatic local G1\/G2\/WORKLOAD baseline/);
        return true;
      }
    );
  } finally {
    await close();
  }
});
