import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const apps = [
  {
    key: "duckduckgo",
    serverName: "duckduckgo.sylion.internal",
    upstreamScheme: "http",
    upstreamPort: 3001,
    noVnc: true,
    authInclude: "/etc/nginx/snippets/sylion-kasm-auth-duckduckgo.conf"
  },
  {
    key: "libreoffice",
    serverName: "libreoffice.sylion.internal",
    upstreamScheme: "http",
    upstreamPort: 3002,
    noVnc: true,
    authInclude: "/etc/nginx/snippets/sylion-kasm-auth-libreoffice.conf"
  },
  {
    key: "whatsapp",
    serverName: "whatsapp.sylion.internal",
    upstreamScheme: "http",
    upstreamPort: 3010,
    noVnc: true,
    authInclude: "/etc/nginx/snippets/sylion-kasm-auth-whatsapp.conf"
  },
  {
    key: "telegram",
    serverName: "telegram.sylion.internal",
    upstreamScheme: "http",
    upstreamPort: 3011,
    noVnc: true,
    authInclude: "/etc/nginx/snippets/sylion-kasm-auth-telegram.conf"
  },
  {
    key: "threema",
    serverName: "threema.sylion.internal",
    upstreamScheme: "http",
    upstreamPort: 3012,
    noVnc: true,
    authInclude: "/etc/nginx/snippets/sylion-kasm-auth-threema.conf"
  },
  {
    key: "signal",
    serverName: "signal.sylion.internal",
    upstreamScheme: "http",
    upstreamPort: 3013,
    noVnc: true,
    authInclude: "/etc/nginx/snippets/sylion-kasm-auth-signal.conf"
  },
  {
    key: "zangi",
    serverName: "zangi.sylion.internal",
    upstreamScheme: "http",
    upstreamPort: 3014,
    noVnc: true,
    productionGate: "android_native_apk_provenance_required"
  },
  {
    key: "exodus",
    serverName: "exodus.sylion.internal",
    upstreamScheme: "http",
    upstreamPort: 3015,
    noVnc: true,
    authInclude: "/etc/nginx/snippets/sylion-kasm-auth-exodus.conf"
  }
];

const defaultPlan = {
  step: "3.42",
  component: "g2_workload_gateway",
  gateway: {
    host: process.env.SYLION_G2_SSH || "sylion@178.105.203.31",
    bindAddress: process.env.SYLION_G2_BIND || "10.42.0.12",
    tlsCertificate: "/etc/sylion/tls/sylion-internal-server-chain.crt",
    tlsKey: "/etc/sylion/tls/sylion-internal-server.key",
    configPath: "/etc/nginx/sites-available/sylion-g2-broker",
    extraConfigPath: "/etc/nginx/conf.d/sylion-extra-workloads.conf"
  },
  adminUpstream: process.env.SYLION_ADMIN_UPSTREAM || "http://10.42.0.10:8080",
  workload: {
    bindAddress: process.env.SYLION_WORKLOAD_BIND || "10.44.0.13"
  },
  invariants: {
    privateBindOnly: true,
    noTerminalOperationalData: true,
    noG1G2Bypass: true,
    cdrRequiredForFileTransfer: true,
    noWorkloadSecretsInGeneratedConfig: true,
    signalNativeNoVncUpstream: true
  },
  apps
};

