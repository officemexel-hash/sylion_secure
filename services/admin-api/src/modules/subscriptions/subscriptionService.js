import { createHash, randomBytes } from "node:crypto";
import { APP_STATUSES, RESOURCE_TYPES, TIERS } from "../../domain/constants.js";
import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const TIER_VALUES = new Set(Object.values(TIERS));
const BILLING_STATES = new Set(["trial", "active", "past_due", "suspended", "cancelled"]);
const ALLOCATION_STATUSES = new Set(["planned", "active", "suspended"]);
const ADDONS = new Set(["matrix_custom_server", "phantom_admin_lifecycle"]);
const PAYMENT_PROVIDER_MODES = new Set(["sandbox", "manual_paid_reference", "card_gateway_live", "crypto_gateway_live"]);
const PAYMENT_STATUSES = new Set(["paid_sandbox", "paid_external_reference", "paid_live", "failed", "refunded"]);

const DEFAULT_PLANS = Object.freeze([
  {
    id: "plan_standard",
    tier: TIERS.STANDARD,
    name: "STANDARD",
    maxWorkloadEnvironments: 3,
    maxAppsPerOperator: 3,
    regionCount: 2,
    jurisdictionRotationMode: "limited_manual",
    jurisdictionPolicy: {
      allowedModes: ["disabled", "manual"],
      minFrequencyHours: 168,
      maxCountries: 2,
      providerRotationAllowed: false,
      allVpsRotationAllowed: false
    },
    providerPolicy: {
      allowedRuntimeClasses: ["containers"],
      confidentialComputeRequired: false,
      firecrackerRequired: false,
      allowedProviderCount: 1,
      workloadTenancy: "shared_dedicated_pool_allowed",
      dedicatedWorkloadPerOperatorRequired: false,
      phantomWorkloadDedicatedRequired: true
    },
    sessionPolicy: {
      defaultHours: 8,
      maxHours: 8,
      fido2RequiredAtSessionEnd: true
    },
    matrixAddonAvailable: true,
    phantomAdminLifecycleAvailable: false,
    cdrMandatory: true,
    supportLevel: "standard"
  },
  {
    id: "plan_pro",
    tier: TIERS.PRO,
    name: "PRO",
    maxWorkloadEnvironments: 10,
    maxAppsPerOperator: 5,
    regionCount: 5,
    jurisdictionRotationMode: "scheduled",
    jurisdictionPolicy: {
      allowedModes: ["disabled", "manual", "scheduled"],
      minFrequencyHours: 24,
      maxCountries: 5,
      providerRotationAllowed: true,
      allVpsRotationAllowed: false
    },
    providerPolicy: {
      allowedRuntimeClasses: ["containers", "firecracker"],
      confidentialComputeRequired: false,
      firecrackerRequired: true,
      allowedProviderCount: 3,
      workloadTenancy: "shared_dedicated_pool_allowed",
      dedicatedWorkloadPerOperatorRequired: false,
      phantomWorkloadDedicatedRequired: true
    },
    sessionPolicy: {
      defaultHours: 12,
      maxHours: 12,
      fido2RequiredAtSessionEnd: true
    },
    matrixAddonAvailable: true,
    phantomAdminLifecycleAvailable: true,
    cdrMandatory: true,
    supportLevel: "priority"
  },
  {
    id: "plan_sovereign",
    tier: TIERS.SOVEREIGN,
    name: "SOVEREIGN",
    maxWorkloadEnvironments: 30,
    maxAppsPerOperator: 10,
    regionCount: "custom",
    jurisdictionRotationMode: "full_policy",
    jurisdictionPolicy: {
      allowedModes: ["disabled", "manual", "scheduled", "full_policy"],
      minFrequencyHours: 4,
      maxCountries: "custom",
      providerRotationAllowed: true,
      allVpsRotationAllowed: true
    },
    providerPolicy: {
      allowedRuntimeClasses: ["containers", "firecracker", "confidential"],
      confidentialComputeRequired: true,
      firecrackerRequired: true,
      allowedProviderCount: "custom",
      workloadTenancy: "dedicated_operator_only",
      dedicatedWorkloadPerOperatorRequired: true,
      phantomWorkloadDedicatedRequired: true
    },
    sessionPolicy: {
      defaultHours: 12,
      maxHours: 24,
      fido2RequiredAtSessionEnd: true
    },
    matrixAddonAvailable: true,
    phantomAdminLifecycleAvailable: true,
    cdrMandatory: true,
    supportLevel: "sovereign"
  }
]);

function isoNow() {
  return new Date().toISOString();
}

