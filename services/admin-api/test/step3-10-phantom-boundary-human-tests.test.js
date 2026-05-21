import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { DEVICE_TYPES, TIERS } from "../src/domain/constants.js";
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

async function assertRejectsWithStatus(operation, status, pattern) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.status, status);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

async function loginClient(baseUrl) {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => "corr_step3_10_boundary"
  });
  const credentialId = `cred-step3-10-${Date.now()}`;
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

async function createOperatorPlanAndDevices(client) {
  const suffix = Date.now();
  const tenant = await client.createTenant({ name: `Step 3.10 Tenant ${suffix}`, tier: TIERS.PRO });
  const operator = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.10 Operator ${suffix}`,
    tier: TIERS.PRO
  });
  const provider = await client.createProvider({
    providerType: "hetzner",
    apiSecret: "step-3-10-provider-secret-never-leak",
    regions: ["fsn1"],
    billingHealth: { status: "healthy" },
    testConnection: { mode: "mock", status: "passed" }
  });
  const pixel = await client.registerDevice({
    type: DEVICE_TYPES.PIXEL,
    serial: `pixel-step3-10-${suffix}`,
    model: "Google Pixel",
    assignedOperatorId: operator.operator.id
  });
  const router = await client.registerDevice({
    type: DEVICE_TYPES.ROUTER,
    serial: `puli-step3-10-${suffix}`,
    model: "GL.iNet GL-XE3000 Puli AX",
    assignedOperatorId: operator.operator.id
  });
  await client.registerDevice({
    type: DEVICE_TYPES.FIDO2,
    serial: `fido-step3-10-${suffix}`,
    model: "YubiKey",
    assignedOperatorId: operator.operator.id
  });
  const plan = await client.createProvisioningPlan(operator.operator.id, {
    requestedApps: ["Signal", "Telegram"]
  });
  return { tenant: tenant.tenant, operator: operator.operator, provider: provider.provider, pixel: pixel.device, router: router.device, plan: plan.plan };
}

async function createPhantomReviewSet(client, { expiresAt = "2099-01-01T00:00:00.000Z" } = {}) {
  const templates = await client.listPhantomPolicyTemplates();
  const capability = await client.createPhantomCapability({
    displayName: "Step 3.10 Governance Capability",
    riskLevel: "restricted",
    controlsRequired: ["Legal review", "CISO review", "Architect review", "Compliance review"]
  });
  const pkg = await client.createPhantomPackage({
    name: "PHANTOM Step 3.10 Package",
    description: "Governance-only package for human dashboard and negative boundary testing",
    policyTemplateId: templates.templates[0].id,
    capabilityIds: [capability.capability.id],
    tierMinimum: "PRO"
  });
  const evidence = await client.createPhantomEvidenceBundle({
    packageId: pkg.package.id,
    summary: "Step 3.10 evidence bundle",
    evidenceRefs: ["legal memo", "CISO risk note", "architect boundary note"]
  });
  const pack = await client.createPhantomApprovalPack({
    packageId: pkg.package.id,
    evidenceBundleIds: [evidence.bundle.id],
    summary: "Step 3.10 approval pack"
  });
  const review = await client.createPhantomReviewBoardItem({
    packageId: pkg.package.id,
    title: "Step 3.10 Review Board",
    summary: "Human gate review item",
    legalOwner: "legal@sylion.local",
    cisoOwner: "ciso@sylion.local",
    architectOwner: "architect@sylion.local",
    complianceOwner: "compliance@sylion.local",
    evidenceRefs: ["review-board-ref"]
  });
  const simulation = await client.runPhantomPolicySimulation({
    packageId: pkg.package.id,
    scenario: "evidence_completeness",
    assumptions: ["Metadata only"],
    expectedControls: ["Human gate", "No execution", "Audit correlation"]
  });
  const exception = await client.createPhantomException({
    packageId: pkg.package.id,
    reviewBoardItemId: review.item.id,
    evidenceBundleId: evidence.bundle.id,
    scope: "Step 3.10 revalidation",
    justification: "Tracks legal revalidation window",
    legalOwner: "legal@sylion.local",
    cisoOwner: "ciso@sylion.local",
    complianceOwner: "compliance@sylion.local",
    expiresAt
  });
  return { capability: capability.capability, pkg: pkg.package, evidence: evidence.bundle, pack: pack.pack, review: review.item, simulation: simulation.run, exception: exception.exception };
}

test("Step 3.10 keeps PHANTOM review matrix evidence-only and exposes status against Księga 3.4", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { pkg, review, exception } = await createPhantomReviewSet(client);

    for (const owner of ["legal", "ciso", "architect", "compliance"]) {
      await client.acknowledgePhantomReviewBoardOwner(review.id, { owner, note: `Ack ${owner}` });
    }

    const updatedReview = await client.updatePhantomReviewBoardStatus(review.id, {
      status: "approved_placeholder",
      note: "All owners acknowledged for governance placeholder"
    });
    assert.equal(updatedReview.item.status, "approved_placeholder");
    assert.equal(updatedReview.item.executionAllowed, false);
    assert.equal(updatedReview.item.executionEnabled, false);
    assert.deepEqual(Object.values(updatedReview.item.ownerAcknowledgements), [true, true, true, true]);

    const coverage = await client.getPhantomEvidenceCoverage(pkg.id);
    assert.equal(coverage.coverage.status, "ready_for_human_gate");
    assert.equal(coverage.coverage.coveragePercent, 100);
    assert.equal(coverage.coverage.certificationClaim, false);
    assert.equal(coverage.coverage.executionAllowed, false);
    assert.equal(exception.expired, false);

    const status = await client.getSystemStatus();
    assert.ok(status.status.ksiega34.some((item) => item.key === "approval_mandatory" && item.status === "implemented"));
    assert.ok(status.status.ksiega34.some((item) => item.key === "real_firecracker" && item.status === "blocked"));
    assert.ok(status.status.phantom.every((item) => item.executionAllowed === false));
  } finally {
    await close();
  }
});

test("Step 3.10 rejects PHANTOM attempts to cross into execution paths", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operator, pixel, router, plan } = await createOperatorPlanAndDevices(client);
    const { pkg, review, evidence } = await createPhantomReviewSet(client);

    await assertRejectsWithStatus(
      () => client.updatePhantomReviewBoardStatus(review.id, {
        status: "approved_placeholder",
        note: "Missing owner acknowledgements should block this"
      }),
      422,
      /owner acknowledgements/
    );

    await assertRejectsWithStatus(
      () => client.createPhantomException({
        packageId: pkg.id,
        reviewBoardItemId: review.id,
        evidenceBundleId: evidence.id,
        scope: "Execution request boundary test",
        justification: "Must be rejected",
        legalOwner: "legal@sylion.local",
        cisoOwner: "ciso@sylion.local",
        complianceOwner: "compliance@sylion.local",
        expiresAt: "2099-01-01T00:00:00.000Z",
        executionRequested: true
      }),
      422,
      /cannot request execution/
    );

    await assertRejectsWithStatus(
      () => client.runPhantomPolicySimulation({
        packageId: pkg.id,
        scenario: "control_gap",
        assumptions: ["Contains IMEI handling detail"],
        expectedControls: ["Human gate"]
      }),
      422,
      /prohibited details/
    );

    const phantomApproval = await client.createPhantomApproval({
      reasonCode: "boundary_review_only",
      legalOwner: "legal@sylion.local",
      cisoOwner: "ciso@sylion.local",
      architectOwner: "architect@sylion.local",
      evidenceRefs: ["phantom-governance-ref"]
    });
    await client.updatePhantomApprovalStatus(phantomApproval.approval.id, {
      status: "approved_placeholder",
      note: "Placeholder only"
    });

    await assertRejectsWithStatus(
      () => client.executeJob({
        planId: plan.id,
        provider: "hetzner",
        region: "fsn1",
        imageRef: "image://sylion/base/dev",
        pixelDeviceId: pixel.id,
        routerDeviceId: router.id,
        approvalId: phantomApproval.approval.id,
        idempotencyKey: "idem-step3-10-phantom-boundary"
      }),
      404,
      /provisioning_approval/
    );

    const jobs = await client.request(`/orchestrator/jobs?operatorId=${operator.id}`);
    assert.equal(jobs.jobs.length, 0);
    assert.equal(JSON.stringify(jobs).includes("step-3-10-provider-secret-never-leak"), false);
    assert.ok(app.services.audit.list().some((event) => event.action === "phantom.approval_status_changed"));
  } finally {
    await close();
  }
});
