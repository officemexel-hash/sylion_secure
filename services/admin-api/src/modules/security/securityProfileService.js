import { RESOURCE_TYPES } from "../../domain/constants.js";
import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const FIDO2_MODES = new Set(["configuration_only", "enrollment_deferred", "enrollment_ready"]);
const HSM_MODES = new Set(["reference_only", "byo_hsm_deferred", "vault_hsm_planned"]);

function isoNow() {
  return new Date().toISOString();
}

function requireScope(scope) {
  if (!["admin", "operator"].includes(scope)) {
    throw validationError("Unsupported security profile scope", { scope });
  }
  return scope;
}

function profileId(scope, operatorId = null, kind) {
  return scope === "admin" ? `admin:${kind}` : `operator:${operatorId}:${kind}`;
}

function cleanCsv(value = []) {
  if (!Array.isArray(value)) {
    throw validationError("Value must be an array");
  }
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function assertNoSecretMaterial(payload, path = "profile") {
  if (!payload || typeof payload !== "object") return;
  for (const [key, value] of Object.entries(payload)) {
    const current = `${path}.${key}`;
    if (/secret|private.*key|seed|password|token|pem/i.test(key)) {
      throw validationError(
        "Security profiles must store references and policy only, never secret material",
        {
          field: current
        }
      );
    }
    assertNoSecretMaterial(value, current);
  }
}

export class SecurityProfileService {
  constructor({ audit, rbac, operators, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.operators = operators;
    this.profiles = new PersistentMap({ store, collection: "security_profiles" });
  }

  getFido2Policy({ actor, scope = "admin", operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.#assertAccess({
      actor,
      action: "security.profile.read",
      scope,
      operatorId,
      correlationId: corr
    });
    return this.#getOrCreateFido2Policy({ scope, operatorId });
  }

  updateFido2Policy({
    actor,
    scope = "admin",
    operatorId = null,
    mode = "enrollment_deferred",
    required = true,
    defaultSessionHours = 12,
    allowedTransports = ["usb", "nfc"],
    userVerification = "required",
    notes = null,
    correlationId,
    ...extra
  }) {
    const corr = requireCorrelationId(correlationId);
    assertNoSecretMaterial(extra);
    this.#assertAccess({
      actor,
      action: "security.profile.manage",
      scope,
      operatorId,
      correlationId: corr
    });
    requireScope(scope);
    if (scope === "operator") this.#requireOperator(operatorId);
    if (!FIDO2_MODES.has(mode)) {
      throw validationError("Unsupported FIDO2 mode", { mode, allowed: [...FIDO2_MODES] });
    }
    const sessionHours = Number(defaultSessionHours);
    if (!Number.isInteger(sessionHours) || sessionHours < 1 || sessionHours > 24) {
      throw validationError("defaultSessionHours must be an integer from 1 to 24", {
        defaultSessionHours
      });
    }
    const previous = this.#getOrCreateFido2Policy({ scope, operatorId });
    const next = {
      ...previous,
      mode,
      required: required !== false,
      defaultSessionHours: sessionHours,
      allowedTransports: cleanCsv(allowedTransports),
      userVerification,
      physicalEnrollmentDeferred: mode !== "enrollment_ready",
      actualEnrollmentAllowed: mode === "enrollment_ready",
      notes,
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    assertNoSecretMaterial(next);
    this.profiles.set(next.id, next);
    this.#audit({
      actor,
      action: "security.fido2_policy.updated",
      profile: next,
      previous,
      correlationId: corr
    });
    return next;
  }

  getHsmProfile({ actor, scope = "admin", operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.#assertAccess({
      actor,
      action: "security.profile.read",
      scope,
      operatorId,
      correlationId: corr
    });
    return this.#getOrCreateHsmProfile({ scope, operatorId });
  }

  updateHsmProfile({
    actor,
    scope = "admin",
    operatorId = null,
    mode = "reference_only",
    provider = "vault_hsm_planned",
    references = [],
    attestationRefs = [],
    rotationDays = 90,
    notes = null,
    correlationId,
    ...extra
  }) {
    const corr = requireCorrelationId(correlationId);
    assertNoSecretMaterial(extra);
    this.#assertAccess({
      actor,
      action: "security.profile.manage",
      scope,
      operatorId,
      correlationId: corr
    });
    requireScope(scope);
    if (scope === "operator") this.#requireOperator(operatorId);
    if (!HSM_MODES.has(mode)) {
      throw validationError("Unsupported HSM mode", { mode, allowed: [...HSM_MODES] });
    }
    const normalizedRotationDays = Number(rotationDays);
    if (
      !Number.isInteger(normalizedRotationDays) ||
      normalizedRotationDays < 1 ||
      normalizedRotationDays > 365
    ) {
      throw validationError("rotationDays must be an integer from 1 to 365", { rotationDays });
    }
    const previous = this.#getOrCreateHsmProfile({ scope, operatorId });
    const next = {
      ...previous,
      mode,
      provider: String(provider || "vault_hsm_planned"),
      references: cleanCsv(references),
      attestationRefs: cleanCsv(attestationRefs),
      rotationDays: normalizedRotationDays,
      physicalHsmDeferred: mode !== "vault_hsm_planned",
      materialStored: false,
      notes,
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    assertNoSecretMaterial(next);
    this.profiles.set(next.id, next);
    this.#audit({
      actor,
      action: "security.hsm_profile.updated",
      profile: next,
      previous,
      correlationId: corr
    });
    return next;
  }

  #getOrCreateFido2Policy({ scope, operatorId }) {
    requireScope(scope);
    if (scope === "operator") this.#requireOperator(operatorId);
    const id = profileId(scope, operatorId, "fido2");
    const existing = this.profiles.get(id);
    if (existing) return existing;
    const profile = {
      id,
      kind: "fido2_policy",
      scope,
      operatorId: scope === "operator" ? operatorId : null,
      mode: "enrollment_deferred",
      required: true,
      defaultSessionHours: 12,
      allowedTransports: ["usb", "nfc"],
      userVerification: "required",
      physicalEnrollmentDeferred: true,
      actualEnrollmentAllowed: false,
      notes: "Physical FIDO2 enrollment deferred; panel configuration is active.",
      createdAt: isoNow(),
      createdBy: "system"
    };
    this.profiles.set(profile.id, profile);
    return profile;
  }

  #getOrCreateHsmProfile({ scope, operatorId }) {
    requireScope(scope);
    if (scope === "operator") this.#requireOperator(operatorId);
    const id = profileId(scope, operatorId, "hsm");
    const existing = this.profiles.get(id);
    if (existing) return existing;
    const profile = {
      id,
      kind: "hsm_profile",
      scope,
      operatorId: scope === "operator" ? operatorId : null,
      mode: "reference_only",
      provider: "vault_hsm_planned",
      references: [],
      attestationRefs: [],
      rotationDays: 90,
      physicalHsmDeferred: true,
      materialStored: false,
      notes: "HSM/BYO-HSM integration deferred; reference-only metadata is active.",
      createdAt: isoNow(),
      createdBy: "system"
    };
    this.profiles.set(profile.id, profile);
    return profile;
  }

  #assertAccess({ actor, action, scope, operatorId, correlationId }) {
    requireScope(scope);
    this.rbac.assert(actor, action, {
      operatorId: scope === "operator" ? operatorId : null,
      correlationId,
      resourceType: RESOURCE_TYPES.SECURITY_PROFILE
    });
  }

  #requireOperator(operatorId) {
    if (!operatorId) throw validationError("operatorId is required for operator security profile");
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    return operator;
  }

  #audit({ actor, action, profile, previous, correlationId }) {
    this.audit.record({
      actorId: actor.id,
      action,
      resourceType: RESOURCE_TYPES.SECURITY_PROFILE,
      resourceId: profile.id,
      operatorId: profile.operatorId,
      correlationId,
      previousValue: previous,
      newValue: profile
    });
  }
}
