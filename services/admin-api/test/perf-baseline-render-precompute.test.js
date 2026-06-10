import assert from "node:assert/strict";
import test from "node:test";
import {
  liveBaselineArtifactSummary,
  renderG2GatewayCloudInit,
  renderG2GatewayNginx
} from "../src/modules/live/liveBaselineArtifacts.js";
import { RouterReadinessService } from "../src/modules/router/routerReadinessService.js";

// Independent full-scan reference: rebuilt from scratch on every call, mirroring the
// pre-optimization implementation. The precomputed module constants must produce
// byte-for-byte identical output.
const REFERENCE_APPS = [
  {
    key: "duckduckgo",
    host: "duckduckgo.sylion.internal",
    scheme: "http",
    port: 3001,
    authSnippet: "/etc/nginx/snippets/sylion-kasm-auth-duckduckgo.conf"
  },
  {
    key: "libreoffice",
    host: "libreoffice.sylion.internal",
    scheme: "http",
    port: 3002,
    authSnippet: "/etc/nginx/snippets/sylion-kasm-auth-libreoffice.conf"
  },
  {
    key: "whatsapp",
    host: "whatsapp.sylion.internal",
    scheme: "http",
    port: 3010,
    authSnippet: "/etc/nginx/snippets/sylion-kasm-auth-whatsapp.conf"
  },
  {
    key: "telegram",
    host: "telegram.sylion.internal",
    scheme: "http",
    port: 3011,
    authSnippet: "/etc/nginx/snippets/sylion-kasm-auth-telegram.conf"
  },
  {
    key: "threema",
    host: "threema.sylion.internal",
    scheme: "http",
    port: 3012,
    authSnippet: "/etc/nginx/snippets/sylion-kasm-auth-threema.conf"
  },
  {
    key: "signal",
    host: "signal.sylion.internal",
    scheme: "http",
    port: 3013,
    authSnippet: "/etc/nginx/snippets/sylion-kasm-auth-signal.conf"
  },
  {
    key: "zangi",
    host: "zangi.sylion.internal",
    scheme: "http",
    port: 3014,
    productionGate: "android_native_runner_required"
  },
  {
    key: "protonmail",
    host: "protonmail.sylion.internal",
    scheme: "http",
    port: 3016,
    authSnippet: "/etc/nginx/snippets/sylion-kasm-auth-protonmail.conf",
    productionGate: "mail_account_human_test_required"
  },
  {
    key: "simplex",
    host: "simplex.sylion.internal",
    scheme: "http",
    port: 3017,
    authSnippet: "/etc/nginx/snippets/sylion-kasm-auth-simplex.conf",
    productionGate: "simplex_desktop_or_android_image_required"
  },
  {
    key: "exodus",
    host: "exodus.sylion.internal",
    scheme: "http",
    port: 3015,
    authSnippet: "/etc/nginx/snippets/sylion-kasm-auth-exodus.conf",
    productionGate: "isolated_wallet_runtime_required"
  }
];

function referenceProxyHeaders() {
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
    '    add_header Cache-Control "no-store" always;',
    '    add_header X-Sylion-Terminal-Data-Stored "false" always;',
    '    add_header X-Sylion-G1-G2-Bypass "false" always;',
    '    add_header X-Sylion-CDR-Required "true" always;',
    '    add_header X-Sylion-Workload-Gateway "g2" always;'
  ].join("\n");
}

