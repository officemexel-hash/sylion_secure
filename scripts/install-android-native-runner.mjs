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
const apply = process.argv.includes("--apply");
const confirmation = arg("confirm", "");

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
  if (!target) {
    throw new Error("Missing target. Provide --target=user@host or --host=host");
  }
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
  const allowedKeys = new Set([
    "os",
    "version_codename",
    "kvm",
    "binderfs_mounts",
    "apt",
    "curl",
    "waydroid",
    "weston",
    "waydroid_container",
    "images_dir"
  ]);
  return Object.fromEntries(stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const normalized = line.startsWith("SYLION_FACT ") ? line.slice("SYLION_FACT ".length) : line;
    const [key, ...rest] = normalized.split("=");
    if (!allowedKeys.has(key)) return [];
    const value = rest.join("=");
    if (value === "true") return [[key, true]];
    if (value === "false") return [[key, false]];
    return [[key, value]];
  }));
}

async function plan() {
  const script = `
set -euo pipefail
printf 'os=%s\\n' "$(awk -F= '/^ID=/{gsub(/"/,"",$2); print $2}' /etc/os-release 2>/dev/null || echo unknown)"
printf 'version_codename=%s\\n' "$(awk -F= '/^VERSION_CODENAME=/{gsub(/"/,"",$2); print $2}' /etc/os-release 2>/dev/null || echo unknown)"
printf 'kvm=%s\\n' "$(test -e /dev/kvm && echo true || echo false)"
printf 'binderfs_mounts=%s\\n' "$(findmnt -t binder 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
printf 'apt=%s\\n' "$(command -v apt-get >/dev/null 2>&1 && echo true || echo false)"
printf 'curl=%s\\n' "$(command -v curl >/dev/null 2>&1 && echo true || echo false)"
printf 'waydroid=%s\\n' "$(command -v waydroid >/dev/null 2>&1 && echo true || echo false)"
printf 'weston=%s\\n' "$(command -v weston >/dev/null 2>&1 && echo true || echo false)"
printf 'waydroid_container=%s\\n' "$(systemctl is-active waydroid-container 2>/dev/null || true)"
`;
  const { stdout } = await ssh(script);
  const facts = parseFacts(stdout);
  const blockers = [
    ...(facts.kvm ? [] : ["missing_dev_kvm"]),
    ...(Number(facts.binderfs_mounts || 0) > 0 ? [] : ["missing_binderfs_mount"]),
    ...(facts.apt ? [] : ["missing_apt_get"]),
    ...(facts.os === "ubuntu" || facts.os === "debian" ? [] : ["unsupported_os_for_official_waydroid_repo_script"])
  ];
  return {
    mode: "plan_only",
    targetHost: target,
    facts,
    readyForApply: blockers.length === 0,
    blockers,
    plannedActions: [
      "install curl and ca-certificates if missing",
      "add official Waydroid repository script from https://repo.waydro.id",
      "install waydroid, weston, dbus-x11 and x11vnc packages",
      "initialize Waydroid VANILLA image if not initialized",
      "enable/start waydroid-container",
      "leave app APK install and account bootstrap to separate approved artifact gate"
    ],
    terminalDataStored: false,
    cdrRequired: true,
    productionExecutionAllowed: false
  };
}

async function applyInstall(planResult) {
  const envGate = process.env.SYLION_ANDROID_RUNNER_INSTALL_ALLOWED === "true";
  const confirmGate = confirmation === "INSTALL_ANDROID_NATIVE_RUNNER";
  if (!apply) return planResult;
  if (!envGate || !confirmGate || !planResult.readyForApply) {
    return {
      ...planResult,
      mode: "blocked_before_apply",
      applied: false,
      blockers: [
        ...planResult.blockers,
        ...(envGate ? [] : ["SYLION_ANDROID_RUNNER_INSTALL_ALLOWED_not_true"]),
        ...(confirmGate ? [] : ["confirmation_phrase_missing"])
      ]
    };
  }
  const script = `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates weston dbus-x11 x11vnc
if ! command -v waydroid >/dev/null 2>&1; then
  curl -fsSL https://repo.waydro.id | bash
  apt-get update
  apt-get install -y waydroid
fi
if [ ! -d /var/lib/waydroid/images ] && [ ! -f /var/lib/waydroid/waydroid_base.prop ]; then
  waydroid init -s VANILLA
fi
systemctl enable --now waydroid-container
printf 'waydroid=%s\\n' "$(waydroid --version 2>/dev/null | head -n1 || true)"
printf 'waydroid_container=%s\\n' "$(systemctl is-active waydroid-container 2>/dev/null || true)"
printf 'images_dir=%s\\n' "$([ -d /var/lib/waydroid/images ] && echo true || echo false)"
`;
  const { stdout } = await ssh(script, 1_800_000);
  const facts = parseFacts(stdout);
  return {
    ...planResult,
    mode: "applied",
    applied: true,
    applyFacts: facts,
    readyForApkInstall: facts.waydroid && facts.waydroid_container === "active",
    productionExecutionAllowed: false
  };
}

const planResult = await plan();
const result = await applyInstall(planResult);
console.log(JSON.stringify({
  component: "android_native_runner_installer",
  ...result,
  checkedAt: new Date().toISOString()
}, null, 2));

if ((apply && result.applied !== true) || (!result.readyForApply && process.argv.includes("--require-ready"))) {
  process.exitCode = 1;
}
