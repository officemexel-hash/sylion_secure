import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { DEVICE_TYPES, RESOURCE_TYPES, TIERS } from "../../domain/constants.js";
import { AppError, notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const execFileAsync = promisify(execFile);

const TERMINAL_MODES = Object.freeze({
  PIXEL: "pixel_grapheneos",
  LAPTOP: "laptop_web_terminal"
});

const WORKLOAD_CONTROL_APPS = Object.freeze([
  { key: "whatsapp", name: "WhatsApp", category: "messenger", isolation: "container_standard_firecracker_pro", cdrRequired: true },
  { key: "signal", name: "Signal", category: "messenger", isolation: "container_standard_firecracker_pro", cdrRequired: true },
  { key: "telegram", name: "Telegram", category: "messenger", isolation: "container_standard_firecracker_pro", cdrRequired: true },
  { key: "threema", name: "Threema", category: "messenger", isolation: "container_standard_firecracker_pro", cdrRequired: true },
  {
    key: "zangi",
    name: "Zangi",
    category: "messenger",
    isolation: "android_workload_kvm_required",
    cdrRequired: true,
    nativeRuntimeRequired: true,
    nativeRuntimeClass: "android_workload",
    compatibilityMode: "remote_browser_download_page_only",
    productionNativeRequires: ["kvm_device", "binder_or_binderfs", "approved_android_image", "approved_zangi_apk_ref"]
  },
  { key: "matrix_client", name: "Matrix Client", category: "messenger", isolation: "container_standard_firecracker_pro", cdrRequired: true },
  { key: "matrix_server", name: "Matrix Server", category: "server", isolation: "dedicated_service_workload", cdrRequired: true },
  { key: "duckduckgo_browser", name: "DuckDuckGo Browser", category: "browser", isolation: "container_standard_firecracker_pro", cdrRequired: true },
  { key: "libreoffice", name: "LibreOffice", category: "office", isolation: "container_standard_firecracker_pro", cdrRequired: true },
  { key: "exodus", name: "Exodus", category: "wallet", isolation: "dedicated_wallet_workload", cdrRequired: true, requiresOperatorRiskAcceptance: true }
]);

const ANDROID_WORKLOAD_APPS = new Set(["zangi"]);
const SESSION_BROKER_PROTOCOLS = Object.freeze({
  GUACAMOLE: "guacamole",
  WEBRTC_SELKIES: "webrtc_selkies",
  LEGACY_WEBRTC_OR_SELKIES: "webrtc_or_selkies",
  NOVNC_LAB: "novnc_lab"
});
const PRODUCTION_SESSION_BROKER_PROTOCOLS = new Set([
  SESSION_BROKER_PROTOCOLS.GUACAMOLE,
  SESSION_BROKER_PROTOCOLS.WEBRTC_SELKIES,
  SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES
]);
const LAB_SESSION_BROKER_PROTOCOLS = new Set([
  SESSION_BROKER_PROTOCOLS.NOVNC_LAB,
  "novnc",
  "novnc_websockify",
  "novnc_over_g2_private_websockify_vnc_vencrypt_adapter"
]);

const WORKLOAD_CONTROL_ACTIONS = new Set(["scale_to_counts", "rotate_app", "recreate_all"]);
const UNLOCK_LAYERS = Object.freeze(["g1", "g2", "workload"]);
const PANIC_LEVELS = Object.freeze(["data_wipe", "environment_destroy", "account_revoke"]);
const JURISDICTION_MODES = Object.freeze(["disabled", "manual", "scheduled", "full_policy"]);
const ACCOUNT_BOOTSTRAP_RESULTS = new Set(["passed", "failed", "blocked", "in_progress"]);
const ACCOUNT_BOOTSTRAP_CHECK_STATUSES = new Set(["passed", "failed", "blocked", "not_run", "not_applicable"]);
const ACCOUNT_BOOTSTRAP_MODES = new Set([
  "desktop_linked_account",
  "android_native_workload",
  "physical_mobile_companion",
  "approved_test_number_provider",
  "manual_operator_account"
]);
const BOOTSTRAP_SECRET_FIELD_PATTERN = /(password|secret|token|api[_-]?key|otp|sms.*code|verification.*code|phone.*number|panic.*code|seed|mnemonic|private[_-]?key)/i;
const LIVE_RECREATE_APP_MAP = Object.freeze({
  whatsapp: "whatsapp",
  signal: "signal",
  telegram: "telegram",
  threema: "threema",
  zangi: "zangi",
  duckduckgo_browser: "duckduckgo",
  libreoffice: "libreoffice",
  exodus: "exodus"
});
const NATIVE_FIRECRACKER_RECREATE_APPS = new Set(["duckduckgo", "libreoffice", "whatsapp", "telegram", "threema", "signal"]);

function isoNow() {
  return new Date().toISOString();
}

function normalizeTerminalMode(terminalMode) {
  if ([TERMINAL_MODES.PIXEL, TERMINAL_MODES.LAPTOP].includes(terminalMode)) return terminalMode;
  throw validationError("Unsupported operator terminal mode", {
    terminalMode,
    supported: [TERMINAL_MODES.PIXEL, TERMINAL_MODES.LAPTOP]
  });
}

function publicSession(session) {
  return {
    id: session.id,
    operatorId: session.operatorId,
    tenantId: session.tenantId,
    terminalMode: session.terminalMode,
    deviceId: session.deviceId,
    sessionHours: session.sessionHours,
    expiresAt: session.expiresAt,
    productionExecutionAllowed: false,
    sideEffectAllowed: false,
    token: session.token
  };
}

async function defaultLiveWorkloadRunner({ app, wipeVolume = false }) {
  const nativeFirecracker = process.env.SYLION_OPERATOR_LIVE_WORKLOAD_RUNNER_MODE === "native_firecracker";
  const command = nativeFirecracker ? "node" : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = nativeFirecracker
    ? ["scripts/launch-native-firecracker-gui-workload.mjs", "--apply"]
    : ["run", "live:workload-recreate", "--", `--app=${app}`];
  if (!nativeFirecracker && wipeVolume) args.push("--wipe-volume");
  const result = await execFileAsync(command, args, {
    timeout: nativeFirecracker ? 1_800_000 : 240_000,
    windowsHide: true,
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(nativeFirecracker ? { SYLION_GUI_APP: app } : {})
    }
  });
  const stdout = result.stdout.trim();
  const json = stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json);
  return nativeFirecracker ? {
    applied: parsed.readyThroughG2 === true,
    app,
    mode: "native_firecracker",
    evidence: parsed.evidence,
    g2: parsed.g2,
    secretPrinted: false,
    productionExecutionAllowed: false
  } : parsed;
}

export class OperatorPortalService {
  constructor({
    audit,
    rbac,
    operators,
    devices,
    subscriptions,
    operatorEnvironments,
    securityProfiles,
    routerReadiness = null,
    env = process.env,
    store = null,
    liveWorkloadRunner = defaultLiveWorkloadRunner,
    workloadImageManifestResolver = null
  }) {
    this.audit = audit;
    this.rbac = rbac;
    this.operators = operators;
    this.devices = devices;
    this.subscriptions = subscriptions;
    this.operatorEnvironments = operatorEnvironments;
    this.securityProfiles = securityProfiles;
    this.routerReadiness = routerReadiness;
    this.env = env;
    this.sessions = new PersistentMap({ store, collection: "operator_portal_sessions" });
    this.workloadControlRequests = new PersistentMap({ store, collection: "operator_workload_control_requests" });
    this.unlockPolicies = new PersistentMap({ store, collection: "operator_unlock_policies" });
    this.safetyPolicies = new PersistentMap({ store, collection: "operator_safety_policies" });
    this.jurisdictionPolicies = new PersistentMap({ store, collection: "operator_jurisdiction_policies" });
    this.matrixRequests = new PersistentMap({ store, collection: "operator_matrix_server_requests" });
    this.subscriptionRequests = new PersistentMap({ store, collection: "operator_subscription_change_requests" });
    this.vpnEvidence = new PersistentMap({ store, collection: "operator_vpn_evidence" });
    this.streamingSessions = new PersistentMap({ store, collection: "operator_streaming_sessions" });
    this.streamingReadinessEvidence = new PersistentMap({ store, collection: "operator_streaming_readiness_evidence" });
    this.streamingRuntimeManifests = new PersistentMap({ store, collection: "operator_streaming_runtime_manifests" });
    this.workloadControlJobs = new PersistentMap({ store, collection: "operator_workload_control_jobs" });
    this.accountBootstrapSessions = new PersistentMap({ store, collection: "operator_account_bootstrap_sessions" });
    this.liveWorkloadRunner = liveWorkloadRunner;
    this.workloadImageManifestResolver = workloadImageManifestResolver;
  }

  createLocalSession({ actor, operatorId, terminalMode, deviceId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.portal.session.create", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.OPERATOR_PORTAL_SESSION
    });
    const operator = this.#requireOperator(operatorId);
    const mode = normalizeTerminalMode(terminalMode);
    const device = deviceId ? this.#requireAssignedTerminalDevice({ deviceId, operatorId, terminalMode: mode }) : null;
    const token = `op_${randomBytes(32).toString("hex")}`;
    const sessionHours = this.#sessionHoursForOperator(operatorId, operator.tier);
    const session = {
      id: newId("op_session"),
      token,
      operatorId,
      tenantId: operator.tenantId,
      terminalMode: mode,
      deviceId: device?.id || null,
      postureState: device?.posture?.state || "configuration_pending",
      createdAt: isoNow(),
      sessionHours,
      expiresAt: new Date(Date.now() + sessionHours * 60 * 60 * 1000).toISOString(),
      createdBy: actor.id,
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
    this.sessions.set(token, session);
    this.audit.record({
      actorId: actor.id,
      action: "operator_portal.session_created",
      resourceType: RESOURCE_TYPES.OPERATOR_PORTAL_SESSION,
      resourceId: session.id,
      tenantId: operator.tenantId,
      operatorId,
      correlationId: corr,
      newValue: { ...publicSession(session), token: "[redacted]" }
    });
    return publicSession(session);
  }

  actorFromToken(token) {
    const session = this.sessions.get(token);
    if (!session) {
      throw new AppError("unauthenticated", "Missing or invalid operator portal session", 401);
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.sessions.delete(token);
      throw new AppError("session_expired", "Operator portal session expired", 401);
    }
    return {
      id: `operator:${session.operatorId}`,
      role: "Operator Portal",
      operatorId: session.operatorId,
      tenantId: session.tenantId,
      sessionId: session.id,
      terminalMode: session.terminalMode,
      deviceId: session.deviceId
    };
  }