function referenceGatewayNginx({
  gatewayBind = "10.42.0.12",
  adminUpstream = "http://10.42.0.10:8080",
  workloadBind = "10.42.0.13",
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
${referenceProxyHeaders()}
  }
}`;
  const workloads = REFERENCE_APPS.map((app) => {
    const auth = app.authSnippet ? `    include ${app.authSnippet};\n` : "";
    const proxySsl = app.proxySslVerify === false ? "    proxy_ssl_verify off;\n" : "";
    const gate = app.productionGate
      ? `    add_header X-Sylion-Production-Gate "${app.productionGate}" always;\n`
      : "";
    return `server {
  listen ${gatewayBind}:443 ssl;
  server_name ${app.host};
  ssl_certificate ${tlsCertificate};
  ssl_certificate_key ${tlsKey};
  location / {
${auth}${proxySsl}${gate}    proxy_pass ${app.scheme}://${workloadBind}:${app.port};
${referenceProxyHeaders()}
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

function referenceAuthSnippetWriteFiles() {
  return REFERENCE_APPS.filter((app) => app.authSnippet)
    .map(
      (app) => `  - path: ${app.authSnippet}
    permissions: "0600"
    content: |
      # Populated by the operator secret handoff flow. Do not store KasmVNC workload passwords in cloud-init.
`
    )
    .join("");
}

function referenceIpsecProfiles(operatorId) {
  return [
    {
      id: "T0",
      name: "terminal-or-puli-to-g1",
      from: "terminal_or_puli_ax",
      to: "g1",
      protocol: "ipsec_ikev2",
      authentication: "mutual_certificate",
      cryptoProfile: "aes256gcm16-prfsha384-ecp384_planned",
      certRef: `cert-ref://${operatorId}/terminal-or-router-to-g1`,
      privateKeyMaterialIncluded: false
    },
    {
      id: "T1",
      name: "g1-to-g2",
      from: "g1",
      to: "g2",
      protocol: "ipsec_ikev2",
      authentication: "mutual_certificate",
      cryptoProfile: "aes256gcm16-prfsha384-ecp384_planned",
      certRef: `cert-ref://${operatorId}/g1-to-g2`,
      privateKeyMaterialIncluded: false
    },
    {
      id: "T2",
      name: "g2-to-workload",
      from: "g2",
      to: "workload",
      protocol: "ipsec_ikev2",
      authentication: "mutual_certificate",
      cryptoProfile: "aes256gcm16-prfsha384-ecp384_planned",
      certRef: `cert-ref://${operatorId}/g2-to-workload`,
      privateKeyMaterialIncluded: false
    }
  ];
}

function createRouterReadinessService() {
  const operators = new Map([
    ["op-perf-a", { id: "op-perf-a", tenantId: "tenant-perf-a" }],
    ["op-perf-b", { id: "op-perf-b", tenantId: "tenant-perf-b" }]
  ]);
  return new RouterReadinessService({
    audit: { record: () => {} },
    rbac: { assert: () => {} },
    operators,
    devices: { get: () => null, listForOperatorScoped: () => [] }
  });
}

test("perf: renderG2GatewayNginx matches the full-scan reference byte-for-byte", () => {
  assert.equal(renderG2GatewayNginx(), referenceGatewayNginx());

  const custom = {
    gatewayBind: "10.99.0.12",
    adminUpstream: "http://10.99.0.10:8080",
    workloadBind: "10.99.0.13",
    tlsCertificate: "/etc/sylion/tls/custom.crt",
    tlsKey: "/etc/sylion/tls/custom.key"
  };
  assert.equal(renderG2GatewayNginx(custom), referenceGatewayNginx(custom));
});

test("perf: precomputed nginx fragments are not contaminated across parameterized calls", () => {
  const before = renderG2GatewayNginx();
  const custom = renderG2GatewayNginx({ gatewayBind: "10.99.0.12", workloadBind: "10.99.0.13" });
  assert.match(custom, /listen 10\.99\.0\.12:443 ssl;/);
  assert.match(custom, /proxy_pass http:\/\/10\.99\.0\.13:3001;/);
  assert.doesNotMatch(custom, /10\.42\.0\.12/);
  assert.doesNotMatch(custom, /10\.42\.0\.13/);
  const after = renderG2GatewayNginx();
  assert.equal(after, before);
  assert.equal(after, referenceGatewayNginx());
});

test("perf: renderG2GatewayCloudInit embeds the reference nginx config and auth snippet files", () => {
  const cloudInit = renderG2GatewayCloudInit();
  const indentedNginx = referenceGatewayNginx()
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n");
  assert.ok(cloudInit.includes(indentedNginx));
  assert.ok(cloudInit.includes(`${referenceAuthSnippetWriteFiles()}\nruncmd:`));
  assert.equal(
    (cloudInit.match(/permissions: "0600"/g) || []).length,
    REFERENCE_APPS.filter((app) => app.authSnippet).length
  );
  assert.equal(renderG2GatewayCloudInit(), cloudInit);

  const customCloudInit = renderG2GatewayCloudInit({ gatewayBind: "10.99.0.12" });
  assert.match(customCloudInit, /"gatewayBind": "10\.99\.0\.12"/);
  assert.equal(renderG2GatewayCloudInit(), cloudInit);
});

test("perf: liveBaselineArtifactSummary returns full host/app lists as fresh arrays", () => {
  const summary = liveBaselineArtifactSummary();
  assert.deepEqual(summary.g2WorkloadGateway.hostnames, [
    "admin.sylion.internal",
    "operator.sylion.internal",
    ...REFERENCE_APPS.map((app) => app.host)
  ]);
  assert.deepEqual(
    summary.workloadContainers.apps,
    REFERENCE_APPS.map((app) => app.key)
  );

  summary.g2WorkloadGateway.hostnames.push("tampered.sylion.internal");
  summary.workloadContainers.apps.length = 0;
  const fresh = liveBaselineArtifactSummary();
  assert.deepEqual(fresh.g2WorkloadGateway.hostnames, [
    "admin.sylion.internal",
    "operator.sylion.internal",
    ...REFERENCE_APPS.map((app) => app.host)
  ]);
  assert.deepEqual(
    fresh.workloadContainers.apps,
    REFERENCE_APPS.map((app) => app.key)
  );
});

test("perf: router package IPsec profiles match the full-scan reference including key order", () => {
  const service = createRouterReadinessService();
  const actor = { id: "user-perf" };
  const pkgA = service.generatePackage({
    actor,
    operatorId: "op-perf-a",
    correlationId: "corr-perf-router-a"
  });
  assert.deepEqual(pkgA.manifest.ipsecProfiles, referenceIpsecProfiles("op-perf-a"));
  assert.equal(
    JSON.stringify(pkgA.manifest.ipsecProfiles),
    JSON.stringify(referenceIpsecProfiles("op-perf-a"))
  );

  const pkgB = service.generatePackage({
    actor,
    operatorId: "op-perf-b",
    correlationId: "corr-perf-router-b"
  });
  assert.deepEqual(pkgB.manifest.ipsecProfiles, referenceIpsecProfiles("op-perf-b"));
  assert.equal(
    JSON.stringify(pkgB.manifest.ipsecProfiles),
    JSON.stringify(referenceIpsecProfiles("op-perf-b"))
  );
});

test("perf: mutating a generated package does not contaminate later router packages", () => {
  const service = createRouterReadinessService();
  const actor = { id: "user-perf" };
  const first = service.generatePackage({
    actor,
    operatorId: "op-perf-a",
    correlationId: "corr-perf-router-mut-1"
  });
  first.manifest.ipsecProfiles[0].certRef = "tampered";
  first.manifest.ipsecProfiles[1].protocol = "tampered";
  delete first.manifest.ipsecProfiles[2].privateKeyMaterialIncluded;
  first.manifest.ipsecProfiles.push({ id: "T3" });

  const second = service.generatePackage({
    actor,
    operatorId: "op-perf-a",
    correlationId: "corr-perf-router-mut-2"
  });
  assert.deepEqual(second.manifest.ipsecProfiles, referenceIpsecProfiles("op-perf-a"));
  assert.equal(
    JSON.stringify(second.manifest.ipsecProfiles),
    JSON.stringify(referenceIpsecProfiles("op-perf-a"))
  );
});
