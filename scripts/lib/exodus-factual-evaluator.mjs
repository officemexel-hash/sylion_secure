const EXODUS_APP_KEY = "exodus";
const REQUIRED_CHECKS = ["uiVisible", "walletWorkflow", "riskAcceptance"];

function value(value) {
  return String(value || "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((item) => String(item)) : [];
}

function check(status, evidence = null, note = null, mode = null) {
  return {
    status,
    evidence,
    note,
    mode
  };
}

function internalSylionLaunchUrl(url) {
  const raw = value(url);
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:"
      && parsed.hostname.endsWith(".sylion.internal")
      && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
      && (parsed.pathname.includes("/stream/") || parsed.pathname === "/" || parsed.pathname === "/vnc.html");
  } catch {
    return false;
  }
}

function visualMarkerAccepted(marker) {
  return ["exodus", "exodus_wallet", "exodus_desktop"].includes(value(marker).toLowerCase());
}

function visualMarkerRejected(marker) {
  return ["exodus_download_page", "generic_browser", "download_page", "new_tab", "about_blank"].includes(value(marker).toLowerCase());
}

function safeEvidenceRef(ref) {
  const text = value(ref);
  return text.startsWith("artifact://")
    || text.startsWith("screenshot:")
    || text.startsWith("operator-api:")
    || text.startsWith("probe:")
    || text.startsWith("stream:");
}

function forbiddenProbeFields(input, path = []) {
  if (!input || typeof input !== "object") return [];
  return Object.entries(input).flatMap(([key, nested]) => {
    const current = [...path, key];
    const normalized = String(key).replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    const own = /(password|secret|token|api_key|otp|sms|seed|mnemonic|private_key|wallet_seed|wallet_secret|wallet_file|recovery_phrase)/.test(normalized)
      ? [current.join(".")]
      : [];
    return nested && typeof nested === "object" ? [...own, ...forbiddenProbeFields(nested, current)] : own;
  });
}

