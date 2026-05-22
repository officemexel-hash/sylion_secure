import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";
import { HetznerRobotAdapter } from "../src/modules/live/hetznerRobotAdapter.js";

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
    correlationIdFactory: () => `corr_step3_49_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-49-${crypto.randomUUID()}`;
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

async function createRobotBaseline(client) {
  const tenant = await client.createTenant({ name: "Step 3.49 Tenant", tier: "PRO" });
  const operator = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Step 3.49 Operator",
    tier: "PRO"
  });
  const provider = await client.createProvider({
    providerType: "hetzner_robot",
    apiSecret: "robot-reference-only-never-leak",
    regions: ["fsn1"],
    countries: ["DE"],
    billingHealth: { status: "healthy" },
    testConnection: { mode: "mock", status: "passed" }
  });
  const approval = await client.createProvisioningApproval({
    operatorId: operator.operator.id,
    reasonCode: "step3_49_dedicated_workload_order",
    evidenceRefs: ["release://step3-49/hetzner-robot-dedicated-workload"]
  });
  const approved = await client.updateProvisioningApprovalStatus(approval.approval.id, {
    status: "approved_for_execution",
    evidenceRefs: ["release://step3-49/hetzner-robot-dedicated-workload"],
    note: "Approved for dedicated workload order gate test"
  });
  return { operator: operator.operator, provider: provider.provider, approval: approved.approval };
}

test("Step 3.49 exposes Hetzner Robot as a dedicated KVM workload provider without plaintext leakage", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { provider } = await createRobotBaseline(client);

    assert.equal(provider.providerKey, "hetzner_robot");
    assert.equal(provider.runtimeCapabilities.bareMetalKvm, true);
    assert.equal(provider.runtimeCapabilities.firecracker, true);
    assert.equal(provider.runtimeCapabilities.androidWorkloads, "bare_metal_kvm_binderfs_gate_required");
    assert.equal(JSON.stringify(provider).includes("robot-reference-only-never-leak"), false);
  } finally {
    await close();
  }
});

test("Step 3.49 blocks paid dedicated workload ordering without all human and env gates", async () => {
  const env = {
    SYLION_PROVIDER_MODE: "live",
    SYLION_LIVE_ALLOWED: "true",
    SYLION_LIVE_ALLOWLIST_OPERATORS: "*",
    SYLION_LIVE_ALLOWED_REGIONS: "fsn1",
    SYLION_HETZNER_ROBOT_ALLOWED_PRODUCTS: "AX102",
    SYLION_HETZNER_ROBOT_MAX_MONTHLY_EUR: "120"
  };
  const { baseUrl, close } = await startTestServer({ env });
  try {
    const client = await loginClient(baseUrl);
    const { operator, provider, approval } = await createRobotBaseline(client);

    const result = await client.createHetznerRobotDedicatedWorkloadOrder({
      providerId: provider.id,
      operatorId: operator.id,
      approvalId: approval.id,
      productId: "AX102",
      region: "fsn1",
      orderMode: "live_order",
      maxMonthlyPrice: 100,
      liveConfirmed: true,
      costConfirmed: false,
      hardwareGateConfirmed: true
    });

    assert.equal(result.order.status, "blocked_human_gate");
    assert.equal(result.order.sideEffectAllowed, false);
    assert.ok(result.order.gate.blockers.includes("cost_confirmation_missing"));
    assert.ok(result.order.gate.blockers.includes("hetzner_robot_credentials_missing"));
    assert.ok(result.order.gate.blockers.includes("hetzner_robot_ordering_disabled"));
    assert.ok(result.order.gate.blockers.includes("paid_dedicated_order_env_gate_disabled"));
    assert.equal(JSON.stringify(result).includes("robot-reference-only-never-leak"), false);
  } finally {
    await close();
  }
});

test("Step 3.49 allows a plan-only dedicated workload order after confirmations without Robot mutation", async () => {
  const calls = [];
  const env = {
    SYLION_LIVE_ALLOWLIST_OPERATORS: "*",
    SYLION_LIVE_ALLOWED_REGIONS: "fsn1",
    SYLION_HETZNER_ROBOT_ALLOWED_PRODUCTS: "AX102",
    SYLION_HETZNER_ROBOT_MAX_MONTHLY_EUR: "120"
  };
  const { baseUrl, close } = await startTestServer({
    env,
    robotAdapterFactory: () => ({
      async orderDedicatedServer(input) {
        calls.push(input);
        return { providerResourceId: "should-not-be-called" };
      }
    })
  });
  try {
    const client = await loginClient(baseUrl);
    const { operator, provider, approval } = await createRobotBaseline(client);

    const result = await client.createHetznerRobotDedicatedWorkloadOrder({
      providerId: provider.id,
      operatorId: operator.id,
      approvalId: approval.id,
      productId: "AX102",
      region: "fsn1",
      orderMode: "plan_only",
      maxMonthlyPrice: 100,
      liveConfirmed: true,
      costConfirmed: true,
      hardwareGateConfirmed: true
    });

    assert.equal(result.order.status, "plan_ready_no_provider_mutation");
    assert.equal(result.order.sideEffectAllowed, false);
    assert.equal(calls.length, 0);
  } finally {
    await close();
  }
});

test("Step 3.49 Hetzner Robot adapter uses Basic auth and sanitizes order response", async () => {
  const calls = [];
  const adapter = new HetznerRobotAdapter({
    user: "robot-user",
    password: "robot-password-never-leak",
    transport: async (url, options = {}) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            transaction: {
              transaction_id: 491,
              product_id: "AX102",
              location: "fsn1",
              status: "ordered"
            }
          };
        }
      };
    }
  });

  const result = await adapter.orderDedicatedServer({
    productId: "AX102",
    location: "fsn1",
    authorizedKey: "ssh-key-ref",
    test: true
  });

  assert.equal(result.providerResourceId, "491");
  assert.equal(result.productId, "AX102");
  assert.equal(result.robotCredentialsLogged, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "POST");
  assert.match(calls[0].options.headers.authorization, /^Basic /);
  assert.equal(JSON.stringify({ result, calls }).includes("robot-password-never-leak"), false);
});
