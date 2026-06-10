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
  { method = "GET", token, body, correlationId = "corr_phantom_step3_8" } = {}
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
  const result = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: "admin@sylion.local", password: "ChangeMe-LocalOnly-1!", fido2Verified: true }
  });
  assert.equal(result.status, 200);
  return result.payload.session.token;
}

async function phantomPackageFixture(baseUrl, token) {
  const capability = await request(baseUrl, "/phantom/capabilities", {
    method: "POST",
    token,
    body: {
      displayName: "Governance Placeholder",
      riskLevel: "restricted",
      controlsRequired: ["Legal review", "CISO review", "Architect review"]
    }
  });
  assert.equal(capability.status, 201);
  const templateList = await request(baseUrl, "/phantom/policy-templates", { token });
  assert.equal(templateList.status, 200);
  const pkg = await request(baseUrl, "/phantom/packages", {
    method: "POST",
    token,
    body: {
      name: "PHANTOM Step 3.8 Package",
      description: "Administrative lifecycle only",
      policyTemplateId: templateList.payload.templates[0].id,
      capabilityIds: [capability.payload.capability.id],
      tierMinimum: "PRO"
    }
  });
  assert.equal(pkg.status, 201);
  return { capability: capability.payload.capability, pkg: pkg.payload.package };
}

test("Step 3.8 PHANTOM review board records mandatory owners and never enables execution", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const { pkg } = await phantomPackageFixture(baseUrl, token);
    const item = await request(baseUrl, "/phantom/review-board", {
      method: "POST",
      token,
      body: {
        title: "Board review",
        summary: "Control-plane readiness review only",
        packageId: pkg.id,
        legalOwner: "legal@sylion.local",
        cisoOwner: "ciso@sylion.local",
        architectOwner: "architect@sylion.local",
        complianceOwner: "compliance@sylion.local",
        evidenceRefs: ["legal-memo-ref"]
      }
    });
    assert.equal(item.status, 201);
    assert.equal(item.payload.item.humanGateRequired, true);
    assert.equal(item.payload.item.sideEffectAllowed, false);
    assert.equal(item.payload.item.executionAllowed, false);
    assert.deepEqual(item.payload.item.requiredOwners, [
      "Architect",
      "CISO",
      "Legal",
      "Compliance/Product"
    ]);

    for (const owner of ["legal", "ciso", "architect", "compliance"]) {
      const ack = await request(baseUrl, `/phantom/review-board/${item.payload.item.id}/ack`, {
        method: "POST",
        token,
        body: { owner, note: `${owner} owner acknowledged` }
      });
      assert.equal(ack.status, 200);
      assert.equal(ack.payload.item.ownerAcknowledgements[owner], true);
      assert.equal(ack.payload.item.executionAllowed, false);
    }

    const status = await request(baseUrl, `/phantom/review-board/${item.payload.item.id}/status`, {
      method: "POST",
      token,
      body: { status: "approved_placeholder", note: "Review placeholder only" }
    });
    assert.equal(status.status, 200);
    assert.equal(status.payload.item.executionEnabled, false);
    assert.ok(
      app.services.audit
        .list()
        .some((event) => event.action === "phantom.review_board_status_changed")
    );
  } finally {
    await close();
  }
});

test("Step 3.8 PHANTOM policy simulations are simulation-only and reject prohibited operational language", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const { pkg } = await phantomPackageFixture(baseUrl, token);
    const simulation = await request(baseUrl, "/phantom/policy-simulations", {
      method: "POST",
      token,
      body: {
        packageId: pkg.id,
        scenario: "control_gap",
        assumptions: ["No live connector"],
        expectedControls: ["Human gate", "No baseline execution"]
      }
    });
    assert.equal(simulation.status, 201);
    assert.equal(simulation.payload.simulation.mode, "policy_simulation_only");
    assert.equal(simulation.payload.simulation.sideEffectAllowed, false);
    assert.equal(simulation.payload.simulation.executionAllowed, false);

    const prohibited = await request(baseUrl, "/phantom/policy-simulations", {
      method: "POST",
      token,
      body: {
        packageId: pkg.id,
        scenario: "control_gap",
        assumptions: ["imei field"],
        expectedControls: ["Human gate"]
      }
    });
    assert.equal(prohibited.status, 422);
    assert.equal(prohibited.payload.error.details.boundary, "PHANTOM_GOVERNANCE_METADATA_ONLY");
  } finally {
    await close();
  }
});

test("Step 3.8 PHANTOM exceptions require owners and cannot request execution", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const executionRequest = await request(baseUrl, "/phantom/exceptions", {
      method: "POST",
      token,
      body: {
        scope: "Review exception",
        justification: "Administrative timing exception",
        legalOwner: "legal@sylion.local",
        cisoOwner: "ciso@sylion.local",
        complianceOwner: "compliance@sylion.local",
        expiresAt: "2026-12-31T23:00:00.000Z",
        executionRequested: true
      }
    });
    assert.equal(executionRequest.status, 422);

    const exception = await request(baseUrl, "/phantom/exceptions", {
      method: "POST",
      token,
      body: {
        scope: "Review timing exception",
        justification: "Administrative sequencing only",
        legalOwner: "legal@sylion.local",
        cisoOwner: "ciso@sylion.local",
        complianceOwner: "compliance@sylion.local",
        expiresAt: "2026-12-31T23:00:00.000Z",
        evidenceRefs: ["compliance-note-ref"]
      }
    });
    assert.equal(exception.status, 201);
    assert.equal(exception.payload.exception.humanGateRequired, true);
    assert.equal(exception.payload.exception.executionEnabled, false);

    const list = await request(baseUrl, "/phantom/exceptions", { token });
    assert.equal(list.status, 200);
    assert.equal(list.payload.exceptions.length, 1);
  } finally {
    await close();
  }
});
