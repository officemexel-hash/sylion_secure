#!/usr/bin/env node
import { spawn } from "node:child_process";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const defaultSshKey =
  process.platform === "win32"
    ? ".deploy\\sylion_hetzner_admin_ed25519"
    : ".deploy/sylion_hetzner_admin_ed25519";
const sshKey = arg(
  "key",
  process.env.SYLION_ADMIN_SSH_KEY || process.env.SYLION_WORKLOAD_SSH_KEY || defaultSshKey
);
const host = arg("host", process.env.SYLION_WORKLOAD_SSH_HOST);
const user = arg("user", process.env.SYLION_WORKLOAD_SSH_USER || "root");
const target = arg("target", process.env.SYLION_WORKLOAD_SSH || (host ? `${user}@${host}` : null));
const apply = process.argv.includes("--apply");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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
  if (!target) {
    throw new Error("Missing --host/--target or SYLION_WORKLOAD_SSH_HOST/SYLION_WORKLOAD_SSH");
  }
  return run(
    "ssh",
    [
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
    ],
    { ...options, input: script }
  );
}

const installScript = String.raw`
set -euo pipefail
modprobe binder_linux devices=binder,hwbinder,vndbinder
mkdir -p /dev/binderfs
if ! mountpoint -q /dev/binderfs; then
  mount -t binder binder /dev/binderfs
fi
cat > /etc/modules-load.d/sylion-android-binder.conf <<'EOF'
binder_linux
EOF
cat > /etc/modprobe.d/sylion-android-binder.conf <<'EOF'
options binder_linux devices=binder,hwbinder,vndbinder
EOF
cat > /etc/systemd/system/dev-binderfs.mount <<'EOF'
[Unit]
Description=SYLION Android binderfs mount
DefaultDependencies=no
After=systemd-modules-load.service
Before=local-fs.target
ConditionPathExists=/dev/binderfs

[Mount]
What=binder
Where=/dev/binderfs
Type=binder
Options=defaults

[Install]
WantedBy=local-fs.target
EOF
systemctl daemon-reload
systemctl enable dev-binderfs.mount >/dev/null
printf 'kernel=%s\n' "$(uname -r)"
printf 'arch=%s\n' "$(uname -m)"
printf 'kvm_device=%s\n' "$([ -e /dev/kvm ] && echo true || echo false)"
printf 'binderfs_supported=%s\n' "$(grep -qw binder /proc/filesystems && echo true || echo false)"
printf 'binderfs_mounts=%s\n' "$(findmnt -t binder 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
printf 'binder_nodes=%s\n' "$(find /dev/binderfs -maxdepth 1 -type c -printf '%f,' 2>/dev/null | sed 's/,$//')"
printf 'systemd_mount_enabled=%s\n' "$(systemctl is-enabled dev-binderfs.mount 2>/dev/null || true)"
`;

function parseFacts(stdout) {
  return Object.fromEntries(
    stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split("=");
        const value = rest.join("=");
        if (value === "true") return [key, true];
        if (value === "false") return [key, false];
        return [key, value];
      })
  );
}

async function main() {
  if (!target) {
    console.log(
      JSON.stringify(
        {
          component: "android_binderfs_host_gate_installer",
          status: "blocked",
          blockers: ["missing_ssh_target"],
          productionExecutionAllowed: false
        },
        null,
        2
      )
    );
    process.exitCode = 2;
    return;
  }
  if (!apply) {
    console.log(
      JSON.stringify(
        {
          component: "android_binderfs_host_gate_installer",
          status: "plan_only",
          targetHost: target,
          changes: [
            "load binder_linux with binder,hwbinder,vndbinder devices",
            "mount /dev/binderfs",
            "persist module and binderfs mount through systemd"
          ],
          requires: ["--apply"],
          terminalDataStored: false,
          productionExecutionAllowed: false
        },
        null,
        2
      )
    );
    return;
  }
  const { stdout } = await ssh(installScript, { timeout: 120_000 });
  const facts = parseFacts(stdout);
  const ready =
    facts.kvm_device === true &&
    facts.binderfs_supported === true &&
    Number(facts.binderfs_mounts || 0) > 0 &&
    String(facts.binder_nodes || "").includes("binder") &&
    facts.systemd_mount_enabled === "enabled";
  console.log(
    JSON.stringify(
      {
        component: "android_binderfs_host_gate_installer",
        status: ready ? "installed" : "blocked",
        targetHost: target,
        facts,
        blockers: ready ? [] : ["android_binderfs_gate_not_ready"],
        terminalDataStored: false,
        productionExecutionAllowed: false,
        checkedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
  if (!ready) process.exitCode = 1;
}

await main();
