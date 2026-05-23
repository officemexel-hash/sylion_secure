#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { basename } from "node:path";

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
const apkLocalPath = arg("apk", null);
const expectedSha256 = arg("sha256", null);
const apply = process.argv.includes("--apply");
const confirmation = arg("confirm", "");

if (!/^[a-z0-9_-]+$/i.test(app)) {
  throw new Error("--app must contain only letters, numbers, underscore or dash");
}
if (!/^[a-zA-Z0-9_.]+$/.test(packageName)) {
  throw new Error("--package must be an Android package identifier");
}

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

async function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function parseFacts(stdout) {
  const allowed = new Set(["waydroid", "waydroid_container", "package_installed", "remote_sha256"]);
  return Object.fromEntries(stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [key, ...rest] = line.split("=");
    if (!allowed.has(key)) return [];
    const value = rest.join("=");
    if (value === "true") return [[key, true]];
    if (value === "false") return [[key, false]];
    return [[key, value]];
  }));
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

async function scp(local, remote) {
  return run("scp", [
    "-i",
    sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    local,
    `${target}:${remote}`
  ], { timeout: 300_000 });
}

async function plan() {
  const { stdout } = await ssh(`
set -euo pipefail
printf 'waydroid=%s\\n' "$(command -v waydroid >/dev/null 2>&1 && echo true || echo false)"
printf 'waydroid_container=%s\\n' "$(systemctl is-active waydroid-container 2>/dev/null || true)"
printf 'package_installed=%s\\n' "$(waydroid app list 2>/dev/null | grep -q '^${packageName}[[:space:]]' && echo true || echo false)"
`);
  const facts = parseFacts(stdout);
  const localApkReady = apkLocalPath && existsSync(apkLocalPath);
  const localShaReady = localApkReady && expectedSha256;
  const blockers = [
    ...(facts.waydroid ? [] : ["waydroid_not_installed"]),
    ...(facts.waydroid_container === "active" ? [] : ["waydroid_container_not_active"]),
    ...(localApkReady ? [] : ["approved_apk_file_missing"]),
    ...(localShaReady ? [] : ["approved_apk_sha256_missing"])
  ];
  let localSha256 = null;
  if (localApkReady) localSha256 = await sha256File(apkLocalPath);
  if (expectedSha256 && localSha256 && expectedSha256.toLowerCase() !== localSha256) {
    blockers.push("approved_apk_sha256_mismatch");
  }
  return {
    mode: "plan_only",
    targetHost: target,
    app,
    packageName,
    facts,
    approvedApk: localApkReady ? {
      fileName: basename(apkLocalPath),
      sha256: localSha256
    } : null,
    readyForApply: blockers.length === 0,
    blockers,
    terminalDataStored: false,
    cdrRequired: true,
    productionExecutionAllowed: false
  };
}

async function applyInstall(planResult) {
  const envGate = process.env.SYLION_ANDROID_APK_INSTALL_ALLOWED === "true";
  const confirmGate = confirmation === "INSTALL_ANDROID_APK";
  if (!apply) return planResult;
  if (!envGate || !confirmGate || !planResult.readyForApply) {
    return {
      ...planResult,
      mode: "blocked_before_apply",
      applied: false,
      blockers: [
        ...planResult.blockers,
        ...(envGate ? [] : ["SYLION_ANDROID_APK_INSTALL_ALLOWED_not_true"]),
        ...(confirmGate ? [] : ["confirmation_phrase_missing"])
      ]
    };
  }
  const remoteDir = "/opt/sylion/android-apks";
  const remotePath = `${remoteDir}/${app}-${planResult.approvedApk.sha256}.apk`;
  await ssh(`set -euo pipefail; install -d -m 0700 ${remoteDir}`);
  await scp(apkLocalPath, remotePath);
  const { stdout } = await ssh(`
set -euo pipefail
remote_sha="$(sha256sum ${remotePath} | awk '{print $1}')"
if [ "$remote_sha" != "${planResult.approvedApk.sha256}" ]; then
  printf 'remote_sha256=%s\\n' "$remote_sha"
  exit 42
fi
waydroid app install ${remotePath}
printf 'remote_sha256=%s\\n' "$remote_sha"
printf 'package_installed=%s\\n' "$(waydroid app list 2>/dev/null | grep -q '^${packageName}[[:space:]]' && echo true || echo false)"
`, 600_000);
  const facts = parseFacts(stdout);
  return {
    ...planResult,
    mode: "applied",
    applied: true,
    remotePath,
    applyFacts: facts,
    readyForLaunch: facts.package_installed === true,
    productionExecutionAllowed: false
  };
}

const planResult = await plan();
const result = await applyInstall(planResult);
console.log(JSON.stringify({
  component: "android_apk_workload_installer",
  ...result,
  checkedAt: new Date().toISOString()
}, null, 2));

if ((apply && result.applied !== true) || (!result.readyForApply && process.argv.includes("--require-ready"))) {
  process.exitCode = 1;
}
