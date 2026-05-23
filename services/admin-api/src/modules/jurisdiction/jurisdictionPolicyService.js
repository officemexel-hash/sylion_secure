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

const ROUTE_RESULTS = new Set(["passed", "blocked", "failed"]);
const ROUTE_EGRESS_CLASSES = new Set(["direct_vpn", "tor", "jurisdictional_vpn", "unknown"]);
const TERMINAL_MODES = new Set(["pixel_grapheneos", "laptop_web_terminal", "unknown"]);

function requireText(value, field, min = 1) {
  if (!value || String(value).trim().length < min) {
    throw validationError(`${field} is required`, { field });
  }
  return String(value).trim();
}

function safeArray(value = [], field) {
  if (!Array.isArray(value)) {
    throw validationError(`${field} must be an array`, { field });
  }
  return value.map((item, index) => requireText(item, `${field}.${index}`));
}

function assertNoSensitiveRouteData(value, path = "routeEvidence") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    const currentPath = `${path}.${key}`;
    if (/password|secret|token|api[_-]?key|otp|seed|mnemonic|private[_-]?key|message|chat|payload|body|communication[_-]?content/i.test(key)) {
      throw validationError("Route evidence must not contain secrets or communication content", {
        field: currentPath,
        boundary: "ROUTE_METADATA_ONLY"
      });
    }
    if (typeof nested === "string" && /-----BEGIN|bearer\s+|api[_-]?key|password=|token=|secret=/i.test(nested)) {
      throw validationError("Route evidence contains sensitive runtime data", {
        field: currentPath,
        boundary: "ROUTE_METADATA_ONLY"
      });
    }
    assertNoSensitiveRouteData(nested, currentPath);
  }
}

function normalizeEnum(value, allowed, field, fallback = null) {
  const normalized = String(value || fallback || "").trim().toLowerCase();
  if (!allowed.has(normalized)) {
    throw validationError(`${field} is not supported`, { field, value, allowed: [...allowed] });
  }
  return normalized;
}

function passedCheck(checks = {}, key) {
  const value = checks[key];
  if (value === true || value === "passed") return true;
  if (value && typeof value === "object") return value.status === "passed" || value.passed === true;
  return false;
}

