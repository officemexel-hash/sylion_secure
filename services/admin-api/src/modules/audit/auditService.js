import { createHash, createHmac } from "node:crypto";
import { newId, requireCorrelationId } from "../../lib/id.js";

// F-20: fully recursive, deterministic canonicalization.
// The previous implementation passed `Object.keys(value).sort()` as the
// JSON.stringify replacer array. That array is treated as a property
// allowlist applied at every depth, so nested object keys that did not
// appear at the top level were silently dropped (e.g. `newValue: {}`),
// producing hash collisions between materially different events. This
// version sorts object keys at every level and preserves array order so
// the canonical form is stable and lossless.
function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  const sortedKeys = Object.keys(value).sort();
  const result = {};
  for (const key of sortedKeys) {
    result[key] = canonicalize(value[key]);
  }
  return result;
}

function resolveHmacKey(explicitKey) {
  if (typeof explicitKey === "string" && explicitKey.length > 0) {
    return explicitKey;
  }
  const envKey = process.env.SYLION_AUDIT_HMAC_KEY;
  if (typeof envKey === "string" && envKey.length > 0) {
    return envKey;
  }
  return null;
}

export class AuditService {
  // F-19 (flagged, default OFF): when no HMAC key is provided (constructor
  // param `hmacKey` or env SYLION_AUDIT_HMAC_KEY), the chain hash stays a
  // pure sha256(canonical) digest — byte-for-byte identical to legacy
  // behavior. When a key is present, each link becomes
  // HMAC-SHA-256(key, canonical) instead. The key is held only in a private
  // field, is never serialized into events, and is never logged.
  #hmacKey;

  constructor({ store = null, hmacKey = null } = {}) {
    this.store = store;
    this.events = store ? store.list("audit_events") : [];
    this.lastHash = this.events.length > 0 ? this.events[this.events.length - 1].hash : null;
    this.#hmacKey = resolveHmacKey(hmacKey);
  }

  get hmacEnabled() {
    return this.#hmacKey !== null;
  }

  #digest(canonical) {
    if (this.#hmacKey !== null) {
      return createHmac("sha256", this.#hmacKey).update(canonical).digest("hex");
    }
    return createHash("sha256").update(canonical).digest("hex");
  }

  record(input) {
    const event = {
      id: newId("audit"),
      actorId: input.actorId || "system",
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId || null,
      tenantId: input.tenantId || null,
      operatorId: input.operatorId || null,
      timestamp: new Date().toISOString(),
      correlationId: requireCorrelationId(input.correlationId),
      idempotencyKey: input.idempotencyKey || null,
      previousValue: input.previousValue ?? null,
      newValue: input.newValue ?? null,
      policyDecision: input.policyDecision || "allow",
      approvalId: input.approvalId || null,
      result: input.result || "success",
      previousHash: this.lastHash
    };

    const hash = this.#digest(stableJson(event));

    const storedEvent = { ...event, hash };
    this.events.push(storedEvent);
    if (this.store) {
      this.store.save("audit_events", storedEvent.id, storedEvent);
    }
    this.lastHash = hash;
    return storedEvent;
  }

  list() {
    return [...this.events];
  }

  // Recompute the chain over the supplied (or recorded) events using the
  // active digest mode and confirm each link matches its stored hash and
  // back-reference. Any tampering with an event body or with a previously
  // recorded hash breaks recomputation and yields a failing verdict.
  verify(events = this.events) {
    let previousHash = null;
    for (let index = 0; index < events.length; index += 1) {
      const stored = events[index];
      const { hash, ...body } = stored;
      if (body.previousHash !== previousHash) {
        return { valid: false, brokenAt: index, reason: "previous_hash_mismatch" };
      }
      const recomputed = this.#digest(stableJson(body));
      if (recomputed !== hash) {
        return { valid: false, brokenAt: index, reason: "hash_mismatch" };
      }
      previousHash = hash;
    }
    return { valid: true, brokenAt: null, reason: null };
  }
}
