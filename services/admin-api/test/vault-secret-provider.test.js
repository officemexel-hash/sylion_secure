import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  VaultSecretProvider,
  VaultNotConfiguredError,
  VaultSecretMissingError
} from "../src/modules/secrets/vaultSecretProvider.js";

// F-25 (ADR-vault-adapter-001, Phase A) — real Vault HTTP client, exercised
// against a local mock that speaks just enough of the Vault HTTP API
// (sys/health, AppRole login, KV v2 metadata/data, transit hmac).
//
// The mock NEVER stores or echoes real secrets; "mock-token" / "mock-secret-id"
// are fixtures. Assertions confirm: configured status() is integrated but stays
// productionReady=false (HUMAN GATE); token retrieval works; transit hmac works;
// AppRole login exchanges role/secret for a token; unconfigured fails closed;
// and no credential material ever leaks into status() output.

const KV_MOUNT = "secret";
const TRANSIT_MOUNT = "transit";
const PROVIDER_PATH = `sylion/providers/hetzner`;

// Spin up an in-process Vault mock on an ephemeral port (listen(0)).
function startMockVault() {
  // Track what auth the last data/metadata/transit request presented so we can
  // assert AppRole exchange happened.
  const state = { lastVaultToken: null, approleLogins: 0 };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://mock.local");
    const path = url.pathname;

    const readBody = () =>
      new Promise((resolve) => {
        let raw = "";
        req.on("data", (chunk) => {
          raw += chunk;
        });
        req.on("end", () => {
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            resolve({});
          }
        });
      });

    const sendJson = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (req.headers["x-vault-token"]) {
      state.lastVaultToken = req.headers["x-vault-token"];
    }

    // GET /v1/sys/health — unauthenticated health probe.
    if (path === "/v1/sys/health" && req.method === "GET") {
      return sendJson(200, { initialized: true, sealed: false, standby: false });
    }

    // POST /v1/auth/approle/login — exchange role/secret for a client token.
    if (path === "/v1/auth/approle/login" && req.method === "POST") {
      return readBody().then((body) => {
        if (body.role_id === "mock-role-id" && body.secret_id === "mock-secret-id") {
          state.approleLogins += 1;
          return sendJson(200, { auth: { client_token: "approle-issued-token" } });
        }
        return sendJson(400, { errors: ["invalid role or secret id"] });
      });
    }

    // GET /v1/secret/metadata/... — KV v2 metadata existence check.
    if (path === `/v1/${KV_MOUNT}/metadata/${PROVIDER_PATH}` && req.method === "GET") {
      return sendJson(200, { data: { current_version: 1 } });
    }
    if (path.startsWith(`/v1/${KV_MOUNT}/metadata/`) && req.method === "GET") {
      return sendJson(404, { errors: [] });
    }

    // GET /v1/secret/data/... — KV v2 data read; token lives under data.data.token.
    if (path === `/v1/${KV_MOUNT}/data/${PROVIDER_PATH}` && req.method === "GET") {
      return sendJson(200, { data: { data: { token: "mock-token" } } });
    }
    if (path.startsWith(`/v1/${KV_MOUNT}/data/`) && req.method === "GET") {
      return sendJson(404, { errors: [] });
    }

    // POST /v1/transit/hmac/{key} — transit HMAC primitive (F-19 binding).
    if (path.startsWith(`/v1/${TRANSIT_MOUNT}/hmac/`) && req.method === "POST") {
      return readBody().then((body) => {
        if (body.algorithm !== "sha2-256" || typeof body.input !== "string") {
          return sendJson(400, { errors: ["bad transit request"] });
        }
        return sendJson(200, { data: { hmac: "vault:v1:mock-hmac-digest" } });
      });
    }

    return sendJson(404, { errors: ["unknown mock path"] });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, state, addr: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// (a) configured status() => integrated:true but productionReady stays false.
test("(a) status() is integrated against a configured Vault but productionReady=false", async (t) => {
  const mock = await startMockVault();
  t.after(() => closeServer(mock.server));

  const provider = new VaultSecretProvider({
    env: { SYLION_VAULT_ADDR: mock.addr, SYLION_VAULT_TOKEN: "mock-token" }
  });

  const status = await provider.status();
  assert.equal(status.integrated, true);
  assert.equal(status.productionReady, false, "Phase A — deployment is a HUMAN GATE");
  assert.equal(status.humanGateRequired, true);
  assert.equal(status.plaintextRetrievalAllowed, false);
  assert.equal(status.health.reachable, true);
  assert.equal(status.health.sealed, false);
});

