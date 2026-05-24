import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { writeHumanEvidenceSummary } from "./lib/human-evidence.mjs";
import { evaluateLibreOfficeFactualState } from "./lib/libreoffice-factual-evaluator.mjs";
import { AdminApiClient } from "../services/admin-api/src/sdk/adminApiClient.js";

const appKey = "libreoffice";
const baseUrl = process.env.SYLION_BASE_URL || "http://127.0.0.1:18099";
const terminalMode = process.env.SYLION_TERMINAL_MODE || "pixel_grapheneos";
const runtimeMode = process.env.SYLION_RUNTIME_MODE || "firecracker_gui";
const indexHumanEvidence = process.env.SYLION_INDEX_HUMAN_EVIDENCE === "true";
const openStream = process.env.SYLION_LIBREOFFICE_OPEN_STREAM === "true";
const recordFactualPass = process.env.SYLION_LIBREOFFICE_RECORD_FACTUAL === "true";
const headless = process.env.SYLION_HEADLESS !== "false";
const outputDir = join(process.cwd(), "docs", "admin-panel-v2", "test-artifacts", "step3-86-libreoffice-human-runner");

function repoRelativePath(path) {
  return path.startsWith(process.cwd())
    ? path.slice(process.cwd().length + 1).replace(/\\/g, "/")
    : path.replace(/\\/g, "/");
}

function envBool(name) {
  return process.env[name] === "true";
}

function markerFromText(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (/libreoffice writer|writer/i.test(normalized)) return "libreoffice_writer";
  if (/libreoffice calc|calc/i.test(normalized)) return "libreoffice_calc";
  if (/libreoffice|start center/i.test(normalized)) return "libreoffice_start_center";
  if (/download/i.test(normalized)) return "download_page";
  if (/new tab|about:blank/i.test(normalized)) return "new_tab";
  if (/chromium|chrome|firefox|browser/i.test(normalized)) return "generic_browser";
  return null;
}

