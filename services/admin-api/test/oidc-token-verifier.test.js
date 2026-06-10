import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  createPublicKey,
  createSign,
  generateKeyPairSync,
  randomUUID,
  sign as cryptoSign
} from "node:crypto";
import {
  OidcTokenVerifier,
  createOidcTokenVerifier
} from "../src/modules/auth/oidcTokenVerifier.js";

// API-OIDC-26 / API-JWT-28 (Phase A) — external OIDC/JWT verifier.
//
// All keys are EPHEMERAL: generated per-suite with generateKeyPairSync. They are
// test fixtures, NOT secrets. The mock IdP serves only PUBLIC JWKS + discovery.
// We assert: valid token => { valid:true, claims }; bad signature, expired exp,
// wrong aud/iss are rejected; alg:"none" is rejected; unconfigured status()
// reports configured:false. The mock HTTP server is closed in teardown.

const ISSUER = "https://idp.sylion.test";
const AUDIENCE = "sylion-admin-api";

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

// Build a signed JWT. `alg` controls the header; `signer` produces the
// signature bytes over the signing input. For alg:"none" the signature is empty.
function makeJwt({ header, payload, signer }) {
  const headerB64 = base64Url(JSON.stringify(header));
  const payloadB64 = base64Url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = signer ? signer(signingInput) : Buffer.alloc(0);
  return `${signingInput}.${signature.toString("base64url")}`;
}

// RS256 / ES256 key material + matching JWK (with kid), generated ephemerally.
function makeRsaKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" };
  return {
    kid,
    jwk,
    sign: (signingInput) => {
      const s = createSign("RSA-SHA256");
      s.update(Buffer.from(signingInput, "ascii"));
      s.end();
      return s.sign(privateKey);
    }
  };
}

function makeEcKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "ES256" };
  return {
    kid,
    jwk,
    sign: (signingInput) =>
      cryptoSign("SHA-256", Buffer.from(signingInput, "ascii"), {
        key: privateKey,
        dsaEncoding: "ieee-p1363"
      })
  };
}

// Spin up an in-process IdP mock on an ephemeral port. Serves discovery + JWKS.
function startMockIdp(jwks) {
  const state = { jwksHits: 0, discoveryHits: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://mock.local");
    const sendJson = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      state.discoveryHits += 1;
      const base = `http://127.0.0.1:${server.address().port}`;
      return sendJson(200, { issuer: ISSUER, jwks_uri: `${base}/jwks` });
    }
    if (url.pathname === "/jwks" || url.pathname === "/.well-known/jwks.json") {
      state.jwksHits += 1;
      return sendJson(200, { keys: jwks });
    }
    return sendJson(404, { error: "not_found" });
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

function nowS() {
  return Math.floor(Date.now() / 1000);
}

function basePayload(overrides = {}) {
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: "user-123",
    iat: nowS() - 10,
    exp: nowS() + 600,
    ...overrides
  };
}

// (a) — valid RS256 token resolves to { valid:true, claims }.
test("(a) valid RS256 token => valid:true with claims", async (t) => {
  const key = makeRsaKey("rsa-key-1");
  const idp = await startMockIdp([key.jwk]);
  t.after(() => closeServer(idp.server));

  const verifier = new OidcTokenVerifier({
    config: { issuer: ISSUER, jwksUri: `${idp.addr}/jwks`, audience: AUDIENCE }
  });
  const token = makeJwt({
    header: { alg: "RS256", typ: "JWT", kid: key.kid },
    payload: basePayload({ email: "ops@sylion.test" }),
    signer: key.sign
  });

  const result = await verifier.verify(token);
  assert.equal(result.valid, true);
  assert.equal(result.claims.sub, "user-123");
  assert.equal(result.claims.email, "ops@sylion.test");
});

// (a2) — valid ES256 token also resolves, and discovery derives the JWKS URI.
test("(a2) valid ES256 token via discovery => valid:true", async (t) => {
  const key = makeEcKey("ec-key-1");
  const idp = await startMockIdp([key.jwk]);
  t.after(() => closeServer(idp.server));

  // issuer points at the mock so discovery resolves jwks_uri; no explicit jwksUri.
  const verifier = createOidcTokenVerifier({
    config: { issuer: idp.addr, audience: AUDIENCE }
  });
  const token = makeJwt({
    header: { alg: "ES256", typ: "JWT", kid: key.kid },
    // iss must equal the configured issuer (the mock addr in this case)
    payload: basePayload({ iss: idp.addr }),
    signer: key.sign
  });

  const result = await verifier.verify(token);
  assert.equal(result.valid, true);
  assert.equal(result.claims.sub, "user-123");
  assert.ok(idp.state.discoveryHits >= 1, "discovery endpoint was used");
});

