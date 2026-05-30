#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const HETZNER_API = "https://api.hetzner.cloud/v1";

function parseArgs(argv) {
  const args = new Map();
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [key, ...valueParts] = item.slice(2).split("=");
    args.set(key, valueParts.length ? valueParts.join("=") : "true");
  }
  return args;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function run(command, args, { input = null, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    stdio: input ? ["pipe", quiet ? "pipe" : "inherit", quiet ? "pipe" : "inherit"] : quiet ? "pipe" : "inherit",
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result.stdout || "";
}

async function hcloud(path, { method = "GET", body = null, token }) {
  const response = await fetch(`${HETZNER_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Hetzner Cloud API ${method} ${path} failed with ${response.status}: ${payload.error?.code || "unknown"}`);
  }
  return payload;
}

async function ensureSshKey({ token, name, publicKeyPath }) {
  const keys = await hcloud("/ssh_keys", { token });
  const existing = keys.ssh_keys?.find((key) => key.name === name);
  if (existing) return existing;
  const publicKey = await readFile(resolve(publicKeyPath), "utf8");
  const created = await hcloud("/ssh_keys", {
    method: "POST",
    token,
    body: { name, public_key: publicKey.trim() }
  });
  return created.ssh_key;
}

async function resolveNetworkId({ token, network }) {
  if (!network) return null;
  if (/^\d+$/.test(String(network))) return Number(network);
  const networks = await hcloud("/networks", { token });
  const match = networks.networks?.find((item) => item.name === network);
  if (!match) throw new Error(`Hetzner network was not found: ${network}`);
  return match.id;
}

async function createHetznerServer(args) {
  const token = requiredEnv("HCLOUD_TOKEN");
  const name = args.get("name") || "sylion-public-portal-01";
  const serverType = args.get("server-type") || "cx22";
  const image = args.get("image") || "ubuntu-24.04";
  const location = args.get("location") || "fsn1";
  const sshKeyName = args.get("ssh-key-name") || "sylion-public-portal-deploy";
  const sshPublicKey = args.get("ssh-public-key") || ".deploy/sylion_hetzner_admin_ed25519.pub";
  const sshKey = await ensureSshKey({ token, name: sshKeyName, publicKeyPath: sshPublicKey });
  const networkId = await resolveNetworkId({ token, network: args.get("network") || args.get("network-id") || "" });
  const createBody = {
    name,
    server_type: serverType,
    image,
    location,
    ssh_keys: [sshKey.id],
    labels: {
      app: "sylion-public-portal",
      zone: "public-edge"
    },
    start_after_create: true
  };
  if (networkId) createBody.networks = [networkId];
  const created = await hcloud("/servers", {
    method: "POST",
    token,
    body: createBody
  });
  const serverId = created.server.id;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const current = await hcloud(`/servers/${serverId}`, { token });
    const ip = current.server?.public_net?.ipv4?.ip;
    if (ip && current.server.status === "running") {
      const privateIps = current.server.private_net?.map((net) => net.ip).filter(Boolean) || [];
      return { id: serverId, ip, privateIps };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 5000));
  }
  throw new Error("Hetzner server did not become running in time");
}

async function createDeploymentTar(tmp) {
  const tarPath = join(tmp, "sylion-public-portal.tar");
  run("tar", [
    "-cf",
    tarPath,
    "apps/customer-portal",
    "services/public-portal",
    "package.json"
  ]);
  return tarPath;
}

async function writePortalEnv(tmp, { controlPlaneBaseUrl, publicOrigin }) {
  const envPath = join(tmp, "public-portal.env");
  const secret = requiredEnv("SYLION_PUBLIC_PORTAL_SHARED_SECRET");
  const lines = [
    "NODE_ENV=production",
    "HOST=127.0.0.1",
    "PORT=8088",
    `SYLION_CONTROL_PLANE_BASE_URL=${controlPlaneBaseUrl}`,
    `SYLION_PUBLIC_PORTAL_SHARED_SECRET=${secret}`
  ];
  if (publicOrigin) lines.push(`SYLION_PUBLIC_PORTAL_ORIGIN=${publicOrigin}`);
  await writeFile(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  return envPath;
}

function ssh(host, key, command) {
  return run("ssh", [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-i", key,
    `root@${host}`,
    command
  ]);
}

function scp(host, key, localPath, remotePath) {
  run("scp", [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-i", key,
    localPath,
    `root@${host}:${remotePath}`
  ]);
}

async function waitForSsh(host, key) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync("ssh", [
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ConnectTimeout=5",
      "-i", key,
      `root@${host}`,
      "true"
    ], { stdio: "ignore", shell: false });
    if (result.status === 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 5000));
  }
  throw new Error(`SSH did not become ready on ${host}`);
}

