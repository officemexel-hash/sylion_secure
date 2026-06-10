import { createHash } from "node:crypto";
import { RESOURCE_TYPES } from "../../domain/constants.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { validationError, notFound } from "../../lib/errors.js";
import {
  HUMAN_EVIDENCE_SCHEMA_VERSION,
  isProductionSatisfyingResult,
  normalizeResultStatus,
  validateHumanEvidenceSummary
} from "../../lib/humanEvidence.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const GATE_STATUSES = new Set([
  "implemented",
  "partial",
  "blocked",
  "blocked_human_gate",
  "dry_run_ready",
  "review_required",
  "verified"
]);
const PROBLEM_STATUSES = new Set([
  "open",
  "triaged",
  "in_progress",
  "fixed_pending_test",
  "verified",
  "accepted_risk",
  "blocked_human_gate"
]);
const PROBLEM_CATEGORIES = new Set([
  "defect",
  "ux_issue",
  "test_gap",
  "compliance_gap",
  "architecture_gap",
  "security_gap"
]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const TEST_STATUSES = new Set([
  "not_run",
  "running",
  "passed",
  "failed",
  "blocked",
  "needs_human_review"
]);
const TEST_RUN_MODES = new Set([
  "playwright_dashboard",
  "operator_portal",
  "manual_human",
  "mixed_human_playwright",
  "strict_human_evidence",
  "pixel_adb_human",
  "laptop_human"
]);
const ARTIFACT_TYPES = new Set([
  "screenshot",
  "test_log",
  "json_summary",
  "human_evidence_summary",
  "release_note",
  "coverage_report",
  "manual_note"
]);
const FACTUAL_TEST_RESULTS = new Set(["passed", "failed", "blocked", "unknown"]);
const FACTUAL_CHECK_STATUSES = new Set([
  "passed",
  "failed",
  "blocked",
  "not_run",
  "not_applicable"
]);
const FACTUAL_TERMINAL_MODES = new Set(["pixel_grapheneos", "laptop_web_terminal"]);
const FACTUAL_RUNTIME_MODES = new Set([
  "desktop",
  "web",
  "android_native",
  "firecracker_gui",
  "container",
  "unknown"
]);
const WORKLOAD_APP_KEYS = new Set([
  "whatsapp",
  "signal",
  "telegram",
  "threema",
  "zangi",
  "matrix_client",
  "matrix_server",
  "duckduckgo_browser",
  "libreoffice",
  "exodus",
  "simplex",
  "protonmail"
]);
const COMMUNICATOR_APP_KEYS = new Set([
  "whatsapp",
  "signal",
  "telegram",
  "threema",
  "zangi",
  "matrix_client",
  "simplex"
]);
const SECRET_FIELD_PATTERN =
  /(password|secret|token|api[_-]?key|otp|sms.*code|verification.*code|panic.*code|seed|mnemonic|private[_-]?key)/i;
const PROHIBITED_TERMS = [
  "imei",
  "imsi",
  "spoof",
  "evasion",
  "evade",
  "bypass lawful",
  "destroy evidence",
  "unauthorized access"
];

const WORKLOAD_FACTUAL_MATRIX = Object.freeze({
  signal: {
    label: "Signal",
    appClass: "communicator",
    allowedRuntimeModes: ["desktop", "android_native", "firecracker_gui", "container"],
    expectedBehavior:
      "Signal UI opens inside an isolated workload, account bootstrap is completed without web-link-only evidence, and send/receive is proven by metadata-only checks.",
    mandatoryChecks: ["uiVisible", "accountBootstrap", "sendReceive"],
    humanSteps: [
      "Open Signal workload",
      "Confirm Signal UI is visible",
      "Complete non-secret account bootstrap",
      "Perform metadata-only send/receive check",
      "Return to operator panel"
    ],
    passCriteria: [
      "Signal-branded UI visible",
      "accountBootstrap passed",
      "sendReceive passed",
      "no message content stored",
      "terminalDataStored=false"
    ],
    failIf: [
      "only HTTP 200",
      "only VNC banner",
      "only generic browser tab",
      "web-link-only account bootstrap",
      "message content captured"
    ],
    repairPrompt:
      "Repair Signal workload until UI, bootstrap and send/receive metadata pass without storing communication content."
  },
  whatsapp: {
    label: "WhatsApp",
    appClass: "communicator",
    allowedRuntimeModes: ["desktop", "android_native", "firecracker_gui", "container"],
    expectedBehavior:
      "WhatsApp UI opens inside an isolated workload and bootstrap plus send/receive are proven without message content.",
    mandatoryChecks: ["uiVisible", "accountBootstrap", "sendReceive"],
    humanSteps: [
      "Open WhatsApp workload",
      "Confirm WhatsApp UI",
      "Complete non-secret account bootstrap",
      "Perform metadata-only send/receive check",
      "Return to operator panel"
    ],
    passCriteria: [
      "WhatsApp-branded UI visible",
      "accountBootstrap passed",
      "sendReceive passed",
      "no contact list or message content stored"
    ],
    failIf: [
      "web.whatsapp.com login page only",
      "generic Chromium tab",
      "transport-only evidence",
      "QR/phone/OTP stored in evidence"
    ],
    repairPrompt:
      "Repair WhatsApp workload with approved desktop/android-native mode and non-secret bootstrap evidence."
  },
  telegram: {
    label: "Telegram",
    appClass: "communicator",
    allowedRuntimeModes: ["desktop", "android_native", "firecracker_gui", "container"],
    expectedBehavior:
      "Telegram UI opens inside an isolated workload and account bootstrap plus send/receive metadata pass.",
    mandatoryChecks: ["uiVisible", "accountBootstrap", "sendReceive"],
    humanSteps: [
      "Open Telegram workload",
      "Confirm Telegram UI",
      "Complete non-secret account bootstrap",
      "Perform metadata-only send/receive check",
      "Return to operator panel"
    ],
    passCriteria: [
      "Telegram-branded UI visible",
      "accountBootstrap passed",
      "sendReceive passed",
      "OTP/phone/message content absent from evidence"
    ],
    failIf: [
      "public download page",
      "generic browser tab",
      "phone number or OTP stored",
      "transport-only evidence"
    ],
    repairPrompt:
      "Repair Telegram workload until factual app state passes with metadata-only evidence."
  },
  threema: {
    label: "Threema",
    appClass: "communicator",
    allowedRuntimeModes: ["desktop", "android_native", "firecracker_gui", "container"],
    expectedBehavior:
      "Threema UI opens inside an isolated workload and messaging readiness is proven without secret or message capture.",
    mandatoryChecks: ["uiVisible", "accountBootstrap", "sendReceive"],
    humanSteps: [
      "Open Threema workload",
      "Confirm Threema UI",
      "Complete non-secret account bootstrap",
      "Perform metadata-only send/receive check",
      "Return to operator panel"
    ],
    passCriteria: [
      "Threema-branded UI visible",
      "accountBootstrap passed",
      "sendReceive passed",
      "no message or contact data stored"
    ],
    failIf: [
      "public website/download page",
      "generic stream shell only",
      "message content captured",
      "only process or port evidence"
    ],
    repairPrompt: "Repair Threema workload until UI and metadata-only messaging checks pass."
  },
  zangi: {
    label: "Zangi",
    appClass: "communicator",
    allowedRuntimeModes: ["android_native", "firecracker_gui", "container"],
    expectedBehavior:
      "Zangi Android-native or approved desktop-compatible UI opens with APK provenance and non-secret account bootstrap evidence.",
    mandatoryChecks: ["uiVisible", "accountBootstrap", "sendReceive", "apkProvenance"],
    humanSteps: [
      "Verify APK/source provenance",
      "Open Zangi workload",
      "Confirm Zangi UI",
      "Complete non-secret account bootstrap",
      "Perform metadata-only send/receive check"
    ],
    passCriteria: [
      "Zangi-branded UI visible",
      "APK provenance approved",
      "accountBootstrap passed",
      "sendReceive passed"
    ],
    failIf: [
      "zangi.com download page only",
      "unknown APK provenance",
      "generic noVNC/Guacamole shell",
      "phone/OTP/message content stored"
    ],
    repairPrompt:
      "Repair Zangi workload by proving APK provenance and Android-native UI before any factual PASS."
  },
  simplex: {
    label: "SimpleX Chat",
    appClass: "communicator",
    allowedRuntimeModes: ["desktop", "android_native", "firecracker_gui", "container"],
    expectedBehavior:
      "SimpleX Chat opens inside an isolated workload using an approved desktop or Android-native image and bootstrap plus send/receive are proven with metadata-only evidence.",
    mandatoryChecks: ["uiVisible", "accountBootstrap", "sendReceive", "imageProvenance"],
    humanSteps: [
      "Verify approved SimpleX image/source provenance",
      "Open SimpleX workload",
      "Confirm SimpleX UI",
      "Complete non-secret account bootstrap",
      "Perform metadata-only send/receive check"
    ],
    passCriteria: [
      "SimpleX-branded UI visible",
      "approved image provenance recorded",
      "accountBootstrap passed",
      "sendReceive passed",
      "no invite, address, message or credential content stored"
    ],
    failIf: [
      "simplex.chat download page only",
      "unknown image or package provenance",
      "generic noVNC/Guacamole shell",
      "invite/address/message/password content stored",
      "transport-only evidence"
    ],
    repairPrompt:
      "Repair SimpleX workload by approving a desktop or Android-native image, proving branded UI, then running metadata-only bootstrap and send/receive tests."
  },
  duckduckgo_browser: {
    label: "DuckDuckGo",
    appClass: "browser",
    allowedRuntimeModes: ["desktop", "firecracker_gui", "container"],
    expectedBehavior:
      "DuckDuckGo browser opens and can browse a public site through the configured workload route without DNS or terminal-data leaks.",
    mandatoryChecks: ["uiVisible", "browsing"],
    humanSteps: [
      "Open DuckDuckGo workload",
      "Search or open a non-sensitive public page",
      "Confirm page renders",
      "Return to operator panel"
    ],
    passCriteria: [
      "DuckDuckGo UI visible",
      "browsing passed",
      "DNS route evidence present",
      "terminalDataStored=false"
    ],
    failIf: [
      "Google/new tab only",
      "browser cannot load public page",
      "direct terminal browser outside workload",
      "content capture stored"
    ],
    repairPrompt:
      "Repair DuckDuckGo workload routing and UI until browsing passes through workload with metadata-only evidence."
  },
  libreoffice: {
    label: "LibreOffice",
    appClass: "productivity",
    allowedRuntimeModes: ["desktop", "firecracker_gui", "container"],
    expectedBehavior:
      "LibreOffice opens inside the workload and a non-sensitive document workflow can be created and closed without file contents in evidence.",
    mandatoryChecks: ["uiVisible", "documentWorkflow"],
    humanSteps: [
      "Open LibreOffice workload",
      "Create or open a non-sensitive test document",
      "Confirm editing UI",
      "Close document without storing file contents in evidence"
    ],
    passCriteria: [
      "LibreOffice UI visible",
      "documentWorkflow passed",
      "file contents absent from evidence",
      "CDR policy acknowledged for file ingress/egress"
    ],
    failIf: [
      "generic browser tab",
      "only process evidence",
      "file contents captured",
      "CDR missing for file flow"
    ],
    repairPrompt:
      "Repair LibreOffice workload and CDR-adjacent controls until document workflow passes with no file-content evidence."
  },
  exodus: {
    label: "Exodus",
    appClass: "wallet_tool",
    allowedRuntimeModes: ["desktop", "firecracker_gui", "container"],
    expectedBehavior:
      "Exodus UI opens as a workload tool and wallet workflow is proven with non-secret evidence only; no seed, private key or wallet data is captured.",
    mandatoryChecks: ["uiVisible", "walletWorkflow", "riskAcceptance"],
    humanSteps: [
      "Open Exodus workload",
      "Confirm Exodus UI",
      "Verify non-secret wallet workflow screen",
      "Record risk acceptance metadata",
      "Return to operator panel"
    ],
    passCriteria: [
      "Exodus UI visible",
      "walletWorkflow passed without secrets",
      "riskAcceptance passed",
      "seed/private key/wallet data absent"
    ],
    failIf: [
      "download page only",
      "browser shell only",
      "seed/private key/wallet data captured",
      "risk acceptance missing"
    ],
    repairPrompt:
      "Repair Exodus workload with explicit non-secret wallet workflow and risk acceptance before factual PASS."
  },
  protonmail: {
    label: "Proton Mail",
    appClass: "mail",
    allowedRuntimeModes: ["web", "desktop", "firecracker_gui", "container"],
    expectedBehavior:
      "Proton Mail opens inside an isolated workload, operator logs in directly inside the workload UI, and mailbox visibility is proven without storing address, password, subject, sender, recipient or message body.",
    mandatoryChecks: ["uiVisible", "accountLogin", "mailboxVisible"],
    humanSteps: [
      "Open Proton Mail workload",
      "Operator enters credentials directly inside the workload UI",
      "Confirm mailbox UI is visible",
      "Optionally perform metadata-only harmless mail send/receive check",
      "Return to operator panel"
    ],
    passCriteria: [
      "Proton Mail UI visible",
      "accountLogin passed",
      "mailboxVisible passed",
      "mailbox address/password/message metadata absent from evidence"
    ],
    failIf: [
      "only HTTP 200",
      "only login page without successful mailbox visibility",
      "mailbox address or password stored",
      "subject/sender/recipient/body captured",
      "transport-only evidence"
    ],
    repairPrompt:
      "Repair Proton Mail workload until login and mailbox visibility pass with no mailbox credentials or message content stored."
  }
});

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
    bookControlRefs: [
      "3_vps_per_operator",
      "provider_secret_reference_only",
      "idempotency_required"
    ],
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
    phantomRefs: [
      "execution_false",
      "certification_claim_false",
      "approval_cannot_unlock_baseline"
    ],
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

const DEFAULT_TESTS = Object.freeze(
  [
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
  }))
);

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
  if (!allowed.has(value))
    throw validationError(`Unsupported ${field}`, { field, value, allowed: [...allowed] });
  return value;
}

