// Shared test harness for services/admin-api.
//
// Extracts the most common patterns repeated across the admin-api test suite:
//   - startTestServer: createApp(options) + app.listen(0) -> { app, baseUrl, close }
//   - request:         thin fetch() wrapper -> { status, json, text, headers }
//   - loginClient:     canonical WebAuthn-simulation enroll+login -> { token, headers, credentialId, ... }
//
// The signature of startTestServer mirrors createApp's real option bag
// (see services/admin-api/src/app.js: createApp({ store, authOptions,
// liveExecutionOptions, billingOptions })). Options are forwarded verbatim so
// callers can pass e.g. { authOptions: { challengeTtlMs: 1 } },
// { store: new SqliteStore(...) } or { liveExecutionOptions: { env, ... } }
// exactly like the existing tests do.

import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";

const DEFAULT_EMAIL = "admin@sylion.local";
const DEFAULT_PASSWORD = "ChangeMe-LocalOnly-1!";

/**
 * Boot an in-process admin-api instance on an ephemeral port.
 *
 * @param {object} [options] Forwarded verbatim to createApp. Supports the real
 *   option bag: { store, authOptions, liveExecutionOptions, billingOptions }.
 * @returns {Promise<{ app: object, baseUrl: string, close: () => Promise<void> }>}
 *   baseUrl is "http://127.0.0.1:<port>". close() stops the HTTP server and, when
 *   the app exposes close() (e.g. SqliteStore-backed), tears the app down too.
 */
export async function startTestServer(options = {}) {
  const app = createApp(options);
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          if (typeof app.close === "function") {
            app.close();
          }
          resolve();
        })
      )
  };
}

/**
 * Thin fetch() wrapper used by all admin-api tests.
 *
 * @param {string} baseUrl Server base URL from startTestServer.
 * @param {string} method HTTP method (GET, POST, ...).
 * @param {string} path Request path beginning with "/".
 * @param {object} [opts]
 * @param {unknown} [opts.body] JSON-serialized into the request body when present.
 * @param {object} [opts.headers] Extra headers merged over the defaults.
 * @param {string} [opts.token] Bearer token; sets the Authorization header.
 * @returns {Promise<{ status: number, json: unknown, text: string, headers: Headers }>}
 *   json is the parsed body when the response is JSON, otherwise null.
 */
export async function request(baseUrl, method, path, { body, headers = {}, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": `corr_test_${randomUUID()}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  const contentType = response.headers.get("content-type") || "";
  if (text && contentType.includes("application/json")) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json, text, headers: response.headers };
}

/**
 * Canonical WebAuthn-simulation login shared by the admin-api auth tests.
 *
 * Runs the full enroll -> login flow against the simulated WebAuthn endpoints
 * (matching auth-webauthn-step3.test.js / full-admin-human-flow.e2e.test.js):
 *   POST /auth/webauthn/enrollment/options
 *   POST /auth/webauthn/enrollment/verify
 *   POST /auth/webauthn/login/options
 *   POST /auth/webauthn/login/verify
 *
 * Uses crypto.randomUUID() so concurrent logins get unique credential ids.
 *
 * @param {string} baseUrl Server base URL from startTestServer.
 * @param {string} [suffix] Optional suffix to disambiguate the credential id in
 *   audit trails; a random UUID is always appended for uniqueness.
 * @returns {Promise<{
 *   token: string,
 *   headers: { authorization: string },
 *   credentialId: string,
 *   email: string,
 *   session: object
 * }>}
 */
export async function loginClient(baseUrl, suffix = "") {
  const credentialId = `cred-test-${suffix ? `${suffix}-` : ""}${randomUUID()}`;
  const email = DEFAULT_EMAIL;
  const password = DEFAULT_PASSWORD;

  const enrollOptions = await request(baseUrl, "POST", "/auth/webauthn/enrollment/options", {
    body: { email, password }
  });
  assertStatus(enrollOptions, 201, "enrollment/options");

  const enrolled = await request(baseUrl, "POST", "/auth/webauthn/enrollment/verify", {
    body: {
      challengeId: enrollOptions.json.challenge.id,
      credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
    }
  });
  assertStatus(enrolled, 201, "enrollment/verify");

  const loginOptions = await request(baseUrl, "POST", "/auth/webauthn/login/options", {
    body: { email, password }
  });
  assertStatus(loginOptions, 201, "login/options");

  const verified = await request(baseUrl, "POST", "/auth/webauthn/login/verify", {
    body: {
      challengeId: loginOptions.json.challenge.id,
      credentialId,
      assertion: {
        signature: `simulated:${loginOptions.json.challenge.id}:${credentialId}`,
        signCounter: 1
      }
    }
  });
  assertStatus(verified, 200, "login/verify");

  const session = verified.json.session;
  return {
    token: session.token,
    headers: { authorization: `Bearer ${session.token}` },
    credentialId,
    email,
    session
  };
}

function assertStatus(response, expected, step) {
  if (response.status !== expected) {
    throw new Error(
      `loginClient: ${step} expected ${expected}, got ${response.status}: ${response.text}`
    );
  }
}