export class JurisdictionPolicyService {
  constructor({ audit, rbac, entitlements, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.entitlements = entitlements;
    this.policies = new PersistentMap({ store, collection: "jurisdiction_policies" });
    this.routeEvidence = new PersistentMap({ store, collection: "jurisdiction_route_evidence" });
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

  recordRouteEvidence({
    actor,
    tenantId,
    operatorId,
    tier,
    appKey = "workload",
    terminalMode = "unknown",
    routeProfile = "manual",
    egressClass = "unknown",
    observedCountry = null,
    result = "blocked",
    policyDecision = null,
    tierEntitled = false,
    checks = {},
    evidenceRefs = [],
    blockers = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "jurisdiction.rotation.plan", {
      tenantId,
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.JURISDICTION_ROUTE_EVIDENCE
    });
    assertNoSensitiveRouteData({ checks, evidenceRefs, blockers });
    const normalizedResult = normalizeEnum(result, ROUTE_RESULTS, "result");
    const normalizedEgress = normalizeEnum(egressClass, ROUTE_EGRESS_CLASSES, "egressClass", "unknown");
    const normalizedTerminal = normalizeEnum(terminalMode, TERMINAL_MODES, "terminalMode", "unknown");
    const decision = policyDecision || (normalizedResult === "passed" ? "allow" : "deny");
    const requiredChecks = {
      tierPolicyEnforced: passedCheck(checks, "tierPolicyEnforced"),
      routePolicyEnforced: passedCheck(checks, "routePolicyEnforced"),
      egressClassObserved: passedCheck(checks, "egressClassObserved"),
      terminalDataStored: checks.terminalDataStored === true,
      contentInspected: checks.contentInspected === true,
      anonymityClaimed: checks.anonymityClaimed === true
    };
    const recordBlockers = [
      ...safeArray(blockers, "blockers"),
      ...(normalizedResult === "passed" && !requiredChecks.tierPolicyEnforced ? ["tierPolicyEnforced_not_passed"] : []),
      ...(normalizedResult === "passed" && !requiredChecks.routePolicyEnforced ? ["routePolicyEnforced_not_passed"] : []),
      ...(normalizedResult === "passed" && !requiredChecks.egressClassObserved ? ["egressClassObserved_not_passed"] : []),
      ...(requiredChecks.terminalDataStored ? ["terminal_data_storage_forbidden"] : []),
      ...(requiredChecks.contentInspected ? ["content_inspection_forbidden"] : []),
      ...(requiredChecks.anonymityClaimed ? ["anonymity_claim_forbidden"] : [])
    ];
    if (normalizedResult === "passed" && recordBlockers.length) {
      throw validationError("Passed route evidence requires tier, route and egress checks with no terminal data or anonymity claim", {
        blockers: recordBlockers
      });
    }
    const record = {
      id: newId("route_ev"),
      tenantId: requireText(tenantId, "tenantId"),
      operatorId: requireText(operatorId, "operatorId"),
      tier: requireText(tier, "tier"),
      appKey: requireText(appKey, "appKey"),
      terminalMode: normalizedTerminal,
      routeProfile: requireText(routeProfile, "routeProfile"),
      egressClass: normalizedEgress,
      observedCountry: observedCountry ? String(observedCountry).trim().toUpperCase() : null,
      result: normalizedResult,
      policyDecision: decision,
      tierEntitled: tierEntitled === true,
      checks: requiredChecks,
      evidenceRefs: safeArray(evidenceRefs, "evidenceRefs"),
      blockers: recordBlockers,
      terminalDataStored: false,
      contentInspected: false,
      anonymityClaimed: false,
      productionExecutionAllowed: false,
      createdAt: new Date().toISOString(),
      createdBy: actor.id
    };
    this.routeEvidence.set(record.id, record);
    this.audit.record({
      actorId: actor.id,
      action: "jurisdiction_route.evidence_recorded",
      resourceType: RESOURCE_TYPES.JURISDICTION_ROUTE_EVIDENCE,
      resourceId: record.id,
      tenantId,
      operatorId,
      correlationId: corr,
      policyDecision: decision,
      result: normalizedResult,
      newValue: record
    });
    return record;
  }

  listRouteEvidence({ actor, operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "jurisdiction.rotation.plan", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.JURISDICTION_ROUTE_EVIDENCE
    });
    return [...this.routeEvidence.values()]
      .filter((record) => !operatorId || record.operatorId === operatorId);
  }

  routeEvidenceSummary({ operatorIds = [] } = {}) {
    const operatorSet = new Set(operatorIds.filter(Boolean));
    const records = [...this.routeEvidence.values()]
      .filter((record) => operatorSet.size === 0 || operatorSet.has(record.operatorId));
    const egressClasses = new Set(records.map((record) => record.egressClass));
    const allowedRouteObserved = records.some((record) => (
      record.result === "passed"
      && record.policyDecision === "allow"
      && record.tierEntitled === true
      && record.checks?.tierPolicyEnforced === true
      && record.checks?.routePolicyEnforced === true
      && record.checks?.egressClassObserved === true
      && record.terminalDataStored === false
      && record.contentInspected === false
      && record.anonymityClaimed === false
      && ["tor", "jurisdictional_vpn"].includes(record.egressClass)
    ));
    const deniedTierObserved = records.some((record) => (
      record.policyDecision === "deny"
      && record.tierEntitled === false
      && record.checks?.tierPolicyEnforced === true
    ));
    const terminalDataStoredFalseObserved = records.some((record) => record.terminalDataStored === false);
    const contentInspectedFalseObserved = records.some((record) => record.contentInspected === false);
    const ready = allowedRouteObserved
      && deniedTierObserved
      && terminalDataStoredFalseObserved
      && contentInspectedFalseObserved;
    return {
      records: records.length,
      egressClasses: [...egressClasses],
      allowedRouteObserved,
      deniedTierObserved,
      terminalDataStoredFalseObserved,
      contentInspectedFalseObserved,
      ready,
      blockers: ready ? [] : [
        ...(allowedRouteObserved ? [] : ["tor_or_jurisdiction_route_probe_missing"]),
        ...(deniedTierObserved ? [] : ["tier_denial_probe_missing"]),
        ...(terminalDataStoredFalseObserved ? [] : ["terminal_no_data_evidence_missing"]),
        ...(contentInspectedFalseObserved ? [] : ["content_not_inspected_evidence_missing"])
      ],
      productionExecutionAllowed: false
    };
  }
}
