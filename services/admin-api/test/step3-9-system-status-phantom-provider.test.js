import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { DEVICE_TYPES, TIERS } from "../src/domain/constants.js";

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

async function request(baseUrl, path, { method = "GET", token, body, correlationId = "corr_step3_9" } = {}) {
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
  const credentialId = `cred-step3-9-${Date.now()}`;
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

async function createOperatorProviderAndDevices(baseUrl, token) {
  const suffix = Date.now();
  const tenant = await request(baseUrl, "/tenants", {
    method: "POST",
    token,
    body: { name: `Step 3.9 Tenant ${suffix}`, tier: TIERS.PRO }
  });
  assert.equal(tenant.status, 201);
  const operator = await request(baseUrl, "/operators", {
    method: "POST",
    token,
    body: { tenantId: tenant.payload.tenant.id, displayName: `Step 3.9 Operator ${suffix}`, tier: TIERS.PRO }
  });
  assert.equal(operator.status, 201);
  const provider = await request(baseUrl, "/providers", {
    method: "POST",
    token,
    body: {
      providerType: "hetzner",
      apiSecret: "step-3-9-provider-secret-never-leak",
      regions: ["fsn1"],
      billingHealth: { status: "healthy" },
      testConnection: { mode: "mock", status: "passed" }
    }
  });
  assert.equal(provider.status, 201);
  for (const [type, model] of [
    [DEVICE_TYPES.PIXEL, "Google Pixel"],
    [DEVICE_TYPES.ROUTER, "GL.iNet GL-XE3000 Puli AX"],
    [DEVICE_TYPES.FIDO2, "YubiKey"]
  ]) {
    const device = await request(baseUrl, "/devices", {
      method: "POST",
      token,
      body: { type, serial: `${type}-step3-9-${suffix}`, model, assignedOperatorId: operator.payload.operator.id }
    });
    assert.equal(device.status, 201);
  }
  return { tenant: tenant.payload.tenant, operator: operator.payload.operator, provider: provider.payload.provider };
}

async function createPhantomPackage(baseUrl, token) {
  const capability = await request(baseUrl, "/phantom/capabilities", {
    method: "POST",
    token,
    body: {
      displayName: "Step 3.9 Governance Capability",
      riskLevel: "restricted",
      controlsRequired: ["Legal review", "CISO review", "Architect review", "Compliance review"]
    }
  });
  assert.equal(capability.status, 201);
  const templates = await request(baseUrl, "/phantom/policy-templates", { token });
  assert.equal(templates.status, 200);
  const pkg = await request(baseUrl, "/phantom/packages", {
    method: "POST",
    token,
    body: {
      name: "PHANTOM Step 3.9 Package",
      description: "Governance-only package for coverage testing",
      policyTemplateId: templates.payload.templates[0].id,
      capabilityIds: [capability.payload.capability.id],
      tierMinimum: "PRO"
    }
  });
  assert.equal(pkg.status, 201);
  return pkg.payload.package;
}

test("Step 3.9 persists readiness history and exposes Księga 3.4 / PHANTOM status", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const { operator } = await createOperatorProviderAndDevices(baseUrl, token);

    const readiness = await request(baseUrl, `/operators/${operator.id}/readiness`, { token });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.payload.readiness.readyForApproval, true);
    assert.match(readiness.payload.readiness.evidenceHash, /^[a-f0-9]{64}$/);
    assert.equal(readiness.payload.readiness.sideEffectAllowed, false);

    const history = await request(baseUrl, `/operators/${operator.id}/readiness/history`, { token });
    assert.equal(history.status, 200);
    assert.ok(history.payload.readiness.some((item) => item.id === readiness.payload.readiness.id));

    const record = await request(baseUrl, `/readiness/${readiness.payload.readiness.id}`, { token });
    assert.equal(record.status, 200);
    assert.equal(record.payload.readiness.evidenceHash, readiness.payload.readiness.evidenceHash);
    assert.equal(JSON.stringify(record.payload).includes("step-3-9-provider-secret-never-leak"), false);

    const status = await request(baseUrl, "/system/status", { token });
    assert.equal(status.status, 200);
    assert.ok(status.payload.status.ksiega34.some((item) => item.key === "approval_mandatory" && item.status === "implemented"));
    assert.ok(status.payload.status.ksiega34.some((item) => item.key === "real_firecracker" && item.status === "blocked"));
    assert.ok(status.payload.status.phantom.every((item) => item.executionAllowed === false));
    assert.ok(status.payload.status.humanGateRequiredBefore.includes("real_cloud_mutation"));
    assert.ok(app.services.audit.list().some((event) => event.action === "operator.readiness_evaluated"));
  } finally {
    await close();
  }
});

