// API-OIDC-26 / API-JWT-28 (Phase A) — external OIDC/JWT token verifier.
//
// This is an ADDITIVE adapter that validates JWTs issued by an EXTERNAL IdP
// (e.g. https://idp.sylion.internal). It does NOT implement an IdP and it is
// NOT wired into the live login path — authService WebAuthn stays the single
// authoritative authenticator. This module is staged behind the SYLION_AUTH_OIDC
// flag (default off) and is reachable only when an operator explicitly opts in.
//
// It performs REAL signature verification using node:crypto (no new npm
// dependency) and fetches the IdP JWKS via the built-in global fetch with an
// in-memory cache (TTL). It supports RS256 and ES256 at minimum (RS384/RS512,
// ES384/ES512 and EdDSA are accepted when the JWK provides the matching key
// type). alg:"none" is NEVER accepted.
//
// Hard invariants enforced here:
//   * enforcing stays false and humanGateRequired stays true regardless of
//     configuration — turning OIDC into an authoritative login path is a HUMAN
//     GATE decision. Wiring the verifier does NOT make OIDC authoritative.
//   * alg:"none" (and any non-allowlisted alg) is rejected outright.
//   * verify() never throws for an invalid token — it returns
//     { valid:false, reason }. It only rejects on misconfiguration/transport.
//   * No secrets in this file. JWKS is public key material by design.

import { createPublicKey, createVerify, verify as cryptoVerify } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_JWKS_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CLOCK_TOLERANCE_S = 30;

// alg => { type: JWK kty, scheme }. alg:"none" is intentionally absent so it can
// never resolve here. HS* (symmetric) is intentionally unsupported — an external
// IdP must sign with an asymmetric key whose public half lives in the JWKS.
const SUPPORTED_ALGS = {
  RS256: { kty: "RSA", hash: "RSA-SHA256" },
  RS384: { kty: "RSA", hash: "RSA-SHA384" },
  RS512: { kty: "RSA", hash: "RSA-SHA512" },
  PS256: { kty: "RSA", hash: "RSA-SHA256", pss: true },
  PS384: { kty: "RSA", hash: "RSA-SHA384", pss: true },
  PS512: { kty: "RSA", hash: "RSA-SHA512", pss: true },
  ES256: { kty: "EC", hash: "SHA-256", dsaEncoding: "ieee-p1363" },
  ES384: { kty: "EC", hash: "SHA-384", dsaEncoding: "ieee-p1363" },
  ES512: { kty: "EC", hash: "SHA-512", dsaEncoding: "ieee-p1363" },
  EdDSA: { kty: "OKP" }
};

export class OidcTokenVerifier {
  // JWKS cache: { keys: Map<kid, jwk>, fetchedAt: number }. Public key material
  // only — never any secret. Held privately so it is not serialized by status().
  #jwksCache;

  constructor({ env = process.env, config = {}, fetchImpl = null } = {}) {
    this.issuer = sanitizeIssuer(config.issuer || env.SYLION_OIDC_ISSUER || null);
    this.jwksUri = config.jwksUri || env.SYLION_OIDC_JWKS_URI || null;
    this.audience = config.audience || env.SYLION_OIDC_AUDIENCE || null;
    this.timeoutMs =
      Number(config.timeoutMs || env.SYLION_OIDC_TIMEOUT_MS || 0) || DEFAULT_TIMEOUT_MS;
    this.jwksTtlMs =
      Number(config.jwksTtlMs || env.SYLION_OIDC_JWKS_TTL_MS || 0) || DEFAULT_JWKS_TTL_MS;
    this.clockToleranceS = Number(
      config.clockToleranceS ?? env.SYLION_OIDC_CLOCK_TOLERANCE_S ?? DEFAULT_CLOCK_TOLERANCE_S
    );

    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.#jwksCache = null;

    // Phase A invariants — immutable regardless of configuration. Wiring the
    // verifier does NOT make OIDC an authoritative login path.
    this.enforcing = false;
    this.humanGateRequired = true;
  }

  get configured() {
    return Boolean(this.issuer);
  }

