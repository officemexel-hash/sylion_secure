import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";
import {
  publicPlan as guacamolePlan,
  renderCompose as renderGuacamoleCompose,
  renderNginx as renderGuacamoleNginx
} from "../../../scripts/install-g2-guacamole-broker.mjs";

async function startTestServer(options = {}) {
  const app = createApp(options);
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function loginClient(baseUrl) {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_step3_79_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-79-${crypto.randomUUID()}`;
  const enrollment = await anon.createEnrollmentOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  await anon.verifyEnrollment({
    challengeId: enrollment.challenge.id,
    credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
  });
  const loginOptions = await anon.createWebAuthnLoginOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  const session = await anon.verifyWebAuthnLogin({
    challengeId: loginOptions.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${loginOptions.challenge.id}:${credentialId}`,
      signCounter: 1
    }
  });
  return anon.withToken(session.token);
}

async function operatorRequest(baseUrl, token, path, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": `corr_step3_79_operator_${crypto.randomUUID()}`,
      authorization: `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "operator request failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function seedOperator(client) {
  const tenant = await client.createTenant({ name: `Step 3.79 Tenant ${crypto.randomUUID()}`, tier: "PRO" });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Step 3.79 Operator",
    tier: "PRO"
  });
  const pixel = await client.registerDevice({
    type: "pixel_grapheneos",
    serial: `pixel-step3-79-${crypto.randomUUID()}`,
    model: "Pixel GrapheneOS session broker test",
    assignedOperatorId: created.operator.id,
    posture: { state: "adb_lab_ready", os: "GrapheneOS" }
  });
  const session = await client.request("/operator-api/sessions/local-simulator", {
    method: "POST",
    body: {
      operatorId: created.operator.id,
      terminalMode: "pixel_grapheneos",
      deviceId: pixel.device.id
    }
  });
  return { operator: created.operator, session: session.session };
}

test("Step 3.79 Guacamole deploy plan stays private and does not print secrets", () => {
  const plan = guacamolePlan();
  const compose = renderGuacamoleCompose();
  const nginx = renderGuacamoleNginx();

  assert.equal(plan.gateway.bindAddress, "10.42.0.12");
  assert.equal(plan.gateway.serverName, "session.sylion.internal");
  assert.equal(plan.invariants.privateBindOnly, true);
  assert.equal(plan.invariants.noVncProductionApproved, false);
  assert.equal(plan.runtime.postgresPasswordPrinted, false);
  assert.match(compose, /guacamole\/guacamole:1\.6\.0/);
  assert.match(compose, /guacamole\/guacd:1\.6\.0/);
  assert.match(compose, /POSTGRES_PASSWORD: \$\{GUACAMOLE_POSTGRES_PASSWORD\}/);
  assert.doesNotMatch(compose, /guacadmin/);
  assert.match(nginx, /listen 10\.42\.0\.12:443 ssl default_server;/);
  assert.match(nginx, /server_name session\.sylion\.internal 10\.42\.0\.12;/);
  assert.match(nginx, /ssl_certificate \/etc\/sylion\/tls\/sylion-internal-server-chain\.crt;/);
  assert.match(nginx, /ssl_certificate_key \/etc\/sylion\/tls\/sylion-internal-server\.key;/);
  assert.match(nginx, /X-Sylion-Session-Broker "guacamole"/);
  assert.match(nginx, /X-Sylion-File-Transfer "disabled_until_cdr_gate"/);
  assert.doesNotMatch(nginx, /listen 0\.0\.0\.0/);
});

test("Step 3.79 noVNC is blocked as lab-only session broker", async () => {
  const { baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL: "true",
        SYLION_G1_G2_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_GATEWAY_READY: "true",
        SYLION_REAL_IPSEC_READY: "true",
        SYLION_KVM_READY: "true",
        SYLION_FIRECRACKER_BIN: "/usr/local/bin/firecracker",
        SYLION_FIRECRACKER_KERNEL: "image://kernel",
        SYLION_SIGNAL_ROOTFS: "image://rootfs",
        SYLION_SIGNAL_WORKLOAD_IMAGE_REF: "image://workload",
        SYLION_SIGNAL_PACKAGE_REF: "package://signal",
        SYLION_SIGNAL_ACCOUNT_REF: "account://signal",
        SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true"
      }
    }
  });
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client);
    await operatorRequest(baseUrl, seeded.session.token, "/operator-api/vpn-evidence", {
      method: "POST",
      body: {
        vpnConnected: true,
        vpnInterface: "tun1",
        dnsThroughTunnel: true,
        certificateTrusted: true,
        reachableHosts: ["admin.sylion.internal", "operator.sylion.internal", "signal.sylion.internal", "10.42.0.12"]
      }
    });
    const readiness = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/streaming-readiness", {
      method: "POST",
      body: {
        g2StreamGatewayReady: true,
        tlsInternalOnly: true,
        inputProxyReady: true,
        protocol: "novnc_lab",
        sources: { signal: true }
      }
    });
    assert.equal(readiness.evidence.ready, false);
    assert.equal(readiness.evidence.broker.labOnly, true);
    assert.ok(readiness.evidence.blockers.includes("novnc_lab_only_not_approved_for_production_broker"));

    const session = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/streaming-sessions", {
      method: "POST",
      body: { templateKey: "signal", protocol: "novnc_lab", width: 390, height: 844, dpr: 3 }
    });
    assert.equal(session.session.state, "stream_session_blocked");
    assert.equal(session.session.gateway.broker.labOnly, true);
    assert.ok(session.session.blockers.includes("novnc_lab_only_not_approved_for_production_broker"));
  } finally {
    await close();
  }
});

test("Step 3.79 Guacamole can satisfy the G2 broker candidate gate without terminal data", async () => {
  const { baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_G2_SESSION_BROKER: "guacamole",
        SYLION_GUACAMOLE_BROKER_READY: "true",
        SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL: "true",
        SYLION_G1_G2_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_GATEWAY_READY: "true",
        SYLION_REAL_IPSEC_READY: "true",
        SYLION_KVM_READY: "true",
        SYLION_FIRECRACKER_BIN: "/usr/local/bin/firecracker",
        SYLION_FIRECRACKER_KERNEL: "image://kernel",
        SYLION_SIGNAL_ROOTFS: "image://rootfs",
        SYLION_SIGNAL_WORKLOAD_IMAGE_REF: "image://workload",
        SYLION_SIGNAL_PACKAGE_REF: "package://signal",
        SYLION_SIGNAL_ACCOUNT_REF: "account://signal",
        SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true"
      }
    }
  });
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client);
    await operatorRequest(baseUrl, seeded.session.token, "/operator-api/vpn-evidence", {
      method: "POST",
      body: {
        vpnConnected: true,
        vpnInterface: "tun1",
        dnsThroughTunnel: true,
        certificateTrusted: true,
        reachableHosts: ["admin.sylion.internal", "operator.sylion.internal", "signal.sylion.internal", "10.42.0.12"]
      }
    });
    await operatorRequest(baseUrl, seeded.session.token, "/operator-api/streaming-readiness", {
      method: "POST",
      body: {
        g2StreamGatewayReady: true,
        tlsInternalOnly: true,
        inputProxyReady: true,
        protocol: "guacamole",
        sources: { signal: true }
      }
    });
    await operatorRequest(baseUrl, seeded.session.token, "/operator-api/streaming-runtime-manifest", {
      method: "POST",
      body: {
        gateway: {
          bindAddress: "10.42.0.12",
          port: 8443,
          protocol: "guacamole",
          tlsMode: "internal_tls_only",
          publicInternetExposure: false
        },
        sources: {
          signal: {
            bindAddress: "10.44.0.13",
            port: 3013,
            healthPath: "/healthz",
            cdrRequired: true
          }
        }
      }
    });
    const session = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/streaming-sessions", {
      method: "POST",
      body: { templateKey: "signal", protocol: "guacamole", width: 390, height: 844, dpr: 3 }
    });
    assert.equal(session.session.state, "stream_session_ready");
    assert.equal(session.session.gateway.protocol, "guacamole");
    assert.equal(session.session.gateway.broker.productionCandidate, true);
    assert.equal(session.session.gateway.launchMode, "guacamole_connection_picker");
    assert.equal(session.session.gateway.brokerConnectionName, "SYLION Signal");
    assert.equal(session.session.launchUrl, "https://session.sylion.internal/guacamole/");
    assert.equal(session.session.source.directProbeUrl, "https://signal.sylion.internal/");
    assert.equal(session.session.security.terminalDataStored, false);
    assert.equal(session.session.stream.fileTransfer, "cdr_required");
  } finally {
    await close();
  }
});