function requireText(value, field, min = 2) {
  if (!value || typeof value !== "string" || value.trim().length < min) {
    throw validationError(`${field} is required`, { field });
  }
  return value.trim();
}

function requirePositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw validationError(`${field} must be a positive integer`, { field, value });
  }
  return number;
}

function cleanAddons(addons = []) {
  if (!Array.isArray(addons)) {
    throw validationError("addons must be an array");
  }
  const unique = [...new Set(addons)];
  const unknown = unique.filter((addon) => !ADDONS.has(addon));
  if (unknown.length) {
    throw validationError("Unknown subscription add-on", { unknown });
  }
  return unique;
}

function tokenHash(token) {
  return createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function tokenPreview(token) {
  const value = String(token || "");
  return value.length > 10 ? `${value.slice(0, 7)}...${value.slice(-4)}` : "[redacted]";
}

function requirePositiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw validationError(`${field} must be a positive number`, { field, value });
  }
  return number;
}

function requireEnum(value, allowed, field) {
  if (!allowed.has(value)) {
    throw validationError(`Unsupported ${field}`, { field, value, allowed: [...allowed] });
  }
  return value;
}

function safeRefs(value = [], field = "refs") {
  if (!Array.isArray(value)) throw validationError(`${field} must be an array`, { field });
  return value.map((item, index) => requireText(String(item || ""), `${field}.${index}`));
}

function publicPlan(plan) {
  const defaults = DEFAULT_PLANS.find((item) => item.tier === plan.tier) || {};
  return {
    id: plan.id,
    tier: plan.tier,
    name: plan.name,
    custom: plan.custom === true,
    maxWorkloadEnvironments: plan.maxWorkloadEnvironments,
    maxAppsPerOperator: plan.maxAppsPerOperator,
    regionCount: plan.regionCount,
    jurisdictionRotationMode: plan.jurisdictionRotationMode,
    jurisdictionPolicy: plan.jurisdictionPolicy || defaults.jurisdictionPolicy,
    providerPolicy: plan.providerPolicy || defaults.providerPolicy,
    sessionPolicy: plan.sessionPolicy || defaults.sessionPolicy,
    matrixAddonAvailable: plan.matrixAddonAvailable,
    phantomAdminLifecycleAvailable: plan.phantomAdminLifecycleAvailable,
    phantomExecutionAllowed: false,
    cdrMandatory: true,
    supportLevel: plan.supportLevel,
    status: plan.status || "active",
    createdAt: plan.createdAt || null,
    createdBy: plan.createdBy || "system"
  };
}

