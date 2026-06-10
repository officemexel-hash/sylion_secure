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
  { method = "GET", token, body, correlationId = "corr_phantom_step3_6" } = {}
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

test("Step 3.6 PHANTOM lifecycle builds package, evidence, approval pack, and readiness gate without execution", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const templates = await request(baseUrl, "/phantom/policy-templates", { token });
    assert.equal(templates.status, 200);
    assert.ok(templates.payload.templates.length >= 3);
    assert.equal(templates.payload.templates[0].executionAllowed, false);

    const capability = await request(baseUrl, "/phantom/capabilities", {
      method: "POST",
      token,
      body: {
        displayName: "Simulation Readiness Capability",
        riskLevel: "restricted",
        controlsRequired: ["Legal review", "CISO review", "Architect review"]
      }
    });
    assert.equal(capability.status, 201);

    const capabilityReady = await request(
      baseUrl,
      `/phantom/capabilities/${capability.payload.capability.id}/status`,
      {
        method: "POST",
        token,
        body: {
          implementationStatus: "approved_placeholder",
          legalReviewStatus: "approved_placeholder",
          cisoReviewStatus: "approved_placeholder",
          architectReviewStatus: "approved_placeholder"
        }
      }
    );
    assert.equal(capabilityReady.status, 200);
    assert.equal(capabilityReady.payload.capability.executionEnabled, false);

    const packageResult = await request(baseUrl, "/phantom/packages", {
      method: "POST",
      token,
      body: {
        name: "PHANTOM Lifecycle Admin Package",
        description: "Administrative readiness and evidence lifecycle only",
        policyTemplateId: "phantom_template_legal_ciso_architect",
        capabilityIds: [capability.payload.capability.id]
      }
    });
    assert.equal(packageResult.status, 201);
    assert.equal(packageResult.payload.package.sideEffectAllowed, false);
    assert.equal(packageResult.payload.package.executionAllowed, false);

    const evidence = await request(baseUrl, "/phantom/evidence-bundles", {
      method: "POST",
      token,
      body: {
        packageId: packageResult.payload.package.id,
        summary: "Evidence references for administrative readiness review",
        evidenceRefs: ["legal-memo-ref", "ciso-risk-note-ref", "architect-boundary-note-ref"],
        controlsSatisfied: [
          "Separate track claim review",
          "Human gate ownership",
          "No baseline execution"
        ]
      }
    });
    assert.equal(evidence.status, 201);
    assert.equal(evidence.payload.bundle.sealed, true);
    assert.match(evidence.payload.bundle.sealedHash, /^[a-f0-9]{64}$/);

    const approval = await request(baseUrl, "/phantom/approvals", {
      method: "POST",
      token,
      body: {
        capabilityId: capability.payload.capability.id,
        reasonCode: "step3_6_admin_lifecycle",
        legalOwner: "legal@sylion.local",
        cisoOwner: "ciso@sylion.local",
        architectOwner: "architect@sylion.local",
        evidenceRefs: [evidence.payload.bundle.id]
      }
    });
    assert.equal(approval.status, 201);

    const pack = await request(baseUrl, "/phantom/approval-packs", {
      method: "POST",
      token,
      body: {
        packageId: packageResult.payload.package.id,
        approvalIds: [approval.payload.approval.id],
        evidenceBundleIds: [evidence.payload.bundle.id],
        summary: "Owners and evidence are ready for HUMAN GATE review"
      }
    });
    assert.equal(pack.status, 201);
    assert.deepEqual(pack.payload.pack.requiredOwners, [
      "Architect",
      "CISO",
      "Legal",
      "Compliance"
    ]);

    const tenant = await request(baseUrl, "/tenants", {
      method: "POST",
      token,
      body: { name: "Step 3.6 Tenant", tier: "PRO" }
    });
    assert.equal(tenant.status, 201);
    const operator = await request(baseUrl, "/operators", {
      method: "POST",
      token,
      body: { tenantId: tenant.payload.tenant.id, displayName: "Step 3.6 Operator", tier: "PRO" }
    });
    assert.equal(operator.status, 201);

    const evaluation = await request(baseUrl, "/phantom/readiness/evaluate", {
      method: "POST",
      token,
      body: {
        packageId: packageResult.payload.package.id,
        approvalPackId: pack.payload.pack.id,
        evidenceBundleId: evidence.payload.bundle.id,
        operatorId: operator.payload.operator.id
      }
    });
    assert.equal(evaluation.status, 201);
    assert.equal(evaluation.payload.evaluation.readinessState, "ready_for_human_gate");
    assert.equal(evaluation.payload.evaluation.gateState, "human_gate_required");
    assert.equal(evaluation.payload.evaluation.executionAllowed, false);
    assert.equal(evaluation.payload.evaluation.executionEnabled, false);
    assert.equal(evaluation.payload.evaluation.sideEffectAllowed, false);

    const audit = app.services.audit.list();
    const readinessAudit = audit.find((event) => event.action === "phantom.readiness_evaluated");
    assert.ok(readinessAudit);
    assert.equal(readinessAudit.policyDecision, "deny");
    assert.equal(readinessAudit.result, "blocked");
  } finally {
    await close();
  }
});

