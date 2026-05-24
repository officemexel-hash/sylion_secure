import assert from "node:assert/strict";
import { createDecipheriv, createHmac } from "node:crypto";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";
import {
  publicPlan as guacamolePlan,
  renderCompose as renderGuacamoleCompose,
  renderLaunchShimHtml,
  renderLaunchShimJs,
  renderNginx as renderGuacamoleNginx
} from "../../../scripts/install-g2-guacamole-broker.mjs";

async function startTestServer(options = {}) {
  const app = createApp(options);
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    app,
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

function decryptGuacamoleData(data, secretHex) {
  const key = Buffer.from(secretHex, "hex");
  const iv = Buffer.alloc(16, 0);
  const ciphertext = Buffer.from(data, "base64");
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  const signedJson = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const signature = signedJson.subarray(0, 32);
  const json = signedJson.subarray(32);
  assert.deepEqual(signature, createHmac("sha256", key).update(json).digest());
  return JSON.parse(json.toString("utf8"));
}

function decodeBase64Url(value) {
  return Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
}

test("Step 3.79 Guacamole deploy plan stays private and does not print secrets", () => {
  const plan = guacamolePlan();
  const compose = renderGuacamoleCompose();
  const nginx = renderGuacamoleNginx();
  const launchShimHtml = renderLaunchShimHtml();
  const launchShimJs = renderLaunchShimJs();

  assert.equal(plan.gateway.bindAddress, "10.42.0.12");
  assert.equal(plan.gateway.serverName, "session.sylion.internal");
  assert.equal(plan.invariants.privateBindOnly, true);
  assert.equal(plan.invariants.noVncProductionApproved, false);
  assert.equal(plan.invariants.guacamoleToGuacdTransport, "tls");
  assert.equal(plan.invariants.guacdPlaintextForbidden, true);
  assert.equal(plan.invariants.guacamoleTrustsGuacdCertificate, true);
  assert.equal(plan.invariants.jsonAuthHandoffEnabled, true);
  assert.equal(plan.runtime.jsonAuthSecretPrinted, false);
  assert.equal(plan.runtime.postgresPasswordPrinted, false);
  assert.equal(plan.runtime.publicDir, "/opt/sylion-guacamole/public");
  assert.match(compose, /guacamole\/guacamole:1\.6\.0/);
  assert.match(compose, /guacamole\/guacd:1\.6\.0/);
  assert.match(compose, /GUACD_SSL: "true"/);
  assert.match(compose, /JSON_SECRET_KEY: \$\{GUACAMOLE_JSON_SECRET_KEY\}/);
  assert.match(compose, /javax\.net\.ssl\.trustStore=\/etc\/guacamole\/trust\/guacd-truststore\.p12/);
  assert.match(compose, /\/opt\/sylion-guacamole\/extensions:\/etc\/guacamole\/extensions:ro/);
  assert.match(compose, /\/opt\/sylion-guacamole\/trust:\/etc\/guacamole\/trust:ro/);
  assert.doesNotMatch(compose, /\/usr\/local\/sbin\/guacd/);
  assert.match(compose, /- -C\s+- \/etc\/guacamole\/tls\/guacd\.crt/s);
  assert.match(compose, /- -K\s+- \/etc\/guacamole\/tls\/guacd\.key/s);
  assert.match(compose, /POSTGRES_PASSWORD: \$\{GUACAMOLE_POSTGRES_PASSWORD\}/);
  assert.doesNotMatch(compose, /guacadmin/);
  assert.match(nginx, /listen 10\.42\.0\.12:443 ssl default_server;/);
  assert.match(nginx, /server_name session\.sylion\.internal 10\.42\.0\.12;/);
  assert.match(nginx, /ssl_certificate \/etc\/sylion\/tls\/sylion-internal-server-chain\.crt;/);
  assert.match(nginx, /ssl_certificate_key \/etc\/sylion\/tls\/sylion-internal-server\.key;/);
  assert.match(nginx, /X-Sylion-Session-Broker "guacamole"/);
  assert.match(nginx, /X-Sylion-Guacd-Transport "tls"/);
  assert.match(nginx, /X-Sylion-File-Transfer "disabled_until_cdr_gate"/);
  assert.match(nginx, /location = \/sylion-launch\.html/);
  assert.match(nginx, /location = \/sylion-launch\.js/);
  assert.match(nginx, /X-Sylion-Session-Launch-Shim "guacamole_state_reset"/);
  assert.match(nginx, /Content-Security-Policy "default-src 'none'; script-src 'self'; connect-src 'self'/);
  assert.match(nginx, /frame-ancestors https:\/\/operator\.sylion\.internal/);
  assert.doesNotMatch(nginx, /frame-ancestors 'none'/);
  assert.doesNotMatch(nginx, /listen 0\.0\.0\.0/);
  assert.match(launchShimHtml, /<script src="\/sylion-launch\.js"><\/script>/);
  assert.match(launchShimJs, /localStorage\.key/);
  assert.match(launchShimJs, /key\.startsWith\("GUAC_"\)/);
  assert.match(launchShimJs, /sessionStorage\.clear/);
  assert.match(launchShimJs, /params\.get\("client"\)/);
  assert.match(launchShimJs, /params\.get\("data"\)/);
  assert.match(launchShimJs, /fetch\("\/guacamole\/api\/tokens"/);
  assert.match(launchShimJs, /credentials: "omit"/);
  assert.match(launchShimJs, /referrerPolicy: "no-referrer"/);
  assert.match(launchShimJs, /window\.location\.replace\(`\/guacamole\/#\/client\//);
  assert.match(launchShimJs, /window\.history\.replaceState/);
  assert.doesNotMatch(launchShimJs, /http:|https:|eval|innerHTML|document\.cookie/);
});

test("Step 3.79 noVNC is blocked as lab-only session broker", async () => {
  const { app, baseUrl, close } = await startTestServer({
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
  const { app, baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_G2_SESSION_BROKER: "guacamole",
        SYLION_GUACAMOLE_JSON_SECRET_KEY: "00112233445566778899aabbccddeeff",
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
        guacdTls: true,
        g2ToWorkloadEncrypted: true,
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
          guacdTls: true,
          g2ToWorkloadEncrypted: true,
          workloadMicroVmLink: "host_local_tap_or_vsock",
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
    assert.equal(session.session.gateway.launchMode, "guacamole_json_auth_handoff");
    assert.equal(session.session.gateway.brokerConnectionName, "SYLION Signal");
    assert.equal(session.session.gateway.broker.encryption.guacamoleWebappToGuacd, "tls_required");
    assert.equal(session.session.gateway.broker.encryption.g2ToWorkload, "tls_stunnel_or_ipsec_required");
    assert.equal(session.session.launchUrl, "/operator/stream.html?app=signal&broker=guacamole");
    assert.equal(session.session.source.directProbeUrl, "https://signal.sylion.internal/");
    assert.equal(session.session.security.terminalDataStored, false);
    assert.equal(session.session.stream.fileTransfer, "cdr_required");
  } finally {
    await close();
  }
});

test("Step 3.91 Guacamole JSON handoff returns encrypted app-scoped launch URL without storing token material", async () => {
  const secretHex = "00112233445566778899aabbccddeeff";
  const { app, baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_G2_SESSION_BROKER: "guacamole",
        SYLION_GUACAMOLE_JSON_SECRET_KEY: secretHex,
        SYLION_GUACAMOLE_BROKER_READY: "true",
        SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL: "true",
        SYLION_G1_G2_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_GATEWAY_READY: "true",
        SYLION_REAL_IPSEC_READY: "true",
        SYLION_KVM_READY: "true",
        SYLION_WORKLOAD_STREAM_SOURCE_READY: "true",
        SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true",
        SYLION_EXODUS_RISK_ACCEPTED: "true",
        SYLION_ZANGI_ANDROID_NATIVE_APPROVED: "true"
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
        guacdTls: true,
        g2ToWorkloadEncrypted: true,
        inputProxyReady: true,
        protocol: "guacamole",
        sources: { signal: true }
      }
    });

    const handoff = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/guacamole-handoff", {
      method: "POST",
      body: { templateKey: "signal", width: 390, height: 844, dpr: 3 }
    });
    assert.equal(handoff.handoff.state, "guacamole_handoff_ready");
    assert.match(handoff.handoff.launchUrl, /^https:\/\/session\.sylion\.internal\/sylion-launch\.html#client=/);
    assert.equal(handoff.handoff.security.urlContainsPassword, false);
    assert.equal(handoff.handoff.security.plaintextCredentialsReturned, false);
    assert.equal(handoff.handoff.security.tokenMaterialStored, false);
    assert.equal(handoff.handoff.security.auditStoresLaunchUrl, false);
    assert.equal(handoff.handoff.security.guacamoleStateResetBeforeLaunch, true);
    assert.equal(handoff.handoff.security.jsonAuthDataInBrowserFragmentOnly, true);
    assert.equal(handoff.handoff.security.guacamoleTokenMintedBySessionOriginShim, true);
    assert.equal(handoff.handoff.security.guacamoleTokenInBrowserFragmentOnly, true);
    assert.equal(handoff.handoff.stream.terminalDataStored, false);
    assert.equal(handoff.handoff.broker.connectionName, "SYLION Signal");
    assert.equal(
      decodeBase64Url(handoff.handoff.broker.clientIdentifier),
      "SYLION Signal\0c\0json"
    );
    assert.doesNotMatch(handoff.handoff.broker.clientIdentifier, /[+/=]/);
    assert.doesNotMatch(handoff.handoff.launchUrl, /password|guacadmin|otp|phone/i);

    const shimUrl = new URL(handoff.handoff.launchUrl);
    assert.equal(shimUrl.pathname, "/sylion-launch.html");
    assert.equal(shimUrl.searchParams.has("data"), false);
    assert.equal(shimUrl.searchParams.has("client"), false);
    assert.equal(shimUrl.search, "");
    const shimParams = new URLSearchParams(shimUrl.hash.slice(1));
    assert.equal(shimParams.get("client"), handoff.handoff.broker.clientIdentifier);
    assert.equal(shimParams.has("data"), true);
    const route = `/client/${shimParams.get("client")}`;
    const query = `data=${encodeURIComponent(shimParams.get("data"))}`;
    assert.equal(route, `/client/${handoff.handoff.broker.clientIdentifier}`);
    const hashParams = new URLSearchParams(query);
    assert.equal(hashParams.has("data"), true);
    const payload = decryptGuacamoleData(hashParams.get("data"), secretHex);
    assert.equal(payload.connections["SYLION Signal"].protocol, "vnc");
    assert.equal(payload.connections["SYLION Signal"].parameters.hostname, "172.18.0.1");
    assert.equal(payload.connections["SYLION Signal"].parameters.port, "15913");
    assert.equal(payload.connections["SYLION Signal"].parameters["disable-copy"], "true");
    assert.equal(payload.connections["SYLION Signal"].parameters["disable-paste"], "true");
    assert.ok(Number(payload.expires) > Date.now());

    const handoffEvent = app.services.audit.list().find((event) => event.action === "operator_portal.guacamole_handoff_created");
    assert.ok(handoffEvent);
    assert.equal(handoffEvent.newValue.launchUrl, "redacted_ephemeral_guacamole_json_auth_url");
    assert.equal(JSON.stringify(handoffEvent).includes("data="), false);
  } finally {
    await close();
  }
});

test("Step 3.100 workload input bridge sends metadata-only VNC key events", async () => {
  const calls = [];
  const secretHex = "00112233445566778899aabbccddeeff";
  const { app, baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_G2_SESSION_BROKER: "guacamole",
        SYLION_GUACAMOLE_JSON_SECRET_KEY: secretHex,
        SYLION_GUACAMOLE_BROKER_READY: "true",
        SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL: "true",
        SYLION_G1_G2_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_GATEWAY_READY: "true",
        SYLION_WORKLOAD_INPUT_BRIDGE_ENABLED: "true",
        SYLION_REAL_IPSEC_READY: "true",
        SYLION_KVM_READY: "true",
        SYLION_WORKLOAD_STREAM_SOURCE_READY: "true",
        SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true"
      },
      workloadInputRunner: async ({ app, text, submit, preKeys = [], postKeys = [] }) => {
        calls.push({ app, text, submit, preKeys, postKeys });
        const keyEvents = [...preKeys, ...postKeys].reduce((total, key) => total + (key === "select_all" ? 2 : 1), 0);
        return {
          component: "g2_vnc_input_bridge",
          app,
          port: 15901,
          keysSent: text.length + (submit ? 1 : 0) + keyEvents,
          specialKeysSent: preKeys.length + postKeys.length + (submit ? 1 : 0),
          submitSent: submit,
          framebuffer: { width: 390, height: 844 },
          securityType: "none",
          inputContentPrinted: false,
          terminalDataStored: false
        };
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
        reachableHosts: ["admin.sylion.internal", "operator.sylion.internal", "signal.sylion.internal", "duckduckgo.sylion.internal", "10.42.0.12"]
      }
    });
    await operatorRequest(baseUrl, seeded.session.token, "/operator-api/streaming-readiness", {
      method: "POST",
      body: {
        g2StreamGatewayReady: true,
        tlsInternalOnly: true,
        guacdTls: true,
        g2ToWorkloadEncrypted: true,
        inputProxyReady: true,
        protocol: "guacamole",
        sources: { duckduckgo_browser: true }
      }
    });

    const input = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/workload-input", {
      method: "POST",
      body: { templateKey: "duckduckgo_browser", preKeys: ["select_all"], text: "sylion secure", submit: true, postKeys: ["backspace"] }
    });
    assert.equal(input.input.state, "workload_input_sent");
    assert.equal(input.input.request.textLength, 13);
    assert.equal(input.input.request.preKeyCount, 1);
    assert.equal(input.input.request.postKeyCount, 1);
    assert.equal(input.input.request.specialKeyCount, 3);
    assert.equal(input.input.request.contentStored, false);
    assert.equal(input.input.request.contentAudited, false);
    assert.equal(input.input.security.inputContentReturned, false);
    assert.equal(input.input.security.inputContentAudited, false);
    assert.equal(input.input.result.keysSent, 17);
    assert.equal(input.input.result.specialKeysSent, 3);
    assert.equal(input.input.result.submitSent, true);
    assert.equal(JSON.stringify(input).includes("sylion secure"), false);

    const keyOnly = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/workload-input", {
      method: "POST",
      body: { templateKey: "duckduckgo_browser", postKeys: ["backspace"] }
    });
    assert.equal(keyOnly.input.state, "workload_input_sent");
    assert.equal(keyOnly.input.request.textLength, 0);
    assert.equal(keyOnly.input.request.specialKeyCount, 1);
    assert.equal(keyOnly.input.result.keysSent, 1);
    assert.equal(keyOnly.input.result.specialKeysSent, 1);
    assert.deepEqual(calls, [
      { app: "duckduckgo_browser", text: "sylion secure", submit: true, preKeys: ["select_all"], postKeys: ["backspace"] },
      { app: "duckduckgo_browser", text: "", submit: false, preKeys: [], postKeys: ["backspace"] }
    ]);

    const event = app.services.audit.list().find((event) => event.action === "operator_portal.workload_input_events_sent");
    assert.ok(event);
    assert.equal(JSON.stringify(event).includes("sylion secure"), false);
    assert.equal(event.newValue.request.textLength, 13);
    assert.equal(event.newValue.request.specialKeyCount, 3);
    assert.equal(event.newValue.request.contentStored, false);
  } finally {
    await close();
  }
});

test("Step 3.100 workload input bridge blocks until explicitly enabled", async () => {
  const { baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_G2_SESSION_BROKER: "guacamole",
        SYLION_GUACAMOLE_JSON_SECRET_KEY: "00112233445566778899aabbccddeeff",
        SYLION_GUACAMOLE_BROKER_READY: "true",
        SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL: "true",
        SYLION_G1_G2_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_GATEWAY_READY: "true",
        SYLION_REAL_IPSEC_READY: "true",
        SYLION_KVM_READY: "true",
        SYLION_WORKLOAD_STREAM_SOURCE_READY: "true",
        SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true"
      },
      workloadInputRunner: async () => {
        throw new Error("runner_should_not_be_called");
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
        reachableHosts: ["admin.sylion.internal", "operator.sylion.internal", "signal.sylion.internal", "duckduckgo.sylion.internal", "10.42.0.12"]
      }
    });
    const input = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/workload-input", {
      method: "POST",
      body: { templateKey: "duckduckgo_browser", text: "shouldnotappear" }
    });
    assert.equal(input.input.state, "workload_input_blocked");
    assert.ok(input.input.blockers.includes("workload_input_bridge_not_enabled"));
    assert.equal(JSON.stringify(input).includes("shouldnotappear"), false);
  } finally {
    await close();
  }
});

test("Step 3.91 Guacamole JSON handoff blocks when the shared JSON secret is absent", async () => {
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
        SYLION_WORKLOAD_STREAM_SOURCE_READY: "true",
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
    const handoff = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/guacamole-handoff", {
      method: "POST",
      body: { templateKey: "signal", width: 390, height: 844, dpr: 3 }
    });
    assert.equal(handoff.handoff.state, "guacamole_handoff_blocked");
    assert.equal(handoff.handoff.launchUrl, null);
    assert.ok(handoff.handoff.blockers.includes("guacamole_json_auth_secret_missing"));
  } finally {
    await close();
  }
});
