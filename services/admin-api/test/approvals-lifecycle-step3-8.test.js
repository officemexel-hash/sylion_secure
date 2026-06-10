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
  { method = "GET", token, body, correlationId = "corr_step3_8" } = {}
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
  return { status: response.status, payload: await response.json() };
}

async function login(baseUrl) {
  const credentialId = `cred-step3-8-${Date.now()}`;
  const enrollOptions = await request(baseUrl, "/auth/webauthn/enrollment/options", {
    method: "POST",
    body: { email: "admin@sylion.local", password: "ChangeMe-LocalOnly-1!" }
  });
  assert.equal(enrollOptions.status, 201);
  const enrolled = await request(baseUrl, "/auth/webauthn/enrollment/verify", {
    method: "POST",
    body: {
      challengeId: enrollOptions.payload.challenge.id,
      credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
    }
  });
  assert.equal(enrolled.status, 201);
  const loginOptions = await request(baseUrl, "/auth/webauthn/login/options", {
    method: "POST",
    body: { email: "admin@sylion.local", password: "ChangeMe-LocalOnly-1!" }
  });
  assert.equal(loginOptions.status, 201);
  const result = await request(baseUrl, "/auth/webauthn/login/verify", {
    method: "POST",
    body: {
      challengeId: loginOptions.payload.challenge.id,
      credentialId,
      assertion: {
        signature: `simulated:${loginOptions.payload.challenge.id}:${credentialId}`,
        signCounter: 1
      }
    }
  });
  assert.equal(result.status, 200);
  return result.payload.session.token;
}