export class SubscriptionService {
  constructor({ audit, rbac, tenants, operators, appCatalog, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.tenants = tenants;
    this.operators = operators;
    this.appCatalog = appCatalog;
    this.plans = new PersistentMap({ store, collection: "subscription_plans" });
    this.subscriptions = new PersistentMap({ store, collection: "tenant_subscriptions" });
    this.allocations = new PersistentMap({ store, collection: "workload_allocations" });
    this.quotaDecisions = new PersistentMap({ store, collection: "workload_quota_decisions" });
    this.placementPlans = new PersistentMap({ store, collection: "microvm_placement_plans" });
    this.paymentTokens = new PersistentMap({ store, collection: "subscription_payment_tokens" });
    this.paymentTokenRedemptions = new PersistentMap({ store, collection: "subscription_payment_token_redemptions" });
    this.#seedPlans();
  }

  listPlans({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "subscription.read", { correlationId: corr, resourceType: RESOURCE_TYPES.SUBSCRIPTION_PLAN });
    return [...this.plans.values()].map(publicPlan);
  }

  createPlan({ actor, tier, name, maxWorkloadEnvironments, maxAppsPerOperator, regionCount, jurisdictionRotationMode, jurisdictionPolicy = {}, providerPolicy = {}, sessionPolicy = {}, matrixAddonAvailable = true, phantomAdminLifecycleAvailable = false, cdrMandatory = true, supportLevel = "custom", correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "subscription.manage", { correlationId: corr, resourceType: RESOURCE_TYPES.SUBSCRIPTION_PLAN });
    if (!TIER_VALUES.has(tier)) {
      throw validationError("Unknown subscription tier", { tier });
    }
    if (cdrMandatory !== true) {
      throw validationError("Subscription plans must keep CDR mandatory", { cdrMandatory });
    }
    const plan = {
      id: newId("plan"),
      tier,
      name: requireText(name, "name"),
      custom: true,
      maxWorkloadEnvironments: requirePositiveInteger(maxWorkloadEnvironments, "maxWorkloadEnvironments"),
      maxAppsPerOperator: requirePositiveInteger(maxAppsPerOperator, "maxAppsPerOperator"),
      regionCount: regionCount === "custom" ? "custom" : requirePositiveInteger(regionCount, "regionCount"),
      jurisdictionRotationMode: requireText(jurisdictionRotationMode, "jurisdictionRotationMode"),
      jurisdictionPolicy: {
        allowedModes: Array.isArray(jurisdictionPolicy.allowedModes) && jurisdictionPolicy.allowedModes.length ? jurisdictionPolicy.allowedModes : ["disabled", "manual"],
        minFrequencyHours: requirePositiveInteger(jurisdictionPolicy.minFrequencyHours || 24, "jurisdictionPolicy.minFrequencyHours"),
        maxCountries: jurisdictionPolicy.maxCountries === "custom" ? "custom" : requirePositiveInteger(jurisdictionPolicy.maxCountries || regionCount || 1, "jurisdictionPolicy.maxCountries"),
        providerRotationAllowed: jurisdictionPolicy.providerRotationAllowed === true,
        allVpsRotationAllowed: jurisdictionPolicy.allVpsRotationAllowed === true
      },
      providerPolicy: {
        allowedRuntimeClasses: Array.isArray(providerPolicy.allowedRuntimeClasses) && providerPolicy.allowedRuntimeClasses.length ? providerPolicy.allowedRuntimeClasses : ["containers"],
        confidentialComputeRequired: providerPolicy.confidentialComputeRequired === true,
        firecrackerRequired: providerPolicy.firecrackerRequired === true,
        allowedProviderCount: providerPolicy.allowedProviderCount === "custom" ? "custom" : requirePositiveInteger(providerPolicy.allowedProviderCount || 1, "providerPolicy.allowedProviderCount"),
        workloadTenancy: providerPolicy.workloadTenancy || (tier === TIERS.SOVEREIGN ? "dedicated_operator_only" : "shared_dedicated_pool_allowed"),
        dedicatedWorkloadPerOperatorRequired: tier === TIERS.SOVEREIGN || providerPolicy.dedicatedWorkloadPerOperatorRequired === true,
        phantomWorkloadDedicatedRequired: providerPolicy.phantomWorkloadDedicatedRequired !== false
      },
      sessionPolicy: {
        defaultHours: requirePositiveInteger(sessionPolicy.defaultHours || 12, "sessionPolicy.defaultHours"),
        maxHours: requirePositiveInteger(sessionPolicy.maxHours || 12, "sessionPolicy.maxHours"),
        fido2RequiredAtSessionEnd: sessionPolicy.fido2RequiredAtSessionEnd !== false
      },
      matrixAddonAvailable: matrixAddonAvailable === true,
      phantomAdminLifecycleAvailable: phantomAdminLifecycleAvailable === true,
      phantomExecutionAllowed: false,
      cdrMandatory: true,
      supportLevel: requireText(supportLevel, "supportLevel"),
      status: "draft",
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.plans.set(plan.id, plan);
    this.audit.record({
      actorId: actor.id,
      action: "subscription.plan_created",
      resourceType: RESOURCE_TYPES.SUBSCRIPTION_PLAN,
      resourceId: plan.id,
      correlationId: corr,
      newValue: publicPlan(plan)
    });
    return publicPlan(plan);
  }

  ensureForTenant({ actor = null, tenant, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const existing = this.subscriptions.get(tenant.id);
    if (existing) return this.#publicSubscription(existing);
    const plan = this.#defaultPlanForTier(tenant.tier);
    const subscription = {
      id: `sub_${tenant.id}`,
      tenantId: tenant.id,
      tier: tenant.tier,
      planId: plan.id,
      addons: [],
      billingStatus: "active",
      suspensionState: "none",
      effectiveLimits: publicPlan(plan),
      activatedAt: isoNow(),
      changedAt: null,
      changedBy: null
    };
    this.subscriptions.set(tenant.id, subscription);
    this.audit.record({
      actorId: actor?.id || "system",
      action: "subscription.initialized",
      resourceType: RESOURCE_TYPES.TENANT_SUBSCRIPTION,
      resourceId: subscription.id,
      tenantId: tenant.id,
      correlationId: corr,
      newValue: this.#publicSubscription(subscription)
    });
    return this.#publicSubscription(subscription);
  }

  getTenantSubscription({ actor, tenantId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "subscription.read", { tenantId, correlationId: corr, resourceType: RESOURCE_TYPES.TENANT_SUBSCRIPTION });
    const tenant = this.#requireTenant(tenantId);
    return this.ensureForTenant({ actor, tenant, correlationId: corr });
  }

  updateTenantSubscription({ actor, tenantId, planId = null, tier = null, addons = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "subscription.manage", { tenantId, correlationId: corr, resourceType: RESOURCE_TYPES.TENANT_SUBSCRIPTION });
    const tenant = this.#requireTenant(tenantId);
    const previous = this.ensureForTenant({ actor, tenant, correlationId: corr });
    const plan = planId ? this.#requirePlan(planId) : this.#defaultPlanForTier(tier || previous.tier);
    const next = {
      ...previous,
      tier: tier || plan.tier,
      planId: plan.id,
      addons: addons === null ? previous.addons : cleanAddons(addons || []),
      effectiveLimits: publicPlan(plan),
      changedAt: isoNow(),
      changedBy: actor.id
    };
    this.subscriptions.set(tenant.id, next);
    this.audit.record({
      actorId: actor.id,
      action: "subscription.updated",
      resourceType: RESOURCE_TYPES.TENANT_SUBSCRIPTION,
      resourceId: next.id,
      tenantId,
      correlationId: corr,
      previousValue: previous,
      newValue: this.#publicSubscription(next)
    });
    return this.#publicSubscription(next);
  }

  updateAddons({ actor, tenantId, addons, correlationId }) {
    const subscription = this.updateTenantSubscription({ actor, tenantId, addons, correlationId });
    this.audit.record({
      actorId: actor.id,
      action: "subscription.addons_updated",
      resourceType: RESOURCE_TYPES.TENANT_SUBSCRIPTION,
      resourceId: subscription.id,
      tenantId,
      correlationId: requireCorrelationId(correlationId),
      newValue: { tenantId, addons: subscription.addons, phantomExecutionAllowed: false }
    });
    return subscription;
  }

  updateBillingState({ actor, tenantId, billingStatus, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "subscription.manage", { tenantId, correlationId: corr, resourceType: RESOURCE_TYPES.TENANT_SUBSCRIPTION });
    if (!BILLING_STATES.has(billingStatus)) {
      throw validationError("Unknown billing state", { billingStatus });
    }
    const tenant = this.#requireTenant(tenantId);
    const previous = this.ensureForTenant({ actor, tenant, correlationId: corr });
    const next = {
      ...previous,
      billingStatus,
      suspensionState: billingStatus === "suspended" ? "allocation_blocked" : billingStatus === "cancelled" ? "human_gate_required" : "none",
      destructiveCleanupAllowed: false,
      changedAt: isoNow(),
      changedBy: actor.id
    };
    this.subscriptions.set(tenant.id, next);
    this.audit.record({
      actorId: actor.id,
      action: "subscription.billing_state_changed",
      resourceType: RESOURCE_TYPES.TENANT_SUBSCRIPTION,
      resourceId: next.id,
      tenantId,
      correlationId: corr,
      previousValue: previous,
      newValue: this.#publicSubscription(next)
    });
    return this.#publicSubscription(next);
  }

  quoteAllocation({ actor, operatorId, appId, requestedCount, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "workload.allocation.manage", { operatorId, correlationId: corr, resourceType: RESOURCE_TYPES.WORKLOAD_QUOTA_DECISION });
    const decision = this.#evaluateAllocation({ actor, operatorId, appId, requestedCount, correlationId: corr });
    this.quotaDecisions.set(decision.id, decision);
    this.audit.record({
      actorId: actor.id,
      action: "subscription.quota_decision",
      resourceType: RESOURCE_TYPES.WORKLOAD_QUOTA_DECISION,
      resourceId: decision.id,
      tenantId: decision.tenantId,
      operatorId,
      correlationId: corr,
      policyDecision: decision.decision,
      result: decision.decision === "allow" ? "success" : "denied",
      newValue: this.#publicQuotaDecision(decision)
    });
    return this.#publicQuotaDecision(decision);
  }

  createAllocation({ actor, operatorId, appId, requestedCount, status = "planned", correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "workload.allocation.manage", { operatorId, correlationId: corr, resourceType: RESOURCE_TYPES.WORKLOAD_ALLOCATION });
    if (!ALLOCATION_STATUSES.has(status)) {
      throw validationError("Unknown workload allocation status", { status });
    }
    const decision = this.#evaluateAllocation({ actor, operatorId, appId, requestedCount, correlationId: corr });
    if (decision.decision !== "allow") {
      this.quotaDecisions.set(decision.id, decision);
      this.audit.record({
        actorId: actor.id,
        action: "workload_allocation.denied",
        resourceType: RESOURCE_TYPES.WORKLOAD_QUOTA_DECISION,
        resourceId: decision.id,
        tenantId: decision.tenantId,
        operatorId,
        correlationId: corr,
        policyDecision: "deny",
        result: "denied",
        newValue: this.#publicQuotaDecision(decision)
      });
      throw validationError("Workload allocation denied by quota policy", this.#publicQuotaDecision(decision));
    }
    const app = this.#requireApprovedApp(appId);
    const allocation = {
      id: newId("workload_alloc"),
      tenantId: decision.tenantId,
      operatorId,
      appId: app.id,
      appName: app.name,
      appType: app.type,
      count: decision.requestedCount,
      cdrRequired: app.cdrRequired === true,
      status,
      targetLayer: "WORKLOAD",
      sideEffectAllowed: false,
      executionPlanned: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.allocations.set(allocation.id, allocation);
    this.audit.record({
      actorId: actor.id,
      action: "workload_allocation.created",
      resourceType: RESOURCE_TYPES.WORKLOAD_ALLOCATION,
      resourceId: allocation.id,
      tenantId: allocation.tenantId,
      operatorId,
      correlationId: corr,
      newValue: this.#publicAllocation(allocation)
    });
    return this.#publicAllocation(allocation);
  }

  listAllocations({ actor, operatorId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "workload.allocation.read", { operatorId, correlationId: corr, resourceType: RESOURCE_TYPES.WORKLOAD_ALLOCATION });
    return [...this.allocations.values()]
      .filter((allocation) => allocation.operatorId === operatorId)
      .map((allocation) => this.#publicAllocation(allocation));
  }

  listAllocationsForOperatorScoped(operatorId) {
    return [...this.allocations.values()]
      .filter((allocation) => allocation.operatorId === operatorId)
      .map((allocation) => this.#publicAllocation(allocation));
  }

  planPlacement({ actor, operatorId, allocationId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "workload.placement.plan", { operatorId, correlationId: corr, resourceType: RESOURCE_TYPES.MICROVM_PLACEMENT_PLAN });
    const operator = this.#requireOperator(operatorId);
    if (operator.baseline?.vpsPerOperator !== 3 || operator.baseline?.cdrMandatory !== true) {
      throw validationError("Operator baseline is not eligible for workload placement", { operatorId });
    }
    const allocation = this.allocations.get(allocationId);
    if (!allocation || allocation.operatorId !== operatorId) {
      throw notFound("workload_allocation", allocationId);
    }
    const app = this.#requireApprovedApp(allocation.appId);
    const defaults = app.microVmDefaults || {};
    const plan = {
      id: newId("microvm_plan"),
      tenantId: operator.tenantId,
      operatorId,
      allocationId,
      appId: app.id,
      count: allocation.count,
      targetLayer: "WORKLOAD",
      placement: {
        vpsPerOperator: 3,
        shared: false,
        router: operator.baseline?.router,
        cdrMandatory: true
      },
      microVmDefaults: {
        vcpu: defaults.vcpu || 1,
        memoryMiB: defaults.memoryMiB || 1024,
        diskMiB: defaults.diskMiB || 4096
      },
      executionPlanned: false,
      sideEffectAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.placementPlans.set(plan.id, plan);
    this.audit.record({
      actorId: actor.id,
      action: "microvm_placement_plan.created",
      resourceType: RESOURCE_TYPES.MICROVM_PLACEMENT_PLAN,
      resourceId: plan.id,
      tenantId: plan.tenantId,
      operatorId,
      correlationId: corr,
      newValue: plan
    });
    return plan;
  }

  listQuotaDecisions({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "subscription.read", { correlationId: corr, resourceType: RESOURCE_TYPES.WORKLOAD_QUOTA_DECISION });
    return [...this.quotaDecisions.values()].map((decision) => this.#publicQuotaDecision(decision));
  }

  issuePaymentToken({
    actor,
    tier,
    planId = null,
    minimumMonths = 6,
    amount,
    currency = "PLN",
    providerMode = "sandbox",
    paymentStatus = "paid_sandbox",
    paymentReference,
    customerReference = null,
    evidenceRefs = [],
    expiresAt = null,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "subscription.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.SUBSCRIPTION_PAYMENT_TOKEN
    });
    if (!TIER_VALUES.has(tier)) {
      throw validationError("Unknown subscription tier", { tier });
    }
    const plan = planId ? this.#requirePlan(planId) : this.#defaultPlanForTier(tier);
    const months = requirePositiveInteger(minimumMonths, "minimumMonths");
    if (months < 6) {
      throw validationError("SYLION subscription token minimum term is 6 months", {
        minimumMonths: months,
        requiredMinimumMonths: 6
      });
    }
    const mode = requireEnum(providerMode, PAYMENT_PROVIDER_MODES, "providerMode");
    const status = requireEnum(paymentStatus, PAYMENT_STATUSES, "paymentStatus");
    if (mode === "sandbox" && status !== "paid_sandbox") {
      throw validationError("Sandbox payment tokens must use paid_sandbox status", { providerMode: mode, paymentStatus: status });
    }
    if (["card_gateway_live", "crypto_gateway_live"].includes(mode) && status !== "paid_live") {
      throw validationError("Live payment gateway tokens require paid_live status", { providerMode: mode, paymentStatus: status });
    }
    const rawToken = `sylion_sub_${randomBytes(24).toString("base64url")}`;
    const now = isoNow();
    const record = {
      id: newId("sub_pay"),
      tokenHash: tokenHash(rawToken),
      tokenPreview: tokenPreview(rawToken),
      tier,
      planId: plan.id,
      minimumMonths: months,
      amount: requirePositiveNumber(amount, "amount"),
      currency: requireText(currency, "currency"),
      providerMode: mode,
      paymentStatus: status,
      paymentReference: requireText(paymentReference, "paymentReference"),
      customerReference: customerReference ? String(customerReference) : null,
      evidenceRefs: safeRefs(evidenceRefs, "evidenceRefs"),
      state: "issued",
      issuedAt: now,
      expiresAt,
      issuedBy: actor.id,
      redeemedAt: null,
      redeemedBy: null,
      productionExecutionAllowed: false
    };
    this.paymentTokens.set(record.id, record);
    this.audit.record({
      actorId: actor.id,
      action: "subscription.payment_token_issued",
      resourceType: RESOURCE_TYPES.SUBSCRIPTION_PAYMENT_TOKEN,
      resourceId: record.id,
      correlationId: corr,
      policyDecision: status.startsWith("paid") ? "allow" : "deny",
      result: record.state,
      newValue: this.#publicPaymentToken(record)
    });
    return {
      token: this.#publicPaymentToken(record),
      redemptionToken: rawToken,
      tokenMaterialReturnedOnce: true
    };
  }

  redeemPaymentToken({
    actor,
    redemptionToken,
    tenantId = null,
    operatorId = null,
    operatorDisplayName = null,
    packageRefs = [],
    operatorPackageGenerated = false,
    graphenePackageGenerated = false,
    routerPackageDeferred = true,
    workloadProvisioningRequested = false,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "subscription.manage", {
      tenantId,
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.SUBSCRIPTION_PAYMENT_TOKEN
    });
    const hash = tokenHash(redemptionToken);
    const token = [...this.paymentTokens.values()].find((item) => item.tokenHash === hash);
    if (!token) throw validationError("Subscription payment token was not found", { tokenMaterialLogged: false });
    if (token.state !== "issued") {
      throw validationError("Subscription payment token is not redeemable", { tokenId: token.id, state: token.state });
    }
    if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()) {
      throw validationError("Subscription payment token expired", { tokenId: token.id, expiresAt: token.expiresAt });
    }
    const redemption = {
      id: newId("sub_redemption"),
      tokenId: token.id,
      tokenPreview: token.tokenPreview,
      tenantId,
      operatorId,
      operatorDisplayName: operatorDisplayName ? String(operatorDisplayName) : null,
      tier: token.tier,
      planId: token.planId,
      minimumMonths: token.minimumMonths,
      packageRefs: safeRefs(packageRefs, "packageRefs"),
      operatorPackageGenerated: operatorPackageGenerated === true,
      graphenePackageGenerated: graphenePackageGenerated === true,
      routerPackageDeferred: routerPackageDeferred === true,
      workloadProvisioningRequested: workloadProvisioningRequested === true,
      state: "redeemed",
      terminalDataStored: false,
      paymentTokenStoredPlaintext: false,
      productionExecutionAllowed: false,
      redeemedAt: isoNow(),
      redeemedBy: actor.id
    };
    const updated = {
      ...token,
      state: "redeemed",
      redeemedAt: redemption.redeemedAt,
      redeemedBy: actor.id
    };
    this.paymentTokens.set(token.id, updated);
    this.paymentTokenRedemptions.set(redemption.id, redemption);
    this.audit.record({
      actorId: actor.id,
      action: "subscription.payment_token_redeemed",
      resourceType: RESOURCE_TYPES.SUBSCRIPTION_PAYMENT_TOKEN,
      resourceId: token.id,
      tenantId,
      operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: redemption.state,
      previousValue: this.#publicPaymentToken(token),
      newValue: redemption
    });
    return {
      token: this.#publicPaymentToken(updated),
      redemption
    };
  }

  listPaymentTokens({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "subscription.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.SUBSCRIPTION_PAYMENT_TOKEN
    });
    return {
      tokens: [...this.paymentTokens.values()].map((record) => this.#publicPaymentToken(record)),
      redemptions: [...this.paymentTokenRedemptions.values()]
    };
  }

  paymentTokenEvidenceSummary({ operatorIds = [] } = {}) {
    const operatorSet = new Set(operatorIds.filter(Boolean));
    const tokens = [...this.paymentTokens.values()];
    const redemptions = [...this.paymentTokenRedemptions.values()]
      .filter((record) => operatorSet.size === 0 || operatorSet.has(record.operatorId));
    const liveIssuedTokenObserved = tokens.some((record) => (
      ["card_gateway_live", "crypto_gateway_live"].includes(record.providerMode)
      && record.paymentStatus === "paid_live"
      && record.minimumMonths >= 6
    ));
    const sandboxIssuedTokenObserved = tokens.some((record) => (
      record.providerMode === "sandbox"
      && record.paymentStatus === "paid_sandbox"
      && record.minimumMonths >= 6
    ));
    const redeemedTokenObserved = redemptions.some((record) => record.state === "redeemed");
    const operatorPackageGeneratedObserved = redemptions.some((record) => (
      record.operatorPackageGenerated === true
      && record.graphenePackageGenerated === true
      && record.workloadProvisioningRequested === true
    ));
    const minimumTermObserved = tokens.some((record) => record.minimumMonths >= 6);
    const ready = liveIssuedTokenObserved
      && redeemedTokenObserved
      && operatorPackageGeneratedObserved
      && minimumTermObserved;
    return {
      tokens: tokens.length,
      redemptions: redemptions.length,
      liveIssuedTokenObserved,
      sandboxIssuedTokenObserved,
      redeemedTokenObserved,
      operatorPackageGeneratedObserved,
      minimumTermObserved,
      ready,
      blockers: ready ? [] : [
        ...(liveIssuedTokenObserved ? [] : ["live_payment_gateway_token_missing"]),
        ...(redeemedTokenObserved ? [] : ["token_redemption_missing"]),
        ...(operatorPackageGeneratedObserved ? [] : ["operator_package_handoff_missing"]),
        ...(minimumTermObserved ? [] : ["minimum_6_month_term_missing"])
      ],
      productionExecutionAllowed: false
    };
  }

  canUseAddon({ tenantId, addon }) {
    const tenant = this.#requireTenant(tenantId);
    const subscription = this.ensureForTenant({ tenant, correlationId: `corr_subscription_addon_${tenantId}` });
    return subscription.addons.includes(addon);
  }

  assertProvisioningAllowed({ tenantId }) {
    const tenant = this.#requireTenant(tenantId);
    const subscription = this.ensureForTenant({ tenant, correlationId: `corr_subscription_provision_${tenantId}` });
    if (subscription.billingStatus === "suspended" || subscription.billingStatus === "cancelled") {
      throw validationError("Tenant billing state blocks new provisioning", {
        tenantId,
        billingStatus: subscription.billingStatus,
        suspensionState: subscription.suspensionState
      });
    }
  }

  #evaluateAllocation({ actor, operatorId, appId, requestedCount, correlationId }) {
    const operator = this.#requireOperator(operatorId);
    const subscription = this.getTenantSubscription({ actor, tenantId: operator.tenantId, correlationId });
    const app = this.appCatalog.get(appId);
    const count = requirePositiveInteger(requestedCount, "requestedCount");
    const blockers = [];
    if (!app || app.status !== APP_STATUSES.APPROVED) {
      blockers.push("authorized_app_not_approved");
    }
    if (app && !app.allowedTiers?.includes(operator.tier)) {
      blockers.push("app_not_allowed_for_operator_tier");
    }
    if (subscription.billingStatus === "suspended" || subscription.billingStatus === "cancelled") {
      blockers.push("billing_state_blocks_new_allocation");
    }
    const currentAllocations = [...this.allocations.values()].filter((allocation) => allocation.operatorId === operatorId);
    const currentTotal = currentAllocations.reduce((sum, allocation) => sum + allocation.count, 0);
    const currentForApp = currentAllocations
      .filter((allocation) => allocation.appId === appId)
      .reduce((sum, allocation) => sum + allocation.count, 0);
    const totalAfterChange = currentTotal + count;
    const appAfterChange = currentForApp + count;
    const limits = subscription.effectiveLimits;
    if (totalAfterChange > limits.maxWorkloadEnvironments) {
      blockers.push("max_workload_environments_exceeded");
    }
    if (appAfterChange > limits.maxAppsPerOperator) {
      blockers.push("max_apps_per_operator_exceeded");
    }
    return {
      id: newId("quota"),
      tenantId: operator.tenantId,
      operatorId,
      appId,
      requestedCount: count,
      currentCount: currentForApp,
      currentTotal,
      totalAfterChange,
      appAfterChange,
      tier: operator.tier,
      tierLimit: limits.maxWorkloadEnvironments,
      perAppLimit: limits.maxAppsPerOperator,
      remainingAfterChange: Math.max(0, limits.maxWorkloadEnvironments - totalAfterChange),
      decision: blockers.length ? "deny" : "allow",
      blockers,
      sideEffectAllowed: false,
      createdAt: isoNow()
    };
  }

  #seedPlans() {
    for (const plan of DEFAULT_PLANS) {
      if (!this.plans.get(plan.id)) {
        this.plans.set(plan.id, { ...plan, custom: false, status: "active", createdAt: null, createdBy: "system" });
      }
    }
  }

  #defaultPlanForTier(tier) {
    const plan = DEFAULT_PLANS.find((item) => item.tier === tier);
    if (!plan) throw validationError("Unknown subscription tier", { tier });
    return this.#requirePlan(plan.id);
  }

  #requirePlan(planId) {
    const plan = this.plans.get(planId);
    if (!plan) throw notFound("subscription_plan", planId);
    if (plan.cdrMandatory !== true) {
      throw validationError("Subscription plan violates mandatory CDR invariant", { planId });
    }
    return plan;
  }

  #requireTenant(tenantId) {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw notFound("tenant", tenantId);
    return tenant;
  }

  #requireOperator(operatorId) {
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    return operator;
  }

  #requireApprovedApp(appId) {
    const app = this.appCatalog.get(appId);
    if (!app || app.status !== APP_STATUSES.APPROVED) {
      throw validationError("Authorized app is not approved", { appId });
    }
    return app;
  }

