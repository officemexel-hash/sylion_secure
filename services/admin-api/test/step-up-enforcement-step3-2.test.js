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

async function request(baseUrl, path, { method = "GET", token, body, headers = {}, correlationId = "corr_step3_2" } = {}) {
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

async function enrollCredential(baseUrl, credentialId = "cred-step3-2") {
  const options = await request(baseUrl, "/auth/webauthn/enrollment/options", {
    method: "POST",
    body: {
      email: "admin@sylion.local",
      password: "ChangeMe-LocalOnly-1!"
    }
  });
  assert.equal(options.status, 201);
  const enrolled = await request(baseUrl, "/auth/webauthn/enrollment/verify", {
    method: "POST",
    body: {
      challengeId: options.payload.challenge.id,
      credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
    }
  });
  assert.equal(enrolled.status, 201);
  return credentialId;
}

async function legacyLogin(baseUrl) {
  const result = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: {
      email: "admin@sylion.local",
      password: "ChangeMe-LocalOnly-1!",
      fido2Verified: true
    }
  });
  assert.equal(result.status, 200);
  return result.payload.session.token;
}

async function webAuthnLogin(baseUrl, credentialId = "cred-step3-2") {
  await enrollCredential(baseUrl, credentialId);
  const options = await request(baseUrl, "/auth/webauthn/login/options", {
    method: "POST",
    body: {
      email: "admin@sylion.local",
      password: "ChangeMe-LocalOnly-1!"
    }
  });
  assert.equal(options.status, 201);
  const result = await request(baseUrl, "/auth/webauthn/login/verify", {
    method: "POST",
    body: {
      challengeId: options.payload.challenge.id,
      credentialId,
      assertion: {
        signature: `simulated:${options.payload.challenge.id}:${credentialId}`,
        signCounter: 1
      }
    }
  });
  assert.equal(result.status, 200);
  return result.payload.session.token;
}

async function stepUp(baseUrl, token, credentialId = "cred-step3-2") {
  const options = await request(baseUrl, "/auth/step-up/options", { method: "POST", token });
  assert.equal(options.status, 201);
  const verified = await request(baseUrl, "/auth/step-up/verify", {
    method: "POST",
    token,
    body: {
      challengeId: options.payload.challenge.id,
      credentialId,
      assertion: {
        signature: `simulated:${options.payload.challenge.id}:${credentialId}`,
        signCounter: 2
      }
    }
  });
  assert.equal(verified.status, 200);
}

async function createOperatorAndPlan(baseUrl, token) {
  const tenant = await request(baseUrl, "/tenants", {
    method: "POST",
    token,
    body: { name: "Step Up Tenant", tier: TIERS.PRO }
  });
  assert.equal(tenant.status, 201);
  const operator = await request(baseUrl, "/operators", {
    method: "POST",
    token,
    body: {
      tenantId: tenant.payload.tenant.id,
      displayName: "Step Up Operator",
      tier: TIERS.PRO
    }
  });
  assert.equal(operator.status, 201);
  const pixel = await request(baseUrl, "/devices", {
    method: "POST",
    token,
    body: {
      type: DEVICE_TYPES.PIXEL,
      serial: "pixel-step-up-001",
      model: "Google Pixel",
      assignedOperatorId: operator.payload.operator.id
    }
  });
  assert.equal(pixel.status, 201);
  const router = await request(baseUrl, "/devices", {
    method: "POST",
    token,
    body: {
      type: DEVICE_TYPES.ROUTER,
      serial: "puli-step-up-001",
      model: "GL.iNet GL-XE3000 Puli AX",
      assignedOperatorId: operator.payload.operator.id
    }
  });
  assert.equal(router.status, 201);
  const plan = await request(baseUrl, `/operators/${operator.payload.operator.id}/provisioning-plan`, {
    method: "POST",
    token,
    body: { requestedApps: ["Signal"] }
  });
  assert.equal(plan.status, 201);
  return { operator: operator.payload.operator, pixel: pixel.payload.device, router: router.payload.device, plan: plan.payload.plan };
}

