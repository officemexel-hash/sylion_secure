const COMMUNICATOR_APPS = Object.freeze({
  signal: {
    label: "Signal",
    acceptedMarkers: ["signal", "signal_desktop", "signal_android"],
    rejectedMarkers: ["generic_browser", "download_page", "qr_only", "new_tab", "about_blank"],
    requiredChecks: ["uiVisible", "accountBootstrap", "sendReceive"]
  },
  whatsapp: {
    label: "WhatsApp",
    acceptedMarkers: ["whatsapp", "whatsapp_desktop", "whatsapp_android"],
    rejectedMarkers: [
      "web_whatsapp_login_only",
      "generic_browser",
      "download_page",
      "qr_only",
      "new_tab",
      "about_blank"
    ],
    requiredChecks: ["uiVisible", "accountBootstrap", "sendReceive"]
  },
  telegram: {
    label: "Telegram",
    acceptedMarkers: ["telegram", "telegram_desktop", "telegram_android"],
    rejectedMarkers: [
      "telegram_download_page",
      "generic_browser",
      "download_page",
      "phone_prompt_only",
      "new_tab",
      "about_blank"
    ],
    requiredChecks: ["uiVisible", "accountBootstrap", "sendReceive"]
  },
  threema: {
    label: "Threema",
    acceptedMarkers: ["threema", "threema_desktop", "threema_android"],
    rejectedMarkers: [
      "threema_download_page",
      "generic_browser",
      "download_page",
      "new_tab",
      "about_blank"
    ],
    requiredChecks: ["uiVisible", "accountBootstrap", "sendReceive"]
  },
  zangi: {
    label: "Zangi",
    acceptedMarkers: ["zangi", "zangi_android"],
    rejectedMarkers: [
      "zangi_download_page",
      "generic_browser",
      "download_page",
      "new_tab",
      "about_blank"
    ],
    requiredChecks: ["uiVisible", "accountBootstrap", "sendReceive", "apkProvenance"]
  },
  simplex: {
    label: "SimpleX Chat",
    acceptedMarkers: ["simplex", "simplex_desktop", "simplex_android"],
    rejectedMarkers: [
      "simplex_download_page",
      "generic_browser",
      "download_page",
      "new_tab",
      "about_blank"
    ],
    requiredChecks: ["uiVisible", "accountBootstrap", "sendReceive", "imageProvenance"]
  }
});

const ALLOWED_RUNTIME_MODES = new Set([
  "desktop",
  "android_native",
  "firecracker_gui",
  "container"
]);
const ALLOWED_GUARDRAIL_KEYS = new Set([
  "nonSecretBootstrap",
  "metadataOnly",
  "communicationDataStored"
]);

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

function forbiddenProbeFields(input, path = []) {
  if (!input || typeof input !== "object") return [];
  return Object.entries(input).flatMap(([key, nested]) => {
    const current = [...path, key];
    const normalized = String(key)
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase();
    const own = ALLOWED_GUARDRAIL_KEYS.has(key)
      ? []
      : /(password|secret|token|api_key|otp|sms|verification_code|phone_number|seed|mnemonic|private_key|message_content|chat_content|contact_list)/.test(
            normalized
          )
        ? [current.join(".")]
        : [];
    return nested && typeof nested === "object"
      ? [...own, ...forbiddenProbeFields(nested, current)]
      : own;
  });
}

function markerAccepted(definition, marker) {
  return definition.acceptedMarkers.includes(value(marker).toLowerCase());
}

function markerRejected(definition, marker) {
  return definition.rejectedMarkers.includes(value(marker).toLowerCase());
}

function mandatoryChecks(matrixItem, definition) {
  return matrixItem?.mandatoryChecks || matrixItem?.requiredChecks || definition.requiredChecks;
}

