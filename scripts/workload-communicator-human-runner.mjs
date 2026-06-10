import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { writeHumanEvidenceSummary } from "./lib/human-evidence.mjs";
import {
  communicatorDefinition,
  evaluateCommunicatorFactualState
} from "./lib/communicator-factual-evaluator.mjs";
import { AdminApiClient } from "../services/admin-api/src/sdk/adminApiClient.js";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=") || "true"];
  })
);
const appKey = args.get("app") || process.env.SYLION_APP_UNDER_TEST || "signal";
const definition = communicatorDefinition(appKey);
if (!definition) {
  throw new Error(`Unsupported communicator runner app: ${appKey}`);
}

const prefix = appKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const baseUrl = process.env.SYLION_BASE_URL || "http://127.0.0.1:18099";
const terminalMode = process.env.SYLION_TERMINAL_MODE || "pixel_grapheneos";
const runtimeMode =
  process.env.SYLION_RUNTIME_MODE || (appKey === "zangi" ? "android_native" : "firecracker_gui");
const indexHumanEvidence = process.env.SYLION_INDEX_HUMAN_EVIDENCE === "true";
const openStream = process.env[`SYLION_${prefix}_OPEN_STREAM`] === "true";
const recordFactualPass = process.env[`SYLION_${prefix}_RECORD_FACTUAL`] === "true";
const headless = process.env.SYLION_HEADLESS !== "false";
const outputDir = join(
  process.cwd(),
  "docs",
  "admin-panel-v2",
  "test-artifacts",
  `step3-86-${appKey}-human-runner`
);

function repoRelativePath(path) {
  return path.startsWith(process.cwd())
    ? path.slice(process.cwd().length + 1).replace(/\\/g, "/")
    : path.replace(/\\/g, "/");
}

function env(name, fallback = undefined) {
  return process.env[`SYLION_${prefix}_${name}`] ?? fallback;
}

function envBool(name) {
  return process.env[`SYLION_${prefix}_${name}`] === "true";
}

function markerFromText(text) {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (appKey === "signal" && /signal/i.test(normalized))
    return runtimeMode === "android_native" ? "signal_android" : "signal_desktop";
  if (appKey === "whatsapp" && /whats ?app/i.test(normalized)) {
    if (/log in|qr|link/i.test(normalized)) return "web_whatsapp_login_only";
    return runtimeMode === "android_native" ? "whatsapp_android" : "whatsapp_desktop";
  }
  if (appKey === "telegram" && /telegram/i.test(normalized)) {
    if (/download/i.test(normalized)) return "telegram_download_page";
    return runtimeMode === "android_native" ? "telegram_android" : "telegram_desktop";
  }
  if (appKey === "threema" && /threema/i.test(normalized)) {
    if (/download/i.test(normalized)) return "threema_download_page";
    return runtimeMode === "android_native" ? "threema_android" : "threema_desktop";
  }
  if (appKey === "zangi" && /zangi/i.test(normalized)) {
    if (/download/i.test(normalized)) return "zangi_download_page";
    return "zangi_android";
  }
  if (appKey === "simplex" && /simplex/i.test(normalized)) {
    if (/download/i.test(normalized)) return "simplex_download_page";
    return runtimeMode === "android_native" ? "simplex_android" : "simplex_desktop";
  }
  if (/download/i.test(normalized)) return "download_page";
  if (/new tab|about:blank/i.test(normalized)) return "new_tab";
  if (/chromium|chrome|firefox|browser/i.test(normalized)) return "generic_browser";
  return null;
}

