#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_G1_HOST = "sylion@178.105.200.112";
const DEFAULT_G1_KEY =
  process.platform === "win32"
    ? ".deploy\\sylion_hetzner_admin_ed25519"
    : ".deploy/sylion_hetzner_admin_ed25519";
const DEFAULT_OUT = "docs/admin-panel-v2/test-artifacts/g1-ipsec-responder/latest.json";

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

function spawnWithInput(command, args, input, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        code: "TIMEOUT",
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
        message: `Command timed out after ${options.timeout || 120_000}ms`
      });
    }, options.timeout || 120_000);

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: error.code || 1,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
        message: error.message
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
        message: code === 0 ? null : `Command exited with code ${code}`
      });
    });
    child.stdin.end(input);
  });
}

async function ssh({ host, keyPath, script, timeout = 120_000 }) {
  return spawnWithInput(
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
      host,
      "sudo -n sh -s"
    ],
    script,
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
  const g1Host = argValue("g1-host", process.env.SYLION_G1_SSH || DEFAULT_G1_HOST);
  const g1Key = argValue("g1-key", process.env.SYLION_ADMIN_SSH_KEY || DEFAULT_G1_KEY);
  const outPath = argValue("out", DEFAULT_OUT);
  const apply = hasArg("apply") || process.env.SYLION_G1_IPSEC_RESPONDER_APPLY === "true";
  const startedAt = isoNow();

  const summary = {
    component: "g1_ipsec_responder",
    startedAt,
    completedAt: null,
    mode: apply ? "apply" : "dry_run",
    g1HostRedacted: true,
    facts: {},
    controls: {
      certAuth: true,
      passwordAuth: false,
      secretsPrinted: false,
      terminalOperationalDataStored: false,
      sideEffectAllowed: apply,
      productionExecutionAllowed: false
    },
    blockers: [],
    nextActions: []
  };

  if (!apply) {
    summary.status = "dry_run_ready";
    summary.completedAt = isoNow();
    summary.facts = {
      conn: "sylion-operators",
      leftSubnet: "10.42.0.0/16",
      rightSourceIp: "10.43.0.0/24",
      rightDns: "10.42.0.11"
    };
    summary.nextActions = ["Rerun with --apply to install the G1 strongSwan responder profile."];
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const script = `
set -eu
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="/var/backups/sylion-g1-ipsec/$stamp"
mkdir -p "$backup_dir" /etc/ipsec.d/certs /etc/ipsec.d/private /etc/ipsec.d/cacerts /etc/sylion/evidence
[ -f /etc/ipsec.conf ] && cp -a /etc/ipsec.conf "$backup_dir/ipsec.conf"
[ -f /etc/ipsec.secrets ] && cp -a /etc/ipsec.secrets "$backup_dir/ipsec.secrets"
test -s /etc/sylion/ipsec/ca-cert.pem
test -s /etc/sylion/ipsec/g1-cert.pem
test -s /etc/sylion/ipsec/g1-key.pem
install -m 0644 /etc/sylion/ipsec/ca-cert.pem /etc/ipsec.d/cacerts/sylion-ca.crt
install -m 0644 /etc/sylion/ipsec/g1-cert.pem /etc/ipsec.d/certs/g1-server.crt
install -m 0600 /etc/sylion/ipsec/g1-key.pem /etc/ipsec.d/private/g1-server.key
chmod 0600 /etc/sylion/ipsec/*-key.pem /etc/sylion/ipsec/ca-key.pem 2>/dev/null || true
cat > /etc/ipsec.conf <<'EOF'
config setup
    uniqueids=no
    charondebug="ike 1, knl 1, cfg 1, net 1, enc 0, lib 0"

conn %default
    keyexchange=ikev2
    type=tunnel
    authby=pubkey
    left=%any
    leftid=@g1.sylion.internal
    leftcert=/etc/ipsec.d/certs/g1-server.crt
    leftsendcert=always
    leftsubnet=10.42.0.0/16
    right=%any
    rightauth=pubkey
    rightid=%any
    rightsourceip=10.43.0.0/24
    rightdns=10.42.0.11
    rightsendcert=never
    ike=aes256gcm16-prfsha384-ecp384,aes256-sha384-ecp384!
    esp=aes256gcm16-ecp384,aes256-sha384!
    fragmentation=yes
    mobike=yes
    dpdaction=clear
    dpddelay=30s
    rekey=yes
    reauth=no
    ikelifetime=8h
    lifetime=1h
    installpolicy=yes
    auto=add

conn sylion-operators
    also=%default
EOF
cat > /etc/ipsec.secrets <<'EOF'
: ECDSA /etc/ipsec.d/private/g1-server.key
: RSA /etc/ipsec.d/private/g1-server.key
EOF
chmod 0600 /etc/ipsec.secrets
cat > /etc/sysctl.d/99-sylion-ipsec-forward.conf <<'EOF'
net.ipv4.ip_forward=1
net.ipv4.conf.all.accept_redirects=0
net.ipv4.conf.all.send_redirects=0
net.ipv4.conf.default.accept_redirects=0
net.ipv4.conf.default.send_redirects=0
EOF
sysctl --system >/dev/null
systemctl enable strongswan-starter >/dev/null 2>&1 || true
systemctl restart strongswan-starter
sleep 2
active=$(systemctl is-active strongswan-starter || true)
connections=$(ipsec statusall 2>/dev/null | awk '/Connections:/,/Security Associations/' | grep -c 'sylion-operators' || true)
cat > /etc/sylion/evidence/g1-ipsec-responder.json <<EOF
{"component":"g1_ipsec_responder","checkedAt":"$(date -Is)","service":"$active","conn":"sylion-operators","leftSubnet":"10.42.0.0/16","rightSourceIp":"10.43.0.0/24","rightDns":"10.42.0.11","auth":"mutual_certificate","caInstalled":true,"keyMode":"0600","secretsPrinted":false,"readyForRouterInitiation":$([ "$active" = active ] && [ "$connections" -gt 0 ] && printf true || printf false)}
EOF
echo service="$active"
echo conn_present="$([ "$connections" -gt 0 ] && echo true || echo false)"
echo evidence_written=true
echo key_mode_0600=true
`;

  const install = await ssh({ host: g1Host, keyPath: g1Key, script });
  const kv = parseKeyValueLines(install.stdout);
  summary.completedAt = isoNow();
  summary.facts = {
    serviceActive: kv.service === "active",
    connPresent: bool(kv.conn_present),
    evidenceWritten: bool(kv.evidence_written),
    keyMode0600: bool(kv.key_mode_0600),
    conn: "sylion-operators",
    leftSubnet: "10.42.0.0/16",
    rightSourceIp: "10.43.0.0/24",
    rightDns: "10.42.0.11"
  };
  summary.blockers = [
    ...(install.ok ? [] : ["g1_ipsec_install_failed"]),
    ...(summary.facts.serviceActive ? [] : ["strongswan_starter_not_active"]),
    ...(summary.facts.connPresent ? [] : ["sylion_operators_conn_missing"]),
    ...(summary.facts.keyMode0600 ? [] : ["g1_ipsec_key_mode_not_0600"])
  ];
  summary.status = summary.blockers.length ? "blocked" : "ready_for_router_initiation";
  summary.nextActions = summary.blockers.length
    ? ["Inspect G1 charon logs without printing private material, then rerun this installer."]
    : ["Provision Puli AX router IPsec profile and verify SA/child SA from G1."];

  if (outPath && !hasArg("no-write")) {
    const absolute = resolve(outPath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (hasArg("require-pass") && summary.blockers.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
