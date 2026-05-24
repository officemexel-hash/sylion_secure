import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";

const cfg = {
  sshKey: process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey,
  g2Host: process.env.SYLION_G2_SSH || "sylion@178.105.203.31",
  adminHost: process.env.SYLION_ADMIN_SSH || "root@188.245.227.27",
  g2EnvPath: process.env.SYLION_GUACAMOLE_ENV_PATH || "/etc/sylion/guacamole.env",
  adminDropIn: process.env.SYLION_ADMIN_GUACAMOLE_DROPIN || "/etc/systemd/system/sylion-admin-api.service.d/42-guacamole-json-handoff.conf",
  adminService: process.env.SYLION_ADMIN_SERVICE || "sylion-admin-api"
};

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function encodeScript(script) {
  return Buffer.from(script, "utf8").toString("base64");
}

async function ssh(host, script, options = {}) {
  const encoded = encodeScript(script);
  const result = await execFileAsync("ssh", [
    "-i",
    cfg.sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    host,
    `printf %s ${shellQuote(encoded)} | base64 -d | bash`
  ], {
    input: options.input,
    timeout: options.timeout ?? 60_000,
    windowsHide: true
  });
  return result.stdout.trim();
}

async function readG2Secret() {
  const script = `
set -euo pipefail
sudo grep '^GUACAMOLE_JSON_SECRET_KEY=' ${shellQuote(cfg.g2EnvPath)} | tail -n 1 | cut -d= -f2-
`;
  const secret = await ssh(cfg.g2Host, script);
  if (!/^[0-9a-f]{32}$/i.test(secret)) {
    throw new Error("G2 Guacamole JSON secret is missing or not a 16-byte hex key.");
  }
  return secret;
}

async function writeAdminDropIn(secret) {
  const dropIn = `[Service]
Environment=SYLION_G2_SESSION_BROKER=guacamole
Environment=SYLION_GUACAMOLE_BROKER_READY=true
Environment=SYLION_GUACAMOLE_JSON_SECRET_KEY=${secret}
Environment=SYLION_WORKLOAD_STREAM_SOURCE_READY=true
Environment=SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL=true
Environment=SYLION_G1_G2_POLICY_READY=true
Environment=SYLION_G2_WORKLOAD_POLICY_READY=true
Environment=SYLION_G2_WORKLOAD_GATEWAY_READY=true
Environment=SYLION_REAL_IPSEC_READY=true
Environment=SYLION_KVM_READY=true
Environment=SYLION_DEFER_PHYSICAL_HSM_FIDO2=true
`;
  const dropInB64 = Buffer.from(dropIn, "utf8").toString("base64");
  const script = `
set -euo pipefail
sudo install -d -m 0755 "$(dirname ${shellQuote(cfg.adminDropIn)})"
printf %s ${shellQuote(dropInB64)} | base64 -d | sudo tee ${shellQuote(cfg.adminDropIn)} >/dev/null
sudo chmod 0600 ${shellQuote(cfg.adminDropIn)}
sudo systemctl daemon-reload
sudo systemctl restart ${shellQuote(cfg.adminService)}
sleep 2
curl -fsS http://127.0.0.1:8099/health >/dev/null
`;
  await ssh(cfg.adminHost, script, { timeout: 120_000 });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--apply")) {
    console.error("Usage: node scripts/sync-guacamole-json-handoff-secret.mjs --apply");
    process.exitCode = 2;
    return;
  }
  const secret = await readG2Secret();
  await writeAdminDropIn(secret);
  const expectedHash = sha256(`${secret}\n`);
  const adminHash = await ssh(cfg.adminHost, `
set -euo pipefail
sudo systemctl show ${shellQuote(cfg.adminService)} -p Environment --value \
  | tr ' ' '\\n' \
  | grep '^SYLION_GUACAMOLE_JSON_SECRET_KEY=' \
  | tail -n 1 \
  | cut -d= -f2- \
  | sha256sum \
  | awk '{print $1}'
`);
  console.log(JSON.stringify({
    component: "guacamole_json_auth_handoff_secret_sync",
    synced: adminHash === expectedHash,
    adminService: cfg.adminService,
    secretPrinted: false,
    tokenMaterialStored: false
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
