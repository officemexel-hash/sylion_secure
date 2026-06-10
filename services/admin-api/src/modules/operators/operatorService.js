import { createHash } from "node:crypto";
import { OPERATOR_STATUSES, RESOURCE_TYPES, TIERS } from "../../domain/constants.js";
import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const DISPOSABLE_OPERATOR_SCOPE = "operator_teardown_lab";
const DISPOSABLE_TEARDOWN_ACTIONS = new Set([
  "data_wipe",
  "environment_destroy",
  "account_revoke",
  "operator_teardown"
]);
const SECRET_FIELD_PATTERN =
  /(password|secret|token|api[_-]?key|panic.*code|otp|credential|private[_-]?key)/i;
const SECRET_FIELD_ALLOWLIST = new Set(["confirmation", "correlationId"]);

function isoNow() {
  return new Date().toISOString();
}

function hashConfirmation(confirmation) {
  return createHash("sha256")
    .update(String(confirmation || ""))
    .digest("hex");
}

function normalizeLabels(labels = []) {
  return [
    ...new Set(
      labels
        .filter((label) => typeof label === "string")
        .map((label) => label.trim())
        .filter(Boolean)
    )
  ];
}

function findSecretLikeFields(value, path = []) {
  if (!value || typeof value !== "object") return [];
  const findings = [];
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (SECRET_FIELD_PATTERN.test(key) && !SECRET_FIELD_ALLOWLIST.has(key)) {
      findings.push(nextPath.join("."));
    }
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      findings.push(...findSecretLikeFields(nested, nextPath));
    }
  }
  return findings;
}

function assertNoPlaintextSecretFields(body) {
  const fields = findSecretLikeFields(body);
  if (fields.length) {
    throw validationError(
      "Disposable teardown requests must not include plaintext secret material",
      {
        fields,
        allowedSecretHandling:
          "Use existing write-only secret refs; do not send passwords, API keys, panic codes or private keys."
      }
    );
  }
}

export class OperatorService {
  constructor({ audit, rbac, entitlements, tenants, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.entitlements = entitlements;
    this.tenants = tenants;
    this.operators = new PersistentMap({ store, collection: "operators" });
    this.disposableTeardownPlans = new PersistentMap({
      store,
      collection: "operator_disposable_teardown_plans"
    });
    this.disposableTeardownJobs = new PersistentMap({
      store,
      collection: "operator_disposable_teardown_jobs"
    });
  }

  create({
    actor,
    tenantId,
    displayName,
    tier,
    disposable = false,
    destructiveTestScope = null,
    labels = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.create", { tenantId, correlationId: corr });
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw notFound("tenant", tenantId);
    }
    if (!displayName || displayName.trim().length < 2) {
      throw validationError("Operator display name is required");
    }
    this.entitlements.getTier(tier);
    const normalizedLabels = normalizeLabels(labels);
    const disposableRequested = disposable === true;
    if (disposableRequested) {
      const displayNameMarker = displayName.trim().toUpperCase();
      const labelMarkers = normalizedLabels.map((label) => label.toUpperCase());
      if (destructiveTestScope !== DISPOSABLE_OPERATOR_SCOPE) {
        throw validationError("Disposable operator requires an explicit destructive test scope", {
          requiredScope: DISPOSABLE_OPERATOR_SCOPE
        });
      }
      if (!displayNameMarker.includes("DESTRUCTIVE")) {
        throw validationError("Disposable operator display name must include DESTRUCTIVE");
      }
      if (!displayNameMarker.includes("DISPOSABLE") && !labelMarkers.includes("DISPOSABLE")) {
        throw validationError("Disposable operator requires DISPOSABLE marker in name or labels");
      }
    }

    const operator = {
      id: newId("op"),
      tenantId,
      displayName: displayName.trim(),
      tier,
      status: OPERATOR_STATUSES.DRAFT,
      labels: disposableRequested
        ? normalizeLabels([...normalizedLabels, "DISPOSABLE", "DESTRUCTIVE_LAB"])
        : normalizedLabels,
      disposable: disposableRequested,
      destructiveTest: {
        disposable: disposableRequested,
        scope: disposableRequested ? DISPOSABLE_OPERATOR_SCOPE : null,
        deletionProtection: !disposableRequested,
        liveProviderMutationAllowed: false,
        planOnlyFirst: true,
        auditRetentionRequired: true,
        humanGateRequired: true,
        fourEyesRequired: true
      },
      baseline: {
        vpsPerOperator: 3,
        router: "GL.iNet GL-XE3000 Puli AX",
        cdrMandatory: true,
        workloadTenancy: [TIERS.PHANTOM, TIERS.SOVEREIGN].includes(tier)
          ? "dedicated_operator_only"
          : "shared_dedicated_pool_allowed",
        dedicatedWorkloadPerOperatorRequired: [TIERS.PHANTOM, TIERS.SOVEREIGN].includes(tier),
        phantomWorkloadDedicatedRequired: true
      },
      createdAt: isoNow()
    };
    this.operators.set(operator.id, operator);
    this.audit.record({
      actorId: actor.id,
      action: "operator.created",
      resourceType: RESOURCE_TYPES.OPERATOR,
      resourceId: operator.id,
      tenantId,
      operatorId: operator.id,
      correlationId: corr,
      newValue: operator
    });
    return operator;
  }

  update({
    actor,
    operatorId,
    displayName = undefined,
    tier = undefined,
    status = undefined,
    labels = undefined,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.manage", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.OPERATOR,
      resourceId: operatorId
    });
    const previous = this.#requireOperator(operatorId);
    const patch = {};
    if (displayName !== undefined) {
      if (!displayName || String(displayName).trim().length < 2) {
        throw validationError("Operator display name must be at least 2 characters");
      }
      patch.displayName = String(displayName).trim();
    }
    if (tier !== undefined) {
      this.entitlements.getTier(tier);
      patch.tier = tier;
      patch.baseline = {
        ...previous.baseline,
        workloadTenancy: [TIERS.PHANTOM, TIERS.SOVEREIGN].includes(tier)
          ? "dedicated_operator_only"
          : "shared_dedicated_pool_allowed",
        dedicatedWorkloadPerOperatorRequired: [TIERS.PHANTOM, TIERS.SOVEREIGN].includes(tier)
      };
    }
    if (status !== undefined) {
      if (!Object.values(OPERATOR_STATUSES).includes(status)) {
        throw validationError("Unsupported operator status", {
          status,
          supported: Object.values(OPERATOR_STATUSES)
        });
      }
      patch.status = status;
    }
    if (labels !== undefined) {
      patch.labels = normalizeLabels(Array.isArray(labels) ? labels : String(labels).split(","));
    }
    const operator = {
      ...previous,
      ...patch,
      updatedAt: isoNow()
    };
    this.operators.set(operator.id, operator);
    this.audit.record({
      actorId: actor.id,
      action: "operator.updated",
      resourceType: RESOURCE_TYPES.OPERATOR,
      resourceId: operator.id,
      tenantId: operator.tenantId,
      operatorId: operator.id,
      correlationId: corr,
      previousValue: previous,
      newValue: operator
    });
    return operator;
  }

