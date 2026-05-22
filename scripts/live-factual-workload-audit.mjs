import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const sshKey = process.env.SYLION_ADMIN_SSH_KEY || ".deploy\\sylion_hetzner_admin_ed25519";
const workloadHost = process.env.SYLION_WORKLOAD_SSH || "root@65.109.123.72";
const g2Host = process.env.SYLION_G2_SSH || "sylion@178.105.203.31";
const adbPath = process.env.SYLION_ADB_PATH || "C:\\Users\\razor\\Android\\platform-tools\\adb.exe";
const gatewayIp = process.env.SYLION_WORKLOAD_GATEWAY_IP || "10.42.0.12";
const outputDir = join(process.cwd(), "docs", "admin-panel-v2", "test-artifacts", "step3-62-factual-state-audit");
const args = new Set(process.argv.slice(2));
const argValue = (prefix) => process.argv.slice(2).find((arg) => arg.startsWith(`${prefix}=`))?.slice(prefix.length + 1);
const recordApi = args.has("--record-api");
const adminApiBaseUrl = argValue("--admin-api") || process.env.SYLION_ADMIN_API_BASE_URL || "http://127.0.0.1:8080";
const adminApiToken = process.env.SYLION_ADMIN_API_TOKEN || "";
const operatorId = argValue("--operator-id") || process.env.SYLION_OPERATOR_ID || "";

const apps = [
  {
    key: "duckduckgo",
    host: "duckduckgo.sylion.internal",
    port: 3001,
    expectedRuntime: "firecracker_gui",
    pass: [/DuckDuckGo/i],
    blockers: [/New Tab|Google|Firefox Directory|Index of|vnc\.html/i]
  },
  {
    key: "libreoffice",
    host: "libreoffice.sylion.internal",
    port: 3002,
    expectedRuntime: "firecracker_gui",
    pass: [/LibreOffice|Writer|Calc|Impress/i],
    blockers: [/New Tab|Google|Firefox Directory|Index of|vnc\.html/i]
  },
  {
    key: "whatsapp",
    host: "whatsapp.sylion.internal",
    port: 3010,
    expectedRuntime: "firecracker_web_or_android_native",
    pass: [/WhatsApp|Use WhatsApp on your computer|link a device/i],
    blockers: [/New Tab|Google|Firefox Directory|Index of|vnc\.html/i]
  },
  {
    key: "telegram",
    host: "telegram.sylion.internal",
    port: 3011,
    expectedRuntime: "firecracker_web_or_android_native",
    pass: [/Telegram|Log in to Telegram|Telegram Web/i],
    blockers: [/New Tab|Google|Firefox Directory|Index of|vnc\.html/i]
  },
  {
    key: "threema",
    host: "threema.sylion.internal",
    port: 3012,
    expectedRuntime: "firecracker_web_or_android_native",
    pass: [/Threema|Threema Web/i],
    blockers: [/New Tab|Google|Firefox Directory|Index of|vnc\.html/i]
  },
  {
    key: "signal",
    host: "signal.sylion.internal",
    port: 3013,
    expectedRuntime: "firecracker_desktop_or_container_fallback",
    pass: [/Signal|Link your phone|Scan.*QR/i],
    blockers: [/requires a username and password|Username|Password|401|Index of|vnc\.html/i]
  },
  {
    key: "zangi",
    host: "zangi.sylion.internal",
    port: 3014,
    expectedRuntime: "android_native_required",
    pass: [/Zangi/i],
    blockers: [/Download Zangi|zangi\.com\/.*download|New Tab|Google|Index of|vnc\.html/i]
  },
  {
    key: "exodus",
    host: "exodus.sylion.internal",
    port: 3015,
    expectedRuntime: "dedicated_wallet_runtime_required",
    pass: [/Exodus/i],
    blockers: [/Download Exodus|exodus\.com\/download|New Tab|Google|Index of|vnc\.html/i]
  }
];

