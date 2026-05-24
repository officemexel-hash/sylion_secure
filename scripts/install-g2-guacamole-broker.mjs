import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";

const plan = {
  step: "3.79",
  component: "g2_guacamole_session_broker",
  version: "1.6.0",
  gateway: {
    host: process.env.SYLION_G2_SSH || "sylion@178.105.203.31",
    bindAddress: process.env.SYLION_G2_BIND || "10.42.0.12",
    serverName: process.env.SYLION_GUACAMOLE_SERVER_NAME || "session.sylion.internal",
    tlsCertificate: "/etc/sylion/tls/sylion-internal-server-chain.crt",
    tlsKey: "/etc/sylion/tls/sylion-internal-server.key",
    nginxConfigPath: "/etc/nginx/sites-available/sylion-g2-guacamole-broker"
  },
  runtime: {
    baseDir: "/opt/sylion-guacamole",
    composePath: "/opt/sylion-guacamole/docker-compose.yml",
    envPath: "/etc/sylion/guacamole.env",
    guacdTlsDir: "/opt/sylion-guacamole/tls",
    guacdTlsCertificate: "/opt/sylion-guacamole/tls/guacd.crt",
    guacdTlsKey: "/opt/sylion-guacamole/tls/guacd.key",
    bindLocalPort: 8081,
    postgresVolume: "sylion-guacamole-postgres",
    guacamoleImage: "guacamole/guacamole:1.6.0",
    guacdImage: "guacamole/guacd:1.6.0",
    postgresImage: "postgres:16-alpine"
  },
  workloadSources: [
    { key: "signal", protocol: "vnc", host: "10.44.0.13", port: 3013, labAdapter: "novnc_source_until_vnc_direct_seed" },
    { key: "duckduckgo_browser", protocol: "vnc", host: "10.44.0.13", port: 3001, labAdapter: "novnc_source_until_vnc_direct_seed" },
    { key: "libreoffice", protocol: "vnc", host: "10.44.0.13", port: 3002, labAdapter: "novnc_source_until_vnc_direct_seed" }
  ],
  invariants: {
    g2Only: true,
    privateBindOnly: true,
    publicInternetExposure: false,
    terminalDataStored: false,
    clipboardDefault: "disabled",
    fileTransfer: "disabled_until_cdr_gate",
    noEmbeddedWorkloadSecrets: true,
    noVncProductionApproved: false,
    guacamoleToGuacdTransport: "tls",
    guacdPlaintextForbidden: true
  }
};

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function renderCompose(input = plan) {
  const { runtime } = input;
  return `services:
  postgres:
    image: ${runtime.postgresImage}
    restart: unless-stopped
    environment:
      POSTGRES_DB: guacamole_db
      POSTGRES_USER: guacamole_user
      POSTGRES_PASSWORD: \${GUACAMOLE_POSTGRES_PASSWORD}
    volumes:
      - ${runtime.postgresVolume}:/var/lib/postgresql/data
      - ./init:/docker-entrypoint-initdb.d:ro
    networks:
      - sylion-guacamole

  guacd:
    image: ${runtime.guacdImage}
    restart: unless-stopped
    command:
      - /usr/local/sbin/guacd
      - -f
      - -b
      - 0.0.0.0
      - -l
      - "4822"
      - -L
      - info
      - -C
      - /etc/guacamole/tls/guacd.crt
      - -K
      - /etc/guacamole/tls/guacd.key
    volumes:
      - ${runtime.guacdTlsDir}:/etc/guacamole/tls:ro
    networks:
      - sylion-guacamole

  guacamole:
    image: ${runtime.guacamoleImage}
    restart: unless-stopped
    depends_on:
      - postgres
      - guacd
    environment:
      GUACD_HOSTNAME: guacd
      GUACD_SSL: "true"
      POSTGRESQL_HOSTNAME: postgres
      POSTGRESQL_DATABASE: guacamole_db
      POSTGRESQL_USER: guacamole_user
      POSTGRESQL_PASSWORD: \${GUACAMOLE_POSTGRES_PASSWORD}
    ports:
      - "127.0.0.1:${runtime.bindLocalPort}:8080"
    networks:
      - sylion-guacamole

networks:
  sylion-guacamole:
    driver: bridge

volumes:
  ${runtime.postgresVolume}:
`;
}

function renderNginx(input = plan) {
  const { gateway, runtime } = input;
  return `map $http_upgrade $sylion_guac_connection_upgrade {
  default upgrade;
  '' close;
}

server {
  listen ${gateway.bindAddress}:443 ssl default_server;
  server_name ${gateway.serverName} ${gateway.bindAddress};
  ssl_certificate ${gateway.tlsCertificate};
  ssl_certificate_key ${gateway.tlsKey};
  client_max_body_size 1m;

  location = / {
    return 302 /guacamole/;
  }

  location /guacamole/ {
    proxy_pass http://127.0.0.1:${runtime.bindLocalPort}/guacamole/;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $sylion_guac_connection_upgrade;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    add_header Cache-Control "no-store" always;
    add_header X-Sylion-Session-Broker "guacamole" always;
    add_header X-Sylion-Guacd-Transport "tls" always;
    add_header X-Sylion-Terminal-Data-Stored "false" always;
    add_header X-Sylion-CDR-Required "true" always;
    add_header X-Sylion-G1-G2-Bypass "false" always;
    add_header X-Sylion-File-Transfer "disabled_until_cdr_gate" always;
    add_header X-Sylion-Clipboard "disabled_by_policy" always;
  }
}
`;
}

