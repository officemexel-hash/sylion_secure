import assert from "node:assert/strict";
import test from "node:test";
import {
  SecretManagerService,
  selectSecretProvider,
  resolveSecretBackend
} from "../src/modules/secrets/secretManagerService.js";
import { EnvSecretProvider } from "../src/modules/secrets/envSecretProvider.js";
import {
  VaultSecretProvider,
  VaultBackendNotIntegratedError
} from "../src/modules/secrets/vaultSecretProvider.js";

// Minimal stubs — RBAC always allows, audit captures events for assertions.
function makeService(env = {}) {
  const audit = { events: [] };
  audit.record = (event) => audit.events.push(event);
  const rbac = { assert() {} };
  return { service: new SecretManagerService({ audit, rbac, env }), audit };
}

const actor = { id: "actor-secret-test" };
const corr = "corr_secret_rotation_vault_skeleton";
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// (a) Flag OFF: backend defaults to "env", behaviour identical to today.
// ---------------------------------------------------------------------------

test("F-25 secret backend defaults to env and returns EnvSecretProvider (flag OFF)", () => {
  assert.equal(resolveSecretBackend({}), "env");
  assert.equal(resolveSecretBackend({ SYLION_SECRET_BACKEND: "" }), "env");
  // unknown value falls back to env (fail-safe to current behaviour)
  assert.equal(resolveSecretBackend({ SYLION_SECRET_BACKEND: "totally-unknown" }), "env");

  const provider = selectSecretProvider({ env: { HETZNER_API_TOKEN: "x-env-token-never-leak" } });
  assert.ok(provider instanceof EnvSecretProvider);
  assert.equal(provider.hasProviderSecret("hetzner"), true);
  assert.equal(provider.status().source, "environment");
  // explicit "env" is equivalent to the default
  assert.ok(
    selectSecretProvider({ env: { SYLION_SECRET_BACKEND: "env" } }) instanceof EnvSecretProvider
  );
});

test("create without a rotation policy keeps prior behaviour (status not_configured)", () => {
  const { service } = makeService();
  const ref = service.create({
    actor,
    name: "provider-token",
    plaintext: "plaintext-never-leaks-1",
    correlationId: corr
  });
  // additive metadata present, but policy absent
  assert.equal(ref.rotationPolicy, undefined);
  assert.ok(ref.lastRotatedAt);
  const evaluation = service.evaluateRotation(ref.secretReference);
  assert.equal(evaluation.status, "not_configured");
  assert.equal(evaluation.configured, false);
  assert.equal(evaluation.actionRequired, false);
  // no plaintext anywhere in the returned reference
  assert.equal(JSON.stringify(ref).includes("plaintext-never-leaks-1"), false);
});

// ---------------------------------------------------------------------------
// (b) F-34: evaluateRotation thresholds (WARN 14d, HIGH/CRITICAL 7d/1d = due).
// ---------------------------------------------------------------------------

test("F-34 evaluateRotation maps time-to-expiry to ok / warn / due / overdue", () => {
  const { service } = makeService();
  const now = Date.parse("2026-06-10T00:00:00.000Z");

  const evalAt = (daysUntilExpiry) =>
    service.evaluateRotation(
      { expiresAt: new Date(now + daysUntilExpiry * DAY_MS).toISOString() },
      { now }
    ).status;

  assert.equal(evalAt(30), "ok"); // >14d
  assert.equal(evalAt(15), "ok"); // just outside warn window
  assert.equal(evalAt(14), "warn"); // warn boundary
  assert.equal(evalAt(10), "warn"); // inside warn
  assert.equal(evalAt(7), "due"); // high boundary => due
  assert.equal(evalAt(3), "due"); // inside high
  assert.equal(evalAt(1), "due"); // critical boundary => due
  assert.equal(evalAt(0.5), "due"); // inside critical
  assert.equal(evalAt(0), "overdue"); // at expiry
  assert.equal(evalAt(-5), "overdue"); // past expiry
});

test("F-34 rotationTtlMs derives expiresAt and rotate() resets the window + audits", () => {
  const { service, audit } = makeService();
  const ref = service.create({
    actor,
    name: "rotating-token",
    plaintext: "plaintext-create-never-leak",
    rotationPolicy: { rotationTtlMs: 30 * DAY_MS },
    correlationId: corr
  });
  assert.ok(ref.rotationPolicy);
  assert.equal(ref.rotationPolicy.rotationTtlMs, 30 * DAY_MS);
  assert.ok(ref.rotationPolicy.expiresAt);

  // Fresh secret with 30d ttl evaluates ok against "now".
  assert.equal(service.evaluateRotation(ref.secretReference).status, "ok");

  const rotated = service.rotate({
    actor,
    secretReference: ref.secretReference,
    plaintext: "plaintext-rotate-never-leak",
    correlationId: corr
  });
  assert.equal(rotated.version, 2);
  assert.ok(rotated.rotationPolicy.expiresAt);

  const rotationEvent = audit.events.find((e) => e.action === "secret.rotated");
  assert.ok(rotationEvent, "rotation audit event recorded");
  assert.equal(rotationEvent.rotation.mode, "manual");
  assert.equal(rotationEvent.rotation.rotationTtlMs, 30 * DAY_MS);
  // audit carries metadata only, never the plaintext
  assert.equal(JSON.stringify(audit.events).includes("plaintext-rotate-never-leak"), false);
  assert.equal(JSON.stringify(audit.events).includes("plaintext-create-never-leak"), false);
});

// ---------------------------------------------------------------------------
// (c) F-25: VaultSecretProvider skeleton — not integrated, no plaintext.
// ---------------------------------------------------------------------------

test("F-25 SYLION_SECRET_BACKEND=vault selects VaultSecretProvider", () => {
  const provider = selectSecretProvider({ env: { SYLION_SECRET_BACKEND: "vault" } });
  assert.ok(provider instanceof VaultSecretProvider);
});

test("F-25 VaultSecretProvider is not integrated, productionReady=false, no plaintext", () => {
  const provider = new VaultSecretProvider({
    env: { SYLION_VAULT_ADDR: "vault://sylion-staging" }
  });

  const status = provider.status();
  assert.equal(status.integrated, false);
  assert.equal(status.reason, "vault_backend_not_integrated");
  assert.equal(status.productionReady, false);
  assert.equal(status.humanGateRequired, true);
  assert.equal(status.plaintextRetrievalAllowed, false);
  assert.equal(status.plaintextExposed, false);

  // hasProviderSecret fails closed (no resolvable secret) rather than claiming true
  assert.equal(provider.hasProviderSecret("hetzner"), false);

  // getProviderToken MUST NOT return plaintext — it throws not_integrated.
  assert.throws(
    () => provider.getProviderToken("hetzner"),
    (err) => {
      assert.ok(err instanceof VaultBackendNotIntegratedError);
      assert.equal(err.reason, "vault_backend_not_integrated");
      assert.equal(err.productionReady, false);
      assert.equal(err.humanGateRequired, true);
      return true;
    }
  );

  // no token material is ever exposed through the provider surface
  assert.equal(JSON.stringify(status).includes("vault_backend_not_integrated"), true);
  assert.equal(JSON.stringify(status).includes("token"), false);
});
