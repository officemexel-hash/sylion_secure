import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const VPS_ROLES = Object.freeze(["G1", "G2", "WORKLOAD"]);
const LIFECYCLE_STATES = Object.freeze([
  "planned",
  "provisioning",
  "active",
  "rotating",
  "degraded",
  "suspended",
  "retired"
]);

function requireNonEmpty(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(`${field} is required`, { field });
  }
  return value.trim();
}

function assertNoPrivateKeyMaterial(value, path = "payload") {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const currentPath = `${path}.${key}`;
    if (/private.*key|key.*private|pem|secret/i.test(key)) {
      throw validationError("Inventory records must not contain private key material", { field: currentPath });
    }
    assertNoPrivateKeyMaterial(nested, currentPath);
  }
}

function normalizeCertRefs(certRefs = {}) {
  return Object.fromEntries(
    Object.entries(certRefs).map(([role, ref]) => [role, requireNonEmpty(ref, `certRefs.${role}`)])
  );
}

export class InventoryService {
  constructor({ audit, rbac, operators, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.operators = operators;
    this.vpsSets = new PersistentMap({ store, collection: "infrastructure_sets" });
    this.setIdToOperator = new Map();
    this.providerResourceOwners = new Map();
    for (const set of this.vpsSets.values()) {
      this.setIdToOperator.set(set.id, set.operatorId);
      for (const item of set.vps || []) {
        this.providerResourceOwners.set(item.providerResourceId, {
          operatorId: set.operatorId,
          infrastructureSetId: set.id,
          role: item.role
        });
      }
    }
  }

  registerVpsSet({
    actor,
    operatorId,
    infrastructureSetId = newId("infra_set"),
    provider,
    region,
    imageRef,
    certRefs = {},
    vps = [],
    lifecycleState = "planned",
    drift = { detected: false },
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "inventory.vps_set.register", { operatorId, correlationId: corr });
    assertNoPrivateKeyMaterial({ certRefs, vps });

    const operator = this.operators.get(operatorId);
    if (!operator) {
      throw notFound("operator", operatorId);
    }
    if (!LIFECYCLE_STATES.includes(lifecycleState)) {
      throw validationError("Invalid infrastructure lifecycle state", { lifecycleState, allowed: LIFECYCLE_STATES });
    }

    const setOwner = this.setIdToOperator.get(infrastructureSetId);
    if (setOwner && setOwner !== operatorId) {
      throw validationError("Infrastructure set is already assigned to another operator", {
        infrastructureSetId,
        ownerOperatorId: setOwner,
        requestedOperatorId: operatorId
      });
    }

    const normalized = this.#normalizeVpsSet({
      operator,
      infrastructureSetId,
      provider,
      region,
      imageRef,
      certRefs: normalizeCertRefs(certRefs),
      vps,
      lifecycleState,
      drift
    });

    for (const item of normalized.vps) {
      const providerOwner = this.providerResourceOwners.get(item.providerResourceId);
      if (providerOwner && providerOwner.operatorId !== operatorId) {
        throw validationError("VPS provider resource is already assigned to another operator", {
          providerResourceId: item.providerResourceId,
          ownerOperatorId: providerOwner.operatorId,
          requestedOperatorId: operatorId
        });
      }
    }

    this.vpsSets.set(infrastructureSetId, normalized);
    this.setIdToOperator.set(infrastructureSetId, operatorId);
    for (const item of normalized.vps) {
      this.providerResourceOwners.set(item.providerResourceId, {
        operatorId,
        infrastructureSetId,
        role: item.role
      });
    }

    this.audit.record({
      actorId: actor.id,
      action: "inventory.vps_set.registered",
      resourceType: "infrastructure_set",
      resourceId: infrastructureSetId,
      tenantId: operator.tenantId,
      operatorId,
      correlationId: corr,
      newValue: normalized
    });

