import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/modules/audit/auditService.js";
import { ProviderRegistryService } from "../src/modules/providers/providerRegistryService.js";
import { RbacService } from "../src/modules/rbac/rbacService.js";
import { SecretManagerService } from "../src/modules/secrets/secretManagerService.js";
import { ROLES } from "../src/domain/constants.js";

const actor = {
  id: "admin_global",
  role: ROLES.GLOBAL_SUPER_ADMIN
};

test("provider registry stores provider API secret as references without plaintext leakage", () => {
  const audit = new AuditService();
  const rbac = new RbacService({ audit });
  const secrets = new SecretManagerService({ audit, rbac });
  const providers = new ProviderRegistryService({ audit, rbac, secrets });
  const plaintext = "hetzner-token-should-never-leak";

  const provider = providers.create({
    actor,
    providerType: "hetzner",
    apiSecret: plaintext,
    regions: ["fsn1", "hel1"],
    quota: { instances: 8, vcpu: 16, memoryGb: 64, storageGb: 500 },
    billingHealth: { status: "healthy", checkedAt: "2026-05-20T00:00:00.000Z" },
    testConnection: { mode: "mock", status: "passed" },
    correlationId: "corr_provider_unit"
  });

  assert.equal(provider.providerKey, "hetzner");
  assert.deepEqual(provider.regions, ["fsn1", "hel1"]);
  assert.equal(provider.quota.instances, 8);
  assert.equal(provider.billingHealth.status, "healthy");
  assert.match(provider.apiSecretReference.secretReference, /^secret:\/\/admin-api\/secret_/);
  assert.equal(provider.connection.mode, "mock");
  assert.equal(provider.connection.status, "passed");

  const serialized = JSON.stringify({ provider, audit: audit.list() });
  assert.equal(serialized.includes(plaintext), false);
  assert.equal(Object.hasOwn(provider, "apiSecret"), false);
});

test("provider API secret rotation returns a new reference and emits audit without plaintext", () => {
  const audit = new AuditService();
  const rbac = new RbacService({ audit });
  const secrets = new SecretManagerService({ audit, rbac });
  const providers = new ProviderRegistryService({ audit, rbac, secrets });
  const firstPlaintext = "ovh-initial-secret-never-leak";
  const rotatedPlaintext = "ovh-rotated-secret-never-leak";

  const provider = providers.create({
    actor,
    providerType: "ovh",
    apiSecret: firstPlaintext,
    regions: ["waw"],
    billingHealth: { status: "warning", message: "manual invoice check" },
    correlationId: "corr_provider_create"
  });
  const rotated = providers.rotateSecret({
    actor,
    providerId: provider.id,
    apiSecret: rotatedPlaintext,
    testConnection: { mode: "mock", status: "passed" },
    correlationId: "corr_provider_rotate"
  });

  assert.notEqual(rotated.apiSecretReference.secretReference, provider.apiSecretReference.secretReference);
  assert.equal(rotated.apiSecretReference.version, 2);
  const actions = audit.list().map((event) => event.action);
  assert.ok(actions.includes("provider.api_secret_rotated"));
  assert.ok(actions.includes("secret.rotated"));

  const serialized = JSON.stringify({ rotated, audit: audit.list() });
  assert.equal(serialized.includes(firstPlaintext), false);
  assert.equal(serialized.includes(rotatedPlaintext), false);
});