// (a3) — JWKS is cached: a second verify does not refetch within TTL.
test("(a3) JWKS is cached across verifications within TTL", async (t) => {
  const key = makeRsaKey("rsa-cache");
  const idp = await startMockIdp([key.jwk]);
  t.after(() => closeServer(idp.server));

  const verifier = new OidcTokenVerifier({
    config: { issuer: ISSUER, jwksUri: `${idp.addr}/jwks`, audience: AUDIENCE }
  });
  const token = makeJwt({
    header: { alg: "RS256", typ: "JWT", kid: key.kid },
    payload: basePayload(),
    signer: key.sign
  });

  await verifier.verify(token);
  await verifier.verify(token);
  assert.equal(idp.state.jwksHits, 1, "JWKS fetched exactly once (cached)");
});

// (b) — tampered signature => valid:false.
test("(b) bad signature => valid:false invalid_signature", async (t) => {
  const key = makeRsaKey("rsa-key-2");
  const idp = await startMockIdp([key.jwk]);
  t.after(() => closeServer(idp.server));

  const verifier = new OidcTokenVerifier({
    config: { issuer: ISSUER, jwksUri: `${idp.addr}/jwks`, audience: AUDIENCE }
  });
  const token = makeJwt({
    header: { alg: "RS256", typ: "JWT", kid: key.kid },
    payload: basePayload(),
    signer: key.sign
  });
  // Corrupt a byte in the middle of the signature so the decoded bytes differ.
  const parts = token.split(".");
  const sigBytes = Buffer.from(parts[2], "base64url");
  const mid = Math.floor(sigBytes.length / 2);
  sigBytes[mid] = sigBytes[mid] ^ 0xff;
  parts[2] = sigBytes.toString("base64url");
  const tampered = parts.join(".");

  const result = await verifier.verify(tampered);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid_signature");
});

// (b2) — token signed by a DIFFERENT key (key confusion) => valid:false.
test("(b2) signature from an unrelated key => valid:false", async (t) => {
  const published = makeRsaKey("rsa-published");
  const attacker = makeRsaKey("rsa-published"); // same kid, different key
  const idp = await startMockIdp([published.jwk]);
  t.after(() => closeServer(idp.server));

  const verifier = new OidcTokenVerifier({
    config: { issuer: ISSUER, jwksUri: `${idp.addr}/jwks`, audience: AUDIENCE }
  });
  const token = makeJwt({
    header: { alg: "RS256", typ: "JWT", kid: "rsa-published" },
    payload: basePayload(),
    signer: attacker.sign
  });

  const result = await verifier.verify(token);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "invalid_signature");
});

// (c) — expired exp (beyond tolerance) => valid:false.
test("(c) expired token => valid:false token_expired", async (t) => {
  const key = makeRsaKey("rsa-key-3");
  const idp = await startMockIdp([key.jwk]);
  t.after(() => closeServer(idp.server));

  const verifier = new OidcTokenVerifier({
    config: { issuer: ISSUER, jwksUri: `${idp.addr}/jwks`, audience: AUDIENCE }
  });
  const token = makeJwt({
    header: { alg: "RS256", typ: "JWT", kid: key.kid },
    // expired 5 minutes ago — well beyond the 30s tolerance
    payload: basePayload({ iat: nowS() - 600, exp: nowS() - 300 }),
    signer: key.sign
  });

  const result = await verifier.verify(token);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "token_expired");
});

// (c2) — iat in the far future (beyond tolerance) => valid:false.
test("(c2) issued-in-future token => valid:false issued_in_future", async (t) => {
  const key = makeRsaKey("rsa-key-iat");
  const idp = await startMockIdp([key.jwk]);
  t.after(() => closeServer(idp.server));

  const verifier = new OidcTokenVerifier({
    config: { issuer: ISSUER, jwksUri: `${idp.addr}/jwks`, audience: AUDIENCE }
  });
  const token = makeJwt({
    header: { alg: "RS256", typ: "JWT", kid: key.kid },
    payload: basePayload({ iat: nowS() + 300, exp: nowS() + 900 }),
    signer: key.sign
  });

  const result = await verifier.verify(token);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "issued_in_future");
});

// (d) — wrong aud and wrong iss are both rejected.
test("(d) wrong audience => valid:false audience_mismatch", async (t) => {
  const key = makeRsaKey("rsa-key-4");
  const idp = await startMockIdp([key.jwk]);
  t.after(() => closeServer(idp.server));

  const verifier = new OidcTokenVerifier({
    config: { issuer: ISSUER, jwksUri: `${idp.addr}/jwks`, audience: AUDIENCE }
  });
  const token = makeJwt({
    header: { alg: "RS256", typ: "JWT", kid: key.kid },
    payload: basePayload({ aud: "some-other-service" }),
    signer: key.sign
  });

  const result = await verifier.verify(token);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "audience_mismatch");
});

test("(d2) wrong issuer => valid:false issuer_mismatch", async (t) => {
  const key = makeRsaKey("rsa-key-5");
  const idp = await startMockIdp([key.jwk]);
  t.after(() => closeServer(idp.server));

  const verifier = new OidcTokenVerifier({
    config: { issuer: ISSUER, jwksUri: `${idp.addr}/jwks`, audience: AUDIENCE }
  });
  const token = makeJwt({
    header: { alg: "RS256", typ: "JWT", kid: key.kid },
    payload: basePayload({ iss: "https://evil.example" }),
    signer: key.sign
  });

  const result = await verifier.verify(token);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "issuer_mismatch");
});