test("Step 3.2 blocks provider creation before side effects and does not leak provider secret", async () => {
  const { baseUrl, close } = await startTestServer();
  const blockedSecret = "blocked-provider-secret-never-leak";
  try {
    await enrollCredential(baseUrl);
    const token = await legacyLogin(baseUrl);
    const blocked = await request(baseUrl, "/providers", {
      method: "POST",
      token,
      body: {
        providerType: "hetzner",
        apiSecret: blockedSecret,
        regions: ["fsn1"]
      }
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.payload.error.code, "step_up_required");
    assert.equal(JSON.stringify(blocked.payload).includes(blockedSecret), false);

    const providers = await request(baseUrl, "/providers", { token });
    assert.equal(providers.status, 200);
    assert.equal(providers.payload.providers.length, 0);

    const audit = await request(baseUrl, "/audit/events", { token });
    assert.ok(audit.payload.events.some((event) => event.action === "auth.step_up_required"));
    assert.equal(JSON.stringify(audit.payload).includes(blockedSecret), false);

    await stepUp(baseUrl, token);
    const created = await request(baseUrl, "/providers", {
      method: "POST",
      token,
      body: {
        providerType: "hetzner",
        apiSecret: blockedSecret,
        regions: ["fsn1"],
        testConnection: { mode: "mock", status: "passed" }
      }
    });
    assert.equal(created.status, 201);
    assert.equal(JSON.stringify(created.payload).includes(blockedSecret), false);
  } finally {
    await close();
  }
});

test("Step 3.2 blocks orchestrator execution without fresh step-up and preserves idempotency after step-up", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    await enrollCredential(baseUrl);
    const token = await legacyLogin(baseUrl);
    const { operator, plan, pixel, router } = await createOperatorAndPlan(baseUrl, token);
    const body = {
      planId: plan.id,
      provider: "hetzner",
      region: "fsn1",
      imageRef: "image://sylion/base/dev",
      pixelDeviceId: pixel.id,
      routerDeviceId: router.id,
      idempotencyKey: "idem-step-up-required-001"
    };
    const blocked = await request(baseUrl, "/orchestrator/jobs", {
      method: "POST",
      token,
      body,
      headers: { "idempotency-key": body.idempotencyKey }
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.payload.error.code, "step_up_required");

    const jobsBefore = await request(baseUrl, "/orchestrator/jobs", { token });
    assert.equal(jobsBefore.status, 200);
    assert.equal(jobsBefore.payload.jobs.length, 0);

    await stepUp(baseUrl, token);
    const approval = await request(baseUrl, "/provisioning/approvals", {
      method: "POST",
      token,
      body: {
        operatorId: operator.id,
        planId: plan.id,
        evidenceRefs: ["step-up-readiness", "step-up-human-gate"]
      }
    });
    assert.equal(approval.status, 201);
    const approved = await request(baseUrl, `/provisioning/approvals/${approval.payload.approval.id}/status`, {
      method: "POST",
      token,
      body: { status: "approved_for_execution", note: "Step-up execution gate complete" }
    });
    assert.equal(approved.status, 200);
    body.approvalId = approval.payload.approval.id;

    const job = await request(baseUrl, "/orchestrator/jobs", {
      method: "POST",
      token,
      body,
      headers: { "idempotency-key": body.idempotencyKey }
    });
    assert.equal(job.status, 201);
    assert.equal(job.payload.job.status, "completed");

    const repeated = await request(baseUrl, "/orchestrator/jobs", {
      method: "POST",
      token,
      body,
      headers: { "idempotency-key": body.idempotencyKey }
    });
    assert.equal(repeated.status, 201);
    assert.equal(repeated.payload.job.id, job.payload.job.id);
  } finally {
    await close();
  }
});

test("Step 3.2 blocks provider secret rotation without fresh step-up", async () => {
  const { baseUrl, close } = await startTestServer();
  const rotatedSecret = "rotation-blocked-secret-never-leak";
  try {
    const webToken = await webAuthnLogin(baseUrl);
    const provider = await request(baseUrl, "/providers", {
      method: "POST",
      token: webToken,
      body: {
        providerType: "hetzner",
        apiSecret: "initial-provider-secret-never-leak",
        regions: ["fsn1"],
        testConnection: { mode: "mock", status: "passed" }
      }
    });
    assert.equal(provider.status, 201);

    const legacyToken = await legacyLogin(baseUrl);
    const blocked = await request(baseUrl, `/providers/${provider.payload.provider.id}/secret-rotation`, {
      method: "POST",
      token: legacyToken,
      body: {
        apiSecret: rotatedSecret,
        testConnection: { mode: "mock", status: "passed" }
      }
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.payload.error.code, "step_up_required");
    assert.equal(JSON.stringify(blocked.payload).includes(rotatedSecret), false);

    const audit = await request(baseUrl, "/audit/events", { token: legacyToken });
    assert.equal(JSON.stringify(audit.payload).includes(rotatedSecret), false);
  } finally {
    await close();
  }
});
