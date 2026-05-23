const DUCKDUCKGO_APP_KEY = "duckduckgo_browser";
const REQUIRED_CHECKS = ["uiVisible", "browsing"];

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
      && (parsed.pathname.includes("/stream/") || parsed.pathname === "/vnc.html" || parsed.pathname === "/");
  } catch {
    return false;
  }
}

function visualMarkerAccepted(marker) {
  return ["duckduckgo", "duckduckgo_browser", "duckduckgo_search"].includes(value(marker).toLowerCase());
}

function visualMarkerRejected(marker) {
  return ["google", "new_tab", "about_blank", "generic_browser", "chromium_new_tab"].includes(value(marker).toLowerCase());
}

function safeEvidenceRef(ref) {
  const text = value(ref);
  return text.startsWith("artifact://")
    || text.startsWith("screenshot:")
    || text.startsWith("operator-api:")
    || text.startsWith("probe:")
    || text.startsWith("stream:");
}

export function evaluateDuckDuckGoFactualState({
  matrixItem,
  terminalMode = "pixel_grapheneos",
  runtimeMode = "firecracker_gui",
  streamSession = null,
  visualProbe = null,
  browsingProbe = null,
  routeProbe = null,
  latencyMs = null,
  terminalDataStored = false
} = {}) {
  const blockers = [];
  const evidenceArtifactIds = [
    ...asArray(visualProbe?.evidenceArtifactIds),
    ...asArray(browsingProbe?.evidenceArtifactIds),
    ...asArray(routeProbe?.evidenceArtifactIds)
  ];
  const matrixChecks = matrixItem?.mandatoryChecks || matrixItem?.requiredChecks || [];
  if (matrixItem?.appKey !== DUCKDUCKGO_APP_KEY) {
    blockers.push("duckduckgo_matrix_row_missing");
  }
  for (const required of REQUIRED_CHECKS) {
    if (!matrixChecks.includes(required)) blockers.push(`matrix_missing_${required}`);
  }
  if (terminalDataStored === true || streamSession?.security?.terminalDataStored === true || streamSession?.stream?.operationalDataOnTerminal === true) {
    blockers.push("terminal_data_storage_forbidden");
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
  if (streamSession?.gateway?.publicInternetExposure === true) {
    blockers.push("stream_gateway_public_exposure_forbidden");
  }
  if (visualMarkerRejected(visualProbe?.marker)) {
    blockers.push(`wrong_browser_marker:${value(visualProbe?.marker)}`);
  }
  const visualPassed = visualProbe?.status === "passed"
    && visualMarkerAccepted(visualProbe?.marker)
    && (safeEvidenceRef(visualProbe?.evidenceRef) || evidenceArtifactIds.length > 0);
  const browsingPassed = browsingProbe?.status === "passed"
    && browsingProbe?.throughWorkloadRoute === true
    && value(browsingProbe?.targetHost).length > 0
    && browsingProbe?.terminalDataStored !== true
    && (safeEvidenceRef(browsingProbe?.evidenceRef) || evidenceArtifactIds.length > 0);
  const routePassed = routeProbe?.dnsThroughTunnel === true
    && routeProbe?.terminalDefaultRoute === "g1"
    && routeProbe?.workloadEgress === "g2_policy_gateway";
  if (!visualPassed && !visualMarkerRejected(visualProbe?.marker)) {
    blockers.push("duckduckgo_ui_not_factually_observed");
  }
  if (!browsingPassed) {
    blockers.push("duckduckgo_browsing_not_factually_observed");
  }
  if (!routeProbe) {
    blockers.push("duckduckgo_route_probe_missing");
  } else if (!routePassed) {
    blockers.push("duckduckgo_route_probe_not_verified");
  }
  const failed = blockers.some((blocker) => blocker.startsWith("wrong_browser_marker:"))
    || blockers.includes("terminal_data_storage_forbidden")
    || blockers.includes("stream_launch_url_not_internal_sylion")
    || blockers.includes("stream_gateway_public_exposure_forbidden")
    || blockers.includes("g1_g2_bypass_forbidden");
  const result = blockers.length === 0 ? "passed" : failed ? "failed" : "blocked";
  const checks = {
    uiVisible: visualPassed
      ? check("passed", "DuckDuckGo UI marker observed through workload stream", visualProbe?.note || null, visualProbe?.mode || null)
      : check(failed ? "failed" : "blocked", null, visualMarkerRejected(visualProbe?.marker)
        ? `Rejected non-DuckDuckGo UI marker: ${value(visualProbe?.marker)}`
        : "DuckDuckGo UI marker is not proven by a safe evidence reference"),
    browsing: browsingPassed && routePassed
      ? check("passed", `Public browsing metadata probe passed for ${value(browsingProbe?.targetHost)}`, browsingProbe?.note || null, browsingProbe?.mode || null)
      : check(failed ? "failed" : "blocked", null, "Browsing through workload route is not proven by a safe evidence reference")
  };
  return {
    appKey: DUCKDUCKGO_APP_KEY,
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
      ? "DuckDuckGo UI and browsing were factually verified through the workload stream with metadata-only evidence."
      : "DuckDuckGo factual state is not production-satisfying until UI and browsing checks both pass through the workload route.",
    requiredChecks: REQUIRED_CHECKS,
    productionExecutionAllowed: false,
    terminalDataStored: false
  };
}

export const duckDuckGoEvaluatorPolicy = Object.freeze({
  appKey: DUCKDUCKGO_APP_KEY,
  requiredChecks: REQUIRED_CHECKS,
  passRequires: [
    "stream_session_ready",
    "https internal sylion launch URL",
    "G2 gateway",
    "DuckDuckGo UI marker evidence reference",
    "browsing metadata probe through workload route",
    "terminalDataStored=false"
  ],
  failFast: [
    "Google/new tab/generic browser marker",
    "localhost or public launch URL",
    "terminal data storage",
    "G1/G2 bypass",
    "public stream gateway exposure"
  ]
});
