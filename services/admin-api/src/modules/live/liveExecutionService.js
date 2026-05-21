import { existsSync } from "node:fs";
import { RESOURCE_TYPES } from "../../domain/constants.js";
import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";
import { HetznerLiveAdapter } from "./hetznerLiveAdapter.js";

function isoNow() {
  return new Date().toISOString();
}

function splitEnvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

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

function publicRequest(record) {
  return {
    ...record,
    tokenPresent: undefined,
    rawProviderResponse: undefined
  };
}

export class LiveExecutionService {
  constructor({
    audit,
    rbac,
    providers,
    operators,
    approvals,
    adapterFactory = null,
    env = process.env,
    hostProbe = null,
    store = null
  }) {
    this.audit = audit;
    this.rbac = rbac;
    this.providers = providers;
    this.operators = operators;
    this.approvals = approvals;
    this.env = env;
    this.adapterFactory = adapterFactory || ((providerKey) => {
      if (providerKey === "hetzner") return new HetznerLiveAdapter({ token: env.HETZNER_API_TOKEN });
      throw validationError("Live provider adapter is not implemented", { providerKey });
    });
    this.hostProbe = hostProbe || (() => ({
      platform: process.platform,
      kvmDevicePresent: existsSync("/dev/kvm"),
      firecrackerBinaryPresent: false,
      nestedVirtualizationVerified: false
    }));
    this.requests = new PersistentMap({ store, collection: "live_execution_requests" });
    this.hostQualifications = new PersistentMap({ store, collection: "firecracker_host_qualifications" });
    this.phantomRequests = new PersistentMap({ store, collection: "phantom_execution_requests" });
    this.idempotency = new Map();
    for (const request of this.requests.values()) {
      if (request.idempotencyKey) this.idempotency.set(request.idempotencyKey, request.id);
    }
  }