export function evaluateCommunicatorFactualState({
  appKey,
  matrixItem,
  terminalMode = "pixel_grapheneos",
  runtimeMode = "firecracker_gui",
  streamSession = null,
  visualProbe = null,
  accountProbe = null,
  sendReceiveProbe = null,
  apkProbe = null,
  routeProbe = null,
  latencyMs = null,
  terminalDataStored = false,
  communicationDataStored = false
} = {}) {
  const key = value(appKey);
  const definition = COMMUNICATOR_APPS[key];
  if (!definition) {
    throw new Error(`Unsupported communicator appKey: ${appKey}`);
  }
  const blockers = [];
  const requiredChecks = mandatoryChecks(matrixItem, definition);
  const evidenceArtifactIds = [
    ...asArray(visualProbe?.evidenceArtifactIds),
    ...asArray(accountProbe?.evidenceArtifactIds),
    ...asArray(sendReceiveProbe?.evidenceArtifactIds),
    ...asArray(apkProbe?.evidenceArtifactIds),
    ...asArray(routeProbe?.evidenceArtifactIds)
  ];
  if (matrixItem?.appKey !== key) {
    blockers.push(`${key}_matrix_row_missing`);
  }
  for (const required of definition.requiredChecks) {
    if (!requiredChecks.includes(required)) blockers.push(`matrix_missing_${required}`);
  }
  if (!ALLOWED_RUNTIME_MODES.has(runtimeMode) || runtimeMode === "web") {
    blockers.push(`${key}_runtime_mode_not_allowed`);
  }
  if (
    terminalDataStored === true ||
    streamSession?.security?.terminalDataStored === true ||
    streamSession?.stream?.operationalDataOnTerminal === true
  ) {
    blockers.push("terminal_data_storage_forbidden");
  }
  if (communicationDataStored === true || sendReceiveProbe?.communicationDataStored === true) {
    blockers.push("communication_data_storage_forbidden");
  }
  const forbiddenFields = forbiddenProbeFields({
    visualProbe,
    accountProbe,
    sendReceiveProbe,
    apkProbe
  });
  for (const field of forbiddenFields) {
    blockers.push(`forbidden_probe_field:${field}`);
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
  if (markerRejected(definition, visualProbe?.marker)) {
    blockers.push(`wrong_${key}_marker:${value(visualProbe?.marker)}`);
  }
  if (accountProbe?.mode === "web_link_only") {
    blockers.push(`${key}_web_link_only_bootstrap_forbidden`);
  }
  const visualPassed =
    visualProbe?.status === "passed" &&
    markerAccepted(definition, visualProbe?.marker) &&
    (safeEvidenceRef(visualProbe?.evidenceRef) || evidenceArtifactIds.length > 0);
  const accountPassed =
    accountProbe?.status === "passed" &&
    accountProbe?.mode !== "web_link_only" &&
    accountProbe?.nonSecretBootstrap === true &&
    (safeEvidenceRef(accountProbe?.evidenceRef) || evidenceArtifactIds.length > 0);
  const sendReceivePassed =
    sendReceiveProbe?.status === "passed" &&
    sendReceiveProbe?.metadataOnly === true &&
    sendReceiveProbe?.communicationDataStored !== true &&
    (safeEvidenceRef(sendReceiveProbe?.evidenceRef) || evidenceArtifactIds.length > 0);
  const routePassed =
    routeProbe?.dnsThroughTunnel === true &&
    routeProbe?.terminalDefaultRoute === "g1" &&
    routeProbe?.workloadEgress === "g2_policy_gateway";
  const packageProvenanceRequired = key === "zangi" || key === "simplex";
  const packageProvenancePassed =
    !packageProvenanceRequired ||
    (apkProbe?.status === "passed" &&
      apkProbe?.approvedSource === true &&
      (safeEvidenceRef(apkProbe?.evidenceRef) || evidenceArtifactIds.length > 0));
  if (!visualPassed && !markerRejected(definition, visualProbe?.marker)) {
    blockers.push(`${key}_ui_not_factually_observed`);
  }
  if (!accountPassed) {
    blockers.push(`${key}_account_bootstrap_not_factually_observed`);
  }
  if (!sendReceivePassed) {
    blockers.push(`${key}_send_receive_not_factually_observed`);
  }
  if (!routeProbe) {
    blockers.push(`${key}_route_probe_missing`);
  } else if (!routePassed) {
    blockers.push(`${key}_route_probe_not_verified`);
  }
  if (!packageProvenancePassed) {
    blockers.push(
      key === "zangi"
        ? "zangi_apk_provenance_not_verified"
        : `${key}_package_provenance_not_verified`
    );
  }
  const failed =
    blockers.some((blocker) => blocker.startsWith(`wrong_${key}_marker:`)) ||
    blockers.some((blocker) => blocker.startsWith("forbidden_probe_field:")) ||
    blockers.includes("terminal_data_storage_forbidden") ||
    blockers.includes("communication_data_storage_forbidden") ||
    blockers.includes("stream_launch_url_not_internal_sylion") ||
    blockers.includes("g1_g2_bypass_forbidden") ||
    blockers.includes(`${key}_web_link_only_bootstrap_forbidden`) ||
    blockers.includes(`${key}_runtime_mode_not_allowed`);
  const result = blockers.length === 0 ? "passed" : failed ? "failed" : "blocked";
  const checks = {
    uiVisible: visualPassed
      ? check(
          "passed",
          `${definition.label} UI marker observed through workload stream`,
          visualProbe?.note || null,
          visualProbe?.mode || null
        )
      : check(
          failed ? "failed" : "blocked",
          null,
          markerRejected(definition, visualProbe?.marker)
            ? `Rejected non-${definition.label} UI marker: ${value(visualProbe?.marker)}`
            : `${definition.label} UI marker is not proven by a safe evidence reference`
        ),
    accountBootstrap: accountPassed
      ? check(
          "passed",
          `${definition.label} non-secret account bootstrap metadata passed`,
          accountProbe?.note || null,
          accountProbe?.mode || null
        )
      : check(
          failed ? "failed" : "blocked",
          null,
          "Account bootstrap is not proven without secrets or web-link-only evidence"
        ),
    sendReceive:
      sendReceivePassed && routePassed
        ? check(
            "passed",
            `${definition.label} metadata-only send/receive check passed through workload route`,
            sendReceiveProbe?.note || null,
            sendReceiveProbe?.mode || null
          )
        : check(
            failed ? "failed" : "blocked",
            null,
            "Send/receive metadata or route proof is missing"
          )
  };
  if (key === "zangi") {
    checks.apkProvenance = packageProvenancePassed
      ? check(
          "passed",
          "Zangi APK provenance approved by metadata-only evidence",
          apkProbe?.note || null,
          apkProbe?.mode || null
        )
      : check(failed ? "failed" : "blocked", null, "Zangi APK provenance is not verified");
  }
  if (key === "simplex") {
    checks.imageProvenance = packageProvenancePassed
      ? check(
          "passed",
          "SimpleX image/package provenance approved by metadata-only evidence",
          apkProbe?.note || null,
          apkProbe?.mode || null
        )
      : check(
          failed ? "failed" : "blocked",
          null,
          "SimpleX image/package provenance is not verified"
        );
  }
  return {
    appKey: key,
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
        ? `${definition.label} UI, bootstrap and send/receive were factually verified with metadata-only evidence.`
        : `${definition.label} factual state is not production-satisfying until UI, bootstrap, send/receive and route checks pass.`,
    requiredChecks: definition.requiredChecks,
    productionExecutionAllowed: false,
    terminalDataStored: false
  };
}

export function communicatorDefinition(appKey) {
  return COMMUNICATOR_APPS[value(appKey)] || null;
}

export const communicatorEvaluatorPolicy = Object.freeze({
  supportedApps: Object.keys(COMMUNICATOR_APPS),
  passRequires: [
    "stream_session_ready",
    "https internal sylion launch URL",
    "G2 gateway",
    "app UI marker evidence reference",
    "non-secret account bootstrap metadata",
    "metadata-only send/receive check",
    "G1/G2/workload route probe",
    "terminalDataStored=false",
    "Zangi APK provenance when appKey=zangi",
    "SimpleX image/package provenance when appKey=simplex"
  ],
  failFast: [
    "web-link-only bootstrap",
    "web runtime mode",
    "generic browser/download page marker",
    "localhost or public launch URL",
    "terminal or communication data storage",
    "forbidden probe field",
    "G1/G2 bypass"
  ]
});
