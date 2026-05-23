import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";

const execFileAsync = promisify(execFile);

const sshKey = process.env.SYLION_ADMIN_SSH_KEY || ".deploy\\sylion_hetzner_admin_ed25519";
const workloadHost = process.env.SYLION_WORKLOAD_SSH || "root@65.109.123.72";
const g2Host = process.env.SYLION_G2_SSH || "sylion@178.105.203.31";
const adbPath = process.env.SYLION_ADB_PATH || "C:\\Users\\razor\\Android\\platform-tools\\adb.exe";
const gatewayIp = process.env.SYLION_WORKLOAD_GATEWAY_IP || "10.42.0.12";
const workloadBind = process.env.SYLION_WORKLOAD_BIND || "10.44.0.13";
const outputDir = join(process.cwd(), "docs", "admin-panel-v2", "test-artifacts", "step3-62-factual-state-audit");
const args = new Set(process.argv.slice(2));
const argValue = (prefix) => process.argv.slice(2).find((arg) => arg.startsWith(`${prefix}=`))?.slice(prefix.length + 1);
const recordApi = args.has("--record-api");
const adminApiBaseUrl = argValue("--admin-api") || process.env.SYLION_ADMIN_API_BASE_URL || "http://127.0.0.1:8080";
const adminApiToken = process.env.SYLION_ADMIN_API_TOKEN || "";
const operatorId = argValue("--operator-id") || process.env.SYLION_OPERATOR_ID || "";

const allApps = [
  {
    key: "duckduckgo",
    host: "duckduckgo.sylion.internal",
    port: 3001,
    expectedRuntime: "firecracker_gui",
    noVnc: true,
    pixelDelayMs: 12_000,
    pass: [/DuckDuckGo/i],
    blockers: [/New Tab|Google|Firefox Directory|Index of|vnc\.html/i]
  },
  {
    key: "libreoffice",
    host: "libreoffice.sylion.internal",
    port: 3002,
    expectedRuntime: "firecracker_gui",
    noVnc: true,
    pixelDelayMs: 12_000,
    pass: [/LibreOffice|Writer|Calc|Impress/i],
    blockers: [/New Tab|Google|Firefox Directory|Index of|vnc\.html/i]
  },
  {
    key: "whatsapp",
    host: "whatsapp.sylion.internal",
    port: 3010,
    expectedRuntime: "firecracker_web_or_android_native",
    noVnc: true,
    pixelDelayMs: 14_000,
    pass: [/WhatsApp|Use WhatsApp on your computer|link a device/i],
    blockers: [/New Tab|Google|Firefox Directory|Index of|vnc\.html/i]
  },
  {
    key: "telegram",
    host: "telegram.sylion.internal",
    port: 3011,
    expectedRuntime: "firecracker_web_or_android_native",
    noVnc: true,
    pixelDelayMs: 14_000,
    pass: [/Telegram|Log in to Telegram|Telegram Web/i],
    blockers: [/New Tab|Google|Firefox Directory|Index of|vnc\.html/i]
  },
  {
    key: "threema",
    host: "threema.sylion.internal",
    port: 3012,
    expectedRuntime: "firecracker_web_or_android_native",
    noVnc: true,
    pixelDelayMs: 14_000,
    pass: [/Threema|Threema Web/i],
    blockers: [/New Tab|Google|Firefox Directory|Index of|vnc\.html/i]
  },
  {
    key: "signal",
    host: "signal.sylion.internal",
    port: 3013,
    expectedRuntime: "firecracker_desktop_or_container_fallback",
    noVnc: true,
    pixelDelayMs: 20_000,
    pass: [/Signal|Link your phone|Scan.*QR/i],
    blockers: [/requires a username and password|Username|Password|401|Index of|vnc\.html/i]
  },
  {
    key: "zangi",
    host: "zangi.sylion.internal",
    port: 3014,
    expectedRuntime: "android_native_required",
    androidPackage: "com.beint.zangi",
    noVnc: true,
    pixelDelayMs: 16_000,
    pass: [/Zangi/i],
    blockers: [/Download Zangi|zangi\.com\/.*download|New Tab|Google|Index of/i]
  },
  {
    key: "exodus",
    host: "exodus.sylion.internal",
    port: 3015,
    expectedRuntime: "dedicated_wallet_runtime_required",
    noVnc: true,
    pixelDelayMs: 14_000,
    pass: [/Exodus/i],
    blockers: [/Download Exodus|exodus\.com\/download|New Tab|Google|Index of|vnc\.html/i]
  }
];

