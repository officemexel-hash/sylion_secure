import { createHash } from "node:crypto";
import { RESOURCE_TYPES } from "../../domain/constants.js";
import { validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const SECRET_BACKEND_TYPES = new Set(["local_reference", "env_runtime", "vault", "cloud_kms", "hsm", "byo_hsm"]);
const SECRET_BACKEND_MODES = new Set(["reference_only", "runtime_resolver_planned", "runtime_resolver_attested"]);

function hashSecret(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makeReference(secretId, version) {
  return `secret://admin-api/${secretId}/v${version}`;
}

export class SecretManagerService {
  constructor({ audit, rbac, store = null, env = process.env }) {
    this.audit = audit;
    this.rbac = rbac;
    this.env = env;
    this.secrets = new PersistentMap({ store, collection: "secrets" });
    this.backends = new PersistentMap({ store, collection: "secret_backends" });
  }

  create({ actor, name, purpose, plaintext, tenantId = null, providerId = null, backendId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "secret.create", { tenantId, resourceType: RESOURCE_TYPES.SECRET, correlationId: corr });
    this.#assertSecretInput({ name, plaintext });

    const now = new Date().toISOString();
    const secret = {
      id: newId("secret"),
      name: name.trim(),
      purpose: purpose || "provider_api",
      tenantId,
      providerId,
      backendId: backendId || "local_reference",
      backendType: backendId ? this.#requireBackend(backendId).backendType : "local_reference",
      custody: "hash_only_no_plaintext_retrieval",
      version: 1,
      valueHash: hashSecret(plaintext),
      createdAt: now,
      rotatedAt: now
    };
    this.secrets.set(secret.id, secret);

    const reference = this.#toReference(secret);
    this.audit.record({
      actorId: actor.id,
      action: "secret.created",
      resourceType: RESOURCE_TYPES.SECRET,
      resourceId: secret.id,
      tenantId,
      correlationId: corr,
      newValue: reference
    });
    return reference;
  }

  createExternalReference({
    actor,
    name,
    purpose,
    externalReference,
    backendId,
    tenantId = null,
    providerId = null,
    evidenceRefs = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "secret.create", { tenantId, resourceType: RESOURCE_TYPES.SECRET, correlationId: corr });
    this.#assertSecretName(name);
    const backend = this.#requireBackend(backendId);
    const safeReference = this.#externalReference(externalReference);
    const now = new Date().toISOString();
    const secret = {
      id: newId("secret"),
      name: name.trim(),
      purpose: purpose || "provider_api",
      tenantId,
      providerId,
      backendId: backend.id,
      backendType: backend.backendType,
      custody: "external_reference_only",
      version: 1,
      externalReference: safeReference,
      externalReferenceHash: hashSecret(safeReference),
      evidenceRefs: this.#safeArray(evidenceRefs, "evidenceRefs"),
      createdAt: now,
      rotatedAt: now
    };
    this.secrets.set(secret.id, secret);
    const reference = this.#toReference(secret);
    this.audit.record({
      actorId: actor.id,
      action: "secret.external_reference_created",
      resourceType: RESOURCE_TYPES.SECRET,
      resourceId: secret.id,
      tenantId,
      correlationId: corr,
      newValue: reference
    });
    return reference;
  }

  rotate({ actor, secretReference, plaintext, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const { secretId } = this.#parseReference(secretReference);
    const current = this.secrets.get(secretId);
    if (!current) {
      throw validationError("Secret reference is invalid");
    }

    this.rbac.assert(actor, "secret.rotate", {
      tenantId: current.tenantId,
      resourceType: RESOURCE_TYPES.SECRET,
      resourceId: secretId,
      correlationId: corr
    });
    if (current.custody === "external_reference_only") {
      throw validationError("External-reference secrets must rotate by replacing the external reference", {
        secretReference,
        backendType: current.backendType
      });
    }
    this.#assertSecretInput({ name: current.name, plaintext });

    const previousReference = this.#toReference(current);
    const rotated = {
      ...current,
      version: current.version + 1,
      valueHash: hashSecret(plaintext),
      rotatedAt: new Date().toISOString()
    };
    this.secrets.set(secretId, rotated);
    const reference = this.#toReference(rotated);

    this.audit.record({
      actorId: actor.id,
      action: "secret.rotated",
      resourceType: RESOURCE_TYPES.SECRET,
      resourceId: secretId,
      tenantId: rotated.tenantId,
      correlationId: corr,
      previousValue: previousReference,
      newValue: reference
    });
    return reference;
  }

  rotateExternalReference({ actor, secretReference, externalReference, evidenceRefs = [], correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const { secretId } = this.#parseReference(secretReference);
    const current = this.secrets.get(secretId);
    if (!current) throw validationError("Secret reference is invalid");
    if (current.custody !== "external_reference_only") {
      throw validationError("Only external-reference secrets can rotate by external reference", { secretReference });
    }
    this.rbac.assert(actor, "secret.rotate", {
      tenantId: current.tenantId,
      resourceType: RESOURCE_TYPES.SECRET,
      resourceId: secretId,
      correlationId: corr
    });
    const previousReference = this.#toReference(current);
    const safeReference = this.#externalReference(externalReference);
    const rotated = {
      ...current,
      version: current.version + 1,
      externalReference: safeReference,
      externalReferenceHash: hashSecret(safeReference),
      evidenceRefs: this.#safeArray(evidenceRefs, "evidenceRefs"),
      rotatedAt: new Date().toISOString()
    };
    this.secrets.set(secretId, rotated);
    const reference = this.#toReference(rotated);
    this.audit.record({
      actorId: actor.id,
      action: "secret.external_reference_rotated",
      resourceType: RESOURCE_TYPES.SECRET,
      resourceId: secretId,
      tenantId: rotated.tenantId,
      correlationId: corr,
      previousValue: previousReference,
      newValue: reference
    });
    return reference;
  }

  configureBackend({
    actor,
    backendType,
    displayName,
    endpointReference = null,
    keyRingReference = null,
    hsmPartitionReference = null,
    mode = "reference_only",
    evidenceRefs = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "secret.backend.manage", {
      resourceType: RESOURCE_TYPES.SECRET,
      correlationId: corr
    });
    const normalizedType = this.#backendType(backendType);
    const normalizedMode = this.#backendMode(mode);
    const now = new Date().toISOString();
    const backend = {
      id: newId("secret_backend"),
      backendType: normalizedType,
      displayName: this.#requiredText(displayName || normalizedType, "displayName"),
      endpointReference: endpointReference ? this.#externalReference(endpointReference) : null,
      keyRingReference: keyRingReference ? this.#externalReference(keyRingReference) : null,
      hsmPartitionReference: hsmPartitionReference ? this.#externalReference(hsmPartitionReference) : null,
      mode: normalizedMode,
      evidenceRefs: this.#safeArray(evidenceRefs, "evidenceRefs"),
      plaintextRetrievalAllowed: false,
      runtimeResolutionAllowed: normalizedMode === "runtime_resolver_attested",
      productionReady: false,
      humanGateRequired: true,
      createdAt: now
    };
    this.backends.set(backend.id, backend);
    this.audit.record({
      actorId: actor.id,
      action: "secret.backend_configured",
      resourceType: RESOURCE_TYPES.SECRET,
      resourceId: backend.id,
      correlationId: corr,
      newValue: backend
    });
    return backend;
  }

  listBackends({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "secret.backend.read", {
      resourceType: RESOURCE_TYPES.SECRET,
      correlationId: corr
    });
    return this.#backendRecords();
  }

  status({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "secret.backend.read", {
      resourceType: RESOURCE_TYPES.SECRET,
      correlationId: corr
    });
    const backends = this.#backendRecords();
    const externalReferenceCount = [...this.secrets.values()].filter((secret) => secret.custody === "external_reference_only").length;
    return {
      defaultRuntimeSource: "environment",
      envRuntimeConfigured: {
        hetzner: Boolean(this.env.HETZNER_API_TOKEN),
        ovh: Boolean(this.env.OVH_API_SECRET)
      },
      backendCount: backends.length,
      externalReferenceCount,
      plaintextRetrievalAllowed: false,
      productionSecretReleaseAllowed: false,
      humanGateRequired: true,
      supportedBackends: [...SECRET_BACKEND_TYPES],
      activeBackends: backends,
      generatedAt: new Date().toISOString()
    };
  }

  getMetadata(secretReference) {
    const { secretId } = this.#parseReference(secretReference);
    const secret = this.secrets.get(secretId);
    if (!secret) {
      throw validationError("Secret reference is invalid");
    }
    return this.#toReference(secret);
  }

  #assertSecretInput({ name, plaintext }) {
    this.#assertSecretName(name);
    if (!plaintext || typeof plaintext !== "string") {
      throw validationError("Secret plaintext is required");
    }
  }

  #assertSecretName(name) {
    if (!name || name.trim().length < 2) {
      throw validationError("Secret name is required");
    }
  }

  #toReference(secret) {
    return {
      secretReference: makeReference(secret.id, secret.version),
      version: secret.version,
      rotatedAt: secret.rotatedAt,
      backendId: secret.backendId || "local_reference",
      backendType: secret.backendType || "local_reference",
      custody: secret.custody || "hash_only_no_plaintext_retrieval",
      externalReference: secret.externalReference || undefined
    };
  }

  #parseReference(secretReference) {
    const match = String(secretReference || "").match(/^secret:\/\/admin-api\/([^/]+)\/v(\d+)$/);
    if (!match) {
      throw validationError("Secret reference is invalid");
    }
    return { secretId: match[1], version: Number(match[2]) };
  }

  #backendType(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!SECRET_BACKEND_TYPES.has(normalized)) {
      throw validationError("Unsupported secret backend type", { allowed: [...SECRET_BACKEND_TYPES] });
    }
    return normalized;
  }

  #backendMode(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!SECRET_BACKEND_MODES.has(normalized)) {
      throw validationError("Unsupported secret backend mode", { allowed: [...SECRET_BACKEND_MODES] });
    }
    return normalized;
  }

  #requiredText(value, field) {
    const text = String(value || "").trim();
    if (text.length < 2) throw validationError(`${field} is required`, { field });
    return text;
  }

  #externalReference(value) {
    const text = this.#requiredText(value, "externalReference");
    if (/-----BEGIN|private[_ -]?key|password=|token=|api[_ -]?key=|secret=|bearer\s+/i.test(text)) {
      throw validationError("External secret reference must not contain secret material", {
        plaintextRejected: true
      });
    }
    return text;
  }

  #safeArray(value = [], field) {
    if (!Array.isArray(value)) throw validationError(`${field} must be an array`, { field });
    return value.map((item, index) => this.#requiredText(item, `${field}.${index}`));
  }

  #backendRecords() {
    return [
      {
        id: "env_runtime",
        backendType: "env_runtime",
        displayName: "Runtime environment",
        endpointReference: "process.env",
        mode: "runtime_resolver_attested",
        plaintextRetrievalAllowed: false,
        runtimeResolutionAllowed: true,
        productionReady: false,
        humanGateRequired: true,
        evidenceRefs: ["step3-16-runtime-secret-provider"]
      },
      {
        id: "local_reference",
        backendType: "local_reference",
        displayName: "Local hash reference store",
        endpointReference: "admin-api:persistent-map",
        mode: "reference_only",
        plaintextRetrievalAllowed: false,
        runtimeResolutionAllowed: false,
        productionReady: false,
        humanGateRequired: true,
        evidenceRefs: ["step3-19-contract-only"]
      },
      ...this.backends.values()
    ];
  }

  #requireBackend(backendId) {
    const backend = this.#backendRecords().find((item) => item.id === backendId);
    if (!backend) throw validationError("Secret backend is not configured", { backendId });
    return backend;
  }
}
