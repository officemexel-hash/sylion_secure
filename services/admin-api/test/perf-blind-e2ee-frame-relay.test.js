import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

// Mirrors BLIND_E2EE_RELAY_MAX_FRAMES in operatorPortalService.js (module-private constant).
const RELAY_MAX_FRAMES = 100;

const BLIND_E2EE_TEST_ENV = {
  SYLION_G2_SESSION_BROKER: "blind_e2ee",
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
};

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
    correlationIdFactory: () => `corr_perf_blind_relay_${crypto.randomUUID()}`
  });
  const credentialId = `cred-perf-blind-relay-${crypto.randomUUID()}`;
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
      "x-correlation-id": `corr_perf_blind_relay_operator_${crypto.randomUUID()}`,
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

async function createBlindPublicJwk() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-384" }, true, [
    "deriveKey"
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    ext: true,
    key_ops: []
  };
}

async function seedOperator(client) {
  const tenant = await client.createTenant({
    name: `Perf Blind Relay Tenant ${crypto.randomUUID()}`,
    tier: "PRO"
  });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Perf Blind Relay Operator",
    tier: "PRO"
  });
  const pixel = await client.registerDevice({
    type: "pixel_grapheneos",
    serial: `pixel-perf-blind-relay-${crypto.randomUUID()}`,
    model: "Pixel GrapheneOS relay perf test",
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

async function setupBlindSession() {
  const { app, baseUrl, close } = await startTestServer({
    liveExecutionOptions: { env: { ...BLIND_E2EE_TEST_ENV } }
  });
  const client = await loginClient(baseUrl);
  const seeded = await seedOperator(client);
  const token = seeded.session.token;
  await operatorRequest(baseUrl, token, "/operator-api/vpn-evidence", {
    method: "POST",
    body: {
      vpnConnected: true,
      vpnInterface: "tun1",
      dnsThroughTunnel: true,
      certificateTrusted: true,
      reachableHosts: [
        "admin.sylion.internal",
        "operator.sylion.internal",
        "signal.sylion.internal",
        "10.42.0.12"
      ]
    }
  });
  await operatorRequest(baseUrl, token, "/operator-api/streaming-readiness", {
    method: "POST",
    body: {
      g2StreamGatewayReady: true,
      tlsInternalOnly: true,
      inputProxyReady: true,
      protocol: "blind_e2ee",
      e2eeStream: true,
      sframeValidated: true,
      keySeparationVerified: true,
      keysHeldByBroker: false,
      sources: { signal: true }
    }
  });
  await operatorRequest(baseUrl, token, "/operator-api/streaming-runtime-manifest", {
    method: "POST",
    body: {
      gateway: {
        bindAddress: "10.42.0.12",
        port: 8443,
        protocol: "blind_e2ee",
        tlsMode: "internal_tls_only",
        e2eeStream: true,
        sframeValidated: true,
        keySeparationVerified: true,
        keysHeldByBroker: false,
        workloadMicroVmLink: "firecracker_vsock_sframe_encoder",
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
  const terminalPublicKeyJwk = await createBlindPublicJwk();
  const blind = await operatorRequest(baseUrl, token, "/operator-api/blind-e2ee/sessions", {
    method: "POST",
    body: { templateKey: "signal", width: 390, height: 844, dpr: 3, terminalPublicKeyJwk }
  });
  assert.equal(blind.session.state, "blind_e2ee_session_ready");
  return { app, baseUrl, close, token, blind: blind.session };
}

async function postFrame(baseUrl, token, blind, { sequence, ciphertext }) {
  const workloadPublicKeyJwk = await createBlindPublicJwk();
  return operatorRequest(baseUrl, token, blind.frameEnvelope.ingestEndpoint, {
    method: "POST",
    body: {
      frameId: `frame_perf_${String(sequence).padStart(3, "0")}`,
      keyId: blind.keyManagement.keyId,
      algorithm: "ECDH_P384_AES_256_GCM_FRAME_V1",
      contentType: "application/octet-stream",
      ivB64: Buffer.from("123456789012").toString("base64"),
      workloadPublicKeyJwk,
      ciphertextB64: ciphertext.toString("base64"),
      sframeHeaderB64: Buffer.from("sframe-header").toString("base64"),
      authTagLength: 16,
      sequence,
      width: 390,
      height: 844
    }
  });
}

function syntheticRelayEntry(sessionId, expiresAt) {
  return {
    sessionId,
    operatorId: "op_synthetic",
    tenantId: "tenant_synthetic",
    templateKey: "signal",
    frameId: `frame_${sessionId}`,
    sequence: 1,
    expiresAt,
    receivedAt: new Date().toISOString()
  };
}

test("perf: blind E2EE relay evicts expired frames lazily on read and write", async () => {
  const { app, baseUrl, close, token, blind } = await setupBlindSession();
  try {
    const relay = app.services.operatorPortal.blindE2eeFrameRelay;
    const ciphertext = Buffer.from("encrypted-frame-ttl-check");
    await postFrame(baseUrl, token, blind, { sequence: 1, ciphertext });
    assert.equal(relay.has(blind.id), true);

    const ready = await operatorRequest(baseUrl, token, blind.frameEnvelope.latestFrameEndpoint);
    assert.equal(ready.relay.state, "blind_e2ee_frame_ready");
    assert.equal(ready.relay.latestFrameAvailable, true);
    assert.equal(ready.relay.frame.ciphertextB64, ciphertext.toString("base64"));

    // Force the stored frame past its TTL and confirm the read path sweeps it out.
    relay.get(blind.id).expiresAt = new Date(Date.now() - 1000).toISOString();
    const expired = await operatorRequest(baseUrl, token, blind.frameEnvelope.latestFrameEndpoint);
    assert.equal(expired.relay.state, "blind_e2ee_frame_pending");
    assert.equal(expired.relay.latestFrameAvailable, false);
    assert.equal(expired.relay.frame, null);
    assert.equal(relay.has(blind.id), false);

    // Sweep also runs on the write path: stale foreign entries disappear on the next ingest.
    relay.set(
      "synthetic_expired_session",
      syntheticRelayEntry("synthetic_expired_session", new Date(Date.now() - 1000).toISOString())
    );
    const next = Buffer.from("encrypted-frame-after-expiry");
    await postFrame(baseUrl, token, blind, { sequence: 2, ciphertext: next });
    assert.equal(relay.has("synthetic_expired_session"), false);
    assert.equal(relay.has(blind.id), true);

    const refreshed = await operatorRequest(
      baseUrl,
      token,
      blind.frameEnvelope.latestFrameEndpoint
    );
    assert.equal(refreshed.relay.state, "blind_e2ee_frame_ready");
    assert.equal(refreshed.relay.frame.ciphertextB64, next.toString("base64"));
  } finally {
    await close();
  }
});

test("perf: blind E2EE relay enforces hard size cap by evicting the oldest entry", async () => {
  const { app, baseUrl, close, token, blind } = await setupBlindSession();
  try {
    const relay = app.services.operatorPortal.blindE2eeFrameRelay;
    const future = new Date(Date.now() + 60_000).toISOString();
    for (let i = 0; i < RELAY_MAX_FRAMES; i += 1) {
      const sessionId = `synthetic_session_${String(i).padStart(3, "0")}`;
      relay.set(sessionId, syntheticRelayEntry(sessionId, future));
    }
    assert.equal(relay.size, RELAY_MAX_FRAMES);

    const ciphertext = Buffer.from("encrypted-frame-capacity-check");
    await postFrame(baseUrl, token, blind, { sequence: 1, ciphertext });
    assert.equal(relay.size, RELAY_MAX_FRAMES);
    assert.equal(relay.has("synthetic_session_000"), false);
    assert.equal(relay.has("synthetic_session_001"), true);
    assert.equal(relay.has(blind.id), true);

    // Re-writing the same session must not evict other entries (delete + set, not net growth).
    const second = Buffer.from("encrypted-frame-capacity-rewrite");
    await postFrame(baseUrl, token, blind, { sequence: 2, ciphertext: second });
    assert.equal(relay.size, RELAY_MAX_FRAMES);
    assert.equal(relay.has("synthetic_session_001"), true);
    assert.equal(relay.has(blind.id), true);

    // Result must be identical to a full-scan lookup: the latest frame survives intact.
    const latest = await operatorRequest(baseUrl, token, blind.frameEnvelope.latestFrameEndpoint);
    assert.equal(latest.relay.state, "blind_e2ee_frame_ready");
    assert.equal(latest.relay.latestFrameAvailable, true);
    assert.equal(latest.relay.frame.ciphertextB64, second.toString("base64"));
    assert.equal(latest.relay.frame.sequence, 2);
    assert.equal(latest.relay.security.brokerPersistsCiphertextBytes, false);
  } finally {
    await close();
  }
});