// (b) getProviderToken returns the KV v2 data.data.token value.
test("(b) getProviderToken returns the Vault KV token value", async (t) => {
  const mock = await startMockVault();
  t.after(() => closeServer(mock.server));

  const provider = new VaultSecretProvider({
    env: { SYLION_VAULT_ADDR: mock.addr, SYLION_VAULT_TOKEN: "mock-token" }
  });

  assert.equal(await provider.hasProviderSecret("hetzner"), true);
  assert.equal(await provider.getProviderToken("hetzner"), "mock-token");
});

// (c) transitHmac returns the hmac string from the mock.
test("(c) transitHmac returns the Vault transit hmac (F-19 binding)", async (t) => {
  const mock = await startMockVault();
  t.after(() => closeServer(mock.server));

  const provider = new VaultSecretProvider({
    env: { SYLION_VAULT_ADDR: mock.addr, SYLION_VAULT_TOKEN: "mock-token" }
  });

  const hmac = await provider.transitHmac("sylion-audit", Buffer.from("chain").toString("base64"));
  assert.equal(hmac, "vault:v1:mock-hmac-digest");
});

// (d) AppRole login exchanges role/secret id for a client token.
test("(d) AppRole login exchanges role/secret id for a token", async (t) => {
  const mock = await startMockVault();
  t.after(() => closeServer(mock.server));

  const provider = new VaultSecretProvider({
    env: {
      SYLION_VAULT_ADDR: mock.addr,
      SYLION_VAULT_ROLE_ID: "mock-role-id",
      SYLION_VAULT_SECRET_ID: "mock-secret-id"
    }
  });

  // No static token configured — this read MUST trigger an AppRole login first.
  assert.equal(await provider.getProviderToken("hetzner"), "mock-token");
  assert.equal(mock.state.approleLogins, 1, "exactly one AppRole login performed");
  assert.equal(
    mock.state.lastVaultToken,
    "approle-issued-token",
    "subsequent requests use the issued token"
  );

  // status() reports approle auth method when no static token is present.
  const status = await provider.status();
  assert.equal(status.authMethod, "approle");
});

// (e) unconfigured: status integrated:false (no throw); getProviderToken throws.
test("(e) unconfigured provider: status integrated:false, getProviderToken throws", async () => {
  const provider = new VaultSecretProvider({ env: {} });

  const status = await provider.status();
  assert.equal(status.integrated, false);
  assert.equal(status.reason, "vault_not_configured");
  assert.equal(status.productionReady, false);
  assert.equal(status.humanGateRequired, true);

  // fail-closed (false) without throwing
  assert.equal(await provider.hasProviderSecret("hetzner"), false);

  await assert.rejects(
    () => provider.getProviderToken("hetzner"),
    (err) => err instanceof VaultNotConfiguredError && err.reason === "vault_not_configured"
  );
  await assert.rejects(
    () => provider.transitHmac("sylion-audit", "AAAA"),
    (err) => err instanceof VaultNotConfiguredError
  );
});

// (e2) configured but missing secret => VaultSecretMissingError (never null).
test("(e2) configured provider with missing secret throws (never returns null token)", async (t) => {
  const mock = await startMockVault();
  t.after(() => closeServer(mock.server));

  const provider = new VaultSecretProvider({
    env: { SYLION_VAULT_ADDR: mock.addr, SYLION_VAULT_TOKEN: "mock-token" }
  });

  assert.equal(await provider.hasProviderSecret("ovh"), false);
  await assert.rejects(
    () => provider.getProviderToken("ovh"),
    (err) => err instanceof VaultSecretMissingError
  );
});

// (f) credential material never appears in status() output.
test("(f) token / secret-id material never leaks into status() output", async (t) => {
  const mock = await startMockVault();
  t.after(() => closeServer(mock.server));

  const tokenProvider = new VaultSecretProvider({
    env: { SYLION_VAULT_ADDR: mock.addr, SYLION_VAULT_TOKEN: "super-secret-token-value" }
  });
  const tokenStatus = JSON.stringify(await tokenProvider.status());
  assert.equal(tokenStatus.includes("super-secret-token-value"), false);

  const approleProvider = new VaultSecretProvider({
    env: {
      SYLION_VAULT_ADDR: mock.addr,
      SYLION_VAULT_ROLE_ID: "mock-role-id",
      SYLION_VAULT_SECRET_ID: "mock-secret-id"
    }
  });
  // Drive a login so an issued token exists in the private cache, then re-check.
  await approleProvider.getProviderToken("hetzner");
  const approleStatus = JSON.stringify(await approleProvider.status());
  assert.equal(approleStatus.includes("mock-secret-id"), false);
  assert.equal(approleStatus.includes("mock-role-id"), false);
  assert.equal(approleStatus.includes("approle-issued-token"), false);
});
