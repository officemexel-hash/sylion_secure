import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AdminApiClient } from "../services/admin-api/src/sdk/adminApiClient.js";

const HETZNER_API = "https://api.hetzner.cloud/v1";
const baseUrl = process.env.SYLION_ADMIN_API_URL || "http://127.0.0.1:8099";
const outputDir = process.env.SYLION_LIVE_BASELINE_OUTPUT_DIR
  || join(process.cwd(), "docs", "admin-panel-v2", "test-artifacts", "step3-33-hetzner-live-operator-baseline");

function requireEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function hetznerPreflight({ token, region, serverType, image }) {
  const headers = { authorization: `Bearer ${token}` };
  const checks = [];
  for (const [name, path, predicate] of [
    ["locations", "/locations?per_page=100", (payload) => (payload.locations || []).some((item) => item.name === region)],
    ["server_types", "/server_types?per_page=100", (payload) => (payload.server_types || []).some((item) => item.name === serverType)],
    ["images", "/images?type=system&per_page=100", (payload) => (payload.images || []).some((item) => item.name === image || item.description === image)]
  ]) {
    const response = await fetch(`${HETZNER_API}${path}`, { headers });
    if (!response.ok) {
      checks.push({ name, status: response.status, ok: false, containsRequested: false });
      return { ok: false, reason: "hetzner_preflight_failed", checks, tokenLogged: false };
    }
    const payload = await response.json();
    checks.push({ name, status: response.status, ok: true, containsRequested: predicate(payload) });
  }
  const missing = checks.filter((check) => check.containsRequested === false).map((check) => check.name);
  return {
    ok: missing.length === 0,
    reason: missing.length ? "hetzner_requested_catalog_item_missing" : "ok",
    checks,
    tokenLogged: false
  };
}

async function loginClient() {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_hetzner_live_operator_baseline_${crypto.randomUUID()}`
  });
  const credentialId = `cred-hetzner-live-operator-${crypto.randomUUID()}`;
  const email = process.env.SYLION_ADMIN_EMAIL || "admin@sylion.local";
  const password = process.env.SYLION_ADMIN_PASSWORD || "ChangeMe-LocalOnly-1!";
  const enrollment = await anon.createEnrollmentOptions({ email, password });
  await anon.verifyEnrollment({
    challengeId: enrollment.challenge.id,
    credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
  });
  const loginOptions = await anon.createWebAuthnLoginOptions({ email, password });
  const session = await anon.verifyWebAuthnLogin({
    challengeId: loginOptions.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${loginOptions.challenge.id}:${credentialId}`,
      signCounter: 1
    }
  });
  return { client: anon.withToken(session.token), credentialId };
}

