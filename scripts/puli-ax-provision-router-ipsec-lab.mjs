#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const DEFAULT_ROUTER_IP = "192.168.8.1";
const DEFAULT_G1_HOST = "sylion@178.105.200.112";
const DEFAULT_ROUTER_KEY = process.platform === "win32"
  ? ".deploy\\sylion_puli_ax_ed25519"
  : ".deploy/sylion_puli_ax_ed25519";
const DEFAULT_G1_KEY = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";
const DEFAULT_OUT = "docs/admin-panel-v2/test-artifacts/puli-ax-router-ipsec-lab/latest.json";

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

async function ssh({ host, keyPath, script, timeout = 120_000 }) {
  return execFileAsync("ssh", [
    "-i",
    keyPath,
    "-o",
    "BatchMode=yes",
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "StrictHostKeyChecking=accept-new",
    host,
    script
  ], { timeout });
}

async function scp({ keyPath, from, to, timeout = 120_000 }) {
  return execFileAsync("scp", [
    "-O",
    "-i",
    keyPath,
    "-o",
    "BatchMode=yes",
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "StrictHostKeyChecking=accept-new",
    from,
    to
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
  const routerUser = argValue("router-user", "root");
  const routerKey = argValue("router-key", process.env.SYLION_PULI_AX_SSH_KEY || DEFAULT_ROUTER_KEY);
  const g1Host = argValue("g1-host", process.env.SYLION_G1_SSH || DEFAULT_G1_HOST);
  const g1Key = argValue("g1-key", process.env.SYLION_ADMIN_SSH_KEY || DEFAULT_G1_KEY);
  const outPath = argValue("out", DEFAULT_OUT);
  const apply = hasArg("apply") || process.env.SYLION_PULI_AX_IPSEC_APPLY === "true";
  const startTunnel = hasArg("start") || process.env.SYLION_PULI_AX_IPSEC_START === "true";
  const g1Endpoint = argValue("g1-endpoint", process.env.SYLION_G1_PUBLIC_IP || "178.105.200.112");
  const identity = argValue("identity", "router.OP-001@sylion.internal");
  const tmpDir = resolve(".deploy", "puli-ax-ipsec-lab");
  const startedAt = isoNow();
  await mkdir(tmpDir, { recursive: true });
  const localCsr = join(tmpDir, "router.csr.pem");
  const localCert = join(tmpDir, "router.cert.pem");
  const localCa = join(tmpDir, "g1.ca.pem");

  const routerHost = `${routerUser}@${routerIp}`;
  const result = {
    component: "puli_ax_router_ipsec_lab",
    routerIp,
    g1HostRedacted: true,
    identity,
    startedAt,
    completedAt: null,
    mode: apply ? "apply" : "dry_run",
    startTunnel,
    status: "started",
    facts: {},
    controls: {
      secretsStored: false,
      passwordPrinted: false,
      privateKeyLeavesRouter: false,
      caPrivateKeyLeavesG1: false,
      terminalOperationalDataStored: false,
      productionExecutionAllowed: false,
      sideEffectAllowed: apply,
      killSwitchLoaded: false
    },
    blockers: [],
    nextActions: []
  };

  if (!apply) {
    result.status = "dry_run_ready";
    result.completedAt = isoNow();
    result.facts = {
      routerKeyWillBeGeneratedOnRouter: true,
      csrWillBeSignedOnG1: true,
      routerIpsecWillBeStaged: true,
      tunnelWillStart: false
    };
    result.nextActions = ["Rerun with --apply to generate router key/CSR, sign cert on G1, and stage IPsec config."];
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const gen = await ssh({
    host: routerHost,
    keyPath: routerKey,
    script: `
set -eu
mkdir -p /etc/sylion/ipsec
chmod 700 /etc/sylion /etc/sylion/ipsec
if [ ! -s /etc/sylion/ipsec/router-key.pem ]; then
  pki --gen --type ecdsa --size 384 > /etc/sylion/ipsec/router-key.pem
fi
chmod 600 /etc/sylion/ipsec/router-key.pem
pki --req --type priv --in /etc/sylion/ipsec/router-key.pem --dn "C=DE, O=SYLION, CN=${identity}" --san "${identity}" > /tmp/sylion-router.csr.pem
chmod 600 /tmp/sylion-router.csr.pem
echo router_key_present=true
echo router_csr_present=true
echo private_key_left_router=false
`
  });
  if (!gen.ok) {
    result.status = "blocked_router_csr_failed";
    result.blockers.push("router_csr_generation_failed");
    result.completedAt = isoNow();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  Object.assign(result.facts, parseKeyValueLines(gen.stdout));

  const csrCopy = await scp({
    keyPath: routerKey,
    from: `${routerHost}:/tmp/sylion-router.csr.pem`,
    to: localCsr
  });
  if (!csrCopy.ok) {
    result.status = "blocked_csr_copy_failed";
    result.blockers.push("router_csr_copy_failed");
    result.completedAt = isoNow();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const g1RemoteCsr = `/tmp/sylion-router-${Date.now()}.csr.pem`;
  const g1RemoteCert = g1RemoteCsr.replace(".csr.pem", ".cert.pem");
  const g1CsrCopy = await scp({
    keyPath: g1Key,
    from: localCsr,
    to: `${g1Host}:${g1RemoteCsr}`
  });
  if (!g1CsrCopy.ok) {
    result.status = "blocked_g1_csr_upload_failed";
    result.blockers.push("g1_csr_upload_failed");
    result.completedAt = isoNow();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  const sign = await ssh({
    host: g1Host,
    keyPath: g1Key,
    script: `
set -euo pipefail
sudo -n test -f /etc/sylion/ipsec/ca-cert.pem
sudo -n test -f /etc/sylion/ipsec/ca-key.pem
sudo -n pki --issue --type pkcs10 --in ${g1RemoteCsr} --cacert /etc/sylion/ipsec/ca-cert.pem --cakey /etc/sylion/ipsec/ca-key.pem --dn "C=DE, O=SYLION, CN=${identity}" --san "${identity}" --flag clientAuth --lifetime 30 > ${g1RemoteCert}
sudo -n cp /etc/sylion/ipsec/ca-cert.pem /tmp/sylion-router-ca.pem
sudo -n chown "$USER":"$USER" ${g1RemoteCert} /tmp/sylion-router-ca.pem
echo g1_signed_cert=true
echo ca_private_key_left_g1=false
`
  });
  if (!sign.ok) {
    result.status = "blocked_g1_sign_failed";
    result.blockers.push("g1_router_cert_sign_failed");
    result.completedAt = isoNow();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  Object.assign(result.facts, parseKeyValueLines(sign.stdout));

  const certCopy = await scp({ keyPath: g1Key, from: `${g1Host}:${g1RemoteCert}`, to: localCert });
  const caCopy = await scp({ keyPath: g1Key, from: `${g1Host}:/tmp/sylion-router-ca.pem`, to: localCa });
  if (!certCopy.ok || !caCopy.ok) {
    result.status = "blocked_cert_download_failed";
    result.blockers.push("router_cert_download_failed");
    result.completedAt = isoNow();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  const routerCertCopy = await scp({ keyPath: routerKey, from: localCert, to: `${routerHost}:/tmp/sylion-router.cert.pem` });
  const routerCaCopy = await scp({ keyPath: routerKey, from: localCa, to: `${routerHost}:/tmp/sylion-g1.ca.pem` });
  if (!routerCertCopy.ok || !routerCaCopy.ok) {
    result.status = "blocked_router_cert_upload_failed";
    result.blockers.push("router_cert_upload_failed");
    result.completedAt = isoNow();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  const install = await ssh({
    host: routerHost,
    keyPath: routerKey,
    script: `
set -eu
mkdir -p /etc/sylion/ipsec /etc/ipsec.d/certs /etc/ipsec.d/cacerts /etc/ipsec.d/private
mv /tmp/sylion-router.cert.pem /etc/sylion/ipsec/router-cert.pem
mv /tmp/sylion-g1.ca.pem /etc/sylion/ipsec/g1-ca.pem
cp /etc/sylion/ipsec/router-cert.pem /etc/ipsec.d/certs/router-cert.pem
cp /etc/sylion/ipsec/g1-ca.pem /etc/ipsec.d/cacerts/g1-ca.pem
chmod 644 /etc/sylion/ipsec/router-cert.pem /etc/sylion/ipsec/g1-ca.pem /etc/ipsec.d/certs/router-cert.pem /etc/ipsec.d/cacerts/g1-ca.pem
cat > /etc/ipsec.conf <<'EOF'
config setup
    uniqueids=no
    strictcrlpolicy=no

conn sylion-g1-router
    keyexchange=ikev2
    type=tunnel
    auto=${startTunnel ? "start" : "add"}
    closeaction=restart
    dpdaction=restart
    dpddelay=30s
    dpdtimeout=120s
    fragmentation=yes
    mobike=yes

    left=%defaultroute
    leftsourceip=%config
    leftcert=/etc/sylion/ipsec/router-cert.pem
    leftauth=pubkey
    leftid=${identity}
    leftsendcert=always

    right=${g1Endpoint}
    rightauth=pubkey
    rightid=@g1.sylion.internal
    rightsubnet=10.42.0.0/16

    ike=aes256gcm16-prfsha384-ecp384,aes256-sha384-ecp384!
    esp=aes256gcm16-ecp384,aes256-sha384-ecp384!
    ikelifetime=4h
    lifetime=1h
    margintime=9m
    rekey=yes
EOF
cat > /etc/ipsec.secrets <<'EOF'
: ECDSA /etc/sylion/ipsec/router-key.pem
EOF
chmod 600 /etc/ipsec.conf /etc/ipsec.secrets /etc/sylion/ipsec/router-key.pem
cat > /etc/sylion/killswitch-pre-vpn.nft <<'EOF'
#!/usr/sbin/nft -f
table inet sylion_killswitch {
  chain input {
    type filter hook input priority -200; policy drop;
    ct state established,related accept
    iif "lo" accept
    iifname "br-lan" accept
    meta l4proto icmp limit rate 4/second accept
    udp sport 68 udp dport 67 accept
  }
  chain forward {
    type filter hook forward priority -200; policy drop;
    ct state established,related accept
    iifname "br-lan" ip daddr 10.42.0.0/16 accept
    ip saddr 10.42.0.0/16 oifname "br-lan" accept
  }
  chain output {
    type filter hook output priority -200; policy drop;
    oif "lo" accept
    ct state established,related accept
    ip daddr 192.168.8.0/24 accept
    ip daddr 10.42.0.11 udp dport 53 accept
    udp dport { 500, 4500 } accept
    udp sport 67 udp dport 68 accept
    udp dport 123 accept
    meta l4proto icmp limit rate 4/second accept
  }
}
EOF
chmod 600 /etc/sylion/killswitch-pre-vpn.nft
touch /etc/firewall.user
iptables -t nat -D POSTROUTING -d 10.42.0.0/16 -j ACCEPT 2>/dev/null || true
sed -i '/SYLION IPsec NAT bypass/,+1d' /etc/firewall.user 2>/dev/null || true
sed -i '/SYLION IPsec LAN SNAT/,+2d' /etc/firewall.user 2>/dev/null || true
sed -i '/SYLION IPsec TCP MSS clamp/,+4d' /etc/firewall.user 2>/dev/null || true
uci -q del_list dhcp.@dnsmasq[0].server='/sylion.internal/10.42.0.11' 2>/dev/null || true
uci add_list dhcp.@dnsmasq[0].server='/sylion.internal/10.42.0.11'
uci -q del_list dhcp.@dnsmasq[0].rebind_domain='sylion.internal' 2>/dev/null || true
uci add_list dhcp.@dnsmasq[0].rebind_domain='sylion.internal'
for host in operator session admin duckduckgo libreoffice whatsapp telegram threema signal zangi exodus; do
  uci -q del_list dhcp.@dnsmasq[0].address="/$host.sylion.internal/10.42.0.12" 2>/dev/null || true
  uci add_list dhcp.@dnsmasq[0].address="/$host.sylion.internal/10.42.0.12"
done
uci commit dhcp
/etc/init.d/dnsmasq restart >/tmp/sylion-router-dnsmasq-restart.log 2>&1 || true
if [ "${startTunnel ? "true" : "false"}" = "true" ]; then
  ipsec rereadall >/dev/null 2>&1 || true
  ipsec reload >/dev/null 2>&1 || true
  ipsec down sylion-g1-router >/dev/null 2>&1 || true
  ipsec up sylion-g1-router >/tmp/sylion-router-ipsec-up.log 2>&1 || true
fi
sleep 3
status="$(ipsec status sylion-g1-router 2>/dev/null || true)"
if [ "${startTunnel ? "true" : "false"}" = "true" ] && ! echo "$status" | grep -q 'ESTABLISHED'; then
  ipsec up sylion-g1-router >>/tmp/sylion-router-ipsec-up.log 2>&1 || true
  sleep 2
  status="$(ipsec status sylion-g1-router 2>/dev/null || true)"
fi
router_vip="$(ip -4 addr show 2>/dev/null | awk '$2 ~ /^10[.]43[.]/ { split($2,a,"/"); print a[1]; exit }')"
[ -n "$router_vip" ] || router_vip="10.43.0.2"
cat >> /etc/firewall.user <<EOF

# SYLION IPsec LAN SNAT: make Pixel LAN traffic match the G1 selector while preserving tunnel-only reachability.
iptables -t nat -D POSTROUTING -s 192.168.8.0/24 -d 10.42.0.0/16 -j SNAT --to-source \${router_vip} 2>/dev/null || true
iptables -t nat -I POSTROUTING 1 -s 192.168.8.0/24 -d 10.42.0.0/16 -j SNAT --to-source \${router_vip}

# SYLION IPsec TCP MSS clamp: avoid TLS/WebSocket stalls over repeater + ESP overhead.
iptables -t mangle -D FORWARD -s 192.168.8.0/24 -d 10.42.0.0/16 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200 2>/dev/null || true
iptables -t mangle -I FORWARD 1 -s 192.168.8.0/24 -d 10.42.0.0/16 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200
iptables -t mangle -D FORWARD -s 10.42.0.0/16 -d 192.168.8.0/24 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200 2>/dev/null || true
iptables -t mangle -I FORWARD 1 -s 10.42.0.0/16 -d 192.168.8.0/24 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200
EOF
iptables -t nat -D POSTROUTING -s 192.168.8.0/24 -d 10.42.0.0/16 -j SNAT --to-source "$router_vip" 2>/dev/null || true
iptables -t nat -I POSTROUTING 1 -s 192.168.8.0/24 -d 10.42.0.0/16 -j SNAT --to-source "$router_vip"
iptables -t mangle -D FORWARD -s 192.168.8.0/24 -d 10.42.0.0/16 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200 2>/dev/null || true
iptables -t mangle -I FORWARD 1 -s 192.168.8.0/24 -d 10.42.0.0/16 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200
iptables -t mangle -D FORWARD -s 10.42.0.0/16 -d 192.168.8.0/24 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200 2>/dev/null || true
iptables -t mangle -I FORWARD 1 -s 10.42.0.0/16 -d 192.168.8.0/24 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200
echo router_cert_installed=true
echo router_ipsec_conf_installed=true
echo router_killswitch_staged=true
echo router_virtual_ip="$router_vip"
echo router_lan_snat_installed="$(iptables -t nat -C POSTROUTING -s 192.168.8.0/24 -d 10.42.0.0/16 -j SNAT --to-source "$router_vip" >/dev/null 2>&1 && echo true || echo false)"
echo router_tcp_mss_clamp_installed="$(iptables -t mangle -C FORWARD -s 192.168.8.0/24 -d 10.42.0.0/16 -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200 >/dev/null 2>&1 && echo true || echo false)"
echo router_tunnel_established="$(echo "$status" | grep -q 'ESTABLISHED' && echo true || echo false)"
echo router_child_installed="$(echo "$status" | grep -q 'INSTALLED' && echo true || echo false)"
echo killswitch_loaded="$(nft list table inet sylion_killswitch >/dev/null 2>&1 && echo true || echo false)"
echo router_internal_dns_forward="$(uci show dhcp 2>/dev/null | grep -q '/sylion.internal/10.42.0.11' && echo true || echo false)"
echo router_internal_dns_static="$(uci show dhcp 2>/dev/null | grep -q '/operator.sylion.internal/10.42.0.12' && echo true || echo false)"
echo router_internal_dns_resolves="$(nslookup operator.sylion.internal 127.0.0.1 2>/dev/null | grep -q '10.42.0.12' && echo true || echo false)"
`
  });
  if (!install.ok) {
    result.status = "blocked_router_install_failed";
    result.blockers.push("router_ipsec_install_failed");
    result.completedAt = isoNow();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  Object.assign(result.facts, parseKeyValueLines(install.stdout));

  await ssh({ host: g1Host, keyPath: g1Key, script: `rm -f ${g1RemoteCsr} ${g1RemoteCert} /tmp/sylion-router-ca.pem`, timeout: 30_000 }).catch(() => {});
  await rm(localCsr, { force: true }).catch(() => {});
  await rm(localCert, { force: true }).catch(() => {});
  await rm(localCa, { force: true }).catch(() => {});

  const tunnelEstablished = bool(result.facts.router_tunnel_established);
  const childInstalled = bool(result.facts.router_child_installed);
  result.completedAt = isoNow();
  result.status = startTunnel
    ? tunnelEstablished && childInstalled ? "router_ipsec_established" : "router_ipsec_staged_but_not_established"
    : "router_ipsec_staged";
  result.blockers = [
    ...(startTunnel && !tunnelEstablished ? ["router_ipsec_sa_not_established"] : []),
    ...(startTunnel && !childInstalled ? ["router_ipsec_child_sa_not_installed"] : []),
    "killswitch_not_loaded_until_tunnel_failure_test_window"
  ];
  result.nextActions = result.blockers.length ? [
    "Inspect router /tmp/sylion-router-ipsec-up.log and G1 charon logs without printing private material.",
    "Verify traffic selectors before loading kill switch.",
    "Run T01-T10 in a controlled failure-test window."
  ] : [
    "Run T01-T10 in a controlled failure-test window.",
    "Only after pass: load kill switch and record router posture in Admin API."
  ];

  if (outPath && !hasArg("no-write")) {
    const absolute = resolve(outPath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (hasArg("require-pass") && result.blockers.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
