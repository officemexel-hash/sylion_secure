import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { DEVICE_TYPES, TIERS } from "../src/domain/constants.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";
import { SqliteStore } from "../src/storage/sqliteStore.js";

async function startPersistentServer(dbPath) {
  const store = new SqliteStore({ path: dbPath });
  const app = createApp({ store });
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => {
      app.close();
      resolve();
    }))
  };
}

async function loginClient(baseUrl) {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => "corr_persistence_sdk"
  });
  const credentialId = "cred-persistence-sdk";
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

test("V2 persistence foundation keeps admin flow data after restart and SDK can drive the API", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sylion-admin-api-"));
  const dbPath = join(dir, "admin-api.sqlite");

  let first = await startPersistentServer(dbPath);
  let tenantId;
  let operatorId;
  let planId;
  try {
    const client = await loginClient(first.baseUrl);
    const tenant = await client.createTenant({ name: "Persistent Tenant", tier: TIERS.PRO });
    tenantId = tenant.tenant.id;
    const operator = await client.createOperator({
      tenantId,
      displayName: "Persistent Operator",
      tier: TIERS.PRO
    });
    operatorId = operator.operator.id;
    await client.createProvider({
      providerType: "hetzner",
      apiSecret: "persistent-provider-secret-never-leak",
      regions: ["fsn1"],
      billingHealth: { status: "healthy" },
      testConnection: { mode: "mock", status: "passed" }
    });
    const pixel = await client.registerDevice({
      type: DEVICE_TYPES.PIXEL,
      serial: "pixel-persistent-001",
      model: "Google Pixel",
      assignedOperatorId: operatorId
    });
    const router = await client.registerDevice({
      type: DEVICE_TYPES.ROUTER,
      serial: "puli-persistent-001",
      model: "GL.iNet GL-XE3000 Puli AX",
      assignedOperatorId: operatorId
    });
    const plan = await client.createProvisioningPlan(operatorId, {
      requestedApps: ["Signal", "Telegram"]
    });
    planId = plan.plan.id;
    const job = await client.executeJob({
      planId,
      provider: "hetzner",
      region: "fsn1",
      imageRef: "image://sylion/base/dev",
      pixelDeviceId: pixel.device.id,
      routerDeviceId: router.device.id,
      idempotencyKey: "idem-persistence-sdk-001"
    });
    assert.equal(job.job.status, "completed");
  } finally {
    await first.close();
  }

  const second = await startPersistentServer(dbPath);
  try {
    const client = await loginClient(second.baseUrl);
    const tenants = await client.request("/tenants");
    assert.ok(tenants.tenants.some((tenant) => tenant.id === tenantId));

    const operators = await client.request(`/operators?tenantId=${tenantId}`);
    assert.ok(operators.operators.some((operator) => operator.id === operatorId));

    const plans = await client.request(`/operators/${operatorId}/provisioning-plan`);
    assert.ok(plans.plans.some((plan) => plan.id === planId));

    const providers = await client.request("/providers");
    assert.equal(JSON.stringify(providers).includes("persistent-provider-secret-never-leak"), false);
    assert.equal(providers.providers.length, 1);

    const devices = await client.request(`/devices?operatorId=${operatorId}`);
    assert.equal(devices.devices.length, 2);

    const jobs = await client.request(`/orchestrator/jobs?operatorId=${operatorId}`);
    assert.equal(jobs.jobs.length, 1);
    assert.equal(jobs.jobs[0].status, "completed");

    const audit = await client.listAuditEvents();
    assert.ok(audit.events.length > 0);
    assert.ok(audit.events.every((event) => event.hash));
    assert.equal(JSON.stringify(audit).includes("persistent-provider-secret-never-leak"), false);
  } finally {
    await second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
