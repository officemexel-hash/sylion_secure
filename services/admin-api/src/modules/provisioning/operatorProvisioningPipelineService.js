import { RESOURCE_TYPES } from "../../domain/constants.js";
import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const COMMUNICATOR_TEMPLATES = Object.freeze([
  ["whatsapp", "WhatsApp", 1, 2048, 8192],
  ["signal", "Signal", 1, 2048, 8192],
  ["telegram", "Telegram", 1, 1536, 8192],
  ["threema", "Threema", 1, 1024, 4096],
  ["zangi", "Zangi", 1, 1024, 4096],
  ["matrix_client", "Matrix Client", 1, 1536, 8192],
  ["matrix_server", "Matrix Server", 2, 4096, 32768],
  ["duckduckgo_browser", "DuckDuckGo Browser", 1, 1536, 8192],
  ["libreoffice", "LibreOffice", 2, 4096, 16384],
  ["exodus", "Exodus", 2, 4096, 16384]
].map(([key, name, vcpu, memoryMiB, diskMiB]) => ({
  key,
  name,
  type: key === "matrix_server" ? "server" : key === "libreoffice" ? "office" : key === "duckduckgo_browser" ? "browser" : key === "exodus" ? "wallet" : "messaging",
  isolation: "firecracker_microvm",
  cdrRequired: true,
  defaults: { vcpu, memoryMiB, diskMiB },
  networkPolicy: { outbound: ["tcp/443"], inbound: [] },
  storagePolicy: { persistent: false, encryptedEphemeral: true }
})));

const DEFAULT_TEMPLATE_KEYS = Object.freeze(["whatsapp", "signal", "telegram"]);

function isoNow() {
  return new Date().toISOString();
}

function safeArray(value = [], field) {
  if (!Array.isArray(value)) throw validationError(`${field} must be an array`, { field });
  return value.map((item, index) => {
    if (!item || String(item).trim().length < 1) throw validationError(`${field}.${index} is required`, { field });
    return String(item).trim();
  });
}

function templateByKey(key) {
  const template = COMMUNICATOR_TEMPLATES.find((item) => item.key === key);
  if (!template) throw validationError("Unknown communicator template", { key });
  return template;
}

function publicPipeline(pipeline) {
  return {
    ...pipeline,
    secretMaterial: undefined
  };
}

export class OperatorProvisioningPipelineService {
  constructor({ audit, rbac, operators, subscriptions, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.operators = operators;
    this.subscriptions = subscriptions;
    this.pipelines = new PersistentMap({ store, collection: "operator_provisioning_pipelines" });
    this.secretsChecks = new PersistentMap({ store, collection: "secrets_release_checks" });
  }

  listTemplates({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.provisioning_pipeline.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.OPERATOR_PROVISIONING_PIPELINE
    });
    return COMMUNICATOR_TEMPLATES.map((template) => ({ ...template }));
  }

  createDraft({ actor, operatorId, requestedTemplates = DEFAULT_TEMPLATE_KEYS, autoCreated = false, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.provisioning_pipeline.manage", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.OPERATOR_PROVISIONING_PIPELINE
    });
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    const templateKeys = safeArray(requestedTemplates, "requestedTemplates");
    const subscription = this.subscriptions.getTenantSubscription({ actor, tenantId: operator.tenantId, correlationId: corr });
    const maxEnvironments = subscription.effectiveLimits?.maxWorkloadEnvironments || 0;
    const blockers = [];
    if (operator.baseline?.vpsPerOperator !== 3) blockers.push("operator_requires_3_vps_baseline");
    if (operator.baseline?.cdrMandatory !== true) blockers.push("cdr_mandatory_missing");
    if (templateKeys.length > maxEnvironments) blockers.push("subscription_workload_limit_exceeded");

    const workloads = templateKeys.map((key, index) => {
      const template = templateByKey(key);
      return {
        id: newId("planned_workload"),
        templateKey: template.key,
        appName: template.name,
        environmentNumber: index + 1,
        isolation: template.isolation,
        cdrRequired: true,
        microVmDefaults: template.defaults,
        targetLayer: "WORKLOAD",
        executionPlanned: false,
        secretsReleaseAllowed: false
      };
    });
    const pipeline = {
      id: newId("op_pipe"),
      tenantId: operator.tenantId,
      operatorId,
      status: blockers.length ? "blocked_draft" : "draft_ready",
      autoCreated,
      baseline: {
        vps: [
          { role: "G1", shared: false, zone: "G1" },
          { role: "G2", shared: false, zone: "G2" },
          { role: "WORKLOAD", shared: false, zone: "WORKLOAD" }
        ],
        router: operator.baseline?.router,
        cdrMandatory: true
      },
      requestedTemplates: templateKeys,
      workloads,
      localLab: null,
      firecrackerPlan: null,
      secretsRelease: {
        allowed: false,
        blockers: ["approval_required", "fido2_step_up_required", "host_gates_required", "local_lab_only_no_production_secret_release"]
      },
      blockers,
      humanGateRequired: true,
      sideEffectAllowed: false,
      productionExecutionAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.pipelines.set(pipeline.id, pipeline);
    this.audit.record({
      actorId: actor.id,
      action: "operator_provisioning.pipeline_draft_created",
      resourceType: RESOURCE_TYPES.OPERATOR_PROVISIONING_PIPELINE,
      resourceId: pipeline.id,
      tenantId: pipeline.tenantId,
      operatorId,
      correlationId: corr,
      policyDecision: blockers.length ? "deny" : "allow",
      result: pipeline.status,
      newValue: publicPipeline(pipeline)
    });
    return publicPipeline(pipeline);
  }

