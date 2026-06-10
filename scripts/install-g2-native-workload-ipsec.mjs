import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSshKey =
  process.platform === "win32"
    ? ".deploy\\sylion_hetzner_admin_ed25519"
    : ".deploy/sylion_hetzner_admin_ed25519";

const plan = {
  component: "g2_native_workload_ipsec",
  g2: {
    ssh: process.env.SYLION_G2_SSH || "sylion@178.105.203.31",
    publicIp: process.env.SYLION_G2_PUBLIC_IP || "178.105.203.31",
    privateIp: process.env.SYLION_G2_PRIVATE_IP || "10.42.0.12",
    id: "g2.sylion.internal"
  },
  workload: {
    ssh: process.env.SYLION_WORKLOAD_NATIVE_SSH || "root@65.109.123.72",
    publicIp: process.env.SYLION_WORKLOAD_NATIVE_PUBLIC_IP || "65.109.123.72",
    privateIp: process.env.SYLION_WORKLOAD_NATIVE_PRIVATE_IP || "10.44.0.13",
    id: "workload-native-lab-01.sylion.internal"
  },
  sshKey: process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey,
  connName: "sylion-g2-workload-native",
  crypto: {
    ike: "aes256gcm16-prfsha384-ecp384,aes256-sha384-ecp384!",
    esp: "aes256gcm16-ecp384,aes256-sha384-ecp384!"
  },
  productionExecutionAllowed: false,
  hsmBacked: false
};

function args() {
  const input = new Set(process.argv.slice(2));
  return {
    apply: input.has("--apply")
  };
}

