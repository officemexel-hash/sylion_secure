import { createHash } from "node:crypto";
import { RESOURCE_TYPES } from "../../domain/constants.js";
import { validationError, notFound } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const BOUNDARY_STATUSES = new Set([
  "disabled_by_default",
  "review_only",
  "approved_placeholder",
  "blocked"
]);
const CAPABILITY_STATUSES = new Set([
  "not_enabled",
  "review_only",
  "blocked",
  "approved_placeholder"
]);
const REVIEW_STATUSES = new Set([
  "not_started",
  "required",
  "in_review",
  "approved_placeholder",
  "rejected",
  "blocked"
]);
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
const TIER_ORDER = Object.freeze({ STANDARD: 1, PRO: 2, SOVEREIGN: 3 });
const TEMPLATE_TIERS = new Set(["STANDARD", "PRO", "SOVEREIGN"]);
const PACKAGE_STAGES = new Set([
  "draft",
  "review_ready",
  "blocked",
  "approved_placeholder",
  "closed"
]);
const EVIDENCE_RETENTION_CLASSES = new Set(["worm_audit", "legal_hold", "short_review"]);
const SIMULATION_SCENARIOS = new Set([
  "readiness_review",
  "tier_fit",
  "operator_assignment",
  "audit_correlation"
]);
const REVIEW_BOARD_STATUSES = new Set([
  "intake",
  "legal_review",
  "ciso_review",
  "architect_review",
  "compliance_review",
  "approved_placeholder",
  "blocked",
  "closed"
]);
const POLICY_SIMULATION_SCENARIOS = new Set([
  "control_gap",
  "tier_fit",
  "evidence_completeness",
  "review_path"
]);
const EXCEPTION_STATUSES = new Set([
  "draft",
  "legal_review",
  "ciso_review",
  "compliance_review",
  "approved_placeholder",
  "rejected",
  "closed"
]);
const REVIEW_OWNER_KEYS = new Set(["legal", "ciso", "architect", "compliance"]);
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

const HARDENING_PLAN_VERSION = "sylion-3.0-phantom-v3.0-hardening-2026-06";
const HARDENING_DECISIONS = new Set([
  "implement_baseline_with_tests",
  "roadmap_human_gate",
  "phantom_human_gate",
  "lab_only_no_product_executor",
  "legal_review_only",
  "rejected_for_baseline"
]);
const DEFAULT_HARDENING_MILESTONES = Object.freeze([
  {
    id: "hs_01_streaming_broker_e2ee",
    title: "G2 streaming broker E2EE replacement track",
    layer: "application",
    decision: "roadmap_human_gate",
    baselineImpact:
      "Current broker can remain only with explicit residual-risk visibility until an approved end-to-end frame encryption design is proven.",
    implementationScope:
      "Evaluate a native pixel-stream path where G2 forwards encrypted frames and cannot inspect session content.",
    requiredEvidenceTypes: [
      "ADR",
      "threat model",
      "frame encryption proof",
      "broker visibility negative test"
    ],
    blockers: [
      "architecture_adr_required",
      "latency_and_input_tests_required",
      "broker_migration_plan_required"
    ],
    allowedInBaseline: false
  },
  {
    id: "hs_02_pqc_transport_migration",
    title: "Hybrid PQC transport migration roadmap",
    layer: "crypto",
    decision: "roadmap_human_gate",
    baselineImpact:
      "IPsec IKEv2 certificate auth remains baseline; PQC is a staged migration topic until algorithm support and compliance targets are approved.",
    implementationScope:
      "Create hybrid key-exchange policy, downgrade tests, compatibility matrix and crypto approval records.",
    requiredEvidenceTypes: [
      "crypto ADR",
      "algorithm support matrix",
      "downgrade test",
      "HSM impact note"
    ],
    blockers: [
      "crypto_board_approval_required",
      "strongswan_feature_evidence_required",
      "compliance_target_required"
    ],
    allowedInBaseline: false
  },
  {
    id: "hs_03_autonomous_perimeter",
    title: "SOVEREIGN autonomous perimeter qualification",
    layer: "hardware",
    decision: "phantom_human_gate",
    baselineImpact:
      "SOVEREIGN/PHANTOM perimeter is not a baseline shortcut; dedicated hardware and HSM custody require customer-specific approvals.",
    implementationScope:
      "Qualify bare-metal tenancy, data-center class, HSM custody, Shamir ceremony and audit evidence.",
    requiredEvidenceTypes: [
      "hardware qualification",
      "data-center evidence",
      "HSM ceremony",
      "customer risk acceptance"
    ],
    blockers: [
      "customer_specific_scope_required",
      "hsm_ceremony_required",
      "physical_control_evidence_required"
    ],
    allowedInBaseline: false
  },
  {
    id: "hs_04_terminal_radio_isolation",
    title: "Pixel and Puli AX terminal admission hardening",
    layer: "terminal",
    decision: "implement_baseline_with_tests",
    baselineImpact:
      "Terminal admission must require Pixel posture, router pairing evidence, FIDO2 readiness and no local operational data.",
    implementationScope:
      "Extend terminal admission tests for airplane-mode posture, WiFi pairing evidence, router path evidence and session-only thin client use.",
    requiredEvidenceTypes: [
      "Pixel posture evidence",
      "router pairing evidence",
      "FIDO2 readiness evidence",
      "path test"
    ],
    blockers: [
      "pixel_posture_probe_required",
      "router_pairing_probe_required",
      "adb_human_regression_required"
    ],
    allowedInBaseline: true
  },
  {
    id: "hs_05_esim_and_rf_lab_governance",
    title: "eSIM exclusion and RF lab telecom identity governance",
    layer: "telecom",
    decision: "lab_only_no_product_executor",
    baselineImpact:
      "Product runtime must not execute cellular identity mutation; lab characterization is record-only and approval-gated.",
    implementationScope:
      "Keep eSIM exclusion policy, RF lab request workflow, router software preflight and raw identifier redaction.",
    requiredEvidenceTypes: [
      "legal memo",
      "RF lab approval pack",
      "router software preflight",
      "Faraday cage evidence"
    ],
    blockers: ["lab_only_boundary_required", "legal_ciso_architect_hardware_approval_required"],
    allowedInBaseline: false
  },
  {
    id: "hs_06_transport_camouflage_review",
    title: "Transport camouflage and traffic-shaping review",
    layer: "network",
    decision: "legal_review_only",
    baselineImpact:
      "Baseline must not claim invisibility or censorship circumvention; any traffic shaping must be legally reviewed and customer-disclosed.",
    implementationScope:
      "Record legal review, customer disclosure language, route policy limits and residual metadata risk.",
    requiredEvidenceTypes: [
      "legal memo",
      "network policy ADR",
      "customer disclosure",
      "metadata risk note"
    ],
    blockers: [
      "legal_review_required",
      "product_claim_review_required",
      "metadata_risk_acceptance_required"
    ],
    allowedInBaseline: false
  },
  {
    id: "hs_07_ebpf_runtime_monitoring",
    title: "eBPF runtime monitoring and incident automation",
    layer: "ops",
    decision: "implement_baseline_with_tests",
    baselineImpact:
      "Host and workload monitoring can enter baseline if it emits metadata-only alerts and destructive actions stay approval-gated.",
    implementationScope:
      "Add Tetragon/Falco evidence, immutable host checks, SIEM records and incident playbooks.",
    requiredEvidenceTypes: [
      "agent install evidence",
      "kernel event test",
      "SIEM event",
      "incident playbook"
    ],
    blockers: [
      "host_agent_rollout_required",
      "metadata_only_alert_schema_required",
      "destructive_action_gate_required"
    ],
    allowedInBaseline: true
  },
  {
    id: "hs_08_safe_rotation_orchestration",
    title: "Safe rotation orchestration policy",
    layer: "orchestration",
    decision: "phantom_human_gate",
    baselineImpact:
      "Jurisdiction, certificate and workload placement rotation can be policy-driven; telecom identity changes remain lab-only/no product executor.",
    implementationScope:
      "Implement tier-gated provider/location rotation, certificate lifecycle evidence and safe router/Pixel MAC-pair simulation records.",
    requiredEvidenceTypes: [
      "provider policy",
      "certificate rotation evidence",
      "placement audit",
      "MAC-pair simulation"
    ],
    blockers: [
      "tier_policy_required",
      "provider_capacity_model_required",
      "rollback_plan_required"
    ],
    allowedInBaseline: false
  },
  {
    id: "hs_09_opsec_training_and_drills",
    title: "OPSEC training and emergency workflow drills",
    layer: "people",
    decision: "implement_baseline_with_tests",
    baselineImpact:
      "Training, checklist evidence and emergency workflows are baseline-compatible when they avoid unsafe claims and store no sensitive content.",
    implementationScope:
      "Create certification syllabus, quarterly exercise records, panic-code tests and operator acknowledgement evidence.",
    requiredEvidenceTypes: [
      "training syllabus",
      "exercise record",
      "panic-code negative test",
      "operator acknowledgement"
    ],
    blockers: ["syllabus_required", "exercise_evidence_required", "operator_ack_required"],
    allowedInBaseline: true
  }
]);