  listPipelines({ actor, operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.provisioning_pipeline.read", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.OPERATOR_PROVISIONING_PIPELINE
    });
    return [...this.pipelines.values()]
      .filter((pipeline) => !operatorId || pipeline.operatorId === operatorId)
      .map(publicPipeline);
  }

  getPipeline({ actor, pipelineId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) throw notFound("operator_provisioning_pipeline", pipelineId);
    this.rbac.assert(actor, "operator.provisioning_pipeline.read", {
      operatorId: pipeline.operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.OPERATOR_PROVISIONING_PIPELINE,
      resourceId: pipelineId
    });
    return publicPipeline(pipeline);
  }

  createLocalLabVpsSet({ actor, pipelineId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const previous = this.pipelines.get(pipelineId);
    if (!previous) throw notFound("operator_provisioning_pipeline", pipelineId);
    this.rbac.assert(actor, "operator.provisioning_pipeline.manage", {
      operatorId: previous.operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.LOCAL_LAB_VPS_SET,
      resourceId: pipelineId
    });
    const lab = {
      id: newId("local_lab_vps"),
      mode: "local_lab_virtual_vps",
      sideEffectAllowed: false,
      productionExecutionAllowed: false,
      vps: ["G1", "G2", "WORKLOAD"].map((role) => ({
        role,
        providerResourceId: `local-lab://${previous.operatorId}/${role.toLowerCase()}/${pipelineId}`,
        shared: false,
        status: "created"
      })),
      createdAt: isoNow(),
      createdBy: actor.id
    };
    const firecrackerPlan = {
      id: newId("fc_plan"),
      hostMode: "local_lab_plan_only",
      executionAllowed: false,
      workloads: previous.workloads.map((workload) => ({
        id: newId("fc_workload"),
        plannedWorkloadId: workload.id,
        appName: workload.appName,
        templateKey: workload.templateKey,
        targetVpsRole: "WORKLOAD",
        isolation: "firecracker_microvm",
        microVmDefaults: workload.microVmDefaults,
        status: "planned"
      }))
    };
    const next = {
      ...previous,
      status: previous.blockers.length ? "blocked_draft" : "local_lab_ready",
      localLab: lab,
      firecrackerPlan,
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.pipelines.set(next.id, next);
    this.audit.record({
      actorId: actor.id,
      action: "operator_provisioning.local_lab_vps_created",
      resourceType: RESOURCE_TYPES.LOCAL_LAB_VPS_SET,
      resourceId: lab.id,
      tenantId: next.tenantId,
      operatorId: next.operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: "local_lab_ready",
      newValue: publicPipeline(next)
    });
    return publicPipeline(next);
  }

  checkSecretsRelease({ actor, pipelineId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) throw notFound("operator_provisioning_pipeline", pipelineId);
    this.rbac.assert(actor, "operator.provisioning_pipeline.read", {
      operatorId: pipeline.operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.SECRETS_RELEASE_CHECK,
      resourceId: pipelineId
    });
    const blockers = [
      ...(pipeline.localLab ? [] : ["local_lab_vps_set_required"]),
      ...(pipeline.firecrackerPlan ? [] : ["firecracker_plan_required"]),
      ...(pipeline.workloads.every((workload) => workload.cdrRequired === true) ? [] : ["cdr_required_for_all_workloads"]),
      "approval_required",
      "fresh_fido2_step_up_required",
      "cpu_confidential_or_host_gate_required",
      "production_secret_release_not_enabled_in_local_lab"
    ];
    const check = {
      id: newId("secret_check"),
      pipelineId,
      operatorId: pipeline.operatorId,
      tenantId: pipeline.tenantId,
      allowed: false,
      blockers,
      checkedAt: isoNow(),
      checkedBy: actor.id
    };
    this.secretsChecks.set(check.id, check);
    this.audit.record({
      actorId: actor.id,
      action: "operator_provisioning.secrets_release_checked",
      resourceType: RESOURCE_TYPES.SECRETS_RELEASE_CHECK,
      resourceId: check.id,
      tenantId: check.tenantId,
      operatorId: check.operatorId,
      correlationId: corr,
      policyDecision: "deny",
      result: "blocked",
      newValue: check
    });
    return check;
  }
}
