#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_ROUTER_IP = "192.168.8.1";
const DEFAULT_SSH_KEY =
  process.platform === "win32"
    ? ".deploy\\sylion_puli_ax_ed25519"
    : ".deploy/sylion_puli_ax_ed25519";
const DEFAULT_OUT =
  "docs/admin-panel-v2/test-artifacts/puli-ax-authenticated-inventory/latest.json";

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
    execFile(
      command,
      args,
      {
        windowsHide: true,
        timeout: options.timeout || 20_000,
        maxBuffer: options.maxBuffer || 1024 * 1024
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error?.code || 0,
          stdout: String(stdout || "").trim(),
          stderr: String(stderr || "").trim(),
          message: error?.message || null
        });
      }
    );
  });
}

async function ssh({ routerIp, user, keyPath, script, timeout = 20_000 }) {
  return execFileAsync(
    "ssh",
    [
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
    ],
    { timeout }
  );
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
  const startedAt = isoNow();
  const script = `
set -eu
echo hostname="$(cat /proc/sys/kernel/hostname 2>/dev/null || echo unknown)"
echo kernel="$(uname -r 2>/dev/null || echo unknown)"
echo arch="$(uname -m 2>/dev/null || echo unknown)"
echo mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
echo openwrt_release_present="$([ -f /etc/openwrt_release ] && echo true || echo false)"
if [ -f /etc/openwrt_release ]; then
  . /etc/openwrt_release
  echo distrib_id="$DISTRIB_ID"
  echo distrib_release="$DISTRIB_RELEASE"
  echo distrib_revision="$DISTRIB_REVISION"
  echo distrib_target="$DISTRIB_TARGET"
  echo distrib_description="$(printf '%s' "$DISTRIB_DESCRIPTION" | tr -cd '[:alnum:] ._:+/-')"
else
  echo distrib_id=unknown
  echo distrib_release=unknown
  echo distrib_revision=unknown
  echo distrib_target=unknown
  echo distrib_description=unknown
fi
echo rootfs_free_kb="$(df -k / 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)"
echo rootfs_used_pct="$(df -k / 2>/dev/null | awk 'NR==2 {print $5}' | tr -d '%' || echo 0)"
echo command_uci="$(command -v uci >/dev/null 2>&1 && echo true || echo false)"
echo command_nft="$(command -v nft >/dev/null 2>&1 && echo true || echo false)"
echo command_ipsec="$(command -v ipsec >/dev/null 2>&1 && echo true || echo false)"
echo command_swanctl="$(command -v swanctl >/dev/null 2>&1 && echo true || echo false)"
echo command_opkg="$(command -v opkg >/dev/null 2>&1 && echo true || echo false)"
echo package_strongswan="$(opkg list-installed 2>/dev/null | grep -E '^strongswan' >/dev/null 2>&1 && echo true || echo false)"
echo package_nftables="$(opkg list-installed 2>/dev/null | grep -E '^nftables' >/dev/null 2>&1 && echo true || echo false)"
echo package_dnsmasq="$(opkg list-installed 2>/dev/null | grep -E '^dnsmasq' >/dev/null 2>&1 && echo true || echo false)"
echo package_dnsmasq_full="$(opkg list-installed 2>/dev/null | grep -E '^dnsmasq-full' >/dev/null 2>&1 && echo true || echo false)"
echo dropbear_password_auth="$(uci -q get dropbear.@dropbear[0].PasswordAuth 2>/dev/null || echo unknown)"
echo dropbear_root_password_auth="$(uci -q get dropbear.@dropbear[0].RootPasswordAuth 2>/dev/null || echo unknown)"
echo dropbear_interface="$(uci -q get dropbear.@dropbear[0].Interface 2>/dev/null || echo unknown)"
echo wan_admin_http_open="$(ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ':(80|443)$' >/dev/null 2>&1 && echo true || echo false)"
echo sylion_killswitch_table="$(nft list table inet sylion_killswitch >/dev/null 2>&1 && echo true || echo false)"
echo ipsec_conf_present="$([ -f /etc/ipsec.conf ] && echo true || echo false)"
echo sylion_ipsec_conf_present="$(grep -q 'sylion-g1-router' /etc/ipsec.conf 2>/dev/null && echo true || echo false)"
echo sylion_router_cert_present="$([ -s /etc/sylion/ipsec/router-cert.pem ] && echo true || echo false)"
echo sylion_router_key_present="$([ -s /etc/sylion/ipsec/router-key.pem ] && echo true || echo false)"
echo sylion_g1_ca_present="$([ -s /etc/sylion/ipsec/g1-ca.pem ] && echo true || echo false)"
ipsec_status="$(ipsec status sylion-g1-router 2>/dev/null || true)"
echo sylion_router_tunnel_established="$(echo "$ipsec_status" | grep -q 'ESTABLISHED' && echo true || echo false)"
echo sylion_router_child_installed="$(echo "$ipsec_status" | grep -q 'INSTALLED' && echo true || echo false)"
router_vip="$(ip -4 addr show 2>/dev/null | awk '$2 ~ /^10[.]43[.]/ { split($2,a,"/"); print a[1]; exit }')"
[ -n "$router_vip" ] || router_vip="10.43.0.2"
echo sylion_router_virtual_ip="$router_vip"
echo sylion_lan_snat="$(iptables -t nat -C POSTROUTING -s 192.168.8.0/24 -d 10.42.0.0/16 -j SNAT --to-source "$router_vip" >/dev/null 2>&1 && echo true || echo false)"
echo sylion_tcp_mss_clamp="$(iptables -t mangle -C FORWARD -s 192.168.8.0/24 -d 10.42.0.0/16 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200 >/dev/null 2>&1 && echo true || echo false)"
echo sylion_old_nat_bypass="$(iptables -t nat -C POSTROUTING -d 10.42.0.0/16 -j ACCEPT >/dev/null 2>&1 && echo true || echo false)"
echo sylion_internal_dns_forward="$(uci show dhcp 2>/dev/null | grep -q '/sylion.internal/10.42.0.11' && echo true || echo false)"
required_dns_hosts="operator session admin duckduckgo libreoffice whatsapp telegram threema signal zangi exodus simplex protonmail"
missing_static=""
missing_resolves=""
for host in $required_dns_hosts; do
  uci show dhcp 2>/dev/null | grep -q "/$host.sylion.internal/10.42.0.12" || missing_static="$missing_static,$host"
  nslookup "$host.sylion.internal" 127.0.0.1 2>/dev/null | grep -q '10.42.0.12' || missing_resolves="$missing_resolves,$host"
done
echo sylion_internal_dns_required_hosts="$required_dns_hosts"
echo sylion_internal_dns_static="$([ -z "$missing_static" ] && echo true || echo false)"
echo sylion_internal_dns_resolves="$([ -z "$missing_resolves" ] && echo true || echo false)"
echo sylion_internal_dns_static_missing="\${missing_static#,}"
echo sylion_internal_dns_resolves_missing="\${missing_resolves#,}"
ping -c 1 -W 2 10.42.0.12 >/dev/null 2>&1 && echo g2_private_ping=true || echo g2_private_ping=false
echo sylion_dir_present="$([ -d /etc/sylion ] && echo true || echo false)"
echo authorized_keys_present="$([ -s /etc/dropbear/authorized_keys ] && echo true || echo false)"
echo br_lan_present="$(ip link show br-lan >/dev/null 2>&1 && echo true || echo false)"
echo wifi_config_present="$([ -f /etc/config/wireless ] && echo true || echo false)"
echo sim_metadata_redacted=true
echo imei_redacted=true
echo public_ip_redacted=true
`;
  const probe = await ssh({ routerIp, user, keyPath, script });
  if (!probe.ok) {
    const summary = {
      component: "puli_ax_authenticated_inventory",
      routerIp,
      startedAt,
      completedAt: isoNow(),
      status: "blocked_ssh_key_auth_required",
      facts: {
        sshKeyAuth: false
      },
      controls: {
        secretsStored: false,
        passwordPrinted: false,
        terminalOperationalDataStored: false,
        productionExecutionAllowed: false,
        sideEffectAllowed: false
      },
      blockers: ["router_ssh_key_auth_not_validated"],
      nextActions: [
        "Run scripts/puli-ax-install-ssh-key-interactive.ps1 in a visible terminal and type the router password there only.",
        "Rerun npm run test:puli-ax-authenticated-inventory."
      ]
    };
    if (outPath && !hasArg("no-write")) {
      const absolute = resolve(outPath);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (hasArg("require-pass")) process.exitCode = 1;
    return;
  }
  const kv = parseKeyValueLines(probe.stdout);
  const firmwareVersion = [kv.distrib_id, kv.distrib_release, kv.distrib_revision]
    .filter((value) => value && value !== "unknown")
    .join(" ");
  const openwrtModern = /^(23\.05|24\.|25\.)/.test(kv.distrib_release || "");
  const glOsAcceptedLab = /OpenWrt/i.test(kv.distrib_id || "") && !openwrtModern;
  const checks = {
    sshKeyAuth: true,
    authorizedKeysPresent: bool(kv.authorized_keys_present),
    uciPresent: bool(kv.command_uci),
    nftPresent: bool(kv.command_nft),
    ipsecPresent: bool(kv.command_ipsec) || bool(kv.command_swanctl),
    strongSwanInstalled:
      bool(kv.package_strongswan) || bool(kv.command_ipsec) || bool(kv.command_swanctl),
    nftablesInstalled: bool(kv.package_nftables) || bool(kv.command_nft),
    dnsmasqPresent: bool(kv.package_dnsmasq) || bool(kv.package_dnsmasq_full),
    sshKeyAuthOnly: kv.dropbear_password_auth === "off" && kv.dropbear_root_password_auth === "off",
    sylionKillSwitchLoaded: bool(kv.sylion_killswitch_table),
    sylionIpsecConfigPresent: bool(kv.sylion_ipsec_conf_present),
    sylionRouterCertPresent: bool(kv.sylion_router_cert_present),
    sylionRouterKeyPresent: bool(kv.sylion_router_key_present),
    sylionG1CaPresent: bool(kv.sylion_g1_ca_present),
    sylionRouterTunnelEstablished: bool(kv.sylion_router_tunnel_established),
    sylionRouterChildInstalled: bool(kv.sylion_router_child_installed),
    sylionLanSnat: bool(kv.sylion_lan_snat),
    sylionTcpMssClamp: bool(kv.sylion_tcp_mss_clamp),
    sylionOldNatBypass: bool(kv.sylion_old_nat_bypass),
    sylionInternalDnsForward: bool(kv.sylion_internal_dns_forward),
    sylionInternalDnsStatic: bool(kv.sylion_internal_dns_static),
    sylionInternalDnsResolves: bool(kv.sylion_internal_dns_resolves),
    sylionInternalDnsRequiredHosts: (kv.sylion_internal_dns_required_hosts || "")
      .split(/\s+/)
      .filter(Boolean),
    sylionInternalDnsStaticMissing: (kv.sylion_internal_dns_static_missing || "")
      .split(",")
      .filter(Boolean),
    sylionInternalDnsResolvesMissing: (kv.sylion_internal_dns_resolves_missing || "")
      .split(",")
      .filter(Boolean),
    g2PrivatePingFromRouterSelfTraffic: bool(kv.g2_private_ping),
    brLanPresent: bool(kv.br_lan_present),
    openwrtModern,
    glOsAcceptedLab
  };
  const blockers = [
    ...(checks.sshKeyAuth ? [] : ["ssh_key_auth_required"]),
    ...(checks.uciPresent ? [] : ["uci_required"]),
    ...(checks.nftPresent ? [] : ["nftables_required"]),
    ...(checks.strongSwanInstalled ? [] : ["strongswan_required"]),
    ...(checks.sshKeyAuthOnly ? [] : ["ssh_password_auth_still_enabled"]),
    ...(checks.sylionKillSwitchLoaded ? [] : ["sylion_killswitch_not_loaded"]),
    ...(checks.sylionIpsecConfigPresent ? [] : ["sylion_ipsec_config_missing"]),
    ...(checks.sylionRouterCertPresent ? [] : ["sylion_router_cert_missing"]),
    ...(checks.sylionRouterKeyPresent ? [] : ["sylion_router_key_missing"]),
    ...(checks.sylionG1CaPresent ? [] : ["sylion_g1_ca_missing"]),
    ...(checks.sylionRouterTunnelEstablished ? [] : ["sylion_router_ipsec_sa_not_established"]),
    ...(checks.sylionRouterChildInstalled ? [] : ["sylion_router_ipsec_child_not_installed"]),
    ...(checks.sylionLanSnat ? [] : ["sylion_lan_snat_missing"]),
    ...(checks.sylionTcpMssClamp ? [] : ["sylion_tcp_mss_clamp_missing"]),
    ...(checks.sylionInternalDnsForward ? [] : ["sylion_internal_dns_forward_missing"]),
    ...(checks.sylionInternalDnsStatic ? [] : ["sylion_internal_dns_static_missing"]),
    ...(checks.sylionInternalDnsResolves ? [] : ["sylion_internal_dns_resolution_failed"]),
    ...(checks.openwrtModern ? [] : ["openwrt_23_05_or_explicit_glos_lab_acceptance_required"])
  ];
  const summary = {
    component: "puli_ax_authenticated_inventory",
    routerIp,
    startedAt,
    completedAt: isoNow(),
    status: blockers.length ? "inventory_captured_with_blockers" : "inventory_passed",
    facts: {
      hostname: kv.hostname || "unknown",
      kernel: kv.kernel || "unknown",
      arch: kv.arch || "unknown",
      memKb: Number(kv.mem_kb || 0),
      rootfsFreeKb: Number(kv.rootfs_free_kb || 0),
      rootfsUsedPct: Number(kv.rootfs_used_pct || 0),
      firmwareVersion: firmwareVersion || "unknown",
      firmwareDescription: kv.distrib_description || "unknown",
      target: kv.distrib_target || "unknown",
      dropbear: {
        passwordAuth: kv.dropbear_password_auth || "unknown",
        rootPasswordAuth: kv.dropbear_root_password_auth || "unknown",
        interface: kv.dropbear_interface || "unknown"
      },
      checks
    },
    controls: {
      secretsStored: false,
      passwordPrinted: false,
      simMetadataRedacted: true,
      imeiRedacted: true,
      publicIpRedacted: true,
      terminalOperationalDataStored: false,
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    },
    blockers,
    nextActions: blockers.length
      ? [
          "Install or verify strongSwan/nftables package set.",
          "Apply SYLION kill-switch/IPsec/DNS package only after SSH key auth and package availability are confirmed.",
          "Disable SSH password auth only after key-only verification passes.",
          "Run T01-T10 and record sanitized evidence."
        ]
      : [
          "Run T01-T10 physical failure tests.",
          "Register validated router posture in the Admin API.",
          "Continue Pixel human regression through Puli AX."
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
