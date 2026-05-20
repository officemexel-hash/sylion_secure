import { createHash } from "node:crypto";
import { RESOURCE_TYPES } from "../../domain/constants.js";
import { validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

function hashSecret(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makeReference(secretId, version) {
  return `secret://admin-api/${secretId}/v${version}`;
}

export class SecretManagerService {
  constructor({ audit, rbac, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.secrets = new PersistentMap({ store, collection: "secrets" });
  }

  create({ actor, name, purpose, plaintext, tenantId = null, providerId = null, correlationId }) {
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
    if (!plaintext || typeof plaintext !== "string") {
      throw validationError("Secret plaintext is required for rotation");
    }

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

  getMetadata(secretReference) {
    const { secretId } = this.#parseReference(secretReference);
    const secret = this.secrets.get(secretId);
    if (!secret) {
      throw validationError("Secret reference is invalid");
    }
    return this.#toReference(secret);
  }

  #assertSecretInput({ name, plaintext }) {
    if (!name || name.trim().length < 2) {
      throw validationError("Secret name is required");
    }
    if (!plaintext || typeof plaintext !== "string") {
      throw validationError("Secret plaintext is required");
    }
  }

  #toReference(secret) {
    return {
      secretReference: makeReference(secret.id, secret.version),
      version: secret.version,
      rotatedAt: secret.rotatedAt
    };
  }

  #parseReference(secretReference) {
    const match = String(secretReference || "").match(/^secret:\/\/admin-api\/([^/]+)\/v(\d+)$/);
    if (!match) {
      throw validationError("Secret reference is invalid");
    }
    return { secretId: match[1], version: Number(match[2]) };
  }
}
