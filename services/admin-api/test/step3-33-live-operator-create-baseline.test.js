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
    correlationIdFactory: () => `corr_step3_33_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-33-${crypto.randomUUID()}`;
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

async function completeStepUp(client, credentialId) {
  const options = await client.createStepUpOptions();
  await client.verifyStepUp({
    challengeId: options.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${options.challenge.id}:${credentialId}`,
      signCounter: Date.now()
    }
  });
}

test("Step 3.33 live operator creation records blockers without provider mutation when live confirmation is missing", async () => {
  const providerCalls = [];
  const { baseUrl, close } = await startTestServer();
  try {
    const { client } = await loginClient(baseUrl);
    const tenant = await client.createTenant({ name: "Step 3.33 Blocked Tenant", tier: "PRO" });
    const provider = await client.createProvider({
      providerType: "hetzner",
      apiSecret: "test-secret-never-leak-step3-33-blocked",
      regions: ["fsn1"],
      billingHealth: { status: "healthy" },
      testConnection: { mode: "live_contract_test", status: "passed" }
    });

    const blocked = await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Step 3.33 Blocked Operator",
      tier: "PRO",
      liveBaseline: {
        enabled: true,
        providerKey: "hetzner",
        providerId: provider.provider.id,
        region: "fsn1",
        idempotencyKey: "step3-33-blocked",
        liveConfirmed: false
      }
    });
    assert.equal(blocked.liveBaseline.request.status, "blocked_human_gate");
    assert.ok(blocked.liveBaseline.request.gate.blockers.includes("provider_mode_not_live"));
    assert.ok(blocked.liveBaseline.request.gate.blockers.includes("live_confirmation_missing"));
    assert.equal(blocked.liveBaseline.request.sideEffectAllowed, false);
    assert.equal(providerCalls.length, 0);
  } finally {
    await close();
  }
});

test("Step 3.33 operator creation can create a gated live G1/G2/WORKLOAD baseline in one admin flow", async () => {
  const providerCalls = [];
  const env = {
    SYLION_PROVIDER_MODE: "live",
    SYLION_LIVE_ALLOWED: "true",
    HETZNER_API_TOKEN: "test-token-only-in-env-step3-33",
    SYLION_LIVE_ALLOWLIST_OPERATORS: "*",
    SYLION_LIVE_ALLOWED_REGIONS: "fsn1",
    SYLION_LIVE_MAX_SERVERS: "3"
  };
  const { app, baseUrl, close } = await startTestServer({
    env,
    adapterFactory: () => ({
      async createVpsSet(input) {
        providerCalls.push(input);
        return [
          { role: "G1", providerResourceId: "hcloud-step333-g1", name: "sylion-step333-g1", location: input.region },
          { role: "G2", providerResourceId: "hcloud-step333-g2", name: "sylion-step333-g2", location: input.region },
          { role: "WORKLOAD", providerResourceId: "hcloud-step333-workload", name: "sylion-step333-workload", location: input.region }
        ];
      }
    })
  });
  try {
    const { client, credentialId } = await loginClient(baseUrl);
    const tenant = await client.createTenant({ name: "Step 3.33 Live Tenant", tier: "PRO" });
    const provider = await client.createProvider({
      providerType: "hetzner",
      apiSecret: "test-secret-never-leak-step3-33-live",
      regions: ["fsn1"],
      billingHealth: { status: "healthy" },
      testConnection: { mode: "live_contract_test", status: "passed" }
    });
    await completeStepUp(client, credentialId);

    const created = await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Step 3.33 Live Operator",
      tier: "PRO",
      requestedTemplates: ["whatsapp", "signal", "telegram"],
      liveBaseline: {
        enabled: true,
        providerKey: "hetzner",
        providerId: provider.provider.id,
        region: "fsn1",
        serverType: "cx22",
        image: "ubuntu-24.04",
        idempotencyKey: "step3-33-live-create",
        liveConfirmed: true,
        evidenceRefs: ["test://step3-33/live-create"]
      }
    });

    assert.equal(created.liveBaseline.mode, "operator_create_live_baseline");
    assert.equal(created.liveBaseline.request.status, "executed_provider_mutation");
    assert.equal(created.liveBaseline.request.resources.length, 3);
    assert.deepEqual(created.liveBaseline.request.resources.map((resource) => resource.role), ["G1", "G2", "WORKLOAD"]);
    assert.equal(created.liveBaseline.request.rollbackReady, true);
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].operatorId, created.operator.id);
    assert.equal(providerCalls[0].region, "fsn1");
    assert.match(providerCalls[0].userDataByRole.G2, /server_name signal\.sylion\.internal/);
    assert.match(providerCalls[0].userDataByRole.G2, /X-Sylion-Terminal-Data-Stored/);
    assert.match(providerCalls[0].userDataByRole.G2, /X-Sylion-CDR-Required/);
    assert.match(providerCalls[0].userDataByRole.G2, /\/etc\/nginx\/snippets\/sylion-signal-auth\.conf/);
    assert.doesNotMatch(providerCalls[0].userDataByRole.G2, /sylion-signal-local|a2FzbV91c2Vy/);
    assert.match(providerCalls[0].userDataByRole.WORKLOAD, /sylion-start-workloads\.sh/);
    assert.match(providerCalls[0].userDataByRole.WORKLOAD, /openssl rand -base64 24/);
    assert.match(providerCalls[0].userDataByRole.WORKLOAD, /10\\\.42\\\./);
    assert.doesNotMatch(providerCalls[0].userDataByRole.WORKLOAD, /sylion-signal-local|a2FzbV91c2Vy/);
    assert.equal(created.liveBaseline.artifacts.g2WorkloadGateway.included, true);
    assert.equal(created.liveBaseline.artifacts.g2WorkloadGateway.bindAddress, "10.42.0.12");
    assert.equal(created.liveBaseline.artifacts.workloadContainers.included, true);
    assert.equal(created.liveBaseline.artifacts.workloadContainers.signalPasswordMode, "generated_on_workload_root_only");
    assert.ok(created.liveBaseline.artifacts.g2WorkloadGateway.hostnames.includes("zangi.sylion.internal"));
    assert.equal(JSON.stringify(created).includes("test-token-only-in-env-step3-33"), false);
    assert.equal(JSON.stringify(created).includes("test-secret-never-leak-step3-33-live"), false);
    assert.ok(app.services.audit.list().some((event) => event.action === "live_cloud.vps_set_created"));
  } finally {
    await close();
  }
});