async function fixture(baseUrl, token) {
  const suffix = Date.now();
  const tenant = await request(baseUrl, "/tenants", {
    method: "POST",
    token,
    body: { name: `Step 3.8 Tenant ${suffix}`, tier: "PRO" }
  });
  assert.equal(tenant.status, 201);
  const operator = await request(baseUrl, "/operators", {
    method: "POST",
    token,
    body: {
      tenantId: tenant.payload.tenant.id,
      displayName: `Step 3.8 Operator ${suffix}`,
      tier: "PRO"
    }
  });
  assert.equal(operator.status, 201);
  const provider = await request(baseUrl, "/providers", {
    method: "POST",
    token,
    body: {
      providerType: "hetzner",
      apiSecret: "test-secret",
      regions: ["fsn1"],
      billingHealth: { status: "healthy" },
      testConnection: { mode: "mock", status: "passed" }
    }
  });
  assert.equal(provider.status, 201);
  for (const [type, model] of [
    ["pixel_grapheneos", "Google Pixel"],
    ["puli_ax_router", "GL.iNet GL-XE3000 Puli AX"],
    ["fido2_key", "YubiKey"]
  ]) {
    const device = await request(baseUrl, "/devices", {
      method: "POST",
      token,
      body: {
        type,
        serial: `${type}-${suffix}`,
        model,
        assignedOperatorId: operator.payload.operator.id
      }
    });
    assert.equal(device.status, 201);
  }
  const app = await request(baseUrl, "/apps", {
    method: "POST",
    token,
    body: {
      name: `Signal Step 3.8 ${suffix}`,
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
  const allocation = await request(
    baseUrl,
    `/operators/${operator.payload.operator.id}/workload-allocations`,
    {
      method: "POST",
      token,
      body: { appId: approved.payload.app.id, requestedCount: 1 }
    }
  );
  assert.equal(allocation.status, 201);
  const plan = await request(
    baseUrl,
    `/operators/${operator.payload.operator.id}/provisioning-plan`,
    {
      method: "POST",
      token,
      body: { requestedApps: ["Signal"] }
    }
  );
  assert.equal(plan.status, 201);
  return {
    tenant: tenant.payload.tenant,
    operator: operator.payload.operator,
    app: approved.payload.app,
    allocation: allocation.payload.allocation,
    plan: plan.payload.plan
  };
}

test("Step 3.8 evaluates Księga 3.4 operator readiness and records blockers without side effects", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const emptyTenant = await request(baseUrl, "/tenants", {
      method: "POST",
      token,
      body: { name: "Readiness Blocked Tenant", tier: "PRO" }
    });
    const emptyOperator = await request(baseUrl, "/operators", {
      method: "POST",
      token,
      body: {
        tenantId: emptyTenant.payload.tenant.id,
        displayName: "Blocked Operator",
        tier: "PRO"
      }
    });
    const blocked = await request(
      baseUrl,
      `/operators/${emptyOperator.payload.operator.id}/readiness`,
      { token }
    );
    assert.equal(blocked.status, 200);
    assert.equal(blocked.payload.readiness.readyForApproval, false);
    assert.ok(blocked.payload.readiness.blockers.includes("pixel_grapheneos_device_required"));
    assert.ok(blocked.payload.readiness.blockers.includes("provider_reference_required"));
    assert.equal(blocked.payload.readiness.sideEffectAllowed, false);

    const { operator } = await fixture(baseUrl, token);
    const ready = await request(baseUrl, `/operators/${operator.id}/readiness`, { token });
    assert.equal(ready.status, 200);
    assert.equal(ready.payload.readiness.readyForApproval, true);
    assert.equal(ready.payload.readiness.subscription.cdrMandatory, true);
    assert.equal(ready.payload.readiness.subscription.phantomExecutionAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.8 approval gate protects orchestrator strict execution path", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const { operator, plan } = await fixture(baseUrl, token);

    const blocked = await request(baseUrl, "/orchestrator/jobs", {
      method: "POST",
      token,
      body: {
        planId: plan.id,
        provider: "hetzner",
        region: "fsn1",
        imageRef: "image://sylion/base/dev",
        approvalRequired: true
      }
    });
    assert.equal(blocked.status, 422);
    assert.equal(blocked.payload.error.details.approvalRequired, true);

    const approval = await request(baseUrl, "/provisioning/approvals", {
      method: "POST",
      token,
      body: {
        operatorId: operator.id,
        planId: plan.id,
        evidenceRefs: ["readiness-check", "security-review"]
      }
    });
    assert.equal(approval.status, 201);
    assert.equal(approval.payload.approval.executionAllowed, false);

    const stillBlocked = await request(baseUrl, "/orchestrator/jobs", {
      method: "POST",
      token,
      body: {
        planId: plan.id,
        provider: "hetzner",
        region: "fsn1",
        imageRef: "image://sylion/base/dev",
        approvalRequired: true,
        approvalId: approval.payload.approval.id
      }
    });
    assert.equal(stillBlocked.status, 422);

    const approved = await request(
      baseUrl,
      `/provisioning/approvals/${approval.payload.approval.id}/status`,
      {
        method: "POST",
        token,
        body: { status: "approved_for_execution", note: "Human gate complete" }
      }
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.payload.approval.executionAllowed, true);

    assert.ok(
      app.services.audit
        .list()
        .some((event) => event.action === "provisioning.approval_status_changed")
    );
  } finally {
    await close();
  }
});

test("Step 3.8 workload lifecycle enforces valid transitions and remains metadata-only", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const { operator, allocation } = await fixture(baseUrl, token);

    const invalid = await request(baseUrl, `/workload/allocations/${allocation.id}/lifecycle`, {
      method: "POST",
      token,
      body: { status: "active", reasonCode: "skip_gate" }
    });
    assert.equal(invalid.status, 422);

    const approvalRequired = await request(
      baseUrl,
      `/workload/allocations/${allocation.id}/lifecycle`,
      {
        method: "POST",
        token,
        body: { status: "approval_required", reasonCode: "review_start" }
      }
    );
    assert.equal(approvalRequired.status, 200);
    assert.equal(approvalRequired.payload.lifecycle.sideEffectAllowed, false);
    assert.equal(approvalRequired.payload.lifecycle.executionAllowed, false);

    const approval = await request(baseUrl, "/provisioning/approvals", {
      method: "POST",
      token,
      body: {
        operatorId: operator.id,
        allocationId: allocation.id,
        evidenceRefs: ["activation-readiness", "human-gate-complete"]
      }
    });
    assert.equal(approval.status, 201);
    const approved = await request(
      baseUrl,
      `/provisioning/approvals/${approval.payload.approval.id}/status`,
      {
        method: "POST",
        token,
        body: { status: "approved_for_execution", note: "Activation human gate complete" }
      }
    );
    assert.equal(approved.status, 200);

    const activationApproved = await request(
      baseUrl,
      `/workload/allocations/${allocation.id}/lifecycle`,
      {
        method: "POST",
        token,
        body: {
          status: "approved_for_activation",
          approvalId: approval.payload.approval.id,
          reasonCode: "human_gate_complete"
        }
      }
    );
    assert.equal(activationApproved.status, 200);
    assert.equal(activationApproved.payload.lifecycle.humanGateRequired, true);
    assert.equal(activationApproved.payload.lifecycle.approvalId, approval.payload.approval.id);

    const list = await request(baseUrl, "/workload/lifecycle", { token });
    assert.equal(list.status, 200);
    assert.ok(list.payload.lifecycle.some((item) => item.allocationId === allocation.id));
  } finally {
    await close();
  }
});
