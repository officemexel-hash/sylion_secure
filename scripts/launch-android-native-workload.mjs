#!/usr/bin/env node
import { spawn } from "node:child_process";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";
const sshKey = arg("key", process.env.SYLION_ADMIN_SSH_KEY || process.env.SYLION_WORKLOAD_SSH_KEY || defaultSshKey);
const host = arg("host", process.env.SYLION_WORKLOAD_SSH_HOST);
const user = arg("user", process.env.SYLION_WORKLOAD_SSH_USER || "root");
const target = arg("target", process.env.SYLION_WORKLOAD_SSH || (host ? `${user}@${host}` : null));
const app = arg("app", "zangi");
const packageName = arg("package", "com.beint.zangi");
const width = Number(arg("width", "412"));
const height = Number(arg("height", "915"));
const port = Number(arg("port", "5914"));
const apply = process.argv.includes("--apply");
const confirmation = arg("confirm", "");

if (!/^[a-z0-9_-]+$/i.test(app)) {
  throw new Error("--app must contain only letters, numbers, underscore or dash");
}
if (!/^[a-zA-Z0-9_.]+$/.test(packageName)) {
  throw new Error("--package must be an Android package identifier");
}
if (!Number.isInteger(width) || width < 320 || width > 3840) throw new Error("--width is outside allowed range");
if (!Number.isInteger(height) || height < 320 || height > 3840) throw new Error("--height is outside allowed range");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port is outside allowed range");

async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${options.timeout ?? 60_000}ms: ${command}`));
    }, options.timeout ?? 60_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        const error = new Error(`Command failed with code ${code ?? signal}: ${command}`);
        error.code = code;
        error.signal = signal;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
    child.stdin.end(options.input || "");
  });
}

async function ssh(script, timeout = 120_000) {
  if (!target) throw new Error("Missing target. Provide --target=user@host or --host=host");
  return run("ssh", [
    "-i",
    sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=10",
    "-o",
    "ServerAliveCountMax=2",
    "-o",
    "StrictHostKeyChecking=accept-new",
    target,
    "bash -s"
  ], { input: script, timeout });
}

function parseFacts(stdout) {
  const allowed = new Set([
    "waydroid",
    "waydroid_container",
    "weston",
    "vnc_listener",
    "public_drop_rule",
    "package_installed",
    "session",
    "container",
    "wayland_display"
  ]);
  return Object.fromEntries(stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [key, ...rest] = line.split("=");
    if (!allowed.has(key)) return [];
    const value = rest.join("=");
    if (value === "true") return [[key, true]];
    if (value === "false") return [[key, false]];
    return [[key, value]];
  }));
}

async function plan() {
  const { stdout } = await ssh(`
set -euo pipefail
printf 'waydroid=%s\\n' "$(command -v waydroid >/dev/null 2>&1 && echo true || echo false)"
printf 'weston=%s\\n' "$(command -v weston >/dev/null 2>&1 && echo true || echo false)"
printf 'waydroid_container=%s\\n' "$(systemctl is-active waydroid-container 2>/dev/null || true)"
printf 'package_installed=%s\\n' "$(waydroid app list 2>/dev/null | grep -q '^${packageName}[[:space:]]' && echo true || echo false)"
printf 'public_drop_rule=%s\\n' "$(nft list chain inet filter input 2>/dev/null | grep -q 'tcp dport ${port} drop' && echo true || echo false)"
printf 'vnc_listener=%s\\n' "$(ss -ltn 2>/dev/null | grep -q ':${port} ' && echo true || echo false)"
`);
  const facts = parseFacts(stdout);
  const blockers = [
    ...(facts.waydroid ? [] : ["waydroid_not_installed"]),
    ...(facts.weston ? [] : ["weston_not_installed"]),
    ...(facts.waydroid_container === "active" ? [] : ["waydroid_container_not_active"])
  ];
  return {
    mode: "plan_only",
    targetHost: target,
    app,
    packageName,
    stream: {
      protocol: "vnc_tls_private_g2_required",
      port,
      width,
      height,
      publicInterfaceDropRequired: true
    },
    facts,
    readyForApply: blockers.length === 0,
    blockers,
    terminalDataStored: false,
    cdrRequired: true,
    productionExecutionAllowed: false
  };
}

async function applyLaunch(planResult) {
  const envGate = process.env.SYLION_ANDROID_UI_LAUNCH_ALLOWED === "true";
  const confirmGate = confirmation === "LAUNCH_ANDROID_UI";
  if (!apply) return planResult;
  if (!envGate || !confirmGate || !planResult.readyForApply) {
    return {
      ...planResult,
      mode: "blocked_before_apply",
      applied: false,
      blockers: [
        ...planResult.blockers,
        ...(envGate ? [] : ["SYLION_ANDROID_UI_LAUNCH_ALLOWED_not_true"]),
        ...(confirmGate ? [] : ["confirmation_phrase_missing"])
      ]
    };
  }
  const { stdout } = await ssh(`