function parseRequestedApps(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function selectApps(availableApps, requestedValue) {
  const requested = parseRequestedApps(requestedValue);
  if (!requested.length) return availableApps;
  const byKey = new Map();
  for (const app of availableApps) {
    byKey.set(app.key, app);
    byKey.set(canonicalAppKey(app.key), app);
  }
  const selected = requested.map((key) => {
    const app = byKey.get(key);
    if (!app) {
      throw new Error(`unsupported_app:${key}`);
    }
    return app;
  });
  return [...new Map(selected.map((app) => [app.key, app])).values()];
}

const apps = selectApps(allApps, argValue("--apps") || process.env.SYLION_FACTUAL_APPS || "");

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

function parsePngStats(buffer) {
  if (buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    throw new Error("not_png");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  const channels = { 2: 3, 6: 4 }[colorType];
  if (!width || !height || bitDepth !== 8 || !channels) {
    throw new Error(`unsupported_png:${width}x${height}:bd${bitDepth}:ct${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset++];
    for (let x = 0; x < stride; x += 1) {
      let value = raw[rawOffset++];
      const left = x >= channels ? pixels[(y * stride) + x - channels] : 0;
      const up = y > 0 ? pixels[((y - 1) * stride) + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[((y - 1) * stride) + x - channels] : 0;
      if (filter === 1) value = (value + left) & 0xff;
      else if (filter === 2) value = (value + up) & 0xff;
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        value = (value + predictor) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`unsupported_png_filter:${filter}`);
      }
      pixels[(y * stride) + x] = value;
    }
  }

  let count = 0;
  let sum = 0;
  let sum2 = 0;
  let dark = 0;
  let white = 0;
  let redAlert = 0;
  const buckets = new Set();
  const y0 = Math.floor(height * 0.14);
  const y1 = Math.floor(height * 0.96);
  for (let y = y0; y < y1; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const index = (y * stride) + (x * channels);
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
      count += 1;
      sum += luma;
      sum2 += luma * luma;
      if (luma < 35) dark += 1;
      if (luma > 240) white += 1;
      if (r > 150 && g < 90 && b < 90) redAlert += 1;
      buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }
  }
  const meanLuma = count ? sum / count : 0;
  const lumaStdDev = count ? Math.sqrt(Math.max(0, (sum2 / count) - (meanLuma * meanLuma))) : 0;
  return {
    width,
    height,
    sampledPixels: count,
    meanLuma: Number(meanLuma.toFixed(2)),
    lumaStdDev: Number(lumaStdDev.toFixed(2)),
    colorBuckets: buckets.size,
    darkRatio: Number((count ? dark / count : 0).toFixed(4)),
    whiteRatio: Number((count ? white / count : 0).toFixed(4)),
    redAlertRatio: Number((count ? redAlert / count : 0).toFixed(4))
  };
}

export function pixelVisualVerdictFromStats(stats) {
  const blankLike = stats.whiteRatio > 0.96 && stats.lumaStdDev < 16 && stats.colorBuckets < 32;
  const loadingLike = stats.darkRatio > 0.9 && stats.lumaStdDev < 28;
  const websockifyFailureLike = (stats.redAlertRatio || 0) > 0.015;
  const rendered = !blankLike && !loadingLike && !websockifyFailureLike && stats.colorBuckets >= 80 && stats.lumaStdDev >= 24;
  return {
    rendered,
    blankLike,
    loadingLike,
    websockifyFailureLike,
    blocker: rendered ? null : blankLike
      ? "pixel_stream_blank_or_gateway_error"
      : loadingLike
        ? "pixel_stream_loading_or_disconnected"
        : websockifyFailureLike
          ? "pixel_stream_websockify_connection_failed"
          : "pixel_stream_visual_not_proven",
    stats
  };
}

async function analyzeScreenshot(path) {
  try {
    return pixelVisualVerdictFromStats(parsePngStats(await readFile(path)));
  } catch (error) {
    return {
      rendered: false,
      blankLike: false,
      loadingLike: false,
      blocker: `pixel_screenshot_analysis_failed:${error.message}`,
      stats: null
    };
  }
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
  const uiVisible = appResult.pixelUiVisible === true;
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
      uiVisible: factualCheck(uiVisible, "Expected UI visible on Pixel screenshot or UI dump", appResult.pixelBlockerMarker || "UI marker not visible"),
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
  const appRows = apps.map((app) => `${app.key}|${app.host}|${app.noVnc ? "true" : "false"}`).join("\n");
  const script = `
set -uo pipefail
while IFS='|' read -r h host no_vnc; do
  body="/tmp/sylion-factual-$h.body"
  headers="/tmp/sylion-factual-$h.headers"
  root_code=$(curl -k -sS -o /dev/null -w "%{http_code}" --resolve "$host:443:${gatewayIp}" --max-time 8 "https://$host/" || true)
  if [ "$no_vnc" = "true" ]; then
    target="/vnc.html?autoconnect=true&resize=scale&path=websockify"
  else
    target="/"
  fi
  code=$(curl -k -sS -D "$headers" -o "$body" -w "%{http_code}" --resolve "$host:443:${gatewayIp}" --max-time 15 "https://$host$target" || true)
  title=$(tr '\\n' ' ' < "$body" | grep -Eo '<title>[^<]+' | head -n 1 | sed 's/<title>//' | cut -c1-120 || true)
  grep -qi 'noVNC' "$body" && novnc=true || novnc=false
  ws_status="skipped"
  if [ "$no_vnc" = "true" ]; then
    ws_status="$(curl -k -sS -i --http1.1 --max-time 4 --resolve "$host:443:${gatewayIp}" -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==' -H 'Sec-WebSocket-Version: 13' "https://$host/websockify" 2>/dev/null | sed -n '1p' | tr -d '\\r' || true)"
  fi
  safety=$(tr '\\r\\n' ' ' < "$headers" | grep -Eo 'X-Sylion-[^:]+: [^ ]+' | tr '\\n' ';' || true)
  printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\\n' "$h" "$root_code" "$code" "$no_vnc" "$novnc" "$ws_status" "$title" "$safety" "$target"
done <<'SYLION_APPS'
${appRows}
SYLION_APPS
`;
  const { stdout } = await ssh(g2Host, script, { timeout: 120_000 });
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [key, rootCode, code, noVnc, noVncMarker, webSocketStatus, title, safety, targetPath] = line.split("|");
    const status = Number(code);
    const webSocketSwitching = /^HTTP\/[0-9.]+ 101\b/.test(webSocketStatus || "");
    const routeNoVnc = noVnc === "true";
    const transportReady = status === 200 && (!routeNoVnc || (noVncMarker === "true" && webSocketSwitching));
    return {
      key,
      rootCode: Number(rootCode),
      code: status,
      noVnc: routeNoVnc,
      noVncMarker: noVncMarker === "true",
      webSocketStatus,
      webSocketSwitching,
      transportReady,
      title,
      safety,
      targetPath
    };
  });
}

async function workloadGuiHealthProbe() {
  const appRows = apps.filter((app) => app.noVnc).map((app) => `${app.key}|${app.expectedRuntime}|${app.port}|${app.androidPackage || ""}`).join("\n");
  if (!appRows) return [];
  const script = `
set -uo pipefail
json_field() {
  file="$1"
  field="$2"
  default="$3"
  python3 - "$file" "$field" "$default" <<'PY'
import json
import sys

path, field, default = sys.argv[1:4]
try:
    with open(path, "r", encoding="utf-8") as handle:
        value = json.load(handle).get(field, default)
except Exception:
    value = default
if isinstance(value, bool):
    print("true" if value else "false")
elif value is None:
    print(default)
else:
    print(value)
PY
}
while IFS='|' read -r app_key expected_runtime app_port android_package; do
  if echo "$expected_runtime" | grep -q '^android_native'; then
    body="/tmp/sylion-android-native-$app_key.html"
    code="$(curl -sS -o "$body" -w "%{http_code}" --max-time 8 "http://${workloadBind}:$app_port/vnc.html" 2>/dev/null || true)"
    grep -qi 'noVNC' "$body" && marker=true || marker=false
    ss -ltn 2>/dev/null | grep -q '${workloadBind}:'"$app_port" && listener=true || listener=false
    if [ -n "$android_package" ]; then
      waydroid app list 2>/dev/null | grep -q "^$android_package[[:space:]]" && package_installed=true || package_installed=false
      if [ "$package_installed" = "true" ]; then
        waydroid shell pidof "$android_package" >/dev/null 2>&1 && app_running=true || app_running=false
      else
        app_running=false
      fi
    else
      package_installed=false
      app_running=false
    fi
    if [ "$code" = "200" ] && [ "$marker" = "true" ] && [ "$listener" = "true" ]; then
      printf '%s|true|true|android_native_websockify_noVNC|0|%s|%s|false|%s|false|false\\n' "$app_key" "$package_installed" "$app_running" "$app_running"
    else
      printf '%s|false|false|android_native_websockify_not_ready:http_%s_marker_%s_listener_%s|0|%s|%s|false|%s|false|false\\n' "$app_key" "$code" "$marker" "$listener" "$package_installed" "$app_running" "$app_running"
    fi
    continue
  fi
  evidence="/opt/sylion-workloads/evidence/native-firecracker-gui-$app_key.json"
  if [ ! -f "$evidence" ]; then
    printf '%s|missing|false|missing_evidence|0|na|false|true|false|false|false\\n' "$app_key"
    continue
  fi
  guest_ip="$(json_field "$evidence" guestIp "")"
  run_dir="$(json_field "$evidence" runDir "")"
  evidence_ready="$(json_field "$evidence" ready false)"
  app_running="$(json_field "$evidence" appRunning false)"
  app_crashed="$(json_field "$evidence" appCrashed true)"
  visible_window="$(json_field "$evidence" visibleWindow false)"
  target_required="$(json_field "$evidence" targetContentRequired false)"
  target_verified="$(json_field "$evidence" targetContentVerified false)"
  if [ -z "$guest_ip" ]; then
    printf '%s|%s|false|missing_guest_ip|0|na|%s|%s|%s|%s|%s\\n' "$app_key" "$evidence_ready" "$app_running" "$app_crashed" "$visible_window" "$target_required" "$target_verified"
    continue
  fi
  banner="$(GUEST_IP="$guest_ip" python3 - <<'PY'
import os
import socket

try:
    with socket.create_connection((os.environ["GUEST_IP"], 5900), 3) as sock:
        print(sock.recv(12).decode("ascii", "ignore").strip())
except Exception as exc:
    print("ERR:" + str(exc))
PY
)"
  case "$banner" in
    RFB*) banner_ready=true ;;
    *) banner_ready=false ;;
  esac
  cpu="0"
  if [ -n "$run_dir" ] && [ -f "$run_dir/firecracker.pid" ]; then
    cpu="$(ps -p "$(cat "$run_dir/firecracker.pid")" -o %cpu= 2>/dev/null | xargs || echo 0)"
  fi
  printf '%s|%s|%s|%s|%s|na|%s|%s|%s|%s|%s\\n' "$app_key" "$evidence_ready" "$banner_ready" "$banner" "$cpu" "$app_running" "$app_crashed" "$visible_window" "$target_required" "$target_verified"
done <<'SYLION_APPS'
${appRows}
SYLION_APPS
`;
  const { stdout } = await ssh(workloadHost, script, { timeout: 120_000 });
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [
      key,
      evidenceReady,
      bannerReady,
      banner,
      firecrackerCpu,
      packageInstalled,
      appRunning,
      appCrashed,
      visibleWindow,
      targetContentRequired,
      targetContentVerified
    ] = line.split("|");
    return {
      key,
      evidenceReady: evidenceReady === "true",
      vncBannerReady: bannerReady === "true",
      vncBanner: banner,
      firecrackerCpu: Number(firecrackerCpu) || 0,
      androidPackageInstalled: packageInstalled === "true" ? true : packageInstalled === "false" ? false : null,
      appRunning: appRunning === "true",
      appCrashed: appCrashed === "true",
      visibleWindow: visibleWindow === "true",
      targetContentRequired: targetContentRequired === "true",
      targetContentVerified: targetContentVerified === "true",
      workloadAppUiVisible: appRunning === "true"
        && appCrashed !== "true"
        && visibleWindow === "true"
        && (targetContentRequired !== "true" || targetContentVerified === "true")
    };
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
      const targetUrl = app.noVnc
        ? `https://${app.host}/vnc.html?autoconnect=true&resize=scale&path=websockify`
        : `https://${app.host}/`;
      await adb([
        "-s", pixel.serial,
        "shell", "am", "start",
        "-a", "android.intent.action.VIEW",
        "-d", targetUrl
      ], { timeout: 10_000 });
      await new Promise((resolve) => setTimeout(resolve, app.pixelDelayMs || 10_000));
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
      let visualEvidence = await analyzeScreenshot(localPng);
      if (app.noVnc && /(?:Połącz|Connect)/i.test(uiText)) {
        await adb(["-s", pixel.serial, "shell", "input", "tap", "490", "1295"], { timeout: 10_000 }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 15_000));
        await adb(["-s", pixel.serial, "shell", "screencap", "-p", remotePng], { timeout: 10_000 });
        await adb(["-s", pixel.serial, "pull", remotePng, localPng], { timeout: 10_000 });
        visualEvidence = await analyzeScreenshot(localPng);
      }
      const pixelStreamRendered = visualEvidence.rendered === true;
      const appUiMarkerVisible = verdict.factualStateVerified === true;
      results.push({
        key: app.key,
        host: app.host,
        targetUrl,
        screenshot: localPng,
        uiDump: localXml,
        visibleTextSample: uiText.slice(0, 600),
        textEvidence: verdict,
        pixelVisualEvidence: visualEvidence,
        pixelStreamRendered,
        appUiMarkerVisible,
        factualStateVerified: appUiMarkerVisible,
        passMarkerFound: verdict.passMarkerFound,
        blockerMarker: appUiMarkerVisible ? null : verdict.blockerMarker || visualEvidence.blocker
      });
    } catch (error) {
      results.push({
        key: app.key,
        host: app.host,
        targetUrl: app.noVnc
          ? `https://${app.host}/vnc.html?autoconnect=true&resize=scale&path=websockify`
          : `https://${app.host}/`,
        screenshot: null,
        uiDump: null,
        visibleTextSample: "",
        textEvidence: null,
        pixelVisualEvidence: null,
        factualStateVerified: false,
        passMarkerFound: false,
        blockerMarker: `pixel_probe_failed:${error.message}`
      });
    }
  }
  return { available: true, serial: pixel.serial, results };
}

