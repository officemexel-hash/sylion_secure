import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { TIERS } from "../src/domain/constants.js";

async function startTestServer() {
  const app = createApp();
  const server = await app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    app,
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function request(baseUrl, path, { method = "GET", token, body, correlationId = "corr_test" } = {}) {
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

test("human spine flow: login, create tenant, create operator, generate provisioning plan, inspect audit", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const login = await request(baseUrl, "/auth/login", {
      method: "POST",
      body: {
        email: "admin@sylion.local",
        password: "ChangeMe-LocalOnly-1!",
        fido2Verified: true
      }
    });
    assert.equal(login.status, 200);
    const token = login.payload.session.token;

    const tenantResult = await request(baseUrl, "/tenants", {
      method: "POST",
      token,
      body: { name: "Acme Secure Ops", tier: TIERS.STANDARD }
    });
    assert.equal(tenantResult.status, 201);
    assert.equal(tenantResult.payload.tenant.tier, TIERS.STANDARD);

    const operatorResult = await request(baseUrl, "/operators", {
      method: "POST",
      token,
      body: {
        tenantId: tenantResult.payload.tenant.id,
        displayName: "Operator One",
        tier: TIERS.STANDARD
      }
    });
    assert.equal(operatorResult.status, 201);
    assert.equal(operatorResult.payload.operator.baseline.vpsPerOperator, 3);
    assert.equal(operatorResult.payload.operator.baseline.cdrMandatory, true);

    const planResult = await request(baseUrl, `/operators/${operatorResult.payload.operator.id}/provisioning-plan`, {
      method: "POST",
      token,
      body: {
        requestedApps: ["WhatsApp", "Signal", "Telegram"],
        jurisdictionPolicy: { mode: "limited_manual", regions: ["eu-central"] }
      }
    });
    assert.equal(planResult.status, 201);
    const plan = planResult.payload.plan;
    assert.equal(plan.baseline.vps.length, 3);
    assert.deepEqual(plan.baseline.vps.map((vps) => vps.role), ["G1", "G2", "WORKLOAD"]);
    assert.ok(plan.baseline.vps.every((vps) => vps.shared === false));
    assert.equal(plan.baseline.router.model, "GL.iNet GL-XE3000 Puli AX");
    assert.equal(plan.baseline.cdr.mandatory, true);
    assert.equal(plan.workloads.length, 3);
    assert.ok(plan.workloads.every((workload) => workload.isolation === "firecracker_microvm"));
    assert.equal(plan.humanGates[0].code, "puli_ax_production_qualification");

    const audit = await request(baseUrl, "/audit/events", { token });
    assert.equal(audit.status, 200);
    const actions = audit.payload.events.map((event) => event.action);
    assert.ok(actions.includes("auth.login_success"));
    assert.ok(actions.includes("tenant.created"));
    assert.ok(actions.includes("operator.created"));
    assert.ok(actions.includes("provisioning_plan.generated"));
    assert.ok(audit.payload.events.every((event) => event.correlationId));
    assert.ok(audit.payload.events.every((event) => event.hash));
  } finally {
    await close();
  }
});

test("entitlements block workload count above STANDARD limit", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const login = await request(baseUrl, "/auth/login", {
      method: "POST",
      body: {
        email: "admin@sylion.local",
        password: "ChangeMe-LocalOnly-1!",
        fido2Verified: true
      }
    });
    const token = login.payload.session.token;
    const tenant = await request(baseUrl, "/tenants", {
      method: "POST",
      token,
      body: { name: "Limit Test Tenant", tier: TIERS.STANDARD }
    });
    const operator = await request(baseUrl, "/operators", {
      method: "POST",
      token,
      body: {
        tenantId: tenant.payload.tenant.id,
        displayName: "Operator Limit",
        tier: TIERS.STANDARD
      }
    });

    const plan = await request(baseUrl, `/operators/${operator.payload.operator.id}/provisioning-plan`, {
      method: "POST",
      token,
      body: {
        requestedApps: ["WhatsApp", "Signal", "Telegram", "Threema", "Zangi", "DuckDuckGo", "LibreOffice", "Exodus", "Matrix Client", "Matrix Server", "Signal 2"]
      }
    });

    assert.equal(plan.status, 422);
    assert.equal(plan.payload.error.code, "validation_error");
    assert.equal(plan.payload.error.details.maxWorkloadEnvironments, 10);
  } finally {
    await close();
  }
});

test("support readonly cannot create tenants", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const login = await request(baseUrl, "/auth/login", {
      method: "POST",
      body: {
        email: "readonly@sylion.local",
        password: "ReadOnly-LocalOnly-1!",
        fido2Verified: true
      }
    });
    assert.equal(login.status, 200);

    const denied = await request(baseUrl, "/tenants", {
      method: "POST",
      token: login.payload.session.token,
      body: { name: "Should Not Work", tier: TIERS.STANDARD }
    });

    assert.equal(denied.status, 403);
    assert.equal(denied.payload.error.code, "forbidden");
  } finally {
    await close();
  }
});