// (e) — alg:"none" is rejected outright, even with a forged unsigned token.
test('(e) alg:"none" is rejected (alg_none_rejected)', async (t) => {
  const key = makeRsaKey("rsa-key-6");
  const idp = await startMockIdp([key.jwk]);
  t.after(() => closeServer(idp.server));

  const verifier = new OidcTokenVerifier({
    config: { issuer: ISSUER, jwksUri: `${idp.addr}/jwks`, audience: AUDIENCE }
  });
  // Unsigned token with a valid-looking payload — must NOT be accepted.
  const token = makeJwt({
    header: { alg: "none", typ: "JWT", kid: key.kid },
    payload: basePayload(),
    signer: null
  });

  const result = await verifier.verify(token);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "alg_none_rejected");
});

// (e2) — unsupported / symmetric alg (HS256) is rejected.
test("(e2) unsupported alg (HS256) => valid:false unsupported_alg", async (t) => {
  const key = makeRsaKey("rsa-key-7");
  const idp = await startMockIdp([key.jwk]);
  t.after(() => closeServer(idp.server));

  const verifier = new OidcTokenVerifier({
    config: { issuer: ISSUER, jwksUri: `${idp.addr}/jwks`, audience: AUDIENCE }
  });
  const token = makeJwt({
    header: { alg: "HS256", typ: "JWT", kid: key.kid },
    payload: basePayload(),
    signer: () => Buffer.from("not-a-real-hmac")
  });

  const result = await verifier.verify(token);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "unsupported_alg");
});

// (e3) — unknown kid (key rotation gap) => valid:false signing_key_not_found.
test("(e3) unknown kid => valid:false signing_key_not_found", async (t) => {
  const present = makeRsaKey("rsa-present");
  const absent = makeRsaKey("rsa-absent");
  const idp = await startMockIdp([present.jwk]);
  t.after(() => closeServer(idp.server));

  const verifier = new OidcTokenVerifier({
    config: { issuer: ISSUER, jwksUri: `${idp.addr}/jwks`, audience: AUDIENCE }
  });
  const token = makeJwt({
    header: { alg: "RS256", typ: "JWT", kid: absent.kid },
    payload: basePayload(),
    signer: absent.sign
  });

  const result = await verifier.verify(token);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "signing_key_not_found");
});

// (f) — no issuer configured => status configured:false; verify is graceful.
test("(f) unconfigured => status configured:false, verify not_configured", async () => {
  const verifier = new OidcTokenVerifier({ env: {} });

  assert.deepEqual(verifier.status(), { configured: false });
  assert.equal(verifier.configured, false);

  const result = await verifier.verify("a.b.c");
  assert.equal(result.valid, false);
  assert.equal(result.reason, "not_configured");
});

// (f2) — configured status() stays Phase A: enforcing:false, humanGateRequired:true.
test("(f2) configured status() => enforcing:false, humanGateRequired:true", () => {
  const verifier = new OidcTokenVerifier({
    env: {
      SYLION_OIDC_ISSUER: `${ISSUER}/`,
      SYLION_OIDC_AUDIENCE: AUDIENCE
    }
  });
  const status = verifier.status();
  assert.equal(status.configured, true);
  assert.equal(status.enforcing, false);
  assert.equal(status.humanGateRequired, true);
  // trailing slash on the issuer is normalized away
  assert.equal(status.issuer, ISSUER);
  assert.equal(status.authoritativeLoginPath, "webauthn");
  // no secret / key / token material in the status surface
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes("PRIVATE"), false);
  assert.equal(serialized.includes("token"), false);
});

// (g) — malformed tokens never throw; they return a reason.
test("(g) malformed tokens => valid:false without throwing", async (t) => {
  const key = makeRsaKey("rsa-malformed");
  const idp = await startMockIdp([key.jwk]);
  t.after(() => closeServer(idp.server));

  const verifier = new OidcTokenVerifier({
    config: { issuer: ISSUER, jwksUri: `${idp.addr}/jwks`, audience: AUDIENCE }
  });

  assert.equal((await verifier.verify("")).reason, "missing_token");
  assert.equal((await verifier.verify("only-one-part")).reason, "malformed_token");
  assert.equal((await verifier.verify("two.parts")).reason, "malformed_token");
  assert.equal((await verifier.verify("not!base64.@@@.$$$")).reason, "malformed_token");
});

// (h) sanity: createPublicKey accepts the test JWK (guards the fixture itself).
test("(h) test fixture JWKs are well-formed public keys", () => {
  const rsa = makeRsaKey(randomUUID());
  const ec = makeEcKey(randomUUID());
  assert.doesNotThrow(() => createPublicKey({ key: rsa.jwk, format: "jwk" }));
  assert.doesNotThrow(() => createPublicKey({ key: ec.jwk, format: "jwk" }));
});