  // Metadata only — never a token, claim, or key. Graceful when unconfigured
  // (does NOT throw). When configured, enforcing/humanGateRequired stay constants.
  status() {
    if (!this.configured) {
      return { configured: false };
    }
    return {
      configured: true,
      enforcing: false,
      humanGateRequired: true,
      issuer: this.issuer,
      audienceConfigured: Boolean(this.audience),
      jwksUriConfigured: Boolean(this.jwksUri),
      // derived JWKS endpoint when not explicitly set
      jwksSource: this.jwksUri ? "explicit" : "discovery",
      timeoutMs: this.timeoutMs,
      jwksTtlMs: this.jwksTtlMs,
      clockToleranceS: this.clockToleranceS,
      // wiring note: NOT connected to the live login path
      authoritativeLoginPath: "webauthn",
      adr: "API-OIDC-26"
    };
  }

  // Verify an external IdP JWT. Returns { valid:true, claims } on success or
  // { valid:false, reason } for any token-level failure. Throws only for
  // misconfiguration (not configured) — never for an attacker-controlled token.
  async verify(token) {
    if (!this.configured) {
      return { valid: false, reason: "not_configured" };
    }
    if (typeof token !== "string" || token.length === 0) {
      return { valid: false, reason: "missing_token" };
    }

    const decoded = decodeJwt(token);
    if (!decoded) {
      return { valid: false, reason: "malformed_token" };
    }
    const { header, payload, signingInput, signature } = decoded;

    const alg = header.alg;
    if (!alg || alg === "none") {
      return { valid: false, reason: "alg_none_rejected" };
    }
    const spec = SUPPORTED_ALGS[alg];
    if (!spec) {
      return { valid: false, reason: "unsupported_alg" };
    }

    let jwk;
    try {
      jwk = await this.#resolveKey(header.kid, spec.kty);
    } catch (err) {
      return { valid: false, reason: err instanceof OidcVerifierError ? err.reason : "jwks_error" };
    }
    if (!jwk) {
      return { valid: false, reason: "signing_key_not_found" };
    }

    let signatureValid;
    try {
      signatureValid = verifySignature({ spec, jwk, signingInput, signature });
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      return { valid: false, reason: "invalid_signature" };
    }

    // Claim checks — only after the signature is proven, to avoid trusting
    // attacker-controlled claims.
    if (payload.iss !== this.issuer) {
      return { valid: false, reason: "issuer_mismatch" };
    }
    if (this.audience && !audienceMatches(payload.aud, this.audience)) {
      return { valid: false, reason: "audience_mismatch" };
    }

    const nowS = Math.floor(Date.now() / 1000);
    const tol = this.clockToleranceS;
    if (typeof payload.exp === "number" && payload.exp + tol < nowS) {
      return { valid: false, reason: "token_expired" };
    }
    if (typeof payload.nbf === "number" && payload.nbf - tol > nowS) {
      return { valid: false, reason: "token_not_yet_valid" };
    }
    if (typeof payload.iat === "number" && payload.iat - tol > nowS) {
      return { valid: false, reason: "issued_in_future" };
    }

    return { valid: true, claims: payload };
  }

  // ---- internal ----------------------------------------------------------