  me({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const operator = this.#requireOperator(operatorActor.operatorId);
    return {
      operatorId: operator.id,
      tenantId: operator.tenantId,
      displayName: operator.displayName,
      tier: operator.tier,
      status: operator.status,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      terminalModes: [TERMINAL_MODES.PIXEL, TERMINAL_MODES.LAPTOP],
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  devicesForOperator({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    return this.devices.listForOperatorScoped(operatorActor.operatorId).map((device) => ({
      id: device.id,
      type: device.type,
      model: device.model,
      status: device.status,
      posture: device.posture,
      terminalEligible: [DEVICE_TYPES.PIXEL, DEVICE_TYPES.LAPTOP_TERMINAL].includes(device.type),
      certificateRef: device.certificateRef || null
    }));
  }

  workloads({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const allocations = this.subscriptions.listAllocationsForOperatorScoped(operatorActor.operatorId).map((allocation) => ({
      id: allocation.id,
      name: allocation.appName,
      state: allocation.status,
      count: allocation.count,
      targetLayer: "WORKLOAD",
      cdrRequired: true,
      executionPlanned: false
    }));
    if (allocations.length) return allocations;
    return this.#latestMicroVmSlots(operatorActor.operatorId).map((slot) => ({
      id: slot.id,
      name: slot.appName,
      state: slot.status,
      count: 1,
      targetLayer: slot.targetVpsRole,
      cdrRequired: slot.cdrRequired,
      executionPlanned: false,
      microVmId: slot.microVmId,
      isolation: slot.isolation
    }));
  }

  workloadControl({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const subscription = this.subscription({ operatorActor, correlationId });
    const currentCounts = this.#currentWorkloadCounts(operatorActor.operatorId);
    const androidRuntime = this.#androidRuntimeSubstrate();
    const latestRequest = [...this.workloadControlRequests.values()]
      .filter((request) => request.operatorId === operatorActor.operatorId)
      .at(-1) || null;
    return {
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      catalog: WORKLOAD_CONTROL_APPS.map((app) => ({
        ...app,
        runtimeGate: ANDROID_WORKLOAD_APPS.has(app.key) ? androidRuntime : { required: false, ready: true, blockers: [] }
      })),
      quota: {
        maxWorkloadEnvironments: subscription.quota.maxWorkloadEnvironments,
        maxAppsPerOperator: subscription.quota.maxAppsPerOperator,
        tier: subscription.plan
      },
      currentCounts,
      latestDesiredCounts: latestRequest?.desiredCounts || currentCounts,
      latestRequest: latestRequest ? this.#publicWorkloadControlRequest(latestRequest) : null,
      latestJob: this.#latestWorkloadControlJob(operatorActor.operatorId),
      actions: [
        { key: "scale_to_counts", label: "Set desired counts", destructive: false },
        { key: "rotate_app", label: "Delete and recreate one app family", destructive: true },
        { key: "recreate_all", label: "Delete and recreate all environments", destructive: true }
      ],
      guardrails: {
        cdrRequired: true,
        terminalDataStored: false,
        quotaEnforced: true,
        destructiveCleanupAllowed: false,
        controlPlaneOnly: true,
        productionExecutionAllowed: this.env.SYLION_OPERATOR_LIVE_WORKLOAD_RUNNER_ENABLED === "true",
        androidNativeWorkloadGate: androidRuntime
      }
    };
  }

  requestWorkloadControl({ operatorActor, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const action = String(body.action || "scale_to_counts").trim();
    if (!WORKLOAD_CONTROL_ACTIONS.has(action)) {
      throw validationError("Unsupported workload control action", {
        action,
        supported: [...WORKLOAD_CONTROL_ACTIONS]
      });
    }
    const desiredCounts = this.#normalizeDesiredCounts(body.desiredCounts || {});
    const subscription = this.subscription({ operatorActor, correlationId: corr });
    const totalRequested = Object.values(desiredCounts).reduce((sum, value) => sum + value, 0);
    const quota = subscription.quota.maxWorkloadEnvironments;
    if (totalRequested > quota) {
      throw validationError("Requested workload environments exceed subscription quota", {
        totalRequested,
        maxWorkloadEnvironments: quota,
        tier: subscription.plan
      });
    }
    const rotateApp = action === "rotate_app" ? this.#normalizeWorkloadApp(body.rotateApp) : null;
    const request = {
      id: newId("workload_control"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      action,
      rotateApp,
      desiredCounts,
      totalRequested,
      quota: subscription.quota,
      state: action === "scale_to_counts" ? "queued_control_plane_update" : "queued_destructive_recreate_control_plane",
      deleteRecreateMode: action === "scale_to_counts" ? "not_requested" : "queued_control_plane",
      cdrRequired: true,
      terminalDataStored: false,
      controlPlaneOnly: true,
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      destructiveCleanupAllowed: false,
      executionPlan: this.#workloadExecutionPlan({
        action,
        rotateApp,
        desiredCounts,
        operatorId: operatorActor.operatorId
      }),
      requestedBy: operatorActor.id,
      requestedAt: isoNow()
    };
    this.workloadControlRequests.set(request.id, request);
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.workload_control_requested",
      resourceType: RESOURCE_TYPES.WORKLOAD_ALLOCATION,
      resourceId: request.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: request.state,
      newValue: this.#publicWorkloadControlRequest(request)
    });
    return this.#publicWorkloadControlRequest(request);
  }

  async executeWorkloadControlRequest({ operatorActor, requestId, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const request = this.workloadControlRequests.get(requestId);
    if (!request || request.operatorId !== operatorActor.operatorId) {
      throw notFound("workload_control_request", requestId);
    }
    if (request.action === "scale_to_counts") {
      throw validationError("Only destructive recreate requests can use the live workload runner", {
        requestId,
        action: request.action
      });
    }
    const runnerApp = this.#runnerAppForRequest(request);
    if (!runnerApp) {
      throw validationError("This workload request is not supported by the live recreate runner yet", {
        requestId,
        rotateApp: request.rotateApp,
        supported: Object.keys(LIVE_RECREATE_APP_MAP)
      });
    }
    const liveRunnerEnabled = this.env.SYLION_OPERATOR_LIVE_WORKLOAD_RUNNER_ENABLED === "true";
    const confirmation = String(body.confirmation || "").trim();
    if (!liveRunnerEnabled || confirmation !== "RUN_LIVE_WORKLOAD_RECREATE") {
      const blocked = this.#workloadJob({
        request,
        operatorActor,
        runnerApp,
        state: "blocked_before_live_runner",
        wipeVolume: false,
        result: null,
        blockers: [
          ...(liveRunnerEnabled ? [] : ["SYLION_OPERATOR_LIVE_WORKLOAD_RUNNER_ENABLED_not_true"]),
          ...(confirmation === "RUN_LIVE_WORKLOAD_RECREATE" ? [] : ["confirmation_phrase_missing"])
        ]
      });
      this.workloadControlJobs.set(blocked.id, blocked);
      this.audit.record({
        actorId: operatorActor.id,
        action: "operator_portal.workload_live_runner_blocked",
        resourceType: RESOURCE_TYPES.WORKLOAD_ALLOCATION,
        resourceId: blocked.id,
        tenantId: operatorActor.tenantId,
        operatorId: operatorActor.operatorId,
        correlationId: corr,
        policyDecision: "deny",
        result: blocked.state,
        newValue: this.#publicWorkloadControlJob(blocked)
      });
      return this.#publicWorkloadControlJob(blocked);
    }
    const wipeVolume = body.wipeVolume === true;
    if (wipeVolume && (this.env.SYLION_ALLOW_WORKLOAD_WIPE !== "true" || !body.fourEyesApprovalRef)) {
      throw validationError("Volume wipe requires four-eyes approval and explicit server-side unlock", {
        requestId,
        fourEyesApprovalRequired: true,
        envGate: "SYLION_ALLOW_WORKLOAD_WIPE"
      });
    }

    const started = this.#workloadJob({
      request,
      operatorActor,
      runnerApp,
      state: "running_live_workload_recreate",
      wipeVolume,
      result: null,
      blockers: []
    });
    this.workloadControlJobs.set(started.id, started);
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.workload_live_runner_started",
      resourceType: RESOURCE_TYPES.WORKLOAD_ALLOCATION,
      resourceId: started.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: started.state,
      newValue: this.#publicWorkloadControlJob(started)
    });

    try {
      const result = await this.liveWorkloadRunner({ app: runnerApp, wipeVolume });
      const completed = {
        ...started,
        state: result?.applied ? "completed_live_workload_recreate" : "failed_live_workload_recreate",
        completedAt: isoNow(),
        result: this.#sanitizeLiveRunnerResult(result),
        productionExecutionAllowed: false,
        sideEffectAllowed: true
      };
      request.state = completed.state;
      request.deleteRecreateMode = completed.state;
      request.liveJobId = completed.id;
      this.workloadControlRequests.set(request.id, request);
      this.workloadControlJobs.set(completed.id, completed);
      this.audit.record({
        actorId: operatorActor.id,
        action: "operator_portal.workload_live_runner_completed",
        resourceType: RESOURCE_TYPES.WORKLOAD_ALLOCATION,
        resourceId: completed.id,
        tenantId: operatorActor.tenantId,
        operatorId: operatorActor.operatorId,
        correlationId: corr,
        policyDecision: completed.state === "completed_live_workload_recreate" ? "allow" : "deny",
        result: completed.state,
        newValue: this.#publicWorkloadControlJob(completed)
      });
      return this.#publicWorkloadControlJob(completed);
    } catch (error) {
      const failed = {
        ...started,
        state: "failed_live_workload_recreate",
        completedAt: isoNow(),
        result: {
          applied: false,
          secretPrinted: false,
          error: String(error.message || error).slice(0, 240)
        },
        productionExecutionAllowed: false,
        sideEffectAllowed: false
      };
      request.state = failed.state;
      request.deleteRecreateMode = failed.state;
      request.liveJobId = failed.id;
      this.workloadControlRequests.set(request.id, request);
      this.workloadControlJobs.set(failed.id, failed);
      this.audit.record({
        actorId: operatorActor.id,
        action: "operator_portal.workload_live_runner_failed",
        resourceType: RESOURCE_TYPES.WORKLOAD_ALLOCATION,
        resourceId: failed.id,
        tenantId: operatorActor.tenantId,
        operatorId: operatorActor.operatorId,
        correlationId: corr,
        policyDecision: "deny",
        result: failed.state,
        newValue: this.#publicWorkloadControlJob(failed)
      });
      return this.#publicWorkloadControlJob(failed);
    }
  }

  connectionPath({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    return this.#connectionPathForOperator({
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId
    });
  }

  workloadExecution({ operatorActor, templateKey = "signal", correlationId }) {
    requireCorrelationId(correlationId);
    return this.#workloadExecutionForOperator({
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      templateKey
    });
  }

  startWorkloadExecution({ operatorActor, templateKey = "signal", correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const execution = this.#workloadExecutionForOperator({
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      templateKey
    });
    const request = {
      id: newId("workload_exec_req"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      templateKey: execution.templateKey,
      appName: execution.appName,
      requestedAt: isoNow(),
      requestedBy: operatorActor.id,
      state: execution.launchAllowed ? "queued_for_firecracker_runner" : "blocked",
      launchAllowed: execution.launchAllowed,
      productionExecutionAllowed: execution.productionExecutionAllowed,
      sideEffectAllowed: execution.sideEffectAllowed,
      blockers: execution.blockers,
      warnings: execution.warnings
    };
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.workload_execution_requested",
      resourceType: RESOURCE_TYPES.MOCK_FIRECRACKER_RUNTIME,
      resourceId: execution.slot?.microVmId || request.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: request.launchAllowed ? "allow" : "deny",
      result: request.state,
      newValue: request
    });
    return { ...request, execution };
  }

  adminConnectionPath({ actor, operatorId, terminalMode = TERMINAL_MODES.PIXEL, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.environment.read", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.TERMINAL_CONNECTION_PROFILE
    });
    this.#requireOperator(operatorId);
    return this.#connectionPathForOperator({
      operatorId,
      terminalMode: normalizeTerminalMode(terminalMode),
      deviceId: null
    });
  }

  vpnStatus({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const ready = this.#latestReadyEnvironment(operatorActor.operatorId);
    const evidence = this.#latestVpnEvidenceForOperator(operatorActor.operatorId);
    const evidenceReady = this.#vpnEvidenceReady(evidence);
    const state = evidenceReady ? "live_ipsec_connected" : ready ? "local_lab_connected" : "configuration_pending";
    const path = this.#connectionPathForOperator({
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId
    });
    return {
      state,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      router: "GL.iNet GL-XE3000 Puli AX pending physical package",
      transport: "ipsec_ikev2_planned",
      endpoints: {
        g1: ready ? `local-lab://${operatorActor.operatorId}/g1` : null,
        g2: ready ? `local-lab://${operatorActor.operatorId}/g2` : null,
        workload: ready ? `local-lab://${operatorActor.operatorId}/workload` : null
      },
      path: [
        path.nodes.find((node) => node.role === "TERMINAL")?.label || "Operator terminal",
        evidenceReady ? "Pixel strongSwan IPsec client" : "Puli AX IPsec gateway",
        "G1 network gateway",
        "G2 access broker",
        "WORKLOAD microVM layer"
      ],
      segments: path.segments,
      microVmSlots: path.microVmSlots,
      lastHandshake: evidenceReady ? evidence.observedAt : null,
      liveEvidence: evidence ? this.#publicVpnEvidence(evidence) : null,
      sideEffectAllowed: false,
      productionExecutionAllowed: evidenceReady
    };
  }

  recordVpnEvidence({ operatorActor, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const reachableHosts = Array.isArray(body.reachableHosts)
      ? body.reachableHosts.map((host) => String(host).trim()).filter(Boolean)
      : Object.entries(body.reachableHosts || {})
        .filter(([, reachable]) => Boolean(reachable))
        .map(([host]) => String(host).trim())
        .filter(Boolean);
    const evidence = {
      id: newId("vpn_evidence"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      vpnConnected: body.vpnConnected === true,
      vpnSession: String(body.vpnSession || "").slice(0, 64) || null,
      vpnInterface: String(body.vpnInterface || "").slice(0, 32) || null,
      dnsThroughTunnel: body.dnsThroughTunnel === true,
      reachableHosts,
      requiredHosts: ["admin.sylion.internal", "operator.sylion.internal", "signal.sylion.internal", "10.42.0.12"],
      certificateTrusted: body.certificateTrusted === true,
      observedAt: isoNow(),
      source: "operator_terminal_live_evidence",
      terminalDataStored: false,
      contentInspected: false
    };
    evidence.blockers = this.#vpnEvidenceBlockers(evidence);
    evidence.ready = evidence.blockers.length === 0;
    this.vpnEvidence.set(evidence.id, evidence);
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.vpn_live_evidence_recorded",
      resourceType: RESOURCE_TYPES.TERMINAL_CONNECTION_PROFILE,
      resourceId: evidence.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: evidence.ready ? "allow" : "deny",
      result: evidence.ready ? "live_ipsec_connected" : "vpn_evidence_incomplete",
      newValue: this.#publicVpnEvidence(evidence)
    });
    return this.#publicVpnEvidence(evidence);
  }

  vpnInstallPackage({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const vpn = this.vpnStatus({ operatorActor, correlationId });
    const readyForRealInstall = vpn.liveEvidence?.ready === true;
    return {
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      packageType: "android_ipsec_ikev2_profile",
      transport: "ipsec_ikev2_certificate_auth",
      installState: readyForRealInstall ? "active_live_evidence" : "blocked_human_gate",
      readyForRealInstall,
      profileDelivery: readyForRealInstall ? "installed_and_verified_on_pixel" : "adb_lab_preview_only",
      androidPackageInstallAllowed: false,
      requires: readyForRealInstall ? [] : [
        "pixel_live_vpn_evidence",
        "dns_leak_and_kill_switch_tests",
        "internal_ca_trusted",
        "g1_g2_workload_reachability"
      ],
      plannedProfile: {
        server: vpn.endpoints.g1,
        authentication: "mutual_certificate",
        ike: "aes256gcm16-prfsha384-ecp384",
        esp: "aes256gcm16-ecp384",
        alwaysOn: true,
        blockConnectionsWithoutVpn: true,
        dnsThroughTunnelOnly: true
      },
      liveEvidence: vpn.liveEvidence,
      productionExecutionAllowed: readyForRealInstall,
      sideEffectAllowed: false
    };
  }

  pixelCaProvisioning({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const caPem = this.env.SYLION_INTERNAL_CA_CERT_PEM || null;
    const fingerprint = this.env.SYLION_INTERNAL_CA_SHA256 || null;
    return {
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      packageType: "grapheneos_internal_ca_profile",
      caCertificateRef: caPem ? "env://SYLION_INTERNAL_CA_CERT_PEM" : "pki://sylion/internal-ca/current",
      caCertificatePem: caPem,
      caFingerprintSha256: fingerprint,
      trustScope: ["operator.sylion.internal", "*.sylion.internal"],
      installMethods: [
        {
          method: "grapheneos_settings_certificate_installer",
          status: "recommended",
          steps: [
            "Open Settings",
            "Security and privacy",
            "More security settings",
            "Encryption and credentials",
            "Install a certificate",
            "CA certificate",
            "Select sylion-internal.crt from Downloads",
            "Confirm screen lock"
          ]
        },
        {
          method: "adb_file_intent",
          status: "blocked_on_grapheneos_file_uri",
          reason: "GrapheneOS certificate installer may reject direct file:// intents from ADB."
        }
      ],
      validation: {
        expectedBrowserErrorBeforeInstall: "NET::ERR_CERT_AUTHORITY_INVALID",
        expectedBrowserStateAfterInstall: "trusted_internal_tls",
        requiresUserPresence: true,
        privateKeyIncluded: false
      },
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  laptopAccessPackage({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const vpn = this.vpnStatus({ operatorActor, correlationId });
    return {
      operatorId: operatorActor.operatorId,
      terminalMode: TERMINAL_MODES.LAPTOP,
      packageType: "laptop_ipsec_browser_thin_client_profile",
      transport: "ipsec_ikev2_certificate_auth",
      browserThinClient: {
        entrypoints: [
          "https://operator.sylion.internal/operator",
          "https://duckduckgo.sylion.internal/vnc.html",
          "https://libreoffice.sylion.internal/"
        ],
        sessionBroker: {
          requiredLayer: "G2",
          productionCandidates: ["guacamole", "webrtc_selkies"],
          labFallback: "novnc_lab",
          selectedProtocol: this.#selectedSessionBrokerProtocol(),
          noVncProductionApproved: false
        },
        streamResizePolicy: "server_side_dynamic_resolution",
        clipboardDefault: "disabled",
        fileTransfer: "cdr_required"
      },
      plannedProfile: {
        server: vpn.endpoints.g1,
        authentication: "mutual_certificate",
        ike: "aes256gcm16-prfsha384-ecp384",
        esp: "aes256gcm16-ecp384",
        splitTunnelAllowed: false,
        dnsThroughTunnelOnly: true,
        killSwitchRequired: true
      },
      validation: {
        noOperationalDataOnLaptop: true,
        noG1G2Bypass: true,
        requiredChecks: [
          "ikev2_sa_established",
          "operator_panel_loads_through_internal_tls",
          "guacamole_or_webrtc_session_broker_visible",
          "clipboard_disabled_by_default",
          "cdr_gate_blocks_file_transfer_without_decision"
        ]
      },
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  workloadSessionBroker({ operatorActor, templateKey = "signal", correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const normalizedTemplate = this.#normalizeWorkloadTemplate(templateKey);
    const execution = this.#workloadExecutionForOperator({
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      templateKey: normalizedTemplate
    });
    const host = this.#streamHostForTemplate(normalizedTemplate);
    const routeStatus = this.#workloadRouteStatus(normalizedTemplate);
    const broker = {
      id: newId("workload_broker"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      templateKey: execution.templateKey,
      appName: execution.appName,
      state: execution.launchAllowed || routeStatus.ready ? "session_ready" : "session_prepared_with_blockers",
      url: this.#workloadLaunchUrl(normalizedTemplate, host),
      routeStatus,
      authMode: normalizedTemplate === "signal" ? "g2_session_broker_required" : "g2_internal_tls",
      sessionBroker: this.#sessionBrokerCatalog(),
      handoff: {
        terminalMode: operatorActor.terminalMode,
        opensInBrowser: true,
        returnsViaAndroidBack: true,
        storesOperationalDataOnTerminal: false,
        clipboardEnabled: false,
        fileTransfer: "cdr_required"
      },
      blockers: [
        ...execution.blockers.filter((blocker) => !routeStatus.satisfiedBlockers.includes(blocker)),
        ...routeStatus.blockers,
        ...(this.env.SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL === "true" ? [] : ["pixel_internal_ca_not_trusted"])
      ],
      warnings: execution.warnings,
      productionExecutionAllowed: execution.productionExecutionAllowed,
      sideEffectAllowed: false,
      createdAt: isoNow()
    };
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.workload_session_broker_prepared",
      resourceType: RESOURCE_TYPES.TERMINAL_CONNECTION_PROFILE,
      resourceId: broker.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: broker.blockers.length ? "deny" : "allow",
      result: broker.state,
      newValue: { ...broker, url: broker.url, tokenMaterialStored: false }
    });
    return broker;
  }

  accountBootstrap({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const latestSessions = [...this.accountBootstrapSessions.values()]
      .filter((session) => session.operatorId === operatorActor.operatorId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 12)
      .map((session) => this.#publicAccountBootstrapSession(session));
    return {
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      terminalMode: operatorActor.terminalMode,
      catalog: this.#accountBootstrapCatalog(),
      latestSessions,
      guardrails: {
        noPhoneNumbersStored: true,
        noOtpStored: true,
        noSeedsOrWalletSecretsStored: true,
        evidenceRefsOnly: true,
        adminQaReviewRequiredForProductionReadiness: true,
        terminalDataStored: false,
        cdrRequired: true,
        productionExecutionAllowed: false
      }
    };
  }

  listAccountBootstrapEvidenceForAdmin({ actor, operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.WORKLOAD_FACTUAL_TEST,
      operatorId
    });
    return [...this.accountBootstrapSessions.values()]
      .filter((session) => !operatorId || session.operatorId === operatorId)
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
      .map((session) => this.#publicAccountBootstrapSession(session));
  }

  getAccountBootstrapEvidenceForAdmin({ actor, sessionId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.read", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.WORKLOAD_FACTUAL_TEST,
      resourceId: sessionId
    });
    const session = this.accountBootstrapSessions.get(sessionId);
    if (!session) throw notFound("account_bootstrap_session", sessionId);
    return this.#publicAccountBootstrapSession(session);
  }

  markAccountBootstrapEvidenceReviewed({ actor, sessionId, factualTestId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "release.manage", {
      correlationId: corr,
      resourceType: RESOURCE_TYPES.WORKLOAD_FACTUAL_TEST,
      resourceId: sessionId
    });
    const previous = this.accountBootstrapSessions.get(sessionId);
    if (!previous) throw notFound("account_bootstrap_session", sessionId);
    const next = {
      ...previous,
      state: "promoted_to_factual_test",
      adminQaReviewRequired: false,
      promotedFactualTestId: factualTestId,
      reviewedBy: actor.id,
      reviewedAt: isoNow(),
      updatedAt: isoNow()
    };
    this.accountBootstrapSessions.set(next.id, next);
    this.audit.record({
      actorId: actor.id,
      action: "operator_portal.account_bootstrap_promoted_to_factual_test",
      resourceType: RESOURCE_TYPES.WORKLOAD_FACTUAL_TEST,
      resourceId: next.id,
      tenantId: next.tenantId,
      operatorId: next.operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: next.state,
      previousValue: this.#publicAccountBootstrapSession(previous),
      newValue: this.#publicAccountBootstrapSession(next)
    });
    return this.#publicAccountBootstrapSession(next);
  }

  requestAccountBootstrap({ operatorActor, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.#assertNoBootstrapSecrets(body);
    const appKey = this.#normalizeWorkloadTemplate(body.appKey || body.templateKey || "signal");
    const mode = this.#normalizeBootstrapMode(body.mode || this.#defaultBootstrapMode(appKey));
    const runtimeMode = this.#normalizeBootstrapRuntime(body.runtimeMode || this.#defaultBootstrapRuntime(appKey));
    const app = this.#appDefinition(appKey);
    const requiredChecks = this.#accountBootstrapRequiredChecks(appKey);
    const routeStatus = this.#workloadRouteStatus(appKey);
    const androidRuntime = ANDROID_WORKLOAD_APPS.has(appKey) ? this.#androidRuntimeSubstrate() : null;
    const session = {
      id: newId("acct_bootstrap"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      appKey,
      appName: app.name,
      mode,
      runtimeMode,
      state: "awaiting_human_bootstrap",
      requiredChecks,
      routeStatus,
      runtimeGate: androidRuntime,
      launchUrl: this.#workloadLaunchUrl(appKey),
      approvedPhoneProviderRef: body.approvedPhoneProviderRef ? String(body.approvedPhoneProviderRef).trim().slice(0, 160) : null,
      evidencePolicy: {
        allowedEvidence: ["artifact_ref", "manual_note_without_secrets", "latency_ms", "pass_fail_checks"],
        forbiddenEvidence: ["phone_number", "otp_or_sms_code", "password", "seed", "message_content", "wallet_secret"],
        accountCreationResponsibility: "operator_human_step",
        adminQaReviewRequired: true
      },
      blockers: [
        ...(routeStatus.ready ? [] : routeStatus.blockers),
        ...(androidRuntime && !androidRuntime.ready ? androidRuntime.blockers.map((blocker) => `android_runtime:${blocker}`) : []),
        ...(appKey === "exodus" ? ["operator_wallet_risk_acceptance_required"] : []),
        "human_account_bootstrap_not_recorded",
        "send_receive_not_verified"
      ],
      checks: this.#normalizeBootstrapChecks(requiredChecks, {}),
      factualCandidate: false,
      terminalDataStored: false,
      cdrRequired: true,
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      createdBy: operatorActor.id,
      createdAt: isoNow()
    };
    this.accountBootstrapSessions.set(session.id, session);
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.account_bootstrap_requested",
      resourceType: RESOURCE_TYPES.WORKLOAD_FACTUAL_TEST,
      resourceId: session.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: "deny",
      result: session.state,
      newValue: this.#publicAccountBootstrapSession(session)
    });
    return this.#publicAccountBootstrapSession(session);
  }

  recordAccountBootstrapEvidence({ operatorActor, sessionId, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.#assertNoBootstrapSecrets(body);
    const previous = this.accountBootstrapSessions.get(sessionId);
    if (!previous || previous.operatorId !== operatorActor.operatorId) {
      throw notFound("account_bootstrap_session", sessionId);
    }
    const result = this.#normalizeBootstrapResult(body.result || "in_progress");
    const checks = this.#normalizeBootstrapChecks(previous.requiredChecks, body.checks || {});
    const missingRequired = previous.requiredChecks.filter((check) => checks[check]?.status !== "passed");
    if (result === "passed" && missingRequired.length) {
      throw validationError("Account bootstrap PASS requires every required check to pass", {
        appKey: previous.appKey,
        missingRequired,
        requiredChecks: previous.requiredChecks
      });
    }
    const factualCandidate = result === "passed" && missingRequired.length === 0;
    const next = {
      ...previous,
      state: factualCandidate ? "evidence_passed_pending_admin_qa_review" : result === "blocked" ? "blocked_pending_fix" : "evidence_incomplete",
      checks,
      result,
      blockers: factualCandidate ? [] : missingRequired.map((check) => `${check}_not_passed`),
      evidenceArtifactIds: this.#safeBootstrapArray(body.evidenceArtifactIds || [], "evidenceArtifactIds"),
      latencyMs: body.latencyMs === undefined || body.latencyMs === null || body.latencyMs === "" ? null : Number(body.latencyMs),
      note: body.note ? String(body.note).trim().slice(0, 500) : null,
      factualCandidate,
      adminQaReviewRequired: true,
      updatedBy: operatorActor.id,
      updatedAt: isoNow()
    };
    this.accountBootstrapSessions.set(next.id, next);
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.account_bootstrap_evidence_recorded",
      resourceType: RESOURCE_TYPES.WORKLOAD_FACTUAL_TEST,
      resourceId: next.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: factualCandidate ? "allow" : "deny",
      result: next.state,
      previousValue: this.#publicAccountBootstrapSession(previous),
      newValue: this.#publicAccountBootstrapSession(next)
    });
    return this.#publicAccountBootstrapSession(next);
  }

  liveAccessFoundation({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const path = this.#connectionPathForOperator({
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId
    });
    const vpn = this.vpnStatus({ operatorActor, correlationId });
    const caPackage = this.pixelCaProvisioning({ operatorActor, correlationId });
    const evidence = vpn.liveEvidence;
    const env = this.env || {};
    const caTrusted = evidence?.certificateTrusted === true || env.SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL === "true";
    const liveVpnReady = evidence?.ready === true;
    const g1ToG2Ready = env.SYLION_G1_G2_POLICY_READY === "true" || liveVpnReady;
    const g2ToWorkloadReady = env.SYLION_G2_WORKLOAD_POLICY_READY === "true" || liveVpnReady;
    const gatewayReady = env.SYLION_G2_WORKLOAD_GATEWAY_READY === "true" || evidence?.reachableHosts?.some((host) => host === "signal.sylion.internal");
    const hsmFidoDeferred = env.SYLION_DEFER_PHYSICAL_HSM_FIDO2 === "true";
    const routerDeferred = env.SYLION_PULI_AX_PHYSICAL_READY !== "true";
    const checks = [
      this.#liveAccessCheck("scoped_operator_session", true, "Operator session is scoped to one operator and terminal."),
      this.#liveAccessCheck("thin_terminal_boundary", true, "Pixel/laptop remains display and input only."),
      this.#liveAccessCheck("pixel_internal_ca_trust", caTrusted, "Pixel trusts SYLION Internal CA for *.sylion.internal."),
      this.#liveAccessCheck("t0_pixel_to_g1_ipsec", liveVpnReady, "Pixel strongSwan/IKEv2 tunnel to G1 is established and evidenced."),
      this.#liveAccessCheck("dns_through_tunnel", evidence?.dnsThroughTunnel === true, "Internal DNS is resolved through the tunnel only."),
      this.#liveAccessCheck("g1_to_g2_policy_path", g1ToG2Ready, "G1 forwards only the authorized policy path to G2."),
      this.#liveAccessCheck("g2_to_workload_policy_path", g2ToWorkloadReady, "G2 reaches WORKLOAD only through the workload policy path."),
      this.#liveAccessCheck("g2_workload_gateway_tls", gatewayReady, "Internal workload names terminate through G2 TLS gateway."),
      this.#liveAccessCheck("cdr_file_gate", true, "File ingress and egress stay blocked without CDR decision."),
      this.#liveAccessCheck("puli_ax_physical_router", !routerDeferred, "Puli AX physical router package and posture are validated.", routerDeferred ? "deferred" : "passed"),
      this.#liveAccessCheck("hsm_fido2_physical_enforcement", !hsmFidoDeferred, "Physical HSM/FIDO2 enforcement is configured.", hsmFidoDeferred ? "deferred" : "passed")
    ];
    const requiredBlockers = checks.filter((check) => check.required && check.status !== "passed").map((check) => check.key);
    const appGateways = ["signal", "whatsapp", "telegram", "threema", "zangi", "duckduckgo_browser", "libreoffice", "exodus"].map((templateKey) => {
      const host = `${templateKey === "duckduckgo_browser" ? "duckduckgo" : templateKey}.sylion.internal`;
      const browserOnly = !ANDROID_WORKLOAD_APPS.has(templateKey);
      return {
        templateKey,
        host,
        route: `terminal -> G1 -> G2 -> WORKLOAD -> ${templateKey}`,
        brokerState: requiredBlockers.length ? "blocked_until_live_access_ready" : "ready_for_session_broker",
        runtimeClass: browserOnly ? "firecracker_or_container_workload" : "android_workload_required",
        terminalDataStored: false,
        cdrRequired: true,
        productionExecutionAllowed: false
      };
    });
    return {
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      terminalMode: operatorActor.terminalMode,
      state: requiredBlockers.length ? "blocked_before_live_access" : "live_access_ready_for_workload_broker",
      phase: "stage_a_b_pixel_vpn_g1_g2_workload",
      path: {
        nodes: path.nodes.map((node) => ({ id: node.id, role: node.role, label: node.label, status: node.status })),
        segments: path.segments.map((segment) => ({
          id: segment.id,
          from: segment.from,
          to: segment.to,
          protocol: segment.protocol,
          state: segment.state,
          routePolicy: segment.routePolicy,
          killSwitch: segment.killSwitch
        }))
      },
      vpn: {
        state: vpn.state,
        transport: vpn.transport,
        lastHandshake: vpn.lastHandshake,
        evidenceReady: liveVpnReady,
        blockers: evidence?.blockers || ["vpn_evidence_missing"]
      },
      ca: {
        packageType: caPackage.packageType,
        trustedOnPixel: caTrusted,
        fingerprintPresent: Boolean(caPackage.caFingerprintSha256),
        requiresUserPresence: caPackage.validation.requiresUserPresence
      },
      checks,
      blockers: requiredBlockers,
      appGateways,
      nextActions: this.#liveAccessNextActions({ requiredBlockers, hsmFidoDeferred, routerDeferred }),
      guardrails: {
        noTerminalOperationalData: true,
        g1G2BypassAllowed: false,
        baselineTransport: "ipsec_ikev2",
        cdrRequired: true,
        hsmFido2DeferredOnly: hsmFidoDeferred,
        puliAxPhysicalDeferredOnly: routerDeferred
      },
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      generatedAt: isoNow()
    };
  }

  streamingProfile({ operatorActor, width = 390, height = 844, dpr = 3, correlationId }) {
    requireCorrelationId(correlationId);
    const w = Math.max(320, Math.min(Number(width) || 390, 2560));
    const h = Math.max(320, Math.min(Number(height) || 844, 2560));
    const ratio = Math.max(1, Math.min(Number(dpr) || 1, 4));
    const portrait = h >= w;
    const shortEdge = Math.min(w, h);
    const longEdge = Math.max(w, h);
    const targetLongEdge = shortEdge < 430 ? 1280 : shortEdge < 720 ? 1600 : 1920;
    const targetShortEdge = Math.round(targetLongEdge * (shortEdge / longEdge));
    const targetWidth = portrait ? targetShortEdge : targetLongEdge;
    const targetHeight = portrait ? targetLongEdge : targetShortEdge;
    const maxBitrateKbps = shortEdge < 430 ? 2800 : shortEdge < 720 ? 4200 : 6500;
    const pointerScale = Number((targetWidth / w).toFixed(3));
    return {
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      viewport: { width: w, height: h, dpr: ratio, orientation: portrait ? "portrait" : "landscape" },
      stream: {
        protocol: this.#selectedSessionBrokerProtocol(),
        source: "G2 pixel stream gateway",
        brokerLayer: "G2",
        brokerCandidates: this.#sessionBrokerCatalog().candidates,
        targetWidth,
        targetHeight,
        codec: "h264_baseline_or_av1_when_available",
        maxFps: 30,
        maxBitrateKbps,
        resizePolicy: "server_side_dynamic_resolution",
        pointerScale,
        touchInput: true,
        keyboardInput: "secure_overlay",
        clipboard: "disabled_by_default",
        fileTransfer: "cdr_required",
        operationalDataOnTerminal: false
      },
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  requestStreamingSession({ operatorActor, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const templateKey = this.#normalizeStreamingTemplate(body.templateKey || body.app || "signal");
    const viewport = {
      width: body.width,
      height: body.height,
      dpr: body.dpr
    };
    const profile = this.streamingProfile({
      operatorActor,
      width: viewport.width,
      height: viewport.height,
      dpr: viewport.dpr,
      correlationId: corr
    });
    const foundation = this.liveAccessFoundation({ operatorActor, correlationId: corr });
    const execution = this.#workloadExecutionForOperator({
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      templateKey
    });
    const env = this.env || {};
    const readiness = this.#latestStreamingReadinessForOperator(operatorActor.operatorId);
    const runtimeManifest = this.#latestStreamingRuntimeManifestForOperator(operatorActor.operatorId);
    const brokerPolicy = this.#sessionBrokerPolicy({
      protocol: body.protocol || runtimeManifest?.gateway?.protocol || readiness?.gateway?.protocol || env.SYLION_G2_SESSION_BROKER,
      readiness,
      runtimeManifest
    });
    const streamGatewayReady = this.#streamGatewayReady(readiness, env) && brokerPolicy.gatewayReady;
    const appStreamHost = this.#streamHostForTemplate(templateKey);
    const streamSourceBlockers = this.#streamSourceBlockers({ templateKey, env, readiness });
    const appSpecificBlockers = [
      ...(ANDROID_WORKLOAD_APPS.has(templateKey) ? ["android_native_stream_runner_required"] : []),
      ...(templateKey === "exodus" && env.SYLION_EXODUS_RISK_ACCEPTED !== "true" ? ["operator_wallet_risk_acceptance_required"] : [])
    ];
    const blockers = [
      ...foundation.blockers.map((blocker) => `live_access:${blocker}`),
      ...streamSourceBlockers,
      ...(streamGatewayReady ? [] : ["g2_stream_gateway_not_ready"]),
      ...brokerPolicy.blockers,
      ...appSpecificBlockers
    ];
    const ready = blockers.length === 0;
    const session = {
      id: newId("stream_session"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      templateKey,
      appName: execution.appName,
      state: ready ? "stream_session_ready" : "stream_session_blocked",
      launchUrl: ready ? `https://${appStreamHost}/stream/${templateKey}` : null,
      gateway: {
        role: "G2",
        host: "g2-stream.sylion.internal",
        appHost: appStreamHost,
        protocol: brokerPolicy.protocol,
        broker: brokerPolicy,
        transport: "internal_tls_via_g1_g2",
        publicInternetExposure: false,
        evidenceId: readiness?.id || null,
        runtimeManifestId: runtimeManifest?.id || null
      },
      source: {
        workloadRole: "WORKLOAD",
        readiness: streamSourceBlockers.length ? "blocked" : "ready",
        mode: "existing_workload_stream_source",
        runtimeManifestId: runtimeManifest?.sources?.[templateKey] ? runtimeManifest.id : null,
        productionWorkloadExecutionRequired: false
      },
      stream: {
        ...profile.stream,
        renderingMode: "server_side_pixels_only",
        sourceWorkload: `workload://${operatorActor.operatorId}/${templateKey}`,
        terminalReceives: ["video_pixels", "audio_optional", "input_events"],
        terminalForbidden: ["workload_files", "app_secrets", "message_database", "wallet_seed", "session_cookies"],
        fileTransfer: "cdr_required"
      },
      security: {
        terminalDataStored: false,
        clipboardEnabled: false,
        fileIngressEgress: "blocked_without_cdr_decision",
        g1G2BypassAllowed: false,
        recordingAllowed: false,
        auditContentStored: false
      },
      blockers,
      warnings: [
        ...execution.warnings,
        ...(runtimeManifest?.ready ? [] : ["stream_runtime_manifest_not_ready"]),
        ...(brokerPolicy.labOnly ? ["novnc_is_lab_only_until_human_approved_adr"] : []),
        "streaming_session_is_pixels_only_terminal_boundary",
        "production_runner_requires_human_pixel_visual_regression"
      ],
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      createdAt: isoNow()
    };
    this.streamingSessions.set(session.id, session);
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.streaming_session_requested",
      resourceType: RESOURCE_TYPES.TERMINAL_CONNECTION_PROFILE,
      resourceId: session.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: ready ? "allow" : "deny",
      result: session.state,
      newValue: this.#publicStreamingSession(session)
    });
    return this.#publicStreamingSession(session);
  }

  recordStreamingReadiness({ operatorActor, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const sourcesInput = body.sources && typeof body.sources === "object" ? body.sources : {};
    const sources = {};
    for (const app of WORKLOAD_CONTROL_APPS) {
      const value = sourcesInput[app.key] ?? sourcesInput[this.#streamHostForTemplate(app.key)] ?? false;
      sources[app.key] = value === true || value === "true";
    }
    const evidence = {
      id: newId("stream_readiness"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      gateway: {
        g2StreamGatewayReady: body.g2StreamGatewayReady === true,
        protocol: this.#normalizeSessionBrokerProtocol(body.protocol || SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES),
        publicInternetExposure: body.publicInternetExposure === true,
        tlsInternalOnly: body.tlsInternalOnly === true,
        inputProxyReady: body.inputProxyReady === true,
        brokerLayer: "G2"
      },
      broker: this.#sessionBrokerPolicy({
        protocol: body.protocol || SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES,
        readiness: {
          ready: body.g2StreamGatewayReady === true
            && body.publicInternetExposure !== true
            && body.tlsInternalOnly === true
            && body.inputProxyReady === true,
          gateway: {
            protocol: this.#normalizeSessionBrokerProtocol(body.protocol || SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES)
          }
        }
      }),
      sources,
      observedAt: isoNow(),
      source: "operator_streaming_readiness_evidence",
      contentInspected: false,
      terminalDataStored: false
    };
    evidence.blockers = this.#streamingReadinessBlockers(evidence);
    evidence.ready = evidence.blockers.length === 0;
    this.streamingReadinessEvidence.set(evidence.id, evidence);
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.streaming_readiness_recorded",
      resourceType: RESOURCE_TYPES.TERMINAL_CONNECTION_PROFILE,
      resourceId: evidence.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: evidence.ready ? "allow" : "deny",
      result: evidence.ready ? "streaming_readiness_evidence_ready" : "streaming_readiness_incomplete",
      newValue: this.#publicStreamingReadiness(evidence)
    });
    return this.#publicStreamingReadiness(evidence);
  }

  recordStreamingRuntimeManifest({ operatorActor, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const gatewayBind = String(body.gateway?.bindAddress || body.gatewayBindAddress || "").trim();
    const gatewayPort = this.#normalizeInteger(body.gateway?.port ?? body.gatewayPort, "gatewayPort", 1, 65535, 8443);
    const sourcesInput = body.sources && typeof body.sources === "object" ? body.sources : {};
    const sources = {};
    for (const app of WORKLOAD_CONTROL_APPS) {
      const source = sourcesInput[app.key];
      if (!source) continue;
      sources[app.key] = {
        templateKey: app.key,
        process: String(source.process || `${app.key}-stream-source`).slice(0, 96),
        bindAddress: String(source.bindAddress || "").trim(),
        port: this.#normalizeInteger(source.port, `${app.key}Port`, 1, 65535, 7900),
        healthPath: String(source.healthPath || "/healthz").slice(0, 128),
        cdrRequired: source.cdrRequired !== false,
        terminalDataStored: false
      };
    }
    const manifest = {
      id: newId("stream_runtime"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      gateway: {
        process: String(body.gateway?.process || "sylion-g2-stream-gateway").slice(0, 96),
        bindAddress: gatewayBind,
        port: gatewayPort,
        protocol: this.#normalizeSessionBrokerProtocol(body.gateway?.protocol || SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES),
        tlsMode: String(body.gateway?.tlsMode || "internal_tls_only").slice(0, 64),
        publicInternetExposure: body.gateway?.publicInternetExposure === true || body.publicInternetExposure === true,
        inputProxy: "server_side_input_events_only"
      },
      broker: this.#sessionBrokerPolicy({
        protocol: body.gateway?.protocol || SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES,
        runtimeManifest: {
          ready: this.#privateBindAllowed(gatewayBind)
            && body.gateway?.publicInternetExposure !== true
            && body.publicInternetExposure !== true
            && String(body.gateway?.tlsMode || "internal_tls_only") === "internal_tls_only",
          gateway: {
            protocol: this.#normalizeSessionBrokerProtocol(body.gateway?.protocol || SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES)
          }
        }
      }),
      sources,
      healthChecks: {
        gateway: `https://${gatewayBind}:${gatewayPort}/healthz`,
        sources: Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, `http://${source.bindAddress}:${source.port}${source.healthPath}`]))
      },
      guardrails: {
        terminalReceivesOnlyPixels: true,
        terminalDataStored: false,
        cdrRequired: true,
        g1G2BypassAllowed: false,
        publicInternetExposureAllowed: false,
        contentInspectionAllowed: false
      },
      createdAt: isoNow(),
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
    manifest.blockers = this.#streamingRuntimeManifestBlockers(manifest);
    manifest.ready = manifest.blockers.length === 0;
    this.streamingRuntimeManifests.set(manifest.id, manifest);
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.streaming_runtime_manifest_recorded",
      resourceType: RESOURCE_TYPES.TERMINAL_CONNECTION_PROFILE,
      resourceId: manifest.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: manifest.ready ? "allow" : "deny",
      result: manifest.ready ? "streaming_runtime_manifest_ready" : "streaming_runtime_manifest_blocked",
      newValue: this.#publicStreamingRuntimeManifest(manifest)
    });
    return this.#publicStreamingRuntimeManifest(manifest);
  }

  subscription({ operatorActor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const operator = this.#requireOperator(operatorActor.operatorId);
    const adminLikeActor = { id: "operator_portal_system", role: "Global Super Admin" };
    const subscription = this.subscriptions.getTenantSubscription({
      actor: adminLikeActor,
      tenantId: operator.tenantId,
      correlationId: corr
    });
    return {
      plan: subscription.tier,
      quota: subscription.effectiveLimits,
      billingStatus: subscription.billingStatus,
      addons: subscription.addons || [],
      destructiveCleanupAllowed: false
    };
  }

  requestSubscriptionChange({ operatorActor, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const targetTier = String(body.targetTier || "").trim().toUpperCase();
    const action = String(body.action || "upgrade").trim();
    if (!["renew", "upgrade", "downgrade"].includes(action)) {
      throw validationError("Unsupported subscription action", { action });
    }
    if (action !== "renew" && !Object.values(TIERS).includes(targetTier)) {
      throw validationError("Unknown subscription tier", { targetTier });
    }
    const current = this.subscription({ operatorActor, correlationId: corr });
    const request = {
      id: newId("sub_change"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      action,
      currentTier: current.plan,
      targetTier: action === "renew" ? current.plan : targetTier,
      state: "queued_billing_review",
      billingExecutionAllowed: false,
      productionExecutionAllowed: false,
      requestedAt: isoNow(),
      requestedBy: operatorActor.id
    };
    this.subscriptionRequests.set(request.id, request);
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.subscription_change_requested",
      resourceType: RESOURCE_TYPES.TENANT_SUBSCRIPTION,
      resourceId: request.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: request.state,
      newValue: request
    });
    return request;
  }

  auditEvents({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    return this.audit.list()
      .filter((event) => event.operatorId === operatorActor.operatorId)
      .slice(-30)
      .map((event) => ({
        id: event.id,
        timestamp: event.timestamp,
        action: event.action,
        result: event.result,
        resourceType: event.resourceType
      }));
  }

  fido2Policy({ operatorActor, correlationId }) {
    const adminLikeActor = { id: "operator_portal_system", role: "Global Super Admin" };
    return this.securityProfiles.getFido2Policy({
      actor: adminLikeActor,
      scope: "operator",
      operatorId: operatorActor.operatorId,
      correlationId
    });
  }

  updateFido2Policy({ operatorActor, body, correlationId }) {
    const adminLikeActor = { id: `operator:${operatorActor.operatorId}`, role: "Global Super Admin" };
    return this.securityProfiles.updateFido2Policy({
      actor: adminLikeActor,
      scope: "operator",
      operatorId: operatorActor.operatorId,
      ...body,
      correlationId
    });
  }

  hsmProfile({ operatorActor, correlationId }) {
    const adminLikeActor = { id: "operator_portal_system", role: "Global Super Admin" };
    return this.securityProfiles.getHsmProfile({
      actor: adminLikeActor,
      scope: "operator",
      operatorId: operatorActor.operatorId,
      correlationId
    });
  }

  updateHsmProfile({ operatorActor, body, correlationId }) {
    const adminLikeActor = { id: `operator:${operatorActor.operatorId}`, role: "Global Super Admin" };
    return this.securityProfiles.updateHsmProfile({
      actor: adminLikeActor,
      scope: "operator",
      operatorId: operatorActor.operatorId,
      ...body,
      correlationId
    });
  }

  unlockPolicy({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const operator = this.#requireOperator(operatorActor.operatorId);
    return this.#publicUnlockPolicy(this.#unlockPolicyForOperator(operatorActor.operatorId, operator.tier));
  }

  updateUnlockPolicy({ operatorActor, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const operator = this.#requireOperator(operatorActor.operatorId);
    const previous = this.#unlockPolicyForOperator(operatorActor.operatorId, operator.tier);
    const maxHours = this.#tierSessionMax(operator.tier);
    const sessionHours = this.#normalizeSessionHours(body.sessionHours, maxHours);
    const now = isoNow();
    const nextLayers = { ...previous.layers };
    const passwordFields = {
      g1: body.g1Password,
      g2: body.g2Password,
      workload: body.workloadPassword || body.vpsPassword
    };
    for (const layer of UNLOCK_LAYERS) {
      if (passwordFields[layer] !== undefined && passwordFields[layer] !== "") {
        this.#assertWriteOnlyPassphrase(passwordFields[layer], layer);
        nextLayers[layer] = {
          layer,
          passwordSet: true,
          passwordVerifierRef: `password-ref://${operatorActor.operatorId}/${layer}/${newId("verifier")}`,
          rotatedAt: now,
          passwordMaterialStored: false
        };
      }
    }
    const next = {
      ...previous,
      sessionHours,
      sessionExpiresAfterHours: sessionHours,
      layers: nextLayers,
      fido2: {
        requiredAtSessionEnd: body.fido2RequiredAtSessionEnd !== false,
        deferred: true,
        reauthWindowMinutes: 15
      },
      unlockDuringActiveSession: true,
      updatedAt: now,
      updatedBy: operatorActor.id,
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
    this.unlockPolicies.set(operatorActor.operatorId, next);
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.unlock_policy_updated",
      resourceType: RESOURCE_TYPES.SECURITY_PROFILE,
      resourceId: next.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: "write_only_policy_saved",
      previousValue: this.#publicUnlockPolicy(previous),
      newValue: this.#publicUnlockPolicy(next)
    });
    return this.#publicUnlockPolicy(next);
  }

  safetyPolicy({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    return this.#publicSafetyPolicy(this.#safetyPolicyForOperator(operatorActor.operatorId));
  }

  updateSafetyPolicy({ operatorActor, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const previous = this.#safetyPolicyForOperator(operatorActor.operatorId);
    const inactivityWipeDays = this.#normalizeInteger(body.inactivityWipeDays, "inactivityWipeDays", 1, 365, previous.inactivityWipeDays);
    const backupEnabled = body.backupEnabled === true;
    const backupCadenceHours = this.#normalizeInteger(body.backupCadenceHours, "backupCadenceHours", 1, 168, previous.backupCadenceHours);
    const now = isoNow();
    const nextPanic = { ...previous.panicCodes };
    for (const level of PANIC_LEVELS) {
      const field = `${level}Code`;
      if (body[field] !== undefined && body[field] !== "") {
        this.#assertWriteOnlyPassphrase(body[field], level);
        nextPanic[level] = {
          level,
          codeSet: true,
          verifierRef: `panic-ref://${operatorActor.operatorId}/${level}/${newId("verifier")}`,
          rotatedAt: now,
          codeMaterialStored: false
        };
      }
    }
    const next = {
      ...previous,
      backup: {
        enabled: backupEnabled,
        scope: "configuration_and_metadata_only",
        cadenceHours: backupCadenceHours,
        workloadDataIncluded: false,
        cdrRequiredForRestore: true
      },
      inactivityWipe: {
        enabled: body.inactivityWipeEnabled !== false,
        afterDays: inactivityWipeDays,
        lastSessionAt: this.#latestSessionForOperator(operatorActor.operatorId)?.createdAt || null,
        state: "armed_control_plane"
      },
      panicCodes: nextPanic,
      updatedAt: now,
      updatedBy: operatorActor.id
    };
    this.safetyPolicies.set(operatorActor.operatorId, next);
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.safety_policy_updated",
      resourceType: RESOURCE_TYPES.SECURITY_PROFILE,
      resourceId: next.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: "write_only_safety_policy_saved",
      previousValue: this.#publicSafetyPolicy(previous),
      newValue: this.#publicSafetyPolicy(next)
    });
    return this.#publicSafetyPolicy(next);
  }

  jurisdictionPolicy({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    return this.#publicJurisdictionPolicy(this.#jurisdictionPolicyForOperator({ operatorActor, correlationId }));
  }

  updateJurisdictionPolicy({ operatorActor, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const subscription = this.subscription({ operatorActor, correlationId: corr });
    const mode = String(body.mode || "disabled").trim();
    if (!JURISDICTION_MODES.includes(mode)) {
      throw validationError("Unsupported jurisdiction mode", { mode, supported: JURISDICTION_MODES });
    }
    this.#assertJurisdictionModeAllowed(mode, subscription.quota.jurisdictionRotationMode);
    const regions = Array.isArray(body.regions) ? body.regions.map((item) => String(item).trim()).filter(Boolean) : [];
    const countries = Array.isArray(body.countries) ? [...new Set(body.countries.map((item) => String(item).trim().toUpperCase()).filter(Boolean))] : [];
    const providers = Array.isArray(body.providers) ? [...new Set(body.providers.map((item) => String(item).trim().toLowerCase()).filter(Boolean))] : [];
    const frequencyHours = this.#normalizeJurisdictionFrequency(body.frequencyHours, subscription.quota);
    const maxCountries = subscription.quota.jurisdictionPolicy?.maxCountries;
    if (maxCountries !== "custom" && countries.length > Number(maxCountries || subscription.quota.regionCount || 1)) {
      throw validationError("Jurisdiction country count exceeds subscription tier", {
        countries: countries.length,
        maxCountries
      });
    }
    if (providers.length > 1 && subscription.quota.jurisdictionPolicy?.providerRotationAllowed !== true) {
      throw validationError("Provider rotation is not available in this subscription tier", {
        providers,
        subscriptionMode: subscription.quota.jurisdictionRotationMode
      });
    }
    const next = {
      id: `jurisdiction_${operatorActor.operatorId}`,
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      mode,
      regions,
      countries,
      providers,
      frequencyHours,
      rotationScopes: this.#rotationScopesForJurisdictionMode(mode, subscription.quota),
      subscriptionMode: subscription.quota.jurisdictionRotationMode,
      state: "queued_policy_update",
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      updatedAt: isoNow(),
      updatedBy: operatorActor.id
    };
    this.jurisdictionPolicies.set(operatorActor.operatorId, next);
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.jurisdiction_policy_updated",
      resourceType: RESOURCE_TYPES.TENANT_SUBSCRIPTION,
      resourceId: next.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: next.state,
      newValue: this.#publicJurisdictionPolicy(next)
    });
    return this.#publicJurisdictionPolicy(next);
  }

  matrixServer({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const latestRequest = [...this.matrixRequests.values()]
      .filter((request) => request.operatorId === operatorActor.operatorId)
      .at(-1) || null;
    return {
      operatorId: operatorActor.operatorId,
      latestRequest,
      addonRequired: true,
      cdrRequired: true,
      terminalDataStored: false,
      productionExecutionAllowed: false
    };
  }

  requestMatrixServer({ operatorActor, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const hostname = String(body.hostname || "").trim().toLowerCase();
    if (!/^[a-z0-9.-]{3,253}$/.test(hostname)) {
      throw validationError("Valid Matrix hostname is required", { hostname });
    }
    const request = {
      id: newId("matrix_req"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      hostname,
      federation: body.federation === true,
      state: "queued_addon_and_dns_review",
      addonRequired: true,
      cdrRequired: true,
      terminalDataStored: false,
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      requestedAt: isoNow(),
      requestedBy: operatorActor.id
    };
    this.matrixRequests.set(request.id, request);
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.matrix_server_requested",
      resourceType: RESOURCE_TYPES.WORKLOAD_ALLOCATION,
      resourceId: request.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: request.state,
      newValue: request
    });
    return request;
  }

  terminalProfiles({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    return [
      this.#terminalProfile({ operatorActor, mode: TERMINAL_MODES.PIXEL }),
      this.#terminalProfile({ operatorActor, mode: TERMINAL_MODES.LAPTOP })
    ];
  }

  #terminalProfile({ operatorActor, mode }) {
    return {
      id: `${operatorActor.operatorId}:${mode}`,
      operatorId: operatorActor.operatorId,
      mode,
      name: mode === TERMINAL_MODES.PIXEL ? "Pixel GrapheneOS terminal" : "Laptop web terminal",
      vpnPath: ["terminal", "Puli AX", "G1", "G2", "WORKLOAD"],
      baselineTransport: "ipsec_ikev2",
      operationalDataOnTerminal: false,
      adbSupportedForLab: mode === TERMINAL_MODES.PIXEL,
      browserThinClientSupported: mode === TERMINAL_MODES.LAPTOP,
      routerPackageStatus: "puli_ax_physical_validation_pending",
      fido2Required: true,
      hsmRequiredForProduction: true,
      productionExecutionAllowed: false
    };
  }

  #connectionPathForOperator({ operatorId, terminalMode, deviceId }) {
    const operator = this.#requireOperator(operatorId);
    const mode = normalizeTerminalMode(terminalMode);
    const ready = this.#latestReadyEnvironment(operatorId);
    const latestEnvironment = ready || this.#latestEnvironment(operatorId);
    const routeState = ready ? "local_lab_connected" : "configuration_pending";
    const routerReadiness = this.routerReadiness?.readinessForOperator(operatorId) || {
      packageStatus: "not_generated",
      postureStatus: "not_validated",
      blockers: ["router_package_required", "router_posture_validation_required"],
      readyForPhysicalSmoke: false
    };
    const blockers = [
      "real_ipsec_profile_not_deployed",
      "hsm_or_secure_element_client_certificate_required",
      "dns_leak_and_kill_switch_tests_required",
      "firecracker_host_qualification_required_for_real_launch",
      "fido2_operator_unlock_required",
      ...(routerReadiness.readyForPhysicalSmoke ? [] : ["puli_ax_physical_package_validation_pending"]),
      ...routerReadiness.blockers
    ];
    const terminalLabel = mode === TERMINAL_MODES.PIXEL ? "Pixel GrapheneOS terminal" : "Laptop web terminal";
    const nodes = [
      {
        id: "terminal",
        role: "TERMINAL",
        label: terminalLabel,
        terminalMode: mode,
        deviceId,
        zone: "terminal",
        operationalDataStored: false,
        status: routeState
      },
      {
        id: "g1",
        role: "G1",
        label: "G1 ingress VPN gateway",
        zone: "G1",
        providerResourceId: this.#resourceRef(latestEnvironment, "G1", operatorId),
        status: ready ? "reachable_local_lab" : "planned"
      },
      {
        id: "g2",
        role: "G2",
        label: "G2 access broker",
        zone: "G2",
        providerResourceId: this.#resourceRef(latestEnvironment, "G2", operatorId),
        status: ready ? "reachable_local_lab" : "planned"
      },
      {
        id: "workload",
        role: "WORKLOAD",
        label: "WORKLOAD Firecracker host",
        zone: "WORKLOAD",
        providerResourceId: this.#resourceRef(latestEnvironment, "WORKLOAD", operatorId),
        status: ready ? "reachable_local_lab" : "planned"
      }
    ];
    const segments = [
      this.#vpnSegment({
        id: "T0",
        from: "terminal",
        to: "g1",
        state: routeState,
        routePolicy: "terminal_default_route_to_g1_only",
        dnsPolicy: "dns_through_tunnel_only",
        killSwitch: "terminal_always_on_block_without_vpn",
        certRef: `cert-ref://${operatorId}/terminal-to-g1`
      }),
      this.#vpnSegment({
        id: "T1",
        from: "g1",
        to: "g2",
        state: ready ? "local_lab_linked" : "configuration_pending",
        routePolicy: "g1_allows_only_g2_broker_routes",
        dnsPolicy: "no_terminal_dns_visibility",
        killSwitch: "g1_default_drop_until_ipsec_up",
        certRef: `cert-ref://${operatorId}/g1-to-g2`
      }),
      this.#vpnSegment({
        id: "T2",
        from: "g2",
        to: "workload",
        state: ready ? "local_lab_linked" : "configuration_pending",
        routePolicy: "g2_broker_to_workload_microvm_only",
        dnsPolicy: "workload_dns_policy_cdr_aware",
        killSwitch: "g2_default_drop_until_workload_path_up",
        certRef: `cert-ref://${operatorId}/g2-to-workload`
      })
    ];
    const microVmSlots = this.#microVmSlotsForEnvironment({ environment: latestEnvironment, operatorId });
    return {
      operatorId,
      tenantId: operator.tenantId,
      terminalMode: mode,
      deviceId,
      state: routeState,
      router: {
        model: "GL.iNet GL-XE3000 Puli AX",
        packageStatus: routerReadiness.packageStatus,
        postureStatus: routerReadiness.postureStatus,
        packageId: routerReadiness.packageId,
        routerDeviceId: routerReadiness.routerDeviceId,
        readyForPhysicalSmoke: routerReadiness.readyForPhysicalSmoke,
        baselineRole: "access_router",
        openWrtHardeningRequired: true
      },
      baseline: {
        vpsRoles: ["G1", "G2", "WORKLOAD"],
        transport: "ipsec_ikev2",
        microVmIsolation: "firecracker_microvm_per_communicator",
        cdrRequired: true,
        hsmBackedPkiRequired: true
      },
      nodes,
      segments,
      microVmSlots,
      blockers,
      terminalOperationalDataStored: false,
      secretsReleaseAllowed: false,
      sideEffectAllowed: false,
      productionExecutionAllowed: false,
      generatedAt: isoNow()
    };
  }

  #vpnSegment({ id, from, to, state, routePolicy, dnsPolicy, killSwitch, certRef }) {
    return {
      id,
      from,
      to,
      state,
      protocol: "ipsec_ikev2",
      authentication: "mutual_certificate",
      cryptoProfile: "aes256gcm16-prfsha384-ecp384_planned",
      certRef,
      routePolicy,
      dnsPolicy,
      killSwitch,
      sideEffectAllowed: false,
      productionExecutionAllowed: false
    };
  }

  #microVmSlotsForEnvironment({ environment, operatorId }) {
    const runtimes = environment?.mockFirecracker?.runtimes || [];
    if (runtimes.length) {
      return runtimes.map((runtime, index) => this.#microVmSlot({ runtime, operatorId, index }));
    }
    return this.#latestMicroVmSlots(operatorId);
  }

  #latestMicroVmSlots(operatorId) {
    const environment = this.#latestEnvironment(operatorId);
    return (environment?.mockFirecracker?.runtimes || []).map((runtime, index) => this.#microVmSlot({ runtime, operatorId, index }));
  }

  #microVmSlot({ runtime, operatorId, index }) {
    const templateKey = runtime.templateKey || String(runtime.appName || `communicator_${index + 1}`).toLowerCase().replaceAll(" ", "_");
    return {
      id: runtime.id || newId("microvm_slot"),
      microVmId: runtime.id || `microvm://${operatorId}/${templateKey}/${index + 1}`,
      operatorId,
      templateKey,
      appName: runtime.appName || templateKey,
      status: runtime.status || "planned",
      targetVpsRole: "WORKLOAD",
      isolation: "firecracker_microvm",
      networkNamespace: `sylion-${operatorId}-${templateKey}-${index + 1}`,
      egressPolicy: "via_g2_policy_gateway_only",
      cdrRequired: true,
      secretsReleaseAllowed: false,
      terminalDataStored: false,
      productionExecutionAllowed: false
    };
  }

  #currentWorkloadCounts(operatorId) {
    const counts = Object.fromEntries(WORKLOAD_CONTROL_APPS.map((app) => [app.key, 0]));
    for (const slot of this.#latestMicroVmSlots(operatorId)) {
      if (counts[slot.templateKey] === undefined) counts[slot.templateKey] = 0;
      counts[slot.templateKey] += 1;
    }
    return counts;
  }

  #normalizeDesiredCounts(value) {
    const desired = Object.fromEntries(WORKLOAD_CONTROL_APPS.map((app) => [app.key, 0]));
    for (const app of WORKLOAD_CONTROL_APPS) {
      const raw = value[app.key];
      const count = raw === undefined || raw === "" ? 0 : Number(raw);
      if (!Number.isInteger(count) || count < 0 || count > 30) {
        throw validationError("Workload count must be an integer between 0 and 30", {
          app: app.key,
          value: raw
        });
      }
      desired[app.key] = count;
    }
    return desired;
  }

  #normalizeWorkloadApp(value) {
    const key = String(value || "").trim().toLowerCase();
    if (!WORKLOAD_CONTROL_APPS.some((app) => app.key === key)) {
      throw validationError("Unknown workload app", {
        app: value,
        supported: WORKLOAD_CONTROL_APPS.map((app) => app.key)
      });
    }
    return key;
  }

  #publicWorkloadControlRequest(request) {
    return {
      id: request.id,
      operatorId: request.operatorId,
      tenantId: request.tenantId,
      action: request.action,
      rotateApp: request.rotateApp,
      desiredCounts: request.desiredCounts,
      totalRequested: request.totalRequested,
      quota: {
        maxWorkloadEnvironments: request.quota.maxWorkloadEnvironments,
        maxAppsPerOperator: request.quota.maxAppsPerOperator,
        tier: request.quota.tier
      },
      state: request.state,
      deleteRecreateMode: request.deleteRecreateMode,
      cdrRequired: true,
      terminalDataStored: false,
      controlPlaneOnly: true,
      executionPlan: request.executionPlan || null,
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      destructiveCleanupAllowed: false,
      liveJobId: request.liveJobId || null,
      liveJob: request.liveJobId ? this.#publicWorkloadControlJob(this.workloadControlJobs.get(request.liveJobId)) : null,
      requestedAt: request.requestedAt
    };
  }

  #runnerAppForRequest(request) {
    if (request.action === "recreate_all") return this.#nativeFirecrackerRunnerEnabled() ? null : "all";
    const app = LIVE_RECREATE_APP_MAP[request.rotateApp] || null;
    if (this.#nativeFirecrackerRunnerEnabled() && !NATIVE_FIRECRACKER_RECREATE_APPS.has(app)) return null;
    return app;
  }

  #workloadJob({ request, operatorActor, runnerApp, state, wipeVolume, result, blockers = [] }) {
    return {
      id: newId("workload_live_job"),
      requestId: request.id,
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      action: request.action,
      rotateApp: request.rotateApp,
      runnerApp,
      state,
      wipeVolume,
      cdrRequired: true,
      terminalDataStored: false,
      privateBindOnlyRequired: true,
      signalAuthHandoffRequired: request.action === "recreate_all" || runnerApp === "signal",
      blockers,
      result,
      requestedBy: operatorActor.id,
      startedAt: isoNow(),
      completedAt: null,
      productionExecutionAllowed: false,
      sideEffectAllowed: state === "running_live_workload_recreate"
    };
  }

  #latestWorkloadControlJob(operatorId) {
    const job = [...this.workloadControlJobs.values()]
      .filter((item) => item.operatorId === operatorId)
      .at(-1) || null;
    return job ? this.#publicWorkloadControlJob(job) : null;
  }

  #sanitizeLiveRunnerResult(result) {
    if (!result || typeof result !== "object") return { applied: false, secretPrinted: false };
    return {
      applied: result.applied === true,
      secretPrinted: false,
      workloadEvidence: result.workloadEvidence ? {
        component: result.workloadEvidence.component,
        app: result.workloadEvidence.app,
        wipeVolume: result.workloadEvidence.wipeVolume === true,
        cdrRequired: result.workloadEvidence.cdrRequired === true,
        terminalDataStored: result.workloadEvidence.terminalDataStored === true,
        privateBindOnly: result.workloadEvidence.privateBindOnly === true,
        checkedAt: result.workloadEvidence.checkedAt || null
      } : null,
      signalHandoff: result.signalHandoff ? {
        applied: result.signalHandoff.applied === true,
        secretPrinted: false,
        signalStatus: result.signalHandoff.signalStatus || null,
        terminalDataStored: result.signalHandoff.terminalDataStored === true,
        g1G2BypassAllowed: result.signalHandoff.g1G2BypassAllowed === true,
        cdrRequired: result.signalHandoff.cdrRequired === true
      } : null,
      smoke: result.smoke || {},
      nativeFirecracker: result.mode === "native_firecracker" ? {
        app: result.app,
        readyThroughG2: result.applied === true,
        g2: result.g2 || {},
        evidence: result.evidence ? {
          component: result.evidence.component,
          appKey: result.evidence.appKey,
          hostHttpCode: result.evidence.hostHttpCode,
          noVncMarker: result.evidence.noVncMarker === true,
          terminalDataStored: result.evidence.terminalDataStored === true,
          productionExecutionAllowed: result.evidence.productionExecutionAllowed === true
        } : null
      } : null,
      productionExecutionAllowed: false
    };
  }

  #publicWorkloadControlJob(job) {
    if (!job) return null;
    return {
      id: job.id,
      requestId: job.requestId,
      operatorId: job.operatorId,
      tenantId: job.tenantId,
      action: job.action,
      rotateApp: job.rotateApp,
      runnerApp: job.runnerApp,
      state: job.state,
      wipeVolume: job.wipeVolume === true,
      cdrRequired: true,
      terminalDataStored: false,
      privateBindOnlyRequired: true,
      signalAuthHandoffRequired: job.signalAuthHandoffRequired === true,
      blockers: job.blockers || [],
      result: job.result || null,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      productionExecutionAllowed: false,
      sideEffectAllowed: job.sideEffectAllowed === true
    };
  }

  #latestVpnEvidenceForOperator(operatorId) {
    return [...this.vpnEvidence.values()]
      .filter((evidence) => evidence.operatorId === operatorId)
      .at(-1) || null;
  }

  #vpnEvidenceReady(evidence) {
    return this.#vpnEvidenceBlockers(evidence).length === 0;
  }

  #vpnEvidenceBlockers(evidence) {
    if (!evidence) return ["vpn_evidence_missing"];
    const reachable = new Set(evidence.reachableHosts || []);
    const missingHosts = (evidence.requiredHosts || []).filter((host) => !reachable.has(host));
    return [
      ...(evidence.vpnConnected ? [] : ["vpn_not_connected"]),
      ...(evidence.vpnInterface === "tun1" ? [] : ["tun1_interface_missing"]),
      ...(evidence.dnsThroughTunnel ? [] : ["dns_not_through_tunnel"]),
      ...(evidence.certificateTrusted ? [] : ["internal_ca_not_trusted"]),
      ...missingHosts.map((host) => `host_unreachable:${host}`)
    ];
  }

  #publicVpnEvidence(evidence) {
    return {
      id: evidence.id,
      operatorId: evidence.operatorId,
      terminalMode: evidence.terminalMode,
      deviceId: evidence.deviceId,
      vpnConnected: evidence.vpnConnected,
      vpnSession: evidence.vpnSession,
      vpnInterface: evidence.vpnInterface,
      dnsThroughTunnel: evidence.dnsThroughTunnel,
      certificateTrusted: evidence.certificateTrusted,
      reachableHosts: evidence.reachableHosts,
      requiredHosts: evidence.requiredHosts,
      ready: evidence.ready,
      blockers: evidence.blockers,
      observedAt: evidence.observedAt,
      terminalDataStored: false,
      contentInspected: false
    };
  }

  #liveAccessCheck(key, passed, detail, statusOverride = null) {
    const status = statusOverride || (passed ? "passed" : "blocked");
    return {
      key,
      status,
      required: status !== "deferred",
      detail,
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  #liveAccessNextActions({ requiredBlockers, hsmFidoDeferred, routerDeferred }) {
    const actions = [];
    if (requiredBlockers.includes("pixel_internal_ca_trust")) {
      actions.push("Install SYLION Internal CA on Pixel through GrapheneOS user-present certificate flow.");
    }
    if (requiredBlockers.includes("t0_pixel_to_g1_ipsec")) {
      actions.push("Establish Pixel strongSwan IKEv2 tunnel to G1 and record live VPN evidence.");
    }
    if (requiredBlockers.includes("dns_through_tunnel")) {
      actions.push("Verify DNS leak prevention and internal DNS resolution through the VPN tunnel.");
    }
    if (requiredBlockers.includes("g1_to_g2_policy_path") || requiredBlockers.includes("g2_to_workload_policy_path")) {
      actions.push("Apply G1/G2 policy routing and default-deny firewall rules for T1/T2.");
    }
    if (requiredBlockers.includes("g2_workload_gateway_tls")) {
      actions.push("Enable G2 TLS workload gateway for signal/whatsapp/telegram/threema/zangi/duckduckgo/libreoffice/exodus hostnames.");
    }
    if (routerDeferred) {
      actions.push("Complete Puli AX physical package and posture smoke when router is available.");
    }
    if (hsmFidoDeferred) {
      actions.push("Enroll physical HSM/FIDO2 after hardware arrives; keep panel refs write-only until then.");
    }
    return actions;
  }

  #normalizeStreamingTemplate(value) {
    return this.#normalizeWorkloadTemplate(value);
  }

  #normalizeWorkloadTemplate(value) {
    const key = String(value || "").trim().toLowerCase();
    const normalized = key === "duckduckgo" ? "duckduckgo_browser" : key;
    if (!WORKLOAD_CONTROL_APPS.some((app) => app.key === normalized)) {
      throw validationError("Unknown streaming app", {
        app: value,
        supported: WORKLOAD_CONTROL_APPS.map((app) => app.key)
      });
    }
    return normalized;
  }

  #accountBootstrapCatalog() {
    return WORKLOAD_CONTROL_APPS
      .filter((app) => ["messenger", "wallet"].includes(app.category))
      .map((app) => ({
        key: app.key,
        name: app.name,
        category: app.category,
        requiredChecks: this.#accountBootstrapRequiredChecks(app.key),
        defaultMode: this.#defaultBootstrapMode(app.key),
        supportedModes: this.#supportedBootstrapModes(app.key),
        defaultRuntimeMode: this.#defaultBootstrapRuntime(app.key),
        requiresAdminQaReview: true,
        terminalDataStored: false,
        cdrRequired: true,
        productionExecutionAllowed: false
      }));
  }

  #accountBootstrapRequiredChecks(appKey) {
    if (appKey === "exodus") return ["uiVisible", "walletWorkflow", "riskAcceptance"];
    return ["uiVisible", "accountBootstrap", "sendReceive"];
  }

  #defaultBootstrapMode(appKey) {
    if (appKey === "zangi") return "android_native_workload";
    if (appKey === "signal" || appKey === "whatsapp") return "physical_mobile_companion";
    if (appKey === "exodus") return "manual_operator_account";
    return "approved_test_number_provider";
  }

  #defaultBootstrapRuntime(appKey) {
    if (appKey === "zangi") return "android_native";
    if (appKey === "signal") return "desktop";
    if (appKey === "exodus") return "desktop";
    return "web";
  }

  #supportedBootstrapModes(appKey) {
    if (appKey === "zangi") return ["android_native_workload", "approved_test_number_provider"];
    if (appKey === "signal" || appKey === "whatsapp") return ["physical_mobile_companion", "android_native_workload"];
    if (appKey === "exodus") return ["manual_operator_account"];
    return ["approved_test_number_provider", "desktop_linked_account", "android_native_workload"];
  }

  #normalizeBootstrapMode(value) {
    const mode = String(value || "").trim();
    if (!ACCOUNT_BOOTSTRAP_MODES.has(mode)) {
      throw validationError("Unsupported account bootstrap mode", {
        mode,
        supported: [...ACCOUNT_BOOTSTRAP_MODES]
      });
    }
    return mode;
  }

  #normalizeBootstrapRuntime(value) {
    const mode = String(value || "").trim();
    if (!["desktop", "web", "android_native", "firecracker_gui", "container", "unknown"].includes(mode)) {
      throw validationError("Unsupported account bootstrap runtime mode", { mode });
    }
    return mode;
  }

  #normalizeBootstrapResult(value) {
    const result = String(value || "").trim();
    if (!ACCOUNT_BOOTSTRAP_RESULTS.has(result)) {
      throw validationError("Unsupported account bootstrap result", {
        result,
        supported: [...ACCOUNT_BOOTSTRAP_RESULTS]
      });
    }
    return result;
  }

  #normalizeBootstrapChecks(requiredChecks, checks) {
    if (!checks || typeof checks !== "object" || Array.isArray(checks)) {
      throw validationError("Account bootstrap checks must be an object", { field: "checks" });
    }
    const keys = [...new Set([...requiredChecks, ...Object.keys(checks)])];
    return Object.fromEntries(keys.map((key) => {
      const input = checks[key] || {};
      const asObject = typeof input === "string" ? { status: input } : input;
      const status = String(asObject.status || "not_run").trim();
      if (!ACCOUNT_BOOTSTRAP_CHECK_STATUSES.has(status)) {
        throw validationError("Unsupported account bootstrap check status", {
          check: key,
          status,
          supported: [...ACCOUNT_BOOTSTRAP_CHECK_STATUSES]
        });
      }
      return [key, {
        status,
        evidence: asObject.evidence ? String(asObject.evidence).trim().slice(0, 240) : null,
        mode: asObject.mode ? String(asObject.mode).trim().slice(0, 96) : null,
        note: asObject.note ? String(asObject.note).trim().slice(0, 240) : null
      }];
    }));
  }

  #assertNoBootstrapSecrets(value, path = []) {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      const currentPath = [...path, key];
      if (BOOTSTRAP_SECRET_FIELD_PATTERN.test(key)) {
        throw validationError("Account bootstrap must not store phone numbers, OTPs, passwords, seeds or token material", {
          field: currentPath.join("."),
          allowed: "Use provider refs, artifact refs and pass/fail evidence only."
        });
      }
      if (nested && typeof nested === "object") this.#assertNoBootstrapSecrets(nested, currentPath);
    }
  }

  #safeBootstrapArray(value, field) {
    if (!Array.isArray(value)) throw validationError(`${field} must be an array`, { field });
    return value.map((item, index) => String(item || "").trim().slice(0, 200) || `empty_${index}`);
  }

  #publicAccountBootstrapSession(session) {
    return {
      id: session.id,
      operatorId: session.operatorId,
      tenantId: session.tenantId,
      terminalMode: session.terminalMode,
      appKey: session.appKey,
      appName: session.appName,
      mode: session.mode,
      runtimeMode: session.runtimeMode,
      state: session.state,
      requiredChecks: session.requiredChecks,
      checks: session.checks,
      blockers: session.blockers || [],
      routeStatus: session.routeStatus,
      runtimeGate: session.runtimeGate,
      launchUrl: session.launchUrl,
      approvedPhoneProviderRef: session.approvedPhoneProviderRef,
      evidencePolicy: session.evidencePolicy,
      evidenceArtifactIds: session.evidenceArtifactIds || [],
      latencyMs: session.latencyMs ?? null,
      note: session.note || null,
      factualCandidate: session.factualCandidate === true,
      adminQaReviewRequired: session.adminQaReviewRequired !== false,
      promotedFactualTestId: session.promotedFactualTestId || null,
      reviewedBy: session.reviewedBy || null,
      reviewedAt: session.reviewedAt || null,
      terminalDataStored: false,
      cdrRequired: true,
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt || null
    };
  }

  #appDefinition(templateKey) {
    const normalized = this.#normalizeWorkloadTemplate(templateKey);
    return WORKLOAD_CONTROL_APPS.find((app) => app.key === normalized);
  }

  #streamHostForTemplate(templateKey) {
    if (templateKey === "duckduckgo_browser") return "duckduckgo.sylion.internal";
    if (templateKey === "matrix_client") return "matrix-client.sylion.internal";
    if (templateKey === "matrix_server") return "matrix-server.sylion.internal";
    return `${templateKey}.sylion.internal`;
  }

  #workloadLaunchUrl(templateKey, host = this.#streamHostForTemplate(templateKey)) {
    if (templateKey === "duckduckgo_browser") return `https://${host}/vnc.html`;
    return `https://${host}/`;
  }

  #workloadRouteStatus(templateKey) {
    const normalized = this.#normalizeWorkloadTemplate(templateKey);
    const envKey = `SYLION_${normalized.toUpperCase().replaceAll("-", "_")}_LIVE_HTTP_STATUS`;
    const rawStatus = this.env?.[envKey] || (normalized === "duckduckgo_browser" ? this.env?.SYLION_DUCKDUCKGO_LIVE_HTTP_STATUS : null);
    const httpStatus = rawStatus ? Number(rawStatus) : null;
    const evidenceReadyKey = `SYLION_${normalized.toUpperCase().replaceAll("-", "_")}_NATIVE_EVIDENCE_READY`;
    const evidenceReady = this.env?.[evidenceReadyKey] === "true"
      || (normalized === "duckduckgo_browser" && this.env?.SYLION_DUCKDUCKGO_NATIVE_EVIDENCE_READY === "true");
    const ready = httpStatus === 200 || evidenceReady;
    const notBuilt = httpStatus === 502 || this.env?.[evidenceReadyKey] === "false";
    return {
      templateKey: normalized,
      host: this.#streamHostForTemplate(normalized),
      launchUrl: this.#workloadLaunchUrl(normalized),
      httpStatus,
      evidenceReady,
      ready,
      state: ready ? "ready" : notBuilt ? "not_built" : "unknown_or_blocked",
      blockers: ready ? [] : [notBuilt ? `${normalized}_native_workload_not_built` : `${normalized}_live_route_not_verified`],
      satisfiedBlockers: ready ? [
        `${normalized}_workload_slot_missing`,
        "g1_g2_workload_path_not_ready",
        "real_firecracker_binary_not_configured",
        "kvm_device_not_verified",
        "firecracker_kernel_image_not_configured",
        `${normalized}_rootfs_image_not_configured`,
        `approved_${normalized}_workload_image_missing`,
        "real_ipsec_profile_required",
        "dns_leak_and_kill_switch_tests_required",
        "human_production_execution_approval_required"
      ] : [],
      privateOnly: true,
      terminalDataStored: false,
      cdrRequired: true,
      productionExecutionAllowed: false
    };
  }

  #latestStreamingReadinessForOperator(operatorId) {
    return [...this.streamingReadinessEvidence.values()]
      .filter((evidence) => evidence.operatorId === operatorId)
      .at(-1) || null;
  }

  #latestStreamingRuntimeManifestForOperator(operatorId) {
    return [...this.streamingRuntimeManifests.values()]
      .filter((manifest) => manifest.operatorId === operatorId)
      .at(-1) || null;
  }

  #selectedSessionBrokerProtocol() {
    return this.#normalizeSessionBrokerProtocol(this.env?.SYLION_G2_SESSION_BROKER || SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES);
  }

  #sessionBrokerCatalog() {
    return {
      requiredLayer: "G2",
      selectedProtocol: this.#selectedSessionBrokerProtocol(),
      candidates: [
        {
          protocol: SESSION_BROKER_PROTOCOLS.GUACAMOLE,
          name: "Apache Guacamole",
          status: this.env?.SYLION_GUACAMOLE_BROKER_READY === "true" ? "candidate_ready" : "poc_required",
          productionCandidate: true,
          labOnly: false,
          strengths: ["mature_vnc_rdp_ssh_broker", "central_policy_point", "audit_metadata_point"]
        },
        {
          protocol: SESSION_BROKER_PROTOCOLS.WEBRTC_SELKIES,
          name: "Selkies/WebRTC",
          status: this.env?.SYLION_SELKIES_GATEWAY_READY === "true" ? "candidate_ready" : "poc_required",
          productionCandidate: true,
          labOnly: false,
          strengths: ["mobile_latency_candidate", "dynamic_resize_candidate", "touch_input_candidate"]
        },
        {
          protocol: SESSION_BROKER_PROTOCOLS.NOVNC_LAB,
          name: "noVNC/websockify",
          status: this.env?.SYLION_NOVNC_LAB_READY === "true" ? "lab_ready" : "lab_adapter_only",
          productionCandidate: false,
          labOnly: true,
          strengths: ["quick_vnc_smoke", "firecracker_gui_lab_bridge"]
        }
      ],
      productionApprovalRequired: true,
      noVncProductionApproved: false
    };
  }

  #normalizeSessionBrokerProtocol(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (raw === "selkies" || raw === "webrtc" || raw === "selkies_webrtc") return SESSION_BROKER_PROTOCOLS.WEBRTC_SELKIES;
    if (raw === "guac" || raw === "apache_guacamole") return SESSION_BROKER_PROTOCOLS.GUACAMOLE;
    if (LAB_SESSION_BROKER_PROTOCOLS.has(raw)) return SESSION_BROKER_PROTOCOLS.NOVNC_LAB;
    if (PRODUCTION_SESSION_BROKER_PROTOCOLS.has(raw)) return raw;
    return SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES;
  }

  #sessionBrokerPolicy({ protocol = null, readiness = null, runtimeManifest = null } = {}) {
    const selected = this.#normalizeSessionBrokerProtocol(protocol || this.#selectedSessionBrokerProtocol());
    const labOnly = selected === SESSION_BROKER_PROTOCOLS.NOVNC_LAB;
    const guacamoleReady = this.env?.SYLION_GUACAMOLE_BROKER_READY === "true"
      || (readiness?.ready === true && readiness?.gateway?.protocol === SESSION_BROKER_PROTOCOLS.GUACAMOLE)
      || (runtimeManifest?.ready === true && runtimeManifest?.gateway?.protocol === SESSION_BROKER_PROTOCOLS.GUACAMOLE);
    const webrtcReady = this.env?.SYLION_SELKIES_GATEWAY_READY === "true"
      || this.env?.SYLION_G2_STREAM_GATEWAY_READY === "true"
      || (readiness?.ready === true && readiness?.gateway?.protocol === SESSION_BROKER_PROTOCOLS.WEBRTC_SELKIES)
      || (readiness?.ready === true && readiness?.gateway?.protocol === SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES)
      || (runtimeManifest?.ready === true && runtimeManifest?.gateway?.protocol === SESSION_BROKER_PROTOCOLS.WEBRTC_SELKIES)
      || (runtimeManifest?.ready === true && runtimeManifest?.gateway?.protocol === SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES);
    const gatewayReady = selected === SESSION_BROKER_PROTOCOLS.GUACAMOLE
      ? guacamoleReady
      : selected === SESSION_BROKER_PROTOCOLS.WEBRTC_SELKIES || selected === SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES
        ? webrtcReady
        : false;
    const blockers = [
      ...(labOnly ? ["novnc_lab_only_not_approved_for_production_broker"] : []),
      ...(selected === SESSION_BROKER_PROTOCOLS.GUACAMOLE && !guacamoleReady ? ["guacamole_broker_poc_not_ready"] : []),
      ...((selected === SESSION_BROKER_PROTOCOLS.WEBRTC_SELKIES || selected === SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES) && !webrtcReady
        ? ["webrtc_selkies_broker_poc_not_ready"]
        : [])
    ];
    return {
      protocol: selected,
      requiredLayer: "G2",
      gatewayReady,
      labOnly,
      productionCandidate: !labOnly,
      productionApproved: false,
      humanGateRequired: true,
      blockers,
      candidates: this.#sessionBrokerCatalog().candidates.map((candidate) => ({
        protocol: candidate.protocol,
        status: candidate.status,
        labOnly: candidate.labOnly,
        productionCandidate: candidate.productionCandidate
      }))
    };
  }

  #streamGatewayReady(readiness, env) {
    if (readiness?.gateway?.g2StreamGatewayReady === true
      && readiness.gateway.publicInternetExposure === false
      && readiness.gateway.tlsInternalOnly === true
      && readiness.gateway.inputProxyReady === true) {
      return true;
    }
    return env.SYLION_G2_STREAM_GATEWAY_READY === "true"
      || env.SYLION_SELKIES_GATEWAY_READY === "true"
      || env.SYLION_GUACAMOLE_BROKER_READY === "true";
  }

  #streamSourceBlockers({ templateKey, env, readiness = null }) {
    const envKey = `SYLION_${templateKey.toUpperCase().replaceAll("-", "_")}_STREAM_SOURCE_READY`;
    const sourceReady = readiness?.sources?.[templateKey] === true || env.SYLION_WORKLOAD_STREAM_SOURCE_READY === "true" || env[envKey] === "true";
    return sourceReady ? [] : [`${templateKey}_stream_source_not_ready`];
  }

  #streamingReadinessBlockers(evidence) {
    const sourceReady = Object.entries(evidence.sources || {}).filter(([, ready]) => ready === true).map(([key]) => key);
    return [
      ...(evidence.gateway.g2StreamGatewayReady ? [] : ["g2_stream_gateway_not_ready"]),
      ...(evidence.gateway.publicInternetExposure ? ["g2_stream_gateway_public_exposure_forbidden"] : []),
      ...(evidence.gateway.tlsInternalOnly ? [] : ["g2_stream_gateway_internal_tls_required"]),
      ...(evidence.gateway.inputProxyReady ? [] : ["g2_input_proxy_not_ready"]),
      ...(evidence.broker?.blockers || []),
      ...(sourceReady.length ? [] : ["at_least_one_workload_stream_source_required"])
    ];
  }

  #streamingRuntimeManifestBlockers(manifest) {
    const sourceEntries = Object.entries(manifest.sources || {});
    return [
      ...(this.#privateBindAllowed(manifest.gateway.bindAddress) ? [] : ["g2_gateway_private_bind_required"]),
      ...(manifest.gateway.publicInternetExposure ? ["g2_gateway_public_exposure_forbidden"] : []),
      ...(manifest.gateway.tlsMode === "internal_tls_only" ? [] : ["g2_gateway_internal_tls_required"]),
      ...(manifest.broker?.blockers || []),
      ...(sourceEntries.length ? [] : ["at_least_one_stream_source_manifest_required"]),
      ...sourceEntries.flatMap(([key, source]) => [
        ...(this.#privateBindAllowed(source.bindAddress) ? [] : [`${key}_source_private_bind_required`]),
        ...(source.cdrRequired ? [] : [`${key}_source_cdr_required`]),
        ...(source.terminalDataStored === false ? [] : [`${key}_terminal_data_storage_forbidden`])
      ])
    ];
  }

  #privateBindAllowed(address) {
    const value = String(address || "").trim();
    if (value === "localhost" || value === "127.0.0.1") return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(value)) return true;
    const match = value.match(/^172\.(\d{1,2})\.\d{1,3}\.\d{1,3}$/);
    if (match) {
      const second = Number(match[1]);
      return second >= 16 && second <= 31;
    }
    return false;
  }

  #publicStreamingRuntimeManifest(manifest) {
    return {
      id: manifest.id,
      operatorId: manifest.operatorId,
      terminalMode: manifest.terminalMode,
      deviceId: manifest.deviceId,
      gateway: manifest.gateway,
      broker: manifest.broker,
      sources: manifest.sources,
      healthChecks: manifest.healthChecks,
      guardrails: manifest.guardrails,
      ready: manifest.ready,
      blockers: manifest.blockers,
      createdAt: manifest.createdAt,
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  #publicStreamingReadiness(evidence) {
    return {
      id: evidence.id,
      operatorId: evidence.operatorId,
      terminalMode: evidence.terminalMode,
      deviceId: evidence.deviceId,
      gateway: evidence.gateway,
      broker: evidence.broker,
      sources: evidence.sources,
      ready: evidence.ready,
      blockers: evidence.blockers,
      observedAt: evidence.observedAt,
      contentInspected: false,
      terminalDataStored: false,
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  #publicStreamingSession(session) {
    return {
      id: session.id,
      operatorId: session.operatorId,
      tenantId: session.tenantId,
      terminalMode: session.terminalMode,
      deviceId: session.deviceId,
      templateKey: session.templateKey,
      appName: session.appName,
      state: session.state,
      launchUrl: session.launchUrl,
      gateway: session.gateway,
      source: session.source,
      stream: session.stream,
      security: session.security,
      blockers: session.blockers,
      warnings: session.warnings,
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      createdAt: session.createdAt
    };
  }

  #workloadExecutionPlan({ action, rotateApp, desiredCounts, operatorId }) {
    const totalRequested = Object.values(desiredCounts).reduce((sum, value) => sum + value, 0);
    const destructive = action !== "scale_to_counts";
    const nativeFirecracker = this.#nativeFirecrackerRunnerEnabled();
    const mappedRunnerApp = LIVE_RECREATE_APP_MAP[rotateApp] || "unsupported";
    const supportedByLiveRunner = destructive && (nativeFirecracker
      ? action === "rotate_app" && NATIVE_FIRECRACKER_RECREATE_APPS.has(mappedRunnerApp)
      : action === "recreate_all" || Boolean(LIVE_RECREATE_APP_MAP[rotateApp]));
    return {
      mode: action,
      targetApp: rotateApp,
      totalRequested,
      runner: destructive
        ? nativeFirecracker ? "native_firecracker_gui_runner_pending_gate" : "workload_recreate_runner_pending_gate"
        : "workload_count_reconcile_runner_pending_gate",
      stages: [
        "quota_check_passed",
        "operator_audit_recorded",
        "cdr_policy_attached",
        "panic_policy_checked",
        destructive ? "delete_recreate_plan_queued" : "desired_count_plan_queued"
      ],
      cdr: {
        required: true,
        restoreRequiresCleanDecision: true,
        fileIngressEgressBlockedWithoutDecision: true
      },
      panicPolicy: {
        checked: true,
        destructiveActionRequiresSessionUnlock: true
      },
      liveRunner: destructive ? {
        command: action === "rotate_app"
          ? nativeFirecracker
            ? `SYLION_GUI_APP=${mappedRunnerApp} node scripts/launch-native-firecracker-gui-workload.mjs --apply`
            : `npm run live:workload-recreate -- --app=${mappedRunnerApp}`
          : nativeFirecracker ? "unsupported_in_native_firecracker_mode" : "npm run live:workload-recreate -- --app=all",
        wipeVolumeDefault: false,
        wipeVolumeRequiresPanicOrFourEyes: true,
        signalAuthHandoffRequired: action === "recreate_all" || rotateApp === "signal",
        backendEndpoint: "/operator-api/workload-control/requests/:id/execute",
        confirmationPhrase: "RUN_LIVE_WORKLOAD_RECREATE",
        supportedByLiveRunner,
        expectedEvidence: [
          nativeFirecracker ? "native_firecracker_gui_workload" : "live_workload_recreate",
          "cdrRequired=true",
          "terminalDataStored=false",
          "privateBindOnly=true",
          "signalStatus=200 when signal is recreated"
        ]
      } : null,
      targetRefs: destructive
        ? [`workload-slot://${operatorId}/${action === "rotate_app" ? rotateApp : "all"}`]
        : Object.entries(desiredCounts).filter(([, count]) => count > 0).map(([app, count]) => `workload-desired://${operatorId}/${app}/${count}`),
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  #nativeFirecrackerRunnerEnabled() {
    return this.env?.SYLION_OPERATOR_LIVE_WORKLOAD_RUNNER_MODE === "native_firecracker";
  }

  #sessionHoursForOperator(operatorId, tier) {
    const policy = this.unlockPolicies.get(operatorId);
    if (policy?.sessionHours) return this.#normalizeSessionHours(policy.sessionHours, this.#tierSessionMax(tier));
    return Math.min(12, this.#tierSessionMax(tier));
  }

  #tierSessionMax(tier) {
    if (tier === TIERS.SOVEREIGN) return 24;
    if (tier === TIERS.PRO) return 12;
    return 8;
  }

  #normalizeSessionHours(value, maxHours) {
    const hours = value === undefined || value === null || value === "" ? Math.min(12, maxHours) : Number(value);
    if (!Number.isInteger(hours) || hours < 1 || hours > maxHours) {
      throw validationError("Session duration exceeds tier policy", {
        sessionHours: value,
        min: 1,
        max: maxHours
      });
    }
    return hours;
  }

  #normalizeInteger(value, field, min, max, fallback) {
    const number = value === undefined || value === null || value === "" ? fallback : Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
      throw validationError(`${field} must be between ${min} and ${max}`, { field, value, min, max });
    }
    return number;
  }

  #unlockPolicyForOperator(operatorId, tier) {
    const existing = this.unlockPolicies.get(operatorId);
    if (existing) return existing;
    const now = isoNow();
    return {
      id: `unlock_${operatorId}`,
      operatorId,
      sessionHours: Math.min(12, this.#tierSessionMax(tier)),
      sessionExpiresAfterHours: Math.min(12, this.#tierSessionMax(tier)),
      layers: Object.fromEntries(UNLOCK_LAYERS.map((layer) => [layer, {
        layer,
        passwordSet: false,
        passwordVerifierRef: null,
        rotatedAt: null,
        passwordMaterialStored: false
      }])),
      fido2: {
        requiredAtSessionEnd: true,
        deferred: true,
        reauthWindowMinutes: 15
      },
      unlockDuringActiveSession: true,
      createdAt: now,
      updatedAt: now,
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  #assertWriteOnlyPassphrase(value, layer) {
    const text = String(value || "");
    if (text.length < 8) {
      throw validationError("Layer passphrase must have at least 8 characters", { layer });
    }
    if (text.length > 256) {
      throw validationError("Layer passphrase is too long", { layer, maxLength: 256 });
    }
  }

  #publicUnlockPolicy(policy) {
    return {
      id: policy.id,
      operatorId: policy.operatorId,
      sessionHours: policy.sessionHours,
      sessionExpiresAfterHours: policy.sessionExpiresAfterHours,
      maxSessionHoursByTier: this.#tierSessionMax(this.#requireOperator(policy.operatorId).tier),
      layers: Object.fromEntries(UNLOCK_LAYERS.map((layer) => {
        const entry = policy.layers[layer];
        return [layer, {
          layer,
          passwordSet: entry?.passwordSet === true,
          passwordVerifierRef: entry?.passwordVerifierRef || null,
          rotatedAt: entry?.rotatedAt || null,
          passwordMaterialStored: false
        }];
      })),
      fido2: policy.fido2,
      unlockDuringActiveSession: true,
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      updatedAt: policy.updatedAt
    };
  }

  #safetyPolicyForOperator(operatorId) {
    const existing = this.safetyPolicies.get(operatorId);
    if (existing) return existing;
    const now = isoNow();
    return {
      id: `safety_${operatorId}`,
      operatorId,
      backup: {
        enabled: false,
        scope: "configuration_and_metadata_only",
        cadenceHours: 24,
        workloadDataIncluded: false,
        cdrRequiredForRestore: true
      },
      inactivityWipe: {
        enabled: true,
        afterDays: 14,
        lastSessionAt: this.#latestSessionForOperator(operatorId)?.createdAt || null,
        state: "armed_control_plane"
      },
      panicCodes: Object.fromEntries(PANIC_LEVELS.map((level) => [level, {
        level,
        codeSet: false,
        verifierRef: null,
        rotatedAt: null,
        codeMaterialStored: false
      }])),
      createdAt: now,
      updatedAt: now,
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  #publicSafetyPolicy(policy) {
    return {
      id: policy.id,
      operatorId: policy.operatorId,
      backup: policy.backup,
      inactivityWipe: policy.inactivityWipe,
      panicCodes: Object.fromEntries(PANIC_LEVELS.map((level) => {
        const entry = policy.panicCodes[level];
        return [level, {
          level,
          codeSet: entry?.codeSet === true,
          verifierRef: entry?.verifierRef || null,
          rotatedAt: entry?.rotatedAt || null,
          codeMaterialStored: false
        }];
      })),
      destructiveExecutionAllowed: false,
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      updatedAt: policy.updatedAt
    };
  }

  #latestSessionForOperator(operatorId) {
    return [...this.sessions.values()]
      .filter((session) => session.operatorId === operatorId)
      .at(-1) || null;
  }

  #jurisdictionPolicyForOperator({ operatorActor, correlationId }) {
    const existing = this.jurisdictionPolicies.get(operatorActor.operatorId);
    if (existing) return existing;
    const subscription = this.subscription({ operatorActor, correlationId });
    return {
      id: `jurisdiction_${operatorActor.operatorId}`,
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      mode: "disabled",
      regions: [],
      countries: [],
      providers: [],
      frequencyHours: subscription.quota.jurisdictionPolicy?.minFrequencyHours || 168,
      rotationScopes: [],
      subscriptionMode: subscription.quota.jurisdictionRotationMode,
      state: "not_configured",
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      updatedAt: isoNow()
    };
  }

  #assertJurisdictionModeAllowed(mode, subscriptionMode) {
    const allowed = subscriptionMode === "full_policy"
      ? ["disabled", "manual", "scheduled", "full_policy"]
      : subscriptionMode === "scheduled"
        ? ["disabled", "manual", "scheduled"]
        : ["disabled", "manual"];
    if (!allowed.includes(mode)) {
      throw validationError("Jurisdiction mode is not available in this subscription tier", {
        mode,
        subscriptionMode,
        allowed
      });
    }
  }

  #normalizeJurisdictionFrequency(value, quota) {
    const min = Number(quota.jurisdictionPolicy?.minFrequencyHours || 168);
    const frequencyHours = value === undefined || value === null || value === "" ? min : Number(value);
    if (!Number.isInteger(frequencyHours) || frequencyHours < min || frequencyHours > 8760) {
      throw validationError("Jurisdiction rotation frequency is outside subscription tier policy", {
        frequencyHours: value,
        minFrequencyHours: min,
        maxFrequencyHours: 8760
      });
    }
    return frequencyHours;
  }

  #rotationScopesForJurisdictionMode(mode, quota) {
    if (mode === "disabled") return [];
    if (mode === "manual") return ["session", "ip_route", "region"];
    if (mode === "scheduled") return quota.jurisdictionPolicy?.providerRotationAllowed
      ? ["session", "ip_route", "region", "provider", "workload_vps"]
      : ["session", "ip_route", "region"];
    return quota.jurisdictionPolicy?.allVpsRotationAllowed
      ? ["session", "ip_route", "region", "provider", "workload_vps", "g1", "g2", "all_3_vps", "certificates"]
      : ["session", "ip_route", "region", "provider", "workload_vps"];
  }

  #publicJurisdictionPolicy(policy) {
    return {
      id: policy.id,
      operatorId: policy.operatorId,
      tenantId: policy.tenantId,
      mode: policy.mode,
      regions: policy.regions,
      countries: policy.countries || [],
      providers: policy.providers || [],
      frequencyHours: policy.frequencyHours || null,
      rotationScopes: policy.rotationScopes || [],
      subscriptionMode: policy.subscriptionMode,
      state: policy.state,
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      updatedAt: policy.updatedAt
    };
  }

  #androidRuntimeSubstrate() {
    const env = this.env || {};
    const manifest = this.workloadImageManifestResolver?.("zangi") || null;
    const checkStatus = (key) => manifest?.checks?.find((check) => check.key === key)?.status;
    const androidImageRef = env.SYLION_ANDROID_WORKLOAD_IMAGE_REF || manifest?.imageRef || null;
    const zangiApkRef = env.SYLION_ZANGI_APK_REF || manifest?.packageRef || null;
    const kvmReady = env.SYLION_ANDROID_KVM_READY === "true"
      || env.SYLION_KVM_READY === "true"
      || checkStatus("host_lab_ready") === "passed";
    const binderReady = env.SYLION_ANDROID_BINDER_READY === "true"
      || env.SYLION_ANDROID_BINDERFS_READY === "true"
      || checkStatus("android_binderfs_evidence") === "passed";
    const checks = [
      {
        key: "kvm_device",
        status: kvmReady ? "passed" : "blocked",
        detail: "/dev/kvm must be present on the WORKLOAD host or a dedicated Android runtime host"
      },
      {
        key: "binder_or_binderfs",
        status: binderReady ? "passed" : "blocked",
        detail: "Android workloads require binder/binderfs support"
      },
      {
        key: "approved_android_image",
        status: androidImageRef ? "passed" : "blocked",
        detail: "Android system image must be approved and pinned"
      },
      {
        key: "approved_zangi_apk_ref",
        status: zangiApkRef ? "passed" : "blocked",
        detail: "Zangi APK/source reference must be approved before native launch"
      }
    ];
    const blockers = checks.filter((check) => check.status !== "passed").map((check) => check.key);
    return {
      required: true,
      runtimeClass: "android_workload",
      hostRequirement: "kvm_or_bare_metal_with_binderfs",
      currentProviderFit: blockers.length ? "blocked_on_current_host" : "ready_for_android_runner_review",
      evidenceSource: manifest ? "workload_image_manifest" : "environment_gate",
      manifestId: manifest?.id || null,
      refs: {
        androidImageRef,
        zangiApkRef
      },
      ready: blockers.length === 0,
      checks,
      blockers
    };
  }

  #workloadExecutionForOperator({ operatorId, terminalMode, deviceId, templateKey }) {
    const path = this.#connectionPathForOperator({ operatorId, terminalMode, deviceId });
    const normalizedTemplate = this.#normalizeWorkloadTemplate(templateKey || "signal");
    const appDefinition = this.#appDefinition(normalizedTemplate);
    const slot = path.microVmSlots.find((item) => item.templateKey === normalizedTemplate)
      || path.microVmSlots.find((item) => item.appName?.toLowerCase() === normalizedTemplate);
    const androidRuntimeRequired = ANDROID_WORKLOAD_APPS.has(normalizedTemplate);
    const androidRuntime = this.#androidRuntimeSubstrate();
    const env = this.env || {};
    const runtimeRefs = {
      firecrackerBinary: env.SYLION_FIRECRACKER_BIN || null,
      kernelImageRef: env.SYLION_FIRECRACKER_KERNEL || null,
      rootfsImageRef: env.SYLION_SIGNAL_ROOTFS || null,
      workloadImageRef: env.SYLION_SIGNAL_WORKLOAD_IMAGE_REF || null,
      signalPackageRef: env.SYLION_SIGNAL_PACKAGE_REF || null,
      signalAccountEnrollmentRef: env.SYLION_SIGNAL_ACCOUNT_REF || null,
      androidImageRef: env.SYLION_ANDROID_WORKLOAD_IMAGE_REF || null,
      zangiApkRef: env.SYLION_ZANGI_APK_REF || null,
      cdrPolicyRef: "cdr://mandatory-workload-file-transfer",
      hsmCertificateRef: env.SYLION_OPERATOR_HSM_CERT_REF || null
    };
    const hsmFidoDeferred = env.SYLION_DEFER_PHYSICAL_HSM_FIDO2 === "true";
    const vpnReady = env.SYLION_REAL_IPSEC_READY === "true" || env.SYLION_IPSEC_PROFILE_STATUS === "established";
    const kvmReady = env.SYLION_KVM_READY === "true";
    const firecrackerReady = Boolean(runtimeRefs.firecrackerBinary && runtimeRefs.kernelImageRef && runtimeRefs.rootfsImageRef && kvmReady);
    const cdrReady = true;
    const blockers = [
      ...(slot ? [] : [`${normalizedTemplate}_workload_slot_missing`]),
      ...(path.state === "local_lab_connected" ? [] : ["g1_g2_workload_path_not_ready"]),
      ...(androidRuntimeRequired ? androidRuntime.blockers.map((blocker) => `android_${blocker}_not_ready`) : [
        ...(runtimeRefs.firecrackerBinary ? [] : ["real_firecracker_binary_not_configured"]),
        ...(kvmReady ? [] : ["kvm_device_not_verified"]),
        ...(runtimeRefs.kernelImageRef ? [] : ["firecracker_kernel_image_not_configured"]),
        ...(runtimeRefs.rootfsImageRef ? [] : [`${normalizedTemplate}_rootfs_image_not_configured`]),
        ...(runtimeRefs.workloadImageRef ? [] : [`approved_${normalizedTemplate}_workload_image_missing`])
      ]),
      ...(normalizedTemplate === "signal" && !runtimeRefs.signalPackageRef ? ["signal_application_package_not_bound"] : []),
      ...(normalizedTemplate === "signal" && !runtimeRefs.signalAccountEnrollmentRef ? ["signal_account_enrollment_not_configured"] : []),
      ...(runtimeRefs.hsmCertificateRef || hsmFidoDeferred ? [] : ["hsm_backed_operator_certificate_required"]),
      ...(hsmFidoDeferred ? [] : ["fresh_fido2_operator_unlock_required"]),
      ...(vpnReady ? [] : ["real_ipsec_profile_required"]),
      "dns_leak_and_kill_switch_tests_required",
      "human_production_execution_approval_required"
    ];
    const warnings = [
      "puli_ax_router_physical_gate_temporarily_out_of_scope_for_this_sprint",
      `terminal_remains_thin_client_no_${normalizedTemplate}_data_on_pixel`,
      ...(androidRuntimeRequired ? ["native_zangi_requires_android_workload_not_chromium_download_page"] : []),
      ...(hsmFidoDeferred ? ["physical_hsm_fido2_configuration_deferred_but_visible_in_panels"] : [])
    ];
    const productionFlag = androidRuntimeRequired
      ? env.SYLION_ENABLE_ANDROID_WORKLOAD_PRODUCTION_EXECUTION === "true"
      : env.SYLION_ENABLE_SIGNAL_PRODUCTION_EXECUTION === "true";
    const launchAllowed = productionFlag && blockers.length === 0;
    return {
      operatorId,
      tenantId: path.tenantId,
      templateKey: slot?.templateKey || normalizedTemplate,
      appName: slot?.appName || appDefinition?.name || normalizedTemplate,
      slot: slot || null,
      route: {
        terminalMode,
        nodes: path.nodes.map((node) => ({ id: node.id, role: node.role, label: node.label, status: node.status })),
        segments: path.segments.map((segment) => ({ id: segment.id, from: segment.from, to: segment.to, protocol: segment.protocol, state: segment.state }))
      },
      runtime: {
        kind: androidRuntimeRequired ? "android_workload" : "firecracker_microvm",
        targetVpsRole: "WORKLOAD",
        hostMode: "production_contract",
        runner: androidRuntimeRequired ? "real_android_workload_runner_required" : "real_firecracker_runner_required",
        runtimeRefs,
        substrate: {
          vpn: {
            required: true,
            ready: vpnReady,
            transport: "ipsec_ikev2",
            status: vpnReady ? "established" : "not_established"
          },
          firecrackerKvm: {
            required: true,
            ready: firecrackerReady,
            kvmReady,
            firecrackerBinaryConfigured: Boolean(runtimeRefs.firecrackerBinary),
            kernelConfigured: Boolean(runtimeRefs.kernelImageRef),
            rootfsConfigured: Boolean(runtimeRefs.rootfsImageRef)
          },
          androidRuntime: androidRuntimeRequired ? androidRuntime : { required: false, ready: true, blockers: [] },
          cdr: {
            required: true,
            ready: cdrReady,
            enforcement: "real_control_plane",
            rule: "No file ingress/egress without CDR decision."
          },
          hsmFido2: {
            requiredForFinalProduction: true,
            deferred: hsmFidoDeferred,
            panelConfigurable: true,
            hsmCertificateConfigured: Boolean(runtimeRefs.hsmCertificateRef)
          }
        },
        egressPolicy: slot?.egressPolicy || "via_g2_policy_gateway_only",
        isolation: slot?.isolation || "firecracker_microvm",
        cdrRequired: true,
        terminalDataStored: false
      },
      readinessState: launchAllowed
        ? (androidRuntimeRequired ? "ready_for_android_workload_runner" : "ready_for_firecracker_runner")
        : "blocked_before_execution",
      blockers,
      warnings,
      sideEffectAllowed: launchAllowed,
      productionExecutionAllowed: launchAllowed,
      launchAllowed,
      generatedAt: isoNow()
    };
  }

  #latestReadyEnvironment(operatorId) {
    return this.operatorEnvironments.listForOperatorScoped(operatorId)
      .filter((environment) => environment.status === "environment_ready")
      .at(-1) || null;
  }

  #latestEnvironment(operatorId) {
    return this.operatorEnvironments.listForOperatorScoped(operatorId).at(-1) || null;
  }

  #resourceRef(environment, role, operatorId) {
    return environment?.localProvider?.resources?.find((resource) => resource.role === role)?.providerResourceId || `planned://${operatorId}/${role.toLowerCase()}`;
  }

  #requireOperator(operatorId) {
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    return operator;
  }

  #requireAssignedTerminalDevice({ deviceId, operatorId, terminalMode }) {
    const device = this.devices.get(deviceId);
    if (!device) throw notFound("device", deviceId);
    if (device.assignedOperatorId !== operatorId) {
      throw validationError("Device is not assigned to this operator", { deviceId, operatorId });
    }
    if (device.type !== terminalMode) {
      throw validationError("Device type does not match requested terminal mode", {
        deviceId,
        expected: terminalMode,
        actual: device.type
      });
    }
    return device;
  }
}