    return normalized;
  }

  listForOperator({ actor, operatorId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "inventory.vps_set.read", { operatorId, correlationId: corr });
    const operator = this.operators.get(operatorId);
    if (!operator) {
      throw notFound("operator", operatorId);
    }
    return [...this.vpsSets.values()].filter((set) => set.operatorId === operatorId);
  }

  transitionLifecycle({ actor, infrastructureSetId, lifecycleState, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const current = this.vpsSets.get(infrastructureSetId);
    if (!current) {
      throw notFound("infrastructure_set", infrastructureSetId);
    }
    this.rbac.assert(actor, "inventory.vps_set.transition", {
      operatorId: current.operatorId,
      correlationId: corr
    });
    if (!LIFECYCLE_STATES.includes(lifecycleState)) {
      throw validationError("Invalid infrastructure lifecycle state", { lifecycleState, allowed: LIFECYCLE_STATES });
    }

    const next = {
      ...current,
      lifecycleState,
      vps: current.vps.map((item) => ({ ...item, lifecycleState })),
      updatedAt: new Date().toISOString()
    };
    this.vpsSets.set(infrastructureSetId, next);
    this.audit.record({
      actorId: actor.id,
      action: "inventory.vps_set.lifecycle_transitioned",
      resourceType: "infrastructure_set",
      resourceId: infrastructureSetId,
      tenantId: next.tenantId,
      operatorId: next.operatorId,
      correlationId: corr,
      previousValue: current,
      newValue: next
    });
    return next;
  }

  attachCertificateReference({ actor, infrastructureSetId, role, certRef, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const current = this.vpsSets.get(infrastructureSetId);
    if (!current) {
      throw notFound("infrastructure_set", infrastructureSetId);
    }
    this.rbac.assert(actor, "inventory.vps_set.certificate.attach", {
      operatorId: current.operatorId,
      correlationId: corr
    });
    if (!VPS_ROLES.includes(role)) {
      throw validationError("Invalid VPS role", { role, allowed: VPS_ROLES });
    }
    const nextCertRef = requireNonEmpty(certRef, "certRef");
    const next = {
      ...current,
      certRefs: { ...current.certRefs, [role]: nextCertRef },
      vps: current.vps.map((item) => (item.role === role ? { ...item, certRef: nextCertRef } : item)),
      updatedAt: new Date().toISOString()
    };
    this.vpsSets.set(infrastructureSetId, next);
    this.audit.record({
      actorId: actor.id,
      action: "inventory.vps_set.certificate_attached",
      resourceType: "infrastructure_set",
      resourceId: infrastructureSetId,
      tenantId: next.tenantId,
      operatorId: next.operatorId,
      correlationId: corr,
      previousValue: current,
      newValue: next
    });
    return next;
  }

  get(infrastructureSetId) {
    return this.vpsSets.get(infrastructureSetId);
  }

  #normalizeVpsSet({ operator, infrastructureSetId, provider, region, imageRef, certRefs, vps, lifecycleState, drift }) {
    const normalizedProvider = requireNonEmpty(provider, "provider");
    const normalizedRegion = requireNonEmpty(region, "region");
    const normalizedImageRef = requireNonEmpty(imageRef, "imageRef");
    const byRole = new Map(vps.map((item) => [item.role, item]));
    const roles = new Set(vps.map((item) => item.role));
    const missingRoles = VPS_ROLES.filter((role) => !roles.has(role));
    const unknownRoles = [...roles].filter((role) => !VPS_ROLES.includes(role));

    if (vps.length !== VPS_ROLES.length || missingRoles.length > 0 || unknownRoles.length > 0) {
      throw validationError("Infrastructure set must contain exactly G1, G2, and WORKLOAD VPS records", {
        requiredRoles: VPS_ROLES,
        missingRoles,
        unknownRoles
      });
    }

    const normalizedVps = VPS_ROLES.map((role) => {
      const item = byRole.get(role);
      const providerResourceId = requireNonEmpty(item.providerResourceId, `vps.${role}.providerResourceId`);
      return {
        id: item.id || newId("vps"),
        role,
        operatorId: operator.id,
        tenantId: operator.tenantId,
        infrastructureSetId,
        provider: item.provider || normalizedProvider,
        region: item.region || normalizedRegion,
        imageRef: item.imageRef || normalizedImageRef,
        providerResourceId,
        certRef: item.certRef || certRefs[role] || null,
        lifecycleState,
        drift: item.drift || drift,
        shared: false
      };
    });

    return {
      id: infrastructureSetId,
      operatorId: operator.id,
      tenantId: operator.tenantId,
      provider: normalizedProvider,
      region: normalizedRegion,
      imageRef: normalizedImageRef,
      certRefs,
      lifecycleState,
      drift,
      isolatedPerOperator: true,
      vps: normalizedVps,
      createdAt: new Date().toISOString()
    };
  }
}

export { LIFECYCLE_STATES as INFRASTRUCTURE_LIFECYCLE_STATES, VPS_ROLES };
