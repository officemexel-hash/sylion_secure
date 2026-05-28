#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_ROUTER_IP = "192.168.8.1";
const DEFAULT_SSH_KEY = process.platform === "win32"
  ? ".deploy\\sylion_puli_ax_ed25519"
  : ".deploy/sylion_puli_ax_ed25519";
const DEFAULT_OUT = "docs/admin-panel-v2/test-artifacts/puli-ax-hardening-deps/latest.json";

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasArg(name) {
  return process.argv.includes(`--${name}`);
}

function isoNow() {
  return new Date().toISOString();
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, {
      windowsHide: true,
      timeout: options.timeout || 120_000,
      maxBuffer: options.maxBuffer || 2 * 1024 * 1024
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code || 0,
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim(),
        message: error?.message || null
      });
    });
  });
}

async function ssh({ routerIp, user, keyPath, script, timeout = 120_000 }) {
  return execFileAsync("ssh", [
    "-i",
    keyPath,
    "-o",
    "BatchMode=yes",
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "StrictHostKeyChecking=accept-new",
    `${user}@${routerIp}`,
    script
  ], { timeout });
}

function parseKeyValueLines(output) {
  const result = {};
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    result[key] = rest.join("=");
  }
  return result;
}

function bool(value) {
  return value === "true" || value === true;
}

async function main() {
  const routerIp = argValue("router-ip", DEFAULT_ROUTER_IP);
  const user = argValue("user", "root");
  const keyPath = argValue("ssh-key", process.env.SYLION_PULI_AX_SSH_KEY || DEFAULT_SSH_KEY);
  const outPath = argValue("out", DEFAULT_OUT);
  const apply = hasArg("apply") || process.env.SYLION_PULI_AX_APPLY === "true";
  const startedAt = isoNow();

  const script = `
set -eu
echo phase=preflight
echo key_auth=true
echo opkg_present="$(command -v opkg >/dev/null 2>&1 && echo true || echo false)"
echo uci_present="$(command -v uci >/dev/null 2>&1 && echo true || echo false)"
echo nft_before="$(command -v nft >/dev/null 2>&1 && echo true || echo false)"
echo ipsec_before="$(command -v ipsec >/dev/null 2>&1 && echo true || echo false)"
if [ "${apply ? "true" : "false"}" = "true" ]; then
  if ! command -v opkg >/dev/null 2>&1; then
    echo opkg_missing=true
    exit 20
  fi
  mkdir -p /etc/sylion /tmp/sylion-hardening
  echo backup_dir="/tmp/sylion-hardening/pre-deps-$(date +%Y%m%d-%H%M%S)"
  backup_dir="/tmp/sylion-hardening/pre-deps-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$backup_dir"
  cp /etc/config/dropbear "$backup_dir/dropbear" 2>/dev/null || true
  cp /etc/config/firewall "$backup_dir/firewall" 2>/dev/null || true
  opkg update >/tmp/sylion-hardening/opkg-update.log 2>&1 || true
  opkg install nftables kmod-nft-core kmod-nft-nat strongswan-full strongswan-mod-openssl ca-bundle >/tmp/sylion-hardening/opkg-install.log 2>&1 || true
  # Key-only SSH after key auth is proven.
  uci set dropbear.@dropbear[0].PasswordAuth='off' 2>/dev/null || true
  uci set dropbear.@dropbear[0].RootPasswordAuth='off' 2>/dev/null || true
  uci commit dropbear 2>/dev/null || true
  /etc/init.d/dropbear restart >/dev/null 2>&1 || true
fi
echo nft_after="$(command -v nft >/dev/null 2>&1 && echo true || echo false)"
echo ipsec_after="$(command -v ipsec >/dev/null 2>&1 && echo true || echo false)"
echo swanctl_after="$(command -v swanctl >/dev/null 2>&1 && echo true || echo false)"
echo package_strongswan="$(opkg list-installed 2>/dev/null | grep -E '^strongswan' >/dev/null 2>&1 && echo true || echo false)"
echo package_nftables="$(opkg list-installed 2>/dev/null | grep -E '^nftables' >/dev/null 2>&1 && echo true || echo false)"
echo password_auth="$(uci -q get dropbear.@dropbear[0].PasswordAuth 2>/dev/null || echo unknown)"
echo root_password_auth="$(uci -q get dropbear.@dropbear[0].RootPasswordAuth 2>/dev/null || echo unknown)"
echo lan_unchanged=true
echo killswitch_loaded=false
echo ipsec_started=false
echo secrets_printed=false
`;
  const result = await ssh({ routerIp, user, keyPath, script });
  const kv = parseKeyValueLines(result.stdout);
  const blockers = [
    ...(result.ok ? [] : ["ssh_key_auth_failed"]),
    ...(bool(kv.opkg_present) ? [] : ["opkg_required"]),
    ...(bool(kv.nft_after) || bool(kv.package_nftables) ? [] : ["nftables_not_installed"]),
    ...(bool(kv.ipsec_after) || bool(kv.swanctl_after) || bool(kv.package_strongswan) ? [] : ["strongswan_not_installed"]),
    ...(kv.password_auth === "off" && kv.root_password_auth === "off" ? [] : ["ssh_password_auth_still_enabled"])
  ];
  const summary = {
    component: "puli_ax_hardening_deps",
    routerIp,
    startedAt,
    completedAt: isoNow(),
    mode: apply ? "apply" : "dry_run",
    status: result.ok
      ? blockers.length ? "deps_checked_with_blockers" : "deps_ready"
      : "blocked",
    facts: {
      sshKeyAuth: result.ok,
      opkgPresent: bool(kv.opkg_present),
      uciPresent: bool(kv.uci_present),
      nftBefore: bool(kv.nft_before),
      ipsecBefore: bool(kv.ipsec_before),
      nftAfter: bool(kv.nft_after),
      ipsecAfter: bool(kv.ipsec_after),
      swanctlAfter: bool(kv.swanctl_after),
      packageStrongSwan: bool(kv.package_strongswan),
      packageNftables: bool(kv.package_nftables),
      passwordAuth: kv.password_auth || "unknown",
      rootPasswordAuth: kv.root_password_auth || "unknown",
      lanUnchanged: kv.lan_unchanged === "true",
      killSwitchLoaded: kv.killswitch_loaded === "true",
      ipsecStarted: kv.ipsec_started === "true"
    },
    controls: {
      secretsStored: false,
      passwordPrinted: false,
      commandLinePasswordUsed: false,
      terminalOperationalDataStored: false,
      productionExecutionAllowed: false,
      sideEffectAllowed: apply,
      lanConfigMutated: false,
      killSwitchLoaded: false,
      ipsecStarted: false
    },
    blockers,
    nextActions: blockers.length ? [
      "Inspect /tmp/sylion-hardening/opkg-update.log and opkg-install.log on the router through key-only SSH.",
      "Install missing package set or accept GL OS stock limitations as a lab-only gate.",
      "Do not load kill switch until IPsec profile and recovery path are validated."
    ] : [
      "Stage SYLION IPsec and kill-switch files without loading them.",
      "Run dry-run T01-T10 readiness checks.",
      "Only then load kill switch with an active router-to-G1 IPsec profile."
    ]
  };
  if (outPath && !hasArg("no-write")) {
    const absolute = resolve(outPath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (hasArg("require-pass") && blockers.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