const DEFAULT_POLICY_TEMPLATES = Object.freeze([
  {
    id: "phantom_template_legal_ciso_architect",
    name: "Legal/CISO/Architect Review",
    tierMinimum: "PRO",
    controlObjectives: [
      "Separate track claim review",
      "Human gate ownership",
      "No baseline execution"
    ],
    requiredEvidenceTypes: ["legal memo", "CISO risk note", "architect boundary note"],
    humanGateRequired: true,
    sideEffectAllowed: false,
    executionAllowed: false
  },
  {
    id: "phantom_template_simulation_only",
    name: "Simulation-Only Readiness",
    tierMinimum: "STANDARD",
    controlObjectives: ["Simulation-only run", "No live connector", "Audit correlation"],
    requiredEvidenceTypes: ["simulation report", "audit event set"],
    humanGateRequired: true,
    sideEffectAllowed: false,
    executionAllowed: false
  },
  {
    id: "phantom_template_sovereign_exception",
    name: "Sovereign Exception Review",
    tierMinimum: "SOVEREIGN",
    controlObjectives: [
      "Legal jurisdiction review",
      "Customer evidence pack",
      "Residual risk sign-off"
    ],
    requiredEvidenceTypes: ["jurisdiction memo", "customer approval", "residual risk acceptance"],
    humanGateRequired: true,
    sideEffectAllowed: false,
    executionAllowed: false
  }
]);

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
    throw validationError(
      "PHANTOM governance records must not contain operational or prohibited details",
      {
        field,
        matched,
        boundary: "PHANTOM_GOVERNANCE_METADATA_ONLY"
      }
    );
  }
}

function safeArray(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw validationError(`${field} must be an array`, { field });
  }
  return value.map((item, index) => requireText(String(item), `${field}.${index}`, { min: 1 }));
}

function optionalId(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return requireText(value, field, { min: 2 });
}

function tierRank(tier) {
  return TIER_ORDER[tier] || 0;
}

