import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { writeHumanEvidenceSummary } from "./lib/human-evidence.mjs";
import { AdminApiClient } from "../services/admin-api/src/sdk/adminApiClient.js";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.SYLION_BASE_URL || "http://127.0.0.1:18099";
const baseUrlParsed = new URL(baseUrl);
const basePort = baseUrlParsed.port || (baseUrlParsed.protocol === "https:" ? "443" : "80");
const operatorView = process.env.SYLION_OPERATOR_VIEW || "signal-preview";
const adbPath = process.env.SYLION_ADB_PATH || join(process.cwd(), ".deploy", "platform-tools", "adb.exe");
const outputDir = join(process.cwd(), "docs", "admin-panel-v2", "test-artifacts", "step3-24-pixel-adb-operator-lab");
const indexHumanEvidence = process.env.SYLION_INDEX_HUMAN_EVIDENCE === "true";

function repoRelativePath(path) {
  return path.startsWith(process.cwd())
    ? path.slice(process.cwd().length + 1).replace(/\\/g, "/")
    : path.replace(/\\/g, "/");
}

async function ensureAdb() {
  try {
    await access(adbPath);
    return adbPath;
  } catch {
    throw new Error(`ADB not found at ${adbPath}. Install Android platform-tools or set SYLION_ADB_PATH.`);
  }
}

async function adb(args, options = {}) {
  const result = await execFileAsync(await ensureAdb(), args, {
    timeout: options.timeout ?? 15000,
    windowsHide: true
  });
  return result.stdout.trim();
}

function parseDeviceList(output) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/);
      return { serial, state, detail: rest.join(" ") };
    });
}

async function requireAuthorizedPixel() {
  const devices = parseDeviceList(await adb(["devices", "-l"]));
  const unauthorized = devices.find((device) => device.state === "unauthorized");
  if (unauthorized) {
    throw new Error(`Pixel ${unauthorized.serial} is visible but unauthorized. Confirm the USB debugging prompt on the phone and rerun.`);
  }
  const device = devices.find((candidate) => candidate.state === "device");
  if (!device) {
    throw new Error("No authorized ADB device found. Connect the Pixel, unlock it, and authorize USB debugging.");
  }
  return device;
}

async function getprop(serial, key) {
  try {
    return await adb(["-s", serial, "shell", "getprop", key]);
  } catch {
    return "";
  }
}