async function loginClient() {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_step3_86_${appKey}_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-86-${appKey}-${crypto.randomUUID()}`;
  try {
    const enrollment = await anon.createEnrollmentOptions({
      email: "admin@sylion.local",
      password: "ChangeMe-LocalOnly-1!"
    });
    await anon.verifyEnrollment({
      challengeId: enrollment.challenge.id,
      credential: {
        id: credentialId,
        publicKey: `simulated-public-key:${credentialId}`,
        transports: ["usb"]
      }
    });
  } catch {
    // Repeatable local and remote harnesses may already have admin WebAuthn enrollment.
  }
  const loginOptions = await anon.createWebAuthnLoginOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  const loginCredentialId =
    loginOptions.challenge.publicKey.allowCredentials?.at(-1)?.id || credentialId;
  const session = await anon.verifyWebAuthnLogin({
    challengeId: loginOptions.challenge.id,
    credentialId: loginCredentialId,
    assertion: {
      signature: `simulated:${loginOptions.challenge.id}:${loginCredentialId}`,
      signCounter: 1
    }
  });
  return anon.withToken(session.token);
}

async function operatorRequest(token, path, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-correlation-id": `corr_step3_86_${appKey}_operator_${crypto.randomUUID()}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Operator API request failed for ${path}`);
  }
  return payload;
}

async function createOrSelectOperator(client) {
  if (process.env.SYLION_OPERATOR_ID) {
    const sessionPayload = await client.request("/operator-api/sessions/local-simulator", {
      method: "POST",
      body: {
        operatorId: process.env.SYLION_OPERATOR_ID,
        terminalMode
      }
    });
    return {
      operatorId: process.env.SYLION_OPERATOR_ID,
      tenantId: sessionPayload.session.tenantId,
      session: sessionPayload.session,
      createdForRun: false
    };
  }
  const stamp = Date.now();
  const tenant = await client.createTenant({
    name: `Step 3.86 ${definition.label} Tenant ${stamp}`,
    tier: "PRO"
  });
  const operator = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.86 ${definition.label} Operator ${stamp}`,
    tier: "PRO"
  });
  const sessionPayload = await client.request("/operator-api/sessions/local-simulator", {
    method: "POST",
    body: {
      operatorId: operator.operator.id,
      terminalMode
    }
  });
  return {
    operatorId: operator.operator.id,
    tenantId: tenant.tenant.id,
    session: sessionPayload.session,
    createdForRun: true
  };
}