  delete({ actor, operatorId, confirmation, reason = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.manage", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.OPERATOR,
      resourceId: operatorId
    });
    const operator = this.#requireOperator(operatorId);
    const requiredConfirmation = `DELETE_OPERATOR:${operator.id}`;
    if (confirmation !== requiredConfirmation) {
      this.audit.record({
        actorId: actor.id,
        action: "operator.delete_rejected",
        resourceType: RESOURCE_TYPES.OPERATOR,
        resourceId: operator.id,
        tenantId: operator.tenantId,
        operatorId: operator.id,
        correlationId: corr,
        policyDecision: "deny",
        result: "denied",
        newValue: {
          reason: "confirmation_mismatch",
          requiredConfirmationRef: `operator-delete-confirmation://${operator.id}`,
          confirmationMaterialStored: false
        }
      });
      throw validationError("Operator delete confirmation did not match", {
        requiredConfirmation,
        confirmationMaterialStored: false
      });
    }
    this.operators.delete(operator.id);
    const deletion = {
      operatorId: operator.id,
      tenantId: operator.tenantId,
      displayName: operator.displayName,
      state: "deleted_control_plane",
      providerMutationAllowed: false,
      productionExecutionAllowed: false,
      auditRetention: "preserved",
      reason,
      deletedAt: isoNow()
    };
    this.audit.record({
      actorId: actor.id,
      action: "operator.deleted",
      resourceType: RESOURCE_TYPES.OPERATOR,
      resourceId: operator.id,
      tenantId: operator.tenantId,
      operatorId: operator.id,
      correlationId: corr,
      previousValue: operator,
      newValue: deletion
    });
    return deletion;
  }

  createDisposableTeardownPlan({
    actor,
    operatorId,
    requestedAction = "operator_teardown",
    reason = null,
    body = {},
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.disposable_teardown.manage", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.DISPOSABLE_OPERATOR_TEARDOWN
    });
    assertNoPlaintextSecretFields(body);
    const operator = this.#requireOperator(operatorId);
    if (!DISPOSABLE_TEARDOWN_ACTIONS.has(requestedAction)) {
      throw validationError("Unsupported disposable teardown action", {
        requestedAction,
        supported: [...DISPOSABLE_TEARDOWN_ACTIONS]
      });
    }
    this.#assertDisposable(operator, corr);
    const confirmationPhrase = `DESTROY_DISPOSABLE_OPERATOR:${operator.id}`;
    const plan = {
      id: newId("op_teardown_plan"),
      operatorId: operator.id,
      tenantId: operator.tenantId,
      displayName: operator.displayName,
      requestedAction,
      reason,
      state: "planned_human_gate_required",
      dryRunFirst: true,
      generatedAt: isoNow(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      confirmationPhraseHash: hashConfirmation(confirmationPhrase),
      confirmationPhraseRef: null,
      guardrails: {
        disposableOperatorRequired: true,
        disposableOperatorVerified: true,
        deletionProtection: operator.destructiveTest?.deletionProtection === true,
        auditRetentionRequired: true,
        auditRemovalAllowed: false,
        providerMutationAllowed: false,
        productionExecutionAllowed: false,
        sideEffectAllowedBeforeExecute: false,
        fourEyesRequired: true,
        humanGateRequired: true,
        scopeLockedToOperatorId: operator.id
      },
      resourceDiff: this.#teardownResourceDiff(operator, requestedAction),
      secretMaterialAccepted: false,
      notes: [
        "Control-plane plan only until explicit confirmation is submitted.",
        "Provider-side deletion stays disabled in this API path; live teardown needs a separate approved runner.",
        "Audit evidence is retained and never deleted by teardown."
      ]
    };
    plan.confirmationPhraseRef = `disposable-teardown-confirmation://${plan.id}`;
    this.disposableTeardownPlans.set(plan.id, plan);
    this.audit.record({
      actorId: actor.id,
      action: "operator.disposable_teardown_plan_created",
      resourceType: RESOURCE_TYPES.DISPOSABLE_OPERATOR_TEARDOWN,
      resourceId: plan.id,
      tenantId: operator.tenantId,
      operatorId: operator.id,
      correlationId: corr,
      newValue: this.#redactedTeardownPlanForAudit(plan)
    });
    return this.#publicTeardownPlan(plan, confirmationPhrase);
  }

  executeDisposableTeardown({
    actor,
    operatorId,
    planId,
    confirmation,
    reason = null,
    body = {},
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.disposable_teardown.manage", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.DISPOSABLE_OPERATOR_TEARDOWN
    });
    assertNoPlaintextSecretFields(body);
    const operator = this.#requireOperator(operatorId);
    this.#assertDisposable(operator, corr);
    const plan = planId
      ? this.disposableTeardownPlans.get(planId)
      : this.#latestTeardownPlanForOperator(operatorId);
    if (!plan || plan.operatorId !== operator.id) {
      throw notFound("disposable teardown plan", planId || operatorId);
    }
    if (hashConfirmation(confirmation) !== plan.confirmationPhraseHash) {
      this.audit.record({
        actorId: actor.id,
        action: "operator.disposable_teardown_rejected",
        resourceType: RESOURCE_TYPES.DISPOSABLE_OPERATOR_TEARDOWN,
        resourceId: plan.id,
        tenantId: operator.tenantId,
        operatorId: operator.id,
        correlationId: corr,
        policyDecision: "deny",
        result: "denied",
        newValue: {
          reason: "confirmation_mismatch",
          confirmationMaterialStored: false,
          requiredPhraseRef: `disposable-teardown-confirmation://${plan.id}`
        }
      });
      throw validationError("Disposable teardown confirmation did not match", {
        confirmationMaterialStored: false,
        requiredPhraseRef: `disposable-teardown-confirmation://${plan.id}`
      });
    }

    const previous = operator;
    const completedAt = isoNow();
    const nextOperator = {
      ...operator,
      status: OPERATOR_STATUSES.REVOKED,
      destructiveTest: {
        ...operator.destructiveTest,
        teardownState: "completed_control_plane",
        teardownPlanId: plan.id,
        teardownCompletedAt: completedAt
      },
      teardown: {
        state: "completed_control_plane",
        planId: plan.id,
        completedAt,
        requestedAction: plan.requestedAction,
        reason,
        providerMutationAllowed: false,
        productionExecutionAllowed: false,
        auditRetentionRequired: true
      }
    };
    this.operators.set(operator.id, nextOperator);
    const job = {
      id: newId("op_teardown_job"),
      planId: plan.id,
      operatorId: operator.id,
      tenantId: operator.tenantId,
      state: "completed_control_plane_teardown",
      completedAt,
      requestedAction: plan.requestedAction,
      providerMutationAllowed: false,
      productionExecutionAllowed: false,
      auditRetention: "preserved",
      secretMaterialAccepted: false,
      resourceResults: plan.resourceDiff.map((item) => ({
        ...item,
        result: item.operation === "preserve" ? "preserved" : "marked_destroyed_control_plane"
      }))
    };
    this.disposableTeardownJobs.set(job.id, job);
    this.audit.record({
      actorId: actor.id,
      action: "operator.disposable_teardown_completed",
      resourceType: RESOURCE_TYPES.DISPOSABLE_OPERATOR_TEARDOWN,
      resourceId: job.id,
      tenantId: operator.tenantId,
      operatorId: operator.id,
      correlationId: corr,
      previousValue: previous,
      newValue: { operator: nextOperator, job }
    });
    return job;
  }

  get(id) {
    return this.operators.get(id);
  }

  list({ actor, tenantId = null, correlationId } = {}) {
    if (actor) {
      this.rbac.assert(actor, "operator.read", { tenantId, correlationId });
    }
    return [...this.operators.values()].filter(
      (operator) => !tenantId || operator.tenantId === tenantId
    );
  }

  listDisposableTeardownPlans({ actor, operatorId = null, correlationId } = {}) {
    if (actor) {
      this.rbac.assert(actor, "operator.read", {
        operatorId,
        correlationId,
        resourceType: RESOURCE_TYPES.DISPOSABLE_OPERATOR_TEARDOWN
      });
    }
    return [...this.disposableTeardownPlans.values()]
      .filter((plan) => !operatorId || plan.operatorId === operatorId)
      .map((plan) => this.#publicTeardownPlan(plan));
  }

  #requireOperator(operatorId) {
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    return operator;
  }

  #assertDisposable(operator, correlationId) {
    if (
      operator.disposable === true &&
      operator.destructiveTest?.scope === DISPOSABLE_OPERATOR_SCOPE
    ) {
      return;
    }
    this.audit.record({
      actorId: "system",
      action: "operator.disposable_teardown_rejected",
      resourceType: RESOURCE_TYPES.DISPOSABLE_OPERATOR_TEARDOWN,
      resourceId: operator.id,
      tenantId: operator.tenantId,
      operatorId: operator.id,
      correlationId,
      policyDecision: "deny",
      result: "denied",
      newValue: {
        reason: "operator_not_disposable",
        disposable: operator.disposable === true,
        scope: operator.destructiveTest?.scope || null,
        sideEffectPrevented: true
      }
    });
    throw validationError(
      "Destructive teardown is allowed only for explicitly disposable test operators",
      {
        operatorId: operator.id,
        disposableRequired: true,
        sideEffectPrevented: true
      }
    );
  }

  #latestTeardownPlanForOperator(operatorId) {
    return (
      [...this.disposableTeardownPlans.values()]
        .filter((plan) => plan.operatorId === operatorId)
        .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0] || null
    );
  }

  #teardownResourceDiff(operator, requestedAction) {
    const resourcePrefix = `operator://${operator.id}`;
    const common = [
      {
        ref: `${resourcePrefix}/sessions`,
        layer: "operator_portal",
        operation: "revoke",
        scope: "operator_only",
        sideEffectBeforeExecute: false
      },
      {
        ref: `${resourcePrefix}/certificates`,
        layer: "pki",
        operation: "revoke",
        scope: "operator_only",
        sideEffectBeforeExecute: false
      },
      {
        ref: `${resourcePrefix}/g1`,
        layer: "g1",
        operation: "destroy",
        scope: "operator_only",
        sideEffectBeforeExecute: false
      },
      {
        ref: `${resourcePrefix}/g2`,
        layer: "g2",
        operation: "destroy",
        scope: "operator_only",
        sideEffectBeforeExecute: false
      },
      {
        ref: `${resourcePrefix}/workload`,
        layer: "workload",
        operation: "destroy",
        scope: "operator_only",
        sideEffectBeforeExecute: false
      },
      {
        ref: `${resourcePrefix}/audit`,
        layer: "audit",
        operation: "preserve",
        scope: "operator_evidence",
        sideEffectBeforeExecute: false
      }
    ];
    if (requestedAction === "data_wipe") {
      return common.filter((item) => ["workload", "audit"].includes(item.layer));
    }
    if (requestedAction === "environment_destroy") {
      return common.filter((item) => ["g1", "g2", "workload", "audit"].includes(item.layer));
    }
    return common;
  }

  #redactedTeardownPlanForAudit(plan) {
    return {
      ...plan,
      confirmationPhraseHash: "[redacted]"
    };
  }

  #publicTeardownPlan(plan, confirmationPhrase = null) {
    return {
      ...plan,
      confirmationPhraseHash: "[redacted]",
      ...(confirmationPhrase ? { confirmationPhrase } : {})
    };
  }
}
