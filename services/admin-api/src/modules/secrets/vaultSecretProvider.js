// F-25 (ADR-vault-adapter-001, Phase A) — Vault secret provider.
//
// This mirrors the EnvSecretProvider interface (status / hasProviderSecret /
// getProviderToken) and adds a transit HMAC primitive (F-19 Phase B direction —
// audit chain key custody in Vault transit). It performs REAL HashiCorp Vault
// HTTP API calls via the built-in global fetch (no new npm dependency), but it
// remains Phase A scaffolding behind the SYLION_SECRET_BACKEND=vault flag.
//
// Backend selection is flag-driven (SYLION_SECRET_BACKEND, default "env"). With
// the flag OFF the runtime keeps using EnvSecretProvider exactly as today;
// nothing in this file is reachable unless an operator opts in to "vault".
//
// Hard invariants enforced here:
//   * productionReady stays false and humanGateRequired stays true regardless of
//     configuration — deployment is a HUMAN GATE decision (ADR-vault-adapter-001
//     DECISION PENDING). Integration being wired does NOT resolve F-25.
//   * plaintextRetrievalAllowed stays false. Token / secret-id material is never
//     logged, serialized into status(), or embedded in error messages.
//   * Resolution fails closed: hasProviderSecret() returns false on any error
//     or missing configuration; getProviderToken() throws rather than returning
//     a null masquerading as a token.
//
// DECISION PENDING — see ADR-vault-adapter-001 (§4 Phase A, §6 HUMAN GATE).

const NOT_CONFIGURED_REASON = "vault_not_configured";
const DEFAULT_KV_MOUNT = "secret";
const DEFAULT_TRANSIT_MOUNT = "transit";
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const SECRET_PATH_PREFIX = "sylion/providers";

export class VaultNotConfiguredError extends Error {
  constructor(operation, detail = {}) {
    super(NOT_CONFIGURED_REASON);
    this.name = "VaultNotConfiguredError";
    this.reason = NOT_CONFIGURED_REASON;
    this.operation = operation;
    this.productionReady = false;
    this.humanGateRequired = true;
    this.adr = "ADR-vault-adapter-001";
    this.detail = detail;
  }
}

export class VaultRequestError extends Error {
  // NOTE: never carries token / secret-id material. `detail` holds only the
  // operation name, HTTP status, and Vault path — no request body, no headers.
  constructor(operation, { status = null, path = null } = {}) {
    super(`vault_request_failed:${operation}`);
    this.name = "VaultRequestError";
    this.reason = "vault_request_failed";
    this.operation = operation;
    this.status = status;
    this.path = path;
    this.productionReady = false;
    this.humanGateRequired = true;
    this.adr = "ADR-vault-adapter-001";
  }
}

export class VaultSecretMissingError extends Error {
  constructor(providerKey) {
    super("vault_secret_missing");
    this.name = "VaultSecretMissingError";
    this.reason = "vault_secret_missing";
    this.providerKey = providerKey;
    this.productionReady = false;
    this.humanGateRequired = true;
    this.adr = "ADR-vault-adapter-001";
  }
}

export class VaultSecretProvider {
  // Cached client token (static or AppRole-issued). Held only in a private
  // field, never serialized into status() and never logged.
  #cachedToken;
  // True when a static SYLION_VAULT_TOKEN / config.token was supplied. Tracked
  // separately so status() can report auth method even after an AppRole login
  // populates #cachedToken. Holds a boolean, never the token value.
  #staticTokenConfigured;