async function screenshot(page, name) {
  const path = join(outputDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

function manualVisualProbe() {
  const marker = env("UI_MARKER");
  const evidenceRef = env("UI_EVIDENCE_REF");
  if (!marker && !evidenceRef) return null;
  return {
    status: env("UI_STATUS", "passed"),
    marker,
    evidenceRef,
    mode: "human_pixel_or_laptop_marker",
    evidenceArtifactIds: evidenceRef?.startsWith("artifact://") ? [evidenceRef] : []
  };
}

function manualAccountProbe() {
  const status = env("ACCOUNT_BOOTSTRAP_STATUS");
  const evidenceRef = env("ACCOUNT_BOOTSTRAP_EVIDENCE_REF");
  if (!status && !evidenceRef) return null;
  return {
    status: status || "passed",
    mode: env("ACCOUNT_BOOTSTRAP_MODE", runtimeMode),
    nonSecretBootstrap: envBool("ACCOUNT_BOOTSTRAP_NON_SECRET"),
    evidenceRef,
    evidenceArtifactIds: evidenceRef?.startsWith("artifact://") ? [evidenceRef] : []
  };
}

function manualSendReceiveProbe() {
  const status = env("SEND_RECEIVE_STATUS");
  const evidenceRef = env("SEND_RECEIVE_EVIDENCE_REF");
  if (!status && !evidenceRef) return null;
  return {
    status: status || "passed",
    metadataOnly: envBool("SEND_RECEIVE_METADATA_ONLY"),
    communicationDataStored: envBool("COMMUNICATION_DATA_STORED"),
    evidenceRef,
    evidenceArtifactIds: evidenceRef?.startsWith("artifact://") ? [evidenceRef] : []
  };
}

function manualApkProbe() {
  if (appKey !== "zangi") return null;
  const status = env("APK_PROVENANCE_STATUS");
  const evidenceRef = env("APK_PROVENANCE_EVIDENCE_REF");
  if (!status && !evidenceRef) return null;
  return {
    status: status || "passed",
    approvedSource: envBool("APK_APPROVED_SOURCE"),
    evidenceRef,
    evidenceArtifactIds: evidenceRef?.startsWith("artifact://") ? [evidenceRef] : []
  };
}

function routeProbeFromEnv() {
  if (!env("ROUTE_PROBE")) return null;
  return {
    dnsThroughTunnel: envBool("DNS_THROUGH_TUNNEL"),
    terminalDefaultRoute: env("TERMINAL_DEFAULT_ROUTE", "unknown"),
    workloadEgress: env("WORKLOAD_EGRESS", "unknown"),
    evidenceArtifactIds: env("ROUTE_EVIDENCE_REF")?.startsWith("artifact://")
      ? [env("ROUTE_EVIDENCE_REF")]
      : []
  };
}

async function visualProbeFromBrowser({ operatorToken, streamSession }) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();
  const screenshots = {};
  const probe = {
    status: "blocked",
    marker: null,
    evidenceRef: null,
    mode: "playwright_pixel_viewport",
    evidenceArtifactIds: []
  };
  try {
    const operatorUrl = `${baseUrl}/operator#workload-control&op_token=${encodeURIComponent(operatorToken)}`;
    await page.goto(operatorUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1000);
    screenshots.operator = await screenshot(page, `${appKey}-operator-workload-control`);
    const operatorText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    if (!new RegExp(`${definition.label}|Workload|Apps`, "i").test(operatorText)) {
      probe.status = "failed";
      probe.marker = "operator_panel_missing";
    }
    if (openStream && streamSession?.state === "stream_session_ready" && streamSession?.launchUrl) {
      await page.goto(streamSession.launchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(1500);
      screenshots.stream = await screenshot(page, `${appKey}-stream-view`);
      const streamText = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      const title = await page.title().catch(() => "");
      const marker = markerFromText(`${title} ${streamText}`);
      probe.marker = marker;
      probe.status = definition.acceptedMarkers.includes(marker)
        ? "passed"
        : marker
          ? "failed"
          : "blocked";
      probe.evidenceRef = `screenshot:${repoRelativePath(screenshots.stream)}`;
      probe.evidenceArtifactIds = [`artifact://local/step3-86-${appKey}-stream-view`];
    } else if (screenshots.operator) {
      probe.evidenceRef = `screenshot:${repoRelativePath(screenshots.operator)}`;
    }
  } catch {
    probe.status = "blocked";
    probe.marker = probe.marker || null;
  } finally {
    await context.close();
    await browser.close();
  }
  return { probe, screenshots };
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  const client = await loginClient();
  const matrixResponse = await client.listWorkloadFactualMatrix({ appKey });
  const matrixItem = matrixResponse.matrix[0];
  const selected = await createOrSelectOperator(client);
  const connectionPath = await operatorRequest(
    selected.session.token,
    "/operator-api/connection-path"
  );
  const streamPayload = await operatorRequest(
    selected.session.token,
    "/operator-api/streaming-sessions",
    {
      method: "POST",
      body: {
        templateKey: appKey,
        protocol: process.env.SYLION_G2_SESSION_BROKER || "webrtc_or_selkies",
        width: Number(process.env.SYLION_PIXEL_WIDTH || 390),
        height: Number(process.env.SYLION_PIXEL_HEIGHT || 844),
        dpr: Number(process.env.SYLION_PIXEL_DPR || 3)
      }
    }
  );
  const browserVisual = await visualProbeFromBrowser({
    operatorToken: selected.session.token,
    streamSession: streamPayload.session
  });
  const evaluation = evaluateCommunicatorFactualState({
    appKey,
    matrixItem,
    terminalMode,
    runtimeMode,
    streamSession: streamPayload.session,
    visualProbe: manualVisualProbe() || browserVisual.probe,
    accountProbe: manualAccountProbe(),
    sendReceiveProbe: manualSendReceiveProbe(),
    apkProbe: manualApkProbe(),
    routeProbe: routeProbeFromEnv()
  });
  let recordedFactualTest = null;
  if (evaluation.result === "passed" && recordFactualPass) {
    recordedFactualTest = await client.recordWorkloadFactualTest({
      operatorId: selected.operatorId,
      appKey,
      terminalMode,
      runtimeMode,
      result: "passed",
      checks: evaluation.checks,
      evidenceArtifactIds: evaluation.evidenceArtifactIds,
      latencyMs: evaluation.latencyMs,
      note: evaluation.note
    });
  }
  const safeSummary = {
    generatedAt: new Date().toISOString(),
    appKey,
    terminalMode,
    runtimeMode,
    operatorId: selected.operatorId,
    tenantId: selected.tenantId,
    operatorCreatedForRun: selected.createdForRun,
    connectionPathState: connectionPath.path?.state || null,
    connectionPathBlockers: connectionPath.path?.blockers || [],
    streamSessionState: streamPayload.session.state,
    streamSessionBlockers: streamPayload.session.blockers || [],
    streamSessionWarnings: streamPayload.session.warnings || [],
    streamGatewayRole: streamPayload.session.gateway?.role || null,
    streamBrokerProtocol: streamPayload.session.gateway?.protocol || null,
    streamSourceReadiness: streamPayload.session.source?.readiness || null,
    streamInternalLaunchUrlPresent: Boolean(streamPayload.session.launchUrl),
    screenshots: Object.fromEntries(
      Object.entries(browserVisual.screenshots).map(([name, path]) => [
        name,
        repoRelativePath(path)
      ])
    ),
    evaluation,
    recordedFactualTestId: recordedFactualTest?.test?.id || null,
    recordFactualPass,
    indexHumanEvidence,
    productionExecutionAllowed: false,
    terminalDataStored: false
  };
  await writeFile(join(outputDir, "summary.json"), JSON.stringify(safeSummary, null, 2), "utf8");
  const blockers = evaluation.result === "passed" ? [] : evaluation.blockers;
  const humanEvidence = await writeHumanEvidenceSummary(
    outputDir,
    {
      testId: `step3-86-${appKey}-human-factual-runner`,
      testVersion: "step3.86",
      tester: `Codex ${definition.label} app-specific factual runner`,
      environment: {
        mode: "app_specific_human_runner",
        adminApi: "configured_admin_api",
        appKey,
        runtimeMode,
        productionMutationAllowed: false
      },
      terminal: {
        type: terminalMode,
        browserAutomation: "playwright_pixel_viewport",
        operationalDataOnTerminal: false
      },
      pathTested: `${terminalMode} -> operator panel -> G2 streaming session -> ${definition.label} workload`,
      expectedBehavior: matrixItem.expectedBehavior,
      preconditions: [
        "Admin API is reachable.",
        "Operator session exists or is created for this run.",
        `${definition.label} factual matrix row is available.`,
        "Evidence stores only metadata refs and screenshots; no OTP, account secret or communication content is copied into JSON."
      ],
      actions: [
        `Read ${definition.label} factual matrix.`,
        "Create or select operator session.",
        `Request ${definition.label} streaming session through operator API.`,
        "Open operator panel in Pixel-sized Playwright viewport.",
        "Optionally open internal stream URL when explicitly enabled.",
        "Evaluate UI marker, account bootstrap, send/receive metadata and route proof with strict pass gates."
      ],
      evidenceRefs: [
        "summary.json",
        ...Object.entries(safeSummary.screenshots).map(
          ([name, path]) => `screenshot:${name}:${path}`
        ),
        "operator-api:/operator-api/connection-path",
        "operator-api:/operator-api/streaming-sessions",
        "matrix:/release/workload-factual-matrix"
      ],
      result: evaluation.strictResult,
      blockers,
      residualRisk: [
        `A blocked result means the runner did not prove real ${definition.label} account bootstrap and send/receive yet.`,
        "PASS requires human or automated pixel evidence plus metadata-only workflow evidence through the workload route.",
        "This runner does not inspect, copy or store communication content."
      ],
      nextRequiredAction:
        evaluation.result === "passed"
          ? "Promote this communicator pattern to the next workload runner."
          : `Repair the missing ${definition.label} stream/UI/bootstrap/send-receive/route evidence, then rerun this runner until the strict gates pass.`,
      notes: [
        `streamSessionState=${streamPayload.session.state}`,
        `requiredChecks=${matrixItem.mandatoryChecks.join(",")}`,
        `recordFactualPass=${recordFactualPass}`
      ]
    },
    { fileName: "human-evidence.json" }
  );
  safeSummary.humanEvidencePath = repoRelativePath(humanEvidence.path);
  if (indexHumanEvidence && evaluation.result !== "passed") {
    const indexed = await client.recordHumanEvidenceRepairLoop({
      summary: humanEvidence.summary,
      evidenceArtifactPath: repoRelativePath(humanEvidence.path),
      linkedModule: `workload_app:${appKey}`,
      ksiegaControlRefs: [
        "thin_client_terminal",
        "g1_g2_workload_path",
        "workload_factual_state",
        "cdr_mandatory"
      ],
      phantomBoundaryImpact: "none"
    });
    safeSummary.indexedRepairLoopId = indexed.run.id;
  }
  await writeFile(join(outputDir, "summary.json"), JSON.stringify(safeSummary, null, 2), "utf8");
  console.log(JSON.stringify(safeSummary, null, 2));
  if (evaluation.result !== "passed") {
    process.exitCode = 1;
  }
}

await run();
