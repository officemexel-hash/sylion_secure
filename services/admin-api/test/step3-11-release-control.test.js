import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
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
    correlationIdFactory: () => "corr_step3_11_release"
  });
  const credentialId = `cred-step3-11-${Date.now()}`;
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

async function assertRejectsWithStatus(operation, status, pattern) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.status, status);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test("Step 3.11 release control exposes production blockers without enabling execution", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);

    const summary = await client.getReleaseSummary();
    assert.equal(summary.summary.productionExecutionAllowed, false);
    assert.equal(summary.summary.decision, "not_ready_for_production_execution");
    assert.equal(summary.summary.phantom.executionAllowed, false);
    assert.equal(summary.summary.phantom.certificationClaim, false);
    assert.equal(summary.summary.phantom.executionSafe, true);
    assert.ok(summary.summary.gates.blocked >= 1);

    const gates = await client.listReleaseGates();
    assert.ok(
      gates.gates.some(
        (gate) =>
          gate.moduleKey === "firecracker_orchestration" && gate.status === "blocked_human_gate"
      )
    );
    assert.ok(
      gates.gates.some(
        (gate) => gate.moduleKey === "phantom_v3" && gate.productionExecutionAllowed === false
      )
    );

    await assertRejectsWithStatus(
      () =>
        client.updateReleaseGateStatus("gate_phantom_v3", {
          status: "verified",
          evidenceArtifactIds: ["artifact-placeholder"]
        }),
      422,
      /PHANTOM live behavior/
    );
  } finally {
    await close();
  }
});

test("Step 3.11 tracks artifacts, human tests and problems with evidence gates", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);

    const artifact = await client.createEvidenceArtifact({
      type: "screenshot",
      path: "docs/admin-panel-v2/test-artifacts/step3-11-dashboard-regression/release-desktop.png",
      source: "playwright",
      linkedModule: "release"
    });
    assert.match(artifact.artifact.sha256, /^[a-f0-9]{64}$/);

    const tests = await client.listHumanTestScenarios();
    assert.ok(tests.scenarios.some((scenario) => scenario.id === "test_phantom"));

    const updatedTest = await client.updateHumanTestScenarioStatus("test_phantom", {
      status: "passed",
      evidenceArtifactIds: [artifact.artifact.id],
      note: "PHANTOM workbench confirms execution false"
    });
    assert.equal(updatedTest.scenario.status, "passed");
    assert.deepEqual(updatedTest.scenario.evidenceArtifactIds, [artifact.artifact.id]);

    const problem = await client.createReleaseProblem({
      title: "Mobile release dashboard spacing requires review",
      severity: "medium",
      category: "ux_issue",
      moduleKey: "admin_web",
      owner: "qa",
      evidenceArtifactIds: [artifact.artifact.id]
    });
    assert.equal(problem.problem.status, "open");

    const problemWithoutEvidence = await client.createReleaseProblem({
      title: "Unverified problem without evidence",
      severity: "high",
      category: "test_gap",
      moduleKey: "release",
      owner: "qa"
    });
    await assertRejectsWithStatus(
      () =>
        client.updateReleaseProblemStatus(problemWithoutEvidence.problem.id, {
          status: "verified",
          evidenceArtifactIds: []
        }),
      422,
      /Verified problems require evidence/
    );

    const verified = await client.updateReleaseProblemStatus(problem.problem.id, {
      status: "verified",
      resolutionNote: "Spacing accepted after Playwright mobile evidence",
      evidenceArtifactIds: [artifact.artifact.id]
    });
    assert.equal(verified.problem.status, "verified");
    assert.ok(
      app.services.audit.list().some((event) => event.action === "release.problem_status_changed")
    );
  } finally {
    await close();
  }
});

test("Step 3.11 release records reject prohibited operational language", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    await assertRejectsWithStatus(
      () =>
        client.createReleaseProblem({
          title: "Rejected operational evasion wording",
          severity: "high",
          category: "security_gap",
          moduleKey: "phantom_v3",
          owner: "qa"
        }),
      422,
      /prohibited details/
    );
  } finally {
    await close();
  }
});
