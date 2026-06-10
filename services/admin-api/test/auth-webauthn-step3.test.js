import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createApp } from "../src/app.js";

async function startTestServer(authOptions = {}) {
  const app = createApp({ authOptions });
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function request(
  baseUrl,
  path,
  { method = "GET", token, body, correlationId = "corr_step3_auth" } = {}
) {
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

async function enroll(
  baseUrl,
  email = "admin@sylion.local",
  password = "ChangeMe-LocalOnly-1!",
  credentialId = "cred-admin-step3"
) {
  const options = await request(baseUrl, "/auth/webauthn/enrollment/options", {
    method: "POST",
    body: { email, password }
  });
  assert.equal(options.status, 201);
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
  return { credentialId, options, verified };
}

async function loginWithCredential(baseUrl, credentialId = "cred-admin-step3") {
  const options = await request(baseUrl, "/auth/webauthn/login/options", {
    method: "POST",
    body: {
      email: "admin@sylion.local",
      password: "ChangeMe-LocalOnly-1!"
    }
  });
  assert.equal(options.status, 201);
  const session = await request(baseUrl, "/auth/webauthn/login/verify", {
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
  assert.equal(session.status, 200);
  return { options, session };
}

test("Step 3 WebAuthn-compatible enrollment and login create a session without private material leakage", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const { credentialId, verified } = await enroll(baseUrl);
    assert.equal(verified.payload.credential.id, credentialId);
    assert.equal(JSON.stringify(verified.payload).includes("private"), false);
    assert.equal(JSON.stringify(verified.payload).includes("ChangeMe"), false);

    const { session } = await loginWithCredential(baseUrl, credentialId);
    assert.equal(session.payload.session.authMethod, "webauthn");
    assert.equal(session.payload.session.email, "admin@sylion.local");
    assert.ok(session.payload.session.token);

    const introspection = await request(baseUrl, "/auth/session", {
      token: session.payload.session.token
    });
    assert.equal(introspection.status, 200);
    assert.equal(introspection.payload.session.authMethod, "webauthn");
    assert.equal(JSON.stringify(introspection.payload).includes("simulated-public-key"), false);

    const audit = await request(baseUrl, "/audit/events", {
      token: session.payload.session.token
    });
    const actions = audit.payload.events.map((event) => event.action);
    assert.ok(actions.includes("auth.challenge_issued"));
    assert.ok(actions.includes("auth.challenge_verified"));
    assert.ok(actions.includes("auth.credential_enrolled"));
    assert.ok(actions.includes("auth.session_created"));
    assert.equal(JSON.stringify(audit.payload).includes("ChangeMe-LocalOnly-1!"), false);
  } finally {
    await close();
  }
});

test("Step 3 challenge replay is blocked and audited", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const { credentialId } = await enroll(baseUrl);
    const login = await loginWithCredential(baseUrl, credentialId);
    const replay = await request(baseUrl, "/auth/webauthn/login/verify", {
      method: "POST",
      body: {
        challengeId: login.options.payload.challenge.id,
        credentialId,
        assertion: {
          signature: `simulated:${login.options.payload.challenge.id}:${credentialId}`,
          signCounter: 2
        }
      }
    });
    assert.equal(replay.status, 401);
    assert.equal(replay.payload.error.code, "challenge_replayed");

    const audit = await request(baseUrl, "/audit/events", {
      token: login.session.payload.session.token
    });
    assert.ok(audit.payload.events.some((event) => event.action === "auth.challenge_replayed"));
  } finally {
    await close();
  }
});

test("Step 3 expired challenges are blocked", async () => {
  const { baseUrl, close } = await startTestServer({ challengeTtlMs: 1 });
  try {
    const options = await request(baseUrl, "/auth/webauthn/enrollment/options", {
      method: "POST",
      body: {
        email: "admin@sylion.local",
        password: "ChangeMe-LocalOnly-1!"
      }
    });
    assert.equal(options.status, 201);
    await sleep(5);
    const expired = await request(baseUrl, "/auth/webauthn/enrollment/verify", {
      method: "POST",
      body: {
        challengeId: options.payload.challenge.id,
        credential: { id: "cred-expired", publicKey: "simulated-public-key:expired" }
      }
    });
    assert.equal(expired.status, 401);
    assert.equal(expired.payload.error.code, "challenge_expired");
  } finally {
    await close();
  }
});

test("Step 3 login refuses accounts without an enrolled credential", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const options = await request(baseUrl, "/auth/webauthn/login/options", {
      method: "POST",
      body: {
        email: "admin@sylion.local",
        password: "ChangeMe-LocalOnly-1!"
      }
    });
    assert.equal(options.status, 409);
    assert.equal(options.payload.error.code, "credential_required");
  } finally {
    await close();
  }
});

test("Step 3 step-up challenge is bound to the issuing session", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const { credentialId } = await enroll(baseUrl);
    const first = await loginWithCredential(baseUrl, credentialId);
    const second = await loginWithCredential(baseUrl, credentialId);

    const stepUp = await request(baseUrl, "/auth/step-up/options", {
      method: "POST",
      token: first.session.payload.session.token
    });
    assert.equal(stepUp.status, 201);

    const wrongSession = await request(baseUrl, "/auth/step-up/verify", {
      method: "POST",
      token: second.session.payload.session.token,
      body: {
        challengeId: stepUp.payload.challenge.id,
        credentialId,
        assertion: {
          signature: `simulated:${stepUp.payload.challenge.id}:${credentialId}`,
          signCounter: 3
        }
      }
    });
    assert.equal(wrongSession.status, 403);
    assert.equal(wrongSession.payload.error.code, "invalid_challenge_actor");

    const correctSession = await request(baseUrl, "/auth/step-up/verify", {
      method: "POST",
      token: first.session.payload.session.token,
      body: {
        challengeId: stepUp.payload.challenge.id,
        credentialId,
        assertion: {
          signature: `simulated:${stepUp.payload.challenge.id}:${credentialId}`,
          signCounter: 4
        }
      }
    });
    assert.equal(correctSession.status, 200);
    assert.ok(correctSession.payload.session.stepUpValidUntil);
  } finally {
    await close();
  }
});
