import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";
const sshKey = process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey;
const workloadHost = process.env.SYLION_WORKLOAD_SSH || "sylion@178.105.197.37";

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout ?? 60_000,
    windowsHide: true,
    input: options.input
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function ssh(script, options = {}) {
  return run("ssh", [
    "-i",
    sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    workloadHost,
    script
  ], options);
}

async function probe() {
  const script = `
set -euo pipefail
printf 'kvm=%s\\n' "$(test -e /dev/kvm && echo true || echo false)"
printf 'binderfs=%s\\n' "$(grep -qw binder /proc/filesystems && echo true || echo false)"
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
  const blockers = [
    ...(facts.kvm ? [] : ["workload_host_missing_dev_kvm"]),
    ...(facts.binderfs ? [] : ["workload_host_missing_binderfs"]),
    ...(facts.docker ? [] : ["docker_runtime_missing"]),
    ...(process.env.SYLION_ZANGI_APK_REF ? [] : ["approved_zangi_apk_ref_missing"]),
    ...(process.env.SYLION_ANDROID_WORKLOAD_IMAGE_REF ? [] : ["approved_android_workload_image_missing"])
  ];
  return {
    component: "android_native_workload_probe",
    targetHost: workloadHost,
    apps: ["zangi"],
    runtimeClass: "android_workload",
    facts,
    ready: blockers.length === 0,
    blockers,
    recommendation: blockers.length
      ? "Use a provider/flavor with nested virtualization or bare-metal KVM plus binderfs before launching native Android workloads."
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