  summary({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.read", { correlationId: corr, resourceType: RESOURCE_TYPES.LIVE_EXECUTION_REQUEST });
    return {
      providerMode: this.env.SYLION_PROVIDER_MODE || "dry_run",
      liveAllowed: this.env.SYLION_LIVE_ALLOWED === "true",
      tokenConfigured: Boolean(this.env.HETZNER_API_TOKEN),
      allowedRegions: splitEnvList(this.env.SYLION_LIVE_ALLOWED_REGIONS),
      allowlistedOperators: splitEnvList(this.env.SYLION_LIVE_ALLOWLIST_OPERATORS),
      maxServers: Number(this.env.SYLION_LIVE_MAX_SERVERS || 0),
      firecrackerHostMode: this.env.SYLION_FIRECRACKER_HOST_MODE || "blocked",
      phantomLabAllowed: this.env.SYLION_PHANTOM_LAB_ALLOWED === "true",
      baselineUnlockState: this.#baselineUnlockState(),
      liveRequests: this.requests.size,
      firecrackerQualifications: this.hostQualifications.size,
      phantomExecutionRequests: this.phantomRequests.size,
      productionExecutionAllowed: false,
      generatedAt: isoNow()
    };
  }

  listRequests({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.read", { correlationId: corr, resourceType: RESOURCE_TYPES.LIVE_EXECUTION_REQUEST });
    return [...this.requests.values()].map(publicRequest);
  }

  async createHetznerVpsSet({
    actor,
    providerId,
    operatorId,
    region,
    approvalId,
    idempotencyKey,
    liveConfirmed = false,
    serverType = "cx22",
    image = "ubuntu-24.04",
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.manage", { operatorId, correlationId: corr, resourceType: RESOURCE_TYPES.LIVE_EXECUTION_REQUEST });
    const key = requireText(idempotencyKey, "idempotencyKey", 8);
    if (this.idempotency.has(key)) {
      return publicRequest(this.requests.get(this.idempotency.get(key)));
    }
    const provider = this.providers.get(providerId);
    if (!provider) throw notFound("provider", providerId);
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    if (provider.providerKey !== "hetzner") {
      throw validationError("Only Hetzner live adapter is wired in this step", { providerKey: provider.providerKey });
    }
    if (operator.baseline?.vpsPerOperator !== 3) {
      throw validationError("Live cloud baseline requires exactly 3 VPS per operator", { operatorId });
    }
    const approval = this.approvals.assertExecutionApproved({ actor, approvalId, planId: null, correlationId: corr }).approval;
    if (approval.operatorId !== operatorId) {
      throw validationError("Approval does not match requested operator", { approvalId, operatorId, approvalOperatorId: approval.operatorId });
    }
    const gate = this.#evaluateCloudGate({ operatorId, region, liveConfirmed });
    if (!gate.allowed) {
      const denied = this.#recordCloudRequest({
        actor,
        provider,
        operator,
        region,
        approvalId,
        idempotencyKey: key,
        status: "blocked_human_gate",
        gate,
        resources: [],
        correlationId: corr
      });
      return publicRequest(denied);
    }
    const adapter = this.adapterFactory(provider.providerKey);
    const resources = await adapter.createVpsSet({
      operatorId,
      region,
      serverType,
      image,
      labels: { sylion_tenant: operator.tenantId },
      idempotencyKey: key
    });
    const request = this.#recordCloudRequest({
      actor,
      provider,
      operator,
      region,
      approvalId,
      idempotencyKey: key,
      status: "executed_provider_mutation",
      gate,
      resources,
      correlationId: corr
    });
    return publicRequest(request);
  }

  qualifyFirecrackerHost({ actor, hostId = "local-host", approvalId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.manage", { correlationId: corr, resourceType: RESOURCE_TYPES.FIRECRACKER_HOST_QUALIFICATION });
    const probe = this.hostProbe();
    const checks = [
      { key: "kvm_device", status: probe.kvmDevicePresent ? "passed" : "blocked", detail: "/dev/kvm must be present on the execution host" },
      { key: "firecracker_binary", status: probe.firecrackerBinaryPresent ? "passed" : "blocked", detail: "Firecracker binary must be installed and pinned" },
      { key: "nested_virtualization", status: probe.nestedVirtualizationVerified ? "passed" : "blocked", detail: "Cloud host must expose KVM/nested virtualization or be bare metal" }
    ];
    const ready = this.env.SYLION_FIRECRACKER_HOST_MODE === "local_qualification" && checks.every((check) => check.status === "passed");
    const record = {
      id: newId("fc_host"),
      hostId: requireText(hostId, "hostId"),
      approvalId,
      mode: this.env.SYLION_FIRECRACKER_HOST_MODE || "blocked",
      platform: probe.platform,
      checks,
      readyForFirecrackerLaunch: ready,
      executionAllowed: false,
      humanGateRequired: true,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.hostQualifications.set(record.id, record);
    this.audit.record({
      actorId: actor.id,
      action: "firecracker.host_qualified",
      resourceType: RESOURCE_TYPES.FIRECRACKER_HOST_QUALIFICATION,
      resourceId: record.id,
      correlationId: corr,
      approvalId,
      policyDecision: ready ? "allow" : "deny",
      result: ready ? "qualified_for_review" : "blocked",
      newValue: record
    });
    return record;
  }

  listFirecrackerQualifications({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.read", { correlationId: corr, resourceType: RESOURCE_TYPES.FIRECRACKER_HOST_QUALIFICATION });
    return [...this.hostQualifications.values()];
  }

  createPhantomExecutionRequest({
    actor,
    packageId,
    purpose = "legal_lab_review",
    owners = [],
    evidenceRefs = [],
    expiresAt,
    labConfirmed = false,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.manage", { correlationId: corr, resourceType: RESOURCE_TYPES.PHANTOM_EXECUTION_REQUEST });
    const ownerSet = new Set(safeArray(owners, "owners"));
    const requiredOwners = ["legal", "ciso", "architect", "compliance"];
    const missingOwners = requiredOwners.filter((owner) => !ownerSet.has(owner));
    const evidence = safeArray(evidenceRefs, "evidenceRefs");
    const blockers = [
      ...missingOwners.map((owner) => `missing_${owner}_owner_ack`),
      ...(evidence.length ? [] : ["evidence_required"]),
      ...(labConfirmed ? [] : ["lab_confirmation_required"]),
      ...(this.env.SYLION_PHANTOM_LAB_ALLOWED === "true" ? [] : ["phantom_lab_env_flag_disabled"])
    ];
    const record = {
      id: newId("phantom_exec"),
      packageId: requireText(packageId, "packageId"),
      purpose: requireText(purpose, "purpose"),
      owners: [...ownerSet],
      evidenceRefs: evidence,
      expiresAt: requireText(expiresAt, "expiresAt"),
      status: blockers.length ? "blocked_human_gate" : "approved_for_lab_review",
      blockers,
      baselineUnlockAllowed: false,
      productionExecutionAllowed: false,
      labExecutionAllowed: blockers.length === 0,
      sideEffectAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.phantomRequests.set(record.id, record);
    this.audit.record({
      actorId: actor.id,
      action: "phantom.execution_request_created",
      resourceType: RESOURCE_TYPES.PHANTOM_EXECUTION_REQUEST,
      resourceId: record.id,
      correlationId: corr,
      policyDecision: record.labExecutionAllowed ? "allow" : "deny",
      result: record.status,
      newValue: record
    });
    return record;
  }

  listPhantomExecutionRequests({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.read", { correlationId: corr, resourceType: RESOURCE_TYPES.PHANTOM_EXECUTION_REQUEST });
    return [...this.phantomRequests.values()];
  }

  #evaluateCloudGate({ operatorId, region, liveConfirmed }) {
    const blockers = [];
    const allowedOperators = splitEnvList(this.env.SYLION_LIVE_ALLOWLIST_OPERATORS);
    const allowedRegions = splitEnvList(this.env.SYLION_LIVE_ALLOWED_REGIONS);
    if (this.env.SYLION_PROVIDER_MODE !== "live") blockers.push("provider_mode_not_live");
    if (this.env.SYLION_LIVE_ALLOWED !== "true") blockers.push("live_allowed_flag_false");
    if (!this.env.HETZNER_API_TOKEN) blockers.push("hetzner_api_token_missing");
    if (!liveConfirmed) blockers.push("live_confirmation_missing");
    if (!allowedOperators.includes("*") && !allowedOperators.includes(operatorId)) blockers.push("operator_not_allowlisted");
    if (!allowedRegions.includes(region)) blockers.push("region_not_allowlisted");
    if (Number(this.env.SYLION_LIVE_MAX_SERVERS || 0) < 3) blockers.push("live_server_cap_below_baseline");
    return {
      allowed: blockers.length === 0,
      blockers,
      mutationMode: blockers.length === 0 ? "live" : "blocked",
      baselineUnlockState: this.#baselineUnlockState()
    };
  }

  #baselineUnlockState() {
    if (this.env.SYLION_PROVIDER_MODE !== "live") return "production_unlock_requested";
    if (this.env.SYLION_LIVE_ALLOWED !== "true") return "human_gate_required";
    return "approved_for_live_execution_env_gate";
  }

  #recordCloudRequest({ actor, provider, operator, region, approvalId, idempotencyKey, status, gate, resources, correlationId }) {
    const request = {
      id: newId("live_req"),
      providerId: provider.id,
      providerKey: provider.providerKey,
      providerSecretReference: provider.apiSecretReference?.secretReference || null,
      operatorId: operator.id,
      tenantId: operator.tenantId,
      region,
      approvalId,
      idempotencyKey,
      requestedResources: ["G1", "G2", "WORKLOAD"],
      status,
      gate,
      resources,
      sideEffectAllowed: status === "executed_provider_mutation",
      executionAllowed: status === "executed_provider_mutation",
      productionExecutionAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.requests.set(request.id, request);
    this.idempotency.set(idempotencyKey, request.id);
    this.audit.record({
      actorId: actor.id,
      action: status === "executed_provider_mutation" ? "live_cloud.vps_set_created" : "live_cloud.vps_set_blocked",
      resourceType: RESOURCE_TYPES.LIVE_EXECUTION_REQUEST,
      resourceId: request.id,
      tenantId: operator.tenantId,
      operatorId: operator.id,
      approvalId,
      idempotencyKey,
      correlationId,
      policyDecision: request.executionAllowed ? "allow" : "deny",
      result: status,
      newValue: publicRequest(request)
    });
    return request;
  }
}
