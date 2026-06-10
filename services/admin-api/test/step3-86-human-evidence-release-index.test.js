import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { buildHumanEvidenceSummary } from "../src/lib/humanEvidence.js";
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
    correlationIdFactory: () => `corr_step3_86_index_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-86-index-${crypto.randomUUID()}`;
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

async function strictSummary(overrides = {}) {
  return buildHumanEvidenceSummary({
    testId: "step3-86-pixel-live-strict-index",
    testVersion: "step3.86",
    gitCommit: "test",
    tester: "node:test",
    environment: {
      mode: "live_metadata_and_human_ui",
      adminVps: "sylion-admin-api",
      g1g2WorkloadPath: "Pixel -> VPN -> G1 -> VPN -> G2 -> VPN -> WORKLOAD"
    },
    terminal: {
      type: "pixel_grapheneos",
      adbAuthorized: true,
      operationalDataOnTerminal: false
    },
    pathTested: "Pixel GrapheneOS -> VPN -> G1 -> VPN -> G2 -> VPN -> WORKLOAD -> app workloads",
    expectedBehavior:
      "Strict evidence is indexed without storing operational data or claiming production readiness.",
    preconditions: ["Strict human evidence bundle exists", "Admin session is authenticated"],
    actions: [
      "POST strict evidence summary",
      "Inspect release run inventory",
      "Inspect evidence artifact index"
    ],
    evidenceRefs: ["summary.json", "screenshot:operator-panel", "metadata:networkAfter"],
    result: "BLOCKED",
    blockers: ["physical_puli_ax_router_test_blocked_until_hardware_arrives"],
    residualRisk: ["Router, HSM and FIDO2 remain physical-gated."],
    nextRequiredAction:
      "Repeat the exact live Pixel regression after the blocked prerequisite is available.",
    ...overrides
  });
}

test("Step 3.86 indexes strict human evidence into release runs and artifacts", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const summary = await strictSummary();
    const indexed = await client.recordHumanEvidenceRun({
      summary,
      evidenceArtifactPath:
        "docs/admin-panel-v2/test-artifacts/step3-40-pixel-live-human-regression/human-evidence.json",
      linkedModule: "pixel_live_path",
      ksiegaControlRefs: ["thin_client_terminal", "g1_g2_workload_path"],
      phantomBoundaryImpact: "none"
    });
    assert.equal(indexed.run.status, "needs_human_review");
    assert.equal(indexed.run.results[0].status, "blocked");
    assert.equal(indexed.run.humanEvidence.strictResult, "BLOCKED");
    assert.equal(indexed.run.humanEvidence.productionSatisfyingResult, false);
    assert.deepEqual(indexed.run.humanEvidence.ksiegaControlRefs, [
      "thin_client_terminal",
      "g1_g2_workload_path"
    ]);
    assert.equal(indexed.run.humanEvidence.metadataOnly, true);
    assert.equal(indexed.run.humanEvidence.terminalDataStored, false);
    assert.equal(indexed.run.humanEvidence.packetCaptureStored, false);

    const artifacts = await client.listEvidenceArtifacts();
    assert.ok(
      artifacts.artifacts.some(
        (artifact) =>
          artifact.id === indexed.run.humanEvidence.evidenceArtifactIds[0] &&
          artifact.type === "human_evidence_summary"
      )
    );

    const assessment = await client.getReleaseBuildAssessment();
    assert.equal(assessment.assessment.testing.latestRun.id, indexed.run.id);
    assert.equal(assessment.assessment.testing.latestRun.humanEvidence.strictResult, "BLOCKED");

    const problems = await client.listReleaseProblems();
    assert.ok(
      problems.problems.some(
        (problem) => problem.moduleKey === "pixel_live_path" && problem.status === "open"
      )
    );
    assert.ok(
      app.services.audit
        .list()
        .some((event) => event.action === "release.human_evidence_run_indexed")
    );
  } finally {
    app.close();
    await close();
  }
});

test("Step 3.86 strict evidence indexing rejects forbidden metadata", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const unsafe = await strictSummary();
    unsafe.environment.apiToken = "REDACTED";
    await assert.rejects(
      () =>
        client.recordHumanEvidenceRun({
          summary: unsafe,
          linkedModule: "pixel_live_path"
        }),
      /Strict human evidence validation failed/
    );
    assert.equal(JSON.stringify(app.services.audit.list()).includes("apiToken"), false);
  } finally {
    app.close();
    await close();
  }
});

test("Step 3.86 repair loop creates per-blocker problems and forces exact retest", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const summary = await strictSummary({
      result: "FAIL_CRITICAL",
      blockers: ["terminal_data_storage_forbidden", "packet_capture_storage_forbidden"],
      residualRisk: ["Security review required before retest."],
      nextRequiredAction: "Stop related work, repair evidence handling, then rerun exact test id."
    });
    const repaired = await client.recordHumanEvidenceRepairLoop({
      summary,
      evidenceArtifactPath: "docs/admin-panel-v2/test-artifacts/step3-86/human-evidence.json",
      linkedModule: "pixel_live_path",
      repairCommit: "abc1234",
      retestOfRunId: "test_run_previous",
      ksiegaControlRefs: ["metadata_only_monitoring"],
      phantomBoundaryImpact: "none"
    });
    assert.equal(repaired.run.humanEvidence.strictResult, "FAIL_CRITICAL");
    assert.equal(repaired.run.repairLoop.retestRequired, true);
    assert.equal(repaired.run.repairLoop.exactRetestTestId, "step3-86-pixel-live-strict-index");
    assert.equal(repaired.run.repairLoop.repairCommit, "abc1234");
    assert.equal(repaired.run.repairLoop.productionReadinessRefused, true);
    assert.equal(
      repaired.run.repairLoop.allowedNextAction,
      "repair_smallest_scope_then_rerun_exact_test_id"
    );
    assert.equal(repaired.run.repairLoop.blockerProblemIds.length, 2);

    const problems = await client.listReleaseProblems();
    const blockerProblems = problems.problems.filter((problem) =>
      repaired.run.repairLoop.blockerProblemIds.includes(problem.id)
    );
    assert.equal(blockerProblems.length, 2);
    assert.ok(blockerProblems.every((problem) => problem.severity === "critical"));
    assert.ok(blockerProblems.every((problem) => problem.category === "security_gap"));
    assert.ok(
      app.services.audit
        .list()
        .some((event) => event.action === "release.human_evidence_repair_loop_recorded")
    );
  } finally {
    app.close();
    await close();
  }
});

test("Step 3.86 repair loop does not demand retest after strict PASS", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const summary = await strictSummary({
      result: "PASS",
      blockers: [],
      residualRisk: [
        "Residual physical-router and HSM/FIDO2 checks remain outside this exact test."
      ]
    });
    const run = await client.recordHumanEvidenceRepairLoop({
      summary,
      linkedModule: "admin_release_evidence",
      phantomBoundaryImpact: "none"
    });
    assert.equal(run.run.status, "passed");
    assert.equal(run.run.repairLoop.retestRequired, false);
    assert.equal(run.run.repairLoop.blockerProblemIds.length, 0);
    assert.equal(run.run.repairLoop.productionReadinessRefused, false);
    assert.equal(run.run.repairLoop.allowedNextAction, "freeze_evidence_and_move_to_next_test");
  } finally {
    app.close();
    await close();
  }
});
