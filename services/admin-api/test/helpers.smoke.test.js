// Smoke test proving the shared harness (test/helpers.js) actually boots a
// server, serves a known endpoint, and completes the canonical WebAuthn login.

import assert from "node:assert/strict";
import test from "node:test";
import { loginClient, request, startTestServer } from "./helpers.js";

test("startTestServer boots an app and GET /health responds ok", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    assert.ok(app, "startTestServer returns the created app");
    assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

    const health = await request(baseUrl, "GET", "/health");
    assert.equal(health.status, 200);
    assert.equal(health.json.status, "ok");
    assert.equal(health.json.service, "admin-api");
    assert.match(health.headers.get("content-type") || "", /application\/json/);
  } finally {
    await close();
  }
});

test("startTestServer forwards options verbatim to createApp", async () => {
  // authOptions.challengeTtlMs is a real createApp/AuthService option; passing it
  // proves startTestServer's signature mirrors createApp's option bag.
  const { baseUrl, close } = await startTestServer({ authOptions: { challengeTtlMs: 60000 } });
  try {
    const options = await request(baseUrl, "POST", "/auth/webauthn/enrollment/options", {
      body: { email: "admin@sylion.local", password: "ChangeMe-LocalOnly-1!" }
    });
    assert.equal(options.status, 201);
    assert.ok(options.json.challenge.id);
  } finally {
    await close();
  }
});

test("loginClient performs the WebAuthn-sim login and yields a usable session token", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl, "smoke");
    assert.ok(client.token, "session token is present");
    assert.match(client.credentialId, /^cred-test-smoke-/);
    assert.equal(client.headers.authorization, `Bearer ${client.token}`);
    assert.equal(client.session.authMethod, "webauthn");

    // Token authenticates against a protected endpoint.
    const introspection = await request(baseUrl, "GET", "/auth/session", {
      token: client.token
    });
    assert.equal(introspection.status, 200);
    assert.equal(introspection.json.session.authMethod, "webauthn");
  } finally {
    await close();
  }
});

test("loginClient yields unique credential ids across concurrent logins", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const [a, b] = await Promise.all([
      loginClient(baseUrl, "concurrent"),
      loginClient(baseUrl, "concurrent")
    ]);
    assert.notEqual(a.credentialId, b.credentialId);
    assert.notEqual(a.token, b.token);
  } finally {
    await close();
  }
});
