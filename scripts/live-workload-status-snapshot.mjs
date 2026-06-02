import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";

const cfg = {
  sshKey: process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey,
  workloadHost: process.env.SYLION_WORKLOAD_SSH || "root@65.109.123.72",
  g2Host: process.env.SYLION_G2_SSH || "sylion@178.105.203.31",
  gatewayIp: process.env.SYLION_WORKLOAD_GATEWAY_IP || "10.42.0.12",
  timeoutMs: Number(process.env.SYLION_LIVE_WORKLOAD_STATUS_TIMEOUT_MS || 45_000)
};

const apps = Object.freeze([
  { key: "duckduckgo_browser", evidenceKey: "duckduckgo", name: "DuckDuckGo", host: "duckduckgo.sylion.internal", runtime: "firecracker_gui", class: "browser" },
  { key: "libreoffice", evidenceKey: "libreoffice", name: "LibreOffice", host: "libreoffice.sylion.internal", runtime: "firecracker_gui", class: "office" },
  { key: "whatsapp", evidenceKey: "whatsapp", name: "WhatsApp", host: "whatsapp.sylion.internal", runtime: "firecracker_web_or_android_native", class: "communicator" },
  { key: "telegram", evidenceKey: "telegram", name: "Telegram", host: "telegram.sylion.internal", runtime: "firecracker_web_or_android_native", class: "communicator" },
  { key: "threema", evidenceKey: "threema", name: "Threema", host: "threema.sylion.internal", runtime: "firecracker_web_or_android_native", class: "communicator" },
  { key: "signal", evidenceKey: "signal", name: "Signal", host: "signal.sylion.internal", runtime: "firecracker_desktop", class: "communicator" },
  { key: "zangi", evidenceKey: "zangi", name: "Zangi", host: "zangi.sylion.internal", runtime: "android_native_required", class: "communicator", androidNativeRequired: true },
  { key: "simplex", evidenceKey: "simplex", name: "SimpleX Chat", host: "simplex.sylion.internal", runtime: "desktop_or_android_native_required", class: "communicator", desktopOrAndroidImageRequired: true },
  { key: "protonmail", evidenceKey: "protonmail", name: "Proton Mail", host: "protonmail.sylion.internal", runtime: "firecracker_webmail", class: "mail", accountLoginRequired: true },
  { key: "exodus", evidenceKey: "exodus", name: "Exodus", host: "exodus.sylion.internal", runtime: "dedicated_wallet_runtime", class: "wallet", pixelFitReviewRequired: true }
]);

function sshArgs(host, command) {
  return [
    "-i", cfg.sshKey,
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=8",
    host,
    command
  ];
}