function artifactHash({ path, type, source }) {
  return createHash("sha256").update(`${path}|${type}|${source}`).digest("hex");
}

function findSecretFields(value, path = []) {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => {
    const nextPath = [...path, key];
    const current = SECRET_FIELD_PATTERN.test(key) ? [nextPath.join(".")] : [];
    return nested && typeof nested === "object"
      ? [...current, ...findSecretFields(nested, nextPath)]
      : current;
  });
}

function assertNoSecretFields(value) {
  const fields = findSecretFields(value);
  if (fields.length) {
    throw validationError(
      "Factual workload app tests must not include secret, OTP, seed or token material",
      {
        fields,
        allowed: "Store only evidence artifact ids and write-only secret references."
      }
    );
  }
}

function strictResultToScenarioStatus(result) {
  const normalized = normalizeResultStatus(result);
  if (normalized === "PASS") return "passed";
  if (normalized === "BLOCKED") return "blocked";
  if (["FAIL", "FAIL_CRITICAL", "FLAKY"].includes(normalized)) return "failed";
  return "needs_human_review";
}

function strictResultSeverity(result) {
  const normalized = normalizeResultStatus(result);
  if (normalized === "FAIL_CRITICAL") return "critical";
  if (["FAIL", "FLAKY"].includes(normalized)) return "high";
  if (["BLOCKED", "UNKNOWN"].includes(normalized)) return "medium";
  return "low";
}

