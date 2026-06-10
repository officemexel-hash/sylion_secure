import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

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
    correlationIdFactory: () => `corr_step3_85_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-85-${crypto.randomUUID()}`;
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
      "x-correlation-id": `corr_step3_85_operator_${crypto.randomUUID()}`,
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

async function operatorRaw(baseUrl, token, path, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": `corr_step3_85_operator_raw_${crypto.randomUUID()}`,
      authorization: `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, payload: await response.json() };
}

async function seedOperator(client, tier = "PRO") {
  const tenant = await client.createTenant({ name: `Step 3.85 ${tier} Tenant`, tier });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.85 ${tier} Operator`,
    tier
  });
  const pixel = await client.registerDevice({
    type: "pixel_grapheneos",
    serial: `pixel-step3-85-${crypto.randomUUID()}`,
    model: "Pixel GrapheneOS blue-team monitor test",
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
  return { tenant, operator: created.operator, pixel: pixel.device, session: session.session };
}

async function recordLiveVpnEvidence(baseUrl, token) {
  return operatorRequest(baseUrl, token, "/operator-api/vpn-evidence", {
    method: "POST",
    body: {
      vpnConnected: true,
      vpnSession: "SYLION",
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
}

async function recordStreamingEvidence(baseUrl, token) {
  await operatorRequest(baseUrl, token, "/operator-api/streaming-readiness", {
    method: "POST",
    body: {
      g2StreamGatewayReady: true,
      tlsInternalOnly: true,
      inputProxyReady: true,
      publicInternetExposure: false,
      sources: {
        signal: true,
        duckduckgo_browser: true,
        libreoffice: true
      }
    }
  });
  return operatorRequest(baseUrl, token, "/operator-api/streaming-runtime-manifest", {
    method: "POST",
    body: {
      gateway: {
        process: "sylion-g2-stream-gateway",
        bindAddress: "10.42.0.12",
        port: 8443,
        protocol: "webrtc_or_selkies",
        tlsMode: "internal_tls_only",
        publicInternetExposure: false
      },
      sources: {
        signal: {
          process: "signal-stream-source",
          bindAddress: "10.42.0.13",
          port: 7901,
          healthPath: "/healthz",
          cdrRequired: true
        }
      }
    }
  });
}

test("Step 3.85 operator traffic monitor exposes metadata-only path state and router blocker", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    const response = await operatorRequest(
      baseUrl,
      seeded.session.token,
      "/operator-api/traffic-monitoring"
    );
    const monitoring = response.monitoring;
    assert.equal(monitoring.mode, "metadata_only_blue_team_monitoring");
    assert.equal(monitoring.guardrails.metadataOnly, true);
    assert.equal(monitoring.guardrails.contentInspected, false);
    assert.equal(monitoring.guardrails.packetCaptureStored, false);
    assert.equal(monitoring.guardrails.terminalDataStored, false);
    assert.equal(monitoring.segments.length, 5);
    assert.deepEqual(monitoring.route, [
      "Pixel/laptop",
      "Puli AX",
      "G1",
      "G2",
      "WORKLOAD",
      "microVM/container"
    ]);
    assert.ok(monitoring.alerts.some((alert) => alert.code === "puli_ax_pending"));
    assert.ok(monitoring.alerts.some((alert) => alert.code === "vpn_evidence_missing"));
    assert.equal(JSON.stringify(monitoring).includes("message_database"), false);
    assert.equal(monitoring.productionExecutionAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.85 traffic evidence updates one segment and rejects content or packet captures", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    const recorded = await operatorRequest(
      baseUrl,
      seeded.session.token,
      "/operator-api/traffic-monitoring/evidence",
      {
        method: "POST",
        body: {
          segmentId: "g1_g2",
          status: "healthy",
          encrypted: true,
          transport: "ipsec_ikev2_mutual_certificate",
          latencyMs: 12,
          packetLossPct: 0,
          bytesIn: 4096,
          bytesOut: 2048,
          evidenceRefs: ["probe://g1-g2/ping", "audit://route-policy"]
        }
      }
    );
    assert.equal(recorded.evidence.segmentId, "g1_g2");
    assert.equal(recorded.evidence.status, "healthy");
    assert.equal(recorded.evidence.contentInspected, false);
    assert.equal(recorded.evidence.packetCaptureStored, false);
    const monitoring = await operatorRequest(
      baseUrl,
      seeded.session.token,
      "/operator-api/traffic-monitoring"
    );
    const g1g2 = monitoring.monitoring.segments.find((segment) => segment.id === "g1_g2");
    assert.equal(g1g2.status, "healthy");
    assert.equal(g1g2.latencyMs, 12);
    assert.equal(g1g2.evidenceId, recorded.evidence.id);

    const deniedMessage = await operatorRaw(
      baseUrl,
      seeded.session.token,
      "/operator-api/traffic-monitoring/evidence",
      {
        method: "POST",
        body: {
          segmentId: "g2_workload",
          status: "healthy",
          encrypted: true,
          messageContent: "forbidden"
        }
      }
    );
    assert.equal(deniedMessage.status, 422);
    assert.equal(deniedMessage.payload.error.code, "validation_error");

    const deniedPcap = await operatorRaw(
      baseUrl,
      seeded.session.token,
      "/operator-api/traffic-monitoring/evidence",
      {
        method: "POST",
        body: {
          segmentId: "workload_microvm",
          status: "healthy",
          encrypted: true,
          packetCapture: "forbidden"
        }
      }
    );
    assert.equal(deniedPcap.status, 422);
    assert.equal(deniedPcap.payload.error.code, "validation_error");
  } finally {
    await close();
  }
});

test("Step 3.85 VPN and streaming evidence lift G1/G2/workload monitoring while preserving router gate", async () => {
  const { baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL: "true",
        SYLION_G1_G2_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_POLICY_READY: "true",
        SYLION_G2_WORKLOAD_GATEWAY_READY: "true",
        SYLION_G2_STREAM_GATEWAY_READY: "true"
      }
    }
  });
  try {
    const client = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    await recordLiveVpnEvidence(baseUrl, seeded.session.token);
    await recordStreamingEvidence(baseUrl, seeded.session.token);
    const response = await operatorRequest(
      baseUrl,
      seeded.session.token,
      "/operator-api/traffic-monitoring"
    );
    const byId = Object.fromEntries(
      response.monitoring.segments.map((segment) => [segment.id, segment])
    );
    assert.equal(byId.router_g1.status, "degraded");
    assert.ok(byId.router_g1.blockers.includes("puli_ax_physical_router_pending"));
    assert.equal(byId.g1_g2.status, "healthy");
    assert.equal(byId.g2_workload.status, "healthy");
    assert.equal(byId.workload_microvm.status, "degraded");
    assert.ok(
      byId.workload_microvm.blockers.includes("per_app_firecracker_runtime_factual_test_required")
    );
    assert.equal(response.monitoring.summary.healthy, 2);
    assert.equal(response.monitoring.guardrails.g1G2BypassAllowed, false);
    assert.equal(response.monitoring.guardrails.cdrRequiredForFiles, true);
  } finally {
    await close();
  }
});
