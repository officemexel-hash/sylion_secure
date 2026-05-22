import { RESOURCE_TYPES } from "../../domain/constants.js";
import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const PROVIDER_METADATA = Object.freeze({
  hetzner: {
    providerKey: "hetzner",
    displayName: "Hetzner Cloud",
    apiType: "token",
    defaultRegions: ["fsn1", "nbg1", "hel1", "ash", "hil"],
    docsUrl: "https://docs.hetzner.cloud/",
    runtimeCapabilities: {
      containers: true,
      nestedKvm: false,
      bareMetalKvm: "dedicated_only",
      firecracker: "dedicated_only",
      androidWorkloads: "dedicated_kvm_or_bare_metal_only",
      intelTdx: false,
      amdSevSnp: false,
      recommendedTier: "STANDARD"
    }
  },
  ovh: {
    providerKey: "ovh",
    displayName: "OVHcloud",
    apiType: "application_secret",
    defaultRegions: ["gra", "rbx", "sbg", "waw", "bhs"],
    docsUrl: "https://help.ovhcloud.com/csm/en-public-cloud-compute-api",
    runtimeCapabilities: {
      containers: true,
      nestedKvm: false,
      bareMetalKvm: true,
      firecracker: true,
      androidWorkloads: "bare_metal_kvm_review_required",
      intelTdx: "sgx_or_dedicated_confidential_only",
      amdSevSnp: "bare_metal_review_required",
      recommendedTier: "PRO"
    }
  },
  aws: {
    providerKey: "aws",
    displayName: "AWS EC2",
    apiType: "access_key",
    defaultRegions: ["eu-central-1", "eu-west-1", "us-east-1"],
    docsUrl: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/amazon-ec2-nested-virtualization.html",
    runtimeCapabilities: {
      containers: true,
      nestedKvm: "c8i_m8i_r8i_or_bare_metal",
      bareMetalKvm: true,
      firecracker: true,
      androidWorkloads: "nested_kvm_or_bare_metal_with_binderfs_required",
      intelTdx: "instance_family_review_required",
      amdSevSnp: "nitro_confidential_review_required",
      recommendedTier: "SOVEREIGN"
    }
  },
  azure: {
    providerKey: "azure",
    displayName: "Microsoft Azure",
    apiType: "service_principal",
    defaultRegions: ["westeurope", "polandcentral", "germanywestcentral"],
    docsUrl: "https://learn.microsoft.com/en-us/azure/confidential-computing/confidential-vm-overview",
    runtimeCapabilities: {
      containers: true,
      nestedKvm: "requires_supported_nested_virtualization_size",
      bareMetalKvm: false,
      firecracker: "nested_kvm_size_or_dedicated_host_required",
      androidWorkloads: "nested_kvm_size_with_binderfs_required",
      intelTdx: true,
      amdSevSnp: true,
      recommendedTier: "SOVEREIGN"
    }
  },
  gcp: {
    providerKey: "gcp",
    displayName: "Google Cloud",
    apiType: "service_account",
    defaultRegions: ["europe-west1", "europe-west3", "us-central1"],
    docsUrl: "https://cloud.google.com/confidential-computing/confidential-vm/docs/confidential-vm-overview",
    runtimeCapabilities: {
      containers: true,
      nestedKvm: "nested_virtualization_supported_on_selected_machines",
      bareMetalKvm: false,
      firecracker: "nested_kvm_machine_required",
      androidWorkloads: "nested_kvm_machine_with_binderfs_required",
      intelTdx: true,
      amdSevSnp: true,
      recommendedTier: "SOVEREIGN"
    }
  },
  oracle: {
    providerKey: "oracle",
    displayName: "Oracle Cloud Infrastructure",
    apiType: "api_key",
    defaultRegions: ["eu-frankfurt-1", "uk-london-1", "us-ashburn-1"],
    docsUrl: "https://docs.oracle.com/en-us/iaas/Content/Compute/References/confidential_compute.htm",
    runtimeCapabilities: {
      containers: true,
      nestedKvm: "bare_metal_preferred",
      bareMetalKvm: true,
      firecracker: true,
      androidWorkloads: "bare_metal_preferred",
      intelTdx: "shape_review_required",
      amdSevSnp: "amd_confidential_shape_review_required",
      recommendedTier: "SOVEREIGN"
    }
  },
  scaleway: {
    providerKey: "scaleway",
    displayName: "Scaleway Elastic Metal",
    apiType: "token",
    defaultRegions: ["fr-par", "nl-ams", "pl-waw"],
    docsUrl: "https://www.scaleway.com/en/docs/tutorials/install-kvm-elastic-metal/",
    runtimeCapabilities: {
      containers: true,
      nestedKvm: false,
      bareMetalKvm: true,
      firecracker: true,
      androidWorkloads: true,
      intelTdx: false,
      amdSevSnp: false,
      recommendedTier: "PRO"
    }
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

function normalizeRuntimeCapabilities(capabilities = {}, defaults = {}) {
  return {
    containers: capabilities.containers ?? defaults.containers ?? true,
    nestedKvm: capabilities.nestedKvm ?? defaults.nestedKvm ?? false,
    bareMetalKvm: capabilities.bareMetalKvm ?? defaults.bareMetalKvm ?? false,
    firecracker: capabilities.firecracker ?? defaults.firecracker ?? false,
    androidWorkloads: capabilities.androidWorkloads ?? defaults.androidWorkloads ?? false,
    intelTdx: capabilities.intelTdx ?? defaults.intelTdx ?? false,
    amdSevSnp: capabilities.amdSevSnp ?? defaults.amdSevSnp ?? false,
    recommendedTier: capabilities.recommendedTier || defaults.recommendedTier || "STANDARD",
    verificationRequired: true
  };
}

export class ProviderRegistryService {
  constructor({ audit, rbac, secrets, connectionTester = null, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.secrets = secrets;
    this.connectionTester = connectionTester;
    this.providers = new PersistentMap({ store, collection: "providers" });
  }

  create({
    actor,
    providerType,
    displayName,
    apiSecret,
    externalSecretReference,
    secretBackendId,
    regions,
    quota,
    billingHealth,
    runtimeCapabilities,
    metadata = {},
    testConnection = { mode: "mock" },
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "provider.create", { resourceType: RESOURCE_TYPES.PROVIDER, correlationId: corr });

    const base = this.#resolveMetadata(providerType, displayName, metadata);
    const providerId = newId("provider");
    const secret = externalSecretReference
      ? this.secrets.createExternalReference({
        actor,
        name: `${base.providerKey}:${providerId}:api`,
        purpose: "provider_api",
        externalReference: externalSecretReference,
        backendId: secretBackendId,
        providerId,
        evidenceRefs: [`provider://${base.providerKey}/external-secret-reference`],
        correlationId: corr
      })
      : this.secrets.create({
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
        rotatedAt: secret.rotatedAt,
        backendId: secret.backendId,
        backendType: secret.backendType,
        custody: secret.custody,
        externalReference: secret.externalReference
      },
      regions: normalizeRegions(regions, base.defaultRegions),
      quota: normalizeQuota(quota),
      billingHealth: normalizeBillingHealth(billingHealth),
      runtimeCapabilities: normalizeRuntimeCapabilities(runtimeCapabilities, base.runtimeCapabilities),
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

  get(providerId) {
    return this.providers.get(providerId);
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

  rotateExternalSecretReference({ actor, providerId, externalSecretReference, evidenceRefs = [], testConnection = { mode: "external_reference" }, correlationId }) {
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
    const secret = this.secrets.rotateExternalReference({
      actor,
      secretReference: previousReference,
      externalReference: externalSecretReference,
      evidenceRefs,
      correlationId: corr
    });
    const rotated = {
      ...provider,
      apiSecretReference: {
        secretReference: secret.secretReference,
        version: secret.version,
        rotatedAt: secret.rotatedAt,
        backendId: secret.backendId,
        backendType: secret.backendType,
        custody: secret.custody,
        externalReference: secret.externalReference
      },
      connection: this.#testConnection({ providerKey: provider.providerKey, testConnection, correlationId: corr }),
      updatedAt: new Date().toISOString()
    };
    this.providers.set(providerId, rotated);
    this.audit.record({
      actorId: actor.id,
      action: "provider.external_secret_reference_rotated",
      resourceType: RESOURCE_TYPES.PROVIDER,
      resourceId: providerId,
      correlationId: corr,
      previousValue: { secretReference: previousReference },
      newValue: {
        secretReference: rotated.apiSecretReference.secretReference,
        version: rotated.apiSecretReference.version,
        backendType: rotated.apiSecretReference.backendType,
        custody: rotated.apiSecretReference.custody,
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
      runtimeCapabilities: merged.runtimeCapabilities || {},
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