async function run(command, argv, options = {}) {
  const result = await execFileAsync(command, argv, {
    timeout: options.timeout ?? 60_000,
    windowsHide: true,
    input: options.input
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function ssh(host, script, options = {}) {
  return run(
    "ssh",
    [
      "-i",
      plan.sshKey,
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      host,
      script
    ],
    options
  );
}

async function scp(from, to, options = {}) {
  return run(
    "scp",
    ["-i", plan.sshKey, "-o", "StrictHostKeyChecking=accept-new", from, to],
    options
  );
}

function shellSingle(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function renderG2IpsecConf() {
  return `config setup
  uniqueids = no

conn ${plan.connName}
  keyexchange = ikev2
  type = tunnel
  left = ${plan.g2.publicIp}
  leftid = @${plan.g2.id}
  leftcert = g2-workload-cert.pem
  leftsubnet = ${plan.g2.privateIp}/32
  right = ${plan.workload.publicIp}
  rightid = @${plan.workload.id}
  rightsubnet = ${plan.workload.privateIp}/32
  authby = pubkey
  ike = ${plan.crypto.ike}
  esp = ${plan.crypto.esp}
  dpdaction = restart
  dpddelay = 30s
  keyingtries = %forever
  auto = add
`;
}

function renderWorkloadIpsecConf() {
  return `config setup
  uniqueids = no

conn ${plan.connName}
  keyexchange = ikev2
  type = tunnel
  left = ${plan.workload.publicIp}
  leftid = @${plan.workload.id}
  leftcert = workload-native-cert.pem
  leftsubnet = ${plan.workload.privateIp}/32
  right = ${plan.g2.publicIp}
  rightid = @${plan.g2.id}
  rightsubnet = ${plan.g2.privateIp}/32
  authby = pubkey
  ike = ${plan.crypto.ike}
  esp = ${plan.crypto.esp}
  dpdaction = restart
  dpddelay = 30s
  keyingtries = %forever
  auto = start
`;
}

function renderSecrets(keyName) {
  return `: ECDSA ${keyName}
`;
}

function generateAndInstallG2Script() {
  return `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo -n apt-get update >/dev/null
sudo -n apt-get install -y --no-install-recommends strongswan strongswan-pki >/dev/null
build_dir="$(mktemp -d /tmp/sylion-g2-native-ipsec.XXXXXX)"
umask 077
cd "$build_dir"
pki --gen --type ecdsa --size 384 --outform pem > ca-key.pem
pki --self --ca --lifetime 3650 --in ca-key.pem --type ecdsa --dn "CN=SYLION Lab G2 Native Workload CA" --outform pem > ca-cert.pem
pki --gen --type ecdsa --size 384 --outform pem > g2-workload-key.pem
pki --pub --in g2-workload-key.pem --type ecdsa | pki --issue --lifetime 397 --cacert ca-cert.pem --cakey ca-key.pem --dn "CN=${plan.g2.id}" --san "${plan.g2.id}" --outform pem > g2-workload-cert.pem
pki --gen --type ecdsa --size 384 --outform pem > workload-native-key.pem
pki --pub --in workload-native-key.pem --type ecdsa | pki --issue --lifetime 397 --cacert ca-cert.pem --cakey ca-key.pem --dn "CN=${plan.workload.id}" --san "${plan.workload.id}" --outform pem > workload-native-cert.pem
sudo -n install -d -m 0755 /etc/ipsec.d/cacerts /etc/ipsec.d/certs
sudo -n install -d -m 0700 /etc/ipsec.d/private /etc/sylion/ipsec-native /opt/sylion-workloads/evidence
sudo -n install -m 0644 ca-cert.pem /etc/ipsec.d/cacerts/sylion-g2-workload-ca.pem
sudo -n install -m 0644 g2-workload-cert.pem /etc/ipsec.d/certs/g2-workload-cert.pem
sudo -n install -m 0600 g2-workload-key.pem /etc/ipsec.d/private/g2-workload-key.pem
cat > ipsec.conf <<'EOF'
${renderG2IpsecConf()}
EOF
cat > ipsec.secrets <<'EOF'
${renderSecrets("g2-workload-key.pem")}
EOF
sudo -n install -m 0600 ipsec.conf /etc/ipsec.conf
sudo -n install -m 0600 ipsec.secrets /etc/ipsec.secrets
tar -czf /tmp/sylion-workload-native-ipsec.tgz ca-cert.pem workload-native-cert.pem workload-native-key.pem
chmod 0600 /tmp/sylion-workload-native-ipsec.tgz
sudo -n systemctl enable --now strongswan-starter >/dev/null
sudo -n systemctl restart strongswan-starter
jq -n --arg checkedAt "$(date -Is)" --arg conn ${shellSingle(plan.connName)} '{component:"g2_native_workload_ipsec_g2_install", checkedAt:$checkedAt, conn:$conn, certAuth:true, hsmBacked:false, secretsPrinted:false, productionExecutionAllowed:false}' | sudo -n tee /opt/sylion-workloads/evidence/g2-native-workload-ipsec-g2.json >/dev/null
echo /tmp/sylion-workload-native-ipsec.tgz
`;
}

function installWorkloadScript() {
  return `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update >/dev/null
apt-get install -y --no-install-recommends strongswan strongswan-pki jq >/dev/null
install -d -m 0755 /etc/ipsec.d/cacerts /etc/ipsec.d/certs /opt/sylion-workloads/evidence
install -d -m 0700 /etc/ipsec.d/private /etc/sylion/ipsec-native
tmp_dir="$(mktemp -d /tmp/sylion-workload-native-ipsec.XXXXXX)"
tar -xzf /tmp/sylion-workload-native-ipsec.tgz -C "$tmp_dir"
install -m 0644 "$tmp_dir/ca-cert.pem" /etc/ipsec.d/cacerts/sylion-g2-workload-ca.pem
install -m 0644 "$tmp_dir/workload-native-cert.pem" /etc/ipsec.d/certs/workload-native-cert.pem
install -m 0600 "$tmp_dir/workload-native-key.pem" /etc/ipsec.d/private/workload-native-key.pem
cat > /etc/ipsec.conf <<'EOF'
${renderWorkloadIpsecConf()}
EOF
cat > /etc/ipsec.secrets <<'EOF'
${renderSecrets("workload-native-key.pem")}
EOF
cat > /etc/systemd/system/sylion-workload-native-ip.service <<'EOF'
[Unit]
Description=SYLION WORKLOAD_NATIVE private lab address
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/ip addr add ${plan.workload.privateIp}/32 dev lo
ExecStop=/usr/sbin/ip addr del ${plan.workload.privateIp}/32 dev lo

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
ip addr show lo | grep -q '${plan.workload.privateIp}/32' || systemctl enable --now sylion-workload-native-ip.service
systemctl enable --now strongswan-starter >/dev/null
systemctl restart strongswan-starter
jq -n --arg checkedAt "$(date -Is)" --arg conn ${shellSingle(plan.connName)} --arg privateIp ${shellSingle(plan.workload.privateIp)} '{component:"g2_native_workload_ipsec_workload_install", checkedAt:$checkedAt, conn:$conn, privateIp:$privateIp, certAuth:true, hsmBacked:false, secretsPrinted:false, productionExecutionAllowed:false}' | tee /opt/sylion-workloads/evidence/g2-native-workload-ipsec-workload.json >/dev/null
rm -rf "$tmp_dir" /tmp/sylion-workload-native-ipsec.tgz
`;
}

function verifyScript() {
  return `
set -euo pipefail
sudo -n ipsec up ${plan.connName} >/tmp/sylion-g2-native-ipsec-up.log 2>&1 || true
sleep 2
status="$(sudo -n ipsec status ${plan.connName} || true)"
ping_code=1
ping -c 2 -W 2 ${plan.workload.privateIp} >/tmp/sylion-g2-native-ipsec-ping.log 2>&1 && ping_code=0 || ping_code=$?
established=false
echo "$status" | grep -q 'ESTABLISHED' && established=true
installed=false
echo "$status" | grep -q 'INSTALLED' && installed=true
jq -n \
  --arg checkedAt "$(date -Is)" \
  --arg conn ${shellSingle(plan.connName)} \
  --arg g2Private ${shellSingle(plan.g2.privateIp)} \
  --arg workloadPrivate ${shellSingle(plan.workload.privateIp)} \
  --argjson established "$established" \
  --argjson installed "$installed" \
  --argjson pingCode "$ping_code" \
  '{component:"g2_native_workload_ipsec_verify", checkedAt:$checkedAt, conn:$conn, g2Private:$g2Private, workloadPrivate:$workloadPrivate, established:$established, childInstalled:$installed, pingCode:$pingCode, ready:($established and $installed and $pingCode == 0), transport:"ipsec_ikev2_cert_auth_lab", hsmBacked:false, terminalDataStored:false, secretsPrinted:false, productionExecutionAllowed:false}' | sudo -n tee /opt/sylion-workloads/evidence/g2-native-workload-ipsec-verify.json
`;
}

async function main() {
  const options = args();
  if (!options.apply) {
    console.log(
      JSON.stringify(
        {
          ...plan,
          action: "plan_only",
          note: "Run with --apply to install lab certificate-authenticated IKEv2 between G2 and WORKLOAD_NATIVE."
        },
        null,
        2
      )
    );
    return;
  }
  const tmp = await mkdtemp(join(tmpdir(), "sylion-g2-native-ipsec-"));
  const localBundle = join(tmp, "sylion-workload-native-ipsec.tgz");
  try {
    const g2Install = await ssh(plan.g2.ssh, generateAndInstallG2Script(), { timeout: 180_000 });
    const remoteBundle = g2Install.stdout.split(/\r?\n/).filter(Boolean).at(-1);
    await scp(`${plan.g2.ssh}:${remoteBundle}`, localBundle);
    await scp(localBundle, `${plan.workload.ssh}:/tmp/sylion-workload-native-ipsec.tgz`);
    await ssh(plan.workload.ssh, installWorkloadScript(), { timeout: 180_000 });
    const verify = await ssh(plan.g2.ssh, verifyScript(), { timeout: 60_000 });
    const evidence = JSON.parse(
      verify.stdout.slice(verify.stdout.indexOf("{"), verify.stdout.lastIndexOf("}") + 1)
    );
    await ssh(plan.g2.ssh, `rm -f ${shellSingle(remoteBundle)}`);
    console.log(
      JSON.stringify(
        {
          applied: true,
          evidence,
          productionExecutionAllowed: false
        },
        null,
        2
      )
    );
    if (!evidence.ready) process.exitCode = 1;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

await main();
