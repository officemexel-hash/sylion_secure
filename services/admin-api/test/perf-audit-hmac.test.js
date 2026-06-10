import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { AuditService } from "../src/modules/audit/auditService.js";

const CORRELATION_ID = "perf-audit-hmac-correlation";

// Independent, reference recursive canonicalization. Intentionally a second
// implementation so the test pins the *behavior* (recursive key sorting,
// array order preserved, lossless nesting) rather than re-using the module
// under test.
function referenceCanonical(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => referenceCanonical(item));
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = referenceCanonical(value[key]);
  }
  return out;
}

function referenceStableJson(value) {
  return JSON.stringify(referenceCanonical(value));
}

function referenceHash(event) {
  return createHash("sha256").update(referenceStableJson(event)).digest("hex");
}

function sampleEvents() {
  // Nested object payloads on purpose: this is exactly the shape (F-20) the
  // legacy shallow canonicalizer dropped to `{}` and collided on.
  return [
    {
      actorId: "operator-1",
      action: "auth.login",
      resourceType: "session",
      resourceId: "sess-1",
      correlationId: CORRELATION_ID,
      newValue: { email: "alice@example.test", purpose: "login", mfa: { type: "fido2", ok: true } }
    },
    {
      actorId: "operator-1",
      action: "auth.breakglass",
      resourceType: "session",
      resourceId: "sess-2",
      correlationId: CORRELATION_ID,
      newValue: {
        email: "alice@example.test",
        purpose: "breakglass",
        scopes: ["a", "b"],
        mfa: { ok: false, type: "fido2" }
      }
    }
  ];
}

function recordAll(service) {
  return sampleEvents().map((input) => service.record(input));
}

// Recompute the event body that the service hashed, so we can verify against
// an independent reference digest. Mirrors the field set assembled in record().
function rebuildBody(stored) {
  const body = { ...stored };
  delete body.hash;
  return body;
}

test("F-20: recursive canonicalization keeps nested payloads (no collision)", () => {
  const service = new AuditService();
  const collidingA = service.record({
    action: "auth.login",
    resourceType: "session",
    correlationId: CORRELATION_ID,
    newValue: { email: "alice@example.test", purpose: "login" }
  });
  const collidingB = service.record({
    action: "auth.login",
    resourceType: "session",
    correlationId: CORRELATION_ID,
    newValue: { email: "mallory@evil.test", purpose: "breakglass" }
  });
  // Different nested newValue must yield different hashes. Under the legacy
  // shallow canonicalizer both serialized to `newValue: {}` and collided.
  assert.notEqual(collidingA.hash, collidingB.hash);
});

test("F-19 flag OFF: no key => chain identical to reference pure sha256", () => {
  // No constructor key and no env key -> legacy pure-sha256 behavior.
  assert.equal(process.env.SYLION_AUDIT_HMAC_KEY, undefined);
  const service = new AuditService();
  assert.equal(service.hmacEnabled, false);

  const recorded = recordAll(service);
  let previousHash = null;
  for (const stored of recorded) {
    const body = rebuildBody(stored);
    assert.equal(body.previousHash, previousHash);
    // Each link equals an independent plain sha256(canonical) of the body.
    assert.equal(stored.hash, referenceHash(body));
    previousHash = stored.hash;
  }
  assert.equal(service.verify().valid, true);
});

test("F-19 flag ON: keyed chain verifies and differs from unkeyed chain", () => {
  const key = "unit-test-only-ephemeral-key-not-a-real-secret";
  const keyed = new AuditService({ hmacKey: key });
  assert.equal(keyed.hmacEnabled, true);

  const recorded = recordAll(keyed);

  // Keyed digests must be HMAC-SHA-256(key, canonical), not plain sha256.
  let previousHash = null;
  for (const stored of recorded) {
    const body = rebuildBody(stored);
    const expected = createHmac("sha256", key).update(referenceStableJson(body)).digest("hex");
    assert.equal(stored.hash, expected);
    assert.notEqual(stored.hash, referenceHash(body));
    previousHash = stored.hash;
  }
  assert.ok(previousHash);

  // Chain verifies against the same keyed instance.
  assert.equal(keyed.verify().valid, true);

  // A verifier without the key (or with the wrong key) cannot validate the
  // keyed chain -> integrity is bound to the secret.
  const unkeyed = new AuditService();
  assert.equal(unkeyed.verify(recorded).valid, false);
  const wrongKey = new AuditService({ hmacKey: "a-different-key" });
  assert.equal(wrongKey.verify(recorded).valid, false);
});

test("F-19 flag ON: tampering with a recorded event fails verification", () => {
  const key = "unit-test-only-ephemeral-key-not-a-real-secret";
  const keyed = new AuditService({ hmacKey: key });
  const recorded = recordAll(keyed);

  // Tamper with the body of the first event while leaving its stored hash.
  const tampered = recorded.map((event) => ({ ...event }));
  tampered[0].newValue = { ...tampered[0].newValue, purpose: "exfiltrate" };

  const verdict = keyed.verify(tampered);
  assert.equal(verdict.valid, false);
  assert.equal(verdict.brokenAt, 0);
  assert.equal(verdict.reason, "hash_mismatch");

  // Tampering with a stored hash breaks the back-reference of the next link.
  const tampered2 = recorded.map((event) => ({ ...event }));
  tampered2[0].hash = "0".repeat(64);
  const verdict2 = keyed.verify(tampered2);
  assert.equal(verdict2.valid, false);
});

test("F-19: HMAC key never leaks into events, public records, or audit output", () => {
  const key = "super-distinctive-marker-key-value-12345";
  const keyed = new AuditService({ hmacKey: key });
  const recorded = recordAll(keyed);

  // The key must not appear in any individual stored event.
  for (const stored of recorded) {
    assert.equal(Object.prototype.hasOwnProperty.call(stored, "hmacKey"), false);
    assert.equal(JSON.stringify(stored).includes(key), false);
  }

  // The key must not appear in the full list() output.
  assert.equal(JSON.stringify(keyed.list()).includes(key), false);

  // The key must not be enumerable on the service instance, nor leak via a
  // full structural serialization of the instance.
  assert.equal(Object.keys(keyed).includes("hmacKey"), false);
  assert.equal(JSON.stringify(keyed).includes(key), false);
});

test("F-19: env-backed key activates HMAC mode without a constructor param", () => {
  const previous = process.env.SYLION_AUDIT_HMAC_KEY;
  const key = "env-ephemeral-unit-test-key-not-a-secret";
  process.env.SYLION_AUDIT_HMAC_KEY = key;
  try {
    const service = new AuditService();
    assert.equal(service.hmacEnabled, true);
    const recorded = recordAll(service);
    for (const stored of recorded) {
      const body = rebuildBody(stored);
      const expected = createHmac("sha256", key).update(referenceStableJson(body)).digest("hex");
      assert.equal(stored.hash, expected);
      assert.equal(JSON.stringify(stored).includes(key), false);
    }
    assert.equal(service.verify().valid, true);
  } finally {
    if (previous === undefined) {
      delete process.env.SYLION_AUDIT_HMAC_KEY;
    } else {
      process.env.SYLION_AUDIT_HMAC_KEY = previous;
    }
  }
});