export function publicPlan(input = plan) {
  return {
    ...input,
    runtime: {
      ...input.runtime,
      envPath: input.runtime.envPath,
      postgresPasswordPrinted: false
    }
  };
}

export { renderCompose, renderNginx };

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout ?? 60_000,
    windowsHide: true,
    input: options.input
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function deploy(input = plan) {
  const sshKey = process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey;
  const tempDir = await mkdtemp(join(tmpdir(), "sylion-guacamole-"));
  const composePath = join(tempDir, "docker-compose.yml");
  const nginxPath = join(tempDir, "sylion-g2-guacamole-broker");
  await mkdir(tempDir, { recursive: true });
  await writeFile(composePath, renderCompose(input), "utf8");
  await writeFile(nginxPath, renderNginx(input), "utf8");

  await run("scp", [
    "-i", sshKey,
    "-o", "StrictHostKeyChecking=accept-new",
    composePath,
    nginxPath,
    `${input.gateway.host}:/tmp/`
  ], { timeout: 90_000 });

  const remoteScript = `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update >/dev/null
sudo apt-get install -y ca-certificates curl gnupg docker.io nginx openssl >/dev/null
if sudo docker compose version >/dev/null 2>&1; then
  compose_cmd="sudo docker compose"
else
  sudo apt-get install -y docker-compose >/dev/null
  compose_cmd="sudo docker-compose"
fi
sudo mkdir -p ${input.runtime.baseDir}/init ${input.runtime.guacdTlsDir} /etc/sylion
if [ ! -f ${input.runtime.envPath} ]; then
  umask 077
  printf 'GUACAMOLE_POSTGRES_PASSWORD=%s\\n' "$(openssl rand -hex 32)" | sudo tee ${input.runtime.envPath} >/dev/null
fi
if [ ! -s ${input.runtime.guacdTlsCertificate} ] || [ ! -s ${input.runtime.guacdTlsKey} ]; then
  tmp_key="$(mktemp)"
  tmp_crt="$(mktemp)"
  openssl req -x509 -newkey rsa:3072 -nodes -sha384 -days 90 \
    -subj "/CN=sylion-g2-guacd.internal" \
    -keyout "$tmp_key" \
    -out "$tmp_crt" >/dev/null 2>&1
  sudo install -o root -g root -m 0600 "$tmp_key" ${input.runtime.guacdTlsKey}
  sudo install -o root -g root -m 0644 "$tmp_crt" ${input.runtime.guacdTlsCertificate}
  rm -f "$tmp_key" "$tmp_crt"
fi
sudo install -o root -g root -m 0600 /tmp/docker-compose.yml ${input.runtime.composePath}
if [ ! -s ${input.runtime.baseDir}/init/001-initdb.sql ]; then
  sudo docker run --rm ${input.runtime.guacamoleImage} /opt/guacamole/bin/initdb.sh --postgresql | sudo tee ${input.runtime.baseDir}/init/001-initdb.sql >/dev/null
fi
sudo install -o root -g root -m 0644 /tmp/sylion-g2-guacamole-broker ${input.gateway.nginxConfigPath}
sudo ln -sf ${input.gateway.nginxConfigPath} /etc/nginx/sites-enabled/sylion-g2-guacamole-broker
cd ${input.runtime.baseDir}
$compose_cmd --env-file ${input.runtime.envPath} pull >/dev/null
if ! $compose_cmd --env-file ${input.runtime.envPath} up -d --remove-orphans >/dev/null; then
  # docker-compose v1 can fail to recreate containers created from newer image metadata.
  # Down removes containers/networks, but preserves the named Postgres volume by default.
  $compose_cmd --env-file ${input.runtime.envPath} down --remove-orphans >/dev/null || true
  $compose_cmd --env-file ${input.runtime.envPath} up -d --remove-orphans >/dev/null
fi
sudo nginx -t
sudo systemctl reload nginx
sleep 8
guac_code="$(curl -k -sS -o /tmp/sylion-guacamole-health.html -w "%{http_code}" --resolve ${input.gateway.serverName}:443:${input.gateway.bindAddress} https://${input.gateway.serverName}/guacamole/ || true)"
sudo ss -ltnp | grep '${input.gateway.bindAddress}:443' >/dev/null
printf '{"component":"g2_guacamole_session_broker","deployed":true,"httpStatus":%s,"serverName":"%s","privateBind":"%s","guacdSsl":true,"guacamoleToGuacdTransport":"tls","secretsPrinted":false,"terminalDataStored":false,"productionExecutionAllowed":false}\\n' "$guac_code" "${input.gateway.serverName}" "${input.gateway.bindAddress}"
`;
  const encoded = Buffer.from(remoteScript, "utf8").toString("base64");
  const result = await run("ssh", [
    "-i", sshKey,
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    input.gateway.host,
    `printf %s ${shellQuote(encoded)} | base64 -d | bash`
  ], { timeout: 1_200_000 });
  console.log(result.stdout);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--print-plan")) {
    console.log(JSON.stringify(publicPlan(), null, 2));
    return;
  }
  if (args.has("--render-compose")) {
    console.log(renderCompose());
    return;
  }
  if (args.has("--render-nginx")) {
    console.log(renderNginx());
    return;
  }
  if (args.has("--deploy")) {
    await deploy();
    return;
  }
  console.error("Usage: node scripts/install-g2-guacamole-broker.mjs --print-plan|--render-compose|--render-nginx|--deploy");
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