  constructor({ env = process.env, config = {}, fetchImpl = null } = {}) {
    this.env = env;
    this.backend = "vault";

    this.addr = sanitizeAddr(config.addr || env.SYLION_VAULT_ADDR || null);
    this.namespace = config.namespace || env.SYLION_VAULT_NAMESPACE || null;
    this.kvMount = config.kvMount || env.SYLION_VAULT_KV_MOUNT || DEFAULT_KV_MOUNT;
    this.transitMount =
      config.transitMount || env.SYLION_VAULT_TRANSIT_MOUNT || DEFAULT_TRANSIT_MOUNT;
    this.timeoutMs =
      Number(config.timeoutMs || env.SYLION_VAULT_TIMEOUT_MS || 0) || DEFAULT_REQUEST_TIMEOUT_MS;

    // Credential material is read into private-ish fields but is NEVER exposed
    // through status(), errors, or logs. A direct token takes precedence over
    // AppRole.
    this.#cachedToken = config.token || env.SYLION_VAULT_TOKEN || null;
    this.#staticTokenConfigured = Boolean(this.#cachedToken);
    this.roleId = config.roleId || env.SYLION_VAULT_ROLE_ID || null;
    this.secretId = config.secretId || env.SYLION_VAULT_SECRET_ID || null;

    this.fetchImpl = fetchImpl || globalThis.fetch;

    // Phase A invariants — immutable regardless of configuration.
    this.productionReady = false;
    this.humanGateRequired = true;
    this.plaintextRetrievalAllowed = false;
  }

  // True when an endpoint and at least one credential path is present. Note:
  // "configured" is NOT "production ready" — see status().
  get configured() {
    return Boolean(this.addr) && this.#hasCredential();
  }

  #hasCredential() {
    return Boolean(this.#cachedToken || (this.roleId && this.secretId));
  }

  // Mirrors EnvSecretProvider.status(): metadata only, never plaintext.
  // Graceful when unconfigured (does NOT throw). When configured it probes Vault
  // sys/health, but productionReady/humanGateRequired remain Phase A constants.
  async status() {
    if (!this.configured) {
      return {
        source: "vault",
        backend: "vault",
        integrated: false,
        reason: NOT_CONFIGURED_REASON,
        adr: "ADR-vault-adapter-001",
        productionReady: false,
        humanGateRequired: true,
        plaintextExposed: false,
        plaintextRetrievalAllowed: false,
        endpointConfigured: Boolean(this.addr),
        authConfigured: this.#hasCredential(),
        kvMount: this.kvMount,
        transitMount: this.transitMount,
        namespaceConfigured: Boolean(this.namespace)
      };
    }

    const health = await this.#health();
    return {
      source: "vault",
      backend: "vault",
      integrated: true,
      adr: "ADR-vault-adapter-001",
      // Phase A: integration wired, deployment still gated behind HUMAN GATE.
      productionReady: false,
      humanGateRequired: true,
      plaintextExposed: false,
      plaintextRetrievalAllowed: false,
      endpointConfigured: true,
      authConfigured: true,
      authMethod: this.#staticTokenConfigured ? "token" : "approle",
      kvMount: this.kvMount,
      transitMount: this.transitMount,
      namespaceConfigured: Boolean(this.namespace),
      health
    };
  }

  // Mirrors EnvSecretProvider.hasProviderSecret(). Fail-closed: any error or
  // missing configuration reports false so gate evaluation stays conservative.
  async hasProviderSecret(providerKey) {
    if (!this.configured) {
      return false;
    }
    try {
      const path = `${this.kvMount}/metadata/${SECRET_PATH_PREFIX}/${normalizeProvider(providerKey)}`;
      const response = await this.#request("GET", path, { allow404: true });
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  // Mirrors EnvSecretProvider.getProviderToken(). MUST NOT return null pretending
  // to be a token. Throws VaultNotConfiguredError when unconfigured and
  // VaultSecretMissingError when the secret / token field is absent.
  async getProviderToken(providerKey) {
    if (!this.configured) {
      throw new VaultNotConfiguredError("getProviderToken", {
        providerKey: normalizeProvider(providerKey)
      });
    }
    const path = `${this.kvMount}/data/${SECRET_PATH_PREFIX}/${normalizeProvider(providerKey)}`;
    let body;
    try {
      const response = await this.#request("GET", path);
      body = await response.json();
    } catch (err) {
      if (err instanceof VaultRequestError && err.status === 404) {
        throw new VaultSecretMissingError(normalizeProvider(providerKey));
      }
      throw err;
    }
    const token = body && body.data && body.data.data ? body.data.data.token : undefined;
    if (typeof token !== "string" || token.length === 0) {
      throw new VaultSecretMissingError(normalizeProvider(providerKey));
    }
    return token;
  }

  // F-19 (KS-VAULT-6) binding — Vault transit HMAC. Lets AuditService delegate
  // the audit-chain HMAC to Vault transit so the key never lives in the app
  // (key custody in Vault). `dataB64` MUST be base64 (Vault transit contract).
  async transitHmac(keyName, dataB64) {
    if (!this.configured) {
      throw new VaultNotConfiguredError("transitHmac", { keyName: String(keyName || "") });
    }
    const path = `${this.transitMount}/hmac/${encodeURIComponent(String(keyName))}`;
    const response = await this.#request("POST", path, {
      body: { input: dataB64, algorithm: "sha2-256" }
    });
    const body = await response.json();
    const hmac = body && body.data ? body.data.hmac : undefined;
    if (typeof hmac !== "string" || hmac.length === 0) {
      throw new VaultRequestError("transitHmac", { status: response.status, path });
    }
    return hmac;
  }