async function main() {
  if (args.has("--list-apps")) {
    console.log(JSON.stringify({
      supportedApps: allApps.map((app) => app.key),
      selectedApps: apps.map((app) => app.key)
    }, null, 2));
    return;
  }
  await mkdir(outputDir, { recursive: true });
  const runtime = await workloadRuntimeAudit().catch((error) => `runtime_audit_failed:${error.message}`);
  const guiHealth = await workloadGuiHealthProbe().catch((error) => {
    return apps.filter((app) => app.noVnc).map((app) => ({
      key: app.key,
      evidenceReady: false,
      vncBannerReady: false,
      vncBanner: `gui_health_probe_failed:${error.message}`,
      firecrackerCpu: 0
    }));
  });
  const routes = await g2RouteProbe().catch((error) => {
    return apps.map((app) => ({ key: app.key, code: 0, title: `g2_probe_failed:${error.message}`, safety: "" }));
  });
  const pixel = args.has("--pixel")
    ? await pixelAudit()
    : { available: false, reason: "pixel_probe_not_requested" };
  const routeByKey = Object.fromEntries(routes.map((route) => [route.key, route]));
  const guiHealthByKey = Object.fromEntries(guiHealth.map((item) => [item.key, item]));
  const pixelByKey = pixel.available
    ? Object.fromEntries(pixel.results.map((result) => [result.key, result]))
    : {};
  const appResults = apps.map((app) => {
    const route = routeByKey[app.key] || null;
    const currentGuiHealth = guiHealthByKey[app.key] || null;
    const pixelResult = pixelByKey[app.key] || null;
    const routeReady = route?.transportReady === true;
    const workloadVncReady = app.noVnc ? currentGuiHealth?.vncBannerReady === true : true;
    const transportReady = routeReady && workloadVncReady;
    const androidNativeRequired = app.expectedRuntime.includes("android_native");
    const androidPackageInstalled = androidNativeRequired
      ? currentGuiHealth?.androidPackageInstalled === true
      : true;
    const pixelStreamRendered = pixelResult?.pixelStreamRendered === true || pixelResult?.pixelVisualEvidence?.rendered === true;
    const appUiMarkerVisible = pixelResult?.appUiMarkerVisible === true;
    const workloadAppUiVisible = currentGuiHealth?.workloadAppUiVisible === true;
    const pixelUiVisible = androidNativeRequired
      ? pixelStreamRendered && androidPackageInstalled && workloadAppUiVisible
      : pixelStreamRendered && (appUiMarkerVisible || workloadAppUiVisible);
    const key = canonicalAppKey(app.key);
    const prefix = app.key === "duckduckgo" ? "DUCKDUCKGO" : key.toUpperCase();
    const communicator = ["whatsapp", "signal", "telegram", "threema", "zangi", "matrix_client"].includes(key);
    const workflowVerified = communicator
      ? boolEnv(envName(prefix, "ACCOUNT_BOOTSTRAP_VERIFIED")) && boolEnv(envName(prefix, "SEND_RECEIVE_VERIFIED"))
      : key === "duckduckgo_browser"
        ? boolEnv(envName(prefix, "BROWSING_VERIFIED"))
        : key === "libreoffice"
          ? boolEnv(envName(prefix, "DOCUMENT_WORKFLOW_VERIFIED"))
          : key === "exodus"
            ? boolEnv(envName(prefix, "WALLET_WORKFLOW_VERIFIED")) && boolEnv(envName(prefix, "RISK_ACCEPTANCE_VERIFIED"))
            : pixelUiVisible;
    const functionalReady = transportReady && pixelUiVisible && androidPackageInstalled && workflowVerified;
    return {
      key: app.key,
      host: app.host,
      port: app.port,
      expectedRuntime: app.expectedRuntime,
      transportReady,
      routeTargetPath: route?.targetPath || null,
      g2RootHttpStatus: route?.rootCode ?? null,
      g2HttpStatus: route?.code ?? null,
      g2Title: route?.title || null,
      g2NoVncMarker: route?.noVncMarker ?? null,
      g2WebSocketSwitching: route?.webSocketSwitching ?? null,
      workloadGuiHealth: currentGuiHealth,
      androidPackageInstalled,
      pixelStreamRendered,
      appUiMarkerVisible,
      workloadAppUiVisible,
      pixelUiVisible,
      pixelFactualStateVerified: pixelUiVisible,
      workflowVerified,
      pixelPassMarkerFound: pixelResult?.passMarkerFound ?? false,
      pixelBlockerMarker: pixelResult?.blockerMarker ?? null,
      pixelVisualEvidence: pixelResult?.pixelVisualEvidence || null,
      screenshot: pixelResult?.screenshot || null,
      ready: transportReady && pixelUiVisible,
      functionalReady,
      blockers: [
        ...(routeReady ? [] : ["g2_route_not_ready"]),
        ...(workloadVncReady ? [] : ["workload_vnc_banner_not_ready"]),
        ...(androidPackageInstalled ? [] : ["android_app_package_not_installed"]),
        ...(pixelUiVisible ? [] : ["pixel_ui_not_visible"]),
        ...(workflowVerified ? [] : ["functional_workflow_not_verified"])
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
    transportReadyApps: appResults.filter((app) => app.transportReady).map((app) => app.key),
    pixelUiVisibleApps: appResults.filter((app) => app.ready).map((app) => app.key),
    functionalReadyApps: appResults.filter((app) => app.functionalReady).map((app) => app.key),
    readyApps: appResults.filter((app) => app.functionalReady).map((app) => app.key),
    blockedApps: appResults.filter((app) => !app.functionalReady).map((app) => app.key),
    runtimeRaw: runtime,
    guiHealth,
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
    transportReadyApps: summary.transportReadyApps,
    pixelUiVisibleApps: summary.pixelUiVisibleApps,
    functionalReadyApps: summary.functionalReadyApps,
    blockedApps: summary.blockedApps
  }, null, 2));
  if (summary.blockedApps.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
