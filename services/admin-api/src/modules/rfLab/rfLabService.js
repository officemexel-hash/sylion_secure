import { DEVICE_TYPES, RESOURCE_TYPES } from "../../domain/constants.js";
import { forbidden, notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const TEST_TYPES = new Set(["imei_change_characterization"]);
const STATUSES = new Set([
  "draft",
  "legal_review",
  "approved_for_isolated_lab_record_only",
  "rejected",
  "evidence_recorded",
  "closed"
]);
const REQUIRED_APPROVALS = Object.freeze(["legal", "ciso", "architect", "hardware"]);
const FORBIDDEN_KEY_PATTERN = /(imsi|iccid|ki|opc|tac|at[_-]?command|command|unlock|nv[_-]?item|qcdm|firehose|diag|pool)/i;
const IMEI_KEY_PATTERN = /imei/i;
const HASH_KEY_PATTERN = /hash$/i;
const OPERATIONAL_VALUE_PATTERN = /(AT\+|EGMR|QCDM|QFirehose|EDL|NV\s*item|diagnostic\s+port|write\s+imei|unlock\s+modem)/i;
const RAW_CELLULAR_IDENTIFIER_PATTERN = /\b\d{14,20}\b/;

function isoNow() {
  return new Date().toISOString();
}

function requireText(value, field) {
  if (!value || typeof value !== "string" || value.trim().length < 2) {
    throw validationError(`${field} is required`, { field });
  }
  return value.trim();
}

function safeArray(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw validationError(`${field} must be an array`, { field });
  return value.map((item, index) => requireText(String(item), `${field}.${index}`));
}

function rejectOperationalRadioDetails(value, path = "payload") {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (OPERATIONAL_VALUE_PATTERN.test(value) || RAW_CELLULAR_IDENTIFIER_PATTERN.test(value)) {
      throw validationError("RF lab records must not contain operational radio identity details", { field: path });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectOperationalRadioDetails(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    const rawIdentityKey = IMEI_KEY_PATTERN.test(key) && !HASH_KEY_PATTERN.test(key);
    if (FORBIDDEN_KEY_PATTERN.test(key) || rawIdentityKey) {
      throw validationError("RF lab records must use hashes and evidence references, not raw radio identity fields", {
        field: nextPath
      });
    }
    rejectOperationalRadioDetails(nested, nextPath);
  }
}

function publicRecord(record) {
  return {
    ...record,
    executionAllowed: false,
    productRuntimeExecutorAvailable: false,
    productionExecutionAllowed: false,
    sideEffectAllowed: false
  };
}

export class RfLabService {
  constructor({ audit, rbac, operators, devices, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.operators = operators;
    this.devices = devices;
    this.tests = new PersistentMap({ store, collection: "rf_lab_tests" });
  }

  createImeiChangeTestRequest({
    actor,
    operatorId = null,
    routerDeviceId = null,
    labName,
    jurisdiction,
    purpose,
    faradayCageEvidenceRef,
    rfLeakageTestRef,
    legalOpinionRef,
    responsibleEngineer,
    evidenceRefs = [],
    correlationId,
    ...extra
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "rf_lab.test.manage", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RF_LAB_TEST
    });
    const operator = operatorId ? this.#requireOperator(operatorId) : null;
    const router = routerDeviceId ? this.#requireDevice(routerDeviceId, DEVICE_TYPES.ROUTER, operatorId) : null;
    rejectOperationalRadioDetails({ purpose, evidenceRefs, extra });
    const record = {
      id: newId("rf_lab_test"),
      testType: "imei_change_characterization",
      status: "legal_review",
      operatorId,
      tenantId: operator?.tenantId || null,
      routerDeviceId: router?.id || null,
      labName: requireText(labName, "labName"),
      jurisdiction: requireText(jurisdiction, "jurisdiction"),
      purpose: requireText(purpose, "purpose"),
      faradayCageEvidenceRef: requireText(faradayCageEvidenceRef, "faradayCageEvidenceRef"),
      rfLeakageTestRef: requireText(rfLeakageTestRef, "rfLeakageTestRef"),
      legalOpinionRef: requireText(legalOpinionRef, "legalOpinionRef"),
      responsibleEngineer: requireText(responsibleEngineer, "responsibleEngineer"),
      approvals: Object.fromEntries(REQUIRED_APPROVALS.map((role) => [role, null])),
      evidenceRefs: safeArray(evidenceRefs, "evidenceRefs"),
      requiredConditions: {
        faradayCage: true,
        noPublicMobileNetwork: true,
        spectrumMonitoring: true,
        rawIdentifiersForbidden: true,
        productRuntimeExecutorAvailable: false
      },
      humanGateRequired: true,
      executionAllowed: false,
      productRuntimeExecutorAvailable: false,
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.tests.set(record.id, record);
    this.#audit(actor, "rf_lab.imei_test_requested", record, corr, "review_required");
    return publicRecord(record);
  }

  approve({ actor, testId, role, evidenceRef, comment = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "rf_lab.test.approve", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RF_LAB_TEST
    });
    const test = this.#requireTest(testId);
    if (!REQUIRED_APPROVALS.includes(role)) {
      throw validationError("Unsupported RF lab approval role", { role, supported: REQUIRED_APPROVALS });
    }
    rejectOperationalRadioDetails({ comment, evidenceRef });
    const next = {
      ...test,
      approvals: {
        ...test.approvals,
        [role]: {
          actorId: actor.id,
          evidenceRef: requireText(evidenceRef, "evidenceRef"),
          comment: comment || null,
          approvedAt: isoNow()
        }
      },
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    if (REQUIRED_APPROVALS.every((owner) => next.approvals[owner])) {
      next.status = "approved_for_isolated_lab_record_only";
    }
    this.tests.set(testId, next);
    this.#audit(actor, "rf_lab.imei_test_approval_recorded", next, corr, next.status);
    return publicRecord(next);
  }

  recordEvidence({
    actor,
    testId,
    isolationStillActive,
    publicNetworkObserved,
    spectrumMonitorRef,
    resultSummary,
    preChangeIdentifierHash = null,
    postChangeIdentifierHash = null,
    evidenceRefs = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "rf_lab.test.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RF_LAB_TEST
    });
    const test = this.#requireTest(testId);
    if (test.status !== "approved_for_isolated_lab_record_only") {
      throw validationError("RF lab test must be fully approved before evidence can be recorded", {
        status: test.status
      });
    }
    if (isolationStillActive !== true || publicNetworkObserved !== false) {
      throw validationError("RF lab evidence requires active isolation and no public mobile network observation", {
        isolationStillActive,
        publicNetworkObserved
      });
    }
    rejectOperationalRadioDetails({ resultSummary, spectrumMonitorRef, evidenceRefs, preChangeIdentifierHash, postChangeIdentifierHash });
    const evidence = {
      id: newId("rf_lab_evidence"),
      isolationStillActive: true,
      publicNetworkObserved: false,
      spectrumMonitorRef: requireText(spectrumMonitorRef, "spectrumMonitorRef"),
      resultSummary: requireText(resultSummary, "resultSummary"),
      preChangeIdentifierHash,
      postChangeIdentifierHash,
      evidenceRefs: safeArray(evidenceRefs, "evidenceRefs"),
      rawIdentifiersRedacted: true,
      recordedAt: isoNow(),
      recordedBy: actor.id
    };
    const next = {
      ...test,
      status: "evidence_recorded",
      evidence: [...(test.evidence || []), evidence],
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.tests.set(testId, next);
    this.#audit(actor, "rf_lab.imei_test_evidence_recorded", next, corr, "evidence_recorded");
    return publicRecord(next);
  }

  reject({ actor, testId, reason, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "rf_lab.test.approve", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RF_LAB_TEST
    });
    const test = this.#requireTest(testId);
    rejectOperationalRadioDetails({ reason });
    const next = {
      ...test,
      status: "rejected",
      rejectionReason: requireText(reason, "reason"),
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.tests.set(testId, next);
    this.#audit(actor, "rf_lab.imei_test_rejected", next, corr, "rejected");
    return publicRecord(next);
  }

  list({ actor, operatorId = null, status = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "rf_lab.test.read", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RF_LAB_TEST
    });
    if (status && !STATUSES.has(status)) throw validationError("Unsupported RF lab test status", { status });
    return [...this.tests.values()]
      .filter((record) => !operatorId || record.operatorId === operatorId)
      .filter((record) => !status || record.status === status)
      .map(publicRecord);
  }

  get({ actor, testId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "rf_lab.test.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RF_LAB_TEST
    });
    return publicRecord(this.#requireTest(testId));
  }

  assertNoProductExecution({ actor, testId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "rf_lab.test.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RF_LAB_TEST
    });
    const test = this.#requireTest(testId);
    this.#audit(actor, "rf_lab.product_execution_denied", test, corr, "product_runtime_executor_forbidden");
    throw forbidden("rf_lab.product_runtime_imei_change_executor");
  }

  #requireOperator(operatorId) {
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    return operator;
  }

  #requireDevice(deviceId, type, operatorId) {
    const device = this.devices.get(deviceId);
    if (!device) throw notFound("device", deviceId);
    if (device.type !== type) throw validationError("Device type mismatch", { deviceId, expected: type, actual: device.type });
    if (operatorId && device.assignedOperatorId !== operatorId) {
      throw validationError("Device is not assigned to this operator", { deviceId, operatorId });
    }
    return device;
  }

  #requireTest(testId) {
    const test = this.tests.get(testId);
    if (!test) throw notFound("rf_lab_test", testId);
    return test;
  }

  #audit(actor, action, record, correlationId, result) {
    this.audit.record({
      actorId: actor.id,
      action,
      resourceType: RESOURCE_TYPES.RF_LAB_TEST,
      resourceId: record.id,
      tenantId: record.tenantId,
      operatorId: record.operatorId,
      correlationId,
      policyDecision: action.endsWith("_denied") ? "deny" : "allow",
      result,
      newValue: publicRecord(record)
    });
  }
}