async function stepUp(client, credentialId) {
  const options = await client.createStepUpOptions();
  await client.verifyStepUp({
    challengeId: options.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${options.challenge.id}:${credentialId}`,
      signCounter: 2
    }
  });
}

function sanitizeCreated(payload) {
  const request = payload.liveBaseline?.request || {};
  return {
    operatorId: payload.operator?.id,
    tenantId: payload.operator?.tenantId,
    liveBaselineMode: payload.liveBaseline?.mode,
    providerKey: payload.liveBaseline?.providerKey,
    region: payload.liveBaseline?.region,
    requestId: request.id,
    status: request.status,
    rollbackPlanId: request.rollbackPlanId,
    rollbackReady: request.rollbackReady,
    gate: request.gate,
    resources: (request.resources || []).map((resource) => ({
      role: resource.role,
      providerResourceId: resource.providerResourceId,
      name: resource.name,
      location: resource.location,
      publicIpv4: resource.publicIpv4,
      publicIpv6: resource.publicIpv6,
      status: resource.status
    })),
    tokenLogged: false,
    checkedAt: new Date().toISOString()
  };
}

async function readSshPublicKey() {
  if (process.env.SYLION_LIVE_SSH_PUBLIC_KEY) return process.env.SYLION_LIVE_SSH_PUBLIC_KEY.trim();
  const publicKeyPath = process.env.SYLION_LIVE_SSH_PUBLIC_KEY_PATH || ".deploy/sylion_hetzner_admin_ed25519.pub";
  try {
    return (await readFile(publicKeyPath, "utf8")).trim();
  } catch {
    return null;
  }
}

function baseCloudInit({ role, publicKey }) {
  return `#cloud-config
package_update: true
package_upgrade: false
packages:
  - curl
  - ca-certificates
  - nftables
  - strongswan
  - jq
users:
  - name: sylion
    groups: sudo
    shell: /bin/bash
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]
    ssh_authorized_keys:
      - ${publicKey}
write_files:
  - path: /etc/sylion-role
    permissions: "0644"
    content: "${role}"
runcmd:
  - [ bash, -lc, "systemctl enable --now nftables || true" ]
  - [ bash, -lc, "echo '${role} ready at $(date -Is)' > /var/log/sylion-bootstrap.log" ]
`;
}

function workloadCloudInit({ publicKey }) {
  return `#cloud-config
package_update: true
package_upgrade: false
packages:
  - curl
  - ca-certificates
  - docker.io
  - nftables
  - jq
users:
  - name: sylion
    groups: sudo,docker
    shell: /bin/bash
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]
    ssh_authorized_keys:
      - ${publicKey}
write_files:
  - path: /opt/sylion-workloads/docker-compose.yml
    permissions: "0644"
    content: |
      services:
        duckduckgo:
          image: lscr.io/linuxserver/firefox:latest
          container_name: sylion-duckduckgo
          restart: unless-stopped
          shm_size: "1gb"
          environment:
            - PUID=1000
            - PGID=1000
            - TZ=UTC
            - TITLE=SYLION DuckDuckGo
            - FIREFOX_CLI=https://duckduckgo.com/
          ports:
            - "127.0.0.1:3001:3000"
          volumes:
            - duckduckgo_config:/config
        libreoffice:
          image: lscr.io/linuxserver/libreoffice:latest
          container_name: sylion-libreoffice
          restart: unless-stopped
          shm_size: "1gb"
          environment:
            - PUID=1000
            - PGID=1000
            - TZ=UTC
          ports:
            - "127.0.0.1:3002:3000"
          volumes:
            - libreoffice_config:/config
        whatsapp:
          image: lscr.io/linuxserver/chromium:latest
          container_name: sylion-whatsapp-web
          restart: unless-stopped
          shm_size: "1gb"
          environment:
            - PUID=1000
            - PGID=1000
            - TZ=UTC
            - TITLE=SYLION WhatsApp Web
            - CHROME_CLI=--disable-session-crashed-bubble --no-first-run https://web.whatsapp.com/
          ports:
            - "127.0.0.1:3010:3000"
          volumes:
            - whatsapp_config:/config
        telegram:
          image: lscr.io/linuxserver/chromium:latest
          container_name: sylion-telegram-web
          restart: unless-stopped
          shm_size: "1gb"
          environment:
            - PUID=1000
            - PGID=1000
            - TZ=UTC
            - TITLE=SYLION Telegram Web
            - CHROME_CLI=--disable-session-crashed-bubble --no-first-run https://web.telegram.org/k/
          ports:
            - "127.0.0.1:3011:3000"
          volumes:
            - telegram_config:/config
        threema:
          image: lscr.io/linuxserver/chromium:latest
          container_name: sylion-threema-web
          restart: unless-stopped
          shm_size: "1gb"
          environment:
            - PUID=1000
            - PGID=1000
            - TZ=UTC
            - TITLE=SYLION Threema Web
            - CHROME_CLI=--disable-session-crashed-bubble --no-first-run https://web.threema.ch/
          ports:
            - "127.0.0.1:3012:3000"
          volumes:
            - threema_config:/config
        zangi:
          image: lscr.io/linuxserver/chromium:latest
          container_name: sylion-zangi-web
          restart: unless-stopped
          shm_size: "1gb"
          environment:
            - PUID=1000
            - PGID=1000
            - TZ=UTC
            - TITLE=SYLION Zangi
            - CHROME_CLI=--disable-session-crashed-bubble --no-first-run https://zangi.com/en-us/download
          ports:
            - "127.0.0.1:3014:3000"
          volumes:
            - zangi_config:/config
        exodus:
          image: lscr.io/linuxserver/chromium:latest
          container_name: sylion-exodus
          restart: unless-stopped
          shm_size: "1gb"
          environment:
            - PUID=1000
            - PGID=1000
            - TZ=UTC
            - TITLE=SYLION Exodus
            - CHROME_CLI=--disable-session-crashed-bubble --no-first-run https://www.exodus.com/download/
          ports:
            - "127.0.0.1:3015:3000"
          volumes:
            - exodus_config:/config
        signal:
          image: sylion/signal-workload:prod-candidate
          container_name: sylion-signal-desktop
          restart: unless-stopped
          shm_size: "1gb"
          environment:
            - VNC_PW=sylion-signal-local
            - KASM_RESOLUTION=1080x2400
          ports:
            - "127.0.0.1:3013:6901"
          volumes:
            - signal_profile:/home/kasm-user/.config/Signal
      volumes:
        duckduckgo_config:
        libreoffice_config:
        whatsapp_config:
        telegram_config:
        threema_config:
        zangi_config:
        exodus_config:
        signal_profile:
  - path: /opt/sylion-workloads/signal-workload.Dockerfile
    permissions: "0644"
    content: |
      FROM kasmweb/signal:1.18.0

      USER root
      RUN apt-get update \
        && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
        && install -d -m 0755 /etc/apt/keyrings \
        && curl -fsSL https://updates.signal.org/desktop/apt/keys.asc \
          | gpg --dearmor -o /etc/apt/keyrings/signal-desktop-keyring.gpg \
        && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/signal-desktop-keyring.gpg] https://updates.signal.org/desktop/apt xenial main" \
          > /etc/apt/sources.list.d/signal-xenial.list \
        && apt-get update \
        && apt-get install -y --no-install-recommends signal-desktop \
        && apt-get clean \
        && rm -rf /var/lib/apt/lists/*

      USER kasm-user
  - path: /usr/local/sbin/sylion-start-workloads.sh
    permissions: "0755"
    content: |
      #!/usr/bin/env bash
      set -euo pipefail

      private_ip="$(ip -4 -o addr show | awk '$4 ~ /^10\\.42\\./ { split($4, a, "/"); print a[1]; exit }')"
      if [ -z "$private_ip" ]; then
        private_ip="127.0.0.1"
      fi

      docker build -t sylion/signal-workload:prod-candidate -f /opt/sylion-workloads/signal-workload.Dockerfile /opt/sylion-workloads

      docker rm -f sylion-duckduckgo sylion-libreoffice sylion-whatsapp-web sylion-telegram-web sylion-threema-web sylion-zangi-web sylion-exodus sylion-signal-desktop 2>/dev/null || true
      docker volume create sylion_duckduckgo_config >/dev/null
      docker volume create sylion_libreoffice_config >/dev/null
      docker volume create sylion_whatsapp_config >/dev/null
      docker volume create sylion_telegram_config >/dev/null
      docker volume create sylion_threema_config >/dev/null
      docker volume create sylion_zangi_config >/dev/null
      docker volume create sylion_exodus_config >/dev/null
      docker volume create sylion_signal_profile >/dev/null

      docker run -d --name sylion-duckduckgo --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -e TITLE='SYLION DuckDuckGo' -e FIREFOX_CLI='https://duckduckgo.com/' -p "$private_ip:3001:3000" -v sylion_duckduckgo_config:/config lscr.io/linuxserver/firefox:latest
      docker run -d --name sylion-libreoffice --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -p "$private_ip:3002:3000" -v sylion_libreoffice_config:/config lscr.io/linuxserver/libreoffice:latest
      docker run -d --name sylion-whatsapp-web --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -e TITLE='SYLION WhatsApp Web' -e CHROME_CLI='--disable-session-crashed-bubble --no-first-run https://web.whatsapp.com/' -p "$private_ip:3010:3000" -v sylion_whatsapp_config:/config lscr.io/linuxserver/chromium:latest
      docker run -d --name sylion-telegram-web --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -e TITLE='SYLION Telegram Web' -e CHROME_CLI='--disable-session-crashed-bubble --no-first-run https://web.telegram.org/k/' -p "$private_ip:3011:3000" -v sylion_telegram_config:/config lscr.io/linuxserver/chromium:latest
      docker run -d --name sylion-threema-web --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -e TITLE='SYLION Threema Web' -e CHROME_CLI='--disable-session-crashed-bubble --no-first-run https://web.threema.ch/' -p "$private_ip:3012:3000" -v sylion_threema_config:/config lscr.io/linuxserver/chromium:latest
      docker run -d --name sylion-zangi-web --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -e TITLE='SYLION Zangi' -e CHROME_CLI='--disable-session-crashed-bubble --no-first-run https://zangi.com/en-us/download' -p "$private_ip:3014:3000" -v sylion_zangi_config:/config lscr.io/linuxserver/chromium:latest
      docker run -d --name sylion-exodus --restart unless-stopped --shm-size 1g -e PUID=1000 -e PGID=1000 -e TZ=UTC -e TITLE='SYLION Exodus' -e CHROME_CLI='--disable-session-crashed-bubble --no-first-run https://www.exodus.com/download/' -p "$private_ip:3015:3000" -v sylion_exodus_config:/config lscr.io/linuxserver/chromium:latest
      docker run -d --name sylion-signal-desktop --restart unless-stopped --shm-size 1g -e VNC_PW=sylion-signal-local -e KASM_RESOLUTION=1080x2400 -p "$private_ip:3013:6901" -v sylion_signal_profile:/home/kasm-user/.config/Signal sylion/signal-workload:prod-candidate

      docker exec sylion-signal-desktop dpkg-query -W signal-desktop > /opt/sylion-workloads/signal-version.txt
      docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' > /opt/sylion-workloads/container-status.txt
  - path: /opt/sylion-workloads/README.txt
    permissions: "0644"
    content: |
      SYLION WORKLOAD host.
      noVNC services bind to the operator private network address only:
      duckduckgo 3001, libreoffice 3002, whatsapp web 3010, telegram web 3011, threema web 3012, signal desktop 3013, zangi 3014, exodus 3015.
      Reach them through G2/thin-client or an explicitly authorized diagnostic SSH tunnel.
runcmd:
  - [ bash, -lc, "systemctl enable --now docker" ]
  - [ bash, -lc, "/usr/local/sbin/sylion-start-workloads.sh" ]
  - [ bash, -lc, "echo 'WORKLOAD ready at $(date -Is)' > /var/log/sylion-bootstrap.log" ]
`;
}

async function run() {
  const token = requireEnv("HETZNER_API_TOKEN");
  if (process.env.SYLION_LIVE_BASELINE_CONFIRM !== "I_UNDERSTAND_COST_AND_ROLLBACK") {
    throw new Error("Set SYLION_LIVE_BASELINE_CONFIRM=I_UNDERSTAND_COST_AND_ROLLBACK before creating real Hetzner VPS");
  }
  const region = process.env.SYLION_LIVE_REGION || "fsn1";
  const serverType = process.env.SYLION_HETZNER_SERVER_TYPE || "cpx22";
  const image = process.env.SYLION_HETZNER_IMAGE || "ubuntu-24.04";
  await mkdir(outputDir, { recursive: true });
  const preflight = await hetznerPreflight({ token, region, serverType, image });
  if (!preflight.ok) {
    await writeFile(join(outputDir, "preflight-failed.json"), JSON.stringify({
      provider: "hetzner",
      status: "preflight_failed",
      reason: preflight.reason,
      checks: preflight.checks,
      tokenLogged: false,
      checkedAt: new Date().toISOString()
    }, null, 2));
    throw new Error(`Hetzner live baseline preflight failed: ${preflight.reason}`);
  }
  const { client, credentialId } = await loginClient();
  const publicKey = await readSshPublicKey();
  if (!publicKey) throw new Error("SSH public key is required for live baseline verification");
  await stepUp(client, credentialId);
  const tenant = await client.createTenant({
    name: process.env.SYLION_LIVE_TENANT_NAME || `SYLION Live Tenant ${Date.now()}`,
    tier: process.env.SYLION_LIVE_TIER || "PRO"
  });
  const provider = await client.createProvider({
    providerType: "hetzner",
    apiSecret: token,
    regions: [region],
    billingHealth: { status: "healthy" },
    runtimeCapabilities: {
      containers: true,
      firecracker: false,
      confidentialComputing: false,
      notes: ["Hetzner Cloud baseline VPS; Firecracker requires KVM-capable host or dedicated provider tier."]
    },
    testConnection: { mode: "live_operator_baseline", status: "preflight_passed" }
  });
  await stepUp(client, credentialId);
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: process.env.SYLION_LIVE_OPERATOR_NAME || `SYLION Live Operator ${Date.now()}`,
    tier: process.env.SYLION_LIVE_TIER || "PRO",
    requestedTemplates: (process.env.SYLION_LIVE_TEMPLATES || "whatsapp,signal,telegram").split(",").map((item) => item.trim()).filter(Boolean),
    liveBaseline: {
      enabled: true,
      providerKey: "hetzner",
      providerId: provider.provider.id,
      region,
      serverType,
      serverTypesByRole: {
        G1: process.env.SYLION_HETZNER_G1_SERVER_TYPE || serverType,
        G2: process.env.SYLION_HETZNER_G2_SERVER_TYPE || serverType,
        WORKLOAD: process.env.SYLION_HETZNER_WORKLOAD_SERVER_TYPE || "cpx32"
      },
      image,
      sshKeys: [],
      userDataByRole: {
        G1: baseCloudInit({ role: "G1", publicKey }),
        G2: baseCloudInit({ role: "G2", publicKey }),
        WORKLOAD: workloadCloudInit({ publicKey })
      },
      idempotencyKey: process.env.SYLION_LIVE_IDEMPOTENCY_KEY || `live-operator-${Date.now()}`,
      liveConfirmed: true,
      evidenceRefs: ["script://hetzner-live-operator-baseline"]
    }
  });
  const summary = sanitizeCreated(created);
  await writeFile(join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  if (summary.status !== "executed_provider_mutation") {
    throw new Error(`Live operator baseline did not execute: ${summary.status}`);
  }
  console.log(`Hetzner live operator baseline created; evidence=${join(outputDir, "summary.json")}`);
}

await run();
