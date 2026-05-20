import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { DEVICE_TYPES, TIERS } from "../src/domain/constants.js";

async function startTestServer() {
  const app = createApp();
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function request(baseUrl, path, { method = "GET", token, body, headers = {}, correlationId = "corr_device_image_orchestrator" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": correlationId,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function login(baseUrl) {
  const credentialId = "cred-device-orchestrator";
  const enrollOptions = await request(baseUrl, "/auth/webauthn/enrollment/options", {
    method: "POST",
    body: {
      email: "admin@sylion.local",
      password: "ChangeMe-LocalOnly-1!"
    }
  });
  assert.equal(enrollOptions.status, 201);
  const enrolled = await request(baseUrl, "/auth/webauthn/enrollment/verify", {
    method: "POST",
    body: {
      challengeId: enrollOptions.payload.challenge.id,
      credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
    }
  });
  assert.equal(enrolled.status, 201);
  const loginOptions = await request(baseUrl, "/auth/webauthn/login/options", {
    method: "POST",
    body: {
      email: "admin@sylion.local",
      password: "ChangeMe-LocalOnly-1!"
    }
  });
  assert.equal(loginOptions.status, 201);
  const result = await request(baseUrl, "/auth/webauthn/login/verify", {
    method: "POST",
    body: {
      challengeId: loginOptions.payload.challenge.id,
      credentialId,
      assertion: {
        signature: `simulated:${loginOptions.payload.challenge.id}:${credentialId}`,
        signCounter: 1
      }
    }
  });
  assert.equal(result.status, 200);
  return result.payload.session.token;
}

async function createOperator(baseUrl, token) {
  const tenant = await request(baseUrl, "/tenants", {
    method: "POST",
    token,
    body: { name: "Device Image Tenant", tier: TIERS.PRO }
  });
  assert.equal(tenant.status, 201);
  const operator = await request(baseUrl, "/operators", {
    method: "POST",
    token,
    body: {
      tenantId: tenant.payload.tenant.id,
      displayName: "Device Image Operator",
      tier: TIERS.PRO
    }
  });
  assert.equal(operator.status, 201);
  return { tenant: tenant.payload.tenant, operator: operator.payload.operator };
}

test("M10 registers Pixel, Puli AX, and FIDO2 devices without operational data", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const { operator } = await createOperator(baseUrl, token);

    const pixel = await request(baseUrl, "/devices", {
      method: "POST",
      token,
      body: {
        type: DEVICE_TYPES.PIXEL,
        serial: "pixel-test-001",
        model: "Google Pixel",
        assignedOperatorId: operator.id,
        firmwareVersion: "grapheneos-dev",
        posture: { state: "enrolling" }
      }
    });
    assert.equal(pixel.status, 201);
    assert.equal(pixel.payload.device.assignedOperatorId, operator.id);

    const router = await request(baseUrl, "/devices", {
      method: "POST",
      token,
      body: {
        type: DEVICE_TYPES.ROUTER,
        serial: "puli-ax-test-001",
        model: "GL.iNet GL-XE3000 Puli AX",
        assignedOperatorId: operator.id,
        firmwareVersion: "hardened-openwrt-candidate",
        qualificationStatus: "needs_evidence",
        posture: { killSwitch: "pending", dnsLeak: "untested" }
      }
    });
    assert.equal(router.status, 201);
    assert.equal(router.payload.device.qualificationStatus, "needs_evidence");

    const rejected = await request(baseUrl, "/devices", {
      method: "POST",
      token,
      body: {
        type: DEVICE_TYPES.FIDO2,
        serial: "fido-secret-test-001",
        model: "FIDO2 Key",
        assignedOperatorId: operator.id,
        metadata: { seedPhrase: "must-not-store" }
      }
    });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.payload.error.code, "validation_error");
  } finally {
    await close();
  }
});