function strictResultCategory(result) {
  return normalizeResultStatus(result) === "FAIL_CRITICAL" ? "security_gap" : "test_gap";
}

function requiredFactualChecks(appKey) {
  if (COMMUNICATOR_APP_KEYS.has(appKey)) return ["uiVisible", "accountBootstrap", "sendReceive"];
  if (appKey === "duckduckgo_browser") return ["uiVisible", "browsing"];
  if (appKey === "libreoffice") return ["uiVisible", "documentWorkflow"];
  if (appKey === "exodus") return ["uiVisible", "walletWorkflow", "riskAcceptance"];
  if (appKey === "protonmail") return ["uiVisible", "accountLogin", "mailboxVisible"];
  if (appKey === "matrix_server") return ["serviceReachable", "federationPolicy", "torPolicy"];
  return ["uiVisible"];
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
    this.workloadFactualTests = new PersistentMap({ store, collection: "workload_factual_tests" });
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
    this.rbac.assert(actor, "release.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RELEASE_GATE
    });
    const gates = this.listGates({ actor, correlationId: corr });
    const problems = this.listProblems({ actor, correlationId: corr });
    const tests = this.listTests({ actor, correlationId: corr });
    const runs = this.listTestRuns({ actor, correlationId: corr });
    const status = this.approvals.systemStatus({ actor, correlationId: corr });
    const openProblems = problems.filter(
      (problem) => !["verified", "accepted_risk"].includes(problem.status)
    );
    const blockedGates = gates.filter(
      (gate) => gate.status === "blocked" || gate.status === "blocked_human_gate"
    );
    const phantomExecutionSafe = status.phantom.every((item) => item.executionAllowed === false);
    return {
      decision:
        blockedGates.length ||
        openProblems.some((problem) => ["high", "critical"].includes(problem.severity))
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
    this.rbac.assert(actor, "release.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RELEASE_GATE
    });
    const summary = this.summary({ actor, correlationId: corr });
    const openProblems = this.listProblems({ actor, correlationId: corr }).filter(
      (problem) => !["verified", "accepted_risk"].includes(problem.status)
    );
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
        reviewRequired: summary.phantom.controls.filter(
          (item) => item.status === "review_required" || item.executionAllowed === false
        )
      },
      testing: {
        latestRun,
        failedOrBlockedScenarios:
          latestRun?.results?.filter((item) =>
            ["failed", "blocked", "needs_human_review"].includes(item.status)
          ) || [],
        openProblems: openProblems.map((problem) => ({
          id: problem.id,
          severity: problem.severity,
          category: problem.category,
          moduleKey: problem.moduleKey,
          status: problem.status
        }))
      },
      nextActions: [
        ...(summary.księga34.blocked
          ? ["Resolve Księga 3.4 blocked controls before production claim"]
          : []),
        ...(summary.phantom.executionSafe
          ? []
          : ["Keep PHANTOM under legal/CISO/architect review"]),
        ...(openProblems.length ? ["Close or accept risk for open release problems"] : []),
        ...(gates.some((gate) => gate.humanGateRequired)
          ? ["Collect human-gate evidence for production blockers"]
          : [])
      ],
      generatedAt: isoNow()
    };
  }

  listGates({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RELEASE_GATE
    });
    return [...this.gates.values()].map((gate) => ({ ...gate, productionExecutionAllowed: false }));
  }

  updateGateStatus({
    actor,
    gateId,
    status,
    blockers = null,
    note = null,
    evidenceArtifactIds = null,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    const previous = this.gates.get(gateId);
    if (!previous) throw notFound("release_gate", gateId);
    this.rbac.assert(actor, "release.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RELEASE_GATE,
      resourceId: gateId
    });
    const nextStatus = requireEnum(status, GATE_STATUSES, "status");
    if (
      nextStatus === "verified" &&
      previous.humanGateRequired &&
      !safeArray(evidenceArtifactIds, "evidenceArtifactIds").length
    ) {
      throw validationError("Human-gated release gates require evidence before verified", {
        gateId,
        humanGateRequired: true
      });
    }
    if (previous.moduleKey === "phantom_v3" && nextStatus === "verified") {
      throw validationError(
        "PHANTOM live behavior cannot be marked verified in baseline release gate",
        { gateId, executionAllowed: false }
      );
    }
    const next = {
      ...previous,
      status: nextStatus,
      blockers: blockers === null ? previous.blockers : safeArray(blockers, "blockers"),
      note: optionalText(note, "note") || previous.note || null,
      evidenceArtifactIds:
        evidenceArtifactIds === null
          ? previous.evidenceArtifactIds || []
          : safeArray(evidenceArtifactIds, "evidenceArtifactIds"),
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
    this.rbac.assert(actor, "release.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RELEASE_PROBLEM
    });
    return [...this.problems.values()];
  }

  createProblem({
    actor,
    title,
    severity = "medium",
    category = "defect",
    moduleKey,
    status = "open",
    evidenceArtifactIds = [],
    owner = "unassigned",
    resolutionNote = null,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RELEASE_PROBLEM
    });
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

  updateProblemStatus({
    actor,
    problemId,
    status,
    resolutionNote = null,
    evidenceArtifactIds = null,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    const previous = this.problems.get(problemId);
    if (!previous) throw notFound("release_problem", problemId);
    this.rbac.assert(actor, "release.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RELEASE_PROBLEM,
      resourceId: problemId
    });
    const nextStatus = requireEnum(status, PROBLEM_STATUSES, "status");
    if (
      nextStatus === "verified" &&
      !(evidenceArtifactIds?.length || previous.evidenceArtifactIds?.length)
    ) {
      throw validationError("Verified problems require evidence artifact", { problemId });
    }
    const next = {
      ...previous,
      status: nextStatus,
      resolutionNote:
        optionalText(resolutionNote, "resolutionNote") || previous.resolutionNote || null,
      evidenceArtifactIds:
        evidenceArtifactIds === null
          ? previous.evidenceArtifactIds
          : safeArray(evidenceArtifactIds, "evidenceArtifactIds"),
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
    this.rbac.assert(actor, "release.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RELEASE_TEST_SCENARIO
    });
    return [...this.tests.values()];
  }

  updateTestStatus({
    actor,
    scenarioId,
    status,
    evidenceArtifactIds = null,
    note = null,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    const previous = this.tests.get(scenarioId);
    if (!previous) throw notFound("release_test_scenario", scenarioId);
    this.rbac.assert(actor, "release.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RELEASE_TEST_SCENARIO,
      resourceId: scenarioId
    });
    const next = {
      ...previous,
      status: requireEnum(status, TEST_STATUSES, "status"),
      evidenceArtifactIds:
        evidenceArtifactIds === null
          ? previous.evidenceArtifactIds
          : safeArray(evidenceArtifactIds, "evidenceArtifactIds"),
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
    this.rbac.assert(actor, "release.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RELEASE_TEST_RUN
    });
    return [...this.testRuns.values()];
  }

  listWorkloadFactualTests({ actor, operatorId = null, appKey = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.WORKLOAD_FACTUAL_TEST
    });
    return [...this.workloadFactualTests.values()]
      .filter((record) => !operatorId || record.operatorId === operatorId)
      .filter((record) => !appKey || record.appKey === appKey)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  listWorkloadFactualMatrix({ actor, appKey = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.WORKLOAD_FACTUAL_TEST
    });
    return Object.entries(WORKLOAD_FACTUAL_MATRIX)
      .filter(([key]) => !appKey || key === appKey)
      .map(([key, definition]) => ({
        appKey: key,
        ...definition,
        cdrRequired: true,
        terminalDataStored: false,
        contentInspectionAllowed: false,
        packetCaptureStored: false,
        productionExecutionAllowed: false,
        strictPassRequiresFactualState: true,
        requiredChecks: requiredFactualChecks(key),
        missingEvidenceResult: "FAIL",
        physicalPrerequisiteResult: "BLOCKED"
      }));
  }

  latestWorkloadFactualTestsByApp({ actor, operatorId, correlationId }) {
    return Object.fromEntries(
      this.listWorkloadFactualTests({ actor, operatorId, correlationId }).reduce((rows, record) => {
        if (!rows.has(record.appKey)) rows.set(record.appKey, record);
        return rows;
      }, new Map())
    );
  }

  recordWorkloadFactualTest({
    actor,
    operatorId,
    appKey,
    terminalMode = "pixel_grapheneos",
    runtimeMode = "unknown",
    result = "unknown",
    checks = {},
    evidenceArtifactIds = [],
    latencyMs = null,
    note = null,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.WORKLOAD_FACTUAL_TEST
    });
    const key = requireEnum(appKey, WORKLOAD_APP_KEYS, "appKey");
    const normalizedResult = requireEnum(result, FACTUAL_TEST_RESULTS, "result");
    const normalizedChecks = this.#normalizeFactualChecks({ appKey: key, checks });
    const requiredChecks = requiredFactualChecks(key);
    const missingRequired = requiredChecks.filter(
      (checkKey) => normalizedChecks[checkKey]?.status !== "passed"
    );
    if (normalizedResult === "passed" && missingRequired.length) {
      throw validationError("Factual PASS requires all mandatory app checks to pass", {
        appKey: key,
        missingRequired,
        requiredChecks
      });
    }
    if (
      normalizedResult === "passed" &&
      COMMUNICATOR_APP_KEYS.has(key) &&
      normalizedChecks.accountBootstrap?.mode === "web_link_only"
    ) {
      throw validationError(
        "Communicator PASS cannot be based on web-link-only account bootstrap",
        {
          appKey: key,
          required: "android_native_or_desktop_linked_account_with_send_receive"
        }
      );
    }
    assertNoSecretFields({ checks, note });
    const factualStateVerified = normalizedResult === "passed" && missingRequired.length === 0;
    const record = {
      id: newId("factual_test"),
      operatorId: safeText(operatorId, "operatorId"),
      appKey: key,
      terminalMode: requireEnum(terminalMode, FACTUAL_TERMINAL_MODES, "terminalMode"),
      runtimeMode: requireEnum(runtimeMode, FACTUAL_RUNTIME_MODES, "runtimeMode"),
      result: normalizedResult,
      factualStateVerified,
      checks: normalizedChecks,
      requiredChecks,
      blockers: factualStateVerified ? [] : missingRequired.map((check) => `${check}_not_passed`),
      evidenceArtifactIds: safeArray(evidenceArtifactIds, "evidenceArtifactIds"),
      latencyMs: latencyMs === null || latencyMs === undefined ? null : Number(latencyMs),
      note: optionalText(note, "note"),
      cdrRequired: true,
      terminalDataStored: false,
      productionExecutionAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.workloadFactualTests.set(record.id, record);
    let problemId = null;
    if (!factualStateVerified && ["failed", "blocked"].includes(normalizedResult)) {
      const problem = this.createProblem({
        actor,
        title: `Factual app test ${key} ${normalizedResult}: ${record.blockers.join(", ") || "review required"}`,
        severity: normalizedResult === "failed" ? "high" : "medium",
        category: "test_gap",
        moduleKey: `workload_app:${key}`,
        status: "open",
        evidenceArtifactIds: record.evidenceArtifactIds,
        owner: "qa",
        correlationId: corr
      });
      problemId = problem.id;
    }
    const stored = { ...record, linkedProblemId: problemId };
    this.workloadFactualTests.set(stored.id, stored);
    this.audit.record({
      actorId: actor.id,
      action: "release.workload_factual_test_recorded",
      resourceType: RESOURCE_TYPES.WORKLOAD_FACTUAL_TEST,
      resourceId: stored.id,
      operatorId: stored.operatorId,
      correlationId: corr,
      policyDecision: factualStateVerified ? "allow" : "deny",
      result: stored.result,
      newValue: stored
    });
    return stored;
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
    this.rbac.assert(actor, "release.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RELEASE_TEST_RUN
    });
    const normalizedResults = this.#normalizeRunResults(results);
    const evidence = safeArray(evidenceArtifactIds, "evidenceArtifactIds");
    const failed = normalizedResults.filter((item) =>
      ["failed", "blocked", "needs_human_review"].includes(item.status)
    );
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

  recordHumanEvidenceRun({
    actor,
    summary,
    evidenceArtifactPath = null,
    linkedModule = "human_regression",
    repairCommit = null,
    ksiegaControlRefs = [],
    phantomBoundaryImpact = "none",
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.RELEASE_TEST_RUN
    });
    try {
      validateHumanEvidenceSummary(summary);
    } catch (error) {
      throw validationError("Strict human evidence validation failed", {
        reason: error.message,
        schemaVersion: HUMAN_EVIDENCE_SCHEMA_VERSION
      });
    }
    const strictResult = normalizeResultStatus(summary.result);
    const scenarioStatus = strictResultToScenarioStatus(strictResult);
    const artifact = this.createArtifact({
      actor,
      type: "human_evidence_summary",
      path: evidenceArtifactPath || `human-evidence://${summary.testId}/${summary.gitCommit}`,
      source: "strict_human_evidence",
      linkedModule,
      correlationId: corr
    });
    const evidenceIds = [artifact.id];
    const run = this.recordHumanTestRun({
      actor,
      mode: "strict_human_evidence",
      title: `${summary.testId} strict evidence ${strictResult}`,
      environment: summary.environment?.mode || "strict_human_evidence",
      evidenceArtifactIds: evidenceIds,
      results: [
        {
          scenarioId: summary.testId,
          view: linkedModule,
          status: scenarioStatus,
          note: `Strict human evidence result ${strictResult}`,
          evidenceArtifactIds: evidenceIds
        }
      ],
      correlationId: corr
    });
    const humanEvidence = {
      schemaVersion: HUMAN_EVIDENCE_SCHEMA_VERSION,
      testId: summary.testId,
      testVersion: summary.testVersion,
      strictResult,
      productionSatisfyingResult: isProductionSatisfyingResult(strictResult),
      evidenceArtifactIds: evidenceIds,
      evidenceRefs: safeArray(summary.evidenceRefs || [], "summary.evidenceRefs"),
      blockers: safeArray(summary.blockers || [], "summary.blockers"),
      residualRisk: safeArray(summary.residualRisk || [], "summary.residualRisk"),
      nextRequiredAction: optionalText(summary.nextRequiredAction, "summary.nextRequiredAction"),
      repairCommit: optionalText(repairCommit, "repairCommit"),
      ksiegaControlRefs: safeArray(ksiegaControlRefs, "ksiegaControlRefs"),
      phantomBoundaryImpact: safeText(phantomBoundaryImpact, "phantomBoundaryImpact"),
      metadataOnly: summary.forbiddenDataPolicy?.metadataOnly === true,
      terminalDataStored: summary.forbiddenDataPolicy?.terminalDataStored === true,
      contentInspected: summary.forbiddenDataPolicy?.contentInspected === true,
      packetCaptureStored: summary.forbiddenDataPolicy?.packetCaptureStored === true
    };
    const indexedRun = {
      ...run,
      humanEvidence,
      productionExecutionAllowed: false
    };
    this.testRuns.set(indexedRun.id, indexedRun);
    this.audit.record({
      actorId: actor.id,
      action: "release.human_evidence_run_indexed",
      resourceType: RESOURCE_TYPES.RELEASE_TEST_RUN,
      resourceId: indexedRun.id,
      correlationId: corr,
      policyDecision: humanEvidence.productionSatisfyingResult ? "allow" : "deny",
      result: strictResult,
      newValue: indexedRun
    });
    return indexedRun;
  }

  recordHumanEvidenceRepairLoop({
    actor,
    summary,
    evidenceArtifactPath = null,
    linkedModule = "human_regression",
    repairCommit = null,
    retestOfRunId = null,
    ksiegaControlRefs = [],
    phantomBoundaryImpact = "none",
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    const run = this.recordHumanEvidenceRun({
      actor,
      summary,
      evidenceArtifactPath,
      linkedModule,
      repairCommit,
      ksiegaControlRefs,
      phantomBoundaryImpact,
      correlationId: corr
    });
    const strictResult = run.humanEvidence.strictResult;
    const productionSatisfying = isProductionSatisfyingResult(strictResult);
    const blockers = run.humanEvidence.blockers.length
      ? run.humanEvidence.blockers
      : productionSatisfying
        ? []
        : [`strict_result_${strictResult.toLowerCase()}_requires_exact_retest`];
    const blockerProblemIds = blockers.map(
      (blocker, index) =>
        this.createProblem({
          actor,
          title: `${summary.testId} blocker ${index + 1}: ${blocker}`,
          severity: strictResultSeverity(strictResult),
          category: strictResultCategory(strictResult),
          moduleKey: linkedModule,
          status: "open",
          evidenceArtifactIds: run.humanEvidence.evidenceArtifactIds,
          owner: "qa",
          correlationId: corr
        }).id
    );
    const repairLoop = {
      exactRetestTestId: summary.testId,
      retestOfRunId: optionalText(retestOfRunId, "retestOfRunId"),
      retestRequired: !productionSatisfying,
      repairCommit: optionalText(repairCommit, "repairCommit"),
      latestStrictResult: strictResult,
      blockerProblemIds,
      productionReadinessRefused: !productionSatisfying,
      allowedNextAction: productionSatisfying
        ? "freeze_evidence_and_move_to_next_test"
        : "repair_smallest_scope_then_rerun_exact_test_id"
    };
    const indexedRun = {
      ...run,
      repairLoop,
      productionExecutionAllowed: false
    };
    this.testRuns.set(indexedRun.id, indexedRun);
    this.audit.record({
      actorId: actor.id,
      action: "release.human_evidence_repair_loop_recorded",
      resourceType: RESOURCE_TYPES.RELEASE_TEST_RUN,
      resourceId: indexedRun.id,
      correlationId: corr,
      policyDecision: productionSatisfying ? "allow" : "deny",
      result: strictResult,
      newValue: indexedRun
    });
    return indexedRun;
  }

  listArtifacts({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.EVIDENCE_ARTIFACT
    });
    return [...this.artifacts.values()];
  }

  createArtifact({
    actor,
    type = "manual_note",
    path,
    source = "manual",
    linkedModule = "release",
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.EVIDENCE_ARTIFACT
    });
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
      throw validationError("Human test run requires at least one scenario result", {
        field: "results"
      });
    }
    return results.map((item, index) => ({
      scenarioId: safeText(item.scenarioId, `results.${index}.scenarioId`),
      view: optionalText(item.view, `results.${index}.view`) || "unknown",
      status: requireEnum(item.status, TEST_STATUSES, `results.${index}.status`),
      note: optionalText(item.note, `results.${index}.note`),
      evidenceArtifactIds: safeArray(
        item.evidenceArtifactIds || [],
        `results.${index}.evidenceArtifactIds`
      )
    }));
  }

  #normalizeFactualChecks({ appKey, checks }) {
    if (!checks || typeof checks !== "object" || Array.isArray(checks)) {
      throw validationError("Factual checks must be an object", { field: "checks" });
    }
    const required = requiredFactualChecks(appKey);
    const allKeys = [...new Set([...required, ...Object.keys(checks)])];
    return Object.fromEntries(
      allKeys.map((checkKey) => {
        const value = checks[checkKey] || {};
        const asObject = typeof value === "string" ? { status: value } : value;
        const status = requireEnum(
          asObject.status || "not_run",
          FACTUAL_CHECK_STATUSES,
          `checks.${checkKey}.status`
        );
        return [
          checkKey,
          {
            status,
            mode: optionalText(asObject.mode, `checks.${checkKey}.mode`),
            evidence: optionalText(asObject.evidence, `checks.${checkKey}.evidence`),
            note: optionalText(asObject.note, `checks.${checkKey}.note`)
          }
        ];
      })
    );
  }
}
