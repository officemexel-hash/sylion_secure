import { existsSync } from "node:fs";
import { RESOURCE_TYPES } from "../../domain/constants.js";
import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";
import { HetznerLiveAdapter } from "./hetznerLiveAdapter.js";
import { HetznerRobotAdapter } from "./hetznerRobotAdapter.js";
import { OvhLiveAdapter } from "./ovhLiveAdapter.js";
import { EnvSecretProvider } from "../secrets/envSecretProvider.js";

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

const CPU_VENDORS = new Set(["intel", "amd", "unknown"]);
const CONFIDENTIAL_MODES = new Set(["none", "intel_tdx", "amd_sev_snp"]);
const PROVIDER_REHEARSAL_MODES = new Set(["gate_only", "adapter_sandbox", "live_provider"]);
const FIRECRACKER_REHEARSAL_WORKLOADS = new Set(["signal", "telegram", "whatsapp", "threema", "zangi", "simplex", "matrix", "protonmail"]);
const DEDICATED_ORDER_MODES = new Set(["plan_only", "robot_test", "live_order"]);
const WORKLOAD_TENANCY_MODES = new Set(["shared_pool", "dedicated_operator"]);
const WORKLOAD_NATIVE_LIFECYCLE = new Set(["ordered", "delivered", "bootstrapped", "lab_qualified", "degraded", "retired"]);
const WORKLOAD_IMAGE_APPS = new Set([
  "signal",
  "telegram",
  "whatsapp",
  "threema",
  "zangi",
  "simplex",
  "duckduckgo_browser",
  "libreoffice",
  "exodus",
  "protonmail"
]);
const WORKLOAD_RUNTIME_KINDS = new Set(["firecracker_microvm", "container_lab_helper", "android_native_workload"]);

function normalizeLower(value, field, allowed) {
  const normalized = requireText(value, field).toLowerCase();
  if (!allowed.has(normalized)) {
    throw validationError(`${field} is not supported`, { field, value, allowed: [...allowed] });
  }
  return normalized;
}

function featureFlags(value = {}) {
  return {
    virtualization: value.virtualization === true,
    iommu: value.iommu === true,
    tpm2: value.tpm2 === true,
    secureBoot: value.secureBoot === true,
    kernelLockdown: value.kernelLockdown === true,
    microcodeCurrent: value.microcodeCurrent === true
  };
}

function confidentialChecks({ cpuVendor, confidentialMode, features, attestation }) {
  const checks = [
    { key: "virtualization", status: features.virtualization ? "passed" : "blocked", detail: "VMX/SVM virtualization is required" },
    { key: "iommu", status: features.iommu ? "passed" : "blocked", detail: "IOMMU is required for host isolation" },
    { key: "tpm2", status: features.tpm2 ? "passed" : "blocked", detail: "TPM 2.0 is required for measured host posture" },
    { key: "secure_boot", status: features.secureBoot ? "passed" : "blocked", detail: "Secure Boot must be enabled" },
    { key: "kernel_lockdown", status: features.kernelLockdown ? "passed" : "blocked", detail: "Kernel lockdown must be active" },
    { key: "microcode_current", status: features.microcodeCurrent ? "passed" : "blocked", detail: "CPU microcode must be current" }
  ];
  if (confidentialMode === "intel_tdx") {
    checks.push({ key: "tdx_vendor_match", status: cpuVendor === "intel" ? "passed" : "blocked", detail: "Intel TDX requires Intel CPU" });
  }
  if (confidentialMode === "amd_sev_snp") {
    checks.push({ key: "sev_snp_vendor_match", status: cpuVendor === "amd" ? "passed" : "blocked", detail: "AMD SEV-SNP requires AMD CPU" });
  }
  if (confidentialMode !== "none") {
    checks.push({ key: "remote_attestation", status: attestation?.verified === true ? "passed" : "blocked", detail: "Remote attestation must verify trusted measurements before secrets release" });
  }
  return checks;
}

function publicRequest(record) {
  return {
    ...record,
    tokenPresent: undefined,
    rawProviderResponse: undefined
  };
}

function assertNoSensitiveRuntimeData(value, path = "payload") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    const currentPath = `${path}.${key}`;
    if (/password|secret|private.*key|key.*private|token|session|cookie|pem/i.test(key)) {
      throw validationError("Live workload host evidence must not contain sensitive runtime data", { field: currentPath });
    }
    if (typeof nested === "string" && /-----BEGIN .*PRIVATE KEY-----|xox[baprs]-|ghp_|hcloud_|api[_-]?key/i.test(nested)) {
      throw validationError("Live workload host evidence contains sensitive runtime data", { field: currentPath });
    }
    assertNoSensitiveRuntimeData(nested, currentPath);
  }
}

function boolFromEvidence(value) {
  return value === true || value === "true" || value === "present" || value === "yes" || value === "active" || value === "Running";
}

