import { createHash } from "node:crypto";
import { DEVICE_TYPES, RESOURCE_TYPES } from "../../domain/constants.js";
import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const APPROVAL_STATUSES = new Set([
  "draft",
  "pending_security_review",
  "pending_provisioning_review",
  "approved_for_execution",
  "rejected",
  "blocked",
  "closed"
]);

const WORKLOAD_LIFECYCLE_STATUSES = new Set([
  "planned",
  "approval_required",
  "approved_for_activation",
  "activating",
  "active",
  "degraded",
  "suspended",
  "revocation_required",
  "revoked",
  "closed"
]);

const VALID_TRANSITIONS = Object.freeze({
  planned: ["approval_required", "closed"],
  approval_required: ["approved_for_activation", "closed"],
  approved_for_activation: ["activating", "suspended", "closed"],
  activating: ["active", "degraded", "suspended"],
  active: ["degraded", "suspended", "revocation_required"],
  degraded: ["active", "suspended", "revocation_required"],
  suspended: ["active", "revocation_required", "closed"],
  revocation_required: ["revoked", "closed"],
  revoked: ["closed"],
  closed: []
});

function isoNow() {
  return new Date().toISOString();
}

function requireText(value, field, min = 2) {
  if (!value || typeof value !== "string" || value.trim().length < min) {
    throw validationError(`${field} is required`, { field });
  }
  return value.trim();
}

function safeArray(value = [], field) {
  if (!Array.isArray(value)) {
    throw validationError(`${field} must be an array`, { field });
  }
  return value.map((item, index) => requireText(String(item), `${field}.${index}`, 1));
}

function requireStatus(value, allowed, field) {
  if (!allowed.has(value)) {
    throw validationError(`Unsupported ${field}`, { field, value, allowed: [...allowed] });
  }
  return value;
}

function publicApproval(record) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    operatorId: record.operatorId,
    planId: record.planId,
    allocationId: record.allocationId,
    resourceType: record.resourceType,
    reasonCode: record.reasonCode,
    status: record.status,
    reviewers: record.reviewers,
    blockers: record.blockers,
    evidenceRefs: record.evidenceRefs,
    humanGateRequired: true,
    sideEffectAllowed: false,
    executionAllowed: record.status === "approved_for_execution" && record.resourceType !== "phantom",
    destructiveActionAllowed: false,
    note: record.note || null,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy
  };
}

function publicLifecycle(record) {
  return {
    id: record.id,
    allocationId: record.allocationId,
    operatorId: record.operatorId,
    tenantId: record.tenantId,
    status: record.status,
    previousStatus: record.previousStatus,
    reasonCode: record.reasonCode,
    approvalId: record.approvalId || null,
    humanGateRequired: record.humanGateRequired,
    sideEffectAllowed: false,
    executionAllowed: false,
    destructiveActionAllowed: false,
    evidenceRefs: record.evidenceRefs,
    changedAt: record.changedAt,
    changedBy: record.changedBy
  };
}

