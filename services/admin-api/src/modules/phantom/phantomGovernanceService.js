import { RESOURCE_TYPES } from "../../domain/constants.js";
import { validationError, notFound } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const BOUNDARY_STATUSES = new Set(["disabled_by_default", "review_only", "approved_placeholder", "blocked"]);
const CAPABILITY_STATUSES = new Set(["not_enabled", "review_only", "blocked", "approved_placeholder"]);
const REVIEW_STATUSES = new Set(["not_started", "required", "in_review", "approved_placeholder", "rejected", "blocked"]);
const APPROVAL_STATUSES = new Set([
  "draft",
  "legal_review_required",
  "ciso_review_required",
  "architect_review_required",
  "rejected",
  "approved_placeholder",
  "blocked",
  "closed"
]);
const RISK_STATUSES = new Set(["open", "mitigating", "accepted_placeholder", "blocked", "closed"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const RISK_LEVELS = new Set(["low", "medium", "high", "restricted"]);
const PROHIBITED_TERMS = [
  "imei",
  "imsi",
  "spoof",
  "spoofing",
  "evasion",
  "evade",
  "lawful intercept bypass",
  "bypass lawful",
  "stealth transport",
  "hide from law enforcement",
  "destroy evidence",
  "unauthorized access"
];

function isoNow() {
  return new Date().toISOString();
}

function requireText(value, field, { min = 2 } = {}) {
  if (!value || typeof value !== "string" || value.trim().length < min) {
    throw validationError(`${field} is required`, { field });
  }
  const text = value.trim();
  assertSafeGovernanceText(text, field);
  return text;
}

function optionalText(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return requireText(value, field, { min: 1 });
}

function requireEnum(value, allowed, field) {
  if (!allowed.has(value)) {
    throw validationError(`Unsupported ${field}`, { field, value, allowed: [...allowed] });
  }
  return value;
}

function assertSafeGovernanceText(value, field = "text") {
  const text = String(value || "").toLowerCase();
  const matched = PROHIBITED_TERMS.find((term) => text.includes(term));
  if (matched) {
    throw validationError("PHANTOM governance records must not contain operational or prohibited details", {
      field,
      matched,
      boundary: "PHANTOM_GOVERNANCE_METADATA_ONLY"
    });
  }
}

function safeArray(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw validationError(`${field} must be an array`, { field });
  }
  return value.map((item, index) => requireText(String(item), `${field}.${index}`, { min: 1 }));
}

function boundaryRecord(input = {}) {
  return {
    id: "phantom_boundary",
    status: input.status || "disabled_by_default",
    baselineBoundary: "SYLION_BASELINE_SEPARATE",
    phantomBoundary: "PHANTOM_V3_SEPARATE_TRACK",
    humanGateRequired: true,
    sideEffectAllowed: false,
    executionEnabled: false,
    legalReviewRequired: true,
    cisoReviewRequired: true,
    architectReviewRequired: true,
    updatedAt: input.updatedAt || null,
    updatedBy: input.updatedBy || null,
    note: input.note || "Governance-only boundary. No PHANTOM execution in baseline."
  };
}

export class PhantomGovernanceService {
  constructor({ audit, rbac, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.boundary = new PersistentMap({ store, collection: "phantom_boundary" });
    this.capabilities = new PersistentMap({ store, collection: "phantom_capabilities" });
    this.approvals = new PersistentMap({ store, collection: "phantom_approvals" });
    this.risks = new PersistentMap({ store, collection: "phantom_risks" });
    if (!this.boundary.get("current")) {
      this.boundary.set("current", boundaryRecord());
    }
  }

  getBoundary({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.boundary.read", { correlationId: corr, resourceType: RESOURCE_TYPES.PHANTOM_BOUNDARY });
    const record = this.#publicBoundary(this.boundary.get("current"));
    this.audit.record({
      actorId: actor.id,
      action: "phantom.boundary_read",
      resourceType: RESOURCE_TYPES.PHANTOM_BOUNDARY,
      resourceId: record.id,
      correlationId: corr,
      newValue: record
    });
    return record;
  }

  updateBoundaryStatus({ actor, status, note = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.boundary.manage_placeholder", { correlationId: corr, resourceType: RESOURCE_TYPES.PHANTOM_BOUNDARY });
    const previous = this.boundary.get("current");
    const next = boundaryRecord({
      ...previous,
      status: requireEnum(status, BOUNDARY_STATUSES, "status"),
      note: optionalText(note, "note") || previous.note,
      updatedAt: isoNow(),
      updatedBy: actor.id
    });
    this.boundary.set("current", next);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.boundary_status_changed",
      resourceType: RESOURCE_TYPES.PHANTOM_BOUNDARY,
      resourceId: next.id,
      correlationId: corr,
      previousValue: this.#publicBoundary(previous),
      newValue: this.#publicBoundary(next)
    });
    return this.#publicBoundary(next);
  }

  listCapabilities({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.capability.read", { correlationId: corr, resourceType: RESOURCE_TYPES.PHANTOM_CAPABILITY });
    return [...this.capabilities.values()].map((item) => this.#publicCapability(item));
  }

  createCapability({ actor, displayName, riskLevel = "restricted", controlsRequired = [], evidenceRefs = [], correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.capability.manage_placeholder", { correlationId: corr, resourceType: RESOURCE_TYPES.PHANTOM_CAPABILITY });
    const capability = {
      id: newId("phantom_capability"),
      displayName: requireText(displayName, "displayName"),
      classification: "A/autonomous separate track",
      riskLevel: requireEnum(riskLevel, RISK_LEVELS, "riskLevel"),
      legalReviewStatus: "required",
      cisoReviewStatus: "required",
      architectReviewStatus: "required",
      implementationStatus: "review_only",
      controlsRequired: safeArray(controlsRequired, "controlsRequired"),
      evidenceRefs: safeArray(evidenceRefs, "evidenceRefs"),
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionEnabled: false,
      createdAt: isoNow(),
      updatedAt: null,
      updatedBy: null
    };
    this.capabilities.set(capability.id, capability);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.capability_created",
      resourceType: RESOURCE_TYPES.PHANTOM_CAPABILITY,
      resourceId: capability.id,
      correlationId: corr,
      newValue: this.#publicCapability(capability)
    });
    return this.#publicCapability(capability);
  }

  updateCapabilityStatus({ actor, capabilityId, implementationStatus, legalReviewStatus, cisoReviewStatus, architectReviewStatus, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.capability.manage_placeholder", { correlationId: corr, resourceType: RESOURCE_TYPES.PHANTOM_CAPABILITY, resourceId: capabilityId });
    const previous = this.capabilities.get(capabilityId);
    if (!previous) throw notFound("phantom_capability", capabilityId);
    const next = {
      ...previous,
      implementationStatus: implementationStatus ? requireEnum(implementationStatus, CAPABILITY_STATUSES, "implementationStatus") : previous.implementationStatus,
      legalReviewStatus: legalReviewStatus ? requireEnum(legalReviewStatus, REVIEW_STATUSES, "legalReviewStatus") : previous.legalReviewStatus,
      cisoReviewStatus: cisoReviewStatus ? requireEnum(cisoReviewStatus, REVIEW_STATUSES, "cisoReviewStatus") : previous.cisoReviewStatus,
      architectReviewStatus: architectReviewStatus ? requireEnum(architectReviewStatus, REVIEW_STATUSES, "architectReviewStatus") : previous.architectReviewStatus,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionEnabled: false,
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.capabilities.set(next.id, next);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.capability_status_changed",
      resourceType: RESOURCE_TYPES.PHANTOM_CAPABILITY,
      resourceId: next.id,
      correlationId: corr,
      previousValue: this.#publicCapability(previous),
      newValue: this.#publicCapability(next)
    });
    return this.#publicCapability(next);
  }

  listApprovals({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.approval.read", { correlationId: corr, resourceType: RESOURCE_TYPES.PHANTOM_APPROVAL });
    return [...this.approvals.values()].map((item) => this.#publicApproval(item));
  }

  createApproval({ actor, capabilityId = null, reasonCode, legalOwner, cisoOwner, architectOwner, evidenceRefs = [], correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.approval.manage_placeholder", { correlationId: corr, resourceType: RESOURCE_TYPES.PHANTOM_APPROVAL });
    const approval = {
      id: newId("phantom_approval"),
      capabilityId: optionalText(capabilityId, "capabilityId"),
      reasonCode: requireText(reasonCode, "reasonCode"),
      requester: { actorId: actor.id, sessionId: actor.sessionId },
      legalOwner: requireText(legalOwner, "legalOwner"),
      cisoOwner: requireText(cisoOwner, "cisoOwner"),
      architectOwner: requireText(architectOwner, "architectOwner"),
      evidenceRefs: safeArray(evidenceRefs, "evidenceRefs"),
      status: "legal_review_required",
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionEnabled: false,
      createdAt: isoNow(),
      updatedAt: null,
      updatedBy: null
    };
    this.approvals.set(approval.id, approval);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.approval_created",
      resourceType: RESOURCE_TYPES.PHANTOM_APPROVAL,
      resourceId: approval.id,
      correlationId: corr,
      newValue: this.#publicApproval(approval)
    });
    return this.#publicApproval(approval);
  }

  updateApprovalStatus({ actor, approvalId, status, note = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.approval.manage_placeholder", { correlationId: corr, resourceType: RESOURCE_TYPES.PHANTOM_APPROVAL, resourceId: approvalId });
    const previous = this.approvals.get(approvalId);
    if (!previous) throw notFound("phantom_approval", approvalId);
    const next = {
      ...previous,
      status: requireEnum(status, APPROVAL_STATUSES, "status"),
      note: optionalText(note, "note"),
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionEnabled: false,
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.approvals.set(next.id, next);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.approval_status_changed",
      resourceType: RESOURCE_TYPES.PHANTOM_APPROVAL,
      resourceId: next.id,
      correlationId: corr,
      previousValue: this.#publicApproval(previous),
      newValue: this.#publicApproval(next)
    });
    return this.#publicApproval(next);
  }

  listRisks({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.risk.read", { correlationId: corr, resourceType: RESOURCE_TYPES.PHANTOM_RISK });
    return [...this.risks.values()].map((item) => this.#publicRisk(item));
  }

  createRisk({ actor, capabilityId = null, description, severity = "high", jurisdictionNotes = null, legalOwner, cisoOwner, residualRisk, mitigationPlan, evidenceRefs = [], correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.risk.manage_placeholder", { correlationId: corr, resourceType: RESOURCE_TYPES.PHANTOM_RISK });
    const risk = {
      id: newId("phantom_risk"),
      capabilityId: optionalText(capabilityId, "capabilityId"),
      description: requireText(description, "description"),
      severity: requireEnum(severity, SEVERITIES, "severity"),
      jurisdictionNotes: optionalText(jurisdictionNotes, "jurisdictionNotes"),
      legalOwner: requireText(legalOwner, "legalOwner"),
      cisoOwner: requireText(cisoOwner, "cisoOwner"),
      residualRisk: requireText(residualRisk, "residualRisk"),
      mitigationPlan: requireText(mitigationPlan, "mitigationPlan"),
      evidenceRefs: safeArray(evidenceRefs, "evidenceRefs"),
      status: "open",
      humanGateRequired: true,
      sideEffectAllowed: false,
      createdAt: isoNow(),
      updatedAt: null,
      updatedBy: null
    };
    this.risks.set(risk.id, risk);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.risk_created",
      resourceType: RESOURCE_TYPES.PHANTOM_RISK,
      resourceId: risk.id,
      correlationId: corr,
      newValue: this.#publicRisk(risk)
    });
    return this.#publicRisk(risk);
  }

  updateRiskStatus({ actor, riskId, status, note = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.risk.manage_placeholder", { correlationId: corr, resourceType: RESOURCE_TYPES.PHANTOM_RISK, resourceId: riskId });
    const previous = this.risks.get(riskId);
    if (!previous) throw notFound("phantom_risk", riskId);
    const next = {
      ...previous,
      status: requireEnum(status, RISK_STATUSES, "status"),
      note: optionalText(note, "note"),
      humanGateRequired: true,
      sideEffectAllowed: false,
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.risks.set(next.id, next);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.risk_status_changed",
      resourceType: RESOURCE_TYPES.PHANTOM_RISK,
      resourceId: next.id,
      correlationId: corr,
      previousValue: this.#publicRisk(previous),
      newValue: this.#publicRisk(next)
    });
    return this.#publicRisk(next);
  }

  #publicBoundary(record) {
    return boundaryRecord(record);
  }

  #publicCapability(record) {
    return {
      id: record.id,
      displayName: record.displayName,
      classification: record.classification,
      riskLevel: record.riskLevel,
      legalReviewStatus: record.legalReviewStatus,
      cisoReviewStatus: record.cisoReviewStatus,
      architectReviewStatus: record.architectReviewStatus,
      implementationStatus: record.implementationStatus,
      controlsRequired: record.controlsRequired,
      evidenceRefs: record.evidenceRefs,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionEnabled: false,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy
    };
  }

  #publicApproval(record) {
    return {
      id: record.id,
      capabilityId: record.capabilityId,
      reasonCode: record.reasonCode,
      requester: record.requester,
      legalOwner: record.legalOwner,
      cisoOwner: record.cisoOwner,
      architectOwner: record.architectOwner,
      evidenceRefs: record.evidenceRefs,
      status: record.status,
      note: record.note || null,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionEnabled: false,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy
    };
  }

  #publicRisk(record) {
    return {
      id: record.id,
      capabilityId: record.capabilityId,
      description: record.description,
      severity: record.severity,
      jurisdictionNotes: record.jurisdictionNotes,
      legalOwner: record.legalOwner,
      cisoOwner: record.cisoOwner,
      residualRisk: record.residualRisk,
      mitigationPlan: record.mitigationPlan,
      evidenceRefs: record.evidenceRefs,
      status: record.status,
      note: record.note || null,
      humanGateRequired: true,
      sideEffectAllowed: false,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy
    };
  }
}
