import { RESOURCE_TYPES } from "../../domain/constants.js";
import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const FAILURE_TYPES = new Set([
  "provider_error",
  "firecracker_start_failed",
  "microvm_crash_loop",
  "secrets_denied"
]);

function isoNow() {
  return new Date().toISOString();
}

function requireText(value, field, min = 1) {
  if (!value || String(value).trim().length < min) {
    throw validationError(`${field} is required`, { field });
  }
  return String(value).trim();
}

function publicEnvironment(environment) {
  return {
    ...environment,
    secretMaterial: undefined
  };
}

function eventRecord({ environment, type, status, summary, details = {}, actor }) {
  return {
    id: newId("op_env_event"),
    environmentId: environment.id,
    pipelineId: environment.pipelineId,
    operatorId: environment.operatorId,
    tenantId: environment.tenantId,
    type,
    status,
    summary,
    details,
    createdAt: isoNow(),
    createdBy: actor.id
  };
}

export class OperatorEnvironmentService {
  constructor({ audit, rbac, operatorProvisioning, monitoring, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.operatorProvisioning = operatorProvisioning;
    this.monitoring = monitoring;
    this.environments = new PersistentMap({ store, collection: "operator_environments" });
    this.events = new PersistentMap({ store, collection: "operator_environment_events" });
  }

  list({ actor, operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.environment.read", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.OPERATOR_ENVIRONMENT
    });
    return [...this.environments.values()]
      .filter((environment) => !operatorId || environment.operatorId === operatorId)
      .map(publicEnvironment);
  }

  listForOperatorScoped(operatorId) {
    return [...this.environments.values()]
      .filter((environment) => environment.operatorId === operatorId)
      .map(publicEnvironment);
  }

