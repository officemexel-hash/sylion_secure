import assert from "node:assert/strict";
import test from "node:test";
import { ROLES } from "../src/domain/constants.js";
import { startTestServer } from "./helpers.js";

// Contract slice for the rfLab module (RF lab governance, lab-only IMEI
// characterization). The HTTP happy-path, input validation and four-eyes
// gating are already covered by step3-107/step3-108 against the
// GLOBAL_SUPER_ADMIN actor. This file fills the missing RBAC-denial boundary:
// the rfLab gate must reject actors that lack the relevant permission, and
// the lab-only invariants (no product runtime, productionExecutionAllowed
// false) must hold regardless of caller. We exercise the service gate
// directly so the denial is asserted against the real RBAC permission map
// rather than a single all-powerful token.

function actor(role) {
  return { id: `actor-${role}`, email: `${role}@sylion.local`, role };
}

function labRequest(overrides = {}) {
  return {
    labName: "Shielded RF validation lab",
    jurisdiction: "PL",
    purpose:
      "Closed Faraday cage characterization of router modem identity behavior with no public-network exposure.",
    faradayCageEvidenceRef: "evidence://rf-lab/faraday-cage-calibration",
    rfLeakageTestRef: "evidence://rf-lab/leakage-test-pass",
    legalOpinionRef: "legal://rf-lab/pl-closed-cage-review",
    responsibleEngineer: "rf-lab-engineer",
    evidenceRefs: ["evidence://rf-lab/intake"],
    correlationId: "corr_rflab_contract",
    ...overrides
  };
}

test("rfLab denies read/list to an actor without rf_lab.test.read", async () => {
  const { app, close } = await startTestServer();
  try {
    const rfLab = app.services.rfLab;
    // INCIDENT_COMMANDER has neither read nor manage for rf_lab.
    assert.throws(
      () =>
        rfLab.list({
          actor: actor(ROLES.INCIDENT_COMMANDER),
          correlationId: "corr_rflab_contract"
        }),
      (error) => error.status === 403 && error.code === "forbidden"
    );
  } finally {
    await close();
  }
});

test("rfLab denies test creation to a read-only actor", async () => {
  const { app, close } = await startTestServer();
  try {
    const rfLab = app.services.rfLab;
    // AUDITOR holds rf_lab.test.read but not rf_lab.test.manage.
    assert.throws(
      () => rfLab.createImeiChangeTestRequest({ actor: actor(ROLES.AUDITOR), ...labRequest() }),
      (error) => error.status === 403 && error.code === "forbidden"
    );
  } finally {
    await close();
  }
});

test("rfLab denies approval to an actor that can manage but not approve", async () => {
  const { app, close } = await startTestServer();
  try {
    const rfLab = app.services.rfLab;
    // PROVISIONING_ADMIN has rf_lab.test.read + manage but NOT approve.
    assert.throws(
      () =>
        rfLab.approve({
          actor: actor(ROLES.PROVISIONING_ADMIN),
          testId: "rf_lab_test_does_not_matter",
          role: "legal",
          evidenceRef: "approval://rf-lab/legal",
          correlationId: "corr_rflab_contract"
        }),
      (error) => error.status === 403 && error.code === "forbidden"
    );
  } finally {
    await close();
  }
});

test("rfLab keeps a created governance record lab-only with execution disabled", async () => {
  const { app, close } = await startTestServer();
  try {
    const rfLab = app.services.rfLab;
    const record = rfLab.createImeiChangeTestRequest({
      actor: actor(ROLES.SECURITY_ADMIN),
      ...labRequest()
    });
    assert.equal(record.testType, "imei_change_characterization");
    assert.equal(record.status, "legal_review");
    assert.equal(record.humanGateRequired, true);
    assert.equal(record.executionAllowed, false);
    assert.equal(record.productRuntimeExecutorAvailable, false);
    assert.equal(record.productionExecutionAllowed, false);
    assert.equal(record.sideEffectAllowed, false);
    assert.equal(record.requiredConditions.rawIdentifiersForbidden, true);
  } finally {
    await close();
  }
});

test("rfLab refuses any product runtime IMEI-change executor and audits the denial", async () => {
  const { app, close } = await startTestServer();
  try {
    const rfLab = app.services.rfLab;
    const record = rfLab.createImeiChangeTestRequest({
      actor: actor(ROLES.SECURITY_ADMIN),
      ...labRequest()
    });
    assert.throws(
      () =>
        rfLab.assertNoProductExecution({
          actor: actor(ROLES.SECURITY_ADMIN),
          testId: record.id,
          correlationId: "corr_rflab_contract"
        }),
      (error) => error.status === 403 && error.code === "forbidden"
    );
    assert.ok(
      app.services.audit.list().some((event) => event.action === "rf_lab.product_execution_denied")
    );
  } finally {
    await close();
  }
});

test("rfLab rejects an unsupported status filter on list", async () => {
  const { app, close } = await startTestServer();
  try {
    const rfLab = app.services.rfLab;
    assert.throws(
      () =>
        rfLab.list({
          actor: actor(ROLES.SECURITY_ADMIN),
          status: "totally_made_up_status",
          correlationId: "corr_rflab_contract"
        }),
      (error) => error.status === 422 && error.code === "validation_error"
    );
  } finally {
    await close();
  }
});
