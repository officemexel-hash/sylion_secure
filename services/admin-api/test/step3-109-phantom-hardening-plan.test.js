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

async function request(baseUrl, path, { method = "GET", token, body, correlationId = "corr_step3_109" } = {}) {
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

test("Step 3.109 exposes the SYLION/PHANTOM hardening plan as policy-as-code", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const response = await request(baseUrl, "/phantom/hardening-plan", { token });
    assert.equal(response.status, 200);
    assert.equal(response.payload.plan.posture, "policy_as_code_review_only");
    assert.equal(response.payload.plan.summary.milestones, 9);
    assert.equal(response.payload.plan.summary.baselineImplementable, 3);
    assert.equal(response.payload.plan.executionAllowed, false);
    assert.equal(response.payload.plan.productionExecutionAllowed, false);
    assert.equal(response.payload.plan.humanGateRequired, true);
    assert.ok(response.payload.plan.milestones.every((item) => item.sideEffectAllowed === false));
    assert.ok(response.payload.plan.milestones.every((item) => item.executionAllowed === false));

    const rfLab = response.payload.plan.milestones.find((item) => item.id === "hs_05_esim_and_rf_lab_governance");
    assert.equal(rfLab.decision, "lab_only_no_product_executor");
    assert.equal(rfLab.allowedInBaseline, false);

    assert.ok(app.services.audit.list().some((event) => event.action === "phantom.hardening_plan_read"));
  } finally {
    await close();
  }
});

test("Step 3.109 evaluates hardening evidence without enabling execution", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const response = await request(baseUrl, "/phantom/hardening-plan/evaluate", {
      method: "POST",
      token,
      body: {
        evidenceRefsByMilestone: {
          hs_04_terminal_radio_isolation: [
            "evidence://pixel/posture-airplane-mode",
            "evidence://router/pairing",
            "evidence://fido2/readiness",
            "evidence://path/pixel-puli-g1-g2-workload"
          ],
          hs_07_ebpf_runtime_monitoring: [
            "evidence://runtime/agent-install",
            "evidence://runtime/kernel-event",
            "evidence://siem/event",
            "evidence://incident/playbook"
          ]
        }
      }
    });
    assert.equal(response.status, 201);
    const terminal = response.payload.evaluation.evaluations.find((item) => item.milestoneId === "hs_04_terminal_radio_isolation");
    const ebpf = response.payload.evaluation.evaluations.find((item) => item.milestoneId === "hs_07_ebpf_runtime_monitoring");
    const lab = response.payload.evaluation.evaluations.find((item) => item.milestoneId === "hs_05_esim_and_rf_lab_governance");
    assert.equal(terminal.state, "ready_for_human_gate");
    assert.equal(ebpf.state, "ready_for_human_gate");
    assert.equal(lab.state, "blocked_by_policy_pending_evidence");
    assert.equal(response.payload.evaluation.executionAllowed, false);
    assert.equal(response.payload.evaluation.productionExecutionAllowed, false);
    assert.ok(app.services.audit.list().some((event) => event.action === "phantom.hardening_plan_evaluated"));
  } finally {
    await close();
  }
});

test("Step 3.109 rejects unknown milestones and prohibited operational hardening text", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const unknown = await request(baseUrl, "/phantom/hardening-plan/evaluate", {
      method: "POST",
      token,
      body: {
        evidenceRefsByMilestone: {
          hs_unknown: ["evidence://x"]
        }
      }
    });
    assert.equal(unknown.status, 422);

    const prohibited = await request(baseUrl, "/phantom/hardening-plan/evaluate", {
      method: "POST",
      token,
      body: {
        evidenceRefsByMilestone: {
          hs_05_esim_and_rf_lab_governance: ["evidence://imei-change-note"]
        }
      }
    });
    assert.equal(prohibited.status, 422);
    assert.equal(prohibited.payload.error.details.boundary, "PHANTOM_GOVERNANCE_METADATA_ONLY");
  } finally {
    await close();
  }
});
