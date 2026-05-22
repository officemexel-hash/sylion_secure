import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const adbPath = process.env.SYLION_ADB_PATH || "C:\\Users\\razor\\Android\\platform-tools\\adb.exe";
const sshKey = process.env.SYLION_ADMIN_SSH_KEY || ".deploy\\sylion_hetzner_admin_ed25519";
const adminSsh = process.env.SYLION_ADMIN_SSH || "root@188.245.227.27";
const adminInternalBaseUrl = process.env.SYLION_ADMIN_INTERNAL_BASE_URL || "https://admin.sylion.internal";
const operatorInternalBaseUrl = process.env.SYLION_OPERATOR_INTERNAL_BASE_URL || "https://operator.sylion.internal";
const workloadGatewayIp = process.env.SYLION_WORKLOAD_GATEWAY_IP || "10.42.0.12";
const outputDir = join(process.cwd(), "docs", "admin-panel-v2", "test-artifacts", "step3-40-pixel-live-human-regression");

const workloadHosts = [
  "signal",
  "whatsapp",
  "telegram",
  "threema",
  "zangi",
  "duckduckgo",
  "libreoffice",
  "exodus"
];

const workloadVisualExpectations = {
  signal: {
    pass: [/Signal/i],
    allowCanvasEvidence: true,
    blocker: [
      /wymaga nazwy użytkownika i hasła|requires a username and password|401/i,
      /Nazwa użytkownika|Hasło|Username|Password/i
    ],
    blockerMessage: "Signal reaches only the workload auth gate; it does not yet open the Signal Desktop session on Pixel."
  },
  whatsapp: {
    pass: [/WhatsApp/i],
    allowCanvasEvidence: true,
    blocker: [/New Tab|Google|Chromium didn't shut down|AI Mode|Search Google/i],
    blockerMessage: "WhatsApp reaches only the generic SYLION/Selkies stream shell or browser new tab; the actual WhatsApp UI is not verified on Pixel."
  },
  telegram: {
    pass: [/Telegram/i],
    allowCanvasEvidence: true,
    blocker: [/New Tab|Google|Chromium didn't shut down|AI Mode|Search Google/i],
    blockerMessage: "Telegram reaches only the generic SYLION/Selkies stream shell or browser new tab; the actual Telegram UI is not verified on Pixel."
  },
  threema: {
    pass: [/Threema/i],
    allowCanvasEvidence: true,
    blocker: [/New Tab|Google|Chromium didn't shut down|AI Mode|Search Google/i],
    blockerMessage: "Threema reaches only the generic SYLION/Selkies stream shell or browser new tab; the actual Threema UI is not verified on Pixel."
  },
  zangi: {
    pass: [/Zangi/i],
    blocker: [/SYLION Zangi|zangi\.com\/download|Download Zangi|Cookie Policy|Stack Exchange can store cookies/i],
    blockerMessage: "Zangi reaches only the generic stream shell or public download page; production Zangi still needs an isolated Android-native workload runner."
  },
  duckduckgo: {
    pass: [/DuckDuckGo/i],
    allowCanvasEvidence: true,
    blocker: [/Search with Google|Google or enter|Amazon|Temu|Sponsored|Ubuntu|XtraDeb/i],
    blockerMessage: "DuckDuckGo is misconfigured as a generic Firefox/Google new-tab workload."
  },
  libreoffice: {
    pass: [/LibreOffice/i],
    blocker: [/New Tab|Google|Firefox|Chromium didn't shut down/i],
    blockerMessage: "LibreOffice did not render the LibreOffice workload UI."
  },
  exodus: {
    pass: [/Exodus/i],
    blocker: [/SYLION Exodus|exodus\.com\/download|New Tab|Google|Search Google|Web Store|Add shortcut/i],
    blockerMessage: "Exodus reaches only the generic SYLION/Selkies stream shell or browser new tab; the actual Exodus wallet UI is not verified on Pixel."
  }
};

async function runCommand(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout ?? 30_000,
    windowsHide: true,
    input: options.input
  });
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

async function adb(args, options = {}) {
  return runCommand(adbPath, args, options);
}

async function ssh(script, options = {}) {
  return runCommand("ssh", [
    "-i",
    sshKey,
    "-o",
    "StrictHostKeyChecking=accept-new",
    adminSsh,
    script
  ], { timeout: options.timeout ?? 60_000 });
}

function parseDeviceList(output) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...detail] = line.split(/\s+/);
      return { serial, state, detail: detail.join(" ") };
    });
}