function sanitizeProviderResource(resource = {}) {
  return {
    role: resource.role,
    providerResourceId: String(resource.providerResourceId || resource.id || resource.name || "unknown"),
    name: resource.name || null,
    location: resource.location || null,
    publicIpv4: resource.publicIpv4 || null,
    publicIpv6: resource.publicIpv6 || null,
    status: resource.status || "created",
    rollback: resource.rollback ? {
      action: resource.rollback.action || "delete_server",
      providerResourceId: String(resource.rollback.providerResourceId || resource.providerResourceId || "unknown"),
      idempotencyKey: resource.rollback.idempotencyKey || null
    } : null
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
    robotAdapterFactory = null,
    env = process.env,
    secretProvider = null,
    hostProbe = null,
    store = null
  }) {
    this.audit = audit;
    this.rbac = rbac;
    this.providers = providers;
    this.operators = operators;
    this.approvals = approvals;
    this.env = env;
    this.secretProvider = secretProvider || new EnvSecretProvider({ env });
    this.adapterFactory = adapterFactory || ((providerKey) => {
      if (providerKey === "hetzner") return new HetznerLiveAdapter({ token: this.secretProvider.getProviderToken("hetzner") });
      if (providerKey === "ovh") return new OvhLiveAdapter();
      throw validationError("Live provider adapter is not implemented", { providerKey });
    });
    this.robotAdapterFactory = robotAdapterFactory || (() => new HetznerRobotAdapter({
      user: this.env.SYLION_HETZNER_ROBOT_USER,
      password: this.env.SYLION_HETZNER_ROBOT_PASSWORD
    }));
    this.hostProbe = hostProbe || (() => ({
      platform: process.platform,
      kvmDevicePresent: existsSync("/dev/kvm"),
      firecrackerBinaryPresent: false,
      nestedVirtualizationVerified: false
    }));
    this.requests = new PersistentMap({ store, collection: "live_execution_requests" });
    this.hostQualifications = new PersistentMap({ store, collection: "firecracker_host_qualifications" });
    this.firecrackerRehearsals = new PersistentMap({ store, collection: "firecracker_launch_rehearsals" });
    this.dedicatedOrders = new PersistentMap({ store, collection: "dedicated_workload_orders" });
    this.workloadNativeHosts = new PersistentMap({ store, collection: "workload_native_hosts" });
    this.workloadImageManifests = new PersistentMap({ store, collection: "workload_image_manifests" });
    this.cpuQualifications = new PersistentMap({ store, collection: "cpu_confidential_qualifications" });
    this.rollbackPlans = new PersistentMap({ store, collection: "live_rollback_plans" });
    this.providerRehearsals = new PersistentMap({ store, collection: "live_provider_rehearsals" });
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
      tokenConfigured: this.secretProvider.hasProviderSecret("hetzner"),
      secretProvider: this.secretProvider.status(),
      allowedRegions: splitEnvList(this.env.SYLION_LIVE_ALLOWED_REGIONS),
      allowlistedOperators: splitEnvList(this.env.SYLION_LIVE_ALLOWLIST_OPERATORS),
      maxServers: Number(this.env.SYLION_LIVE_MAX_SERVERS || 0),
      firecrackerHostMode: this.env.SYLION_FIRECRACKER_HOST_MODE || "blocked",
      firecrackerLaunchRehearsalAllowed: this.env.SYLION_FIRECRACKER_LAUNCH_REHEARSAL_ALLOWED === "true",
      phantomLabAllowed: this.env.SYLION_PHANTOM_LAB_ALLOWED === "true",
      baselineUnlockState: this.#baselineUnlockState(),
      liveRequests: this.requests.size,
      providerRehearsals: this.providerRehearsals.size,
      firecrackerQualifications: this.hostQualifications.size,
      firecrackerLaunchRehearsals: this.firecrackerRehearsals.size,
      dedicatedWorkloadOrders: this.dedicatedOrders.size,
      workloadNativeHosts: this.workloadNativeHosts.size,
      workloadImageManifests: this.workloadImageManifests.size,
      cpuQualifications: this.cpuQualifications.size,
      confidentialReadyHosts: [...this.cpuQualifications.values()].filter((item) => item.secretsReleaseAllowed).length,
      phantomExecutionRequests: this.phantomRequests.size,
      rollbackPlans: this.rollbackPlans.size,
      providerAdapters: [
        { providerKey: "hetzner", status: "gated_live_adapter", rollbackRequired: true },
        { providerKey: "hetzner_robot", status: "dedicated_order_adapter_human_gate", rollbackRequired: false },
        { providerKey: "ovh", status: "stub_blocked", rollbackRequired: true }
      ],
      productionExecutionAllowed: false,
      generatedAt: isoNow()
    };
  }

  listRequests({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.read", { correlationId: corr, resourceType: RESOURCE_TYPES.LIVE_EXECUTION_REQUEST });
    return [...this.requests.values()].map(publicRequest);
  }

  listRollbackPlans({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.read", { correlationId: corr, resourceType: RESOURCE_TYPES.LIVE_ROLLBACK_PLAN });
    return [...this.rollbackPlans.values()];
  }

  listProviderRehearsals({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.LIVE_PROVIDER_REHEARSAL
    });
    return [...this.providerRehearsals.values()];
  }

  listDedicatedWorkloadOrders({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.DEDICATED_WORKLOAD_ORDER
    });
    return [...this.dedicatedOrders.values()];
  }

  listWorkloadNativeHosts({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.WORKLOAD_NATIVE_HOST
    });
    return [...this.workloadNativeHosts.values()];
  }

  listWorkloadImageManifests({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.WORKLOAD_IMAGE_MANIFEST
    });
    return [...this.workloadImageManifests.values()];
  }

  latestReadyWorkloadImageManifestForApp(appKey) {
    const normalizedAppKey = String(appKey || "").trim().toLowerCase();
    return [...this.workloadImageManifests.values()]
      .filter((manifest) => manifest.appKey === normalizedAppKey)
      .filter((manifest) => manifest.readyForLabLaunch === true)
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
      .at(0) || null;
  }

  registerWorkloadNativeHost({
    actor,
    hostId = "WORKLOAD_NATIVE_LAB_01",
    serverNumber,
    productId,
    region,
    publicIpv4,
    publicIpv6 = null,
    orderId = null,
    providerResourceId = null,
    lifecycleState = "bootstrapped",
    tenancyMode = "shared_pool",
    evidence = {},
    productionBlockers = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.WORKLOAD_NATIVE_HOST
    });
    assertNoSensitiveRuntimeData(evidence, "evidence");
    const normalizedLifecycle = requireText(lifecycleState, "lifecycleState");
    if (!WORKLOAD_NATIVE_LIFECYCLE.has(normalizedLifecycle)) {
      throw validationError("Unsupported workload native host lifecycle state", {
        lifecycleState: normalizedLifecycle,
        allowed: [...WORKLOAD_NATIVE_LIFECYCLE]
      });
    }
    const blockers = safeArray(productionBlockers, "productionBlockers");
    const checks = this.#workloadNativeHostChecks(evidence, blockers);
    const readyForLabWorkloads = checks.filter((check) => check.requiredForLab !== false).every((check) => check.status === "passed");
    const record = {
      id: newId("workload_native_host"),
      hostId: requireText(hostId, "hostId"),
      serverNumber: requireText(serverNumber, "serverNumber"),
      productId: requireText(productId, "productId"),
      providerKey: "hetzner_robot",
      region: requireText(region, "region"),
      publicIpv4: publicIpv4 ? String(publicIpv4) : null,
      publicIpv6: publicIpv6 ? String(publicIpv6) : null,
      orderId,
      providerResourceId,
      lifecycleState: normalizedLifecycle,
      tenancyMode: normalizeLower(tenancyMode, "tenancyMode", WORKLOAD_TENANCY_MODES),
      evidence,
      checks,
      readyForLabWorkloads,
      readyForProduction: false,
      productionExecutionAllowed: false,
      productionBlockers: blockers,
      nextActions: [
        ...(readyForLabWorkloads ? ["build_first_firecracker_workload_image"] : ["resolve_lab_host_blockers"]),
        "bind_g1_g2_private_path",
        "bind_g2_thin_stream_broker",
        "run_pixel_human_regression",
        "collect_hsm_pki_evidence_before_production"
      ],
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.workloadNativeHosts.set(record.id, record);
    this.audit.record({
      actorId: actor.id,
      action: "workload_native_host.registered",
      resourceType: RESOURCE_TYPES.WORKLOAD_NATIVE_HOST,
      resourceId: record.id,
      correlationId: corr,
      policyDecision: readyForLabWorkloads ? "allow" : "deny",
      result: readyForLabWorkloads ? "lab_ready" : "blocked",
      newValue: record
    });
    return record;
  }

  createWorkloadImageManifest({
    actor,
    hostId,
    appKey,
    appName = null,
    runtimeKind = "firecracker_microvm",
    imageRef,
    kernelRef = null,
    rootfsRef = null,
    packageRef = null,
    cdrPolicyRef = "cdr://mandatory-workload-file-transfer",
    streamGateway = {},
    launchManifest = {},
    buildEvidence = {},
    productionBlockers = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.WORKLOAD_IMAGE_MANIFEST
    });
    assertNoSensitiveRuntimeData(buildEvidence, "buildEvidence");
    assertNoSensitiveRuntimeData(launchManifest, "launchManifest");
    assertNoSensitiveRuntimeData(streamGateway, "streamGateway");
    const normalizedAppKey = normalizeLower(appKey, "appKey", WORKLOAD_IMAGE_APPS);
    const normalizedRuntime = normalizeLower(runtimeKind, "runtimeKind", WORKLOAD_RUNTIME_KINDS);
    const host = [...this.workloadNativeHosts.values()].find((item) => item.hostId === hostId || item.id === hostId);
    if (!host) throw notFound("workload_native_host", hostId);
    const blockers = safeArray(productionBlockers, "productionBlockers");
    const normalized = {
      imageRef: requireText(imageRef, "imageRef"),
      kernelRef: kernelRef ? requireText(kernelRef, "kernelRef") : null,
      rootfsRef: rootfsRef ? requireText(rootfsRef, "rootfsRef") : null,
      packageRef: packageRef ? requireText(packageRef, "packageRef") : null,
      cdrPolicyRef: requireText(cdrPolicyRef, "cdrPolicyRef"),
      streamGateway: {
        bindAddress: streamGateway.bindAddress || "127.0.0.1",
        sourcePort: streamGateway.sourcePort ? Number(streamGateway.sourcePort) : null,
        throughG2: streamGateway.throughG2 === true,
        pixelOptimized: streamGateway.pixelOptimized === true,
        publicExposureAllowed: streamGateway.publicExposureAllowed === true
      }
    };
    const checks = this.#workloadImageManifestChecks({
      host,
      appKey: normalizedAppKey,
      runtimeKind: normalizedRuntime,
      ...normalized,
      buildEvidence,
      productionBlockers: blockers
    });
    const readyForLabLaunch = checks.filter((check) => check.requiredForLab !== false).every((check) => check.status === "passed");
    const record = {
      id: newId("workload_image_manifest"),
      hostId: host.hostId,
      hostRecordId: host.id,
      providerKey: host.providerKey,
      appKey: normalizedAppKey,
      appName: appName ? requireText(appName, "appName") : normalizedAppKey,
      runtimeKind: normalizedRuntime,
      imageRef: normalized.imageRef,
      kernelRef: normalized.kernelRef,
      rootfsRef: normalized.rootfsRef,
      packageRef: normalized.packageRef,
      cdrPolicyRef: normalized.cdrPolicyRef,
      streamGateway: normalized.streamGateway,
      launchManifest,
      buildEvidence,
      checks,
      readyForLabLaunch,
      readyForProduction: false,
      productionExecutionAllowed: false,
      terminalDataStored: false,
      secretsReleaseAllowed: false,
      productionBlockers: blockers,
      nextActions: [
        ...(readyForLabLaunch ? ["launch_lab_workload_private_stream"] : ["resolve_workload_image_blockers"]),
        "bind_g1_g2_private_path",
        "bind_g2_session_broker",
        "run_pixel_human_regression",
        "collect_cdr_runtime_evidence",
        "collect_hsm_pki_evidence_before_production"
      ],
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.workloadImageManifests.set(record.id, record);
    this.audit.record({
      actorId: actor.id,
      action: "workload_image_manifest.created",
      resourceType: RESOURCE_TYPES.WORKLOAD_IMAGE_MANIFEST,
      resourceId: record.id,
      correlationId: corr,
      policyDecision: readyForLabLaunch ? "allow" : "deny",
      result: readyForLabLaunch ? "lab_launch_ready" : "blocked",
      newValue: record
    });
    return record;
  }

  async createDedicatedWorkloadOrder({
    actor,
    providerId,
    operatorId,
    approvalId,
    productId,
    region,
    dist = "Ubuntu 24.04 LTS base",
    authorizedKeyRef = "admin-default-ssh-key",
    addons = ["primary_ipv4"],
    maxMonthlyPrice = null,
    workloadTenancyMode = "dedicated_operator",
    phantomSensitive = false,
    orderMode = "plan_only",
    liveConfirmed = false,
    costConfirmed = false,
    hardwareGateConfirmed = false,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.manage", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.DEDICATED_WORKLOAD_ORDER
    });
    const provider = this.providers.get(providerId);
    if (!provider) throw notFound("provider", providerId);
    if (provider.providerKey !== "hetzner_robot") {
      throw validationError("Dedicated workload order requires a Hetzner Robot provider record", {
        providerKey: provider.providerKey
      });
    }
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    if (operator.baseline?.vpsPerOperator !== 3) {
      throw validationError("Dedicated workload order requires the 3-machine operator baseline", { operatorId });
    }
    const approval = this.approvals.assertExecutionApproved({ actor, approvalId, planId: null, correlationId: corr }).approval;
    if (approval.operatorId !== operatorId) {
      throw validationError("Approval does not match requested operator", {
        approvalId,
        operatorId,
        approvalOperatorId: approval.operatorId
      });
    }
    const mode = normalizeLower(orderMode, "orderMode", DEDICATED_ORDER_MODES);
    const tenancyMode = normalizeLower(workloadTenancyMode, "workloadTenancyMode", WORKLOAD_TENANCY_MODES);
    const gate = this.#evaluateDedicatedOrderGate({
      operator,
      operatorId,
      region,
      productId,
      workloadTenancyMode: tenancyMode,
      phantomSensitive,
      orderMode: mode,
      liveConfirmed,
      costConfirmed,
      hardwareGateConfirmed,
      maxMonthlyPrice
    });
    const recordBase = {
      id: newId("dedicated_order"),
      providerId,
      providerKey: provider.providerKey,
      operatorId,
      tenantId: operator.tenantId,
      approvalId,
      productId: requireText(productId, "productId"),
      region: requireText(region, "region"),
      dist: requireText(dist, "dist"),
      authorizedKeyRef: requireText(authorizedKeyRef, "authorizedKeyRef"),
      addons: safeArray(addons, "addons"),
      maxMonthlyPrice: maxMonthlyPrice === null || maxMonthlyPrice === undefined ? null : Number(maxMonthlyPrice),
      workloadTenancyMode: tenancyMode,
      phantomSensitive: phantomSensitive === true,
      orderMode: mode,
      gate,
      terminalDataStored: false,
      productionExecutionAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    if (!gate.allowed || mode === "plan_only") {
      const planned = {
        ...recordBase,
        status: gate.allowed ? "plan_ready_no_provider_mutation" : "blocked_human_gate",
        sideEffectAllowed: false,
        providerResource: null,
        phases: [{ name: "dedicated_order_gate", status: gate.allowed ? "passed" : "blocked", details: { blockers: gate.blockers } }]
      };
      this.dedicatedOrders.set(planned.id, planned);
      this.audit.record({
        actorId: actor.id,
        action: "dedicated_workload.order_planned",
        resourceType: RESOURCE_TYPES.DEDICATED_WORKLOAD_ORDER,
        resourceId: planned.id,
        tenantId: operator.tenantId,
        operatorId,
        approvalId,
        correlationId: corr,
        policyDecision: planned.status === "plan_ready_no_provider_mutation" ? "allow" : "deny",
        result: planned.status,
        newValue: planned
      });
      return planned;
    }
    const adapter = this.robotAdapterFactory();
    const providerResource = await adapter.orderDedicatedServer({
      productId,
      location: region,
      dist,
      authorizedKey: authorizedKeyRef,
      addons,
      test: mode === "robot_test",
      maxMonthlyPrice
    });
    const ordered = {
      ...recordBase,
      status: mode === "robot_test" ? "robot_test_transaction_accepted" : "live_order_requested",
      sideEffectAllowed: mode === "live_order",
      providerResource,
      phases: [
        { name: "dedicated_order_gate", status: "passed", details: { mode } },
        { name: "robot_transaction", status: "passed", details: { providerResourceId: providerResource.providerResourceId } }
      ]
    };
    this.dedicatedOrders.set(ordered.id, ordered);
    this.audit.record({
      actorId: actor.id,
      action: mode === "live_order" ? "dedicated_workload.live_order_requested" : "dedicated_workload.robot_test_completed",
      resourceType: RESOURCE_TYPES.DEDICATED_WORKLOAD_ORDER,
      resourceId: ordered.id,
      tenantId: operator.tenantId,
      operatorId,
      approvalId,
      correlationId: corr,
      policyDecision: "allow",
      result: ordered.status,
      newValue: ordered
    });
    return ordered;
  }

  async runProviderRehearsal({
    actor,
    providerKey,
    providerId,
    operatorId,
    region,
    approvalId,
    idempotencyKey,
    rehearsalMode = "adapter_sandbox",
    liveConfirmed = false,
    cleanupConfirmed = true,
    serverType = "cx22",
    image = "ubuntu-24.04",
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.manage", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.LIVE_PROVIDER_REHEARSAL
    });
    const provider = this.providers.get(providerId);
    if (!provider) throw notFound("provider", providerId);
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    const requestedProviderKey = requireText(providerKey, "providerKey").toLowerCase();
    if (provider.providerKey !== requestedProviderKey) {
      throw validationError("Provider route does not match provider record", {
        requestedProviderKey,
        providerKey: provider.providerKey
      });
    }
    if (operator.baseline?.vpsPerOperator !== 3) {
      throw validationError("Live provider rehearsal requires exactly 3 VPS per operator", { operatorId });
    }
    const key = requireText(idempotencyKey, "idempotencyKey", 8);
    const approval = this.approvals.assertExecutionApproved({ actor, approvalId, planId: null, correlationId: corr }).approval;
    if (approval.operatorId !== operatorId) {
      throw validationError("Approval does not match requested operator", {
        approvalId,
        operatorId,
        approvalOperatorId: approval.operatorId
      });
    }
    const mode = normalizeLower(rehearsalMode, "rehearsalMode", PROVIDER_REHEARSAL_MODES);
    const gate = this.#evaluateProviderRehearsalGate({
      providerKey: provider.providerKey,
      operatorId,
      region,
      rehearsalMode: mode,
      liveConfirmed,
      cleanupConfirmed
    });
    if (!gate.allowed || mode === "gate_only") {
      return this.#recordProviderRehearsal({
        actor,
        provider,
        operator,
        approvalId,
        region,
        idempotencyKey: key,
        rehearsalMode: mode,
        gate,
        phases: [
          {
            name: "gate_evaluated",
            status: gate.allowed ? "passed" : "blocked",
            details: { blockers: gate.blockers }
          }
        ],
        status: gate.allowed ? "gate_passed_no_adapter_calls" : "blocked_human_gate",
        resources: [],
        rollbackResults: [],
        correlationId: corr
      });
    }

    const adapter = this.#providerRehearsalAdapter(provider.providerKey, mode);
    const phases = [{ name: "gate_evaluated", status: "passed", details: { mode } }];
    const resources = (await adapter.createVpsSet({
      operatorId,
      region,
      serverType,
      image,
      labels: { sylion_tenant: operator.tenantId, sylion_rehearsal: "true" },
      idempotencyKey: key
    })).map(sanitizeProviderResource);
    phases.push({
      name: "create_vps_set",
      status: "passed",
      details: { resourceCount: resources.length, roles: resources.map((resource) => resource.role) }
    });
    const roleSet = new Set(resources.map((resource) => resource.role));
    const missingRoles = ["G1", "G2", "WORKLOAD"].filter((role) => !roleSet.has(role));
    if (resources.length !== 3 || missingRoles.length > 0) {
      phases.push({ name: "baseline_shape", status: "failed", details: { missingRoles } });
      return this.#recordProviderRehearsal({
        actor,
        provider,
        operator,
        approvalId,
        region,
        idempotencyKey: key,
        rehearsalMode: mode,
        gate,
        phases,
        status: "failed_baseline_shape",
        resources,
        rollbackResults: [],
        correlationId: corr
      });
    }
    phases.push({ name: "baseline_shape", status: "passed", details: { requiredRoles: ["G1", "G2", "WORKLOAD"] } });

    let reconciliation = [];
    if (typeof adapter.listVpsSet === "function") {
      reconciliation = (await adapter.listVpsSet({ operatorId })).map(sanitizeProviderResource);
      phases.push({
        name: "reconcile_vps_set",
        status: "passed",
        details: { resourceCount: reconciliation.length }
      });
    }

    let rollbackResults = [];
    if (cleanupConfirmed) {
      rollbackResults = await adapter.deleteVpsSet({
        actions: resources.map((resource) => ({
          action: resource.rollback?.action || "delete_server",
          role: resource.role,
          providerResourceId: resource.providerResourceId,
          idempotencyKey: key
        }))
      });
      phases.push({
        name: "cleanup_rollback",
        status: "passed",
        details: { resultCount: rollbackResults.length }
      });
    }

    return this.#recordProviderRehearsal({
      actor,
      provider,
      operator,
      approvalId,
      region,
      idempotencyKey: key,
      rehearsalMode: mode,
      gate,
      phases,
      status: "smoke_passed",
      resources,
      reconciliation,
      rollbackResults,
      correlationId: corr
    });
  }

  async reconcileProviderVpsSet({ actor, providerKey, providerId, operatorId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.read", { operatorId, correlationId: corr, resourceType: RESOURCE_TYPES.LIVE_EXECUTION_REQUEST });
    const provider = this.providers.get(providerId);
    if (!provider) throw notFound("provider", providerId);
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    const requestedProviderKey = requireText(providerKey, "providerKey").toLowerCase();
    if (provider.providerKey !== requestedProviderKey) {
      throw validationError("Provider route does not match provider record", { requestedProviderKey, providerKey: provider.providerKey });
    }
    const gate = this.#evaluateCloudGate({ providerKey: provider.providerKey, operatorId, region: provider.regions?.[0] || "unknown", liveConfirmed: true });
    if (!gate.allowed) {
      const result = {
        id: newId("live_rec"),
        providerId,
        providerKey: provider.providerKey,
        operatorId,
        tenantId: operator.tenantId,
        status: "blocked_human_gate",
        gate,
        resources: [],
        drift: ["reconcile_blocked_by_live_gate"],
        productionExecutionAllowed: false,
        checkedAt: isoNow()
      };
      this.audit.record({
        actorId: actor.id,
        action: "live_cloud.reconcile_blocked",
        resourceType: RESOURCE_TYPES.LIVE_EXECUTION_REQUEST,
        resourceId: result.id,
        tenantId: operator.tenantId,
        operatorId,
        correlationId: corr,
        policyDecision: "deny",
        result: result.status,
        newValue: result
      });
      return result;
    }
    const adapter = this.adapterFactory(provider.providerKey);
    if (typeof adapter.listVpsSet !== "function") {
      throw validationError("Live provider adapter does not support reconciliation", { providerKey: provider.providerKey });
    }
    const resources = (await adapter.listVpsSet({ operatorId })).map(sanitizeProviderResource);
    const roles = new Set(resources.map((resource) => resource.role));
    const drift = ["G1", "G2", "WORKLOAD"].filter((role) => !roles.has(role)).map((role) => `missing_${role.toLowerCase()}`);
    const result = {
      id: newId("live_rec"),
      providerId,
      providerKey: provider.providerKey,
      operatorId,
      tenantId: operator.tenantId,
      status: drift.length ? "drift_detected" : "in_sync",
      gate,
      resources,
      drift,
      productionExecutionAllowed: false,
      checkedAt: isoNow()
    };
    this.audit.record({
      actorId: actor.id,
      action: "live_cloud.reconciled",
      resourceType: RESOURCE_TYPES.LIVE_EXECUTION_REQUEST,
      resourceId: result.id,
      tenantId: operator.tenantId,
      operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: result.status,
      newValue: result
    });
    return result;
  }

  async executeRollbackPlan({ actor, planId, liveConfirmed = false, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const plan = this.rollbackPlans.get(planId);
    if (!plan) throw notFound("live_rollback_plan", planId);
    this.rbac.assert(actor, "live_execution.manage", {
      operatorId: plan.operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.LIVE_ROLLBACK_PLAN,
      resourceId: planId
    });
    const gate = this.#evaluateCloudGate({
      providerKey: plan.providerKey,
      operatorId: plan.operatorId,
      region: plan.region,
      liveConfirmed
    });
    if (!gate.allowed) {
      const blocked = {
        ...plan,
        status: "rollback_blocked_human_gate",
        gate,
        checkedAt: isoNow(),
        checkedBy: actor.id
      };
      this.rollbackPlans.set(plan.id, blocked);
      this.audit.record({
        actorId: actor.id,
        action: "live_cloud.rollback_blocked",
        resourceType: RESOURCE_TYPES.LIVE_ROLLBACK_PLAN,
        resourceId: plan.id,
        tenantId: plan.tenantId,
        operatorId: plan.operatorId,
        correlationId: corr,
        policyDecision: "deny",
        result: blocked.status,
        previousValue: plan,
        newValue: blocked
      });
      return blocked;
    }
    const adapter = this.adapterFactory(plan.providerKey);
    if (typeof adapter.deleteVpsSet !== "function") {
      throw validationError("Live provider adapter does not support rollback execution", { providerKey: plan.providerKey });
    }
    const results = await adapter.deleteVpsSet({ actions: plan.actions });
    const executed = {
      ...plan,
      status: "rollback_executed",
      gate,
      results,
      sideEffectAllowed: true,
      productionExecutionAllowed: false,
      executedAt: isoNow(),
      executedBy: actor.id
    };
    this.rollbackPlans.set(plan.id, executed);
    this.audit.record({
      actorId: actor.id,
      action: "live_cloud.rollback_executed",
      resourceType: RESOURCE_TYPES.LIVE_ROLLBACK_PLAN,
      resourceId: plan.id,
      tenantId: plan.tenantId,
      operatorId: plan.operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: executed.status,
      previousValue: plan,
      newValue: executed
    });
    return executed;
  }

  async createProviderVpsSet({
    actor,
    providerKey,
    providerId,
    operatorId,
    region,
    approvalId,
    idempotencyKey,
    liveConfirmed = false,
    serverType = "cx22",
    serverTypesByRole = {},
    image = "ubuntu-24.04",
    sshKeys = [],
    userDataByRole = {},
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
    const requestedProviderKey = requireText(providerKey, "providerKey").toLowerCase();
    if (provider.providerKey !== requestedProviderKey) {
      throw validationError("Provider route does not match provider record", { requestedProviderKey, providerKey: provider.providerKey });
    }
    if (operator.baseline?.vpsPerOperator !== 3) {
      throw validationError("Live cloud baseline requires exactly 3 VPS per operator", { operatorId });
    }
    const approval = this.approvals.assertExecutionApproved({ actor, approvalId, planId: null, correlationId: corr }).approval;
    if (approval.operatorId !== operatorId) {
      throw validationError("Approval does not match requested operator", { approvalId, operatorId, approvalOperatorId: approval.operatorId });
    }
    const gate = this.#evaluateCloudGate({ providerKey: provider.providerKey, operatorId, region, liveConfirmed });
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
    const resources = (await adapter.createVpsSet({
      operatorId,
      region,
      serverType,
      serverTypesByRole,
      image,
      sshKeys,
      userDataByRole,
      labels: { sylion_tenant: operator.tenantId },
      idempotencyKey: key
    })).map(sanitizeProviderResource);
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

  async createHetznerVpsSet(input) {
    return this.createProviderVpsSet({ ...input, providerKey: "hetzner" });
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

  runFirecrackerLaunchRehearsal({
    actor,
    hostQualificationId,
    operatorId,
    workloadNames = ["signal"],
    imageRef = "image://sylion/microvm/rehearsal",
    kernelRef = "artifact://firecracker/kernel-pinned",
    rootfsRef = "artifact://firecracker/rootfs-rehearsal",
    networkMode = "tap_isolated_metadata_only",
    rehearsalConfirmed = false,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.manage", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.FIRECRACKER_LAUNCH_REHEARSAL
    });
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    const host = this.hostQualifications.get(hostQualificationId);
    if (!host) throw notFound("firecracker_host_qualification", hostQualificationId);
    const workloads = safeArray(workloadNames, "workloadNames").map((name) => name.toLowerCase());
    if (workloads.length === 0 || workloads.length > 10) {
      throw validationError("Firecracker rehearsal requires 1-10 workloads", { workloadCount: workloads.length });
    }
    const unsupported = workloads.filter((name) => !FIRECRACKER_REHEARSAL_WORKLOADS.has(name));
    if (unsupported.length) {
      throw validationError("Unsupported Firecracker rehearsal workload", { unsupported });
    }
    for (const [field, value] of Object.entries({ imageRef, kernelRef, rootfsRef, networkMode })) {
      if (/secret|token|password|private|terminal[_ -]?data|message|chat/i.test(String(value || ""))) {
        throw validationError("Firecracker rehearsal metadata must not contain secrets, terminal data or communication content", {
          field,
          contentRejected: true
        });
      }
    }
    const blockers = [
      ...(host.readyForFirecrackerLaunch ? [] : ["host_not_ready_for_firecracker_launch"]),
      ...(rehearsalConfirmed ? [] : ["rehearsal_confirmation_required"]),
      ...(this.env.SYLION_FIRECRACKER_LAUNCH_REHEARSAL_ALLOWED === "true" ? [] : ["firecracker_launch_rehearsal_env_flag_disabled"])
    ];
    const runtimes = workloads.map((name, index) => ({
      id: newId("fc_runtime"),
      workloadName: name,
      operatorId,
      jailerNamespace: `sylion-${operatorId}-${name}-${index}`,
      cpuTemplate: "T2",
      vcpu: 1,
      memoryMiB: 512,
      networkMode,
      terminalDataStored: false,
      secretsReleaseAllowed: false,
      status: blockers.length ? "planned_blocked" : "rehearsed_stopped"
    }));
    const phases = blockers.length ? [
      { name: "gate_evaluated", status: "blocked", details: { blockers } }
    ] : [
      { name: "gate_evaluated", status: "passed", details: { hostId: host.hostId } },
      { name: "jailer_plan", status: "passed", details: { runtimeCount: runtimes.length } },
      { name: "boot_rehearsal", status: "passed", details: { realKernelExecuted: false } },
      { name: "health_probe", status: "passed", details: { contentInspection: false } },
      { name: "stop_cleanup", status: "passed", details: { runtimesStopped: runtimes.length } }
    ];
    const record = {
      id: newId("fc_rehearsal"),
      hostQualificationId,
      hostId: host.hostId,
      operatorId,
      tenantId: operator.tenantId,
      imageRef: requireText(imageRef, "imageRef"),
      kernelRef: requireText(kernelRef, "kernelRef"),
      rootfsRef: requireText(rootfsRef, "rootfsRef"),
      networkMode: requireText(networkMode, "networkMode"),
      status: blockers.length ? "blocked_human_gate" : "rehearsal_passed",
      blockers,
      phases,
      runtimes,
      sideEffectAllowed: false,
      realKernelExecuted: false,
      terminalDataStored: false,
      secretsReleaseAllowed: false,
      productionExecutionAllowed: false,
      humanGateRequired: true,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.firecrackerRehearsals.set(record.id, record);
    this.audit.record({
      actorId: actor.id,
      action: "firecracker.launch_rehearsal_completed",
      resourceType: RESOURCE_TYPES.FIRECRACKER_LAUNCH_REHEARSAL,
      resourceId: record.id,
      tenantId: operator.tenantId,
      operatorId,
      correlationId: corr,
      policyDecision: blockers.length ? "deny" : "allow",
      result: record.status,
      newValue: record
    });
    return record;
  }

  listFirecrackerLaunchRehearsals({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.FIRECRACKER_LAUNCH_REHEARSAL
    });
    return [...this.firecrackerRehearsals.values()];
  }

  qualifyCpuConfidentialHost({
    actor,
    hostId = "local-host",
    cpuVendor = "unknown",
    cpuModel = "unknown",
    confidentialMode = "none",
    featureFlags: inputFeatures = {},
    attestation = {},
    tierTarget = "PRO",
    evidenceRefs = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.CPU_CONFIDENTIAL_QUALIFICATION
    });
    const normalizedVendor = normalizeLower(cpuVendor, "cpuVendor", CPU_VENDORS);
    const normalizedMode = normalizeLower(confidentialMode, "confidentialMode", CONFIDENTIAL_MODES);
    const features = featureFlags(inputFeatures);
    const checks = confidentialChecks({
      cpuVendor: normalizedVendor,
      confidentialMode: normalizedMode,
      features,
      attestation
    });
    const baseHostReady = checks
      .filter((check) => !["remote_attestation"].includes(check.key))
      .every((check) => check.status === "passed");
    const confidentialReady = normalizedMode !== "none" && checks.every((check) => check.status === "passed");
    const secretsReleaseAllowed = confidentialReady && safeArray(evidenceRefs, "evidenceRefs").length > 0;
    const record = {
      id: newId("cpu_conf"),
      hostId: requireText(hostId, "hostId"),
      cpuVendor: normalizedVendor,
      cpuModel: requireText(cpuModel, "cpuModel"),
      confidentialMode: normalizedMode,
      tierTarget: requireText(tierTarget, "tierTarget"),
      featureFlags: features,
      attestation: {
        verified: attestation?.verified === true,
        measurementRef: attestation?.measurementRef || null,
        verifier: attestation?.verifier || null
      },
      checks,
      firecrackerHostApproved: baseHostReady,
      confidentialComputingApproved: confidentialReady,
      secretsReleaseAllowed,
      productionExecutionAllowed: false,
      humanGateRequired: true,
      evidenceRefs: safeArray(evidenceRefs, "evidenceRefs"),
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.cpuQualifications.set(record.id, record);
    this.audit.record({
      actorId: actor.id,
      action: "cpu_confidential.host_qualified",
      resourceType: RESOURCE_TYPES.CPU_CONFIDENTIAL_QUALIFICATION,
      resourceId: record.id,
      correlationId: corr,
      policyDecision: record.secretsReleaseAllowed ? "allow" : "deny",
      result: record.secretsReleaseAllowed ? "qualified_for_secret_release_review" : "blocked",
      newValue: record
    });
    return record;
  }

  listCpuConfidentialQualifications({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "live_execution.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.CPU_CONFIDENTIAL_QUALIFICATION
    });
    return [...this.cpuQualifications.values()];
  }

  cpuConfidentialEvidenceSummary() {
    const records = [...this.cpuQualifications.values()];
    const firecrackerHostApprovedObserved = records.some((record) => record.firecrackerHostApproved === true);
    const confidentialApprovedObserved = records.some((record) => record.confidentialComputingApproved === true);
    const secretsReleaseAllowedObserved = records.some((record) => record.secretsReleaseAllowed === true);
    const attestationObserved = records.some((record) => record.attestation?.verified === true);
    const blockedAx102Observed = records.some((record) => (
      record.hostId?.includes("AX102")
      && record.confidentialComputingApproved === false
      && record.productionExecutionAllowed === false
    ));
    const ready = confidentialApprovedObserved
      && secretsReleaseAllowedObserved
      && attestationObserved;
    return {
      records: records.length,
      firecrackerHostApprovedObserved,
      confidentialApprovedObserved,
      secretsReleaseAllowedObserved,
      attestationObserved,
      blockedAx102Observed,
      ready,
      blockers: ready ? [] : [
        ...(confidentialApprovedObserved ? [] : ["sev_snp_or_tdx_attestation_missing"]),
        ...(secretsReleaseAllowedObserved ? [] : ["secrets_release_not_allowed"]),
        ...(attestationObserved ? [] : ["remote_attestation_not_verified"])
      ],
      productionExecutionAllowed: false
    };
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

  #evaluateCloudGate({ providerKey, operatorId, region, liveConfirmed }) {
    const blockers = [];
    const allowedOperators = splitEnvList(this.env.SYLION_LIVE_ALLOWLIST_OPERATORS);
    const allowedRegions = splitEnvList(this.env.SYLION_LIVE_ALLOWED_REGIONS);
    if (this.env.SYLION_PROVIDER_MODE !== "live") blockers.push("provider_mode_not_live");
    if (this.env.SYLION_LIVE_ALLOWED !== "true") blockers.push("live_allowed_flag_false");
    if (providerKey === "hetzner" && !this.secretProvider.hasProviderSecret("hetzner")) blockers.push("hetzner_api_token_missing");
    if (providerKey === "ovh") blockers.push("ovh_live_adapter_not_implemented");
    if (!liveConfirmed) blockers.push("live_confirmation_missing");
    if (!allowedOperators.includes("*") && !allowedOperators.includes(operatorId)) blockers.push("operator_not_allowlisted");
    if (!allowedRegions.includes(region)) blockers.push("region_not_allowlisted");
    if (Number(this.env.SYLION_LIVE_MAX_SERVERS || 0) < 3) blockers.push("live_server_cap_below_baseline");
    return {
      allowed: blockers.length === 0,
      blockers,
      providerKey,
      rollbackRequired: true,
      rollbackPlanRequiredBeforeMutation: true,
      mutationMode: blockers.length === 0 ? "live" : "blocked",
      baselineUnlockState: this.#baselineUnlockState()
    };
  }

  #evaluateProviderRehearsalGate({ providerKey, operatorId, region, rehearsalMode, liveConfirmed, cleanupConfirmed }) {
    const cloudGate = this.#evaluateCloudGate({ providerKey, operatorId, region, liveConfirmed });
    const blockers = [...cloudGate.blockers];
    if (!PROVIDER_REHEARSAL_MODES.has(rehearsalMode)) blockers.push("unsupported_rehearsal_mode");
    if (!cleanupConfirmed && rehearsalMode !== "gate_only") blockers.push("cleanup_confirmation_required");
    if (rehearsalMode === "live_provider" && this.env.SYLION_LIVE_SMOKE_ALLOWED !== "true") {
      blockers.push("live_smoke_env_flag_disabled");
    }
    if (rehearsalMode === "adapter_sandbox") {
      const filtered = blockers.filter((blocker) => ![
        "provider_mode_not_live",
        "live_allowed_flag_false",
        "hetzner_api_token_missing",
        "operator_not_allowlisted",
        "region_not_allowlisted",
        "live_server_cap_below_baseline"
      ].includes(blocker));
      return {
        ...cloudGate,
        allowed: filtered.length === 0,
        blockers: filtered,
        rehearsalMode,
        mutationMode: "adapter_sandbox",
        providerSideEffectAllowed: false,
        productionExecutionAllowed: false
      };
    }
    return {
      ...cloudGate,
      allowed: blockers.length === 0,
      blockers,
      rehearsalMode,
      mutationMode: rehearsalMode,
      providerSideEffectAllowed: rehearsalMode === "live_provider" && blockers.length === 0,
      productionExecutionAllowed: false
    };
  }

  #evaluateDedicatedOrderGate({ operator, operatorId, region, productId, workloadTenancyMode, phantomSensitive, orderMode, liveConfirmed, costConfirmed, hardwareGateConfirmed, maxMonthlyPrice }) {
    const blockers = [];
    const allowedOperators = splitEnvList(this.env.SYLION_LIVE_ALLOWLIST_OPERATORS);
    const allowedRegions = splitEnvList(this.env.SYLION_LIVE_ALLOWED_REGIONS);
    const allowedProducts = splitEnvList(this.env.SYLION_HETZNER_ROBOT_ALLOWED_PRODUCTS);
    const maxEnvPrice = Number(this.env.SYLION_HETZNER_ROBOT_MAX_MONTHLY_EUR || this.env.SYLION_DEDICATED_MAX_MONTHLY_EUR || 0);
    const labOverrideApplied = this.env.SYLION_WORKLOAD_TENANCY_LAB_OVERRIDE === "true"
      && workloadTenancyMode === "shared_pool"
      && (operator.tier === "SOVEREIGN" || phantomSensitive === true);
    if (!DEDICATED_ORDER_MODES.has(orderMode)) blockers.push("unsupported_order_mode");
    if (!WORKLOAD_TENANCY_MODES.has(workloadTenancyMode)) blockers.push("unsupported_workload_tenancy_mode");
    if (operator.tier === "SOVEREIGN" && workloadTenancyMode !== "dedicated_operator" && !labOverrideApplied) {
      blockers.push("sovereign_requires_dedicated_operator_workload");
    }
    if (phantomSensitive === true && workloadTenancyMode !== "dedicated_operator" && !labOverrideApplied) {
      blockers.push("phantom_requires_dedicated_operator_workload");
    }
    if (!liveConfirmed) blockers.push("live_confirmation_missing");
    if (!costConfirmed) blockers.push("cost_confirmation_missing");
    if (!hardwareGateConfirmed) blockers.push("hardware_gate_confirmation_missing");
    if (!allowedOperators.includes("*") && !allowedOperators.includes(operatorId)) blockers.push("operator_not_allowlisted");
    if (!allowedRegions.includes(region)) blockers.push("region_not_allowlisted");
    if (allowedProducts.length && !allowedProducts.includes(productId)) blockers.push("product_not_allowlisted");
    if (maxMonthlyPrice !== null && maxMonthlyPrice !== undefined && maxEnvPrice > 0 && Number(maxMonthlyPrice) > maxEnvPrice) {
      blockers.push("monthly_price_above_env_cap");
    }
    if (orderMode === "robot_test" || orderMode === "live_order") {
      if (this.env.SYLION_PROVIDER_MODE !== "live") blockers.push("provider_mode_not_live");
      if (this.env.SYLION_LIVE_ALLOWED !== "true") blockers.push("live_allowed_flag_false");
      if (!this.secretProvider.hasProviderSecret("hetzner_robot")) blockers.push("hetzner_robot_credentials_missing");
      if (this.env.SYLION_HETZNER_ROBOT_ORDERING_ENABLED !== "true") blockers.push("hetzner_robot_ordering_disabled");
    }
    if (orderMode === "live_order" && this.env.SYLION_HETZNER_ROBOT_PAID_ORDER_ALLOWED !== "true") {
      blockers.push("paid_dedicated_order_env_gate_disabled");
    }
    return {
      allowed: blockers.length === 0,
      blockers,
      providerKey: "hetzner_robot",
      orderMode,
      workloadTenancyMode,
      phantomSensitive: phantomSensitive === true,
      labOverrideApplied,
      labOnly: labOverrideApplied,
      requiresRequalificationBeforeProduction: labOverrideApplied,
      mutationMode: blockers.length === 0 ? orderMode : "blocked",
      baselineUnlockState: this.#baselineUnlockState(),
      rollbackRequired: false,
      dedicatedWorkloadRole: "WORKLOAD_NATIVE"
    };
  }

  #workloadNativeHostChecks(evidence = {}, productionBlockers = []) {
    const bootstrap = evidence.bootstrap || evidence.bootstrapPreflight || {};
    const hardware = evidence.hardware || evidence.hardwareQualification || {};
    const firecracker = evidence.firecrackerSmoke || {};
    const install = evidence.firecrackerInstall || {};
    const container = evidence.containerRuntime || {};
    return [
      {
        key: "kvm_device",
        status: boolFromEvidence(bootstrap.kvmDevice) || boolFromEvidence(hardware.kvmDevice) ? "passed" : "blocked",
        detail: "/dev/kvm must be present on the dedicated host"
      },
      {
        key: "amd_virtualization",
        status: Number(hardware.amdVirtualizationFlags || bootstrap.virtualizationFlags || 0) > 0 ? "passed" : "blocked",
        detail: "AMD-V/SVM or Intel VMX must be visible"
      },
      {
        key: "firecracker_binary",
        status: install.firecrackerVersion || bootstrap.firecrackerBinary !== "missing" ? "passed" : "blocked",
        detail: "Firecracker binary must be installed and pinned"
      },
      {
        key: "jailer_binary",
        status: install.jailerVersion || bootstrap.jailerBinary !== "missing" ? "passed" : "blocked",
        detail: "Jailer binary must be installed and pinned"
      },
      {
        key: "microvm_smoke",
        status: firecracker.microvmStarted === true || firecracker.state === "Running" ? "passed" : "blocked",
        detail: "A no-secret Firecracker microVM smoke test must reach Running"
      },
      {
        key: "auditd",
        status: boolFromEvidence(hardware.auditd) ? "passed" : "blocked",
        detail: "Host auditd must be active"
      },
      {
        key: "apparmor",
        status: boolFromEvidence(hardware.apparmor) ? "passed" : "blocked",
        detail: "AppArmor must be active"
      },
      {
        key: "container_helper_runtime",
        status: boolFromEvidence(container.dockerActive) && boolFromEvidence(container.containerdActive) ? "passed" : "blocked",
        detail: "Container runtime is helper-only for build/lab workflows",
        requiredForLab: false
      },
      {
        key: "production_blockers_declared",
        status: productionBlockers.length > 0 ? "passed" : "blocked",
        detail: "Production blockers must remain explicit until all gates pass",
        requiredForLab: false
      }
    ];
  }

  #workloadImageManifestChecks({
    host,
    appKey,
    runtimeKind,
    imageRef,
    kernelRef,
    rootfsRef,
    packageRef,
    cdrPolicyRef,
    streamGateway,
    buildEvidence = {},
    productionBlockers = []
  }) {
    const bindAddress = String(streamGateway.bindAddress || "");
    const privateBind = bindAddress === "127.0.0.1" || bindAddress === "::1" || bindAddress.startsWith("10.") || bindAddress.startsWith("172.16.") || bindAddress.startsWith("192.168.");
    const isFirecracker = runtimeKind === "firecracker_microvm";
    const isAndroid = runtimeKind === "android_native_workload";
    const isContainerHelper = runtimeKind === "container_lab_helper";
    return [
      {
        key: "host_lab_ready",
        status: host?.readyForLabWorkloads === true ? "passed" : "blocked",
        detail: "WORKLOAD_NATIVE host must pass KVM/Firecracker lab qualification"
      },
      {
        key: "supported_app",
        status: WORKLOAD_IMAGE_APPS.has(appKey) ? "passed" : "blocked",
        detail: "Application must be authorized in the workload image manifest catalog"
      },
      {
        key: "supported_runtime",
        status: WORKLOAD_RUNTIME_KINDS.has(runtimeKind) ? "passed" : "blocked",
        detail: "Runtime must be Firecracker, Android native workload, or container lab helper"
      },
      {
        key: "image_ref",
        status: imageRef ? "passed" : "blocked",
        detail: "Manifest must point at a reproducible image artifact"
      },
      {
        key: "firecracker_kernel_ref",
        status: !isFirecracker || kernelRef ? "passed" : "blocked",
        detail: "Firecracker microVM workloads require a pinned kernel artifact"
      },
      {
        key: "firecracker_rootfs_ref",
        status: !isFirecracker || rootfsRef ? "passed" : "blocked",
        detail: "Firecracker microVM workloads require a pinned rootfs artifact"
      },
      {
        key: "android_package_ref",
        status: !isAndroid || packageRef ? "passed" : "blocked",
        detail: "Android native workloads require a package reference"
      },
      {
        key: "android_binderfs_evidence",
        status: !isAndroid || buildEvidence.binderfs === true || buildEvidence.androidRuntime === true ? "passed" : "blocked",
        detail: "Android native workloads require binderfs/runtime evidence"
      },
      {
        key: "zangi_android_runtime",
        status: appKey !== "zangi" || isAndroid ? "passed" : "blocked",
        detail: "Zangi is tracked as Android-native until a supported desktop/microVM package is approved"
      },
      {
        key: "cdr_policy",
        status: String(cdrPolicyRef || "").startsWith("cdr://") ? "passed" : "blocked",
        detail: "All file ingress/egress must route through CDR"
      },
      {
        key: "private_stream_binding",
        status: privateBind && streamGateway.publicExposureAllowed !== true ? "passed" : "blocked",
        detail: "Workload stream must bind privately and reach Pixel through G2, not the public Internet"
      },
      {
        key: "g2_broker_declared",
        status: streamGateway.throughG2 === true ? "passed" : "blocked",
        detail: "Thin-client stream must be brokered by G2"
      },
      {
        key: "pixel_profile",
        status: streamGateway.pixelOptimized === true ? "passed" : "blocked",
        detail: "Pixel viewport and touch profile must be declared for human regression"
      },
      {
        key: "container_helper_lab_only",
        status: !isContainerHelper || productionBlockers.includes("container_helper_not_production_runtime") ? "passed" : "blocked",
        detail: "Containers are allowed only as lab helpers unless a tier-specific ADR approves them",
        requiredForLab: false
      },
      {
        key: "production_blockers_declared",
        status: productionBlockers.length > 0 ? "passed" : "blocked",
        detail: "Production blockers must remain explicit until all gates pass",
        requiredForLab: false
      }
    ];
  }

  #providerRehearsalAdapter(providerKey, rehearsalMode) {
    if (rehearsalMode === "adapter_sandbox") {
      return {
        async createVpsSet({ operatorId, region, idempotencyKey }) {
          return ["G1", "G2", "WORKLOAD"].map((role) => ({
            role,
            providerResourceId: `sandbox://${providerKey}/${operatorId}/${role.toLowerCase()}/${idempotencyKey}`,
            name: `sylion-${operatorId}-${role.toLowerCase()}-sandbox`,
            location: region,
            status: "sandbox_created",
            rollback: {
              action: "delete_server",
              providerResourceId: `sandbox://${providerKey}/${operatorId}/${role.toLowerCase()}/${idempotencyKey}`,
              idempotencyKey
            }
          }));
        },
        async listVpsSet({ operatorId }) {
          return ["G1", "G2", "WORKLOAD"].map((role) => ({
            role,
            providerResourceId: `sandbox://${providerKey}/${operatorId}/${role.toLowerCase()}`,
            status: "sandbox_running"
          }));
        },
        async deleteVpsSet({ actions }) {
          return actions.map((action) => ({ ...action, status: "sandbox_deleted" }));
        }
      };
    }
    return this.adapterFactory(providerKey);
  }

  #recordProviderRehearsal({
    actor,
    provider,
    operator,
    approvalId,
    region,
    idempotencyKey,
    rehearsalMode,
    gate,
    phases,
    status,
    resources,
    reconciliation = [],
    rollbackResults,
    correlationId
  }) {
    const rehearsal = {
      id: newId("live_rehearsal"),
      providerId: provider.id,
      providerKey: provider.providerKey,
      operatorId: operator.id,
      tenantId: operator.tenantId,
      approvalId,
      region,
      idempotencyKey,
      rehearsalMode,
      status,
      gate,
      phases,
      resources,
      reconciliation,
      rollbackResults,
      sideEffectAllowed: gate.providerSideEffectAllowed === true,
      productionExecutionAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.providerRehearsals.set(rehearsal.id, rehearsal);
    this.audit.record({
      actorId: actor.id,
      action: "live_cloud.provider_rehearsal_completed",
      resourceType: RESOURCE_TYPES.LIVE_PROVIDER_REHEARSAL,
      resourceId: rehearsal.id,
      tenantId: operator.tenantId,
      operatorId: operator.id,
      approvalId,
      idempotencyKey,
      correlationId,
      policyDecision: status === "smoke_passed" || status === "gate_passed_no_adapter_calls" ? "allow" : "deny",
      result: status,
      newValue: rehearsal
    });
    return rehearsal;
  }

  #baselineUnlockState() {
    if (this.env.SYLION_PROVIDER_MODE !== "live") return "production_unlock_requested";
    if (this.env.SYLION_LIVE_ALLOWED !== "true") return "human_gate_required";
    return "approved_for_live_execution_env_gate";
  }

  #rollbackPlanFor({ requestId, provider, operator, region, resources, idempotencyKey, status }) {
    return {
      id: newId("live_rb"),
      requestId,
      providerId: provider.id,
      providerKey: provider.providerKey,
      operatorId: operator.id,
      tenantId: operator.tenantId,
      region,
      status: status === "executed_provider_mutation" ? "ready_for_provider_cleanup" : "planned_blocked_no_resources",
      requiredBeforeMutation: true,
      sideEffectAllowed: false,
      productionExecutionAllowed: false,
      actions: resources.length ? resources.map((resource) => ({
        action: resource.rollback?.action || "delete_server",
        role: resource.role,
        providerResourceId: resource.providerResourceId,
        idempotencyKey
      })) : ["G1", "G2", "WORKLOAD"].map((role) => ({
        action: "no_op_not_created",
        role,
        providerResourceId: null,
        idempotencyKey
      })),
      createdAt: isoNow()
    };
  }

  #recordCloudRequest({ actor, provider, operator, region, approvalId, idempotencyKey, status, gate, resources, correlationId }) {
    const requestId = newId("live_req");
    const sanitizedResources = resources.map(sanitizeProviderResource);
    const rollbackPlan = this.#rollbackPlanFor({
      requestId,
      provider,
      operator,
      region,
      resources: sanitizedResources,
      idempotencyKey,
      status
    });
    const request = {
      id: requestId,
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
      resources: sanitizedResources,
      rollbackPlanId: rollbackPlan.id,
      rollbackReady: rollbackPlan.status === "ready_for_provider_cleanup",
      sideEffectAllowed: status === "executed_provider_mutation",
      executionAllowed: status === "executed_provider_mutation",
      productionExecutionAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.requests.set(request.id, request);
    this.rollbackPlans.set(rollbackPlan.id, rollbackPlan);
    this.idempotency.set(idempotencyKey, request.id);
    this.audit.record({
      actorId: actor.id,
      action: "live_cloud.rollback_plan_created",
      resourceType: RESOURCE_TYPES.LIVE_ROLLBACK_PLAN,
      resourceId: rollbackPlan.id,
      tenantId: operator.tenantId,
      operatorId: operator.id,
      approvalId,
      idempotencyKey,
      correlationId,
      policyDecision: "allow",
      result: rollbackPlan.status,
      newValue: rollbackPlan
    });
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
