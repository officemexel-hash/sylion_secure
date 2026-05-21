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
    correlationIdFactory: () => `corr_step3_13_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-13-${crypto.randomUUID()}`;
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

test("Step 3.13 creates an operator provisioning draft automatically and local lab VPS set on demand", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const templates = await client.listOperatorProvisioningTemplates();
    assert.ok(templates.templates.some((template) => template.key === "signal"));
    assert.ok(templates.templates.every((template) => template.cdrRequired === true));

    const tenant = await client.createTenant({ name: "Pipeline Tenant", tier: "PRO" });
    const created = await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Pipeline Operator",
      tier: "PRO",
      requestedTemplates: ["whatsapp", "signal", "telegram"]
    });

    assert.equal(created.provisioningDraft.autoCreated, true);
    assert.equal(created.provisioningDraft.status, "draft_ready");
    assert.equal(created.provisioningDraft.baseline.vps.length, 3);
    assert.equal(created.provisioningDraft.workloads.length, 3);
    assert.ok(created.provisioningDraft.workloads.every((workload) => workload.isolation === "firecracker_microvm"));
    assert.ok(created.provisioningDraft.workloads.every((workload) => workload.secretsReleaseAllowed === false));

    const lab = await client.createLocalLabVpsSet(created.provisioningDraft.id);
    assert.equal(lab.pipeline.status, "local_lab_ready");
    assert.equal(lab.pipeline.localLab.vps.length, 3);
    assert.deepEqual(lab.pipeline.localLab.vps.map((vps) => vps.role), ["G1", "G2", "WORKLOAD"]);
    assert.equal(lab.pipeline.firecrackerPlan.workloads.length, 3);
    assert.ok(lab.pipeline.firecrackerPlan.workloads.every((workload) => workload.status === "planned"));

    const secrets = await client.checkPipelineSecretsRelease(lab.pipeline.id);
    assert.equal(secrets.check.allowed, false);
    assert.ok(secrets.check.blockers.includes("production_secret_release_not_enabled_in_local_lab"));
    assert.ok(app.services.audit.list().some((event) => event.action === "operator_provisioning.local_lab_vps_created"));
  } finally {
    await close();
  }
});

test("Step 3.13 blocks pipeline drafts above subscription workload limits", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const tenant = await client.createTenant({ name: "Limit Tenant", tier: "STANDARD" });
    const created = await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Limit Operator",
      tier: "STANDARD",
      requestedTemplates: ["whatsapp", "signal", "telegram", "threema"]
    });

    assert.equal(created.provisioningDraft.status, "blocked_draft");
    assert.ok(created.provisioningDraft.blockers.includes("subscription_workload_limit_exceeded"));
    assert.equal(created.provisioningDraft.productionExecutionAllowed, false);
  } finally {
    await close();
  }
});