function xmlDecode(value) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function visibleUiText(rawUiXml) {
  const values = [];
  for (const match of rawUiXml.matchAll(/\b(?:text|content-desc|hint)="([^"]*)"/g)) {
    const value = xmlDecode(match[1]).trim();
    if (value) values.push(value);
  }
  return values.join("\n");
}

async function requirePixel() {
  const devices = parseDeviceList((await adb(["devices", "-l"])).stdout);
  const unauthorized = devices.find((device) => device.state === "unauthorized");
  if (unauthorized) {
    throw new Error(`Pixel ${unauthorized.serial} is unauthorized. Confirm USB debugging on the phone.`);
  }
  const pixel = devices.find((device) => device.state === "device");
  if (!pixel) {
    throw new Error("No authorized Pixel found over ADB.");
  }
  return pixel;
}

async function screencap(serial, name) {
  const remote = `/sdcard/Download/${name}.png`;
  const local = join(outputDir, `${name}.png`);
  await adb(["-s", serial, "shell", "screencap", "-p", remote], { timeout: 20_000 });
  await adb(["-s", serial, "pull", remote, local], { timeout: 20_000 });
  return local;
}

async function dumpUi(serial, name) {
  const remote = `/sdcard/Download/${name}.xml`;
  const local = join(outputDir, `${name}.xml`);
  await adb(["-s", serial, "shell", "uiautomator", "dump", remote], { timeout: 20_000 });
  await adb(["-s", serial, "pull", remote, local], { timeout: 20_000 });
  const raw = await readFile(local, "utf8");
  const sanitized = raw.replace(/op_token=op_[A-Za-z0-9]+/g, "op_token=REDACTED_OPERATOR_TOKEN");
  if (sanitized !== raw) {
    await writeFile(local, sanitized, "utf8");
  }
  return sanitized;
}