async function loginClient() {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_step3_24_pixel_adb_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-24-pixel-${crypto.randomUUID()}`;
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
    // Persistent remote state may already have an enrolled admin credential.
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

async function operatorRequest(token, path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-correlation-id": `corr_step3_24_operator_${crypto.randomUUID()}`
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Operator API request failed for ${path}`);
  }
  return payload;
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  const pixel = await requireAuthorizedPixel();
  const [model, product, release, sdk, securityPatch, fingerprint] = await Promise.all([
    getprop(pixel.serial, "ro.product.model"),
    getprop(pixel.serial, "ro.product.device"),
    getprop(pixel.serial, "ro.build.version.release"),
    getprop(pixel.serial, "ro.build.version.sdk"),
    getprop(pixel.serial, "ro.build.version.security_patch"),
    getprop(pixel.serial, "ro.build.fingerprint")
  ]);

  const client = await loginClient();
  const stamp = Date.now();
  const tenant = await client.createTenant({ name: `Step 3.24 Pixel ADB Tenant ${stamp}`, tier: "PRO" });
  const operator = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.24 Pixel ADB Operator ${stamp}`,
    tier: "PRO"
  });

  const posture = {
    state: "adb_lab_ready",
    os: "GrapheneOS",
    adbAuthorized: true,
    product,
    androidRelease: release,
    sdk,
    securityPatch,
    fingerprintHash: await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint))
      .then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""))
  };
  const serial = `adb:${pixel.serial}`;
  const existingDevices = await client.request("/devices?type=pixel_grapheneos");
  const existingPixel = existingDevices.devices.find((device) => device.serial === serial);
  let pixelDevice;
  if (existingPixel) {
    const assigned = await client.request(`/devices/${existingPixel.id}/assign`, {
      method: "POST",
      body: { operatorId: operator.operator.id }
    });
    pixelDevice = await client.request(`/devices/${assigned.device.id}/posture`, {
      method: "POST",
      body: { posture, status: "assigned" }
    });
  } else {
    pixelDevice = await client.registerDevice({
      type: "pixel_grapheneos",
      serial,
      model: model || "Pixel GrapheneOS ADB lab",
      assignedOperatorId: operator.operator.id,
      posture,
      metadata: {
        adbTransport: pixel.detail,
        terminalDataStored: false,
        operationalDataOnTerminal: false
      }
    });
  }
  await client.registerDevice({
    type: "laptop_web_terminal",
    serial: `laptop-step3-24-${crypto.randomUUID()}`,
    model: "Laptop web thin client",
    assignedOperatorId: operator.operator.id,
    posture: { state: "browser_lab_ready" }
  });

  const artifact = await client.request("/images/artifacts", {
    method: "POST",
    body: {
      artifactType: "pixel_grapheneos_profile",
      tenantId: tenant.tenant.id,
      operatorId: operator.operator.id,
      sourceRef: "source://grapheneos/operator-terminal-profile",
      deviceId: pixelDevice.device.id,
      policy: {
        thinClientOnly: true,
        storesOperationalData: false,
        vpnPath: ["Pixel GrapheneOS terminal", "Puli AX", "G1", "G2", "WORKLOAD"],
        baselineTransport: "ipsec_ikev2",
        adbUse: "lab_posture_and_portal_open_only"
      }
    }
  });
  const pipeline = operator.provisioningDraft;
  if (!operator.baselineProvisioning || pipeline.status !== "local_lab_ready") {
    throw new Error("Operator create did not produce automatic G1/G2/WORKLOAD local baseline");
  }
  const environment = await client.createLocalOperatorEnvironment(pipeline.id);
  await client.startLocalOperatorEnvironment(environment.environment.id);
  await client.checkOperatorEnvironmentSecretsRelease(environment.environment.id);

  const sessionPayload = await client.request("/operator-api/sessions/local-simulator", {
    method: "POST",
    body: {
      operatorId: operator.operator.id,
      terminalMode: "pixel_grapheneos",
      deviceId: pixelDevice.device.id
    }
  });
  const viewport = { width: 390, height: 844, dpr: 3 };
  const [me, vpn, connectionPath, signalExecution, vpnInstall, stream, devices, profiles] = await Promise.all([
    operatorRequest(sessionPayload.session.token, "/operator-api/me"),
    operatorRequest(sessionPayload.session.token, "/operator-api/vpn-status"),
    operatorRequest(sessionPayload.session.token, "/operator-api/connection-path"),
    operatorRequest(sessionPayload.session.token, "/operator-api/workload-execution/signal"),
    operatorRequest(sessionPayload.session.token, "/operator-api/vpn-install-package"),
    operatorRequest(sessionPayload.session.token, `/operator-api/streaming-profile?width=${viewport.width}&height=${viewport.height}&dpr=${viewport.dpr}`),
    operatorRequest(sessionPayload.session.token, "/operator-api/devices"),
    operatorRequest(sessionPayload.session.token, "/operator-api/terminal-profiles")
  ]);

  await adb(["-s", pixel.serial, "reverse", `tcp:${basePort}`, `tcp:${basePort}`]);
  const operatorUrl = `${baseUrl}/operator#${operatorView}&op_token=${encodeURIComponent(sessionPayload.session.token)}`;
  await adb([
    "-s",
    pixel.serial,
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    operatorUrl
  ]);

  const summary = {
    baseUrl,
    adbSerial: pixel.serial,
    operatorId: operator.operator.id,
    tenantId: tenant.tenant.id,
    pixelDeviceId: pixelDevice.device.id,
    artifactId: artifact.artifact.id,
    pipelineId: pipeline.id,
    localLabId: operator.baselineProvisioning.vps?.length === 3 ? pipeline.localLab?.id || null : null,
    environmentId: environment.environment.id,
    operatorSessionId: sessionPayload.session.id,
    vpnState: vpn.vpn.state,
    vpnTransport: vpn.vpn.transport,
    connectionPathState: connectionPath.path.state,
    connectionPathSegments: connectionPath.path.segments.map((segment) => segment.id),
    communicatorMicroVmSlots: connectionPath.path.microVmSlots.map((slot) => slot.templateKey),
    signalExecutionReadiness: signalExecution.execution.readinessState,
    signalExecutionBlockers: signalExecution.execution.blockers,
    signalSubstrate: signalExecution.execution.runtime.substrate,
    vpnInstallState: vpnInstall.package.installState,
    streamTarget: `${stream.profile.stream.targetWidth}x${stream.profile.stream.targetHeight}`,
    streamResizePolicy: stream.profile.stream.resizePolicy,
    terminalMode: me.me.terminalMode,
    terminalEligibleDevices: devices.devices.filter((device) => device.terminalEligible).length,
    pixelProfileAvailable: profiles.profiles.some((profile) => profile.mode === "pixel_grapheneos" && profile.adbSupportedForLab),
    productionExecutionAllowed: false,
    operationalDataOnTerminal: false,
    openedOperatorPortalOnPixel: true,
    openedOperatorPortalView: operatorView,
    openedSignalPreviewOnPixel: operatorView === "signal-preview",
    usedLocalhostLabTokenBootstrap: true,
    checkedAt: new Date().toISOString()
  };
  const labHealthy = summary.openedOperatorPortalOnPixel
    && summary.pixelProfileAvailable
    && summary.connectionPathState === "ready"
    && summary.terminalMode === "pixel_grapheneos";
  const humanEvidence = await writeHumanEvidenceSummary(outputDir, {
    testId: "step3-24-pixel-adb-operator-lab",
    testVersion: "step3.86",
    tester: "Codex Pixel ADB harness",
    environment: {
      mode: "local_lab",
      adminApi: "local_admin_api",
      g1g2WorkloadPath: "simulated_local_lab",
      productionMutationAllowed: false
    },
    terminal: {
      type: "pixel_grapheneos",
      adbAuthorized: true,
      serialHashRef: "adb_device_seen",
      targetViewport: summary.streamTarget,
      resizePolicy: summary.streamResizePolicy
    },
    pathTested: "Pixel ADB -> local reverse tunnel -> operator panel local lab -> simulated G1/G2/WORKLOAD metadata",
    expectedBehavior: "A connected Pixel opens the operator panel in lab mode, receives only thin-client metadata, and does not store operational data on the terminal.",
    preconditions: [
      "Authorized Pixel is visible over ADB.",
      "Local admin API is running.",
      "Operator baseline creates exactly 3 local lab VPS layers.",
      "Lab session is explicitly non-production."
    ],
    actions: [
      "Create tenant and operator.",
      "Register Pixel and laptop terminal profiles.",
      "Create local operator environment.",
      "Open operator panel on Pixel through ADB.",
      "Query VPN, connection path, workload execution and streaming profile metadata."
    ],
    evidenceRefs: [
      "summary.json",
      "operator-api:/operator-api/me",
      "operator-api:/operator-api/connection-path",
      "operator-api:/operator-api/workload-execution/signal",
      "operator-api:/operator-api/streaming-profile"
    ],
    result: labHealthy ? "LAB_PASS" : "FAIL",
    blockers: [
      ...summary.signalExecutionBlockers,
      "local_lab_does_not_prove_live_pixel_g1_g2_workload_path",
      "physical_puli_ax_router_test_blocked_until_hardware_arrives",
      "physical_hsm_fido2_test_blocked_until_devices_are_present"
    ],
    residualRisk: [
      "This lab run proves operator-panel and Pixel bootstrap ergonomics only.",
      "Live VPN, Guacamole/streaming and workload application usability must be proven by live human regression."
    ],
    nextRequiredAction: "Run step3-40 live Pixel human regression and compare with live path evidence."
  }, { fileName: "human-evidence.json" });
  summary.humanEvidencePath = humanEvidence.path;
  if (indexHumanEvidence) {
    const indexed = await client.recordHumanEvidenceRun({
      summary: humanEvidence.summary,
      evidenceArtifactPath: repoRelativePath(humanEvidence.path),
      linkedModule: "pixel_adb_operator_lab",
      ksiegaControlRefs: ["thin_client_terminal", "operator_panel_bootstrap", "g1_g2_workload_path"],
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
      reason: "Set SYLION_INDEX_HUMAN_EVIDENCE=true to POST human-evidence.json into Release inventory."
    };
  }
  await writeFile(join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

await run();
