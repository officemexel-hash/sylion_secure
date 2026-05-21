import { createHash } from "node:crypto";
import { RESOURCE_TYPES } from "../../domain/constants.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { validationError, notFound } from "../../lib/errors.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const GATE_STATUSES = new Set(["implemented", "partial", "blocked", "blocked_human_gate", "dry_run_ready", "review_required", "verified"]);
const PROBLEM_STATUSES = new Set(["open", "triaged", "in_progress", "fixed_pending_test", "verified", "accepted_risk", "blocked_human_gate"]);
const PROBLEM_CATEGORIES = new Set(["defect", "ux_issue", "test_gap", "compliance_gap", "architecture_gap", "security_gap"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const TEST_STATUSES = new Set(["not_run", "running", "passed", "failed", "blocked", "needs_human_review"]);
const TEST_RUN_MODES = new Set(["playwright_dashboard", "operator_portal", "manual_human", "mixed_human_playwright"]);
const ARTIFACT_TYPES = new Set(["screenshot", "test_log", "json_summary", "release_note", "coverage_report", "manual_note"]);
const PROHIBITED_TERMS = ["imei", "imsi", "spoof", "evasion", "evade", "bypass lawful", "destroy evidence", "unauthorized access"];

const DEFAULT_RELEASE_GATES = Object.freeze([
  {
    id: "gate_admin_api",
    moduleKey: "admin_api",
    title: "Admin API contract",
    status: "verified",
    owner: "platform",
    księgaControlRefs: ["audit_hash_chain", "fido2_sensitive_actions", "tenant_operator_boundary"],
    phantomRefs: [],
    blockers: [],
    humanGateRequired: false,
    productionClaim: false
  },
  {
    id: "gate_admin_web",
    moduleKey: "admin_web",
    title: "Admin dashboard human workflow",
    status: "verified",
    owner: "product",
    księgaControlRefs: ["dashboard_review", "human_gate_visibility"],
    phantomRefs: ["phantom_dashboard_visibility"],
    blockers: [],
    humanGateRequired: false,
    productionClaim: false
  },
  {
    id: "gate_provider_mutation",
    moduleKey: "provider_adapters",
    title: "Provider adapters",
    status: "partial",
    owner: "sre",
    księgaControlRefs: ["provider_dry_run_only", "real_cloud_mutation_blocked"],
    phantomRefs: [],
    blockers: ["live_cloud_requires_env_allowlist_and_human_gate"],
    humanGateRequired: true,
    productionClaim: false
  },
  {
    id: "gate_live_cloud_hetzner",
    moduleKey: "live_cloud_hetzner",
    title: "Hetzner live cloud execution gate",
    status: "blocked_human_gate",
    owner: "sre",
    bookControlRefs: ["3_vps_per_operator", "provider_secret_reference_only", "idempotency_required"],
    phantomRefs: [],
    blockers: ["env_flags_and_live_smoke_required", "no_token_in_repository"],
    humanGateRequired: true,
    productionClaim: false
  },
  {
    id: "gate_firecracker",
    moduleKey: "firecracker_orchestration",
    title: "Firecracker execution",
    status: "blocked_human_gate",
    owner: "platform",
    księgaControlRefs: ["real_firecracker_blocked", "3_vps_baseline_metadata"],
    phantomRefs: [],
    blockers: ["real_microvm_launch_not_enabled"],
    humanGateRequired: true,
    productionClaim: false
  },
  {
    id: "gate_cpu_confidential",
    moduleKey: "cpu_confidential_computing",
    title: "CPU and confidential computing",
    status: "partial",
    owner: "platform_security",
    bookControlRefs: ["kvm_iommu_tpm_secure_boot", "intel_tdx_or_amd_sev_snp_attestation"],
    phantomRefs: [],
    blockers: ["remote_attestation_required_before_secret_release"],
    humanGateRequired: true,
    productionClaim: false
  },
  {
    id: "gate_router_puli_ax",
    moduleKey: "router",
    title: "Puli AX router qualification",
    status: "partial",
    owner: "hardware",
    księgaControlRefs: ["puli_ax_gated", "router_firmware_signing_blocked"],
    phantomRefs: [],
    blockers: ["firmware_signing_pipeline_missing"],
    humanGateRequired: true,
    productionClaim: false
  },
  {
    id: "gate_graphene_image",
    moduleKey: "graphene_image",
    title: "GrapheneOS image pipeline",
    status: "blocked_human_gate",
    owner: "mobile",
    księgaControlRefs: ["image_artifact_metadata_only"],
    phantomRefs: [],
    blockers: ["real_image_build_pipeline_missing"],
    humanGateRequired: true,
    productionClaim: false
  },
  {
    id: "gate_phantom_v3",
    moduleKey: "phantom_v3",
    title: "PHANTOM v3.0 governance",
    status: "review_required",
    owner: "legal_ciso_architect",
    księgaControlRefs: ["phantom_separate_track"],
    phantomRefs: ["execution_false", "certification_claim_false", "approval_cannot_unlock_baseline"],
    blockers: ["live_behavior_blocked_by_design"],
    humanGateRequired: true,
    productionClaim: false
  },
  {
    id: "gate_cdr",
    moduleKey: "cdr",
    title: "CDR mandatory file controls",
    status: "implemented",
    owner: "security",
    księgaControlRefs: ["cdr_mandatory"],
    phantomRefs: [],
    blockers: [],
    humanGateRequired: false,
    productionClaim: false
  },
  {
    id: "gate_pki_hsm",
    moduleKey: "pki_hsm",
    title: "PKI and HSM production boundary",
    status: "blocked_human_gate",
    owner: "security",
    księgaControlRefs: ["production_hsm_required", "cert_references_only"],
    phantomRefs: [],
    blockers: ["production_hsm_not_integrated"],
    humanGateRequired: true,
    productionClaim: false
  }
]);

const DEFAULT_TESTS = Object.freeze([
  ["test_login", "Login with WebAuthn simulator", "security"],
  ["test_overview", "Overview navigation and system status", "dashboard"],
  ["test_provisioning", "Provisioning approval and job metadata", "provisioning"],
  ["test_subscriptions", "Subscription quota and billing gates", "subscriptions"],
  ["test_phantom", "PHANTOM workbench execution boundary", "phantom"],
  ["test_audit", "Audit stream and hash chain review", "audit"],
  ["test_mobile", "Mobile dashboard layout review", "ui"]
].map(([id, title, view]) => ({
  id,
  title,
  view,
  steps: ["Open view", "Review visible records", "Verify no unsafe production claim"],
  expectedResults: ["View renders", "Critical status is visible", "No secrets are displayed"],
  status: "not_run",
  evidenceArtifactIds: [],
  lastRunAt: null,
  owner: "qa"
})));

function isoNow() {
  return new Date().toISOString();
}

function safeText(value, field, { min = 1 } = {}) {
  if (value === undefined || value === null || String(value).trim().length < min) {
    throw validationError(`${field} is required`, { field });
  }
  const text = String(value).trim();
  const lower = text.toLowerCase();
  const matched = PROHIBITED_TERMS.find((term) => lower.includes(term));
  if (matched) {
    throw validationError("Release records must not contain operational or prohibited details", {
      field,
      matched,
      boundary: "RELEASE_METADATA_ONLY"
    });
  }
  return text;
}

function optionalText(value, field) {
  if (value === undefined || value === null || value === "") return null;
  return safeText(value, field);
}

function safeArray(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw validationError(`${field} must be an array`, { field });
  return value.map((item, index) => safeText(item, `${field}.${index}`));
}

function requireEnum(value, allowed, field) {
  if (!allowed.has(value)) throw validationError(`Unsupported ${field}`, { field, value, allowed: [...allowed] });
  return value;
}

function artifactHash({ path, type, source }) {
  return createHash("sha256").update(`${path}|${type}|${source}`).digest("hex");
}

export class ReleaseControlService {
  constructor({ audit, rbac, approvals, phantom, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.approvals = approvals;
    this.phantom = phantom;
    this.gates = new PersistentMap({ store, collection: "release_gates" });
    this.problems = new PersistentMap({ store, collection: "release_problems" });
    this.tests = new PersistentMap({ store, collection: "release_test_scenarios" });
    this.testRuns = new PersistentMap({ store, collection: "release_test_runs" });
    this.artifacts = new PersistentMap({ store, collection: "evidence_artifacts" });
    this.#seedDefaults();
  }

  #seedDefaults() {
    for (const gate of DEFAULT_RELEASE_GATES) {
      if (!this.gates.has(gate.id)) {
        this.gates.set(gate.id, { ...gate, updatedAt: isoNow(), updatedBy: "system" });
      }
    }
    for (const scenario of DEFAULT_TESTS) {
      if (!this.tests.has(scenario.id)) {
        this.tests.set(scenario.id, { ...scenario, updatedAt: isoNow(), updatedBy: "system" });
      }
    }
  }

  summary({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.read", { correlationId: corr, resourceType: RESOURCE_TYPES.RELEASE_GATE });
    const gates = this.listGates({ actor, correlationId: corr });
    const problems = this.listProblems({ actor, correlationId: corr });
    const tests = this.listTests({ actor, correlationId: corr });
    const runs = this.listTestRuns({ actor, correlationId: corr });
    const status = this.approvals.systemStatus({ actor, correlationId: corr });
    const openProblems = problems.filter((problem) => !["verified", "accepted_risk"].includes(problem.status));
    const blockedGates = gates.filter((gate) => gate.status === "blocked" || gate.status === "blocked_human_gate");
    const phantomExecutionSafe = status.phantom.every((item) => item.executionAllowed === false);
    return {
      decision: blockedGates.length || openProblems.some((problem) => ["high", "critical"].includes(problem.severity))
        ? "not_ready_for_production_execution"
        : "ready_for_metadata_release_review",
      productionExecutionAllowed: false,
      releaseCandidate: blockedGates.length ? "blocked_human_gate" : "metadata_release_candidate",
      księga34: {
        implemented: status.ksiega34.filter((item) => item.status === "implemented").length,
        blocked: status.ksiega34.filter((item) => item.status === "blocked").length,
        controls: status.ksiega34
      },
      phantom: {
        executionSafe: phantomExecutionSafe,
        executionAllowed: false,
        certificationClaim: false,
        controls: status.phantom
      },
      gates: {
        total: gates.length,
        blocked: blockedGates.length,
        humanGateRequired: gates.filter((gate) => gate.humanGateRequired).length
      },
      problems: {
        total: problems.length,
        open: openProblems.length,
        critical: openProblems.filter((problem) => problem.severity === "critical").length,
        high: openProblems.filter((problem) => problem.severity === "high").length
      },
      tests: {
        total: tests.length,
        passed: tests.filter((test) => test.status === "passed").length,
        failed: tests.filter((test) => test.status === "failed").length,
        blocked: tests.filter((test) => test.status === "blocked").length
      },
      testRuns: {
        total: runs.length,
        latestStatus: runs.at(-1)?.status || "not_run",
        latestRunId: runs.at(-1)?.id || null
      }
    };
  }

  buildAssessment({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.read", { correlationId: corr, resourceType: RESOURCE_TYPES.RELEASE_GATE });
    const summary = this.summary({ actor, correlationId: corr });
    const openProblems = this.listProblems({ actor, correlationId: corr })
      .filter((problem) => !["verified", "accepted_risk"].includes(problem.status));
    const latestRun = this.listTestRuns({ actor, correlationId: corr }).at(-1) || null;
    const gates = this.listGates({ actor, correlationId: corr });
    return {
      status: summary.decision,
      productionExecutionAllowed: false,
      księga34: {
        implemented: summary.księga34.implemented,
        blocked: summary.księga34.blocked,
        blockingControls: summary.księga34.controls.filter((item) => item.status === "blocked")
      },
      phantom: {
        executionAllowed: false,
        certificationClaim: false,
        reviewRequired: summary.phantom.controls.filter((item) => item.status === "review_required" || item.executionAllowed === false)
      },
      testing: {
        latestRun,
        failedOrBlockedScenarios: latestRun?.results?.filter((item) => ["failed", "blocked", "needs_human_review"].includes(item.status)) || [],
        openProblems: openProblems.map((problem) => ({
          id: problem.id,
          severity: problem.severity,
          category: problem.category,
          moduleKey: problem.moduleKey,
          status: problem.status
        }))
      },
      nextActions: [
        ...(summary.księga34.blocked ? ["Resolve Księga 3.4 blocked controls before production claim"] : []),
        ...(summary.phantom.executionSafe ? [] : ["Keep PHANTOM under legal/CISO/architect review"]),
        ...(openProblems.length ? ["Close or accept risk for open release problems"] : []),
        ...(gates.some((gate) => gate.humanGateRequired) ? ["Collect human-gate evidence for production blockers"] : [])
      ],
      generatedAt: isoNow()
    };
  }

  listGates({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.read", { correlationId: corr, resourceType: RESOURCE_TYPES.RELEASE_GATE });
    return [...this.gates.values()].map((gate) => ({ ...gate, productionExecutionAllowed: false }));
  }

  updateGateStatus({ actor, gateId, status, blockers = null, note = null, evidenceArtifactIds = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const previous = this.gates.get(gateId);
    if (!previous) throw notFound("release_gate", gateId);
    this.rbac.assert(actor, "release.manage", { correlationId: corr, resourceType: RESOURCE_TYPES.RELEASE_GATE, resourceId: gateId });
    const nextStatus = requireEnum(status, GATE_STATUSES, "status");
    if (nextStatus === "verified" && previous.humanGateRequired && !safeArray(evidenceArtifactIds, "evidenceArtifactIds").length) {
      throw validationError("Human-gated release gates require evidence before verified", { gateId, humanGateRequired: true });
    }
    if (previous.moduleKey === "phantom_v3" && nextStatus === "verified") {
      throw validationError("PHANTOM live behavior cannot be marked verified in baseline release gate", { gateId, executionAllowed: false });
    }
    const next = {
      ...previous,
      status: nextStatus,
      blockers: blockers === null ? previous.blockers : safeArray(blockers, "blockers"),
      note: optionalText(note, "note") || previous.note || null,
      evidenceArtifactIds: evidenceArtifactIds === null ? (previous.evidenceArtifactIds || []) : safeArray(evidenceArtifactIds, "evidenceArtifactIds"),
      productionExecutionAllowed: false,
      productionClaim: false,
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.gates.set(next.id, next);
    this.audit.record({
      actorId: actor.id,
      action: "release.gate_status_changed",
      resourceType: RESOURCE_TYPES.RELEASE_GATE,
      resourceId: next.id,
      correlationId: corr,
      previousValue: previous,
      newValue: next
    });
    return next;
  }

  listProblems({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.read", { correlationId: corr, resourceType: RESOURCE_TYPES.RELEASE_PROBLEM });
    return [...this.problems.values()];
  }

  createProblem({ actor, title, severity = "medium", category = "defect", moduleKey, status = "open", evidenceArtifactIds = [], owner = "unassigned", resolutionNote = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.manage", { correlationId: corr, resourceType: RESOURCE_TYPES.RELEASE_PROBLEM });
    const problem = {
      id: newId("problem"),
      title: safeText(title, "title", { min: 3 }),
      severity: requireEnum(severity, SEVERITIES, "severity"),
      category: requireEnum(category, PROBLEM_CATEGORIES, "category"),
      moduleKey: safeText(moduleKey, "moduleKey"),
      status: requireEnum(status, PROBLEM_STATUSES, "status"),
      evidenceArtifactIds: safeArray(evidenceArtifactIds, "evidenceArtifactIds"),
      owner: safeText(owner, "owner"),
      resolutionNote: optionalText(resolutionNote, "resolutionNote"),
      createdAt: isoNow(),
      createdBy: actor.id,
      updatedAt: null,
      updatedBy: null
    };
    this.problems.set(problem.id, problem);
    this.audit.record({
      actorId: actor.id,
      action: "release.problem_created",
      resourceType: RESOURCE_TYPES.RELEASE_PROBLEM,
      resourceId: problem.id,
      correlationId: corr,
      newValue: problem
    });
    return problem;
  }

  updateProblemStatus({ actor, problemId, status, resolutionNote = null, evidenceArtifactIds = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const previous = this.problems.get(problemId);
    if (!previous) throw notFound("release_problem", problemId);
    this.rbac.assert(actor, "release.manage", { correlationId: corr, resourceType: RESOURCE_TYPES.RELEASE_PROBLEM, resourceId: problemId });
    const nextStatus = requireEnum(status, PROBLEM_STATUSES, "status");
    if (nextStatus === "verified" && !(evidenceArtifactIds?.length || previous.evidenceArtifactIds?.length)) {
      throw validationError("Verified problems require evidence artifact", { problemId });
    }
    const next = {
      ...previous,
      status: nextStatus,
      resolutionNote: optionalText(resolutionNote, "resolutionNote") || previous.resolutionNote || null,
      evidenceArtifactIds: evidenceArtifactIds === null ? previous.evidenceArtifactIds : safeArray(evidenceArtifactIds, "evidenceArtifactIds"),
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.problems.set(next.id, next);
    this.audit.record({
      actorId: actor.id,
      action: "release.problem_status_changed",
      resourceType: RESOURCE_TYPES.RELEASE_PROBLEM,
      resourceId: next.id,
      correlationId: corr,
      previousValue: previous,
      newValue: next
    });
    return next;
  }

  listTests({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.read", { correlationId: corr, resourceType: RESOURCE_TYPES.RELEASE_TEST_SCENARIO });
    return [...this.tests.values()];
  }

  updateTestStatus({ actor, scenarioId, status, evidenceArtifactIds = null, note = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const previous = this.tests.get(scenarioId);
    if (!previous) throw notFound("release_test_scenario", scenarioId);
    this.rbac.assert(actor, "release.manage", { correlationId: corr, resourceType: RESOURCE_TYPES.RELEASE_TEST_SCENARIO, resourceId: scenarioId });
    const next = {
      ...previous,
      status: requireEnum(status, TEST_STATUSES, "status"),
      evidenceArtifactIds: evidenceArtifactIds === null ? previous.evidenceArtifactIds : safeArray(evidenceArtifactIds, "evidenceArtifactIds"),
      note: optionalText(note, "note") || previous.note || null,
      lastRunAt: isoNow(),
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.tests.set(next.id, next);
    this.audit.record({
      actorId: actor.id,
      action: "release.test_status_changed",
      resourceType: RESOURCE_TYPES.RELEASE_TEST_SCENARIO,
      resourceId: next.id,
      correlationId: corr,
      previousValue: previous,
      newValue: next
    });
    return next;
  }

  listTestRuns({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.read", { correlationId: corr, resourceType: RESOURCE_TYPES.RELEASE_TEST_RUN });
    return [...this.testRuns.values()];
  }

  recordHumanTestRun({
    actor,
    mode = "mixed_human_playwright",
    title,
    evidenceArtifactIds = [],
    results = [],
    environment = "local_admin_api",
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.manage", { correlationId: corr, resourceType: RESOURCE_TYPES.RELEASE_TEST_RUN });
    const normalizedResults = this.#normalizeRunResults(results);
    const evidence = safeArray(evidenceArtifactIds, "evidenceArtifactIds");
    const failed = normalizedResults.filter((item) => ["failed", "blocked", "needs_human_review"].includes(item.status));
    const run = {
      id: newId("test_run"),
      mode: requireEnum(mode, TEST_RUN_MODES, "mode"),
      title: safeText(title, "title", { min: 3 }),
      environment: safeText(environment, "environment"),
      status: failed.length ? "needs_human_review" : "passed",
      results: normalizedResults,
      evidenceArtifactIds: evidence,
      productionExecutionAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.testRuns.set(run.id, run);
    for (const result of normalizedResults) {
      if (this.tests.has(result.scenarioId)) {
        this.updateTestStatus({
          actor,
          scenarioId: result.scenarioId,
          status: result.status,
          evidenceArtifactIds: evidence,
          note: result.note || `${run.title} result`,
          correlationId: corr
        });
      }
      if (["failed", "blocked"].includes(result.status)) {
        this.createProblem({
          actor,
          title: `Test ${result.scenarioId} ${result.status}: ${result.note || "review required"}`,
          severity: result.status === "failed" ? "high" : "medium",
          category: "test_gap",
          moduleKey: result.view || "release",
          status: "open",
          evidenceArtifactIds: evidence,
          owner: "qa",
          correlationId: corr
        });
      }
    }
    this.audit.record({
      actorId: actor.id,
      action: "release.human_test_run_recorded",
      resourceType: RESOURCE_TYPES.RELEASE_TEST_RUN,
      resourceId: run.id,
      correlationId: corr,
      policyDecision: run.status === "passed" ? "allow" : "deny",
      result: run.status,
      newValue: run
    });
    return run;
  }

  listArtifacts({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.read", { correlationId: corr, resourceType: RESOURCE_TYPES.EVIDENCE_ARTIFACT });
    return [...this.artifacts.values()];
  }

  createArtifact({ actor, type = "manual_note", path, source = "manual", linkedModule = "release", correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.manage", { correlationId: corr, resourceType: RESOURCE_TYPES.EVIDENCE_ARTIFACT });
    const artifact = {
      id: newId("artifact"),
      type: requireEnum(type, ARTIFACT_TYPES, "type"),
      path: safeText(path, "path"),
      source: safeText(source, "source"),
      linkedModule: safeText(linkedModule, "linkedModule"),
      sha256: artifactHash({ path, type, source }),
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.artifacts.set(artifact.id, artifact);
    this.audit.record({
      actorId: actor.id,
      action: "release.evidence_artifact_created",
      resourceType: RESOURCE_TYPES.EVIDENCE_ARTIFACT,
      resourceId: artifact.id,
      correlationId: corr,
      newValue: artifact
    });
    return artifact;
  }

  #normalizeRunResults(results) {
    if (!Array.isArray(results) || results.length === 0) {
      throw validationError("Human test run requires at least one scenario result", { field: "results" });
    }
    return results.map((item, index) => ({
      scenarioId: safeText(item.scenarioId, `results.${index}.scenarioId`),
      view: optionalText(item.view, `results.${index}.view`) || "unknown",
      status: requireEnum(item.status, TEST_STATUSES, `results.${index}.status`),
      note: optionalText(item.note, `results.${index}.note`),
      evidenceArtifactIds: safeArray(item.evidenceArtifactIds || [], `results.${index}.evidenceArtifactIds`)
    }));
  }
}