async function openUrl(serial, url, name, delayMs = 3500) {
  await adb([
    "-s",
    serial,
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    url
  ], { timeout: 20_000 });
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  const screenshot = await screencap(serial, name);
  let uiText = "";
  try {
    uiText = await dumpUi(serial, name);
    if (/Restore pages\?|Chromium didn't shut down/i.test(uiText)) {
      await adb(["-s", serial, "shell", "input", "keyevent", "BACK"], { timeout: 20_000 }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await screencap(serial, name);
      uiText = await dumpUi(serial, name);
    }
  } catch {
    uiText = "";
  }
  return { screenshot, uiText };
}

async function resetBrowserSurface(serial) {
  await adb(["-s", serial, "shell", "am", "force-stop", "app.vanadium.browser"], { timeout: 20_000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

async function seedLiveOperator() {
  const script = String.raw`
node --input-type=module <<'NODE'
import { AdminApiClient } from "/opt/sylion-secure/services/admin-api/src/sdk/adminApiClient.js";
const baseUrl = "http://127.0.0.1:8099";
const anon = new AdminApiClient({
  baseUrl,
  correlationIdFactory: () => "corr_step3_40_pixel_live_" + crypto.randomUUID()
});
const credentialId = "cred-step3-40-pixel-live-" + crypto.randomUUID();
try {
  const enrollment = await anon.createEnrollmentOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  await anon.verifyEnrollment({
    challengeId: enrollment.challenge.id,
    credential: { id: credentialId, publicKey: "simulated-public-key:" + credentialId, transports: ["usb"] }
  });
} catch {}
const loginOptions = await anon.createWebAuthnLoginOptions({
  email: "admin@sylion.local",
  password: "ChangeMe-LocalOnly-1!"
});
const loginCredentialId = loginOptions.challenge.publicKey.allowCredentials?.at(-1)?.id || credentialId;
const session = await anon.verifyWebAuthnLogin({
  challengeId: loginOptions.challenge.id,
  credentialId: loginCredentialId,
  assertion: {
    signature: "simulated:" + loginOptions.challenge.id + ":" + loginCredentialId,
    signCounter: 1
  }
});
const client = anon.withToken(session.token);
const stamp = Date.now();
const tenant = await client.createTenant({ name: "Step 3.40 Pixel Live Tenant " + stamp, tier: "PRO" });
const created = await client.createOperator({
  tenantId: tenant.tenant.id,
  displayName: "Step 3.40 Pixel Live Operator " + stamp,
  tier: "PRO"
});
const pixel = await client.registerDevice({
  type: "pixel_grapheneos",
  serial: "adb-live-pixel-step3-40-" + stamp,
  model: "Pixel GrapheneOS live ADB terminal",
  assignedOperatorId: created.operator.id,
  posture: { state: "adb_live_ready", os: "GrapheneOS", vpnExpected: true }
});
const operatorSession = await client.request("/operator-api/sessions/local-simulator", {
  method: "POST",
  body: {
    operatorId: created.operator.id,
    terminalMode: "pixel_grapheneos",
    deviceId: pixel.device.id
  }
});
const endpoints = {};
for (const path of [
  "/operator-api/me",
  "/operator-api/vpn-status",
  "/operator-api/connection-path",
  "/operator-api/vpn-install-package",
  "/operator-api/pixel-ca-provisioning",
  "/operator-api/streaming-profile?width=390&height=844&dpr=3",
  "/operator-api/workload-execution/signal",
  "/operator-api/workload-execution/zangi"
]) {
  const response = await fetch(baseUrl + path, {
    headers: {
      authorization: "Bearer " + operatorSession.session.token,
      "x-correlation-id": "corr_step3_40_operator_" + crypto.randomUUID()
    }
  });
  endpoints[path] = await response.json();
}
console.log(JSON.stringify({
  tenantId: tenant.tenant.id,
  operatorId: created.operator.id,
  operatorName: created.operator.displayName,
  pixelDeviceId: pixel.device.id,
  operatorSession: operatorSession.session,
  endpoints
}, null, 2));
NODE`;
  const result = await ssh(script, { timeout: 90_000 });
  return JSON.parse(result.stdout);
}

async function fetchInternalCertificate() {
  const script = `openssl s_client -connect ${workloadGatewayIp}:443 -servername signal.sylion.internal </dev/null 2>/dev/null | openssl x509 -outform PEM`;
  const result = await ssh(script);
  const cert = result.stdout;
  const localPath = join(outputDir, "sylion-internal-ca.crt");
  await writeFile(localPath, cert + "\n", "ascii");
  const inspect = await ssh(`openssl s_client -connect ${workloadGatewayIp}:443 -servername signal.sylion.internal </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -fingerprint -sha256 -ext subjectAltName`);
  return { localPath, inspect: inspect.stdout };
}

async function deliverCaToPixel(serial, certPath) {
  await adb(["-s", serial, "push", certPath, "/sdcard/Download/sylion-internal-ca.crt"], { timeout: 20_000 });
  const installIntent = await adb([
    "-s",
    serial,
    "shell",
    "am",
    "start",
    "-a",
    "android.credentials.INSTALL",
    "-t",
    "application/x-x509-ca-cert",
    "-d",
    "file:///sdcard/Download/sylion-internal-ca.crt"
  ], { timeout: 20_000 }).catch((error) => ({ stdout: "", stderr: String(error) }));
  const settingsIntent = await adb([
    "-s",
    serial,
    "shell",
    "am",
    "start",
    "-a",
    "android.settings.SECURITY_SETTINGS"
  ], { timeout: 20_000 }).catch((error) => ({ stdout: "", stderr: String(error) }));
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const screenshot = await screencap(serial, "pixel-ca-install-settings");
  return {
    pushedPath: "/sdcard/Download/sylion-internal-ca.crt",
    installIntentStdout: installIntent.stdout,
    installIntentStderr: installIntent.stderr,
    settingsIntentStdout: settingsIntent.stdout,
    settingsIntentStderr: settingsIntent.stderr,
    screenshot,
    requiresUserPresence: true,
    manualGrapheneOsSteps: [
      "Settings",
      "Security and privacy",
      "More security settings",
      "Encryption and credentials",
      "Install a certificate",
      "CA certificate",
      "Choose Downloads/sylion-internal-ca.crt",
      "Confirm screen lock and certificate name"
    ]
  };
}

async function collectNetworkEvidence(serial) {
  const props = {};
  for (const key of ["ro.product.model", "ro.product.device", "ro.build.version.release", "ro.build.version.security_patch", "ro.build.fingerprint"]) {
    props[key] = (await adb(["-s", serial, "shell", "getprop", key])).stdout;
  }
  const connectivity = (await adb(["-s", serial, "shell", "dumpsys", "connectivity"], { timeout: 20_000 })).stdout;
  const route = (await adb(["-s", serial, "shell", "ip", "route"])).stdout;
  const tun = (await adb(["-s", serial, "shell", "ip", "addr", "show", "tun1"]).catch((error) => ({ stdout: "", stderr: String(error) }))).stdout;
  const pings = {};
  for (const host of ["admin.sylion.internal", "operator.sylion.internal", "signal.sylion.internal", "duckduckgo.sylion.internal", "libreoffice.sylion.internal", "zangi.sylion.internal", "10.42.0.10", "10.42.0.12"]) {
    const ping = await adb(["-s", serial, "shell", "ping", "-c", "1", "-W", "3", host]).catch((error) => ({ stdout: "", stderr: String(error) }));
    pings[host] = {
      ok: /1 received|bytes from/i.test(ping.stdout),
      output: ping.stdout.split(/\r?\n/).slice(0, 5).join("\n")
    };
  }
  return {
    props,
    route,
    tun,
    vpnConnected: /VPN CONNECTED|IS_VPN/.test(connectivity),
    vpnSession: connectivity.match(/sessionId=([^ ]+)/)?.[1] || null,
    vpnInterface: /InterfaceName: tun1/.test(connectivity) ? "tun1" : null,
    vpnAddress: connectivity.match(/LinkAddresses: \[ ([^\]]+)/)?.[1] || null,
    dnsThroughTunnel: connectivity.includes("DnsAddresses: [ /10.42.0.11 ]"),
    pings
  };
}

async function probeWorkloadsFromAdmin() {
  const script = String.raw`
for h in admin operator signal duckduckgo libreoffice zangi whatsapp telegram threema exodus; do
  path="/"
  if [ "$h" = "operator" ]; then path="/operator"; fi
  if [ "$h" = "admin" ]; then path="/admin"; fi
  code=$(curl -k -sS -o /tmp/sylion-probe-body -w "%{http_code}" --resolve "$h.sylion.internal:443:10.42.0.12" --max-time 8 "https://$h.sylion.internal$path" || true)
  title=$(tr '\n' ' ' </tmp/sylion-probe-body | sed -E 's/<[^>]+>/ /g' | tr -s ' ' | cut -c1-140)
  echo "$h|$code|$title"
done`;
  const result = await ssh(script, { timeout: 60_000 });
  return Object.fromEntries(result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [host, status, title] = line.split("|");
    return [host, { status, title }];
  }));
}

function analyze(seed, network, probes, pageResults) {
  const issues = [];
  if (!network.vpnConnected) issues.push("Pixel VPN is not reported as connected by Android connectivity service.");
  if (network.vpnInterface !== "tun1") issues.push("Pixel VPN interface tun1 was not found.");
  if (!network.dnsThroughTunnel) issues.push("Pixel DNS through tunnel did not expose 10.42.0.11 in connectivity evidence.");
  for (const [host, result] of Object.entries(network.pings)) {
    if (!result.ok) issues.push(`Pixel cannot reach ${host} over current network path.`);
  }
  for (const app of workloadHosts) {
    const status = probes[app]?.status;
    if (status !== "200") issues.push(`${app}.sylion.internal returned HTTP ${status || "unknown"} from server-side probe.`);
  }
  for (const app of ["duckduckgo", "libreoffice", "zangi", "whatsapp", "telegram", "threema", "exodus"]) {
    if (probes[app]?.status === "200" && /Welcome to nginx/i.test(probes[app]?.title || "")) {
      issues.push(`${app} currently serves the nginx placeholder, not a verified real application UI.`);
    }
  }
  const vpnInstall = seed.endpoints["/operator-api/vpn-install-package"]?.package;
  if (vpnInstall?.installState !== "ready") {
    issues.push(`Operator VPN install package is ${vpnInstall?.installState}; production install remains gated.`);
  }
  if (!/Operator Portal|Apps|Operator controls/i.test(probes.operator?.title || "")) {
    issues.push("operator.sylion.internal/operator probe does not resolve to the operator portal shell.");
  }
  const caPackage = seed.endpoints["/operator-api/pixel-ca-provisioning"]?.package;
  if (!caPackage?.validation?.requiresUserPresence) {
    issues.push("Pixel CA package does not explicitly require user-present GrapheneOS install.");
  }
  for (const [name, result] of Object.entries(pageResults)) {
    const uiText = visibleUiText(result.uiText || "");
    if (/NET::ERR_CERT_AUTHORITY_INVALID|Your connection is not private|Privacy error|Połączenie nie jest prywatne|Błąd dotyczący prywatności/i.test(uiText)) {
      issues.push(`${name} still shows a certificate trust warning on Pixel.`);
    }
  }
  for (const app of workloadHosts) {
    const expectation = workloadVisualExpectations[app];
    if (!expectation) continue;
    const uiText = visibleUiText(pageResults[app]?.uiText || "");
    const hasExpectedText = expectation.pass.some((pattern) => pattern.test(uiText));
    const hasBlockerText = expectation.blocker.some((pattern) => pattern.test(uiText));
    if (expectation.allowCanvasEvidence && probes[app]?.status === "200" && !hasBlockerText) {
      continue;
    }
    if (!hasExpectedText || hasBlockerText) {
      issues.push(expectation.blockerMessage);
    }
  }
  return issues;
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  const pixel = await requirePixel();
  const seed = await seedLiveOperator();
  const networkBefore = await collectNetworkEvidence(pixel.serial);
  const certificate = await fetchInternalCertificate();
  const caDelivery = await deliverCaToPixel(pixel.serial, certificate.localPath);

  const pageResults = {};
  pageResults.admin = await openUrl(pixel.serial, `${adminInternalBaseUrl}/admin`, "pixel-admin-panel");
  pageResults.operator = await openUrl(
    pixel.serial,
    `${operatorInternalBaseUrl}/operator?op_token=${encodeURIComponent(seed.operatorSession.token)}#app-switcher`,
    "pixel-operator-app-switcher"
  );

  await resetBrowserSurface(pixel.serial);
  for (const app of workloadHosts) {
    pageResults[app] = await openUrl(pixel.serial, `https://${app}.sylion.internal/`, `pixel-workload-${app}`, 8000);
  }

  const probes = await probeWorkloadsFromAdmin();
  const networkAfter = await collectNetworkEvidence(pixel.serial);
  const issues = analyze(seed, networkAfter, probes, pageResults);
  const summary = {
    status: issues.length ? "failed_with_findings" : "passed",
    adbSerial: pixel.serial,
    adminPanelUrl: `${adminInternalBaseUrl}/admin`,
    operatorPanelUrl: `${operatorInternalBaseUrl}/operator#app-switcher`,
    operatorId: seed.operatorId,
    tenantId: seed.tenantId,
    pixelDeviceId: seed.pixelDeviceId,
    caDelivery,
    certificate: {
      localPath: certificate.localPath,
      inspect: certificate.inspect
    },
    networkBefore,
    networkAfter,
    probes,
    screenshots: Object.fromEntries(Object.entries(pageResults).map(([key, value]) => [key, value.screenshot])),
    issues,
    checkedAt: new Date().toISOString()
  };
  await writeFile(join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (issues.length) {
    process.exitCode = 1;
  }
}

await run();
