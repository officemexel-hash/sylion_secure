import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

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

async function request(
  baseUrl,
  path,
  { method = "GET", token, body, correlationId = "corr_step3_7" } = {}
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": correlationId,
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function login(baseUrl, email = "admin@sylion.local", password = "ChangeMe-LocalOnly-1!") {
  const result = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email, password, fido2Verified: true }
  });
  assert.equal(result.status, 200);
  return result.payload.session.token;
}

async function createTenantOperatorAndApp(baseUrl, token, { tier = "PRO" } = {}) {
  const tenant = await request(baseUrl, "/tenants", {
    method: "POST",
    token,
    body: { name: `Step 3.7 Tenant ${Date.now()}`, tier }
  });
  assert.equal(tenant.status, 201);
  const operator = await request(baseUrl, "/operators", {
    method: "POST",
    token,
    body: {
      tenantId: tenant.payload.tenant.id,
      displayName: `Step 3.7 Operator ${Date.now()}`,
      tier
    }
  });
  assert.equal(operator.status, 201);
  const app = await request(baseUrl, "/apps", {
    method: "POST",
    token,
    body: {
      name: `Signal Step 3.7 ${Date.now()}`,
      type: "messaging",
      riskClass: "medium",
      allowedTiers: ["STANDARD", "PRO", "SOVEREIGN"],
      microVmDefaults: { vcpu: 2, memoryMiB: 2048, diskMiB: 8192 },
      networkPolicy: { outbound: ["tcp/443"], inbound: [] },
      storagePolicy: { persistent: false, maxEphemeralMiB: 1024 },
      clipboardPolicy: { mode: "metadata_only", pasteIntoWorkload: false },
      cdrRequired: true,
      operatorResponsibility: "Operator must route all file exchange through CDR."
    }
  });
  assert.equal(app.status, 201);
  const approved = await request(baseUrl, `/apps/${app.payload.app.id}/approve`, {
    method: "POST",
    token
  });
  assert.equal(approved.status, 200);
  return {
    tenant: tenant.payload.tenant,
    operator: operator.payload.operator,
    app: approved.payload.app
  };
}

test("Step 3.7 subscription plans and tenant ledger are initialized and guarded", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const readonlyToken = await login(baseUrl, "readonly@sylion.local", "ReadOnly-LocalOnly-1!");
    const plans = await request(baseUrl, "/subscription/plans", { token });
    assert.equal(plans.status, 200);
    assert.equal(plans.payload.plans.length, 5);
    assert.ok(plans.payload.plans.every((plan) => plan.cdrMandatory === true));
    assert.ok(plans.payload.plans.every((plan) => plan.phantomExecutionAllowed === false));

    const rejectedPlan = await request(baseUrl, "/subscription/plans", {
      method: "POST",
      token,
      body: {
        tier: "PRO",
        name: "Unsafe Plan",
        maxWorkloadEnvironments: 10,
        maxAppsPerOperator: 5,
        regionCount: 5,
        jurisdictionRotationMode: "scheduled",
        cdrMandatory: false
      }
    });
    assert.equal(rejectedPlan.status, 422);

    const deniedPlan = await request(baseUrl, "/subscription/plans", {
      method: "POST",
      token: readonlyToken,
      body: {
        tier: "PRO",
        name: "Readonly Plan",
        maxWorkloadEnvironments: 10,
        maxAppsPerOperator: 5,
        regionCount: 5,
        jurisdictionRotationMode: "scheduled",
        cdrMandatory: true
      }
    });
    assert.equal(deniedPlan.status, 403);

    const { tenant } = await createTenantOperatorAndApp(baseUrl, token, { tier: "STANDARD" });
    const subscription = await request(baseUrl, `/tenants/${tenant.id}/subscription`, { token });
    assert.equal(subscription.status, 200);
    assert.equal(subscription.payload.subscription.tier, "STANDARD");
    assert.equal(subscription.payload.subscription.effectiveLimits.maxWorkloadEnvironments, 10);
    assert.equal(subscription.payload.subscription.effectiveLimits.phantomExecutionAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.7 workload allocation quote, allocation and placement are quota controlled", async () => {
  const { app: testApp, baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const { operator, app } = await createTenantOperatorAndApp(baseUrl, token, {
      tier: "STANDARD"
    });

    const quote = await request(baseUrl, `/operators/${operator.id}/workload-allocations/quote`, {
      method: "POST",
      token,
      body: { appId: app.id, requestedCount: 2 }
    });
    assert.equal(quote.status, 201);
    assert.equal(quote.payload.decision.decision, "allow");
    assert.equal(quote.payload.decision.sideEffectAllowed, false);

    const beforeAllocation = await request(
      baseUrl,
      `/operators/${operator.id}/workload-allocations`,
      { token }
    );
    assert.equal(beforeAllocation.payload.allocations.length, 0);

    const allocation = await request(baseUrl, `/operators/${operator.id}/workload-allocations`, {
      method: "POST",
      token,
      body: { appId: app.id, requestedCount: 2 }
    });
    assert.equal(allocation.status, 201);
    assert.equal(allocation.payload.allocation.count, 2);
    assert.equal(allocation.payload.allocation.cdrRequired, true);
    assert.equal(allocation.payload.allocation.targetLayer, "WORKLOAD");
    assert.equal(allocation.payload.allocation.executionPlanned, false);

    const placement = await request(baseUrl, `/operators/${operator.id}/microvm-placement-plan`, {
      method: "POST",
      token,
      body: { allocationId: allocation.payload.allocation.id }
    });
    assert.equal(placement.status, 201);
    assert.equal(placement.payload.placementPlan.targetLayer, "WORKLOAD");
    assert.equal(placement.payload.placementPlan.placement.vpsPerOperator, 3);
    assert.equal(placement.payload.placementPlan.placement.shared, false);
    assert.equal(placement.payload.placementPlan.sideEffectAllowed, false);

    const denied = await request(baseUrl, `/operators/${operator.id}/workload-allocations`, {
      method: "POST",
      token,
      body: { appId: app.id, requestedCount: 9 }
    });
    assert.equal(denied.status, 422);
    assert.ok(denied.payload.error.details.blockers.includes("max_workload_environments_exceeded"));

    const afterDenied = await request(baseUrl, `/operators/${operator.id}/workload-allocations`, {
      token
    });
    assert.equal(afterDenied.payload.allocations.length, 1);

    const audit = testApp.services.audit.list();
    assert.equal(JSON.stringify(audit).includes("Provider API secret"), false);
    assert.ok(audit.some((event) => event.action === "subscription.quota_decision"));
    assert.ok(audit.some((event) => event.action === "workload_allocation.created"));
  } finally {
    await close();
  }
});

