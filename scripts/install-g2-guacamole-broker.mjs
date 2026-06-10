import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSshKey =
  process.platform === "win32"
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
    extensionsDir: "/opt/sylion-guacamole/extensions",
    jsonAuthArchiveUrl:
      "https://archive.apache.org/dist/guacamole/1.6.0/binary/guacamole-auth-json-1.6.0.tar.gz",
    jsonAuthJar: "/opt/sylion-guacamole/extensions/guacamole-auth-json-1.6.0.jar",
    guacdTlsDir: "/opt/sylion-guacamole/tls",
    guacdTlsCertificate: "/opt/sylion-guacamole/tls/guacd.crt",
    guacdTlsKey: "/opt/sylion-guacamole/tls/guacd.key",
    guacdTrustDir: "/opt/sylion-guacamole/trust",
    guacdTrustStore: "/opt/sylion-guacamole/trust/guacd-truststore.p12",
    publicDir: "/opt/sylion-guacamole/public",
    bindLocalPort: 8081,
    postgresVolume: "sylion-guacamole-postgres",
    guacamoleImage: "guacamole/guacamole:1.6.0",
    guacdImage: "guacamole/guacd:1.6.0",
    postgresImage: "postgres:16-alpine"
  },
  workloadSources: [
    {
      key: "signal",
      protocol: "vnc",
      host: "10.44.0.13",
      port: 3013,
      labAdapter: "novnc_source_until_vnc_direct_seed"
    },
    {
      key: "duckduckgo_browser",
      protocol: "vnc",
      host: "10.44.0.13",
      port: 3001,
      labAdapter: "novnc_source_until_vnc_direct_seed"
    },
    {
      key: "libreoffice",
      protocol: "vnc",
      host: "10.44.0.13",
      port: 3002,
      labAdapter: "novnc_source_until_vnc_direct_seed"
    }
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
    guacdPlaintextForbidden: true,
    guacamoleTrustsGuacdCertificate: true,
    jsonAuthHandoffEnabled: true,
    jsonAuthSecretPrinted: false
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
      - -l
      - "4822"
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
      JSON_SECRET_KEY: \${GUACAMOLE_JSON_SECRET_KEY}
      JAVA_OPTS: "-Djavax.net.ssl.trustStore=/etc/guacamole/trust/guacd-truststore.p12 -Djavax.net.ssl.trustStoreType=PKCS12 -Djavax.net.ssl.trustStorePassword=changeit"
      POSTGRESQL_HOSTNAME: postgres
      POSTGRESQL_DATABASE: guacamole_db
      POSTGRESQL_USER: guacamole_user
      POSTGRESQL_PASSWORD: \${GUACAMOLE_POSTGRES_PASSWORD}
    volumes:
      - ${runtime.extensionsDir}:/etc/guacamole/extensions:ro
      - ${runtime.guacdTrustDir}:/etc/guacamole/trust:ro
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

  location = /sylion-launch.html {
    root ${runtime.publicDir};
    default_type text/html;
    try_files /sylion-launch.html =404;
    add_header Cache-Control "no-store" always;
    add_header Content-Security-Policy "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://operator.sylion.internal" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Sylion-Session-Launch-Shim "guacamole_state_reset" always;
  }

  location = /sylion-launch.js {
    root ${runtime.publicDir};
    default_type application/javascript;
    try_files /sylion-launch.js =404;
    add_header Cache-Control "no-store" always;
    add_header Content-Security-Policy "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://operator.sylion.internal" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Sylion-Session-Launch-Shim "guacamole_state_reset" always;
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

function renderLaunchShimHtml() {
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Referrer-Policy" content="no-referrer">
  <meta http-equiv="X-Content-Type-Options" content="nosniff">
  <title>SYLION Session Launch</title>
</head>
<body>
  <p id="status">Starting SYLION workload session...</p>
  <script src="/sylion-launch.js"></script>
</body>
</html>
`;
}

function renderLaunchShimJs() {
  return `"use strict";

(function () {
  const status = document.getElementById("status");

  function fail(message) {
    if (status) status.textContent = message;
  }

  function resetGuacamoleBrowserState() {
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key && key.startsWith("GUAC_")) localStorage.removeItem(key);
      }
    } catch {
      // Browser state reset is best-effort; the target route still validates the handoff.
    }
    try {
      sessionStorage.clear();
    } catch {
      // Session storage can be unavailable in restricted browser modes.
    }
  }

  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  const params = new URLSearchParams(hash);
  const client = params.get("client");
  const data = params.get("data");
  if (!client || !/^[A-Za-z0-9_-]+$/.test(client) || !data || /[\\r\\n]/.test(data)) {
    fail("Invalid SYLION workload launch target.");
    return;
  }

  async function launch() {
    resetGuacamoleBrowserState();
    const body = new URLSearchParams();
    body.set("data", data);
    const response = await fetch("/guacamole/api/tokens", {
      method: "POST",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body
    });
    if (!response.ok) {
      throw new Error("guacamole_json_auth_failed");
    }
    const payload = await response.json();
    const token = String(payload?.authToken || "");
    if (!token) {
      throw new Error("guacamole_token_missing");
    }
    window.history.replaceState(null, "", "/sylion-launch.html#launching");
    window.location.replace(\`/guacamole/#/client/\${encodeURIComponent(client)}?token=\${encodeURIComponent(token)}\`);
  }

  launch().catch(() => fail("SYLION workload session launch failed."));
})();
`;
}

export function publicPlan(input = plan) {
  return {
    ...input,
    runtime: {
      ...input.runtime,
      envPath: input.runtime.envPath,
      postgresPasswordPrinted: false,
      jsonAuthSecretPrinted: false
    }
  };
}

export { renderCompose, renderNginx, renderLaunchShimHtml, renderLaunchShimJs };

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
  const launchHtmlPath = join(tempDir, "sylion-launch.html");
  const launchJsPath = join(tempDir, "sylion-launch.js");
  await mkdir(tempDir, { recursive: true });
  await writeFile(composePath, renderCompose(input), "utf8");
  await writeFile(nginxPath, renderNginx(input), "utf8");
  await writeFile(launchHtmlPath, renderLaunchShimHtml(input), "utf8");
  await writeFile(launchJsPath, renderLaunchShimJs(input), "utf8");

  await run(
    "scp",
    [
      "-i",
      sshKey,
      "-o",
      "StrictHostKeyChecking=accept-new",
      composePath,
      nginxPath,
      launchHtmlPath,
      launchJsPath,
      `${input.gateway.host}:/tmp/`
    ],
    { timeout: 90_000 }
  );

  const remoteScript = `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update >/dev/null
sudo apt-get install -y ca-certificates curl gnupg docker.io nginx openssl tar >/dev/null
if sudo docker compose version >/dev/null 2>&1; then
  compose_cmd="sudo docker compose"
else
  sudo apt-get install -y docker-compose >/dev/null
  compose_cmd="sudo docker-compose"
fi
sudo mkdir -p ${input.runtime.baseDir}/init ${input.runtime.guacdTlsDir} ${input.runtime.extensionsDir} ${input.runtime.guacdTrustDir} ${input.runtime.publicDir} /etc/sylion
if [ ! -f ${input.runtime.envPath} ]; then
  umask 077
  printf 'GUACAMOLE_POSTGRES_PASSWORD=%s\\n' "$(openssl rand -hex 32)" | sudo tee ${input.runtime.envPath} >/dev/null
fi
if ! sudo grep -q '^GUACAMOLE_JSON_SECRET_KEY=' ${input.runtime.envPath}; then
  umask 077
  printf 'GUACAMOLE_JSON_SECRET_KEY=%s\\n' "$(openssl rand -hex 16)" | sudo tee -a ${input.runtime.envPath} >/dev/null
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
sudo chown 1000:1000 ${input.runtime.guacdTlsKey}
sudo chmod 0400 ${input.runtime.guacdTlsKey}
sudo chown root:root ${input.runtime.guacdTlsCertificate}
sudo chmod 0644 ${input.runtime.guacdTlsCertificate}
if [ ! -s ${input.runtime.jsonAuthJar} ]; then
  auth_tmp="$(mktemp -d)"
  curl -fsSL ${shellQuote(input.runtime.jsonAuthArchiveUrl)} -o "$auth_tmp/auth-json.tar.gz"
  tar -xzf "$auth_tmp/auth-json.tar.gz" -C "$auth_tmp"
  auth_jar="$(find "$auth_tmp" -name 'guacamole-auth-json-*.jar' -type f | head -n 1)"
  if [ -z "$auth_jar" ]; then
    echo "guacamole_auth_json_jar_not_found" >&2
    exit 1
  fi
  sudo install -o root -g root -m 0644 "$auth_jar" ${input.runtime.jsonAuthJar}
  rm -rf "$auth_tmp"
fi
sudo install -o root -g root -m 0600 /tmp/docker-compose.yml ${input.runtime.composePath}
sudo install -o root -g root -m 0644 /tmp/sylion-launch.html ${input.runtime.publicDir}/sylion-launch.html
sudo install -o root -g root -m 0644 /tmp/sylion-launch.js ${input.runtime.publicDir}/sylion-launch.js
if [ ! -s ${input.runtime.baseDir}/init/001-initdb.sql ]; then
  sudo docker run --rm ${input.runtime.guacamoleImage} /opt/guacamole/bin/initdb.sh --postgresql | sudo tee ${input.runtime.baseDir}/init/001-initdb.sql >/dev/null
fi
sudo install -o root -g root -m 0644 /tmp/sylion-g2-guacamole-broker ${input.gateway.nginxConfigPath}
sudo ln -sf ${input.gateway.nginxConfigPath} /etc/nginx/sites-enabled/sylion-g2-guacamole-broker
cd ${input.runtime.baseDir}
$compose_cmd --env-file ${input.runtime.envPath} pull >/dev/null
sudo rm -f ${input.runtime.guacdTrustStore}
sudo docker run --rm --user 0:0 --entrypoint keytool \
  -v ${input.runtime.guacdTlsDir}:/tls:ro \
  -v ${input.runtime.guacdTrustDir}:/trust \
  ${input.runtime.guacamoleImage} \
  -importcert -noprompt \
  -alias sylion-g2-guacd \
  -file /tls/guacd.crt \
  -keystore /trust/guacd-truststore.p12 \
  -storetype PKCS12 \
  -storepass changeit >/dev/null
sudo chown root:root ${input.runtime.guacdTrustStore}
sudo chmod 0644 ${input.runtime.guacdTrustStore}
if ! $compose_cmd --env-file ${input.runtime.envPath} up -d --remove-orphans >/dev/null; then
  # docker-compose v1 can fail to recreate containers created from newer image metadata.
  # Down removes containers/networks, but preserves the named Postgres volume by default.
  $compose_cmd --env-file ${input.runtime.envPath} down --remove-orphans >/dev/null || true
  $compose_cmd --env-file ${input.runtime.envPath} up -d --remove-orphans >/dev/null
fi
postgres_password="$(sudo awk -F= '/^GUACAMOLE_POSTGRES_PASSWORD=/{print substr($0, index($0,$2)); exit}' ${input.runtime.envPath})"
if [ -n "$postgres_password" ]; then
  $compose_cmd --env-file ${input.runtime.envPath} exec -T postgres psql -v ON_ERROR_STOP=1 -U guacamole_user -d guacamole_db -v guac_password="$postgres_password" <<'SQL' >/dev/null
ALTER USER guacamole_user WITH PASSWORD :'guac_password';
SQL
  $compose_cmd --env-file ${input.runtime.envPath} restart guacamole >/dev/null
fi
sudo nginx -t
sudo systemctl reload nginx
sleep 8
guac_code="$(curl -k -sS -o /tmp/sylion-guacamole-health.html -w "%{http_code}" --resolve ${input.gateway.serverName}:443:${input.gateway.bindAddress} https://${input.gateway.serverName}/guacamole/ || true)"
sudo ss -ltnp | grep '${input.gateway.bindAddress}:443' >/dev/null
printf '{"component":"g2_guacamole_session_broker","deployed":true,"httpStatus":%s,"serverName":"%s","privateBind":"%s","guacdSsl":true,"guacamoleToGuacdTransport":"tls","jsonAuthHandoffEnabled":true,"secretsPrinted":false,"terminalDataStored":false,"productionExecutionAllowed":false}\\n' "$guac_code" "${input.gateway.serverName}" "${input.gateway.bindAddress}"
`;
  const encoded = Buffer.from(remoteScript, "utf8").toString("base64");
  const result = await run(
    "ssh",
    [
      "-i",
      sshKey,
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      input.gateway.host,
      `printf %s ${shellQuote(encoded)} | base64 -d | bash`
    ],
    { timeout: 1_200_000 }
  );
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
  if (args.has("--render-launch-shim")) {
    console.log(renderLaunchShimHtml());
    console.log(renderLaunchShimJs());
    return;
  }
  if (args.has("--deploy")) {
    await deploy();
    return;
  }
  console.error(
    "Usage: node scripts/install-g2-guacamole-broker.mjs --print-plan|--render-compose|--render-nginx|--render-launch-shim|--deploy"
  );
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
