import { RESOURCE_TYPES } from "../../domain/constants.js";
import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";

const PROVIDER_METADATA = Object.freeze({
  hetzner: {
    providerKey: "hetzner",
    displayName: "Hetzner Cloud",
    apiType: "token",
    defaultRegions: ["fsn1", "nbg1", "hel1", "ash", "hil"],
    docsUrl: "https://docs.hetzner.cloud/"
  },
  ovh: {
    providerKey: "ovh",
    displayName: "OVHcloud",
    apiType: "application_secret",
    defaultRegions: ["gra", "rbx", "sbg", "waw", "bhs"],
    docsUrl: "https://help.ovhcloud.com/csm/en-public-cloud-compute-api"
  }
});

const BILLING_HEALTH = new Set(["unknown", "healthy", "warning", "blocked"]);

function sanitizeProviderType(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRegions(regions, defaults) {
  if (regions === undefined) {
    if (defaults.length === 0) {
      throw validationError("Provider regions must be supplied for custom providers");
    }
    return defaults;
  }
  if (!Array.isArray(regions) || regions.length === 0) {
    throw validationError("Provider regions must be a non-empty array");
  }
  return regions.map((region) => String(region).trim()).filter(Boolean);
}

function normalizeQuota(quota = {}) {
  return {
    instances: Number.isInteger(quota.instances) ? quota.instances : 0,
    vcpu: Number.isInteger(quota.vcpu) ? quota.vcpu : 0,
    memoryGb: Number.isInteger(quota.memoryGb) ? quota.memoryGb : 0,
    storageGb: Number.isInteger(quota.storageGb) ? quota.storageGb : 0
  };
}

function normalizeBillingHealth(billingHealth = {}) {
  const status = billingHealth.status || "unknown";
  if (!BILLING_HEALTH.has(status)) {
    throw validationError("Billing health status is invalid", { allowed: [...BILLING_HEALTH] });
  }
  return {
    status,
    checkedAt: billingHealth.checkedAt || null,
    message: billingHealth.message || null
  };
}

function normalizeConnectionResult(result) {
  const status = result?.status || "mocked";
  return {
    status,
    checkedAt: new Date().toISOString(),
    mode: result?.mode || "mock",
    message: result?.message || null
  };
}

export class ProviderRegistryService {
  constructor({ audit, rbac, secrets, connectionTester = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.secrets = secrets;
    this.connectionTester = connectionTester;
    this.providers = new Map();
  }

  create({
    actor,
    providerType,
    displayName,
    apiSecret,
    regions,
    quota,
    billingHealth,
    metadata = {},
    testConnection = { mode: "mock" },
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "provider.create", { resourceType: RESOURCE_TYPES.PROVIDER, correlationId: corr });

    const base = this.#resolveMetadata(providerType, displayName, metadata);
    const providerId = newId("provider");
    const secret = this.secrets.create({
      actor,
      name: `${base.providerKey}:${providerId}:api`,
      purpose: "provider_api",
      plaintext: apiSecret,
      providerId,
      correlationId: corr
    });
    const provider = {
      id: providerId,
      providerKey: base.providerKey,
      displayName: base.displayName,
      metadata: base.metadata,
      apiSecretReference: {
        secretReference: secret.secretReference,
        version: secret.version,
        rotatedAt: secret.rotatedAt
      },
      regions: normalizeRegions(regions, base.defaultRegions),
      quota: normalizeQuota(quota),
      billingHealth: normalizeBillingHealth(billingHealth),
      connection: this.#testConnection({ providerKey: base.providerKey, testConnection, correlationId: corr }),
      createdAt: new Date().toISOString()
    };

    this.providers.set(provider.id, provider);
    this.audit.record({
      actorId: actor.id,
      action: "provider.created",
      resourceType: RESOURCE_TYPES.PROVIDER,
      resourceId: provider.id,
      correlationId: corr,
      newValue: provider
    });
    return provider;
  }

  list({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "provider.read", { resourceType: RESOURCE_TYPES.PROVIDER, correlationId: corr });
    return [...this.providers.values()];
  }

  rotateSecret({ actor, providerId, apiSecret, testConnection = { mode: "mock" }, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw notFound("provider", providerId);
    }
    this.rbac.assert(actor, "provider.secret.rotate", {
      resourceType: RESOURCE_TYPES.PROVIDER,
      resourceId: providerId,
      correlationId: corr
    });

    const previousReference = provider.apiSecretReference.secretReference;
    const secret = this.secrets.rotate({
      actor,
      secretReference: previousReference,
      plaintext: apiSecret,
      correlationId: corr
    });
    const rotated = {
      ...provider,
      apiSecretReference: {
        secretReference: secret.secretReference,
        version: secret.version,
        rotatedAt: secret.rotatedAt
      },
      connection: this.#testConnection({ providerKey: provider.providerKey, testConnection, correlationId: corr }),
      updatedAt: new Date().toISOString()
    };

    this.providers.set(providerId, rotated);
    this.audit.record({
      actorId: actor.id,
      action: "provider.api_secret_rotated",
      resourceType: RESOURCE_TYPES.PROVIDER,
      resourceId: providerId,
      correlationId: corr,
      previousValue: { secretReference: previousReference },
      newValue: {
        secretReference: rotated.apiSecretReference.secretReference,
        version: rotated.apiSecretReference.version,
        connection: rotated.connection
      }
    });
    return rotated;
  }

  #resolveMetadata(providerType, displayName, metadata) {
    const providerKey = sanitizeProviderType(providerType);
    if (!providerKey) {
      throw validationError("Provider type is required");
    }
    const known = PROVIDER_METADATA[providerKey];
    if (!known && !displayName) {
      throw validationError("Display name is required for custom providers");
    }
    const merged = {
      ...(known || {
        providerKey,
        displayName,
        apiType: metadata.apiType || "token",
        defaultRegions: []
      }),
      ...metadata
    };
    return {
      providerKey,
      displayName: displayName || merged.displayName,
      defaultRegions: merged.defaultRegions || [],
      metadata: {
        providerKey,
        apiType: merged.apiType,
        docsUrl: merged.docsUrl || null,
        extensible: !known,
        ...metadata
      }
    };
  }

  #testConnection({ providerKey, testConnection, correlationId }) {
    if (this.connectionTester) {
      return normalizeConnectionResult(this.connectionTester({ providerKey, testConnection, correlationId }));
    }
    if (testConnection?.mode === "mock") {
      return normalizeConnectionResult({
        mode: "mock",
        status: testConnection.status || "passed",
        message: testConnection.message || null
      });
    }
    return normalizeConnectionResult({ mode: "mock", status: "mocked" });
  }
}
