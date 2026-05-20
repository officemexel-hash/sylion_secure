import { RESOURCE_TYPES } from "../../domain/constants.js";
import { validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const ROTATION_SCOPES = new Set([
  "session",
  "ip_route",
  "microvm",
  "workload_vps",
  "g1",
  "g2",
  "all_3_vps",
  "provider",
  "region",
  "certificates"
]);

const TIER_SCOPE_ALLOWLIST = Object.freeze({
  STANDARD: new Set(["session", "ip_route", "region"]),
  PRO: new Set(["session", "ip_route", "microvm", "workload_vps", "provider", "region", "certificates"]),
  SOVEREIGN: ROTATION_SCOPES
});

export class JurisdictionPolicyService {
  constructor({ audit, rbac, entitlements, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.entitlements = entitlements;
    this.policies = new PersistentMap({ store, collection: "jurisdiction_policies" });
  }

  create({ actor, tenantId, operatorId, tier, name, allowedProviders, allowedRegions, blockedRegions = [], rotationFrequency, rotationScopes, cooldownHours = 24, approvalRequired = true, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "jurisdiction.policy.create", { tenantId, operatorId, correlationId: corr });
    const tierLimits = this.entitlements.getTier(tier);
    if (!name || name.trim().length < 2) {
      throw validationError("Jurisdiction policy name is required");
    }
    if (!Array.isArray(allowedProviders) || allowedProviders.length === 0) {
      throw validationError("At least one allowed provider is required");
    }
    if (!Array.isArray(allowedRegions) || allowedRegions.length === 0) {
      throw validationError("At least one allowed region is required");
    }
    const allowedScopes = TIER_SCOPE_ALLOWLIST[tier];
    const invalidScopes = rotationScopes.filter((scope) => !ROTATION_SCOPES.has(scope));
    if (invalidScopes.length > 0) {
      throw validationError("Unknown rotation scopes", { invalidScopes });
    }
    const forbiddenScopes = rotationScopes.filter((scope) => !allowedScopes.has(scope));
    if (forbiddenScopes.length > 0) {
      throw validationError("Rotation scope exceeds tier entitlement", {
        tier,
        forbiddenScopes,
        jurisdictionRotation: tierLimits.jurisdictionRotation
      });
    }

    const policy = {
      id: newId("jurisdiction"),
      tenantId,
      operatorId: operatorId || null,
      tier,
      name: name.trim(),
      allowedProviders,
      allowedRegions,
      blockedRegions,
      rotationFrequency,
      rotationScopes,
      cooldownHours,
      approvalRequired,
      description: "Lawful region/provider control and infrastructure exposure reduction policy.",
      createdAt: new Date().toISOString()
    };
    this.policies.set(policy.id, policy);
    this.audit.record({
      actorId: actor.id,
      action: "jurisdiction_policy.created",
      resourceType: "jurisdiction_policy",
      resourceId: policy.id,
      tenantId,
      operatorId,
      correlationId: corr,
      newValue: policy
    });
    return policy;
  }

  planRotation({ actor, policyId, requestedScopes, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw validationError("Jurisdiction policy not found", { policyId });
    }
    this.rbac.assert(actor, "jurisdiction.rotation.plan", {
      tenantId: policy.tenantId,
      operatorId: policy.operatorId,
      correlationId: corr
    });
    const deniedScopes = requestedScopes.filter((scope) => !policy.rotationScopes.includes(scope));
    if (deniedScopes.length > 0) {
      throw validationError("Requested rotation scopes are not allowed by policy", { deniedScopes });
    }
    const rotationPlan = {
      id: newId("rotation"),
      policyId,
      tenantId: policy.tenantId,
      operatorId: policy.operatorId,
      requestedScopes,
      approvalRequired: policy.approvalRequired || requestedScopes.includes("all_3_vps"),
      cooldownHours: policy.cooldownHours,
      steps: requestedScopes.map((scope) => ({
        scope,
        status: "planned"
      })),
      createdAt: new Date().toISOString()
    };
    this.audit.record({
      actorId: actor.id,
      action: "jurisdiction_rotation.planned",
      resourceType: "jurisdiction_rotation",
      resourceId: rotationPlan.id,
      tenantId: policy.tenantId,
      operatorId: policy.operatorId,
      correlationId: corr,
      newValue: rotationPlan
    });
    return rotationPlan;
  }
}