  async #resolveKey(kid, kty) {
    let cache = this.#freshCache();
    if (!cache) {
      cache = await this.#loadJwks();
    }
    let jwk = selectJwk(cache.keys, kid, kty);
    if (!jwk) {
      // kid rotation — force a single refresh, then retry once.
      cache = await this.#loadJwks();
      jwk = selectJwk(cache.keys, kid, kty);
    }
    return jwk || null;
  }

  #freshCache() {
    if (!this.#jwksCache) {
      return null;
    }
    if (Date.now() - this.#jwksCache.fetchedAt > this.jwksTtlMs) {
      return null;
    }
    return this.#jwksCache;
  }

  async #loadJwks() {
    const uri = await this.#resolveJwksUri();
    const body = await this.#getJson(uri, "jwks_fetch_failed");
    const keys = new Map();
    if (body && Array.isArray(body.keys)) {
      for (const jwk of body.keys) {
        if (jwk && typeof jwk === "object") {
          keys.set(jwk.kid || `__nokid__:${keys.size}`, jwk);
        }
      }
    }
    this.#jwksCache = { keys, fetchedAt: Date.now() };
    return this.#jwksCache;
  }

  async #resolveJwksUri() {
    if (this.jwksUri) {
      return this.jwksUri;
    }
    // OIDC discovery: {issuer}/.well-known/openid-configuration -> jwks_uri.
    const discoveryUrl = `${this.issuer}/.well-known/openid-configuration`;
    const discovery = await this.#getJson(discoveryUrl, "discovery_failed");
    if (discovery && typeof discovery.jwks_uri === "string" && discovery.jwks_uri.length > 0) {
      return discovery.jwks_uri;
    }
    // Conventional fallback when discovery omits jwks_uri.
    return `${this.issuer}/.well-known/jwks.json`;
  }

  async #getJson(url, failureReason) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
    } catch (err) {
      throw new OidcVerifierError(
        err && err.name === "AbortError" ? "jwks_timeout" : failureReason
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new OidcVerifierError(failureReason);
    }
    try {
      return await response.json();
    } catch {
      throw new OidcVerifierError(failureReason);
    }
  }
}

export class OidcVerifierError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "OidcVerifierError";
    this.reason = reason;
  }
}

export function createOidcTokenVerifier(options = {}) {
  return new OidcTokenVerifier(options);
}

// ---- pure helpers ---------------------------------------------------------

function sanitizeIssuer(issuer) {
  if (!issuer) return null;
  return String(issuer).replace(/\/+$/, "");
}

function base64UrlDecode(segment) {
  return Buffer.from(String(segment), "base64url");
}

function decodeJwt(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  // header + payload must be present; the signature segment may be empty so that
  // a forged alg:"none" token still decodes and is rejected by the alg check
  // (not silently classified as merely "malformed").
  if (!headerB64 || !payloadB64) {
    return null;
  }
  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (!header || typeof header !== "object" || !payload || typeof payload !== "object") {
    return null;
  }
  return {
    header,
    payload,
    signingInput: `${headerB64}.${payloadB64}`,
    signature: base64UrlDecode(signatureB64)
  };
}

function selectJwk(keys, kid, kty) {
  if (kid) {
    // A specified kid must resolve to that exact key of the right type. We do
    // NOT silently fall back to another key on a kid miss — that would mask key
    // rotation gaps and weaken key-confusion resistance.
    const jwk = keys.get(kid);
    return jwk && jwk.kty === kty ? jwk : null;
  }
  // No kid in header: only safe to match when exactly one key of the right type
  // exists.
  let match = null;
  for (const jwk of keys.values()) {
    if (jwk && jwk.kty === kty) {
      if (match) {
        return null;
      }
      match = jwk;
    }
  }
  return match;
}

function jwkToKeyObject(jwk) {
  return createPublicKey({ key: jwk, format: "jwk" });
}

function verifySignature({ spec, jwk, signingInput, signature }) {
  const keyObject = jwkToKeyObject(jwk);
  const data = Buffer.from(signingInput, "ascii");

  if (spec.kty === "OKP") {
    // EdDSA — one-shot verify with the algorithm baked into the key.
    return cryptoVerify(null, data, keyObject, signature);
  }

  if (spec.kty === "EC") {
    return cryptoVerify(
      spec.hash,
      data,
      { key: keyObject, dsaEncoding: spec.dsaEncoding },
      signature
    );
  }

  // RSA (RS*/PS*). PSS variants pass the padding + salt length.
  const verifier = createVerify(spec.hash);
  verifier.update(data);
  verifier.end();
  if (spec.pss) {
    return verifier.verify(
      {
        key: keyObject,
        padding: 6, // crypto.constants.RSA_PKCS1_PSS_PADDING
        saltLength: -1 // RSA_PSS_SALTLEN_DIGEST
      },
      signature
    );
  }
  return verifier.verify(keyObject, signature);
}

function audienceMatches(aud, expected) {
  if (typeof aud === "string") {
    return aud === expected;
  }
  if (Array.isArray(aud)) {
    return aud.includes(expected);
  }
  return false;
}