function installRemotePortal(host, key) {
  const remoteScript = String.raw`
set -euo pipefail
install -d -m 0755 /opt/sylion-public-portal /etc/sylion
tar -xf /tmp/sylion-public-portal.tar -C /opt/sylion-public-portal
install -m 0600 /tmp/public-portal.env /etc/sylion/public-portal.env
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs nginx ca-certificates ufw curl
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
cat >/etc/systemd/system/sylion-public-portal.service <<'UNIT'
[Unit]
Description=SYLION Public Customer Portal
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sylion-public-portal
EnvironmentFile=/etc/sylion/public-portal.env
ExecStart=/usr/bin/node services/public-portal/src/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT
cat >/etc/nginx/sites-available/sylion-public-portal <<'NGINX'
server {
  listen 80 default_server;
  server_name _;

  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;

  location / {
    proxy_pass http://127.0.0.1:8088;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
NGINX
ln -sf /etc/nginx/sites-available/sylion-public-portal /etc/nginx/sites-enabled/sylion-public-portal
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl daemon-reload
systemctl enable --now sylion-public-portal
systemctl restart sylion-public-portal
systemctl reload nginx
curl -fsS http://127.0.0.1:8088/health >/dev/null
`;
  ssh(host, key, remoteScript);
}

async function installAdminPortalSecret({ adminHost, adminKey, portalPrivateIp = "" }) {
  if (!adminHost) return;
  const tmp = await mkdtemp(join(tmpdir(), "sylion-admin-portal-secret-"));
  try {
    const secret = requiredEnv("SYLION_PUBLIC_PORTAL_SHARED_SECRET");
    const envPath = join(tmp, "50-public-portal-secret.conf");
    await writeFile(envPath, `[Service]\nEnvironment=\"SYLION_PUBLIC_PORTAL_SHARED_SECRET=${secret}\"\n`, { mode: 0o600 });
    scp(adminHost, adminKey, envPath, "/tmp/50-public-portal-secret.conf");
    const firewall = portalPrivateIp
      ? `; ufw allow from ${portalPrivateIp} to any port 8080 proto tcp comment 'SYLION public portal edge to private admin portal-api' || true`
      : "";
    ssh(adminHost, adminKey, `set -e; install -m 0600 /tmp/50-public-portal-secret.conf /etc/systemd/system/sylion-admin-api.service.d/50-public-portal-secret.conf; rm -f /tmp/50-public-portal-secret.conf${firewall}; systemctl daemon-reload; systemctl restart sylion-admin-api; sleep 2; systemctl is-active sylion-admin-api >/dev/null`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = args.get("key") || ".deploy/sylion_hetzner_admin_ed25519";
  const controlPlaneBaseUrl = args.get("control-plane") || process.env.SYLION_CONTROL_PLANE_BASE_URL || "http://10.42.0.10:8080";
  const publicOrigin = args.get("public-origin") || process.env.SYLION_PUBLIC_PORTAL_ORIGIN || "";
  const adminHost = args.get("admin-host") || "";
  const adminKey = args.get("admin-key") || key;
  let host = args.get("host") || "";
  let portalPrivateIp = args.get("portal-private-ip") || "";
  if (args.get("create-hetzner") === "true") {
    const created = await createHetznerServer(args);
    host = created.ip;
    portalPrivateIp = portalPrivateIp || created.privateIps?.[0] || "";
  }
  if (!host) throw new Error("Provide --host=<ip> or --create-hetzner");
  await waitForSsh(host, key);
  const tmp = await mkdtemp(join(tmpdir(), "sylion-public-portal-"));
  try {
    const tarPath = await createDeploymentTar(tmp);
    const envPath = await writePortalEnv(tmp, { controlPlaneBaseUrl, publicOrigin });
    scp(host, key, tarPath, "/tmp/sylion-public-portal.tar");
    scp(host, key, envPath, "/tmp/public-portal.env");
    installRemotePortal(host, key);
    await installAdminPortalSecret({ adminHost, adminKey, portalPrivateIp });
    console.log(JSON.stringify({
      status: "ok",
      service: "sylion-public-portal",
      host,
      controlPlaneBaseUrl,
      secretPrinted: false
    }));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
