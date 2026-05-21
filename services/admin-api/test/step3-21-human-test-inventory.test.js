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
    correlationIdFactory: () => `corr_step3_21_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-21-${crypto.randomUUID()}`;
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

test("Step 3.21 records a full human Playwright run and updates build assessment", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const scenarios = await client.listHumanTestScenarios();
    const run = await client.recordHumanTestRun({
      mode: "mixed_human_playwright",
      title: "Step 3.21 full dashboard pass",
      environment: "local_admin_api",
      evidenceArtifactIds: [],
      results: scenarios.scenarios.map((scenario) => ({
        scenarioId: scenario.id,
        view: scenario.view,
        status: "passed",
        note: "Scenario clicked and reviewed"
      }))
    });
    assert.equal(run.run.status, "passed");
    assert.equal(run.run.productionExecutionAllowed, false);
    assert.equal(run.run.results.length, scenarios.scenarios.length);

    const assessment = await client.getReleaseBuildAssessment();
    assert.equal(assessment.assessment.productionExecutionAllowed, false);
    assert.equal(assessment.assessment.phantom.executionAllowed, false);
    assert.equal(assessment.assessment.phantom.certificationClaim, false);
    assert.equal(assessment.assessment.testing.latestRun.id, run.run.id);
    assert.ok(assessment.assessment.księga34.blocked >= 1);
    assert.ok(app.services.audit.list().some((event) => event.action === "release.human_test_run_recorded"));
  } finally {
    app.close();
    await close();
  }
});

test("Step 3.21 creates release problems for failed or blocked scenario results", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const run = await client.recordHumanTestRun({
      mode: "playwright_dashboard",
      title: "Step 3.21 failing dashboard pass",
      environment: "local_admin_api",
      results: [
        { scenarioId: "test_overview", view: "dashboard", status: "passed", note: "OK" },
        { scenarioId: "test_phantom", view: "phantom", status: "failed", note: "Needs visual review" },
        { scenarioId: "test_mobile", view: "ui", status: "blocked", note: "Mobile viewport blocked" }
      ]
    });
    assert.equal(run.run.status, "needs_human_review");
    const problems = await client.listReleaseProblems();
    assert.ok(problems.problems.some((problem) => problem.moduleKey === "phantom" && problem.status === "open"));
    assert.ok(problems.problems.some((problem) => problem.moduleKey === "ui" && problem.status === "open"));
    const assessment = await client.getReleaseBuildAssessment();
    assert.equal(assessment.assessment.testing.failedOrBlockedScenarios.length, 2);
    assert.equal(assessment.assessment.productionExecutionAllowed, false);
  } finally {
    app.close();
    await close();
  }
});

test("Step 3.21 rejects human test run notes with prohibited operational content", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    await assert.rejects(
      () => client.recordHumanTestRun({
        mode: "manual_human",
        title: "Unsafe note test",
        environment: "local_admin_api",
        results: [
          { scenarioId: "test_audit", view: "audit", status: "failed", note: "bypass lawful review" }
        ]
      }),
      /prohibited/
    );
    assert.equal(JSON.stringify(app.services.audit.list()).includes("bypass lawful review"), false);
  } finally {
    app.close();
    await close();
  }
});
