import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";
import {
  decryptFrameForTest,
  encodePngRgba,
  encodeOnce,
  encryptFrame
} from "../../../scripts/blind-e2ee-workload-frame-encoder.mjs";

const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZxZ2wAAAABJRU5ErkJggg==",
  "base64"
);

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
    correlationIdFactory: () => `corr_step3_114_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-114-${crypto.randomUUID()}`;
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
      "x-correlation-id": `corr_step3_114_operator_${crypto.randomUUID()}`,
      authorization: `Bearer ${token}`,
      "x-sylion-operator-csrf": "same-origin-ui"
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

async function terminalKeyPair() {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-384" }, true, [
    "deriveKey"
  ]);
  const publicJwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    pair,
    publicJwk: {
      kty: publicJwk.kty,
      crv: publicJwk.crv,
      x: publicJwk.x,
      y: publicJwk.y,
      ext: true,
      key_ops: []
    }
  };
}

async function seedOperator(client) {
  const tenant = await client.createTenant({
    name: `Step 3.114 Tenant ${crypto.randomUUID()}`,
    tier: "PRO"
  });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Step 3.114 Operator",
    tier: "PRO"
  });
  const pixel = await client.registerDevice({
    type: "pixel_grapheneos",
    serial: `pixel-step3-114-${crypto.randomUUID()}`,
    model: "Pixel GrapheneOS blind encoder test",
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

async function seedBlindReadiness(baseUrl, token) {
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
        "duckduckgo.sylion.internal",
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
      sources: { duckduckgo_browser: true }
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
        duckduckgo_browser: {
          bindAddress: "10.44.0.13",
          port: 3001,
          healthPath: "/healthz",
          cdrRequired: true
        }
      }
    }
  });
}

test("Step 3.114 workload encoder encrypts image frames that only the terminal key can decrypt", async () => {
  const terminal = await terminalKeyPair();
  const frame = await encryptFrame({
    plaintext: SAMPLE_PNG,
    terminalPublicKeyJwk: terminal.publicJwk,
    sessionId: "blind_stream_step3_114",
    keyId: "sframe_step3_114",
    templateKey: "duckduckgo_browser",
    sequence: 7,
    width: 390,
    height: 844,
    contentType: "image/png",
    timestampMs: 1_800_000_000_000
  });

  assert.equal(frame.algorithm, "ECDH_P384_AES_256_GCM_FRAME_V1");
  assert.equal(frame.contentType, "image/png");
  assert.equal(frame.authTagLength, 16);
  assert.equal(frame.workloadPublicKeyJwk.crv, "P-384");
  assert.equal(Object.hasOwn(frame.workloadPublicKeyJwk, "d"), false);
  assert.notEqual(frame.ciphertextB64, SAMPLE_PNG.toString("base64"));
  assert.equal(JSON.stringify(frame).includes(SAMPLE_PNG.toString("base64")), false);

  const decrypted = await decryptFrameForTest({
    frame,
    terminalPrivateKey: terminal.pair.privateKey
  });
  assert.deepEqual(decrypted, SAMPLE_PNG);
});

test("Step 3.114 encoder can build renderable PNG from raw RFB RGBA bytes", () => {
  const png = encodePngRgba({
    width: 2,
    height: 1,
    rgba: Buffer.from([255, 0, 0, 255, 0, 128, 255, 255])
  });
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.includes(Buffer.from("IHDR")), true);
  assert.equal(png.includes(Buffer.from("IDAT")), true);
  assert.equal(png.includes(Buffer.from("IEND")), true);
});

test("Step 3.114 blind relay accepts workload encoder envelope and exposes ciphertext only", async () => {
  const { app, baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_G2_SESSION_BROKER: "blind_e2ee",
        SYLION_BLIND_E2EE_STREAM_READY: "true",
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
    await seedBlindReadiness(baseUrl, seeded.session.token);
    const terminal = await terminalKeyPair();
    const blind = await operatorRequest(
      baseUrl,
      seeded.session.token,
      "/operator-api/blind-e2ee/sessions",
      {
        method: "POST",
        body: {
          templateKey: "duckduckgo_browser",
          width: 390,
          height: 844,
          dpr: 3,
          terminalPublicKeyJwk: terminal.publicJwk
        }
      }
    );
    assert.equal(blind.session.state, "blind_e2ee_session_ready");

    const frame = await encryptFrame({
      plaintext: SAMPLE_PNG,
      terminalPublicKeyJwk: terminal.publicJwk,
      sessionId: blind.session.id,
      keyId: blind.session.keyManagement.keyId,
      templateKey: "duckduckgo_browser",
      sequence: 1,
      width: 390,
      height: 844,
      contentType: "image/png"
    });
    const proof = await operatorRequest(
      baseUrl,
      seeded.session.token,
      blind.session.frameEnvelope.ingestEndpoint,
      {
        method: "POST",
        body: frame
      }
    );
    assert.equal(proof.frame.ciphertextSha256, frame.ciphertextSha256);
    assert.equal(proof.frame.brokerCanDecrypt, false);
    assert.equal(proof.frame.brokerPersistsCiphertextBytes, false);

    const latest = await operatorRequest(
      baseUrl,
      seeded.session.token,
      blind.session.frameEnvelope.latestFrameEndpoint
    );
    assert.equal(latest.relay.latestFrameAvailable, true);
    assert.equal(latest.relay.frame.ciphertextB64, frame.ciphertextB64);
    assert.equal(latest.relay.frame.contentType, "image/png");
    assert.equal(latest.relay.security.keysAvailableToG2, false);
    assert.equal(latest.relay.security.plaintextIncluded, false);

    const decrypted = await decryptFrameForTest({
      frame: latest.relay.frame,
      terminalPrivateKey: terminal.pair.privateKey
    });
    assert.deepEqual(decrypted, SAMPLE_PNG);

    const auditText = JSON.stringify(
      app.services.audit.list().filter((event) => event.action.includes("blind_e2ee"))
    );
    assert.equal(auditText.includes(SAMPLE_PNG.toString("base64")), false);
    assert.equal(auditText.includes(frame.ciphertextB64), false);
  } finally {
    await close();
  }
});

