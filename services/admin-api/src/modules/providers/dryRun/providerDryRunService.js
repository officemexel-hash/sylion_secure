import { RESOURCE_TYPES } from "../../../domain/constants.js";
import { notFound, validationError } from "../../../lib/errors.js";
import { newId, requireCorrelationId } from "../../../lib/id.js";
import { PersistentMap } from "../../../storage/persistentMap.js";

function isoNow() {
  return new Date().toISOString();
}

function requireText(value, field) {
  if (!value || typeof value !== "string" || value.trim().length < 2) {
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

export class ProviderDryRunService {
  constructor({ audit, rbac, providers, operators, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.providers = providers;
    this.operators = operators;
    this.plans = new PersistentMap({ store, collection: "provider_dry_run_plans" });
  }

  planVps({ actor, providerId, operatorId, region, vpsPerOperator = 3, mutationMode = "dry_run", correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "provider.dry_run.plan", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PROVIDER_DRY_RUN_PLAN
    });
    if (mutationMode !== "dry_run") {
      throw validationError("Provider adapter can only run in dry_run mode before HUMAN GATE", {
        mutationMode,
        humanGateRequired: true
      });
    }
    const provider = this.providers.get(providerId);
    if (!provider) throw notFound("provider", providerId);
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    const count = requirePositiveInteger(vpsPerOperator, "vpsPerOperator");
    if (count !== 3) {
      throw validationError("Provider dry-run must preserve 3 VPS per operator baseline", { vpsPerOperator: count });
    }
    const normalizedRegion = requireText(region, "region");
    if (!provider.regions.includes(normalizedRegion)) {
      throw validationError("Region is not enabled for provider", { providerId, region: normalizedRegion });
    }
    const plan = {
      id: newId("provider_dry_run"),
      providerId: provider.id,
      providerKey: provider.providerKey,
      providerSecretReference: provider.apiSecretReference?.secretReference || null,
      operatorId: operator.id,
      tenantId: operator.tenantId,
      region: normalizedRegion,
      mutationMode: "dry_run",
      sideEffectAllowed: false,
      executionAllowed: false,
      humanGateRequiredBeforeMutation: true,
      plannedActions: [
        { role: "G1", action: "plan_vps_create", shared: false, zone: "G1" },
        { role: "G2", action: "plan_vps_create", shared: false, zone: "G2" },
        { role: "WORKLOAD", action: "plan_vps_create", shared: false, zone: "WORKLOAD" }
      ],
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.plans.set(plan.id, plan);
    this.audit.record({
      actorId: actor.id,
      action: "provider.dry_run_plan_created",
      resourceType: RESOURCE_TYPES.PROVIDER_DRY_RUN_PLAN,
      resourceId: plan.id,
      tenantId: plan.tenantId,
      operatorId,
      correlationId: corr,
      policyDecision: "deny",
      result: "dry_run_only",
      newValue: plan
    });
    return plan;
  }

  list({ actor, operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "provider.dry_run.plan", { operatorId, correlationId: corr, resourceType: RESOURCE_TYPES.PROVIDER_DRY_RUN_PLAN });
    return [...this.plans.values()].filter((plan) => !operatorId || plan.operatorId === operatorId);
  }
}
