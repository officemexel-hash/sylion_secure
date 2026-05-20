import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

async function startTestServer(authOptions = {}) {
  const app = createApp({ authOptions });
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function request(baseUrl, path, { method = "GET", token, body, correlationId = "corr_step3_4" } = {}) {
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

async function enroll(baseUrl, credentialId = "cred-step3-4") {
  const options = await request(baseUrl, "/auth/webauthn/enrollment/options", {
    method: "POST",
    body: {
      email: "admin@sylion.local",
      password: "ChangeMe-LocalOnly-1!"
    }
  });
  assert.equal(options.status, 201);
  assert.equal(options.payload.challenge.publicKey.rpId, "localhost");
  const verified = await request(baseUrl, "/auth/webauthn/enrollment/verify", {
    method: "POST",
    body: {
      challengeId: options.payload.challenge.id,
      credential: {
        id: credentialId,
        publicKey: `simulated-public-key:${credentialId}`,
        transports: ["usb"]
      }
    }
  });
  assert.equal(verified.status, 201);
  return credentialId;
}

async function legacyLogin(baseUrl, email = "admin@sylion.local", password = "ChangeMe-LocalOnly-1!") {
  const result = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email, password, fido2Verified: true }
  });
  assert.equal(result.status, 200);
  return result.payload.session.token;
}

async function stepUp(baseUrl, token, credentialId) {
  const options = await request(baseUrl, "/auth/step-up/options", { method: "POST", token });
  assert.equal(options.status, 201);
  const verified = await request(baseUrl, "/auth/step-up/verify", {
    method: "POST",
    token,
    body: {
      challengeId: options.payload.challenge.id,
      credentialId,
      assertion: {
        mode: "local_simulator",
        signature: `simulated:${options.payload.challenge.id}:${credentialId}`,
        signCounter: 2
      }
    }
  });
  assert.equal(verified.status, 200);
}

test("Step 3.4 exposes auth policy matrix and safe credential metadata", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const credentialId = await enroll(baseUrl);
    const token = await legacyLogin(baseUrl);

    const policy = await request(baseUrl, "/auth/policy-matrix", { token });
    assert.equal(policy.status, 200);
    assert.equal(policy.payload.policy.invariants.recoveryAutoUnlock, false);
    assert.equal(policy.payload.policy.invariants.breakGlassSideEffectAllowed, false);
    assert.equal(policy.payload.policy.invariants.phantomBaselineBehavior, false);

    const credentials = await request(baseUrl, "/auth/credentials", { token });
    assert.equal(credentials.status, 200);
    assert.equal(credentials.payload.credentials.length, 1);
    assert.equal(credentials.payload.credentials[0].id, credentialId);
    assert.equal(JSON.stringify(credentials.payload).includes("simulated-public-key"), false);
    assert.equal(JSON.stringify(credentials.payload).includes("private"), false);

    const readonlyToken = await legacyLogin(baseUrl, "readonly@sylion.local", "ReadOnly-LocalOnly-1!");
    const denied = await request(baseUrl, "/auth/credentials", { token: readonlyToken });
    assert.equal(denied.status, 403);
  } finally {
    await close();
  }
});

test("Step 3.4 credential revoke requires fresh step-up and blocks future login", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const credentialId = await enroll(baseUrl);
    const token = await legacyLogin(baseUrl);

    const blocked = await request(baseUrl, `/auth/credentials/${credentialId}/revoke`, {
      method: "POST",
      token,
      body: { reasonCode: "test_without_step_up" }
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.payload.error.code, "step_up_required");

    await stepUp(baseUrl, token, credentialId);
    const revoked = await request(baseUrl, `/auth/credentials/${credentialId}/revoke`, {
      method: "POST",
      token,
      body: { reasonCode: "test_revoke" }
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.payload.credential.status, "revoked");

    const loginOptions = await request(baseUrl, "/auth/webauthn/login/options", {
      method: "POST",
      body: {
        email: "admin@sylion.local",
        password: "ChangeMe-LocalOnly-1!"
      }
    });
    assert.equal(loginOptions.status, 409);
    assert.equal(loginOptions.payload.error.code, "credential_required");

    const audit = await request(baseUrl, "/audit/events", { token });
    assert.ok(audit.payload.events.some((event) => event.action === "auth.credential_revoked"));
  } finally {
    await close();
  }
});

test("Step 3.4 verifier boundary rejects unsupported browser payload without raw blob leakage", async () => {
  const { app, baseUrl, close } = await startTestServer();
  const rawBlob = "raw-browser-authenticator-blob-never-log";
  try {
    const credentialId = await enroll(baseUrl);
    const options = await request(baseUrl, "/auth/webauthn/login/options", {
      method: "POST",
      body: {
        email: "admin@sylion.local",
        password: "ChangeMe-LocalOnly-1!"
      }
    });
    assert.equal(options.status, 201);
    const denied = await request(baseUrl, "/auth/webauthn/login/verify", {
      method: "POST",
      body: {
        challengeId: options.payload.challenge.id,
        credentialId,
        assertion: {
          mode: "browser",
          origin: "http://localhost",
          rpId: "localhost",
          response: {
            clientDataJSON: rawBlob,
            authenticatorData: rawBlob,
            signature: rawBlob
          }
        }
      }
    });
    assert.equal(denied.status, 422);
    assert.equal(denied.payload.error.code, "unsupported_webauthn_mode");
    assert.equal(denied.payload.error.details.humanGateRequired, true);

    const auditEvents = app.services.audit.list();
    assert.ok(auditEvents.some((event) => event.action === "auth.challenge_failed"));
    assert.equal(JSON.stringify(auditEvents).includes(rawBlob), false);
  } finally {
    await close();
  }
});
