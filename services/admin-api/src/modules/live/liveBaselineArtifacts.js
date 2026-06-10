const DEFAULT_GATEWAY_BIND = "10.42.0.12";
const DEFAULT_ADMIN_UPSTREAM = "http://10.42.0.10:8080";
const DEFAULT_WORKLOAD_BIND = "10.42.0.13";

const WORKLOAD_APPS = Object.freeze(
  [
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
  ].map((app) => Object.freeze(app))
);

const COMMON_PROXY_HEADERS = [
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

// Static nginx fragments derived from WORKLOAD_APPS, built once at module load.
// Only the bind/TLS/upstream parameters are composed per render call.
const WORKLOAD_APP_NGINX_PARTS = Object.freeze(
  WORKLOAD_APPS.map((app) =>
    Object.freeze({
      app,
      authInclude: app.authSnippet ? `    include ${app.authSnippet};\n` : "",
      proxySslLine: app.proxySslVerify === false ? "    proxy_ssl_verify off;\n" : "",
      gateLine: app.productionGate
        ? `    add_header X-Sylion-Production-Gate "${app.productionGate}" always;\n`
        : ""
    })
  )
);

const AUTH_SNIPPET_WRITE_FILES = WORKLOAD_APPS.filter((app) => app.authSnippet)
  .map(
    (app) => `  - path: ${app.authSnippet}
    permissions: "0600"
    content: |
      # Populated by the operator secret handoff flow. Do not store KasmVNC workload passwords in cloud-init.
`
  )
  .join("");

const WORKLOAD_HOSTNAMES = Object.freeze(WORKLOAD_APPS.map((app) => app.host));
const WORKLOAD_KEYS = Object.freeze(WORKLOAD_APPS.map((app) => app.key));

function yamlBlock(value, indent = "      ") {
  return String(value)
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
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
${COMMON_PROXY_HEADERS}
  }
}`;
  const workloads = WORKLOAD_APP_NGINX_PARTS.map(({ app, authInclude, proxySslLine, gateLine }) => {
    return `server {
  listen ${gatewayBind}:443 ssl;
  server_name ${app.host};
  ssl_certificate ${tlsCertificate};
  ssl_certificate_key ${tlsKey};
  location / {
${authInclude}${proxySslLine}${gateLine}    proxy_pass ${app.scheme}://${workloadBind}:${app.port};
${COMMON_PROXY_HEADERS}
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
${yamlBlock(
  JSON.stringify(
    {
      component: "g2_workload_gateway",
      gatewayBind: options.gatewayBind || DEFAULT_GATEWAY_BIND,
      workloadBind: options.workloadBind || DEFAULT_WORKLOAD_BIND,
      noTerminalOperationalData: true,
      noG1G2Bypass: true,
      cdrRequiredForFileTransfer: true,
      kasmAuthMode: "root_only_per_app_nginx_include",
      productionExecutionAllowed: false
    },
    null,
    2
  )
)}
  - path: /etc/nginx/sites-available/sylion-g2-broker
    permissions: "0644"
    content: |
${yamlBlock(nginxConfig)}
${AUTH_SNIPPET_WRITE_FILES}
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

function sshUserBlock(sshPublicKey) {
  if (!sshPublicKey) return "";
  return `users:
  - name: sylion
    groups: sudo,docker
    shell: /bin/bash
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]
    ssh_authorized_keys:
      - ${sshPublicKey}
`;
}

export function renderWorkloadCloudInit({ sshPublicKey = null } = {}) {
  return `#cloud-config
package_update: true
package_upgrade: false
packages:
  - curl
  - ca-certificates
  - docker.io
  - nftables
  - jq
  - openssl
${sshUserBlock(sshPublicKey)}write_files:
  - path: /etc/sylion-role
    permissions: "0644"
    content: "WORKLOAD"
  - path: /opt/sylion-workloads/signal-workload.Dockerfile
    permissions: "0644"
    content: |
      FROM kasmweb/signal:1.18.0

      USER root
      RUN apt-get update \\
        && apt-get install -y --no-install-recommends ca-certificates curl gnupg \\
        && install -d -m 0755 /etc/apt/keyrings \\
        && curl -fsSL https://updates.signal.org/desktop/apt/keys.asc \\
          | gpg --dearmor -o /etc/apt/keyrings/signal-desktop-keyring.gpg \\
        && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/signal-desktop-keyring.gpg] https://updates.signal.org/desktop/apt xenial main" \\
          > /etc/apt/sources.list.d/signal-xenial.list \\
        && apt-get update \\
        && apt-get install -y --no-install-recommends \\
          dbus-x11 \\
          signal-desktop \\
          xdg-utils \\
          xfce4-panel \\
          xfce4-session \\
          xfdesktop4 \\
          xfwm4 \\
        && apt-get clean \\
        && rm -rf /var/lib/apt/lists/* \\
        && sed -i 's/^    width: .*/    width: 800/; s/^    height: .*/    height: 900/' /usr/share/kasmvnc/kasmvnc_defaults.yaml

      USER kasm-user
  - path: /usr/local/sbin/sylion-start-workloads.sh
    permissions: "0755"
    content: |
      #!/usr/bin/env bash
      set -euo pipefail

      private_ip="$(ip -4 -o addr show | awk '$4 ~ /^10\\.(42|44)\\./ { split($4, a, "/"); print a[1]; exit }')"
      if [ -z "$private_ip" ]; then
        echo "SYLION workload private 10.42.x or 10.44.x address missing" >&2
        exit 1
      fi

      install -d -m 0700 /etc/sylion/workload-secrets
      if [ ! -f /etc/sylion/workload-secrets/signal.env ]; then
        signal_vnc_pw="$(openssl rand -base64 24 | tr -d '\\n')"
        printf 'VNC_PW=%s\\nVNC_RESOLUTION=800x900\\nKASM_RESOLUTION=800x900\\n' "$signal_vnc_pw" > /etc/sylion/workload-secrets/signal.env
        chmod 0600 /etc/sylion/workload-secrets/signal.env
      fi

      docker build -t sylion/signal-workload:prod-candidate -f /opt/sylion-workloads/signal-workload.Dockerfile /opt/sylion-workloads

      docker rm -f sylion-duckduckgo sylion-libreoffice sylion-whatsapp-web sylion-telegram-web sylion-threema-web sylion-zangi-web sylion-exodus sylion-signal-desktop 2>/dev/null || true
      docker volume create sylion_duckduckgo_config >/dev/null
      docker volume create sylion_libreoffice_config >/dev/null
      docker volume create sylion_whatsapp_config >/dev/null
      docker volume create sylion_telegram_config >/dev/null
      docker volume create sylion_threema_config >/dev/null
      docker volume create sylion_zangi_config >/dev/null
      docker volume create sylion_protonmail_config >/dev/null
      docker volume create sylion_simplex_config >/dev/null
      docker volume create sylion_exodus_config >/dev/null
      docker volume create sylion_signal_profile >/dev/null
      docker run --rm -v sylion_signal_profile:/target alpine:3.20 sh -lc 'chown -R 1000:1000 /target'

      docker run -d --name sylion-duckduckgo --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -e TITLE='SYLION DuckDuckGo' -e FIREFOX_CLI='https://duckduckgo.com/' -p "$private_ip:3001:3000" -v sylion_duckduckgo_config:/config lscr.io/linuxserver/firefox:latest
      docker run -d --name sylion-libreoffice --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -p "$private_ip:3002:3000" -v sylion_libreoffice_config:/config lscr.io/linuxserver/libreoffice:latest
      docker run -d --name sylion-whatsapp-web --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -e TITLE='SYLION WhatsApp Web' -e CHROME_CLI='--disable-session-crashed-bubble --no-first-run https://web.whatsapp.com/' -p "$private_ip:3010:3000" -v sylion_whatsapp_config:/config lscr.io/linuxserver/chromium:latest
      docker run -d --name sylion-telegram-web --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -e TITLE='SYLION Telegram Web' -e CHROME_CLI='--disable-session-crashed-bubble --no-first-run https://web.telegram.org/k/' -p "$private_ip:3011:3000" -v sylion_telegram_config:/config lscr.io/linuxserver/chromium:latest
      docker run -d --name sylion-threema-web --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -e TITLE='SYLION Threema Web' -e CHROME_CLI='--disable-session-crashed-bubble --no-first-run https://web.threema.ch/' -p "$private_ip:3012:3000" -v sylion_threema_config:/config lscr.io/linuxserver/chromium:latest
      docker run -d --name sylion-zangi-web --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -e TITLE='SYLION Zangi Gate' -e CHROME_CLI='--disable-session-crashed-bubble --no-first-run https://zangi.com/en-us/download' -p "$private_ip:3014:3000" -v sylion_zangi_config:/config lscr.io/linuxserver/chromium:latest
      docker run -d --name sylion-protonmail-web --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -e TITLE='SYLION Proton Mail' -e CHROME_CLI='--disable-session-crashed-bubble --no-first-run https://mail.proton.me/' -p "$private_ip:3016:3000" -v sylion_protonmail_config:/config lscr.io/linuxserver/chromium:latest
      docker run -d --name sylion-simplex-gate --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -e TITLE='SYLION SimpleX Gate' -e CHROME_CLI='--disable-session-crashed-bubble --no-first-run https://simplex.chat/downloads/' -p "$private_ip:3017:3000" -v sylion_simplex_config:/config lscr.io/linuxserver/chromium:latest
      docker run -d --name sylion-exodus --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -e TITLE='SYLION Exodus Gate' -e CHROME_CLI='--disable-session-crashed-bubble --no-first-run https://www.exodus.com/download/' -p "$private_ip:3015:3000" -v sylion_exodus_config:/config lscr.io/linuxserver/chromium:latest
      docker run -d --name sylion-signal-desktop --restart unless-stopped --shm-size 1g --env-file /etc/sylion/workload-secrets/signal.env -p "$private_ip:3013:6901" -v sylion_signal_profile:/home/kasm-user/.config/Signal sylion/signal-workload:prod-candidate

      docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' > /opt/sylion-workloads/container-status.txt
      jq -n --arg checkedAt "$(date -Is)" '{component:"workload_containers", privateBindOnly:true, cdrRequiredForFileTransfer:true, noTerminalOperationalData:true, checkedAt:$checkedAt}' > /opt/sylion-workloads/runtime-evidence.json
  - path: /opt/sylion-workloads/README.txt
    permissions: "0644"
    content: |
      SYLION WORKLOAD host.
      Workload UI services bind to the operator private network address only.
      Signal VNC password is generated at boot into /etc/sylion/workload-secrets/signal.env and must be handed to G2 through the approved root-only secret handoff flow.
runcmd:
  - [ bash, -lc, "install -d -m 0755 /opt/sylion-workloads" ]
  - [ bash, -lc, "systemctl enable --now docker" ]
  - [ bash, -lc, "/usr/local/sbin/sylion-start-workloads.sh" ]
  - [ bash, -lc, "systemctl enable --now nftables || true" ]
  - [ bash, -lc, "echo 'WORKLOAD ready at $(date -Is)' > /var/log/sylion-bootstrap.log" ]
`;
}

export function buildLiveBaselineUserData({ userDataByRole = {}, gatewayOptions = {} } = {}) {
  return {
    G1: userDataByRole.G1,
    G2: userDataByRole.G2 || renderG2GatewayCloudInit(gatewayOptions),
    WORKLOAD:
      userDataByRole.WORKLOAD ||
      renderWorkloadCloudInit({ sshPublicKey: gatewayOptions.sshPublicKey || null })
  };
}

export function liveBaselineArtifactSummary({
  gatewayBind = DEFAULT_GATEWAY_BIND,
  workloadBind = DEFAULT_WORKLOAD_BIND
} = {}) {
  return {
    g2WorkloadGateway: {
      included: true,
      bindAddress: gatewayBind,
      workloadBindAddress: workloadBind,
      hostnames: ["admin.sylion.internal", "operator.sylion.internal", ...WORKLOAD_HOSTNAMES],
      kasmAuthMode: "root_only_per_app_nginx_include",
      noTerminalOperationalData: true,
      cdrRequiredForFileTransfer: true,
      productionExecutionAllowed: false
    },
    workloadContainers: {
      included: true,
      bindAddress: workloadBind,
      signalPasswordMode: "generated_on_workload_root_only",
      apps: [...WORKLOAD_KEYS],
      noTerminalOperationalData: true,
      cdrRequiredForFileTransfer: true,
      productionExecutionAllowed: false
    }
  };
}