test("M19 builds signed artifact references and rejects plaintext secrets", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const { tenant, operator } = await createOperator(baseUrl, token);
    const pixel = await request(baseUrl, "/devices", {
      method: "POST",
      token,
      body: {
        type: DEVICE_TYPES.PIXEL,
        serial: "pixel-artifact-001",
        model: "Google Pixel",
        assignedOperatorId: operator.id
      }
    });

    const artifact = await request(baseUrl, "/images/artifacts", {
      method: "POST",
      token,
      body: {
        artifactType: "pixel_grapheneos_profile",
        tenantId: tenant.id,
        operatorId: operator.id,
        sourceRef: "source://grapheneos/profile",
        deviceId: pixel.payload.device.id,
        policy: { storesOperationalData: false, thinClientOnly: true }
      }
    });
    assert.equal(artifact.status, 201);
    assert.match(artifact.payload.artifact.signatureRef, /^signature:\/\/admin-api\//);
    assert.equal(artifact.payload.artifact.containsPlaintextSecrets, false);

    const rejected = await request(baseUrl, "/images/artifacts", {
      method: "POST",
      token,
      body: {
        artifactType: "pixel_grapheneos_profile",
        tenantId: tenant.id,
        operatorId: operator.id,
        sourceRef: "source://grapheneos/profile",
        deviceId: pixel.payload.device.id,
        policy: { password: "must-not-store" }
      }
    });
    assert.equal(rejected.status, 422);
  } finally {
    await close();
  }
});

test("M20 executes provisioning plan idempotently and creates inventory, certs, artifacts, monitoring", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const { operator } = await createOperator(baseUrl, token);
    const pixel = await request(baseUrl, "/devices", {
      method: "POST",
      token,
      body: {
        type: DEVICE_TYPES.PIXEL,
        serial: "pixel-orch-001",
        model: "Google Pixel",
        assignedOperatorId: operator.id
      }
    });
    const router = await request(baseUrl, "/devices", {
      method: "POST",
      token,
      body: {
        type: DEVICE_TYPES.ROUTER,
        serial: "puli-orch-001",
        model: "GL.iNet GL-XE3000 Puli AX",
        assignedOperatorId: operator.id
      }
    });
    const plan = await request(baseUrl, `/operators/${operator.id}/provisioning-plan`, {
      method: "POST",
      token,
      body: { requestedApps: ["Signal", "Telegram"] }
    });
    assert.equal(plan.status, 201);

    const executeBody = {
      planId: plan.payload.plan.id,
      provider: "hetzner",
      region: "fsn1",
      imageRef: "image://sylion/base/dev",
      pixelDeviceId: pixel.payload.device.id,
      routerDeviceId: router.payload.device.id,
      idempotencyKey: "idem-orchestrator-test-001"
    };
    const job = await request(baseUrl, "/orchestrator/jobs", {
      method: "POST",
      token,
      body: executeBody,
      headers: { "idempotency-key": "idem-orchestrator-test-001" }
    });
    assert.equal(job.status, 201);
    assert.equal(job.payload.job.status, "completed");
    assert.equal(job.payload.job.result.certificateIds.length, 3);
    assert.equal(job.payload.job.result.artifactIds.length, 4);
    assert.ok(job.payload.job.rollbackPlan.some((step) => step.approvalRequired === true));

    const repeated = await request(baseUrl, "/orchestrator/jobs", {
      method: "POST",
      token,
      body: executeBody,
      headers: { "idempotency-key": "idem-orchestrator-test-001" }
    });
    assert.equal(repeated.status, 201);
    assert.equal(repeated.payload.job.id, job.payload.job.id);

    const inventory = await request(baseUrl, `/operators/${operator.id}/infrastructure-sets`, { token });
    assert.equal(inventory.status, 200);
    assert.equal(inventory.payload.infrastructureSets.length, 1);
    assert.equal(inventory.payload.infrastructureSets[0].vps.length, 3);
    assert.ok(inventory.payload.infrastructureSets[0].vps.every((vps) => vps.shared === false));

    const artifacts = await request(baseUrl, `/images/artifacts?operatorId=${operator.id}`, { token });
    assert.equal(artifacts.status, 200);
    assert.equal(artifacts.payload.artifacts.length, 4);
  } finally {
    await close();
  }
});