  #publicSubscription(subscription) {
    return {
      id: subscription.id,
      tenantId: subscription.tenantId,
      tier: subscription.tier,
      planId: subscription.planId,
      addons: subscription.addons,
      billingStatus: subscription.billingStatus,
      suspensionState: subscription.suspensionState,
      destructiveCleanupAllowed: false,
      effectiveLimits: {
        ...subscription.effectiveLimits,
        cdrMandatory: true,
        phantomExecutionAllowed: false
      },
      activatedAt: subscription.activatedAt,
      changedAt: subscription.changedAt,
      changedBy: subscription.changedBy
    };
  }

  #publicPaymentToken(record) {
    return {
      id: record.id,
      tokenPreview: record.tokenPreview,
      tier: record.tier,
      planId: record.planId,
      minimumMonths: record.minimumMonths,
      amount: record.amount,
      currency: record.currency,
      providerMode: record.providerMode,
      paymentStatus: record.paymentStatus,
      paymentReference: record.paymentReference,
      customerReference: record.customerReference,
      evidenceRefs: record.evidenceRefs,
      state: record.state,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      redeemedAt: record.redeemedAt,
      redeemedBy: record.redeemedBy,
      paymentTokenStoredPlaintext: false,
      productionExecutionAllowed: false
    };
  }

  #publicQuotaDecision(decision) {
    return {
      id: decision.id,
      tenantId: decision.tenantId,
      operatorId: decision.operatorId,
      appId: decision.appId,
      requestedCount: decision.requestedCount,
      currentCount: decision.currentCount,
      currentTotal: decision.currentTotal,
      totalAfterChange: decision.totalAfterChange,
      appAfterChange: decision.appAfterChange,
      tier: decision.tier,
      tierLimit: decision.tierLimit,
      perAppLimit: decision.perAppLimit,
      remainingAfterChange: decision.remainingAfterChange,
      decision: decision.decision,
      blockers: decision.blockers,
      sideEffectAllowed: false,
      createdAt: decision.createdAt
    };
  }

  #publicAllocation(allocation) {
    return {
      id: allocation.id,
      tenantId: allocation.tenantId,
      operatorId: allocation.operatorId,
      appId: allocation.appId,
      appName: allocation.appName,
      appType: allocation.appType,
      count: allocation.count,
      cdrRequired: true,
      status: allocation.status,
      targetLayer: "WORKLOAD",
      sideEffectAllowed: false,
      executionPlanned: false,
      createdAt: allocation.createdAt,
      createdBy: allocation.createdBy
    };
  }
}