  // ---- internal ----------------------------------------------------------

  async #health() {
    try {
      const response = await this.#request("GET", "sys/health", {
        auth: false,
        // Vault returns non-200 for sealed/standby; treat them as reachable.
        allowNon2xx: true
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      return {
        reachable: true,
        httpStatus: response.status,
        initialized: payload ? Boolean(payload.initialized) : null,
        sealed: payload ? Boolean(payload.sealed) : null,
        standby: payload ? Boolean(payload.standby) : null
      };
    } catch (err) {
      return {
        reachable: false,
        httpStatus: err instanceof VaultRequestError ? err.status : null,
        error: err instanceof Error ? err.reason || "unreachable" : "unreachable"
      };
    }
  }

  // Resolve a usable client token, performing an AppRole login when only
  // role_id/secret_id are configured. The issued token is cached in memory.
  async #resolveToken() {
    if (this.#cachedToken) {
      return this.#cachedToken;
    }
    if (!(this.roleId && this.secretId)) {
      throw new VaultNotConfiguredError("auth", {});
    }
    const response = await this.#request("POST", "auth/approle/login", {
      auth: false,
      body: { role_id: this.roleId, secret_id: this.secretId }
    });
    const body = await response.json();
    const token = body && body.auth ? body.auth.client_token : undefined;
    if (typeof token !== "string" || token.length === 0) {
      throw new VaultRequestError("approleLogin", {
        status: response.status,
        path: "auth/approle/login"
      });
    }
    this.#cachedToken = token;
    return token;
  }

  // Single HTTP entrypoint. Applies the timeout, namespace and (optionally) the
  // Vault token header. Throws VaultRequestError on non-2xx unless explicitly
  // allowed. Never includes token / body material in thrown error messages.
  async #request(
    method,
    path,
    { body = null, auth = true, allow404 = false, allowNon2xx = false } = {}
  ) {
    if (!this.addr) {
      throw new VaultNotConfiguredError("request", { path });
    }
    const headers = { Accept: "application/json" };
    if (this.namespace) {
      headers["X-Vault-Namespace"] = this.namespace;
    }
    if (auth) {
      headers["X-Vault-Token"] = await this.#resolveToken();
    }
    if (body !== null) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.addr}/v1/${path}`, {
        method,
        headers,
        body: body !== null ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } catch (err) {
      // AbortError / network failure — surface without leaking credentials.
      throw new VaultRequestError("transport", {
        status: err && err.name === "AbortError" ? 408 : null,
        path
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok && !allowNon2xx && !(allow404 && response.status === 404)) {
      throw new VaultRequestError(method.toLowerCase(), { status: response.status, path });
    }
    return response;
  }
}

function sanitizeAddr(addr) {
  if (!addr) return null;
  return String(addr).replace(/\/+$/, "");
}

function normalizeProvider(providerKey) {
  return encodeURIComponent(String(providerKey || "").toLowerCase());
}