  get({ actor, environmentId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const environment = this.#requireEnvironment(environmentId);
    this.rbac.assert(actor, "operator.environment.read", {
      operatorId: environment.operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.OPERATOR_ENVIRONMENT,
      resourceId: environmentId
    });
    return publicEnvironment(environment);
  }

  listEvents({ actor, environmentId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const environment = this.#requireEnvironment(environmentId);
    this.rbac.assert(actor, "operator.environment.read", {
      operatorId: environment.operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.OPERATOR_ENVIRONMENT_EVENT,
      resourceId: environmentId
    });
    return [...this.events.values()].filter((event) => event.environmentId === environmentId);
  }

  createFromPipeline({ actor, pipelineId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const pipeline = this.operatorProvisioning.getPipeline({ actor, pipelineId, correlationId: corr });
    this.rbac.assert(actor, "operator.environment.manage", {
      operatorId: pipeline.operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.OPERATOR_ENVIRONMENT
    });
    if (pipeline.status !== "local_lab_ready") {
      throw validationError("Pipeline must be local_lab_ready before creating an operator environment", {
        pipelineId,
        status: pipeline.status
      });
    }
    const environment = {
      id: newId("op_env"),
      pipelineId,
      tenantId: pipeline.tenantId,
      operatorId: pipeline.operatorId,
      mode: "local_execution_harness",
      status: "planned",
      sideEffectAllowed: false,
      productionExecutionAllowed: false,
      secretsReleaseAllowed: false,
      localProvider: {
        adapter: "local_provider_adapter",
        resources: pipeline.localLab.vps.map((vps) => ({
          role: vps.role,
          providerResourceId: vps.providerResourceId,
          status: "reserved"
        }))
      },
      mockFirecracker: {
        runner: "mock_firecracker_runner",
        executionAllowed: false,
        runtimes: pipeline.firecrackerPlan.workloads.map((workload) => ({
          id: newId("mock_fc"),
          plannedWorkloadId: workload.plannedWorkloadId,
          templateKey: workload.templateKey,
          appName: workload.appName,
          targetVpsRole: workload.targetVpsRole,
          status: "planned",
          startedAt: null,
          stoppedAt: null
        }))
      },
      failure: null,
      rollback: null,
      createdAt: isoNow(),
      createdBy: actor.id,
      updatedAt: null,
      updatedBy: null
    };
    this.environments.set(environment.id, environment);
    this.#recordEvent({
      actor,
      environment,
      type: "environment_created",
      status: environment.status,
      summary: "Local operator environment created from provisioning pipeline",
      details: { resourceCount: environment.localProvider.resources.length, runtimeCount: environment.mockFirecracker.runtimes.length },
      correlationId: corr
    });
    this.#audit({
      actor,
      action: "operator_environment.created",
      environment,
      correlationId: corr,
      result: "planned"
    });
    return publicEnvironment(environment);
  }

  startLocal({ actor, environmentId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const previous = this.#requireEnvironment(environmentId);
    this.rbac.assert(actor, "operator.environment.manage", {
      operatorId: previous.operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.OPERATOR_ENVIRONMENT,
      resourceId: environmentId
    });
    if (!["planned", "local_lab_ready", "environment_failed"].includes(previous.status)) {
      throw validationError("Environment cannot be started from current status", {
        environmentId,
        status: previous.status
      });
    }
    const environment = {
      ...previous,
      status: "environment_ready",
      localProvider: {
        ...previous.localProvider,
        resources: previous.localProvider.resources.map((resource) => ({ ...resource, status: "running" }))
      },
      mockFirecracker: {
        ...previous.mockFirecracker,
        runtimes: previous.mockFirecracker.runtimes.map((runtime) => ({
          ...runtime,
          status: "running",
          startedAt: runtime.startedAt || isoNow()
        }))
      },
      failure: null,
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.environments.set(environment.id, environment);
    this.#recordEvent({
      actor,
      environment,
      type: "environment_started",
      status: environment.status,
      summary: "Local harness started mock provider and mock Firecracker runtimes",
      details: { runtimeStatus: "running", executionAllowed: false },
      correlationId: corr
    });
    this.monitoring.recordHealthStatus({
      actor,
      tenantId: environment.tenantId,
      operatorId: environment.operatorId,
      resource: { id: environment.id, kind: "operator_environment" },
      status: "healthy",
      details: { detector: "operator-environment-harness", metric: "local_runtime_status", observedValue: "environment_ready" },
      correlationId: corr
    });
    this.#audit({
      actor,
      action: "operator_environment.local_started",
      environment,
      correlationId: corr,
      previousValue: publicEnvironment(previous),
      result: "environment_ready"
    });
    return publicEnvironment(environment);
  }

  injectFailure({ actor, environmentId, failureType, reason = "local_lab_failure_injection", correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const previous = this.#requireEnvironment(environmentId);
    this.rbac.assert(actor, "operator.environment.manage", {
      operatorId: previous.operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.OPERATOR_ENVIRONMENT,
      resourceId: environmentId
    });
    const normalizedType = requireText(failureType, "failureType");
    if (!FAILURE_TYPES.has(normalizedType)) {
      throw validationError("Unsupported failure type", { failureType, allowed: [...FAILURE_TYPES] });
    }
    const failedRuntimeId = previous.mockFirecracker.runtimes[0]?.id || null;
    const environment = {
      ...previous,
      status: "environment_failed",
      mockFirecracker: {
        ...previous.mockFirecracker,
        runtimes: previous.mockFirecracker.runtimes.map((runtime, index) => ({
          ...runtime,
          status: index === 0 && normalizedType !== "provider_error" ? "failed" : runtime.status
        }))
      },
      localProvider: {
        ...previous.localProvider,
        resources: previous.localProvider.resources.map((resource) => ({
          ...resource,
          status: normalizedType === "provider_error" ? "degraded" : resource.status
        }))
      },
      failure: {
        type: normalizedType,
        reason: requireText(reason, "reason"),
        failedRuntimeId,
        injectedAt: isoNow(),
        injectedBy: actor.id
      },
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.environments.set(environment.id, environment);
    this.#recordEvent({
      actor,
      environment,
      type: "failure_injected",
      status: environment.status,
      summary: "Local harness failure injected",
      details: { failureType: normalizedType, failedRuntimeId },
      correlationId: corr
    });
    this.monitoring.recordSignal({
      actor,
      signal: normalizedType === "provider_error" ? "provider_drift" : "microvm_crash_loop",
      tenantId: environment.tenantId,
      operatorId: environment.operatorId,
      resource: { id: failedRuntimeId || environment.id, kind: normalizedType === "provider_error" ? "provider" : "microvm" },
      details: { detector: "operator-environment-harness", evidenceRef: environment.id, observedValue: normalizedType },
      correlationId: corr
    });
    this.#audit({
      actor,
      action: "operator_environment.failure_injected",
      environment,
      correlationId: corr,
      previousValue: publicEnvironment(previous),
      result: normalizedType
    });
    return publicEnvironment(environment);
  }

  rollback({ actor, environmentId, reason = "local_lab_cleanup", correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const previous = this.#requireEnvironment(environmentId);
    this.rbac.assert(actor, "operator.environment.manage", {
      operatorId: previous.operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.LOCAL_LAB_ROLLBACK,
      resourceId: environmentId
    });
    const environment = {
      ...previous,
      status: "rolled_back",
      localProvider: {
        ...previous.localProvider,
        resources: previous.localProvider.resources.map((resource) => ({ ...resource, status: "released" }))
      },
      mockFirecracker: {
        ...previous.mockFirecracker,
        runtimes: previous.mockFirecracker.runtimes.map((runtime) => ({
          ...runtime,
          status: "stopped",
          stoppedAt: runtime.stoppedAt || isoNow()
        }))
      },
      rollback: {
        reason: requireText(reason, "reason"),
        completedAt: isoNow(),
        completedBy: actor.id,
        sideEffectAllowed: false
      },
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.environments.set(environment.id, environment);
    this.#recordEvent({
      actor,
      environment,
      type: "rollback_completed",
      status: environment.status,
      summary: "Local harness resources released",
      details: { releasedResources: environment.localProvider.resources.length, stoppedRuntimes: environment.mockFirecracker.runtimes.length },
      correlationId: corr
    });
    this.monitoring.recordHealthStatus({
      actor,
      tenantId: environment.tenantId,
      operatorId: environment.operatorId,
      resource: { id: environment.id, kind: "operator_environment" },
      status: "unknown",
      details: { detector: "operator-environment-harness", metric: "rollback_status", observedValue: "rolled_back" },
      correlationId: corr
    });
    this.#audit({
      actor,
      action: "operator_environment.rollback_completed",
      environment,
      correlationId: corr,
      previousValue: publicEnvironment(previous),
      result: "rolled_back",
      resourceType: RESOURCE_TYPES.LOCAL_LAB_ROLLBACK
    });
    return publicEnvironment(environment);
  }

  checkSecretsRelease({ actor, environmentId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const environment = this.#requireEnvironment(environmentId);
    this.rbac.assert(actor, "operator.environment.read", {
      operatorId: environment.operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.SECRETS_RELEASE_CHECK,
      resourceId: environmentId
    });
    const check = {
      id: newId("env_secret_check"),
      environmentId,
      pipelineId: environment.pipelineId,
      operatorId: environment.operatorId,
      tenantId: environment.tenantId,
      allowed: false,
      blockers: [
        "local_execution_harness_only",
        "production_secret_release_not_enabled_in_local_lab",
        "fresh_fido2_step_up_required",
        "cpu_confidential_or_host_gate_required",
        "human_release_approval_required"
      ],
      checkedAt: isoNow(),
      checkedBy: actor.id
    };
    this.#recordEvent({
      actor,
      environment,
      type: "secrets_release_checked",
      status: "blocked",
      summary: "Local harness secrets release remains blocked",
      details: { allowed: false, blockers: check.blockers },
      correlationId: corr
    });
    this.audit.record({
      actorId: actor.id,
      action: "operator_environment.secrets_release_checked",
      resourceType: RESOURCE_TYPES.SECRETS_RELEASE_CHECK,
      resourceId: check.id,
      tenantId: environment.tenantId,
      operatorId: environment.operatorId,
      correlationId: corr,
      policyDecision: "deny",
      result: "blocked",
      newValue: check
    });
    return check;
  }

  #requireEnvironment(environmentId) {
    const environment = this.environments.get(environmentId);
    if (!environment) throw notFound("operator_environment", environmentId);
    return environment;
  }

  #recordEvent({ actor, environment, type, status, summary, details, correlationId }) {
    const event = eventRecord({ environment, type, status, summary, details, actor });
    this.events.set(event.id, event);
    this.audit.record({
      actorId: actor.id,
      action: `operator_environment.event.${type}`,
      resourceType: RESOURCE_TYPES.OPERATOR_ENVIRONMENT_EVENT,
      resourceId: event.id,
      tenantId: environment.tenantId,
      operatorId: environment.operatorId,
      correlationId,
      result: status,
      newValue: event
    });
    return event;
  }

  #audit({ actor, action, environment, correlationId, previousValue = null, result, resourceType = RESOURCE_TYPES.OPERATOR_ENVIRONMENT }) {
    this.audit.record({
      actorId: actor.id,
      action,
      resourceType,
      resourceId: environment.id,
      tenantId: environment.tenantId,
      operatorId: environment.operatorId,
      correlationId,
      previousValue,
      newValue: publicEnvironment(environment),
      policyDecision: "allow",
      result
    });
  }
}