export class ProvisioningApprovalService {
  constructor({ audit, rbac, tenants, operators, providers, devices, subscriptions, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.tenants = tenants;
    this.operators = operators;
    this.providers = providers;
    this.devices = devices;
    this.subscriptions = subscriptions;
    this.approvals = new PersistentMap({ store, collection: "provisioning_approvals" });
    this.workloadLifecycle = new PersistentMap({ store, collection: "workload_lifecycle" });
    this.readiness = new PersistentMap({ store, collection: "operator_readiness" });
  }

  listApprovals({ actor, operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "provisioning.approval.read", { operatorId, correlationId: corr, resourceType: RESOURCE_TYPES.PROVISIONING_APPROVAL });
    return [...this.approvals.values()]
      .filter((approval) => !operatorId || approval.operatorId === operatorId)
      .map(publicApproval);
  }

  createApproval({ actor, operatorId, planId = null, allocationId = null, resourceType = "provisioning_plan", reasonCode = "provisioning_execution_review", reviewers = [], evidenceRefs = [], blockers = [], correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "provisioning.approval.manage", { operatorId, correlationId: corr, resourceType: RESOURCE_TYPES.PROVISIONING_APPROVAL });
    const operator = this.#requireOperator(operatorId);
    if (String(resourceType).toLowerCase().includes("phantom")) {
      throw validationError("PHANTOM resources cannot enter provisioning execution approvals", {
        resourceType,
        boundary: "PHANTOM_REVIEW_ONLY"
      });
    }
    const approval = {
      id: newId("approval"),
      tenantId: operator.tenantId,
      operatorId: operator.id,
      planId: planId ? requireText(planId, "planId") : null,
      allocationId: allocationId ? requireText(allocationId, "allocationId") : null,
      resourceType: requireText(resourceType, "resourceType"),
      reasonCode: requireText(reasonCode, "reasonCode"),
      status: "pending_security_review",
      reviewers: safeArray(reviewers, "reviewers"),
      blockers: safeArray(blockers, "blockers"),
      evidenceRefs: safeArray(evidenceRefs, "evidenceRefs"),
      humanGateRequired: true,
      sideEffectAllowed: false,
      destructiveActionAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id,
      updatedAt: null,
      updatedBy: null
    };
    this.approvals.set(approval.id, approval);
    this.audit.record({
      actorId: actor.id,
      action: "provisioning.approval_created",
      resourceType: RESOURCE_TYPES.PROVISIONING_APPROVAL,
      resourceId: approval.id,
      tenantId: approval.tenantId,
      operatorId: approval.operatorId,
      correlationId: corr,
      newValue: publicApproval(approval)
    });
    return publicApproval(approval);
  }

  updateApprovalStatus({ actor, approvalId, status, note = null, blockers = null, evidenceRefs = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const previous = this.approvals.get(approvalId);
    if (!previous) throw notFound("provisioning_approval", approvalId);
    this.rbac.assert(actor, "provisioning.approval.manage", {
      operatorId: previous.operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.PROVISIONING_APPROVAL,
      resourceId: approvalId
    });
    const nextStatus = requireStatus(status, APPROVAL_STATUSES, "status");
    if (nextStatus === "approved_for_execution" && previous.resourceType === "phantom") {
      throw validationError("PHANTOM records cannot be approved for execution", { approvalId });
    }
    const next = {
      ...previous,
      status: nextStatus,
      note: note ? requireText(note, "note", 1) : previous.note || null,
      blockers: blockers === null ? previous.blockers : safeArray(blockers || [], "blockers"),
      evidenceRefs: evidenceRefs === null ? previous.evidenceRefs : safeArray(evidenceRefs || [], "evidenceRefs"),
      humanGateRequired: true,
      sideEffectAllowed: false,
      destructiveActionAllowed: false,
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.approvals.set(next.id, next);
    this.audit.record({
      actorId: actor.id,
      action: "provisioning.approval_status_changed",
      resourceType: RESOURCE_TYPES.PROVISIONING_APPROVAL,
      resourceId: next.id,
      tenantId: next.tenantId,
      operatorId: next.operatorId,
      correlationId: corr,
      policyDecision: next.status === "approved_for_execution" ? "allow" : "deny",
      result: "success",
      previousValue: publicApproval(previous),
      newValue: publicApproval(next)
    });
    return publicApproval(next);
  }

  evaluateOperatorReadiness({ actor, operatorId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.readiness.read", { operatorId, correlationId: corr, resourceType: RESOURCE_TYPES.OPERATOR_READINESS });
    const operator = this.#requireOperator(operatorId);
    const devices = this.devices.list({ actor, operatorId, correlationId: corr });
    const providers = this.providers.list({ actor, correlationId: corr });
    const allocations = this.subscriptions.listAllocations({ actor, operatorId, correlationId: corr });
    const subscription = this.subscriptions.getTenantSubscription({ actor, tenantId: operator.tenantId, correlationId: corr });
    const blockers = [];
    const warnings = [];

    if (operator.baseline?.vpsPerOperator !== 3) blockers.push("operator_requires_3_vps_baseline");
    if (operator.baseline?.cdrMandatory !== true) blockers.push("cdr_mandatory_missing");
    if (operator.baseline?.router !== "GL.iNet GL-XE3000 Puli AX") blockers.push("puli_ax_router_baseline_missing");
    for (const type of [DEVICE_TYPES.PIXEL, DEVICE_TYPES.ROUTER, DEVICE_TYPES.FIDO2]) {
      if (!devices.some((device) => device.type === type && device.assignedOperatorId === operatorId)) {
        blockers.push(`${type}_device_required`);
      }
    }
    if (!providers.length) blockers.push("provider_reference_required");
    if (!allocations.length) warnings.push("no_workload_allocation_created_yet");
    if (subscription.billingStatus === "suspended" || subscription.billingStatus === "cancelled") {
      blockers.push("subscription_billing_blocks_provisioning");
    }

    const readiness = {
      id: newId("readiness"),
      tenantId: operator.tenantId,
      operatorId,
      baseline: operator.baseline,
      subscription: {
        tier: subscription.tier,
        billingStatus: subscription.billingStatus,
        cdrMandatory: subscription.effectiveLimits?.cdrMandatory === true,
        phantomExecutionAllowed: false
      },
      deviceCoverage: {
        pixel: devices.some((device) => device.type === DEVICE_TYPES.PIXEL),
        puliAx: devices.some((device) => device.type === DEVICE_TYPES.ROUTER),
        fido2: devices.some((device) => device.type === DEVICE_TYPES.FIDO2)
      },
      providerReferences: providers.map((provider) => ({
        id: provider.id,
        providerKey: provider.providerKey,
        secretReference: provider.apiSecretReference?.secretReference || null
      })),
      allocationCount: allocations.length,
      blockers,
      warnings,
      readyForApproval: blockers.length === 0,
      humanGateRequired: true,
      sideEffectAllowed: false,
      evaluatedAt: isoNow(),
      evaluatedBy: actor.id
    };
    readiness.evidenceHash = createHash("sha256")
      .update(JSON.stringify({
        tenantId: readiness.tenantId,
        operatorId: readiness.operatorId,
        baseline: readiness.baseline,
        subscription: readiness.subscription,
        deviceCoverage: readiness.deviceCoverage,
        providerReferences: readiness.providerReferences,
        allocationCount: readiness.allocationCount,
        blockers: readiness.blockers,
        warnings: readiness.warnings,
        readyForApproval: readiness.readyForApproval
      }))
      .digest("hex");
    this.readiness.set(readiness.id, readiness);
    this.audit.record({
      actorId: actor.id,
      action: "operator.readiness_evaluated",
      resourceType: RESOURCE_TYPES.OPERATOR_READINESS,
      resourceId: readiness.id,
      tenantId: operator.tenantId,
      operatorId,
      correlationId: corr,
      policyDecision: readiness.readyForApproval ? "allow" : "deny",
      result: readiness.readyForApproval ? "success" : "blocked",
      newValue: readiness
    });
    return readiness;
  }

  listReadiness({ actor, operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.readiness.read", { operatorId, correlationId: corr, resourceType: RESOURCE_TYPES.OPERATOR_READINESS });
    return [...this.readiness.values()].filter((item) => !operatorId || item.operatorId === operatorId);
  }

  getReadiness({ actor, readinessId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const readiness = this.readiness.get(readinessId);
    if (!readiness) throw notFound("operator_readiness", readinessId);
    this.rbac.assert(actor, "operator.readiness.read", {
      operatorId: readiness.operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.OPERATOR_READINESS,
      resourceId: readinessId
    });
    return readiness;
  }

  latestReadinessForOperator({ actor, operatorId, correlationId }) {
    const rows = this.listReadiness({ actor, operatorId, correlationId });
    return rows.sort((a, b) => String(b.evaluatedAt).localeCompare(String(a.evaluatedAt)))[0] || null;
  }

  systemStatus({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.readiness.read", { correlationId: corr, resourceType: RESOURCE_TYPES.OPERATOR_READINESS });
    const approvals = [...this.approvals.values()];
    const readiness = [...this.readiness.values()];
    const lifecycle = [...this.workloadLifecycle.values()];
    return {
      ksiega34: [
        { key: "approval_mandatory", label: "Mandatory orchestrator approval", status: "implemented", nextAction: "Keep all clients on approvalId path" },
        { key: "readiness_evidence", label: "Persisted operator readiness evidence", status: "implemented", nextAction: "Review blockers before approval" },
        { key: "puli_ax_gate", label: "Puli AX access router gate", status: "implemented", nextAction: "Add production hardware evidence later" },
        { key: "cdr_mandatory", label: "CDR mandatory", status: "implemented", nextAction: "Keep CDR in all app/workload policies" },
        { key: "provider_dry_run", label: "Provider adapter dry-run boundary", status: "implemented", nextAction: "Human gate before real cloud mutation" },
        { key: "live_cloud_unlock", label: "Live cloud unlock gate", status: "partial", nextAction: "Env allowlist, approval binding and one-VPS-set smoke before production" },
        { key: "cpu_confidential_qualification", label: "CPU confidential-computing host gate", status: "partial", nextAction: "Qualify Intel TDX / AMD SEV-SNP before releasing workload secrets" },
        { key: "real_firecracker", label: "Real Firecracker execution", status: "blocked", nextAction: "HUMAN GATE before production execution" }
      ],
      phantom: [
        { key: "separate_track", label: "PHANTOM separate [A] track", status: "implemented", executionAllowed: false },
        { key: "review_workflow", label: "Review workflow and owner gates", status: "implemented", executionAllowed: false },
        { key: "evidence_coverage", label: "Evidence coverage map", status: "implemented", executionAllowed: false },
        { key: "production_activation", label: "Production PHANTOM activation", status: "blocked", executionAllowed: false }
      ],
      counters: {
        approvals: approvals.length,
        approvedForExecution: approvals.filter((item) => item.status === "approved_for_execution").length,
        readinessSnapshots: readiness.length,
        readyOperators: readiness.filter((item) => item.readyForApproval).length,
        lifecycleTransitions: lifecycle.length
      },
      humanGateRequiredBefore: ["real_cloud_mutation", "real_firecracker_execution", "phantom_activation", "customer_security_claims"],
      generatedAt: isoNow()
    };
  }

  transitionWorkloadLifecycle({ actor, allocationId, status, approvalId = null, reasonCode = "operator_requested_lifecycle_change", evidenceRefs = [], correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const allocation = this.#requireAllocation(actor, allocationId, corr);
    this.rbac.assert(actor, "workload.lifecycle.manage", {
      operatorId: allocation.operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.WORKLOAD_LIFECYCLE,
      resourceId: allocationId
    });
    const nextStatus = requireStatus(status, WORKLOAD_LIFECYCLE_STATUSES, "status");
    let approval = null;
    if (["approved_for_activation", "revoked"].includes(nextStatus)) {
      approval = this.#requireExecutionApproval({
        actor,
        approvalId,
        planId: null,
        allocationId,
        operatorId: allocation.operatorId,
        correlationId: corr
      });
    }
    const previous = this.workloadLifecycle.get(allocationId) || {
      id: `lifecycle_${allocationId}`,
      allocationId,
      operatorId: allocation.operatorId,
      tenantId: allocation.tenantId,
      status: allocation.status || "planned"
    };
    if (!VALID_TRANSITIONS[previous.status]?.includes(nextStatus)) {
      throw validationError("Invalid workload lifecycle transition", {
        allocationId,
        from: previous.status,
        to: nextStatus,
        allowed: VALID_TRANSITIONS[previous.status] || []
      });
    }
    if (["revoked", "closed"].includes(nextStatus) && !reasonCode) {
      throw validationError("Destructive lifecycle states require explicit reason code", { allocationId, status: nextStatus });
    }
    const next = {
      ...previous,
      previousStatus: previous.status,
      status: nextStatus,
      reasonCode: requireText(reasonCode, "reasonCode"),
      approvalId: approval?.id || previous.approvalId || null,
      evidenceRefs: safeArray(evidenceRefs, "evidenceRefs"),
      humanGateRequired: ["approval_required", "approved_for_activation", "revocation_required", "revoked", "closed"].includes(nextStatus),
      sideEffectAllowed: false,
      changedAt: isoNow(),
      changedBy: actor.id
    };
    this.workloadLifecycle.set(allocationId, next);
    this.audit.record({
      actorId: actor.id,
      action: "workload.lifecycle_transitioned",
      resourceType: RESOURCE_TYPES.WORKLOAD_LIFECYCLE,
      resourceId: next.id,
      tenantId: next.tenantId,
      operatorId: next.operatorId,
      correlationId: corr,
      previousValue: publicLifecycle(previous),
      newValue: publicLifecycle(next)
    });
    return publicLifecycle(next);
  }

  listWorkloadLifecycle({ actor, operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "workload.allocation.read", { operatorId, correlationId: corr, resourceType: RESOURCE_TYPES.WORKLOAD_LIFECYCLE });
    return [...this.workloadLifecycle.values()]
      .filter((item) => !operatorId || item.operatorId === operatorId)
      .map(publicLifecycle);
  }

  assertExecutionApproved({ actor, planId = null, approvalId = null, requireApproval = false, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    if (!approvalId) {
      throw validationError("Provisioning approval is required before orchestrator execution", {
        planId,
        approvalRequired: true
      });
    }
    const approval = this.#requireExecutionApproval({ actor, approvalId, planId, allocationId: null, operatorId: null, correlationId: corr });
    this.audit.record({
      actorId: actor.id,
      action: "provisioning.execution_approval_checked",
      resourceType: RESOURCE_TYPES.PROVISIONING_APPROVAL,
      resourceId: approvalId,
      tenantId: approval.tenantId,
      operatorId: approval.operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: "success",
      newValue: { approvalId, planId, approvalRequired: true, sideEffectAllowed: false }
    });
    return { required: true, approved: true, approval: publicApproval(approval) };
  }

  #requireExecutionApproval({ actor, approvalId, planId = null, allocationId = null, operatorId = null, correlationId }) {
    if (!approvalId) {
      throw validationError("Provisioning approval is required", { planId, allocationId, approvalRequired: true });
    }
    const approval = this.approvals.get(approvalId);
    if (!approval) throw notFound("provisioning_approval", approvalId);
    this.rbac.assert(actor, "provisioning.approval.read", {
      operatorId: approval.operatorId,
      correlationId,
      resourceType: RESOURCE_TYPES.PROVISIONING_APPROVAL,
      resourceId: approvalId
    });
    if (operatorId && approval.operatorId !== operatorId) {
      throw validationError("Provisioning approval does not match operator", { approvalId, operatorId, approvalOperatorId: approval.operatorId });
    }
    if (planId && approval.planId && approval.planId !== planId) {
      throw validationError("Provisioning approval does not match requested plan", { planId, approvalPlanId: approval.planId });
    }
    if (allocationId && approval.allocationId && approval.allocationId !== allocationId) {
      throw validationError("Provisioning approval does not match workload allocation", { allocationId, approvalAllocationId: approval.allocationId });
    }
    if (approval.status !== "approved_for_execution") {
      throw validationError("Provisioning approval is not approved for execution", { approvalId, status: approval.status });
    }
    if (approval.resourceType === "phantom") {
      throw validationError("PHANTOM approval records cannot unlock execution", { approvalId });
    }
    return approval;
  }

  #requireOperator(operatorId) {
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    return operator;
  }

  #requireAllocation(actor, allocationId, correlationId) {
    for (const operator of this.operators.list({ actor, correlationId })) {
      const allocation = this.subscriptions
        .listAllocations({ actor, operatorId: operator.id, correlationId })
        .find((item) => item.id === allocationId);
      if (allocation) return allocation;
    }
    throw notFound("workload_allocation", allocationId);
  }
}
