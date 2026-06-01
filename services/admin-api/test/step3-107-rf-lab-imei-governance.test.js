import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
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
    correlationIdFactory: () => `corr_step3_107_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-107-${crypto.randomUUID()}`;
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

async function createOperatorAndRouter(client) {
  const tenant = await client.createTenant({ name: "Step 3.107 RF Lab Tenant", tier: "SOVEREIGN" });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Step 3.107 RF Lab Operator",
    tier: "SOVEREIGN"
  });
  const router = await client.registerDevice({
    type: "puli_ax_router",
    serial: `puli-step3-107-${crypto.randomUUID()}`,
    model: "GL.iNet GL-XE3000 Puli AX",
    assignedOperatorId: created.operator.id,
    posture: { state: "rf_lab_inventory_ready" }
  });
  return { operatorId: created.operator.id, router: router.device };
}

function labRequestBody({ operatorId, routerDeviceId }) {
  return {
    operatorId,
    routerDeviceId,
    labName: "Shielded RF validation lab",
    jurisdiction: "PL",
    purpose: "Closed Faraday cage characterization of router modem identity behavior with no public-network exposure.",
    faradayCageEvidenceRef: "evidence://rf-lab/faraday-cage-calibration-2026-06",
    rfLeakageTestRef: "evidence://rf-lab/leakage-test-pass-2026-06",
    legalOpinionRef: "legal://rf-lab/pl-closed-cage-review-2026-06",
    responsibleEngineer: "rf-lab-engineer",
    evidenceRefs: ["evidence://rf-lab/intake"]
  };
}

test("Step 3.107 creates an RF lab IMEI test request as governance-only record", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operatorId, router } = await createOperatorAndRouter(client);
    const response = await client.request("/rf-lab/imei-change-tests", {
      method: "POST",
      body: labRequestBody({ operatorId, routerDeviceId: router.id })
    });
    assert.equal(response.test.testType, "imei_change_characterization");
    assert.equal(response.test.status, "legal_review");
    assert.equal(response.test.requiredConditions.faradayCage, true);
    assert.equal(response.test.requiredConditions.noPublicMobileNetwork, true);
    assert.equal(response.test.executionAllowed, false);
    assert.equal(response.test.productRuntimeExecutorAvailable, false);
    assert.equal(response.test.productionExecutionAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.107 rejects raw cellular identifiers and operational modem details", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operatorId, router } = await createOperatorAndRouter(client);
    await assert.rejects(
      () => client.request("/rf-lab/imei-change-tests", {
        method: "POST",
        body: {
          ...labRequestBody({ operatorId, routerDeviceId: router.id }),
          currentImei: "123456789012345"
        }
      }),
      (error) => error.status === 422
    );
    await assert.rejects(
      () => client.request("/rf-lab/imei-change-tests", {
        method: "POST",
        body: {
          ...labRequestBody({ operatorId, routerDeviceId: router.id }),
          purpose: "Use AT+EXAMPLE to write identity in the lab."
        }
      }),
      (error) => error.status === 422
    );
  } finally {
    await close();
  }
});

test("Step 3.107 needs four approvals before evidence and still denies product runtime execution", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operatorId, router } = await createOperatorAndRouter(client);
    const created = await client.request("/rf-lab/imei-change-tests", {
      method: "POST",
      body: labRequestBody({ operatorId, routerDeviceId: router.id })
    });
    const testId = created.test.id;
    for (const role of ["legal", "ciso", "architect", "hardware"]) {
      const approved = await client.request(`/rf-lab/imei-change-tests/${testId}/approve`, {
        method: "POST",
        body: {
          role,
          evidenceRef: `approval://rf-lab/${role}/step3-107`,
          comment: `${role} approved closed-cage record-only workflow`
        }
      });
      assert.equal(approved.test.executionAllowed, false);
    }
    const approved = await client.request(`/rf-lab/imei-change-tests/${testId}`);
    assert.equal(approved.test.status, "approved_for_isolated_lab_record_only");

    const preHash = createHash("sha256").update("pre-image-not-identifier").digest("hex");
    const postHash = createHash("sha256").update("post-image-not-identifier").digest("hex");
    const evidence = await client.request(`/rf-lab/imei-change-tests/${testId}/evidence`, {
      method: "POST",
      body: {
        isolationStillActive: true,
        publicNetworkObserved: false,
        spectrumMonitorRef: "evidence://rf-lab/spectrum-monitor-clean",
        resultSummary: "Closed-cage evidence recorded. Product runtime did not perform radio identity mutation.",
        preChangeIdentifierHash: preHash,
        postChangeIdentifierHash: postHash,
        evidenceRefs: ["evidence://rf-lab/final-report"]
      }
    });
    assert.equal(evidence.test.status, "evidence_recorded");
    assert.equal(evidence.test.evidence.at(-1).rawIdentifiersRedacted, true);
    assert.equal(JSON.stringify(evidence).includes("123456789012345"), false);

    await assert.rejects(
      () => client.request(`/rf-lab/imei-change-tests/${testId}/execute-product-runtime`, { method: "POST" }),
      (error) => error.status === 403
    );
    assert.ok(app.services.audit.list().some((event) => event.action === "rf_lab.product_execution_denied"));
  } finally {
    await close();
  }
});