function sealedReferenceHash(record) {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
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
  constructor({
    audit,
    rbac,
    entitlements = null,
    operators = null,
    monitoring = null,
    store = null
  }) {
    this.audit = audit;
    this.rbac = rbac;
    this.entitlements = entitlements;
    this.operators = operators;
    this.monitoring = monitoring;
    this.boundary = new PersistentMap({ store, collection: "phantom_boundary" });
    this.capabilities = new PersistentMap({ store, collection: "phantom_capabilities" });
    this.approvals = new PersistentMap({ store, collection: "phantom_approvals" });
    this.risks = new PersistentMap({ store, collection: "phantom_risks" });
    this.policyTemplates = new PersistentMap({ store, collection: "phantom_policy_templates" });
    this.packages = new PersistentMap({ store, collection: "phantom_packages" });
    this.evidenceBundles = new PersistentMap({ store, collection: "phantom_evidence_bundles" });
    this.approvalPacks = new PersistentMap({ store, collection: "phantom_approval_packs" });
    this.readinessEvaluations = new PersistentMap({
      store,
      collection: "phantom_readiness_evaluations"
    });
    this.simulationRuns = new PersistentMap({ store, collection: "phantom_simulation_runs" });
    this.assignmentPlans = new PersistentMap({ store, collection: "phantom_assignment_plans" });
    this.reviewBoardItems = new PersistentMap({ store, collection: "phantom_review_board_items" });
    this.policySimulations = new PersistentMap({ store, collection: "phantom_policy_simulations" });
    this.exceptions = new PersistentMap({ store, collection: "phantom_exceptions" });
    if (!this.boundary.get("current")) {
      this.boundary.set("current", boundaryRecord());
    }
    this.#seedPolicyTemplates();
  }

  getBoundary({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.boundary.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_BOUNDARY
    });
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
    this.rbac.assert(actor, "phantom.boundary.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_BOUNDARY
    });
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
    this.rbac.assert(actor, "phantom.capability.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_CAPABILITY
    });
    return [...this.capabilities.values()].map((item) => this.#publicCapability(item));
  }

  createCapability({
    actor,
    displayName,
    riskLevel = "restricted",
    controlsRequired = [],
    evidenceRefs = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.capability.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_CAPABILITY
    });
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

  updateCapabilityStatus({
    actor,
    capabilityId,
    implementationStatus,
    legalReviewStatus,
    cisoReviewStatus,
    architectReviewStatus,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.capability.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_CAPABILITY,
      resourceId: capabilityId
    });
    const previous = this.capabilities.get(capabilityId);
    if (!previous) throw notFound("phantom_capability", capabilityId);
    const next = {
      ...previous,
      implementationStatus: implementationStatus
        ? requireEnum(implementationStatus, CAPABILITY_STATUSES, "implementationStatus")
        : previous.implementationStatus,
      legalReviewStatus: legalReviewStatus
        ? requireEnum(legalReviewStatus, REVIEW_STATUSES, "legalReviewStatus")
        : previous.legalReviewStatus,
      cisoReviewStatus: cisoReviewStatus
        ? requireEnum(cisoReviewStatus, REVIEW_STATUSES, "cisoReviewStatus")
        : previous.cisoReviewStatus,
      architectReviewStatus: architectReviewStatus
        ? requireEnum(architectReviewStatus, REVIEW_STATUSES, "architectReviewStatus")
        : previous.architectReviewStatus,
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
    this.rbac.assert(actor, "phantom.approval.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_APPROVAL
    });
    return [...this.approvals.values()].map((item) => this.#publicApproval(item));
  }

  createApproval({
    actor,
    capabilityId = null,
    reasonCode,
    legalOwner,
    cisoOwner,
    architectOwner,
    evidenceRefs = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.approval.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_APPROVAL
    });
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
    this.rbac.assert(actor, "phantom.approval.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_APPROVAL,
      resourceId: approvalId
    });
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
    this.rbac.assert(actor, "phantom.risk.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_RISK
    });
    return [...this.risks.values()].map((item) => this.#publicRisk(item));
  }

  createRisk({
    actor,
    capabilityId = null,
    description,
    severity = "high",
    jurisdictionNotes = null,
    legalOwner,
    cisoOwner,
    residualRisk,
    mitigationPlan,
    evidenceRefs = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.risk.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_RISK
    });
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
    this.rbac.assert(actor, "phantom.risk.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_RISK,
      resourceId: riskId
    });
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

  listPolicyTemplates({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_POLICY_TEMPLATE
    });
    return [...this.policyTemplates.values()].map((item) => this.#publicPolicyTemplate(item));
  }

  createPolicyTemplate({
    actor,
    name,
    tierMinimum = "PRO",
    controlObjectives = [],
    requiredEvidenceTypes = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_POLICY_TEMPLATE
    });
    const template = {
      id: newId("phantom_template"),
      name: requireText(name, "name"),
      tierMinimum: requireEnum(tierMinimum, TEMPLATE_TIERS, "tierMinimum"),
      controlObjectives: safeArray(controlObjectives, "controlObjectives"),
      requiredEvidenceTypes: safeArray(requiredEvidenceTypes, "requiredEvidenceTypes"),
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.policyTemplates.set(template.id, template);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.policy_template_created",
      resourceType: RESOURCE_TYPES.PHANTOM_POLICY_TEMPLATE,
      resourceId: template.id,
      correlationId: corr,
      newValue: this.#publicPolicyTemplate(template)
    });
    return this.#publicPolicyTemplate(template);
  }

  listPackages({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_PACKAGE
    });
    return [...this.packages.values()].map((item) => this.#publicPackage(item));
  }

  createPackage({
    actor,
    name,
    description,
    policyTemplateId,
    capabilityIds = [],
    tierMinimum = null,
    owner = null,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_PACKAGE
    });
    const template = this.#requirePolicyTemplate(policyTemplateId);
    const normalizedCapabilityIds = safeArray(capabilityIds, "capabilityIds");
    normalizedCapabilityIds.forEach((capabilityId) => this.#requireCapability(capabilityId));
    const pkg = {
      id: newId("phantom_package"),
      name: requireText(name, "name"),
      description: requireText(description, "description"),
      policyTemplateId: template.id,
      capabilityIds: normalizedCapabilityIds,
      tierMinimum: tierMinimum
        ? requireEnum(tierMinimum, TEMPLATE_TIERS, "tierMinimum")
        : template.tierMinimum,
      owner: optionalText(owner, "owner") || actor.id,
      stage: "draft",
      readinessState: "not_evaluated",
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id,
      updatedAt: null
    };
    this.packages.set(pkg.id, pkg);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.package_created",
      resourceType: RESOURCE_TYPES.PHANTOM_PACKAGE,
      resourceId: pkg.id,
      correlationId: corr,
      newValue: this.#publicPackage(pkg)
    });
    return this.#publicPackage(pkg);
  }

  updatePackageStage({ actor, packageId, stage, note = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_PACKAGE,
      resourceId: packageId
    });
    const previous = this.packages.get(packageId);
    if (!previous) throw notFound("phantom_package", packageId);
    const next = {
      ...previous,
      stage: requireEnum(stage, PACKAGE_STAGES, "stage"),
      note: optionalText(note, "note"),
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.packages.set(next.id, next);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.package_stage_changed",
      resourceType: RESOURCE_TYPES.PHANTOM_PACKAGE,
      resourceId: next.id,
      correlationId: corr,
      previousValue: this.#publicPackage(previous),
      newValue: this.#publicPackage(next)
    });
    return this.#publicPackage(next);
  }

  listEvidenceBundles({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_EVIDENCE_BUNDLE
    });
    return [...this.evidenceBundles.values()].map((item) => this.#publicEvidenceBundle(item));
  }

  createEvidenceBundle({
    actor,
    packageId,
    summary,
    evidenceRefs = [],
    controlsSatisfied = [],
    retentionClass = "worm_audit",
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_EVIDENCE_BUNDLE
    });
    const pkg = this.#requirePackage(packageId);
    const bundle = {
      id: newId("phantom_evidence"),
      packageId: pkg.id,
      summary: requireText(summary, "summary"),
      evidenceRefs: safeArray(evidenceRefs, "evidenceRefs"),
      controlsSatisfied: safeArray(controlsSatisfied, "controlsSatisfied"),
      retentionClass: requireEnum(retentionClass, EVIDENCE_RETENTION_CLASSES, "retentionClass"),
      sealed: true,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    bundle.sealedHash = sealedReferenceHash(
      this.#publicEvidenceBundle({ ...bundle, sealedHash: null })
    );
    this.evidenceBundles.set(bundle.id, bundle);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.evidence_bundle_created",
      resourceType: RESOURCE_TYPES.PHANTOM_EVIDENCE_BUNDLE,
      resourceId: bundle.id,
      correlationId: corr,
      newValue: this.#publicEvidenceBundle(bundle)
    });
    return this.#publicEvidenceBundle(bundle);
  }

  listApprovalPacks({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_APPROVAL_PACK
    });
    return [...this.approvalPacks.values()].map((item) => this.#publicApprovalPack(item));
  }

  createApprovalPack({
    actor,
    packageId,
    approvalIds = [],
    evidenceBundleIds = [],
    summary,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_APPROVAL_PACK
    });
    const pkg = this.#requirePackage(packageId);
    const normalizedApprovalIds = safeArray(approvalIds, "approvalIds");
    normalizedApprovalIds.forEach((approvalId) => this.#requireApproval(approvalId));
    const normalizedEvidenceIds = safeArray(evidenceBundleIds, "evidenceBundleIds");
    normalizedEvidenceIds.forEach((bundleId) => this.#requireEvidenceBundle(bundleId));
    const pack = {
      id: newId("phantom_approval_pack"),
      packageId: pkg.id,
      approvalIds: normalizedApprovalIds,
      evidenceBundleIds: normalizedEvidenceIds,
      summary: requireText(summary, "summary"),
      requiredOwners: ["Architect", "CISO", "Legal", "Compliance"],
      status: "ready_for_review",
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.approvalPacks.set(pack.id, pack);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.approval_pack_created",
      resourceType: RESOURCE_TYPES.PHANTOM_APPROVAL_PACK,
      resourceId: pack.id,
      correlationId: corr,
      newValue: this.#publicApprovalPack(pack)
    });
    return this.#publicApprovalPack(pack);
  }

  evaluateReadiness({
    actor,
    packageId,
    approvalPackId = null,
    evidenceBundleId = null,
    operatorId = null,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_READINESS
    });
    const pkg = this.#requirePackage(packageId);
    const approvalPack = approvalPackId ? this.#requireApprovalPack(approvalPackId) : null;
    const evidenceBundle = evidenceBundleId ? this.#requireEvidenceBundle(evidenceBundleId) : null;
    const operator = operatorId ? this.#requireOperator(operatorId) : null;
    const blockers = [];
    const warnings = [];
    const template = this.#requirePolicyTemplate(pkg.policyTemplateId);

    if (this.#publicBoundary(this.boundary.get("current")).status === "blocked") {
      blockers.push("phantom_boundary_blocked");
    }
    if (pkg.stage === "blocked") {
      blockers.push("package_blocked");
    }
    if (!pkg.capabilityIds.length) {
      blockers.push("capability_required");
    }
    for (const capabilityId of pkg.capabilityIds) {
      const capability = this.#requireCapability(capabilityId);
      if (capability.implementationStatus !== "approved_placeholder") {
        blockers.push(`capability_${capabilityId}_not_approved_placeholder`);
      }
    }
    if (!approvalPack) {
      blockers.push("approval_pack_required");
    }
    if (!evidenceBundle) {
      blockers.push("evidence_bundle_required");
    } else {
      const requiredEvidence = template.requiredEvidenceTypes || [];
      if (evidenceBundle.evidenceRefs.length < requiredEvidence.length) {
        warnings.push("evidence_refs_below_template_count");
      }
    }
    if (operator && tierRank(operator.tier) < tierRank(pkg.tierMinimum)) {
      blockers.push("operator_tier_below_package_minimum");
    }

    const evaluation = {
      id: newId("phantom_readiness"),
      packageId: pkg.id,
      approvalPackId: approvalPack?.id || null,
      evidenceBundleId: evidenceBundle?.id || null,
      operatorId: operator?.id || null,
      readinessState: blockers.length ? "blocked" : "ready_for_human_gate",
      readinessScore: Math.max(0, 100 - blockers.length * 25 - warnings.length * 10),
      blockers,
      warnings,
      gateState: blockers.length ? "blocked" : "human_gate_required",
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      evaluatedAt: isoNow(),
      evaluatedBy: actor.id
    };
    this.readinessEvaluations.set(evaluation.id, evaluation);
    this.packages.set(pkg.id, {
      ...pkg,
      readinessState: evaluation.readinessState,
      updatedAt: isoNow(),
      updatedBy: actor.id
    });
    this.audit.record({
      actorId: actor.id,
      action: "phantom.readiness_evaluated",
      resourceType: RESOURCE_TYPES.PHANTOM_READINESS,
      resourceId: evaluation.id,
      operatorId: operator?.id,
      correlationId: corr,
      policyDecision: "deny",
      result: "blocked",
      newValue: this.#publicReadiness(evaluation)
    });
    return this.#publicReadiness(evaluation);
  }

  listReadinessEvaluations({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_READINESS
    });
    return [...this.readinessEvaluations.values()].map((item) => this.#publicReadiness(item));
  }

  runSimulation({
    actor,
    packageId,
    scenario = "readiness_review",
    assumptions = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_SIMULATION
    });
    const pkg = this.#requirePackage(packageId);
    const run = {
      id: newId("phantom_simulation"),
      packageId: pkg.id,
      scenario: requireEnum(scenario, SIMULATION_SCENARIOS, "scenario"),
      assumptions: safeArray(assumptions, "assumptions"),
      mode: "simulation_only",
      result: "review_required",
      findings: [
        "No live connector invoked",
        "No operational execution path available",
        "HUMAN GATE remains mandatory"
      ],
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.simulationRuns.set(run.id, run);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.simulation_run_created",
      resourceType: RESOURCE_TYPES.PHANTOM_SIMULATION,
      resourceId: run.id,
      correlationId: corr,
      newValue: this.#publicSimulationRun(run)
    });
    return this.#publicSimulationRun(run);
  }

  listSimulationRuns({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_SIMULATION
    });
    return [...this.simulationRuns.values()].map((item) => this.#publicSimulationRun(item));
  }

  createAssignmentPlan({ actor, packageId, operatorIds = [], correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_ASSIGNMENT_PLAN
    });
    const pkg = this.#requirePackage(packageId);
    const normalizedOperatorIds = safeArray(operatorIds, "operatorIds");
    const operatorSummaries = normalizedOperatorIds.map((operatorId) => {
      const operator = this.#requireOperator(operatorId);
      return {
        operatorId: operator.id,
        tier: operator.tier,
        eligible: tierRank(operator.tier) >= tierRank(pkg.tierMinimum),
        baseline: {
          vpsPerOperator: operator.baseline?.vpsPerOperator,
          cdrMandatory: operator.baseline?.cdrMandatory,
          router: operator.baseline?.router
        }
      };
    });
    const plan = {
      id: newId("phantom_assignment"),
      packageId: pkg.id,
      operators: operatorSummaries,
      status: operatorSummaries.every((item) => item.eligible)
        ? "ready_for_review"
        : "blocked_by_tier",
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.assignmentPlans.set(plan.id, plan);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.assignment_plan_created",
      resourceType: RESOURCE_TYPES.PHANTOM_ASSIGNMENT_PLAN,
      resourceId: plan.id,
      correlationId: corr,
      newValue: this.#publicAssignmentPlan(plan)
    });
    return this.#publicAssignmentPlan(plan);
  }

  listAssignmentPlans({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_ASSIGNMENT_PLAN
    });
    return [...this.assignmentPlans.values()].map((item) => this.#publicAssignmentPlan(item));
  }

  listReviewBoardItems({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_REVIEW_BOARD_ITEM
    });
    return [...this.reviewBoardItems.values()].map((item) => this.#publicReviewBoardItem(item));
  }

  createReviewBoardItem({
    actor,
    title,
    summary,
    packageId = null,
    legalOwner,
    cisoOwner,
    architectOwner,
    complianceOwner,
    evidenceRefs = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_REVIEW_BOARD_ITEM
    });
    if (packageId) this.#requirePackage(packageId);
    const item = {
      id: newId("phantom_review"),
      title: requireText(title, "title"),
      summary: requireText(summary, "summary"),
      packageId: optionalId(packageId, "packageId"),
      legalOwner: requireText(legalOwner, "legalOwner"),
      cisoOwner: requireText(cisoOwner, "cisoOwner"),
      architectOwner: requireText(architectOwner, "architectOwner"),
      complianceOwner: requireText(complianceOwner, "complianceOwner"),
      evidenceRefs: safeArray(evidenceRefs, "evidenceRefs"),
      status: "intake",
      requiredOwners: ["Architect", "CISO", "Legal", "Compliance/Product"],
      ownerAcknowledgements: {
        legal: false,
        ciso: false,
        architect: false,
        compliance: false
      },
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      createdAt: isoNow(),
      createdBy: actor.id,
      updatedAt: null,
      updatedBy: null
    };
    this.reviewBoardItems.set(item.id, item);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.review_board_item_created",
      resourceType: RESOURCE_TYPES.PHANTOM_REVIEW_BOARD_ITEM,
      resourceId: item.id,
      correlationId: corr,
      newValue: this.#publicReviewBoardItem(item)
    });
    return this.#publicReviewBoardItem(item);
  }

  updateReviewBoardStatus({ actor, itemId, status, note = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_REVIEW_BOARD_ITEM,
      resourceId: itemId
    });
    const previous = this.reviewBoardItems.get(itemId);
    if (!previous) throw notFound("phantom_review_board_item", itemId);
    const nextStatus = requireEnum(status, REVIEW_BOARD_STATUSES, "status");
    if (nextStatus === "approved_placeholder") {
      const acknowledgements = previous.ownerAcknowledgements || {};
      const missing = [...REVIEW_OWNER_KEYS].filter((owner) => acknowledgements[owner] !== true);
      if (missing.length) {
        throw validationError(
          "PHANTOM review board cannot reach approved_placeholder without all owner acknowledgements",
          {
            missing,
            executionAllowed: false
          }
        );
      }
      if (!previous.evidenceRefs?.length) {
        throw validationError(
          "PHANTOM review board requires evidence references before approved_placeholder",
          {
            itemId,
            executionAllowed: false
          }
        );
      }
    }
    const next = {
      ...previous,
      status: nextStatus,
      note: optionalText(note, "note") || previous.note || null,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.reviewBoardItems.set(next.id, next);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.review_board_status_changed",
      resourceType: RESOURCE_TYPES.PHANTOM_REVIEW_BOARD_ITEM,
      resourceId: next.id,
      correlationId: corr,
      previousValue: this.#publicReviewBoardItem(previous),
      newValue: this.#publicReviewBoardItem(next)
    });
    return this.#publicReviewBoardItem(next);
  }

  acknowledgeReviewBoardOwner({ actor, itemId, owner, note = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_REVIEW_BOARD_ITEM,
      resourceId: itemId
    });
    const previous = this.reviewBoardItems.get(itemId);
    if (!previous) throw notFound("phantom_review_board_item", itemId);
    const ownerKey = requireEnum(owner, REVIEW_OWNER_KEYS, "owner");
    const next = {
      ...previous,
      ownerAcknowledgements: {
        ...(previous.ownerAcknowledgements || {}),
        [ownerKey]: true
      },
      note: optionalText(note, "note") || previous.note || null,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.reviewBoardItems.set(next.id, next);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.review_board_owner_acknowledged",
      resourceType: RESOURCE_TYPES.PHANTOM_REVIEW_BOARD_ITEM,
      resourceId: next.id,
      correlationId: corr,
      previousValue: this.#publicReviewBoardItem(previous),
      newValue: this.#publicReviewBoardItem(next)
    });
    return this.#publicReviewBoardItem(next);
  }

  listPolicySimulations({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_POLICY_SIMULATION
    });
    return [...this.policySimulations.values()].map((item) => this.#publicPolicySimulation(item));
  }

  runPolicySimulation({
    actor,
    packageId = null,
    scenario = "control_gap",
    assumptions = [],
    expectedControls = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_POLICY_SIMULATION
    });
    const pkg = packageId ? this.#requirePackage(packageId) : null;
    const controls = safeArray(expectedControls, "expectedControls");
    const run = {
      id: newId("phantom_policy_sim"),
      packageId: pkg?.id || null,
      scenario: requireEnum(scenario, POLICY_SIMULATION_SCENARIOS, "scenario"),
      assumptions: safeArray(assumptions, "assumptions"),
      expectedControls: controls,
      findings: controls.length
        ? controls.map((control) => `review_required:${control}`)
        : ["review_required:human_gate", "review_required:no_baseline_execution"],
      mode: "policy_simulation_only",
      result: "review_required",
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.policySimulations.set(run.id, run);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.policy_simulation_created",
      resourceType: RESOURCE_TYPES.PHANTOM_POLICY_SIMULATION,
      resourceId: run.id,
      correlationId: corr,
      newValue: this.#publicPolicySimulation(run)
    });
    return this.#publicPolicySimulation(run);
  }

  listExceptions({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_EXCEPTION
    });
    return [...this.exceptions.values()].map((item) => this.#publicException(item));
  }

  createException({
    actor,
    scope,
    justification,
    legalOwner,
    cisoOwner,
    complianceOwner,
    evidenceRefs = [],
    status = "legal_review",
    executionRequested = false,
    packageId = null,
    reviewBoardItemId = null,
    evidenceBundleId = null,
    expiresAt,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.manage_placeholder", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_EXCEPTION
    });
    if (executionRequested === true) {
      throw validationError("PHANTOM exceptions cannot request execution", {
        boundary: "PHANTOM_REVIEW_ONLY"
      });
    }
    const expiry = Date.parse(expiresAt || "");
    if (!Number.isFinite(expiry)) {
      throw validationError("PHANTOM exception requires expiresAt revalidation date", {
        field: "expiresAt"
      });
    }
    if (packageId) this.#requirePackage(packageId);
    if (evidenceBundleId) this.#requireEvidenceBundle(evidenceBundleId);
    if (reviewBoardItemId && !this.reviewBoardItems.get(reviewBoardItemId)) {
      throw notFound("phantom_review_board_item", reviewBoardItemId);
    }
    const exception = {
      id: newId("phantom_exception"),
      packageId: optionalId(packageId, "packageId"),
      reviewBoardItemId: optionalId(reviewBoardItemId, "reviewBoardItemId"),
      evidenceBundleId: optionalId(evidenceBundleId, "evidenceBundleId"),
      scope: requireText(scope, "scope"),
      justification: requireText(justification, "justification"),
      legalOwner: requireText(legalOwner, "legalOwner"),
      cisoOwner: requireText(cisoOwner, "cisoOwner"),
      complianceOwner: requireText(complianceOwner, "complianceOwner"),
      evidenceRefs: safeArray(evidenceRefs, "evidenceRefs"),
      status: requireEnum(status, EXCEPTION_STATUSES, "status"),
      expiresAt: new Date(expiry).toISOString(),
      expired: expiry <= Date.now(),
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      createdAt: isoNow(),
      createdBy: actor.id,
      updatedAt: null,
      updatedBy: null
    };
    this.exceptions.set(exception.id, exception);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.exception_created",
      resourceType: RESOURCE_TYPES.PHANTOM_EXCEPTION,
      resourceId: exception.id,
      correlationId: corr,
      policyDecision: "deny",
      result: "blocked",
      newValue: this.#publicException(exception)
    });
    return this.#publicException(exception);
  }

  evidenceCoverage({ actor, packageId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_POLICY_SIMULATION
    });
    const pkg = this.#requirePackage(packageId);
    const template = this.#requirePolicyTemplate(pkg.policyTemplateId);
    const bundles = [...this.evidenceBundles.values()].filter((item) => item.packageId === pkg.id);
    const approvalPacks = [...this.approvalPacks.values()].filter(
      (item) => item.packageId === pkg.id
    );
    const boardItems = [...this.reviewBoardItems.values()].filter(
      (item) => item.packageId === pkg.id
    );
    const simulations = [...this.policySimulations.values()].filter(
      (item) => item.packageId === pkg.id
    );
    const exceptions = [...this.exceptions.values()].filter((item) => item.packageId === pkg.id);
    const requiredEvidence = template.requiredEvidenceTypes || [];
    const evidenceRefs = bundles.flatMap((bundle) => bundle.evidenceRefs || []);
    const blockers = [];
    if (evidenceRefs.length < requiredEvidence.length)
      blockers.push("required_evidence_refs_missing");
    if (!approvalPacks.length) blockers.push("approval_pack_missing");
    if (!boardItems.length) blockers.push("review_board_item_missing");
    if (!simulations.length) blockers.push("policy_simulation_missing");
    if (exceptions.some((item) => Date.parse(item.expiresAt) <= Date.now()))
      blockers.push("expired_exception_requires_review");
    const checks = [
      evidenceRefs.length >= requiredEvidence.length,
      approvalPacks.length > 0,
      boardItems.length > 0,
      simulations.length > 0,
      !exceptions.some((item) => Date.parse(item.expiresAt) <= Date.now())
    ];
    const coverage = {
      id: `coverage_${pkg.id}`,
      packageId: pkg.id,
      requiredEvidenceTypes: requiredEvidence,
      evidenceRefCount: evidenceRefs.length,
      approvalPackCount: approvalPacks.length,
      reviewBoardItemCount: boardItems.length,
      policySimulationCount: simulations.length,
      exceptionCount: exceptions.length,
      coveragePercent: Math.round((checks.filter(Boolean).length / checks.length) * 100),
      blockers,
      status: blockers.length ? "blocked" : "ready_for_human_gate",
      certificationClaim: false,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      evaluatedAt: isoNow()
    };
    this.audit.record({
      actorId: actor.id,
      action: "phantom.evidence_coverage_evaluated",
      resourceType: RESOURCE_TYPES.PHANTOM_POLICY_SIMULATION,
      resourceId: coverage.id,
      correlationId: corr,
      policyDecision: "deny",
      result: blockers.length ? "blocked" : "review_required",
      newValue: coverage
    });
    return coverage;
  }

  auditCorrelation({ actor, packageId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.lifecycle.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_READINESS
    });
    const packageFilter = optionalId(packageId, "packageId");
    const events = this.audit.list().filter((event) => {
      if (!String(event.action || "").startsWith("phantom.")) return false;
      if (!packageFilter) return true;
      return (
        event.resourceId === packageFilter ||
        event.newValue?.packageId === packageFilter ||
        event.previousValue?.packageId === packageFilter
      );
    });
    const summary = {
      packageId: packageFilter,
      eventCount: events.length,
      actions: [...new Set(events.map((event) => event.action))].sort(),
      latestHash: events.at(-1)?.hash || null,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false
    };
    this.audit.record({
      actorId: actor.id,
      action: "phantom.audit_correlation_read",
      resourceType: RESOURCE_TYPES.PHANTOM_READINESS,
      resourceId: packageFilter,
      correlationId: corr,
      newValue: summary
    });
    return summary;
  }

  getHardeningPlan({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.hardening.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_HARDENING_PLAN
    });
    const plan = this.#hardeningPlanRecord();
    this.audit.record({
      actorId: actor.id,
      action: "phantom.hardening_plan_read",
      resourceType: RESOURCE_TYPES.PHANTOM_HARDENING_PLAN,
      resourceId: plan.id,
      correlationId: corr,
      newValue: plan
    });
    return plan;
  }

  evaluateHardeningPlan({ actor, evidenceRefsByMilestone = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "phantom.hardening.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PHANTOM_HARDENING_PLAN
    });
    if (
      !evidenceRefsByMilestone ||
      typeof evidenceRefsByMilestone !== "object" ||
      Array.isArray(evidenceRefsByMilestone)
    ) {
      throw validationError("evidenceRefsByMilestone must be an object", {
        field: "evidenceRefsByMilestone"
      });
    }
    const knownIds = new Set(DEFAULT_HARDENING_MILESTONES.map((milestone) => milestone.id));
    for (const key of Object.keys(evidenceRefsByMilestone)) {
      if (!knownIds.has(key)) {
        throw validationError("Unknown hardening milestone", {
          field: `evidenceRefsByMilestone.${key}`
        });
      }
    }
    const evaluations = DEFAULT_HARDENING_MILESTONES.map((milestone) => {
      const evidenceRefs = safeArray(
        evidenceRefsByMilestone[milestone.id] || [],
        `evidenceRefsByMilestone.${milestone.id}`
      );
      const evidenceComplete = evidenceRefs.length >= milestone.requiredEvidenceTypes.length;
      const blockedByPolicy =
        milestone.decision === "legal_review_only" ||
        milestone.decision === "lab_only_no_product_executor";
      const state = evidenceComplete
        ? "ready_for_human_gate"
        : blockedByPolicy
          ? "blocked_by_policy_pending_evidence"
          : "evidence_required";
      return {
        milestoneId: milestone.id,
        decision: requireEnum(milestone.decision, HARDENING_DECISIONS, "decision"),
        state,
        evidenceRefs,
        evidenceComplete,
        missingEvidenceTypes: evidenceComplete
          ? []
          : milestone.requiredEvidenceTypes.slice(evidenceRefs.length),
        blockers: evidenceComplete ? [] : milestone.blockers,
        humanGateRequired: true,
        sideEffectAllowed: false,
        executionAllowed: false,
        executionEnabled: false,
        productionExecutionAllowed: false
      };
    });
    const evaluation = {
      id: newId("phantom_hardening_eval"),
      planId: HARDENING_PLAN_VERSION,
      evaluations,
      summary: {
        milestones: evaluations.length,
        readyForHumanGate: evaluations.filter((item) => item.state === "ready_for_human_gate")
          .length,
        evidenceRequired: evaluations.filter((item) => item.state === "evidence_required").length,
        blockedByPolicyPendingEvidence: evaluations.filter(
          (item) => item.state === "blocked_by_policy_pending_evidence"
        ).length,
        executionAllowed: false,
        productionExecutionAllowed: false
      },
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      productionExecutionAllowed: false,
      evaluatedAt: isoNow(),
      evaluatedBy: actor.id
    };
    this.audit.record({
      actorId: actor.id,
      action: "phantom.hardening_plan_evaluated",
      resourceType: RESOURCE_TYPES.PHANTOM_HARDENING_PLAN,
      resourceId: evaluation.id,
      correlationId: corr,
      policyDecision: "deny",
      result: "human_gate_required",
      newValue: evaluation
    });
    return evaluation;
  }

  #hardeningPlanRecord() {
    const milestones = DEFAULT_HARDENING_MILESTONES.map((milestone) => ({
      ...milestone,
      decision: requireEnum(milestone.decision, HARDENING_DECISIONS, "decision"),
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      productionExecutionAllowed: false
    }));
    return {
      id: HARDENING_PLAN_VERSION,
      title: "SYLION 3.0 / PHANTOM v3.0 hardening control plan",
      posture: "policy_as_code_review_only",
      milestones,
      summary: {
        milestones: milestones.length,
        baselineImplementable: milestones.filter((item) => item.allowedInBaseline).length,
        nonBaseline: milestones.filter((item) => !item.allowedInBaseline).length,
        labOnlyNoProductExecutor: milestones.filter(
          (item) => item.decision === "lab_only_no_product_executor"
        ).length,
        legalReviewOnly: milestones.filter((item) => item.decision === "legal_review_only").length,
        roadmapHumanGate: milestones.filter((item) => item.decision === "roadmap_human_gate")
          .length,
        phantomHumanGate: milestones.filter((item) => item.decision === "phantom_human_gate")
          .length,
        executionAllowed: false,
        productionExecutionAllowed: false
      },
      legalReviewRequired: true,
      cisoReviewRequired: true,
      architectReviewRequired: true,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      productionExecutionAllowed: false
    };
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

  #seedPolicyTemplates() {
    for (const template of DEFAULT_POLICY_TEMPLATES) {
      if (!this.policyTemplates.get(template.id)) {
        this.policyTemplates.set(template.id, {
          ...template,
          createdAt: null,
          createdBy: "system"
        });
      }
    }
  }

  #requirePolicyTemplate(templateId) {
    const template = this.policyTemplates.get(templateId);
    if (!template) throw notFound("phantom_policy_template", templateId);
    return template;
  }

  #requirePackage(packageId) {
    const pkg = this.packages.get(packageId);
    if (!pkg) throw notFound("phantom_package", packageId);
    return pkg;
  }

  #requireCapability(capabilityId) {
    const capability = this.capabilities.get(capabilityId);
    if (!capability) throw notFound("phantom_capability", capabilityId);
    return capability;
  }

  #requireApproval(approvalId) {
    const approval = this.approvals.get(approvalId);
    if (!approval) throw notFound("phantom_approval", approvalId);
    return approval;
  }

  #requireEvidenceBundle(bundleId) {
    const bundle = this.evidenceBundles.get(bundleId);
    if (!bundle) throw notFound("phantom_evidence_bundle", bundleId);
    return bundle;
  }

  #requireApprovalPack(packId) {
    const pack = this.approvalPacks.get(packId);
    if (!pack) throw notFound("phantom_approval_pack", packId);
    return pack;
  }

  #requireOperator(operatorId) {
    const operator = this.operators?.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    return operator;
  }

  #publicPolicyTemplate(record) {
    return {
      id: record.id,
      name: record.name,
      tierMinimum: record.tierMinimum,
      controlObjectives: record.controlObjectives,
      requiredEvidenceTypes: record.requiredEvidenceTypes,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      createdAt: record.createdAt,
      createdBy: record.createdBy
    };
  }

  #publicPackage(record) {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      policyTemplateId: record.policyTemplateId,
      capabilityIds: record.capabilityIds,
      tierMinimum: record.tierMinimum,
      owner: record.owner,
      stage: record.stage,
      readinessState: record.readinessState,
      note: record.note || null,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy
    };
  }

  #publicEvidenceBundle(record) {
    return {
      id: record.id,
      packageId: record.packageId,
      summary: record.summary,
      evidenceRefs: record.evidenceRefs,
      controlsSatisfied: record.controlsSatisfied,
      retentionClass: record.retentionClass,
      sealed: true,
      sealedHash: record.sealedHash,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      createdAt: record.createdAt,
      createdBy: record.createdBy
    };
  }

  #publicApprovalPack(record) {
    return {
      id: record.id,
      packageId: record.packageId,
      approvalIds: record.approvalIds,
      evidenceBundleIds: record.evidenceBundleIds,
      summary: record.summary,
      requiredOwners: record.requiredOwners,
      status: record.status,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      createdAt: record.createdAt,
      createdBy: record.createdBy
    };
  }

  #publicReadiness(record) {
    return {
      id: record.id,
      packageId: record.packageId,
      approvalPackId: record.approvalPackId,
      evidenceBundleId: record.evidenceBundleId,
      operatorId: record.operatorId,
      readinessState: record.readinessState,
      readinessScore: record.readinessScore,
      blockers: record.blockers,
      warnings: record.warnings,
      gateState: record.gateState,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      evaluatedAt: record.evaluatedAt,
      evaluatedBy: record.evaluatedBy
    };
  }

  #publicSimulationRun(record) {
    return {
      id: record.id,
      packageId: record.packageId,
      scenario: record.scenario,
      assumptions: record.assumptions,
      mode: "simulation_only",
      result: record.result,
      findings: record.findings,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      createdAt: record.createdAt,
      createdBy: record.createdBy
    };
  }

  #publicAssignmentPlan(record) {
    return {
      id: record.id,
      packageId: record.packageId,
      operators: record.operators,
      status: record.status,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      createdAt: record.createdAt,
      createdBy: record.createdBy
    };
  }

  #publicReviewBoardItem(record) {
    return {
      id: record.id,
      title: record.title,
      summary: record.summary,
      packageId: record.packageId,
      legalOwner: record.legalOwner,
      cisoOwner: record.cisoOwner,
      architectOwner: record.architectOwner,
      complianceOwner: record.complianceOwner,
      evidenceRefs: record.evidenceRefs,
      status: record.status,
      requiredOwners: record.requiredOwners,
      ownerAcknowledgements: record.ownerAcknowledgements || {
        legal: false,
        ciso: false,
        architect: false,
        compliance: false
      },
      note: record.note || null,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy
    };
  }

  #publicPolicySimulation(record) {
    return {
      id: record.id,
      packageId: record.packageId,
      scenario: record.scenario,
      assumptions: record.assumptions,
      expectedControls: record.expectedControls,
      findings: record.findings,
      mode: "policy_simulation_only",
      result: record.result,
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      createdAt: record.createdAt,
      createdBy: record.createdBy
    };
  }

  #publicException(record) {
    return {
      id: record.id,
      packageId: record.packageId || null,
      reviewBoardItemId: record.reviewBoardItemId || null,
      evidenceBundleId: record.evidenceBundleId || null,
      scope: record.scope,
      justification: record.justification,
      legalOwner: record.legalOwner,
      cisoOwner: record.cisoOwner,
      complianceOwner: record.complianceOwner,
      evidenceRefs: record.evidenceRefs,
      status: record.status,
      expiresAt: record.expiresAt,
      expired: Date.parse(record.expiresAt) <= Date.now(),
      humanGateRequired: true,
      sideEffectAllowed: false,
      executionAllowed: false,
      executionEnabled: false,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      updatedAt: record.updatedAt,
      updatedBy: record.updatedBy
    };
  }
}
