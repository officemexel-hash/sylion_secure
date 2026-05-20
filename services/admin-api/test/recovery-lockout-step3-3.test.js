import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

async function startTestServer() {
  const app = createApp({ authOptions: { lockoutThreshold: 2, lockoutTtlMs: 60_000 } });
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function request(baseUrl, path, { method = "GET", token, body, correlationId = "corr_step3_3" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": correlationId,
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function login(baseUrl, email = "admin@sylion.local", password = "ChangeMe-LocalOnly-1!") {
  const result = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email, password, fido2Verified: true }
  });
  assert.equal(result.status, 200);
  return result.payload.session.token;
}

test("Step 3.3 locks repeated failed admin authentication and recovery never auto-unlocks", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const body = {
      email: "admin@sylion.local",
      password: "wrong-password"
    };
    const first = await request(baseUrl, "/auth/webauthn/enrollment/options", { method: "POST", body });
    assert.equal(first.status, 401);

    const second = await request(baseUrl, "/auth/webauthn/enrollment/options", { method: "POST", body });
    assert.equal(second.status, 401);

    const locked = await request(baseUrl, "/auth/webauthn/enrollment/options", {
      method: "POST",
      body: { email: "admin@sylion.local", password: "ChangeMe-LocalOnly-1!" }
    });
    assert.equal(locked.status, 423);
    assert.equal(locked.payload.error.code, "account_locked");
    assert.equal(locked.payload.error.details.recoveryEndpoint, "/auth/recovery/request");

    const recovery = await request(baseUrl, "/auth/recovery/request", {
      method: "POST",
      body: {
        email: "admin@sylion.local",
        reasonCode: "operator_lost_fido2"
      }
    });
    assert.equal(recovery.status, 201);
    assert.equal(recovery.payload.request.status, "pending");
    assert.equal(recovery.payload.request.autoUnlock, false);

    const stillLocked = await request(baseUrl, "/auth/login", {
      method: "POST",
      body: {
        email: "admin@sylion.local",
        password: "ChangeMe-LocalOnly-1!",
        fido2Verified: true
      }
    });
    assert.equal(stillLocked.status, 423);

    const auditEvents = app.services.audit.list();
    assert.ok(auditEvents.some((event) => event.action === "auth.lockout_started"));
    assert.ok(auditEvents.some((event) => event.action === "auth.recovery_started"));
    assert.equal(JSON.stringify(auditEvents).includes("wrong-password"), false);
    assert.equal(JSON.stringify(auditEvents).includes("ChangeMe-LocalOnly-1!"), false);
  } finally {
    await close();
  }
});

test("Step 3.3 recovery workflow is review-only and denied to support readonly", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const recovery = await request(baseUrl, "/auth/recovery/request", {
      method: "POST",
      body: {
        email: "admin@sylion.local",
        reasonCode: "manual_review"
      }
    });
    assert.equal(recovery.status, 201);

    const adminToken = await login(baseUrl);
    const list = await request(baseUrl, "/auth/recovery/requests", { token: adminToken });
    assert.equal(list.status, 200);
    assert.equal(list.payload.requests.length, 1);

    const updated = await request(baseUrl, `/auth/recovery/requests/${recovery.payload.request.id}/status`, {
      method: "POST",
      token: adminToken,
      body: {
        status: "approved_placeholder",
        note: "Human gate recorded; no unlock side effect."
      }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.payload.request.status, "approved_placeholder");
    assert.equal(updated.payload.request.autoUnlock, false);

    const readonlyToken = await login(baseUrl, "readonly@sylion.local", "ReadOnly-LocalOnly-1!");
    const denied = await request(baseUrl, "/auth/recovery/requests", { token: readonlyToken });
    assert.equal(denied.status, 403);
  } finally {
    await close();
  }
});

test("Step 3.3 break-glass is a HUMAN GATE placeholder with PHANTOM separation", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const requestResult = await request(baseUrl, "/auth/break-glass/requests", {
      method: "POST",
      token,
      body: {
        actionScope: "emergency_access_review",
        reasonCode: "security_incident_review"
      }
    });
    assert.equal(requestResult.status, 201);
    assert.equal(requestResult.payload.request.status, "pending_human_gate");
    assert.equal(requestResult.payload.request.humanGateRequired, true);
    assert.equal(requestResult.payload.request.approvalRequired, true);
    assert.equal(requestResult.payload.request.sideEffectExecuted, false);
    assert.equal(requestResult.payload.request.baselineBoundary, "SYLION_BASELINE_PLACEHOLDER_ONLY");
    assert.equal(requestResult.payload.request.phantomBoundary, "PHANTOM_V3_SEPARATE_TRACK_NOT_IMPLEMENTED");

    const list = await request(baseUrl, "/auth/break-glass/requests", { token });
    assert.equal(list.status, 200);
    assert.equal(list.payload.requests.length, 1);

    const audit = await request(baseUrl, "/audit/events", { token });
    assert.ok(audit.payload.events.some((event) => event.action === "auth.break_glass_requested"));
    assert.ok(audit.payload.events.some((event) => event.action === "auth.break_glass_human_gate_required"));
  } finally {
    await close();
  }
});
