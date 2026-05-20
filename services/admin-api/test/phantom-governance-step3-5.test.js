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

async function request(baseUrl, path, { method = "GET", token, body, correlationId = "corr_phantom_step3_5" } = {}) {
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

test("Step 3.5 PHANTOM boundary is governance-only and has no side effects", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const boundary = await request(baseUrl, "/phantom/boundary", { token });
    assert.equal(boundary.status, 200);
    assert.equal(boundary.payload.boundary.phantomBoundary, "PHANTOM_V3_SEPARATE_TRACK");
    assert.equal(boundary.payload.boundary.humanGateRequired, true);
    assert.equal(boundary.payload.boundary.sideEffectAllowed, false);
    assert.equal(boundary.payload.boundary.executionEnabled, false);

    const updated = await request(baseUrl, "/phantom/boundary/status", {
      method: "POST",
      token,
      body: { status: "approved_placeholder", note: "Legal and CISO review record only" }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.payload.boundary.status, "approved_placeholder");
    assert.equal(updated.payload.boundary.sideEffectAllowed, false);
    assert.equal(updated.payload.boundary.executionEnabled, false);
  } finally {
    await close();
  }
});

test("Step 3.5 PHANTOM capability, approval, and risk records remain placeholders", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const capability = await request(baseUrl, "/phantom/capabilities", {
      method: "POST",
      token,
      body: {
        displayName: "Governance Review Placeholder",
        riskLevel: "restricted",
        controlsRequired: ["Legal review", "CISO review", "Architect review"],
        evidenceRefs: ["docs/admin-panel-v2/23-step3-5-masterplan.md"]
      }
    });
    assert.equal(capability.status, 201);
    assert.equal(capability.payload.capability.classification, "A/autonomous separate track");
    assert.equal(capability.payload.capability.sideEffectAllowed, false);
    assert.equal(capability.payload.capability.executionEnabled, false);

    const approval = await request(baseUrl, "/phantom/approvals", {
      method: "POST",
      token,
      body: {
        capabilityId: capability.payload.capability.id,
        reasonCode: "governance_review",
        legalOwner: "legal@sylion.local",
        cisoOwner: "ciso@sylion.local",
        architectOwner: "architect@sylion.local",
        evidenceRefs: ["risk-register-placeholder"]
      }
    });
    assert.equal(approval.status, 201);
    assert.equal(approval.payload.approval.status, "legal_review_required");
    assert.equal(approval.payload.approval.sideEffectAllowed, false);

    const approved = await request(baseUrl, `/phantom/approvals/${approval.payload.approval.id}/status`, {
      method: "POST",
      token,
      body: { status: "approved_placeholder", note: "Placeholder approval; no execution" }
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.payload.approval.status, "approved_placeholder");
    assert.equal(approved.payload.approval.executionEnabled, false);

    const risk = await request(baseUrl, "/phantom/risks", {
      method: "POST",
      token,
      body: {
        capabilityId: capability.payload.capability.id,
        description: "Separate-track governance requires documented residual risk",
        severity: "high",
        legalOwner: "legal@sylion.local",
        cisoOwner: "ciso@sylion.local",
        residualRisk: "Operational behavior remains outside baseline",
        mitigationPlan: "Keep disabled boundary and require HUMAN GATE"
      }
    });
    assert.equal(risk.status, 201);
    assert.equal(risk.payload.risk.humanGateRequired, true);
    assert.equal(risk.payload.risk.sideEffectAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.5 PHANTOM guardrails reject prohibited operational details and RBAC denies readonly", async () => {
  const { app, baseUrl, close } = await startTestServer();
  const prohibited = "imei spoofing should never be accepted";
  try {
    const adminToken = await login(baseUrl);
    const readonlyToken = await login(baseUrl, "readonly@sylion.local", "ReadOnly-LocalOnly-1!");

    const deniedRead = await request(baseUrl, "/phantom/boundary", { token: readonlyToken });
    assert.equal(deniedRead.status, 403);

    const rejected = await request(baseUrl, "/phantom/capabilities", {
      method: "POST",
      token: adminToken,
      body: {
        displayName: prohibited,
        riskLevel: "restricted"
      }
    });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.payload.error.code, "validation_error");

    const auditEvents = app.services.audit.list();
    assert.equal(JSON.stringify(auditEvents).toLowerCase().includes(prohibited), false);
  } finally {
    await close();
  }
});