test("Step 3.9 provider adapter remains dry-run only and preserves 3 VPS baseline", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const { operator, provider } = await createOperatorProviderAndDevices(baseUrl, token);

    const mutation = await request(baseUrl, "/providers/dry-run/vps-plan", {
      method: "POST",
      token,
      body: {
        providerId: provider.id,
        operatorId: operator.id,
        region: "fsn1",
        vpsPerOperator: 3,
        mutationMode: "apply"
      }
    });
    assert.equal(mutation.status, 422);
    assert.equal(mutation.payload.error.details.humanGateRequired, true);

    const plan = await request(baseUrl, "/providers/dry-run/vps-plan", {
      method: "POST",
      token,
      body: {
        providerId: provider.id,
        operatorId: operator.id,
        region: "fsn1",
        vpsPerOperator: 3,
        mutationMode: "dry_run"
      }
    });
    assert.equal(plan.status, 201);
    assert.equal(plan.payload.plan.plannedActions.length, 3);
    assert.equal(plan.payload.plan.sideEffectAllowed, false);
    assert.equal(plan.payload.plan.executionAllowed, false);
    assert.equal(plan.payload.plan.plannedActions.every((action) => action.shared === false), true);
    assert.equal(JSON.stringify(plan.payload).includes("step-3-9-provider-secret-never-leak"), false);
  } finally {
    await close();
  }
});

test("Step 3.9 PHANTOM coverage is evidence-only and blocked by expired exceptions", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const pkg = await createPhantomPackage(baseUrl, token);
    const evidence = await request(baseUrl, "/phantom/evidence-bundles", {
      method: "POST",
      token,
      body: {
        packageId: pkg.id,
        summary: "Evidence bundle",
        evidenceRefs: ["legal-review-ref", "ciso-review-ref", "architecture-review-ref"]
      }
    });
    assert.equal(evidence.status, 201);
    const approvalPack = await request(baseUrl, "/phantom/approval-packs", {
      method: "POST",
      token,
      body: {
        packageId: pkg.id,
        evidenceBundleIds: [evidence.payload.bundle.id],
        summary: "Step 3.9 evidence approval pack"
      }
    });
    assert.equal(approvalPack.status, 201);
    const review = await request(baseUrl, "/phantom/review-board", {
      method: "POST",
      token,
      body: {
        packageId: pkg.id,
        title: "Step 3.9 Review",
        summary: "Coverage gate review",
        legalOwner: "legal@sylion.local",
        cisoOwner: "ciso@sylion.local",
        architectOwner: "architect@sylion.local",
        complianceOwner: "compliance@sylion.local",
        evidenceRefs: ["review-board-ref"]
      }
    });
    assert.equal(review.status, 201);
    const simulation = await request(baseUrl, "/phantom/policy-simulations", {
      method: "POST",
      token,
      body: {
        packageId: pkg.id,
        scenario: "evidence_completeness",
        assumptions: ["Governance metadata only"],
        expectedControls: ["Human gate", "No execution"]
      }
    });
    assert.equal(simulation.status, 201);
    const exception = await request(baseUrl, "/phantom/exceptions", {
      method: "POST",
      token,
      body: {
        packageId: pkg.id,
        reviewBoardItemId: review.payload.item.id,
        evidenceBundleId: evidence.payload.bundle.id,
        scope: "Expired review exception",
        justification: "Forces coverage blocker",
        legalOwner: "legal@sylion.local",
        cisoOwner: "ciso@sylion.local",
        complianceOwner: "compliance@sylion.local",
        expiresAt: "2025-01-01T00:00:00.000Z"
      }
    });
    assert.equal(exception.status, 201);
    assert.equal(exception.payload.exception.expired, true);

    const coverage = await request(baseUrl, `/phantom/packages/${pkg.id}/evidence-coverage`, { token });
    assert.equal(coverage.status, 200);
    assert.equal(coverage.payload.coverage.executionAllowed, false);
    assert.equal(coverage.payload.coverage.certificationClaim, false);
    assert.equal(coverage.payload.coverage.status, "blocked");
    assert.ok(coverage.payload.coverage.blockers.includes("expired_exception_requires_review"));
    assert.ok(app.services.audit.list().some((event) => event.action === "phantom.evidence_coverage_evaluated"));
  } finally {
    await close();
  }
});