async function sshJson(host, command) {
  const { stdout } = await execFileAsync("ssh", sshArgs(host, command), {
    timeout: cfg.timeoutMs,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`json_not_found:${host}`);
  return JSON.parse(stdout.slice(start, end + 1));
}

async function workloadEvidence() {
  const appRows = apps.map((app) => `${app.key}|${app.evidenceKey}|${app.androidNativeRequired ? "true" : "false"}`).join("\n");
  const script = `
python3 - <<'PY'
import glob
import json
import os
import socket

apps = """${appRows}""".strip().splitlines()

def read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None

def rfb_ready(guest_ip):
    if not guest_ip:
        return False
    try:
        with socket.create_connection((guest_ip, 5900), 3) as sock:
            banner = sock.recv(12).decode("ascii", "ignore").strip()
            return banner.startswith("RFB")
    except Exception:
        return False

records = []
for row in apps:
    key, evidence_key, android_required = row.split("|")
    evidence_path = f"/opt/sylion-workloads/evidence/native-firecracker-gui-{evidence_key}.json"
    raw = read_json(evidence_path)
    if not raw:
        records.append({
            "key": key,
            "evidenceKey": evidence_key,
            "evidencePresent": False,
            "ready": False,
            "blockers": ["workload_evidence_file_missing"]
        })
        continue
    blockers = raw.get("blockers") if isinstance(raw.get("blockers"), list) else []
    guest_ip = raw.get("guestIp") or ""
    records.append({
        "key": key,
        "evidenceKey": evidence_key,
        "evidencePresent": True,
        "checkedAt": raw.get("checkedAt"),
        "hostPort": raw.get("hostPort"),
        "guestIpPresent": bool(guest_ip),
        "streamReady": raw.get("streamReady") is True,
        "streamAuthRequired": raw.get("streamAuthRequired") is True,
        "hostHttpCode": str(raw.get("hostHttpCode") or ""),
        "appRunning": raw.get("appRunning") is True,
        "appCrashed": raw.get("appCrashed") is True,
        "visibleWindow": raw.get("visibleWindow") is True,
        "noVncMarker": raw.get("noVncMarker") is True,
        "vncBannerReady": (raw.get("vncBannerReady") is True) or rfb_ready(guest_ip),
        "targetContentRequired": raw.get("targetContentRequired") is True,
        "targetContentVerified": raw.get("targetContentVerified") is True,
        "ready": raw.get("ready") is True,
        "blockers": blockers
    })

print(json.dumps({
    "source": "ax102_workload_evidence",
    "records": records,
    "evidenceCount": len(glob.glob("/opt/sylion-workloads/evidence/native-firecracker-gui-*.json"))
}, separators=(",", ":")))
PY
`;
  return sshJson(cfg.workloadHost, script);
}

async function g2Routes() {
  const appRows = apps.map((app) => `${app.key}|${app.host}`).join("\n");
  const script = `
set -uo pipefail
python3 - <<'PY'
import json
rows = """${appRows}""".strip().splitlines()
print(json.dumps({"rows": rows}))
PY
while IFS='|' read -r app_key host; do
  headers="/tmp/sylion-live-status-$app_key.headers"
  body="/tmp/sylion-live-status-$app_key.body"
  target="/vnc.html?autoconnect=true&resize=remote&path=websockify"
  code="$(curl -k -sS -D "$headers" -o "$body" -w "%{http_code}" --resolve "$host:443:${cfg.gatewayIp}" --max-time 10 "https://$host$target" 2>/dev/null || true)"
  root_code="$(curl -k -sS -o /dev/null -w "%{http_code}" --resolve "$host:443:${cfg.gatewayIp}" --max-time 8 "https://$host/" 2>/dev/null || true)"
  grep -qi 'www-authenticate' "$headers" && auth_required=true || auth_required=false
  grep -qi 'noVNC\\|KasmVNC' "$body" && stream_marker=true || stream_marker=false
  grep -qi 'X-Sylion' "$headers" && sylion_headers=true || sylion_headers=false
  printf '%s|%s|%s|%s|%s|%s\\n' "$app_key" "$root_code" "$code" "$auth_required" "$stream_marker" "$sylion_headers"
done <<'SYLION_STATUS_APPS' | python3 -c 'import json,sys
records=[]
for line in sys.stdin:
    parts=line.rstrip("\\n").split("|")
    if len(parts) != 6:
        continue
    key, root, code, auth, marker, headers = parts
    try:
        status=int(code)
    except Exception:
        status=0
    try:
        root_status=int(root)
    except Exception:
        root_status=0
    records.append({
        "key": key,
        "rootHttpStatus": root_status,
        "targetHttpStatus": status,
        "authRequired": auth == "true",
        "streamMarker": marker == "true",
        "sylionHeadersObserved": headers == "true",
        "routeReachable": status in (200, 301, 302, 401) or root_status in (200, 301, 302, 401)
    })
print(json.dumps({"source":"g2_workload_gateway","records":records}, separators=(",", ":")))'
${appRows}
SYLION_STATUS_APPS
`;
  const { stdout } = await execFileAsync("ssh", sshArgs(cfg.g2Host, script), {
    timeout: cfg.timeoutMs,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  const objects = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.includes('"source":"g2_workload_gateway"'));
  if (!objects.length) throw new Error("g2_route_json_not_found");
  return JSON.parse(objects.at(-1));
}

function appState(app, workload, route) {
  const transportReady = route?.routeReachable === true;
  const workloadReady = workload?.ready === true
    && workload.appRunning === true
    && workload.appCrashed !== true
    && workload.visibleWindow === true
    && workload.vncBannerReady === true
    && (workload.targetContentRequired !== true || workload.targetContentVerified === true);
  const blockers = [
    ...(transportReady ? [] : ["g2_route_not_reachable"]),
    ...(workload?.evidencePresent ? [] : ["workload_evidence_missing"]),
    ...(workloadReady ? [] : ["workload_ui_not_factually_ready"]),
    ...(workload?.blockers || [])
  ];
  let functionalState = "blocked";
  let operatorAction = "repair_route_or_workload";
  if (transportReady && workloadReady) {
    if (app.androidNativeRequired) {
      functionalState = "blocked_android_native_provenance";
      operatorAction = "approve_android_image_and_zangi_apk_then_run_android_native_test";
      blockers.push("approved_android_image_or_zangi_apk_missing");
    } else if (app.desktopOrAndroidImageRequired) {
      functionalState = "ui_ready_account_test_required";
      operatorAction = "approve_simplex_desktop_or_android_image_then_run_send_receive_human_test";
      blockers.push("simplex_account_send_receive_not_proven");
    } else if (app.accountLoginRequired) {
      functionalState = "ui_ready_account_test_required";
      operatorAction = "operator_logs_into_mailbox_inside_workload_then_records_metadata_only_evidence";
      blockers.push("protonmail_login_and_mailbox_visibility_not_proven");
    } else if (app.class === "communicator") {
      functionalState = "ui_ready_account_test_required";
      operatorAction = "bootstrap_account_then_run_send_receive_human_test";
      blockers.push("communicator_account_send_receive_not_proven");
    } else if (app.pixelFitReviewRequired) {
      functionalState = "ui_ready_pixel_fit_review_required";
      operatorAction = "review_pixel_fit_and_wallet_risk_before_production_use";
      blockers.push("pixel_fit_or_wallet_risk_not_fully_verified");
    } else {
      functionalState = "ui_ready";
      operatorAction = "ready_for_operator_use_with_cdr_controls";
    }
  } else if (app.androidNativeRequired && transportReady) {
    functionalState = "blocked_android_native_provenance";
    operatorAction = "approve_android_image_and_zangi_apk_then_run_android_native_test";
    blockers.push("approved_android_image_or_zangi_apk_missing");
  }
  return {
    key: app.key,
    evidenceKey: app.evidenceKey,
    name: app.name,
    host: app.host,
    launchUrl: `https://${app.host}/vnc.html?autoconnect=true&resize=remote&path=websockify`,
    runtime: app.runtime,
    class: app.class,
    transport: {
      state: transportReady ? (route?.authRequired ? "reachable_auth_required" : "reachable") : "blocked",
      rootHttpStatus: route?.rootHttpStatus ?? null,
      targetHttpStatus: route?.targetHttpStatus ?? null,
      authRequired: route?.authRequired === true,
      sylionHeadersObserved: route?.sylionHeadersObserved === true
    },
    workload: {
      state: workloadReady ? "ready" : "blocked",
      evidencePresent: workload?.evidencePresent === true,
      checkedAt: workload?.checkedAt || null,
      streamReady: workload?.streamReady === true,
      streamAuthRequired: workload?.streamAuthRequired === true,
      appRunning: workload?.appRunning === true,
      appCrashed: workload?.appCrashed === true,
      visibleWindow: workload?.visibleWindow === true,
      vncBannerReady: workload?.vncBannerReady === true,
      targetContentRequired: workload?.targetContentRequired === true,
      targetContentVerified: workload?.targetContentVerified === true
    },
    functionalState,
    operatorAction,
    blockers: [...new Set(blockers)].filter(Boolean),
    cdrRequired: true,
    terminalDataStored: false,
    secretsPrinted: false,
    productionExecutionAllowed: false
  };
}

export async function collectLiveWorkloadStatus() {
  const generatedAt = new Date().toISOString();
  const [workload, routes] = await Promise.all([workloadEvidence(), g2Routes()]);
  const workloadByKey = new Map(workload.records.map((record) => [record.key, record]));
  const routeByKey = new Map(routes.records.map((record) => [record.key, record]));
  const appStatuses = apps.map((app) => appState(app, workloadByKey.get(app.key), routeByKey.get(app.key)));
  return {
    generatedAt,
    source: "real_g2_and_ax102_metadata_probe",
    workloadHost: "AX102",
    g2Gateway: "G2",
    apps: appStatuses,
    summary: {
      totalApps: appStatuses.length,
      transportReady: appStatuses.filter((app) => app.transport.state !== "blocked").length,
      workloadUiReady: appStatuses.filter((app) => app.workload.state === "ready").length,
      functionalReady: appStatuses.filter((app) => app.functionalState === "ui_ready").length,
      accountTestRequired: appStatuses.filter((app) => app.functionalState === "ui_ready_account_test_required").map((app) => app.key),
      blocked: appStatuses.filter((app) => app.functionalState.startsWith("blocked")).map((app) => app.key),
      pixelFitReviewRequired: appStatuses.filter((app) => app.functionalState === "ui_ready_pixel_fit_review_required").map((app) => app.key),
      productionExecutionAllowed: false
    },
    safety: {
      contentInspected: false,
      messageContentStored: false,
      walletDataStored: false,
      terminalDataStored: false,
      cdrRequired: true,
      secretsPrinted: false
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  collectLiveWorkloadStatus()
    .then((snapshot) => {
      console.log(JSON.stringify(snapshot, null, 2));
    })
    .catch((error) => {
      console.log(JSON.stringify({
        generatedAt: new Date().toISOString(),
        source: "real_g2_and_ax102_metadata_probe",
        state: "status_probe_failed",
        error: error.message,
        apps: [],
        summary: {
          totalApps: 0,
          transportReady: 0,
          workloadUiReady: 0,
          functionalReady: 0,
          accountTestRequired: [],
          blocked: apps.map((app) => app.key),
          productionExecutionAllowed: false
        },
        safety: {
          contentInspected: false,
          messageContentStored: false,
          walletDataStored: false,
          terminalDataStored: false,
          cdrRequired: true,
          secretsPrinted: false
        }
      }, null, 2));
      process.exitCode = 1;
    });
}