test("Step 3.7 add-ons gate Matrix and keep PHANTOM non-executable", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const { tenant, operator } = await createTenantOperatorAndApp(baseUrl, token, { tier: "PRO" });

    const blockedMatrix = await request(baseUrl, "/matrix/servers", {
      method: "POST",
      token,
      body: {
        tenantId: tenant.id,
        operatorId: operator.id,
        tier: "PRO",
        mode: "dedicated_operator",
        provider: "hetzner",
        region: "fsn1"
      }
    });
    assert.equal(blockedMatrix.status, 422);

    const addons = await request(baseUrl, `/tenants/${tenant.id}/subscription/addons`, {
      method: "POST",
      token,
      body: { addons: ["matrix_custom_server", "phantom_admin_lifecycle"] }
    });
    assert.equal(addons.status, 200);
    assert.deepEqual(
      addons.payload.subscription.addons.sort(),
      ["matrix_custom_server", "phantom_admin_lifecycle"].sort()
    );
    assert.equal(addons.payload.subscription.effectiveLimits.phantomExecutionAllowed, false);

    const matrix = await request(baseUrl, "/matrix/servers", {
      method: "POST",
      token,
      body: {
        tenantId: tenant.id,
        operatorId: operator.id,
        tier: "PRO",
        mode: "dedicated_operator",
        provider: "hetzner",
        region: "fsn1"
      }
    });
    assert.equal(matrix.status, 201);

    const phantomBoundary = await request(baseUrl, "/phantom/boundary", { token });
    assert.equal(phantomBoundary.status, 200);
    assert.equal(phantomBoundary.payload.boundary.executionEnabled, false);
    assert.equal(phantomBoundary.payload.boundary.sideEffectAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.7 billing suspension blocks new allocation and provisioning without deleting evidence", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const { tenant, operator, app } = await createTenantOperatorAndApp(baseUrl, token, {
      tier: "PRO"
    });
    const suspended = await request(baseUrl, `/tenants/${tenant.id}/billing-state`, {
      method: "POST",
      token,
      body: { billingStatus: "suspended" }
    });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.payload.subscription.suspensionState, "allocation_blocked");
    assert.equal(suspended.payload.subscription.destructiveCleanupAllowed, false);

    const allocation = await request(baseUrl, `/operators/${operator.id}/workload-allocations`, {
      method: "POST",
      token,
      body: { appId: app.id, requestedCount: 1 }
    });
    assert.equal(allocation.status, 422);
    assert.ok(
      allocation.payload.error.details.blockers.includes("billing_state_blocks_new_allocation")
    );

    const provisioning = await request(baseUrl, `/operators/${operator.id}/provisioning-plan`, {
      method: "POST",
      token,
      body: { requestedApps: ["Signal"] }
    });
    assert.equal(provisioning.status, 422);

    const audit = await request(baseUrl, "/audit/events", { token });
    assert.equal(audit.status, 200);
    assert.ok(
      audit.payload.events.some((event) => event.action === "subscription.billing_state_changed")
    );
  } finally {
    await close();
  }
});