export function evaluateExodusFactualState({
  matrixItem,
  terminalMode = "pixel_grapheneos",
  runtimeMode = "firecracker_gui",
  streamSession = null,
  visualProbe = null,
  walletProbe = null,
  riskProbe = null,
  latencyMs = null,
  terminalDataStored = false,
  walletDataStored = false
} = {}) {
  const blockers = [];
  const evidenceArtifactIds = [
    ...asArray(visualProbe?.evidenceArtifactIds),
    ...asArray(walletProbe?.evidenceArtifactIds),
    ...asArray(riskProbe?.evidenceArtifactIds)
  ];
  const matrixChecks = matrixItem?.mandatoryChecks || matrixItem?.requiredChecks || [];
  if (matrixItem?.appKey !== EXODUS_APP_KEY) {
    blockers.push("exodus_matrix_row_missing");
  }
  for (const required of REQUIRED_CHECKS) {
    if (!matrixChecks.includes(required)) blockers.push(`matrix_missing_${required}`);
  }
  const forbiddenFields = forbiddenProbeFields({ visualProbe, walletProbe, riskProbe });
  for (const field of forbiddenFields) {
    blockers.push(`forbidden_probe_field:${field}`);
  }
  if (terminalDataStored === true || streamSession?.security?.terminalDataStored === true || streamSession?.stream?.operationalDataOnTerminal === true) {
    blockers.push("terminal_data_storage_forbidden");
  }
  if (walletDataStored === true || walletProbe?.walletDataStored === true) {
    blockers.push("wallet_data_storage_forbidden");
  }
  if (streamSession?.state !== "stream_session_ready") {
    blockers.push(streamSession?.state ? `stream_${streamSession.state}` : "stream_session_missing");
  }
  if (!internalSylionLaunchUrl(streamSession?.launchUrl)) {
    blockers.push("stream_launch_url_not_internal_sylion");
  }
  if (streamSession?.gateway?.role && streamSession.gateway.role !== "G2") {
    blockers.push("stream_gateway_not_g2");
  }
  if (streamSession?.security?.g1G2BypassAllowed === true) {
    blockers.push("g1_g2_bypass_forbidden");
  }
  if (visualMarkerRejected(visualProbe?.marker)) {
    blockers.push(`wrong_exodus_marker:${value(visualProbe?.marker)}`);
  }
  const visualPassed = visualProbe?.status === "passed"
    && visualMarkerAccepted(visualProbe?.marker)
    && (safeEvidenceRef(visualProbe?.evidenceRef) || evidenceArtifactIds.length > 0);
  const walletWorkflowPassed = walletProbe?.status === "passed"
    && walletProbe?.testOnlyWorkflow === true
    && walletProbe?.walletDataStored !== true
    && (safeEvidenceRef(walletProbe?.evidenceRef) || evidenceArtifactIds.length > 0);
  const riskAccepted = riskProbe?.status === "passed"
    && riskProbe?.operatorRiskAccepted === true
    && (safeEvidenceRef(riskProbe?.evidenceRef) || evidenceArtifactIds.length > 0);
  if (!visualPassed && !visualMarkerRejected(visualProbe?.marker)) {
    blockers.push("exodus_ui_not_factually_observed");
  }
  if (!walletWorkflowPassed) {
    blockers.push("exodus_wallet_workflow_not_factually_observed");
  }
  if (!riskAccepted) {
    blockers.push("exodus_risk_acceptance_not_verified");
  }
  const failed = blockers.some((blocker) => blocker.startsWith("wrong_exodus_marker:"))
    || blockers.some((blocker) => blocker.startsWith("forbidden_probe_field:"))
    || blockers.includes("terminal_data_storage_forbidden")
    || blockers.includes("wallet_data_storage_forbidden")
    || blockers.includes("stream_launch_url_not_internal_sylion")
    || blockers.includes("g1_g2_bypass_forbidden");
  const result = blockers.length === 0 ? "passed" : failed ? "failed" : "blocked";
  const checks = {
    uiVisible: visualPassed
      ? check("passed", "Exodus UI marker observed through workload stream", visualProbe?.note || null, visualProbe?.mode || null)
      : check(failed ? "failed" : "blocked", null, visualMarkerRejected(visualProbe?.marker)
        ? `Rejected non-Exodus UI marker: ${value(visualProbe?.marker)}`
        : "Exodus UI marker is not proven by a safe evidence reference"),
    walletWorkflow: walletWorkflowPassed
      ? check("passed", "Test-only Exodus wallet workflow metadata passed without wallet data", walletProbe?.note || null, walletProbe?.mode || null)
      : check(failed ? "failed" : "blocked", null, "Exodus wallet workflow is not proven without wallet data"),
    riskAcceptance: riskAccepted
      ? check("passed", "Operator risk acceptance metadata is recorded", riskProbe?.note || null, riskProbe?.mode || null)
      : check(failed ? "failed" : "blocked", null, "Operator risk acceptance is not verified")
  };
  return {
    appKey: EXODUS_APP_KEY,
    terminalMode,
    runtimeMode,
    result,
    strictResult: result === "passed" ? "PASS" : result === "failed" ? "FAIL" : "BLOCKED",
    factualStateVerified: result === "passed",
    checks,
    blockers: [...new Set(blockers)],
    evidenceArtifactIds: [...new Set(evidenceArtifactIds)],
    latencyMs: latencyMs === null || latencyMs === undefined ? null : Number(latencyMs),
    note: result === "passed"
      ? "Exodus UI, test-only wallet workflow and risk acceptance were factually verified with metadata-only evidence."
      : "Exodus factual state is not production-satisfying until UI, wallet workflow and risk acceptance checks pass without wallet data.",
    requiredChecks: REQUIRED_CHECKS,
    productionExecutionAllowed: false,
    terminalDataStored: false
  };
}

export const exodusEvaluatorPolicy = Object.freeze({
  appKey: EXODUS_APP_KEY,
  requiredChecks: REQUIRED_CHECKS,
  passRequires: [
    "stream_session_ready",
    "https internal sylion launch URL",
    "G2 gateway",
    "Exodus UI marker evidence reference",
    "test-only wallet workflow metadata",
    "operator risk acceptance metadata",
    "terminalDataStored=false",
    "walletDataStored=false"
  ],
  failFast: [
    "download page or generic browser marker",
    "localhost or public launch URL",
    "terminal or wallet data storage",
    "seed, mnemonic, recovery phrase or private-key fields",
    "G1/G2 bypass"
  ]
});