test("Step 3.6 PHANTOM simulation and assignment planning are simulation-only and tier-aware", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const capability = await request(baseUrl, "/phantom/capabilities", {
      method: "POST",
      token,
      body: { displayName: "Assignment Planning Capability", riskLevel: "restricted" }
    });
    const packageResult = await request(baseUrl, "/phantom/packages", {
      method: "POST",
      token,
      body: {
        name: "Sovereign Review Package",
        description: "Checks subscription gates for separate track review",
        policyTemplateId: "phantom_template_sovereign_exception",
        capabilityIds: [capability.payload.capability.id]
      }
    });
    assert.equal(packageResult.status, 201);

    const tenant = await request(baseUrl, "/tenants", {
      method: "POST",
      token,
      body: { name: "Tier Gate Tenant", tier: "STANDARD" }
    });
    const operator = await request(baseUrl, "/operators", {
      method: "POST",
      token,
      body: {
        tenantId: tenant.payload.tenant.id,
        displayName: "Tier Gate Operator",
        tier: "STANDARD"
      }
    });

    const simulation = await request(baseUrl, "/phantom/simulations", {
      method: "POST",
      token,
      body: {
        packageId: packageResult.payload.package.id,
        scenario: "tier_fit",
        assumptions: ["No live connector", "Panel review only"]
      }
    });
    assert.equal(simulation.status, 201);
    assert.equal(simulation.payload.run.mode, "simulation_only");
    assert.equal(simulation.payload.run.executionAllowed, false);
    assert.equal(simulation.payload.run.sideEffectAllowed, false);

    const plan = await request(baseUrl, "/phantom/assignment-plans", {
      method: "POST",
      token,
      body: {
        packageId: packageResult.payload.package.id,
        operatorIds: [operator.payload.operator.id]
      }
    });
    assert.equal(plan.status, 201);
    assert.equal(plan.payload.plan.status, "blocked_by_tier");
    assert.equal(plan.payload.plan.operators[0].eligible, false);
    assert.equal(plan.payload.plan.operators[0].baseline.vpsPerOperator, 3);
    assert.equal(plan.payload.plan.operators[0].baseline.cdrMandatory, true);

    const evaluation = await request(baseUrl, "/phantom/readiness/evaluate", {
      method: "POST",
      token,
      body: {
        packageId: packageResult.payload.package.id,
        operatorId: operator.payload.operator.id
      }
    });
    assert.equal(evaluation.status, 201);
    assert.ok(
      evaluation.payload.evaluation.blockers.includes("operator_tier_below_package_minimum")
    );
    assert.equal(evaluation.payload.evaluation.executionAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.6 PHANTOM lifecycle rejects prohibited details and denies readonly lifecycle access", async () => {
  const { app, baseUrl, close } = await startTestServer();
  const prohibited = "stealth transport bypass lawful controls";
  try {
    const adminToken = await login(baseUrl);
    const readonlyToken = await login(baseUrl, "readonly@sylion.local", "ReadOnly-LocalOnly-1!");

    const denied = await request(baseUrl, "/phantom/policy-templates", { token: readonlyToken });
    assert.equal(denied.status, 403);

    const rejected = await request(baseUrl, "/phantom/policy-templates", {
      method: "POST",
      token: adminToken,
      body: {
        name: prohibited,
        tierMinimum: "PRO",
        controlObjectives: ["Legal review"],
        requiredEvidenceTypes: ["memo"]
      }
    });
    assert.equal(rejected.status, 422);
    assert.equal(
      JSON.stringify(app.services.audit.list()).toLowerCase().includes(prohibited),
      false
    );

    const correlation = await request(baseUrl, "/phantom/audit-correlation", { token: adminToken });
    assert.equal(correlation.status, 200);
    assert.equal(correlation.payload.summary.humanGateRequired, true);
    assert.equal(correlation.payload.summary.executionAllowed, false);
  } finally {
    await close();
  }
});