function shellSingle(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout ?? 60_000,
    windowsHide: true,
    input: options.input
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function ssh(host, script, options = {}) {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  const remote = `printf %s ${shellSingle(encoded)} | base64 -d | bash`;
  return run("ssh", [
    "-i",
    sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    host,
    remote
  ], options);
}

async function adb(args, options = {}) {
  return run(adbPath, args, options);
}

function parseDeviceList(output) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
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

function evaluateText(app, text) {
  const normalized = text
    .replace(new RegExp(app.host.replace(/\./g, "\\."), "ig"), "")
    .replace(new RegExp(app.key, "ig"), "")
    .replace(/Wyszukaj w\s*DuckDuckGo lub wpisz adres URL|Customize and control Vanadium|Połączenie jest bezpieczne|Nowa karta|Zobacz \d+\s*karty|Otwórz stronę główną|Widok sieci/ig, "");
  const browserChromeOnly = normalized.trim().length < 16
    || (text.includes(app.host) && /Nowa karta|Customize and control Vanadium|Wyszukaj/i.test(text));
  const blocker = app.blockers.find((pattern) => pattern.test(normalized));
  const pass = app.pass.some((pattern) => pattern.test(normalized));
  return {
    factualStateVerified: pass && !blocker && !browserChromeOnly,
    passMarkerFound: pass,
    blockerMarker: blocker ? String(blocker) : browserChromeOnly ? "browser_chrome_only" : null
  };
}

function canonicalAppKey(key) {
  return key === "duckduckgo" ? "duckduckgo_browser" : key;
}

function envName(key, suffix) {
  return `SYLION_${key.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${suffix}`;
}

function boolEnv(name) {
  return process.env[name] === "true";
}

function factualCheck(passed, evidence, note = "Not proven in this factual run") {
  return passed ? { status: "passed", evidence } : { status: "blocked", note };
}

function factualRecordForApp(appResult) {
  const key = canonicalAppKey(appResult.key);
  const prefix = appResult.key === "duckduckgo" ? "DUCKDUCKGO" : key.toUpperCase();
  const uiVisible = appResult.pixelPassMarkerFound === true && !appResult.pixelBlockerMarker;
  const accountBootstrap = boolEnv(envName(prefix, "ACCOUNT_BOOTSTRAP_VERIFIED"));
  const sendReceive = boolEnv(envName(prefix, "SEND_RECEIVE_VERIFIED"));
  const browsing = boolEnv(envName(prefix, "BROWSING_VERIFIED"));
  const documentWorkflow = boolEnv(envName(prefix, "DOCUMENT_WORKFLOW_VERIFIED"));
  const walletWorkflow = boolEnv(envName(prefix, "WALLET_WORKFLOW_VERIFIED"));
  const riskAcceptance = boolEnv(envName(prefix, "RISK_ACCEPTANCE_VERIFIED"));
  const communicator = ["whatsapp", "signal", "telegram", "threema", "zangi", "matrix_client"].includes(key);
  const passed = communicator
    ? uiVisible && accountBootstrap && sendReceive
    : key === "duckduckgo_browser"
      ? uiVisible && browsing
      : key === "libreoffice"
        ? uiVisible && documentWorkflow
        : key === "exodus"
          ? uiVisible && walletWorkflow && riskAcceptance
          : appResult.ready === true;
  return {
    operatorId,
    appKey: key,
    terminalMode: "pixel_grapheneos",
    runtimeMode: appResult.expectedRuntime.includes("android_native") ? "android_native"
      : appResult.expectedRuntime.includes("firecracker_gui") ? "firecracker_gui"
        : appResult.expectedRuntime.includes("desktop") ? "desktop"
          : appResult.expectedRuntime.includes("web") ? "web" : "unknown",
    result: passed ? "passed" : "blocked",
    checks: {
      uiVisible: factualCheck(uiVisible, "Expected UI marker visible on Pixel screenshot", appResult.pixelBlockerMarker || "UI marker not visible"),
      accountBootstrap: factualCheck(accountBootstrap, "Account bootstrap/linking verified by human", "Account bootstrap/linking not verified"),
      sendReceive: factualCheck(sendReceive, "Send/receive verified by human", "Send/receive not verified"),
      browsing: factualCheck(browsing, "Browsing through workload verified by human", "Browsing workflow not verified"),
      documentWorkflow: factualCheck(documentWorkflow, "LibreOffice document workflow verified by human", "Document workflow not verified"),
      walletWorkflow: factualCheck(walletWorkflow, "Test-only Exodus wallet workflow verified by human", "Wallet workflow not verified"),
      riskAcceptance: factualCheck(riskAcceptance, "Operator risk acceptance recorded", "Risk acceptance not recorded")
    },
    evidenceArtifactIds: [
      ...(appResult.screenshot ? [`artifact://pixel/${appResult.key}/screenshot`] : []),
      ...(appResult.uiDump ? [`artifact://pixel/${appResult.key}/ui-dump`] : [])
    ],
    note: appResult.ready
      ? "Transport and UI marker observed; functional PASS still depends on required workflow checks."
      : `Blocked by ${appResult.blockers.join(", ")}`
  };
}

async function postAdminApi(path, body) {
  const response = await fetch(`${adminApiBaseUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": `corr_factual_audit_${Date.now()}`,
      authorization: `Bearer ${adminApiToken}`
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Admin API ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function recordFactualResults(appResults) {
  if (!recordApi) return [];
  if (!adminApiToken) throw new Error("SYLION_ADMIN_API_TOKEN is required with --record-api");
  if (!operatorId) throw new Error("SYLION_OPERATOR_ID or --operator-id is required with --record-api");
  const records = [];
  for (const appResult of appResults) {
    const body = factualRecordForApp(appResult);
    try {
      const result = await postAdminApi("/release/workload-factual-tests", body);
      records.push({ appKey: body.appKey, status: "recorded", testId: result.test?.id, result: result.test?.result });
    } catch (error) {
      records.push({
        appKey: body.appKey,
        status: "record_failed",
        error: error.message,
        details: error.payload?.error?.details || null
      });
    }
  }
  return records;
}

async function workloadRuntimeAudit() {
  const ports = apps.map((app) => app.port).join("|");
  const script = `
set -euo pipefail
printf 'DOCKER\\n'
docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' || true
printf 'LISTENERS\\n'
ss -ltnp | grep -E '10\\.44\\.0\\.13:(${ports})|:(${ports})' || true
printf 'EVIDENCE\\n'
find /opt/sylion-workloads/evidence -maxdepth 1 -name 'native-firecracker-gui-*.json' -print -exec cat {} \\; 2>/dev/null || true
`;
  const { stdout } = await ssh(workloadHost, script, { timeout: 120_000 });
  return stdout;
}

async function g2RouteProbe() {
  const script = `
set -uo pipefail
for h in ${apps.map((app) => shellSingle(app.key)).join(" ")}; do
  host="$h.sylion.internal"
  body="/tmp/sylion-factual-$h.body"
  headers="/tmp/sylion-factual-$h.headers"
  code=$(curl -k -sS -D "$headers" -o "$body" -w "%{http_code}" --resolve "$host:443:${gatewayIp}" --max-time 15 "https://$host/" || true)
  title=$(tr '\\n' ' ' < "$body" | grep -Eo '<title>[^<]+' | head -n 1 | sed 's/<title>//' | cut -c1-120 || true)
  safety=$(tr '\\r\\n' ' ' < "$headers" | grep -Eo 'X-Sylion-[^:]+: [^ ]+' | tr '\\n' ';' || true)
  printf '%s|%s|%s|%s\\n' "$h" "$code" "$title" "$safety"
done
`;
  const { stdout } = await ssh(g2Host, script, { timeout: 120_000 });
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [key, code, title, safety] = line.split("|");
    return { key, code: Number(code), title, safety };
  });
}

async function pixelAudit() {
  let devices;
  try {
    devices = parseDeviceList((await adb(["devices", "-l"], { timeout: 15_000 })).stdout);
  } catch (error) {
    return { available: false, reason: `adb_failed:${error.message}` };
  }
  const pixel = devices.find((device) => device.state === "device");
  if (!pixel) return { available: false, reason: "no_authorized_pixel" };

  const results = [];
  for (const app of apps) {
    try {
      const screenshotName = `pixel-${app.key}.png`;
      const xmlName = `pixel-${app.key}.xml`;
      const remotePng = `/sdcard/Download/${screenshotName}`;
      const remoteXml = `/sdcard/Download/${xmlName}`;
      const localPng = join(outputDir, screenshotName);
      const localXml = join(outputDir, xmlName);
      await adb(["-s", pixel.serial, "shell", "am", "force-stop", "app.vanadium.browser"], { timeout: 10_000 }).catch(() => {});
      await adb([
        "-s", pixel.serial,
        "shell", "am", "start",
        "-a", "android.intent.action.VIEW",
        "-d", `https://${app.host}/`
      ], { timeout: 10_000 });
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await adb(["-s", pixel.serial, "shell", "screencap", "-p", remotePng], { timeout: 10_000 });
      await adb(["-s", pixel.serial, "pull", remotePng, localPng], { timeout: 10_000 });
      let uiText = "";
      try {
        await adb(["-s", pixel.serial, "shell", "uiautomator", "dump", remoteXml], { timeout: 10_000 });
        await adb(["-s", pixel.serial, "pull", remoteXml, localXml], { timeout: 10_000 });
        const raw = await readFile(localXml, "utf8");
        uiText = visibleUiText(raw).replace(/op_token=op_[A-Za-z0-9]+/g, "op_token=REDACTED_OPERATOR_TOKEN");
        await writeFile(localXml, raw.replace(/op_token=op_[A-Za-z0-9]+/g, "op_token=REDACTED_OPERATOR_TOKEN"), "utf8");
      } catch {
        uiText = "";
      }
      const verdict = evaluateText(app, uiText);
      results.push({
        key: app.key,
        host: app.host,
        screenshot: localPng,
        uiDump: localXml,
        visibleTextSample: uiText.slice(0, 600),
        ...verdict
      });
    } catch (error) {
      results.push({
        key: app.key,
        host: app.host,
        screenshot: null,
        uiDump: null,
        visibleTextSample: "",
        factualStateVerified: false,
        passMarkerFound: false,
        blockerMarker: `pixel_probe_failed:${error.message}`
      });
    }
  }
  return { available: true, serial: pixel.serial, results };
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const runtime = await workloadRuntimeAudit().catch((error) => `runtime_audit_failed:${error.message}`);
  const routes = await g2RouteProbe().catch((error) => {
    return apps.map((app) => ({ key: app.key, code: 0, title: `g2_probe_failed:${error.message}`, safety: "" }));
  });
  const pixel = args.has("--pixel")
    ? await pixelAudit()
    : { available: false, reason: "pixel_probe_not_requested" };
  const routeByKey = Object.fromEntries(routes.map((route) => [route.key, route]));
  const pixelByKey = pixel.available
    ? Object.fromEntries(pixel.results.map((result) => [result.key, result]))
    : {};
  const appResults = apps.map((app) => {
    const route = routeByKey[app.key] || null;
    const pixelResult = pixelByKey[app.key] || null;
    const transportReady = route?.code === 200;
    const factualStateVerified = pixelResult?.factualStateVerified === true;
    return {
      key: app.key,
      host: app.host,
      port: app.port,
      expectedRuntime: app.expectedRuntime,
      transportReady,
      g2HttpStatus: route?.code ?? null,
      g2Title: route?.title || null,
      pixelFactualStateVerified: factualStateVerified,
      pixelPassMarkerFound: pixelResult?.passMarkerFound ?? false,
      pixelBlockerMarker: pixelResult?.blockerMarker ?? null,
      screenshot: pixelResult?.screenshot || null,
      ready: transportReady && factualStateVerified,
      blockers: [
        ...(transportReady ? [] : ["g2_route_not_ready"]),
        ...(factualStateVerified ? [] : ["factual_state_not_verified"])
      ],
      invariants: {
        cdrRequired: true,
        terminalDataStored: false,
        privateRouteRequired: true,
        productionExecutionAllowed: false
      }
    };
  });
  const summary = {
    component: "live_factual_workload_audit",
    checkedAt: new Date().toISOString(),
    workloadHost,
    g2Host,
    pixelAvailable: pixel.available,
    readyApps: appResults.filter((app) => app.ready).map((app) => app.key),
    blockedApps: appResults.filter((app) => !app.ready).map((app) => app.key),
    runtimeRaw: runtime,
    routes,
    pixel,
    apps: appResults,
    apiRecords: await recordFactualResults(appResults)
  };
  const summaryPath = join(outputDir, "summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify({
    summaryPath,
    pixelAvailable: summary.pixelAvailable,
    readyApps: summary.readyApps,
    blockedApps: summary.blockedApps
  }, null, 2));
  if (summary.blockedApps.length) process.exitCode = 1;
}

await main();