async function loginClient() {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_step3_86_libre_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-86-libre-${crypto.randomUUID()}`;
  try {
    const enrollment = await anon.createEnrollmentOptions({
      email: "admin@sylion.local",
      password: "ChangeMe-LocalOnly-1!"
    });
    await anon.verifyEnrollment({
      challengeId: enrollment.challenge.id,
      credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}`, transports: ["usb"] }
    });
  } catch {
    // Repeatable local and remote harnesses may already have admin WebAuthn enrollment.
  }
  const loginOptions = await anon.createWebAuthnLoginOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  const loginCredentialId = loginOptions.challenge.publicKey.allowCredentials?.at(-1)?.id || credentialId;
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
      "x-correlation-id": `corr_step3_86_libre_operator_${crypto.randomUUID()}`
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
  const tenant = await client.createTenant({ name: `Step 3.86 LibreOffice Tenant ${stamp}`, tier: "PRO" });
  const operator = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.86 LibreOffice Operator ${stamp}`,
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
  const marker = process.env.SYLION_LIBREOFFICE_UI_MARKER;
  const evidenceRef = process.env.SYLION_LIBREOFFICE_UI_EVIDENCE_REF;
  if (!marker && !evidenceRef) return null;
  return {
    status: process.env.SYLION_LIBREOFFICE_UI_STATUS || "passed",
    marker,
    evidenceRef,
    mode: "human_pixel_or_laptop_marker",
    evidenceArtifactIds: evidenceRef?.startsWith("artifact://") ? [evidenceRef] : []
  };
}

function manualDocumentProbe() {
  const status = process.env.SYLION_LIBREOFFICE_DOCUMENT_STATUS;
  const evidenceRef = process.env.SYLION_LIBREOFFICE_DOCUMENT_EVIDENCE_REF;
  if (!status && !evidenceRef) return null;
  return {
    status: status || "passed",
    nonSensitiveTestDocument: envBool("SYLION_LIBREOFFICE_NON_SENSITIVE_DOCUMENT"),
    documentDataStored: envBool("SYLION_LIBREOFFICE_DOCUMENT_DATA_STORED"),
    evidenceRef,
    mode: "human_pixel_or_laptop_document_workflow",
    evidenceArtifactIds: evidenceRef?.startsWith("artifact://") ? [evidenceRef] : []
  };
}

function cdrProbeFromStream(streamSession) {
  if (process.env.SYLION_LIBREOFFICE_CDR_PROBE) {
    return {
      cdrRequired: envBool("SYLION_LIBREOFFICE_CDR_REQUIRED"),
      ingressEgressBlockedWithoutDecision: envBool("SYLION_LIBREOFFICE_INGRESS_EGRESS_BLOCKED_WITHOUT_DECISION"),
      evidenceArtifactIds: process.env.SYLION_LIBREOFFICE_CDR_EVIDENCE_REF?.startsWith("artifact://")
        ? [process.env.SYLION_LIBREOFFICE_CDR_EVIDENCE_REF]
        : []
    };
  }
  return {
    cdrRequired: streamSession?.stream?.fileTransfer === "cdr_required",
    ingressEgressBlockedWithoutDecision: streamSession?.security?.fileIngressEgress === "blocked_without_cdr_decision",
    evidenceArtifactIds: []
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
    screenshots.operator = await screenshot(page, "libreoffice-operator-workload-control");
    const operatorText = await page.locator("body").innerText().catch(() => "");
    if (!/LibreOffice|Workload|Apps/i.test(operatorText)) {
      probe.status = "failed";
      probe.marker = "operator_panel_missing";
    }
    if (openStream && streamSession?.state === "stream_session_ready" && streamSession?.launchUrl) {
      await page.goto(streamSession.launchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(1500);
      screenshots.stream = await screenshot(page, "libreoffice-stream-view");
      const streamText = await page.locator("body").innerText().catch(() => "");
      const title = await page.title().catch(() => "");
      const marker = markerFromText(`${title} ${streamText}`);
      probe.marker = marker;
      probe.status = marker?.startsWith("libreoffice") ? "passed" : marker ? "failed" : "blocked";
      probe.evidenceRef = `screenshot:${repoRelativePath(screenshots.stream)}`;
      probe.evidenceArtifactIds = [`artifact://local/step3-86-libreoffice-stream-view`];
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
  const connectionPath = await operatorRequest(selected.session.token, "/operator-api/connection-path");
  const streamPayload = await operatorRequest(selected.session.token, "/operator-api/streaming-sessions", {
    method: "POST",
    body: {
      templateKey: appKey,
      protocol: process.env.SYLION_G2_SESSION_BROKER || "webrtc_or_selkies",
      width: Number(process.env.SYLION_PIXEL_WIDTH || 390),
      height: Number(process.env.SYLION_PIXEL_HEIGHT || 844),
      dpr: Number(process.env.SYLION_PIXEL_DPR || 3)
    }
  });
  const browserVisual = await visualProbeFromBrowser({
    operatorToken: selected.session.token,
    streamSession: streamPayload.session
  });
  const visualProbe = manualVisualProbe() || browserVisual.probe;
  const documentProbe = manualDocumentProbe();
  const cdrProbe = cdrProbeFromStream(streamPayload.session);
  const evaluation = evaluateLibreOfficeFactualState({
    matrixItem,
    terminalMode,
    runtimeMode,
    streamSession: streamPayload.session,
    visualProbe,
    documentProbe,
    cdrProbe
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
    screenshots: Object.fromEntries(Object.entries(browserVisual.screenshots).map(([name, path]) => [name, repoRelativePath(path)])),
    evaluation,
    recordedFactualTestId: recordedFactualTest?.test?.id || null,
    recordFactualPass,
    indexHumanEvidence,
    productionExecutionAllowed: false,
    terminalDataStored: false
  };
  await writeFile(join(outputDir, "summary.json"), JSON.stringify(safeSummary, null, 2), "utf8");
  const blockers = evaluation.result === "passed" ? [] : evaluation.blockers;
  const humanEvidence = await writeHumanEvidenceSummary(outputDir, {
    testId: "step3-86-libreoffice-human-factual-runner",
    testVersion: "step3.86",
    tester: "Codex LibreOffice app-specific factual runner",
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
    pathTested: `${terminalMode} -> operator panel -> G2 streaming session -> LibreOffice workload`,
    expectedBehavior: matrixItem.expectedBehavior,
    preconditions: [
      "Admin API is reachable.",
      "Operator session exists or is created for this run.",
      "LibreOffice factual matrix row is available.",
      "Evidence stores only metadata refs and screenshots; no document contents are copied into JSON."
    ],
    actions: [
      "Read LibreOffice factual matrix.",
      "Create or select operator session.",
      "Request LibreOffice streaming session through operator API.",
      "Open operator panel in Pixel-sized Playwright viewport.",
      "Optionally open internal stream URL when explicitly enabled.",
      "Evaluate UI marker, non-sensitive document workflow and CDR boundary with strict pass gates."
    ],
    evidenceRefs: [
      "summary.json",
      ...Object.entries(safeSummary.screenshots).map(([name, path]) => `screenshot:${name}:${path}`),
      "operator-api:/operator-api/connection-path",
      "operator-api:/operator-api/streaming-sessions",
      "matrix:/release/workload-factual-matrix"
    ],
    result: evaluation.strictResult,
    blockers,
    residualRisk: [
      "A blocked result means the runner did not prove real LibreOffice document workflow yet.",
      "PASS requires human or automated pixel evidence of LibreOffice UI plus non-sensitive document workflow metadata.",
      "This runner does not inspect or store document contents."
    ],
    nextRequiredAction: evaluation.result === "passed"
      ? "Promote this app-specific pattern to the next workload runner."
      : "Repair the missing LibreOffice stream/UI/document/CDR evidence, then rerun this runner until the strict gates pass.",
    notes: [
      `streamSessionState=${streamPayload.session.state}`,
      `requiredChecks=${matrixItem.mandatoryChecks.join(",")}`,
      `recordFactualPass=${recordFactualPass}`
    ]
  }, { fileName: "human-evidence.json" });
  safeSummary.humanEvidencePath = repoRelativePath(humanEvidence.path);
  if (indexHumanEvidence && evaluation.result !== "passed") {
    const indexed = await client.recordHumanEvidenceRepairLoop({
      summary: humanEvidence.summary,
      evidenceArtifactPath: repoRelativePath(humanEvidence.path),
      linkedModule: "workload_app:libreoffice",
      ksiegaControlRefs: ["thin_client_terminal", "g1_g2_workload_path", "workload_factual_state", "cdr_mandatory"],
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