set -euo pipefail
nft list chain inet filter input >/dev/null 2>&1 || nft add table inet filter || true
nft list chain inet filter input >/dev/null 2>&1 || nft 'add chain inet filter input { type filter hook input priority filter; policy accept; }'
nft list chain inet filter input | grep -q 'tcp dport ${port} drop' || nft add rule inet filter input iifname "eno1" tcp dport ${port} drop
install -d -m 0700 /etc/sylion/waydroid-vnc
if [ ! -f /etc/sylion/waydroid-vnc/tls.key ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 30 \\
    -subj '/CN=${app}-android.sylion.internal' \\
    -keyout /etc/sylion/waydroid-vnc/tls.key \\
    -out /etc/sylion/waydroid-vnc/tls.crt >/dev/null 2>&1
  chmod 0600 /etc/sylion/waydroid-vnc/tls.key
  chmod 0644 /etc/sylion/waydroid-vnc/tls.crt
fi
waydroid session stop >/dev/null 2>&1 || true
pkill -f 'sylion-${app}-wayland|weston.*${port}' 2>/dev/null || true
install -d -m 0700 /run/sylion-waydroid-${app}
install -d -m 0700 /run/sylion-waydroid-${app}/pulse
: > /run/sylion-waydroid-${app}/pulse/native
export XDG_RUNTIME_DIR=/run/sylion-waydroid-${app}
export WAYLAND_DISPLAY=sylion-${app}-wayland
export XDG_SESSION_TYPE=wayland
nohup weston --backend=vnc-backend.so --socket="$WAYLAND_DISPLAY" --port=${port} --width=${width} --height=${height} \\
  --vnc-tls-cert=/etc/sylion/waydroid-vnc/tls.crt --vnc-tls-key=/etc/sylion/waydroid-vnc/tls.key \\
  --no-config --idle-time=0 --renderer=pixman --log=/var/log/sylion-${app}-weston-vnc.log >/var/log/sylion-${app}-weston-vnc.out 2>&1 &
sleep 4
nohup waydroid session start >/var/log/sylion-${app}-waydroid-session.log 2>&1 &
sleep 20
if waydroid app list 2>/dev/null | grep -q '^${packageName}[[:space:]]'; then
  nohup waydroid app launch ${packageName} >/var/log/sylion-${app}-waydroid-ui.log 2>&1 &
else
  nohup waydroid show-full-ui >/var/log/sylion-${app}-waydroid-ui.log 2>&1 &
fi
sleep 5
printf 'session=%s\\n' "$(waydroid status | awk -F: '/Session:/{gsub(/[[:space:]]/,"",$2); print $2}')"
printf 'container=%s\\n' "$(waydroid status | awk -F: '/Container:/{gsub(/[[:space:]]/,"",$2); print $2}')"
printf 'wayland_display=%s\\n' "$(waydroid status | awk -F: '/Wayland display:/{gsub(/^[[:space:]]+/,"",$2); print $2}')"
printf 'package_installed=%s\\n' "$(waydroid app list 2>/dev/null | grep -q '^${packageName}[[:space:]]' && echo true || echo false)"
printf 'vnc_listener=%s\\n' "$(ss -ltn 2>/dev/null | grep -q ':${port} ' && echo true || echo false)"
printf 'public_drop_rule=%s\\n' "$(nft list chain inet filter input 2>/dev/null | grep -q 'tcp dport ${port} drop' && echo true || echo false)"
`, 180_000);
  const facts = parseFacts(stdout);
  return {
    ...planResult,
    mode: "applied",
    applied: true,
    applyFacts: facts,
    streamReady: facts.session === "RUNNING" && facts.container === "RUNNING" && facts.vnc_listener === true,
    appLaunchMode: facts.package_installed === true ? "package_launch" : "android_full_ui_no_app_installed",
    productionExecutionAllowed: false
  };
}

const planResult = await plan();
const result = await applyLaunch(planResult);
console.log(JSON.stringify({
  component: "android_native_workload_launcher",
  ...result,
  checkedAt: new Date().toISOString()
}, null, 2));

if ((apply && result.applied !== true) || (!result.readyForApply && process.argv.includes("--require-ready"))) {
  process.exitCode = 1;
}
