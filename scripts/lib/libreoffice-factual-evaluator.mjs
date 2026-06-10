const LIBREOFFICE_APP_KEY = "libreoffice";
const REQUIRED_CHECKS = ["uiVisible", "documentWorkflow"];

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
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(".sylion.internal") &&
      !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) &&
      (parsed.pathname.includes("/stream/") ||
        parsed.pathname === "/" ||
        parsed.pathname === "/vnc.html")
    );
  } catch {
    return false;
  }
}

function visualMarkerAccepted(marker) {
  return [
    "libreoffice",
    "libreoffice_writer",
    "libreoffice_calc",
    "libreoffice_start_center"
  ].includes(value(marker).toLowerCase());
}

function visualMarkerRejected(marker) {
  return ["generic_browser", "download_page", "new_tab", "about_blank", "only_process"].includes(
    value(marker).toLowerCase()
  );
}

function safeEvidenceRef(ref) {
  const text = value(ref);
  return (
    text.startsWith("artifact://") ||
    text.startsWith("screenshot:") ||
    text.startsWith("operator-api:") ||
    text.startsWith("probe:") ||
    text.startsWith("stream:")
  );
}

export function evaluateLibreOfficeFactualState({
  matrixItem,
  terminalMode = "pixel_grapheneos",
  runtimeMode = "firecracker_gui",
  streamSession = null,
  visualProbe = null,
  documentProbe = null,
  cdrProbe = null,
  latencyMs = null,
  terminalDataStored = false,
  documentDataStored = false
} = {}) {
  const blockers = [];
  const evidenceArtifactIds = [
    ...asArray(visualProbe?.evidenceArtifactIds),
    ...asArray(documentProbe?.evidenceArtifactIds),
    ...asArray(cdrProbe?.evidenceArtifactIds)
  ];
  const matrixChecks = matrixItem?.mandatoryChecks || matrixItem?.requiredChecks || [];
  if (matrixItem?.appKey !== LIBREOFFICE_APP_KEY) {
    blockers.push("libreoffice_matrix_row_missing");
  }
  for (const required of REQUIRED_CHECKS) {
    if (!matrixChecks.includes(required)) blockers.push(`matrix_missing_${required}`);
  }
  if (
    terminalDataStored === true ||
    streamSession?.security?.terminalDataStored === true ||
    streamSession?.stream?.operationalDataOnTerminal === true
  ) {
    blockers.push("terminal_data_storage_forbidden");
  }
  if (documentDataStored === true || documentProbe?.documentDataStored === true) {
    blockers.push("document_data_storage_forbidden");
  }
  if (streamSession?.state !== "stream_session_ready") {
    blockers.push(
      streamSession?.state ? `stream_${streamSession.state}` : "stream_session_missing"
    );
    for (const blocker of asArray(streamSession?.blockers)) {
      blockers.push(`stream_blocker:${blocker}`);
    }
  }
  const launchUrl = value(streamSession?.launchUrl);
  if (!launchUrl) {
    blockers.push("stream_launch_url_missing_until_session_ready");
  } else if (!internalSylionLaunchUrl(launchUrl)) {
    blockers.push("stream_launch_url_not_internal_sylion");
  }
  if (streamSession?.gateway?.role && streamSession.gateway.role !== "G2") {
    blockers.push("stream_gateway_not_g2");
  }
  if (streamSession?.security?.g1G2BypassAllowed === true) {
    blockers.push("g1_g2_bypass_forbidden");
  }
  if (
    streamSession?.security?.fileIngressEgress &&
    !String(streamSession.security.fileIngressEgress).includes("cdr")
  ) {
    blockers.push("cdr_boundary_missing");
  }
  if (visualMarkerRejected(visualProbe?.marker)) {
    blockers.push(`wrong_office_marker:${value(visualProbe?.marker)}`);
  }
  const visualPassed =
    visualProbe?.status === "passed" &&
    visualMarkerAccepted(visualProbe?.marker) &&
    (safeEvidenceRef(visualProbe?.evidenceRef) || evidenceArtifactIds.length > 0);
  const documentWorkflowPassed =
    documentProbe?.status === "passed" &&
    documentProbe?.nonSensitiveTestDocument === true &&
    documentProbe?.documentDataStored !== true &&
    (safeEvidenceRef(documentProbe?.evidenceRef) || evidenceArtifactIds.length > 0);
  const cdrPassed =
    cdrProbe?.cdrRequired === true && cdrProbe?.ingressEgressBlockedWithoutDecision === true;
  if (!visualPassed && !visualMarkerRejected(visualProbe?.marker)) {
    blockers.push("libreoffice_ui_not_factually_observed");
  }
  if (!documentWorkflowPassed) {
    blockers.push("libreoffice_document_workflow_not_factually_observed");
  }
  if (!cdrProbe) {
    blockers.push("libreoffice_cdr_probe_missing");
  } else if (!cdrPassed) {
    blockers.push("libreoffice_cdr_boundary_not_verified");
  }
  const failed =
    blockers.some((blocker) => blocker.startsWith("wrong_office_marker:")) ||
    blockers.includes("terminal_data_storage_forbidden") ||
    blockers.includes("document_data_storage_forbidden") ||
    blockers.includes("stream_launch_url_not_internal_sylion") ||
    blockers.includes("g1_g2_bypass_forbidden") ||
    blockers.includes("cdr_boundary_missing");
  const result = blockers.length === 0 ? "passed" : failed ? "failed" : "blocked";
  const checks = {
    uiVisible: visualPassed
      ? check(
          "passed",
          "LibreOffice UI marker observed through workload stream",
          visualProbe?.note || null,
          visualProbe?.mode || null
        )
      : check(
          failed ? "failed" : "blocked",
          null,
          visualMarkerRejected(visualProbe?.marker)
            ? `Rejected non-LibreOffice UI marker: ${value(visualProbe?.marker)}`
            : "LibreOffice UI marker is not proven by a safe evidence reference"
        ),
    documentWorkflow:
      documentWorkflowPassed && cdrPassed
        ? check(
            "passed",
            "Non-sensitive document workflow metadata passed with CDR boundary present",
            documentProbe?.note || null,
            documentProbe?.mode || null
          )
        : check(
            failed ? "failed" : "blocked",
            null,
            "LibreOffice document workflow or CDR boundary is not proven"
          )
  };
  return {
    appKey: LIBREOFFICE_APP_KEY,
    terminalMode,
    runtimeMode,
    result,
    strictResult: result === "passed" ? "PASS" : result === "failed" ? "FAIL" : "BLOCKED",
    factualStateVerified: result === "passed",
    checks,
    blockers: [...new Set(blockers)],
    evidenceArtifactIds: [...new Set(evidenceArtifactIds)],
    latencyMs: latencyMs === null || latencyMs === undefined ? null : Number(latencyMs),
    note:
      result === "passed"
        ? "LibreOffice UI and non-sensitive document workflow were factually verified with metadata-only evidence and CDR boundary."
        : "LibreOffice factual state is not production-satisfying until UI, document workflow and CDR-boundary checks pass.",
    requiredChecks: REQUIRED_CHECKS,
    productionExecutionAllowed: false,
    terminalDataStored: false
  };
}

export const libreOfficeEvaluatorPolicy = Object.freeze({
  appKey: LIBREOFFICE_APP_KEY,
  requiredChecks: REQUIRED_CHECKS,
  passRequires: [
    "stream_session_ready",
    "https internal sylion launch URL",
    "G2 gateway",
    "LibreOffice UI marker evidence reference",
    "non-sensitive document workflow metadata",
    "CDR boundary present",
    "terminalDataStored=false"
  ],
  failFast: [
    "generic browser/download page marker",
    "localhost or public launch URL",
    "terminal data storage",
    "document data storage",
    "G1/G2 bypass",
    "missing CDR boundary"
  ]
});
