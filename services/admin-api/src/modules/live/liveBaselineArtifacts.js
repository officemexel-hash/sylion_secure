const DEFAULT_GATEWAY_BIND = "10.42.0.12";
const DEFAULT_ADMIN_UPSTREAM = "http://10.42.0.10:8080";
const DEFAULT_WORKLOAD_BIND = "10.42.0.13";

const WORKLOAD_APPS = Object.freeze([
  { key: "duckduckgo", host: "duckduckgo.sylion.internal", scheme: "http", port: 3001 },
  { key: "libreoffice", host: "libreoffice.sylion.internal", scheme: "http", port: 3002 },
  { key: "whatsapp", host: "whatsapp.sylion.internal", scheme: "http", port: 3010 },
  { key: "telegram", host: "telegram.sylion.internal", scheme: "http", port: 3011 },
  { key: "threema", host: "threema.sylion.internal", scheme: "http", port: 3012 },
  { key: "signal", host: "signal.sylion.internal", scheme: "https", port: 3013, authSnippet: true, proxySslVerify: false },
  { key: "zangi", host: "zangi.sylion.internal", scheme: "http", port: 3014, productionGate: "android_native_runner_required" },
  { key: "exodus", host: "exodus.sylion.internal", scheme: "http", port: 3015, productionGate: "isolated_wallet_runtime_required" }
]);

function yamlBlock(value, indent = "      ") {
  return String(value)
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
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

export function renderG2GatewayNginx({
  gatewayBind = DEFAULT_GATEWAY_BIND,
  adminUpstream = DEFAULT_ADMIN_UPSTREAM,
  workloadBind = DEFAULT_WORKLOAD_BIND,
  tlsCertificate = "/etc/sylion/tls/sylion-internal.crt",
  tlsKey = "/etc/sylion/tls/sylion-internal.key"
} = {}) {
  const admin = `server {
  listen ${gatewayBind}:443 ssl;
  server_name admin.sylion.internal operator.sylion.internal;
  ssl_certificate ${tlsCertificate};
  ssl_certificate_key ${tlsKey};
  location / {
    proxy_pass ${adminUpstream};
${commonProxyHeaders()}
  }
}`;
  const workloads = WORKLOAD_APPS.map((app) => {
    const auth = app.authSnippet ? "    include /etc/nginx/snippets/sylion-signal-auth.conf;\n" : "";
    const proxySsl = app.proxySslVerify === false ? "    proxy_ssl_verify off;\n" : "";
    const gate = app.productionGate ? `    add_header X-Sylion-Production-Gate "${app.productionGate}" always;\n` : "";
    return `server {
  listen ${gatewayBind}:443 ssl;
  server_name ${app.host};
  ssl_certificate ${tlsCertificate};
  ssl_certificate_key ${tlsKey};
  location / {
${auth}${proxySsl}${gate}    proxy_pass ${app.scheme}://${workloadBind}:${app.port};
${commonProxyHeaders()}
  }
}`;
  }).join("\n\n");
  return `map $http_upgrade $connection_upgrade {
  default upgrade;
  '' close;
}

${admin}

${workloads}
`;
}

export function renderG2GatewayCloudInit(options = {}) {
  const nginxConfig = renderG2GatewayNginx(options);
  return `#cloud-config
package_update: true
package_upgrade: false
packages:
  - curl
  - ca-certificates
  - nftables
  - nginx
  - openssl
write_files:
  - path: /etc/sylion-role
    permissions: "0644"
    content: "G2"
  - path: /etc/sylion/gateway-runtime.json
    permissions: "0644"
    content: |
${yamlBlock(JSON.stringify({
    component: "g2_workload_gateway",
    gatewayBind: options.gatewayBind || DEFAULT_GATEWAY_BIND,
    workloadBind: options.workloadBind || DEFAULT_WORKLOAD_BIND,
    noTerminalOperationalData: true,
    noG1G2Bypass: true,
    cdrRequiredForFileTransfer: true,
    signalAuthMode: "root_only_nginx_include",
    productionExecutionAllowed: false
  }, null, 2))}
  - path: /etc/nginx/sites-available/sylion-g2-broker
    permissions: "0644"
    content: |
${yamlBlock(nginxConfig)}
  - path: /etc/nginx/snippets/sylion-signal-auth.conf
    permissions: "0600"
    content: |
      # Populated by the operator secret handoff flow. Do not store Signal workload passwords in cloud-init.
runcmd:
  - [ bash, -lc, "install -d -m 0755 /etc/sylion/tls" ]
  - [ bash, -lc, "if [ ! -f /etc/sylion/tls/sylion-internal.key ]; then openssl req -x509 -nodes -newkey rsa:3072 -days 30 -subj '/CN=*.sylion.internal' -keyout /etc/sylion/tls/sylion-internal.key -out /etc/sylion/tls/sylion-internal.crt >/dev/null 2>&1; fi" ]
  - [ bash, -lc, "ln -sf /etc/nginx/sites-available/sylion-g2-broker /etc/nginx/sites-enabled/sylion-g2-broker" ]
  - [ bash, -lc, "rm -f /etc/nginx/sites-enabled/default" ]
  - [ bash, -lc, "nginx -t && systemctl enable --now nginx" ]
  - [ bash, -lc, "systemctl enable --now nftables || true" ]
  - [ bash, -lc, "echo 'G2 workload gateway ready at $(date -Is)' > /var/log/sylion-bootstrap.log" ]
`;
}

export function buildLiveBaselineUserData({ userDataByRole = {}, gatewayOptions = {} } = {}) {
  return {
    G1: userDataByRole.G1,
    G2: userDataByRole.G2 || renderG2GatewayCloudInit(gatewayOptions),
    WORKLOAD: userDataByRole.WORKLOAD
  };
}

export function liveBaselineArtifactSummary({ gatewayBind = DEFAULT_GATEWAY_BIND, workloadBind = DEFAULT_WORKLOAD_BIND } = {}) {
  return {
    g2WorkloadGateway: {
      included: true,
      bindAddress: gatewayBind,
      workloadBindAddress: workloadBind,
      hostnames: [
        "admin.sylion.internal",
        "operator.sylion.internal",
        ...WORKLOAD_APPS.map((app) => app.host)
      ],
      signalAuthMode: "root_only_nginx_include",
      noTerminalOperationalData: true,
      cdrRequiredForFileTransfer: true,
      productionExecutionAllowed: false
    }
  };
}
