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
const workloadHost = arg("target", process.env.SYLION_WORKLOAD_SSH || (host ? `${user}@${host}` : "sylion@178.105.197.37"));
const zangiApkRef = arg("zangi-apk-ref", process.env.SYLION_ZANGI_APK_REF);
const androidImageRef = arg("android-image-ref", process.env.SYLION_ANDROID_WORKLOAD_IMAGE_REF);

function safeRef(value, field) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/password|secret|token|api[_-]?key|otp|sms|seed|mnemonic|private[_-]?key/i.test(text)) {
    throw new Error(`${field} must be an artifact/package/image reference, not secret-bearing material`);
  }
  return text;
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
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

async function ssh(script, options = {}) {
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
    workloadHost,
    "bash -s"
  ], { ...options, input: script });
}

async function probe() {
  const script = `
set -euo pipefail
printf 'kvm=%s\\n' "$(test -e /dev/kvm && echo true || echo false)"
printf 'binderfs_supported=%s\\n' "$(grep -qw binder /proc/filesystems && echo true || echo false)"
printf 'binderfs_mounts=%s\\n' "$(findmnt -t binder 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
printf 'binder_device=%s\\n' "$(test -e /dev/binder && echo true || echo false)"
printf 'ashmem=%s\\n' "$(test -e /dev/ashmem && echo true || echo false)"
printf 'kernel=%s\\n' "$(uname -r)"
printf 'arch=%s\\n' "$(uname -m)"
printf 'docker=%s\\n' "$(command -v docker >/dev/null 2>&1 && echo true || echo false)"
printf 'waydroid=%s\\n' "$(command -v waydroid >/dev/null 2>&1 && echo true || echo false)"
printf 'anbox=%s\\n' "$(command -v anbox >/dev/null 2>&1 && echo true || echo false)"
`;
  const { stdout } = await ssh(script);
  const facts = Object.fromEntries(stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [key, ...rest] = line.split("=");
    const value = rest.join("=");
    if (value === "true") return [key, true];
    if (value === "false") return [key, false];
    return [key, value];
  }));
  const binderReady = facts.binder_device || facts.binderfs_supported || Number(facts.binderfs_mounts || 0) > 0;
  const hostBlockers = [
    ...(facts.kvm ? [] : ["workload_host_missing_dev_kvm"]),
    ...(binderReady ? [] : ["workload_host_missing_binder_or_binderfs"])
  ];
  const approvedZangiApkRef = safeRef(zangiApkRef, "zangi-apk-ref");
  const approvedAndroidImageRef = safeRef(androidImageRef, "android-image-ref");
  const provenanceBlockers = [
    ...(approvedZangiApkRef ? [] : ["approved_zangi_apk_ref_missing"]),
    ...(approvedAndroidImageRef ? [] : ["approved_android_workload_image_missing"])
  ];
  const blockers = [...hostBlockers, ...provenanceBlockers];
  return {
    component: "android_native_workload_probe",
    targetHost: workloadHost,
    apps: ["zangi"],
    runtimeClass: "android_workload",
    facts,
    hostReady: hostBlockers.length === 0,
    provenanceReady: provenanceBlockers.length === 0,
    approvedRefs: {
      zangiApkRef: approvedZangiApkRef,
      androidImageRef: approvedAndroidImageRef
    },
    ready: blockers.length === 0,
    blockers,
    recommendation: blockers.length
      ? "Complete host kernel gates and approved Android image/APK provenance before launching native Android workloads."
      : "Host can proceed to Android workload runner installation review.",
    terminalDataStored: false,
    cdrRequired: true,
    productionExecutionAllowed: false,
    checkedAt: new Date().toISOString()
  };
}

async function main() {
  const result = await probe();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready && process.argv.includes("--require-ready")) {
    process.exitCode = 1;
  }
}

await main();
