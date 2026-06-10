import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { writeHumanEvidenceSummary } from "./lib/human-evidence.mjs";
import { AdminApiClient } from "../services/admin-api/src/sdk/adminApiClient.js";

const baseUrl = process.env.SYLION_BASE_URL || "http://127.0.0.1:18099";
const operatorView = process.env.SYLION_OPERATOR_VIEW || "workload-control";
const indexHumanEvidence = process.env.SYLION_INDEX_HUMAN_EVIDENCE === "true";
const outputDir = join(
  process.cwd(),
  "docs",
  "admin-panel-v2",
  "test-artifacts",
  "step3-86-laptop-terminal-human-regression"
);

function repoRelativePath(path) {
  return path.startsWith(process.cwd())
    ? path.slice(process.cwd().length + 1).replace(/\\/g, "/")
    : path.replace(/\\/g, "/");
}

async function loginClient() {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_step3_86_laptop_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-86-laptop-${crypto.randomUUID()}`;
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
    // Persistent local/remote admin state may already have an enrolled credential.
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

async function operatorRequest(token, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-correlation-id": `corr_step3_86_laptop_operator_${crypto.randomUUID()}`
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Operator API request failed for ${path}`);
  }
  return payload;
}

async function seedLaptopOperator(client) {
  const stamp = Date.now();
  const tenant = await client.createTenant({
    name: `Step 3.86 Laptop Tenant ${stamp}`,
    tier: "PRO"
  });
  const operator = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.86 Laptop Operator ${stamp}`,
    tier: "PRO"
  });
  const laptop = await client.registerDevice({
    type: "laptop_web_terminal",
    serial: `laptop-step3-86-${crypto.randomUUID()}`,
    model: "Laptop web thin client human regression",
    assignedOperatorId: operator.operator.id,
    posture: {
      state: "browser_lab_ready",
      storesOperationalData: false,
      thinClientOnly: true
    }
  });
  const pipeline = operator.provisioningDraft;
  if (!operator.baselineProvisioning || pipeline.status !== "local_lab_ready") {
    throw new Error("Operator create did not produce automatic G1/G2/WORKLOAD local baseline.");
  }
  const environment = await client.createLocalOperatorEnvironment(pipeline.id);
  await client.startLocalOperatorEnvironment(environment.environment.id);
  await client.checkOperatorEnvironmentSecretsRelease(environment.environment.id);
  const sessionPayload = await client.request("/operator-api/sessions/local-simulator", {
    method: "POST",
    body: {
      operatorId: operator.operator.id,
      terminalMode: "laptop_web_terminal",
      deviceId: laptop.device.id
    }
  });
  return {
    tenant,
    operator: operator.operator,
    pipeline,
    environment: environment.environment,
    laptop: laptop.device,
    session: sessionPayload.session
  };
}

async function screenshot(page, name) {
  const path = join(outputDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

function visible(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  const client = await loginClient();
  const seeded = await seedLaptopOperator(client);
  const viewport = { width: 1366, height: 768, dpr: 1 };
  const [me, connectionPath, signalExecution, stream, terminalProfiles] = await Promise.all([
    operatorRequest(seeded.session.token, "/operator-api/me"),
    operatorRequest(seeded.session.token, "/operator-api/connection-path"),
    operatorRequest(seeded.session.token, "/operator-api/workload-execution/signal"),
    operatorRequest(
      seeded.session.token,
      `/operator-api/streaming-profile?width=${viewport.width}&height=${viewport.height}&dpr=${viewport.dpr}`
    ),
    operatorRequest(seeded.session.token, "/operator-api/terminal-profiles")
  ]);

  const browser = await chromium.launch({ headless: process.env.SYLION_HEADLESS !== "false" });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();
  const screenshots = {};
  const issues = [];
  try {
    await page.goto(`${baseUrl}/admin`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    screenshots.admin = await screenshot(page, "laptop-admin-panel");
    const adminText = visible(
      await page
        .locator("body")
        .innerText()
        .catch(() => "")
    );
    if (!/SYLION|Admin|Release|Operators/i.test(adminText)) {
      issues.push("Laptop browser did not render recognizable admin panel text.");
    }

    const operatorUrl = `${baseUrl}/operator#${operatorView}&op_token=${encodeURIComponent(seeded.session.token)}`;
    await page.goto(operatorUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1500);
    screenshots.operator = await screenshot(page, "laptop-operator-panel");
    const operatorText = visible(
      await page
        .locator("body")
        .innerText()
        .catch(() => "")
    );
    if (!/Operator|Workload|Apps|Signal|Session/i.test(operatorText)) {
      issues.push("Laptop browser did not render recognizable operator workload controls.");
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (me.me.terminalMode !== "laptop_web_terminal") {
    issues.push("Operator API session did not resolve to laptop_web_terminal mode.");
  }
  if (connectionPath.path.state !== "ready") {
    issues.push(
      `Connection path state is ${connectionPath.path.state}, expected ready for lab parity.`
    );
  }
  if (!terminalProfiles.profiles.some((profile) => profile.mode === "laptop_web_terminal")) {
    issues.push("Laptop terminal profile is not available to operator.");
  }
  if (!stream.profile?.stream?.targetWidth || !stream.profile?.stream?.targetHeight) {
    issues.push("Laptop streaming profile did not return target dimensions.");
  }

  const summary = {
    baseUrl,
    operatorId: seeded.operator.id,
    tenantId: seeded.tenant.tenant.id,
    laptopDeviceId: seeded.laptop.id,
    operatorSessionId: seeded.session.id,
    terminalMode: me.me.terminalMode,
    connectionPathState: connectionPath.path.state,
    signalExecutionReadiness: signalExecution.execution.readinessState,
    signalExecutionBlockers: signalExecution.execution.blockers,
    signalSubstrate: signalExecution.execution.runtime.substrate,
    streamTarget: `${stream.profile.stream.targetWidth}x${stream.profile.stream.targetHeight}`,
    streamResizePolicy: stream.profile.stream.resizePolicy,
    screenshots: Object.fromEntries(
      Object.entries(screenshots).map(([key, path]) => [key, repoRelativePath(path)])
    ),
    issues,
    productionExecutionAllowed: false,
    operationalDataOnTerminal: false,
    checkedAt: new Date().toISOString()
  };
  const strictResult = issues.length ? "FAIL" : "LAB_PASS";
  const humanEvidence = await writeHumanEvidenceSummary(
    outputDir,
    {
      testId: "step3-86-laptop-terminal-human-regression",
      testVersion: "step3.86",
      tester: "Codex laptop Playwright harness",
      environment: {
        mode: "local_lab",
        adminApi: "local_or_configured_admin_api",
        g1g2WorkloadPath: "simulated_local_lab",
        productionMutationAllowed: false
      },
      terminal: {
        type: "laptop_web_terminal",
        browserAutomation: "playwright",
        targetViewport: summary.streamTarget,
        resizePolicy: summary.streamResizePolicy,
        operationalDataOnTerminal: false
      },
      pathTested:
        "Laptop browser -> operator panel -> local lab G1/G2/WORKLOAD metadata -> workload stream selector",
      expectedBehavior:
        "A laptop terminal can open the admin panel and operator workload controls as a thin client without storing operational data locally.",
      preconditions: [
        "Admin API is running.",
        "Chromium automation is available.",
        "Operator baseline creates exactly 3 local lab VPS layers.",
        "Lab session is explicitly non-production."
      ],
      actions: [
        "Create tenant and operator.",
        "Register laptop terminal profile.",
        "Create local operator environment.",
        "Open admin panel in laptop browser.",
        "Open operator workload controls in laptop browser.",
        "Query connection path, signal execution and streaming profile metadata."
      ],
      evidenceRefs: [
        "summary.json",
        ...Object.entries(summary.screenshots).map(([name, path]) => `screenshot:${name}:${path}`),
        "operator-api:/operator-api/connection-path",
        "operator-api:/operator-api/workload-execution/signal",
        "operator-api:/operator-api/streaming-profile"
      ],
      result: strictResult,
      blockers: [
        ...issues,
        ...signalExecution.execution.blockers,
        "local_lab_does_not_prove_live_laptop_g1_g2_workload_path",
        "physical_puli_ax_router_test_blocked_until_hardware_arrives",
        "physical_hsm_fido2_test_blocked_until_devices_are_present"
      ],
      residualRisk: [
        "Laptop lab parity does not prove live VPN path, Guacamole/streaming latency or app usability.",
        "Pixel and laptop live path must be compared after exact live path evidence is reproducible."
      ],
      nextRequiredAction:
        "Run laptop live path test after G1/G2/workload route and stream gateway are fully evidenced."
    },
    { fileName: "human-evidence.json" }
  );
  summary.humanEvidencePath = humanEvidence.path;
  if (indexHumanEvidence) {
    const indexed = await client.recordHumanEvidenceRun({
      summary: humanEvidence.summary,
      evidenceArtifactPath: repoRelativePath(humanEvidence.path),
      linkedModule: "laptop_terminal_parity",
      ksiegaControlRefs: [
        "thin_client_terminal",
        "operator_panel_bootstrap",
        "g1_g2_workload_path"
      ],
      phantomBoundaryImpact: "none"
    });
    summary.humanEvidenceIndexed = {
      runId: indexed.run.id,
      strictResult: indexed.run.humanEvidence.strictResult,
      artifactIds: indexed.run.humanEvidence.evidenceArtifactIds
    };
  } else {
    summary.humanEvidenceIndexed = {
      skipped: true,
      reason:
        "Set SYLION_INDEX_HUMAN_EVIDENCE=true to POST human-evidence.json into Release inventory."
    };
  }
  await writeFile(join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (issues.length) {
    process.exitCode = 1;
  }
}

await run();