function escapeNginx(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function commonProxyHeaders() {
  return [
    "    proxy_http_version 1.1;",
    "    proxy_read_timeout 3600s;",
    "    proxy_send_timeout 3600s;",
    "    proxy_set_header Host $host;",
    "    proxy_set_header Upgrade $http_upgrade;",
    "    proxy_set_header Connection $connection_upgrade;",
    "    proxy_set_header X-Real-IP $remote_addr;",
    "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "    proxy_set_header X-Forwarded-Proto https;",
    "    add_header Cache-Control \"no-store\" always;",
    "    add_header X-Sylion-Terminal-Data-Stored \"false\" always;",
    "    add_header X-Sylion-G1-G2-Bypass \"false\" always;",
    "    add_header X-Sylion-CDR-Required \"true\" always;",
    "    add_header X-Sylion-Workload-Gateway \"g2\" always;"
  ].join("\n");
}

function renderAdminServer(plan) {
  const { bindAddress, tlsCertificate, tlsKey } = plan.gateway;
  return `server {
  listen ${bindAddress}:443 ssl;
  server_name admin.sylion.internal;
  ssl_certificate ${tlsCertificate};
  ssl_certificate_key ${tlsKey};
  location / {
    proxy_pass ${plan.adminUpstream};
${commonProxyHeaders()}
  }
}

server {
  listen ${bindAddress}:443 ssl;
  server_name operator.sylion.internal;
  ssl_certificate ${tlsCertificate};
  ssl_certificate_key ${tlsKey};
  location = / {
    return 302 /operator;
  }
  location / {
    proxy_pass ${plan.adminUpstream};
${commonProxyHeaders()}
  }
}`;
}

function renderWorkloadServer(plan, app) {
  const { bindAddress, tlsCertificate, tlsKey } = plan.gateway;
  const upstream = `${app.upstreamScheme}://${plan.workload.bindAddress}:${app.upstreamPort}`;
  const authInclude = app.authInclude ? `    include ${app.authInclude};\n` : "";
  const proxySsl = app.proxySslVerify === false ? "    proxy_ssl_verify off;\n" : "";
  const productionGate = app.productionGate
    ? `    add_header X-Sylion-Production-Gate "${escapeNginx(app.productionGate)}" always;\n`
    : "";
  const rootRedirect = app.noVnc
    ? `  location = / {
    return 302 /vnc.html?autoconnect=true&resize=remote&path=websockify;
  }
`
    : "";
  return `server {
  listen ${bindAddress}:443 ssl;
  server_name ${app.serverName};
  ssl_certificate ${tlsCertificate};
  ssl_certificate_key ${tlsKey};
${rootRedirect}  location / {
${authInclude}${proxySsl}${productionGate}    proxy_pass ${upstream};
${commonProxyHeaders()}
  }
}`;
}

export function renderGatewayConfig(plan = defaultPlan) {
  return `map $http_upgrade $connection_upgrade {
  default upgrade;
  '' close;
}

${renderAdminServer(plan)}

${plan.apps.map((app) => renderWorkloadServer(plan, app)).join("\n\n")}
`;
}

export function publicPlan(plan = defaultPlan) {
  return {
    ...plan,
    apps: plan.apps.map((app) => ({
      key: app.key,
      serverName: app.serverName,
      upstream: `${app.upstreamScheme}://${plan.workload.bindAddress}:${app.upstreamPort}`,
      authMode: app.authInclude ? "root_only_nginx_include" : "none",
      noVnc: app.noVnc === true,
      productionGate: app.productionGate || "none"
    }))
  };
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout ?? 60_000,
    windowsHide: true,
    input: options.input
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function deploy(plan) {
  const sshKey = process.env.SYLION_ADMIN_SSH_KEY || ".deploy\\sylion_hetzner_admin_ed25519";
  const tempDir = await mkdtemp(join(tmpdir(), "sylion-g2-gateway-"));
  const configPath = join(tempDir, "sylion-g2-broker");
  await mkdir(tempDir, { recursive: true });
  await writeFile(configPath, renderGatewayConfig(plan), "utf8");

  const remoteTemp = "/tmp/sylion-g2-broker.next";
  await run("scp", ["-i", sshKey, "-o", "StrictHostKeyChecking=accept-new", configPath, `${plan.gateway.host}:${remoteTemp}`], { timeout: 60_000 });
  const authIncludes = plan.apps
    .filter((app) => app.authInclude)
    .map((app) => app.authInclude);
  const ensureAuthSnippets = authIncludes.map((path) => `
if [ ! -f ${path} ]; then
  sudo install -o root -g root -m 0600 /dev/null ${path}
  echo '# Populated by SYLION KasmVNC auth handoff. Do not store workload passwords in generated config.' | sudo tee ${path} >/dev/null
fi
sudo chmod 0600 ${path}
`).join("\n");
  const remoteScript = `
set -euo pipefail
sudo install -o root -g root -m 0600 /dev/null /etc/nginx/snippets/sylion-signal-auth.conf
echo '# Legacy Signal auth snippet retained for migration; KasmVNC handoff uses per-app snippets.' | sudo tee /etc/nginx/snippets/sylion-signal-auth.conf >/dev/null
sudo chmod 0600 /etc/nginx/snippets/sylion-signal-auth.conf
${ensureAuthSnippets}
sudo install -o root -g root -m 0644 ${remoteTemp} ${plan.gateway.configPath}
sudo install -o root -g root -m 0644 /dev/null ${plan.gateway.extraConfigPath}
sudo nginx -t
sudo systemctl reload nginx
sudo ss -ltnp | grep '${plan.gateway.bindAddress}:443'
`;
  const result = await run("ssh", ["-i", sshKey, "-o", "StrictHostKeyChecking=accept-new", plan.gateway.host, remoteScript], { timeout: 60_000 });
  console.log(JSON.stringify({
    deployed: true,
    gatewayHost: plan.gateway.host,
    configPath: plan.gateway.configPath,
    privateBind: plan.gateway.bindAddress,
    nginx: result.stdout,
    invariants: plan.invariants
  }, null, 2));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--print-plan")) {
    console.log(JSON.stringify(publicPlan(), null, 2));
    return;
  }
  if (args.has("--render-nginx")) {
    console.log(renderGatewayConfig());
    return;
  }
  if (args.has("--deploy")) {
    await deploy(defaultPlan);
    return;
  }
  console.error("Usage: node scripts/install-g2-workload-gateway.mjs --print-plan|--render-nginx|--deploy");
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
