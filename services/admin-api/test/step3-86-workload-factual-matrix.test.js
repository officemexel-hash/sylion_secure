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
    correlationIdFactory: () => `corr_step3_86_matrix_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-86-matrix-${crypto.randomUUID()}`;
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

test("Step 3.86 workload factual matrix defines strict criteria for every required app", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const response = await client.listWorkloadFactualMatrix();
    const matrix = response.matrix;
    assert.deepEqual(matrix.map((item) => item.appKey).sort(), [
      "duckduckgo_browser",
      "exodus",
      "libreoffice",
      "signal",
      "telegram",
      "threema",
      "whatsapp",
      "zangi"
    ]);
    for (const item of matrix) {
      assert.equal(item.cdrRequired, true);
      assert.equal(item.terminalDataStored, false);
      assert.equal(item.contentInspectionAllowed, false);
      assert.equal(item.packetCaptureStored, false);
      assert.equal(item.productionExecutionAllowed, false);
      assert.equal(item.strictPassRequiresFactualState, true);
      assert.ok(item.expectedBehavior.length > 20);
      assert.ok(item.humanSteps.length >= 4);
      assert.ok(item.passCriteria.length >= 3);
      assert.ok(item.failIf.some((rule) => /transport|HTTP 200|generic|only/i.test(rule)));
      assert.ok(item.repairPrompt.includes("Repair"));
    }
    const signal = matrix.find((item) => item.appKey === "signal");
    assert.deepEqual(signal.requiredChecks, ["uiVisible", "accountBootstrap", "sendReceive"]);
    assert.equal(signal.failIf.some((rule) => /web-link-only/i.test(rule)), true);
    const zangi = matrix.find((item) => item.appKey === "zangi");
    assert.equal(zangi.mandatoryChecks.includes("apkProvenance"), true);
    const exodus = matrix.find((item) => item.appKey === "exodus");
    assert.equal(exodus.passCriteria.some((rule) => /seed\/private key\/wallet data absent/i.test(rule)), true);
    assert.equal(app.services.audit.list().some((event) => event.action === "release.workload_factual_matrix_read"), false);
  } finally {
    app.close();
    await close();
  }
});

test("Step 3.86 workload factual matrix can be filtered by app key", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const response = await client.listWorkloadFactualMatrix({ appKey: "duckduckgo_browser" });
    assert.equal(response.matrix.length, 1);
    assert.equal(response.matrix[0].label, "DuckDuckGo");
    assert.deepEqual(response.matrix[0].requiredChecks, ["uiVisible", "browsing"]);
  } finally {
    app.close();
    await close();
  }
});
