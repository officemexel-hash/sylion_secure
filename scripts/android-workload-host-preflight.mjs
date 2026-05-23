#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const host = arg("host", process.env.SYLION_WORKLOAD_SSH_HOST);
const user = arg("user", process.env.SYLION_WORKLOAD_SSH_USER || "sylion");
const key = arg("key", process.env.SYLION_WORKLOAD_SSH_KEY);

if (!host || !key || !existsSync(key)) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "missing_ssh_target",
    requires: ["--host or SYLION_WORKLOAD_SSH_HOST", "--key or SYLION_WORKLOAD_SSH_KEY"]
  }, null, 2));
  process.exit(2);
}

const remote = String.raw`
set -eu
printf 'kernel=%s\n' "$(uname -r)"
printf 'arch=%s\n' "$(uname -m)"
printf 'virtualization=%s\n' "$(systemd-detect-virt 2>/dev/null || true)"
printf 'kvm_device=%s\n' "$([ -e /dev/kvm ] && echo true || echo false)"
printf 'binder_device=%s\n' "$([ -e /dev/binder ] && echo true || echo false)"
printf 'binderfs_mount=%s\n' "$(findmnt -t binder 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
printf 'ashmem_device=%s\n' "$([ -e /dev/ashmem ] && echo true || echo false)"
printf 'kvm_modules=%s\n' "$(lsmod 2>/dev/null | awk '/^kvm/{print $1}' | paste -sd, -)"
printf 'binder_modules=%s\n' "$(lsmod 2>/dev/null | awk '/binder|ashmem/{print $1}' | paste -sd, -)"
`;

const result = spawnSync("ssh", [
  "-i", key,
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=accept-new",
  `${user}@${host}`,
  remote
], { encoding: "utf8" });

if (result.error || result.status !== 0) {
  console.error(JSON.stringify({
    status: "blocked",
    reason: "ssh_preflight_failed",
    stderr: result.stderr || String(result.error)
  }, null, 2));
  process.exit(1);
}

const facts = Object.fromEntries(result.stdout.trim().split(/\r?\n/).map((line) => {
  const [keyName, ...rest] = line.split("=");
  return [keyName, rest.join("=")];
}));
const checks = [
  { key: "kvm_device", passed: facts.kvm_device === "true", detail: "/dev/kvm exposed to workload host" },
  { key: "binder_or_binderfs", passed: facts.binder_device === "true" || Number(facts.binderfs_mount || 0) > 0, detail: "binder/binderfs exposed to Android runtime" },
  { key: "not_unqualified_nested_cloud_vps", passed: facts.virtualization === "none" || facts.kvm_device === "true", detail: "host is bare metal or nested KVM is exposed" }
];
const blockers = checks.filter((check) => !check.passed).map((check) => check.key);

console.log(JSON.stringify({
  status: blockers.length ? "blocked" : "ready_for_android_runtime_review",
  host,
  user,
  facts,
  checks,
  blockers,
  verdict: blockers.length
    ? "This host cannot run production Android-native Zangi workloads yet."
    : "This host can proceed to Android image and Zangi APK provenance gates."
}, null, 2));
