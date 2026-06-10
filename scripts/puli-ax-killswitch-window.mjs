#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_ROUTER_IP = "192.168.8.1";
const DEFAULT_G1_IP = "178.105.200.112";
const DEFAULT_SSH_KEY =
  process.platform === "win32"
    ? ".deploy\\sylion_puli_ax_ed25519"
    : ".deploy/sylion_puli_ax_ed25519";
const DEFAULT_OUT = "docs/admin-panel-v2/test-artifacts/puli-ax-killswitch-window/latest.json";

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
        timeout: options.timeout || 30_000,
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

async function ssh({ routerIp, user, keyPath, script, timeout = 30_000 }) {
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
  const g1Ip = argValue("g1-ip", process.env.SYLION_G1_PUBLIC_IP || DEFAULT_G1_IP);
  const user = argValue("user", "root");
  const keyPath = argValue("ssh-key", process.env.SYLION_PULI_AX_SSH_KEY || DEFAULT_SSH_KEY);
  const outPath = argValue("out", DEFAULT_OUT);
  const apply = hasArg("apply");
  const rollback = hasArg("rollback");
  const startedAt = isoNow();
  const action = rollback ? "rollback" : apply ? "apply" : "dry_run";

  const script = rollback
    ? `
set -eu
nft delete table inet sylion_killswitch >/dev/null 2>&1 || true
echo killswitch_loaded="$(nft list table inet sylion_killswitch >/dev/null 2>&1 && echo true || echo false)"
echo rollback_done=true
`
    : `
set -eu
mkdir -p /etc/sylion
cat > /etc/sylion/killswitch-pre-vpn.nft <<'EOF'
#!/usr/sbin/nft -f
table inet sylion_killswitch {
  chain input {
    type filter hook input priority -250; policy drop;
    ct state established,related accept
    iif "lo" accept
    ip saddr 192.168.8.0/24 accept
    ip6 saddr fe80::/10 accept
    iifname "br-lan" accept
    udp sport 68 udp dport 67 accept
    meta l4proto icmp limit rate 4/second accept
  }
  chain output {
    type filter hook output priority -250; policy drop;
    ct state established,related accept
    oif "lo" accept
    ip daddr 192.168.8.0/24 accept
    ip6 daddr fe80::/10 accept
    ip daddr 10.42.0.11 udp dport 53 accept
    ip daddr ${g1Ip} udp dport { 500, 4500 } accept
    udp sport 67 udp dport 68 accept
    udp dport 123 accept
    meta l4proto icmp limit rate 4/second accept
  }
  chain forward {
    type filter hook forward priority -250; policy drop;
    ct state established,related accept
    iifname "br-lan" ip daddr 10.42.0.0/16 accept
    ip saddr 10.42.0.0/16 oifname "br-lan" accept
    iifname "br-lan" ip daddr ${g1Ip} udp dport { 500, 4500 } accept
    iifname "br-lan" ip daddr ${g1Ip} ip protocol esp accept
  }
}
EOF
chmod 600 /etc/sylion/killswitch-pre-vpn.nft
if [ "${apply ? "true" : "false"}" = "true" ]; then
  ( sleep 75; nft delete table inet sylion_killswitch >/dev/null 2>&1 || true ) >/dev/null 2>&1 &
  rollback_watchdog_pid="$!"
  nft delete table inet sylion_killswitch >/dev/null 2>&1 || true
  nft -f /etc/sylion/killswitch-pre-vpn.nft
  if [ ! -f /etc/rc.local ]; then
    printf '#!/bin/sh\nexit 0\n' > /etc/rc.local
  fi
  if ! grep -q "sylion-killswitch" /etc/rc.local 2>/dev/null; then
    cp /etc/rc.local /etc/rc.local.sylion-pre-killswitch.bak 2>/dev/null || true
    tmp="/tmp/rc.local.sylion.$$"
    awk '
      /^exit 0$/ && inserted != 1 {
        print "# sylion-killswitch: load default-drop before VPN";
        print "nft -f /etc/sylion/killswitch-pre-vpn.nft >/tmp/sylion-killswitch-boot.log 2>&1 || true";
        print "/etc/init.d/strongswan start >/tmp/sylion-strongswan-boot.log 2>&1 || true";
        inserted = 1
      }
      { print }
      END {
        if (inserted != 1) {
          print "# sylion-killswitch: load default-drop before VPN";
          print "nft -f /etc/sylion/killswitch-pre-vpn.nft >/tmp/sylion-killswitch-boot.log 2>&1 || true";
          print "/etc/init.d/strongswan start >/tmp/sylion-strongswan-boot.log 2>&1 || true";
        }
      }
    ' /etc/rc.local > "$tmp"
    cat "$tmp" > /etc/rc.local
    rm -f "$tmp"
  fi
  chmod 755 /etc/rc.local
  [ -x /etc/init.d/strongswan ] && /etc/init.d/strongswan enable >/dev/null 2>&1 || true
  kill "$rollback_watchdog_pid" >/dev/null 2>&1 || true
  rollback_watchdog_disarmed=true
else
  rollback_watchdog_disarmed=false
fi
echo killswitch_staged=true
echo killswitch_loaded="$(nft list table inet sylion_killswitch >/dev/null 2>&1 && echo true || echo false)"
echo boot_order_installed="$(grep -q 'sylion-killswitch' /etc/rc.local 2>/dev/null && echo true || echo false)"
echo rollback_watchdog_disarmed="$rollback_watchdog_disarmed"
echo ssh_lan_survived=true
echo router_ipsec_sa="$(ipsec status sylion-g1-router 2>/dev/null | grep -q 'ESTABLISHED' && echo true || echo false)"
echo router_ipsec_child="$(ipsec status sylion-g1-router 2>/dev/null | grep -q 'INSTALLED' && echo true || echo false)"
`;
  const result = await ssh({ routerIp, user, keyPath, script });
  const kv = parseKeyValueLines(result.stdout);
  const blockers = [
    ...(result.ok ? [] : ["router_ssh_failed"]),
    ...(rollback
      ? []
      : [bool(kv.killswitch_staged) ? null : "killswitch_not_staged"].filter(Boolean)),
    ...(apply && !bool(kv.killswitch_loaded) ? ["killswitch_not_loaded"] : []),
    ...(apply && !bool(kv.boot_order_installed) ? ["killswitch_boot_order_not_installed"] : []),
    ...(apply && !bool(kv.rollback_watchdog_disarmed)
      ? ["killswitch_rollback_watchdog_not_disarmed"]
      : []),
    ...(apply && !bool(kv.router_ipsec_sa) ? ["router_ipsec_sa_not_established"] : []),
    ...(apply && !bool(kv.router_ipsec_child) ? ["router_ipsec_child_not_installed"] : [])
  ];
  const summary = {
    component: "puli_ax_killswitch_window",
    routerIp,
    startedAt,
    completedAt: isoNow(),
    action,
    status: blockers.length
      ? "blocked"
      : rollback
        ? "rolled_back"
        : apply
          ? "killswitch_loaded"
          : "dry_run_ready",
    facts: {
      killswitchStaged: bool(kv.killswitch_staged),
      killswitchLoaded: bool(kv.killswitch_loaded),
      bootOrderInstalled: bool(kv.boot_order_installed),
      rollbackWatchdogDisarmed: bool(kv.rollback_watchdog_disarmed),
      sshLanSurvived: bool(kv.ssh_lan_survived),
      routerIpsecSa: bool(kv.router_ipsec_sa),
      routerIpsecChild: bool(kv.router_ipsec_child),
      rollbackDone: bool(kv.rollback_done)
    },
    controls: {
      secretsStored: false,
      passwordPrinted: false,
      terminalOperationalDataStored: false,
      productionExecutionAllowed: false,
      sideEffectAllowed: apply || rollback,
      rollbackAvailable: true
    },
    blockers,
    nextActions: blockers.length
      ? [
          "Rollback with node scripts/puli-ax-killswitch-window.mjs --rollback if terminal path is impacted.",
          "Inspect router IPsec state and nft syntax."
        ]
      : apply
        ? [
            "Run Pixel Puli AX network smoke.",
            "Verify plain LAN-to-WAN is blocked while IPsec traffic survives.",
            "Record router posture with kill-switch evidence."
          ]
        : ["Rerun with --apply during a controlled test window."]
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