test("Step 3.114 capture-once activates workload encoder runner and publishes decryptable frame", async () => {
  const terminal = await terminalKeyPair();
  const { app, baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_G2_SESSION_BROKER: "blind_e2ee",
        SYLION_BLIND_E2EE_STREAM_READY: "true",
        SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL: "true",
        SYLION_G1_G2_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_GATEWAY_READY: "true",
        SYLION_REAL_IPSEC_READY: "true",
        SYLION_KVM_READY: "true",
        SYLION_WORKLOAD_STREAM_SOURCE_READY: "true",
        SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true"
      },
      blindE2eeFrameCaptureRunner: async ({ session }) =>
        encryptFrame({
          plaintext: SAMPLE_PNG,
          terminalPublicKeyJwk: session.keyManagement.terminalPublicKeyJwk,
          sessionId: session.id,
          keyId: session.keyManagement.keyId,
          templateKey: session.templateKey,
          sequence: 3,
          width: session.stream.targetWidth,
          height: session.stream.targetHeight,
          contentType: "image/png"
        })
    }
  });
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client);
    await seedBlindReadiness(baseUrl, seeded.session.token);
    const blind = await operatorRequest(
      baseUrl,
      seeded.session.token,
      "/operator-api/blind-e2ee/sessions",
      {
        method: "POST",
        body: {
          templateKey: "duckduckgo_browser",
          width: 390,
          height: 844,
          dpr: 3,
          terminalPublicKeyJwk: terminal.publicJwk
        }
      }
    );
    assert.equal(blind.session.state, "blind_e2ee_session_ready");
    const captured = await operatorRequest(
      baseUrl,
      seeded.session.token,
      `${blind.session.frameEnvelope.ingestEndpoint}/capture-once`,
      {
        method: "POST",
        body: {}
      }
    );
    assert.equal(captured.frame.sequence, 3);
    assert.equal(captured.frame.brokerCanDecrypt, false);
    assert.equal(captured.frame.brokerPersistsCiphertextBytes, false);

    const latest = await operatorRequest(
      baseUrl,
      seeded.session.token,
      blind.session.frameEnvelope.latestFrameEndpoint
    );
    assert.equal(latest.relay.latestFrameAvailable, true);
    const decrypted = await decryptFrameForTest({
      frame: latest.relay.frame,
      terminalPrivateKey: terminal.pair.privateKey
    });
    assert.deepEqual(decrypted, SAMPLE_PNG);

    const auditText = JSON.stringify(
      app.services.audit.list().filter((event) => event.action.includes("blind_e2ee"))
    );
    assert.equal(auditText.includes(SAMPLE_PNG.toString("base64")), false);
    assert.equal(auditText.includes(latest.relay.frame.ciphertextB64), false);
  } finally {
    await close();
  }
});

test("Step 3.114 encoder CLI emits metadata without plaintext or secrets", async () => {
  const terminal = await terminalKeyPair();
  const pairPath = new URL(`./tmp-terminal-${crypto.randomUUID()}.json`, import.meta.url);
  const sourcePath = new URL(`./tmp-source-${crypto.randomUUID()}.png`, import.meta.url);
  await writeTemporaryJson(pairPath, terminal.publicJwk);
  await writeTemporaryBytes(sourcePath, SAMPLE_PNG);
  try {
    const result = await encodeOnce({
      "terminal-public-key-jwk-file": fileURLToPath(pairPath),
      "source-png": fileURLToPath(sourcePath),
      "session-id": "blind_stream_step3_114_cli",
      "key-id": "sframe_step3_114_cli",
      "template-key": "duckduckgo_browser",
      sequence: 2,
      width: 390,
      height: 844
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "encoded_only");
    assert.equal(result.plaintextPrinted, false);
    assert.equal(result.contentPrinted, false);
    assert.equal(result.secretsPrinted, false);
    assert.equal(JSON.stringify(result).includes(SAMPLE_PNG.toString("base64")), false);
    assert.equal(Object.hasOwn(result, "ciphertextB64"), false);
  } finally {
    await removeTemporaryFile(pairPath);
    await removeTemporaryFile(sourcePath);
  }
});

async function writeTemporaryJson(url, value) {
  await writeFile(url, JSON.stringify(value));
}

async function writeTemporaryBytes(url, value) {
  await writeFile(url, value);
}

async function removeTemporaryFile(url) {
  await rm(url, { force: true });
}
