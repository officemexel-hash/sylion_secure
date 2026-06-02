import { execFile, spawn } from "node:child_process";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
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
const BOOTSTRAP_SECRET_VALUE_PATTERN = /(^\s*\d{4,8}\s*$)|(\b(otp|sms|verification|code|kod|has[lł]o|password|seed|mnemonic|private[_ -]?key)\b\s*[:=]?\s*[A-Za-z0-9+/_=-]{4,})|(\b(phone|telefon|numer)\b\s*[:=]\s*\+?\d[\d\s().-]{7,}\d)|(\+?\d[\d\s().-]{7,}\d)/i;
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
const TRAFFIC_MONITOR_SEGMENTS = Object.freeze([
  {
    id: "pixel_router",
    order: 1,
    from: "Pixel/laptop terminal",
    to: "Puli AX router",
    zone: "ZONE_0_TO_ACCESS_ROUTER",
    transport: "local_access_link_with_device_posture",
    expectedControls: ["terminal_no_operational_data", "router_kill_switch", "dns_leak_prevention"]
  },
  {
    id: "router_g1",
    order: 2,
    from: "Puli AX router",
    to: "G1 ingress gateway",
    zone: "ACCESS_ROUTER_TO_G1",
    transport: "ipsec_ikev2_mutual_certificate",
    expectedControls: ["ikev2_sa_established", "terminal_default_route_to_g1_only", "internal_dns_only"]
  },
  {
    id: "g1_g2",
    order: 3,
    from: "G1 ingress gateway",
    to: "G2 access broker",
    zone: "G1_TO_G2",
    transport: "ipsec_ikev2_policy_path",
    expectedControls: ["default_deny_except_g2", "mutual_service_identity", "route_policy_audited"]
  },
  {
    id: "g2_workload",
    order: 4,
    from: "G2 access broker",
    to: "WORKLOAD host",
    zone: "G2_TO_WORKLOAD",
    transport: "ipsec_ikev2_or_private_policy_link",
    expectedControls: ["g2_broker_only", "private_bind_only", "cdr_file_gate"]
  },
  {
    id: "workload_microvm",
    order: 5,
    from: "WORKLOAD host",
    to: "Firecracker/container app environment",
    zone: "WORKLOAD_TO_MICROVM",
    transport: "firecracker_jailer_private_tap_or_vsock",
    expectedControls: ["per_app_isolation", "no_terminal_storage", "cdr_file_gate"]
  }
]);
const TRAFFIC_SEGMENT_IDS = new Set(TRAFFIC_MONITOR_SEGMENTS.map((segment) => segment.id));
const TRAFFIC_STATUSES = new Set(["healthy", "degraded", "blocked", "missing", "observed"]);
const TRAFFIC_FORBIDDEN_FIELD_PATTERN = /(password|secret|token|api[_-]?key|otp|sms|seed|mnemonic|private[_-]?key|payload|message|chat|packet[_-]?capture|pcap|capture[_-]?file|file[_-]?content|wallet[_-]?secret|cookie|body)/i;
const GUACAMOLE_HANDOFF_APPS = new Set([
  "duckduckgo_browser",
  "libreoffice",
  "whatsapp",
  "telegram",
  "threema",
  "signal",
  "zangi",
  "exodus"
]);
const GUACAMOLE_LOCAL_VNC_PORTS = Object.freeze({
  duckduckgo_browser: 15901,
  libreoffice: 15902,
  whatsapp: 15910,
  telegram: 15911,
  threema: 15912,
  signal: 15913,
  zangi: 15916,
  exodus: 15915
});
const WORKLOAD_INPUT_SPECIAL_KEYS = new Set([
  "enter",
  "backspace",
  "delete",
  "tab",
  "escape",
  "arrow_left",
  "arrow_right",
  "arrow_up",
  "arrow_down",
  "home",
  "end",
  "select_all"
]);

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

function publicSessionMetadata(session) {
  const view = publicSession(session);
  delete view.token;
  return view;
}

async function defaultLiveWorkloadRunner({ app, wipeVolume = false }) {
  const nativeFirecracker = process.env.SYLION_OPERATOR_LIVE_WORKLOAD_RUNNER_MODE === "native_firecracker";
  const command = nativeFirecracker ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = nativeFirecracker
    ? ["scripts/launch-native-firecracker-gui-workload.mjs", "--apply", "--require-ready"]
    : ["run", "live:workload-recreate", "--", `--app=${app}`];
  if (!nativeFirecracker && wipeVolume) args.push("--wipe-volume");
  const result = await execFileAsync(command, args, {
    timeout: nativeFirecracker ? 1_800_000 : 240_000,
    windowsHide: true,
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(nativeFirecracker ? {
        SYLION_GUI_APP: app,
        SYLION_GUI_VNC_BACKEND: process.env.SYLION_GUI_VNC_BACKEND || "tigervnc"
      } : {})
    }
  });
  const stdout = result.stdout.trim();
  const json = stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json);
  if (!nativeFirecracker) return parsed;

  const forwardResult = await execFileAsync(process.execPath, ["scripts/install-workload-guacamole-vnc-forwards.mjs", "--apply"], {
    timeout: 420_000,
    windowsHide: true,
    cwd: process.cwd(),
    env: { ...process.env }
  });
  const forwardStdout = forwardResult.stdout.trim();
  const forwardJson = forwardStdout.slice(forwardStdout.indexOf("{"), forwardStdout.lastIndexOf("}") + 1);
  const forwards = JSON.parse(forwardJson);
  const forwardKey = app === "duckduckgo" ? "duckduckgo_browser" : app;
  const workloadForward = (forwards.workloadEvidence?.forwards || []).find((item) => item.key === forwardKey);
  const g2Forward = (forwards.g2Verification?.results || []).find((item) => item.key === forwardKey);
  return {
    applied: parsed.readyThroughG2 === true && workloadForward?.bindReady === true && g2Forward?.reachable === true,
    app,
    mode: "native_firecracker",
    evidence: parsed.evidence,
    g2: parsed.g2,
    guacamoleVncForward: workloadForward ? {
      key: workloadForward.key,
      bindReady: workloadForward.bindReady === true,
      targetReachable: workloadForward.targetReachable === true,
      transport: workloadForward.g2ToWorkloadTransport,
      publicInternetExposure: workloadForward.publicInternetExposure === true,
      blocker: workloadForward.blocker || null
    } : null,
    g2VncVerification: g2Forward ? {
      key: g2Forward.key,
      reachable: g2Forward.reachable === true,
      transport: g2Forward.transport,
      rfbBannerReady: /^RFB/.test(String(g2Forward.rfbBanner || ""))
    } : null,
    forwardBlockers: forwards.workloadEvidence?.blockers || forwards.g2Verification?.blockers || [],
    secretPrinted: false,
    productionExecutionAllowed: false
  };
}

async function defaultLiveWorkloadStatusProvider({ env = process.env } = {}) {
  const result = await execFileAsync(process.execPath, ["scripts/live-workload-status-snapshot.mjs"], {
    timeout: Number(env.SYLION_LIVE_WORKLOAD_STATUS_TIMEOUT_MS || 60_000),
    windowsHide: true,
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
    maxBuffer: 4 * 1024 * 1024
  });
  const stdout = result.stdout.trim();
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("live_workload_status_json_not_found");
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

function spawnJsonWithStdin(command, args, { input, timeout, env, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("workload_input_bridge_timeout"));
        return;
      }
      if (code !== 0) {
        const error = new Error("workload_input_bridge_failed");
        error.code = code;
        error.stderr = stderr.trim().slice(0, 400);
        reject(error);
        return;
      }
      const start = stdout.indexOf("{");
      const end = stdout.lastIndexOf("}");
      if (start < 0 || end < start) {
        reject(new Error("workload_input_bridge_json_not_found"));
        return;
      }
      try {
        resolve(JSON.parse(stdout.slice(start, end + 1)));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(input);
  });
}

async function defaultWorkloadInputRunner({ app, text, submit = false, preKeys = [], postKeys = [], env = process.env }) {
  return spawnJsonWithStdin(process.execPath, ["scripts/workload-input-bridge.mjs", `--app=${app}`], {
    input: JSON.stringify({ text, submit, preKeys, postKeys }),
    timeout: Number(env.SYLION_WORKLOAD_INPUT_TIMEOUT_MS || 30_000),
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    }
  });
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
    providers = null,
    env = process.env,
    store = null,
    liveWorkloadRunner = defaultLiveWorkloadRunner,
    liveWorkloadStatusProvider = defaultLiveWorkloadStatusProvider,
    workloadInputRunner = defaultWorkloadInputRunner,
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
    this.providers = providers;
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
    this.trafficEvidence = new PersistentMap({ store, collection: "operator_traffic_monitoring_evidence" });
    this.workloadControlJobs = new PersistentMap({ store, collection: "operator_workload_control_jobs" });
    this.accountBootstrapSessions = new PersistentMap({ store, collection: "operator_account_bootstrap_sessions" });
    this.liveWorkloadRunner = liveWorkloadRunner;
    this.liveWorkloadStatusProvider = liveWorkloadStatusProvider;
    this.workloadInputRunner = workloadInputRunner;
    this.liveWorkloadStatusCache = null;
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

  sessionFromToken(token, { includeToken = false } = {}) {
    this.actorFromToken(token);
    const session = this.sessions.get(token);
    return includeToken ? publicSession(session) : publicSessionMetadata(session);
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

  async liveWorkloadStatus({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const cacheTtlMs = Number(this.env?.SYLION_LIVE_WORKLOAD_STATUS_CACHE_MS || 20_000);
    const now = Date.now();
    if (this.liveWorkloadStatusCache && now - this.liveWorkloadStatusCache.loadedAt < cacheTtlMs) {
      return {
        ...this.liveWorkloadStatusCache.snapshot,
        operatorId: operatorActor.operatorId,
        tenantId: operatorActor.tenantId,
        cached: true
      };
    }
    try {
      const snapshot = this.#publicLiveWorkloadStatus(await this.liveWorkloadStatusProvider({ env: this.env }));
      this.liveWorkloadStatusCache = { loadedAt: now, snapshot };
      return {
        ...snapshot,
        operatorId: operatorActor.operatorId,
        tenantId: operatorActor.tenantId,
        cached: false
      };
    } catch (error) {
      return {
        generatedAt: isoNow(),
        source: "real_g2_and_ax102_metadata_probe",
        state: "status_probe_failed",
        operatorId: operatorActor.operatorId,
        tenantId: operatorActor.tenantId,
        cached: false,
        error: error.message,
        apps: [],
        summary: {
          totalApps: 0,
          transportReady: 0,
          workloadUiReady: 0,
          functionalReady: 0,
          accountTestRequired: [],
          blocked: WORKLOAD_CONTROL_APPS
            .filter((app) => ["whatsapp", "signal", "telegram", "threema", "zangi", "duckduckgo_browser", "libreoffice", "exodus"].includes(app.key))
            .map((app) => app.key),
          productionExecutionAllowed: false
        },
        safety: {
          contentInspected: false,
          messageContentStored: false,
          walletDataStored: false,
          terminalDataStored: false,
          cdrRequired: true,
          secretsPrinted: false
        }
      };
    }
  }

  workloadControlEvidenceSummary({ operatorIds = [] } = {}) {
    const operatorSet = new Set(operatorIds.filter(Boolean));
    const includesOperator = (item) => operatorSet.size === 0 || operatorSet.has(item.operatorId);
    const requests = [...this.workloadControlRequests.values()].filter(includesOperator);
    const jobs = [...this.workloadControlJobs.values()].filter(includesOperator);
    const completedLiveRecreate = jobs.filter((job) => {
      const publicJob = this.#publicWorkloadControlJob(job);
      const result = job.result || {};
      const nativeReady = result.nativeFirecracker?.readyThroughG2 === true
        || result.applied === true
        || result.workloadEvidence?.privateBindOnly === true;
      return publicJob.state === "completed_live_workload_recreate"
        && publicJob.cdrRequired === true
        && publicJob.terminalDataStored === false
        && publicJob.privateBindOnlyRequired === true
        && nativeReady;
    });
    const blockedBeforeRunner = jobs.filter((job) => job.state === "blocked_before_live_runner");
    const failedLiveRecreate = jobs.filter((job) => job.state === "failed_live_workload_recreate");
    const destructiveRequests = requests.filter((request) => request.action === "rotate_app" || request.action === "recreate_all");
    const ready = completedLiveRecreate.length > 0 && blockedBeforeRunner.length > 0 && failedLiveRecreate.length === 0;
    return {
      requests: requests.length,
      destructiveRequests: destructiveRequests.length,
      jobs: jobs.length,
      completedLiveRecreate: completedLiveRecreate.length,
      blockedBeforeRunner: blockedBeforeRunner.length,
      failedLiveRecreate: failedLiveRecreate.length,
      cdrRequiredObserved: completedLiveRecreate.some((job) => job.cdrRequired === true),
      terminalDataStoredFalseObserved: completedLiveRecreate.some((job) => job.terminalDataStored === false),
      privateBindOnlyObserved: completedLiveRecreate.some((job) => job.privateBindOnlyRequired === true),
      ready,
      productionExecutionAllowed: false
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

  trafficMonitoring({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const path = this.#connectionPathForOperator({
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId
    });
    const vpnEvidence = this.#latestVpnEvidenceForOperator(operatorActor.operatorId);
    const streamingReadiness = this.#latestStreamingReadinessForOperator(operatorActor.operatorId);
    const streamingRuntime = this.#latestStreamingRuntimeManifestForOperator(operatorActor.operatorId);
    const latestEvidence = this.#latestTrafficEvidenceBySegment(operatorActor.operatorId);
    const segments = TRAFFIC_MONITOR_SEGMENTS.map((definition) => this.#trafficSegmentView({
      definition,
      operatorActor,
      path,
      vpnEvidence,
      streamingReadiness,
      streamingRuntime,
      evidence: latestEvidence.get(definition.id) || null
    }));
    const alerts = this.#trafficAlerts({
      segments,
      path,
      vpnEvidence,
      streamingReadiness,
      streamingRuntime
    });
    const summary = {
      segments: segments.length,
      healthy: segments.filter((segment) => segment.status === "healthy").length,
      degraded: segments.filter((segment) => segment.status === "degraded").length,
      blocked: segments.filter((segment) => segment.status === "blocked").length,
      missing: segments.filter((segment) => segment.status === "missing").length,
      alerts: alerts.length,
      state: segments.every((segment) => segment.status === "healthy")
        ? "blue_team_path_healthy"
        : segments.some((segment) => segment.status === "blocked")
          ? "blue_team_path_blocked"
          : "blue_team_path_degraded",
      productionExecutionAllowed: false
    };
    return {
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      terminalMode: operatorActor.terminalMode,
      mode: "metadata_only_blue_team_monitoring",
      route: ["Pixel/laptop", "Puli AX", "G1", "G2", "WORKLOAD", "microVM/container"],
      summary,
      segments,
      alerts,
      guardrails: {
        metadataOnly: true,
        contentInspected: false,
        packetCaptureStored: false,
        messageContentStored: false,
        terminalDataStored: false,
        noTerminalOperationalData: true,
        g1G2BypassAllowed: false,
        baselineTransport: "ipsec_ikev2",
        cdrRequiredForFiles: true,
        routerPhysicalGateDeferred: path.router?.readyForPhysicalSmoke !== true,
        hsmFido2PhysicalGateDeferred: this.env?.SYLION_DEFER_PHYSICAL_HSM_FIDO2 === "true"
      },
      evidence: {
        vpnEvidenceId: vpnEvidence?.id || null,
        streamingReadinessId: streamingReadiness?.id || null,
        streamingRuntimeManifestId: streamingRuntime?.id || null,
        trafficEvidenceIds: [...latestEvidence.values()].map((evidence) => evidence.id)
      },
      generatedAt: isoNow(),
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  terminalAttributionRisk({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const path = this.#connectionPathForOperator({
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId
    });
    const vpnEvidence = this.#latestVpnEvidenceForOperator(operatorActor.operatorId);
    const streamingReadiness = this.#latestStreamingReadinessForOperator(operatorActor.operatorId);
    const streamingRuntime = this.#latestStreamingRuntimeManifestForOperator(operatorActor.operatorId);
    const latestTrafficEvidence = this.#latestTrafficEvidenceBySegment(operatorActor.operatorId);
    const trafficById = Object.fromEntries(TRAFFIC_MONITOR_SEGMENTS.map((definition) => {
      const view = this.#trafficSegmentView({
        definition,
        operatorActor,
        path,
        vpnEvidence,
        streamingReadiness,
        streamingRuntime,
        evidence: latestTrafficEvidence.get(definition.id) || null
      });
      return [definition.id, view];
    }));
    const publicStreamExposure = streamingReadiness?.gateway?.publicInternetExposure === true
      || streamingRuntime?.gateway?.publicInternetExposure === true;
    const workloadDnsLeakTestPassed = this.env?.SYLION_WORKLOAD_DNS_LEAK_TEST_PASSED === "true";
    const controls = [
      this.#terminalAttributionControl({
        id: "thin_client_invariant",
        label: "Terminal stores no operational data",
        passed: path.terminalOperationalDataStored === false,
        blockers: ["terminal_operational_data_storage_forbidden"],
        requiredEvidence: ["connection_path.terminalOperationalDataStored=false"]
      }),
      this.#terminalAttributionControl({
        id: "g1_g2_workload_path",
        label: "Terminal traffic stays behind G1/G2 before workload",
        passed: trafficById.g1_g2?.status === "healthy" && trafficById.g2_workload?.status === "healthy",
        blockers: [
          ...(trafficById.g1_g2?.status === "healthy" ? [] : ["g1_g2_policy_path_not_healthy"]),
          ...(trafficById.g2_workload?.status === "healthy" ? [] : ["g2_workload_private_path_not_healthy"])
        ],
        requiredEvidence: ["operator traffic monitor g1_g2=healthy", "operator traffic monitor g2_workload=healthy"]
      }),
      this.#terminalAttributionControl({
        id: "matrix_source_ip_canary",
        label: "Matrix server observes workload egress only",
        passed: this.env?.SYLION_MATRIX_CANARY_SOURCE_IP_EVIDENCED === "true",
        blockers: ["matrix_canary_source_ip_probe_required"],
        requiredEvidence: ["external Matrix/HTTP canary source-IP probe from the workload microVM"]
      }),
      this.#terminalAttributionControl({
        id: "forwarded_headers_stripped",
        label: "No proxy header carries terminal or private-hop IP",
        passed: this.env?.SYLION_MATRIX_X_FORWARDED_FOR_STRIPPED === "true",
        blockers: ["x_forwarded_for_strip_evidence_required"],
        requiredEvidence: ["canary headers show no X-Forwarded-For/X-Real-IP terminal value"]
      }),
      this.#terminalAttributionControl({
        id: "stream_private_exposure",
        label: "Workload stream is private and not Internet-bound",
        passed: publicStreamExposure === false && (
          streamingReadiness?.ready === true
          || streamingRuntime?.ready === true
          || this.env?.SYLION_G2_WORKLOAD_GATEWAY_READY === "true"
        ),
        blockers: publicStreamExposure ? ["public_stream_exposure_forbidden"] : ["private_stream_gateway_evidence_required"],
        requiredEvidence: ["G2 broker bind/private exposure scan", "streaming runtime manifest publicInternetExposure=false"]
      }),
      this.#terminalAttributionControl({
        id: "dns_leak_prevention",
        label: "DNS does not reveal terminal path",
        passed: vpnEvidence?.dnsThroughTunnel === true && workloadDnsLeakTestPassed,
        blockers: [
          ...(vpnEvidence?.dnsThroughTunnel === true ? [] : ["terminal_dns_tunnel_evidence_required"]),
          ...(workloadDnsLeakTestPassed ? [] : ["workload_dns_leak_test_required"])
        ],
        requiredEvidence: ["Pixel/laptop DNS through tunnel", "workload DNS leak probe"]
      }),
      this.#terminalAttributionControl({
        id: "browser_webrtc_private_ip",
        label: "Browser/WebRTC does not expose local or terminal candidates",
        passed: this.env?.SYLION_WORKLOAD_WEBRTC_LEAK_TEST_PASSED === "true",
        blockers: ["webrtc_ice_candidate_leak_test_required"],
        requiredEvidence: ["browser workload WebRTC ICE candidate leak test"]
      }),
      this.#terminalAttributionControl({
        id: "browser_geolocation",
        label: "Browser geolocation cannot reveal Pixel location",
        passed: this.env?.SYLION_BROWSER_GEOLOCATION_DENIED === "true",
        blockers: ["browser_geolocation_denial_evidence_required"],
        requiredEvidence: ["browser permission policy denies geolocation in workload sessions"]
      }),
      this.#terminalAttributionControl({
        id: "matrix_client_metadata",
        label: "Matrix client metadata is scrubbed of terminal identifiers",
        passed: this.env?.SYLION_MATRIX_CLIENT_METADATA_REVIEWED === "true",
        blockers: ["matrix_client_metadata_review_required"],
        requiredEvidence: ["Matrix client device name/user-agent/profile metadata review"]
      })
    ];
    const blockers = controls.flatMap((control) => control.status === "passed" ? [] : control.blockers);
    const residualRisks = [
      {
        id: "provider_logs",
        severity: "medium",
        description: "A provider controlling G1/G2/workload or Matrix infrastructure can correlate account, server, billing, timing, or support logs.",
        mitigation: "Minimize provider scope per tier, use jurisdiction policy, separate billing identities lawfully, and record provider-log risk acceptance."
      },
      {
        id: "timing_correlation",
        severity: "medium",
        description: "A global observer may correlate operator session timing, traffic volume, Matrix activity timing, and workload egress.",
        mitigation: "Add route padding/cover-traffic only after legal review; do not claim anonymity from current baseline."
      },
      {
        id: "terminal_compromise",
        severity: "high",
        description: "If the Pixel/laptop is actively compromised, live screen/input and local network state can expose the operator despite the thin-client design.",
        mitigation: "GrapheneOS posture checks, locked-down terminal profile, session timeout, FIDO2/HSM unlock, and incident response."
      },
      {
        id: "account_bootstrap_metadata",
        severity: "medium",
        description: "Phone-number, payment, contact discovery, or Matrix account bootstrap metadata can identify the operator even when the IP path does not.",
        mitigation: "Use approved bootstrap workflow, no contact discovery by default, metadata-only audit, and operator risk gates."
      }
    ];
    const canaryReady = controls.find((control) => control.id === "matrix_source_ip_canary")?.status === "passed"
      && controls.find((control) => control.id === "forwarded_headers_stripped")?.status === "passed";
    return {
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      terminalMode: operatorActor.terminalMode,
      mode: "metadata_only_terminal_attribution_risk_assessment",
      question: "Can someone identify the Pixel/operator location from only a Firecracker/workload IP or Matrix server observation?",
      decision: blockers.length === 0
        ? "direct_terminal_attribution_blocked_residual_correlation_risk_remains"
        : "not_proven_until_required_evidence_passes",
      shortAnswer: canaryReady
        ? "A Matrix server should see only workload egress or a configured routing exit, not the Pixel location; residual correlation risks remain."
        : "From the workload IP alone direct Pixel attribution should be blocked by design, but the required canary/header/DNS/WebRTC evidence is not complete yet.",
      observerStartingPoint: "firecracker_or_workload_ip_only",
      route: ["Pixel/laptop", "Puli AX", "G1", "G2", "WORKLOAD", "microVM/container", "Matrix server"],
      matrixServerObservation: {
        shouldSee: [
          "workload_egress_ip_or_tor_exit_if_operator_policy_enabled",
          "matrix_client_device_and_user_agent_metadata_after_scrub",
          "message_timing_and_traffic_volume_metadata"
        ],
        mustNotSee: [
          "pixel_public_ip",
          "pixel_private_ip",
          "pixel_location",
          "terminal_device_id",
          "operator_identity",
          "g1_private_ip",
          "g2_private_ip",
          "workload_private_ip_if_external_matrix"
        ],
        forbiddenHeaders: ["x-forwarded-for", "x-real-ip", "forwarded"],
        contentInspected: false,
        messageContentStored: false,
        terminalDataStored: false
      },
      controls,
      blockers,
      residualRisks,
      humanGate: {
        required: true,
        owner: "security_architect",
        reason: "Provider logs, account bootstrap metadata, and timing correlation cannot be eliminated by IP routing controls alone."
      },
      requiredLiveTests: [
        "Run Matrix/HTTP canary from each communicator microVM and confirm observed source class is workload/route exit only.",
        "Confirm X-Forwarded-For, X-Real-IP, Forwarded, Via and proxy protocol do not carry terminal or private-hop addresses.",
        "Run workload DNS leak probe and Pixel/laptop DNS-through-tunnel probe.",
        "Run browser WebRTC ICE candidate leak test inside DuckDuckGo/communicator browser workloads.",
        "Verify browser geolocation is denied and timezone/locale policy is explicit.",
        "Review Matrix device names, user agent strings, account bootstrap metadata and contact-discovery settings.",
        "Check G1/G2/workload firewalls for no direct terminal-to-workload or public workload stream binding."
      ],
      guardrails: {
        metadataOnly: true,
        noOperationalDataOnTerminal: true,
        baselineTransport: "ipsec_ikev2",
        g1G2BypassAllowed: false,
        cdrRequiredForFiles: true,
        anonymityClaimAllowed: false,
        productionExecutionAllowed: false
      },
      generatedAt: isoNow(),
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  recordTrafficEvidence({ operatorActor, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.#assertNoTrafficSecrets(body);
    const segmentId = String(body.segmentId || body.segment || "").trim();
    if (!TRAFFIC_SEGMENT_IDS.has(segmentId)) {
      throw validationError("Unsupported traffic segment", {
        segmentId,
        supported: [...TRAFFIC_SEGMENT_IDS]
      });
    }
    const status = this.#normalizeTrafficStatus(body.status || (body.healthy === true ? "healthy" : "observed"));
    const encrypted = body.encrypted === undefined ? status !== "blocked" : body.encrypted === true;
    const evidence = {
      id: newId("traffic_evidence"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      segmentId,
      status,
      encrypted,
      transport: String(body.transport || this.#trafficSegmentDefinition(segmentId).transport).slice(0, 96),
      latencyMs: this.#optionalNumber(body.latencyMs, "latencyMs", 0, 600000),
      jitterMs: this.#optionalNumber(body.jitterMs, "jitterMs", 0, 600000),
      packetLossPct: this.#optionalNumber(body.packetLossPct, "packetLossPct", 0, 100),
      bytesIn: this.#optionalNumber(body.bytesIn, "bytesIn", 0, Number.MAX_SAFE_INTEGER),
      bytesOut: this.#optionalNumber(body.bytesOut, "bytesOut", 0, Number.MAX_SAFE_INTEGER),
      policyDecision: String(body.policyDecision || (status === "healthy" ? "allow" : "review")).slice(0, 48),
      evidenceRefs: this.#safeTrafficEvidenceRefs(body.evidenceRefs || []),
      source: "operator_blue_team_metadata_evidence",
      contentInspected: false,
      packetCaptureStored: false,
      terminalDataStored: false,
      observedAt: isoNow(),
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
    evidence.blockers = this.#trafficEvidenceBlockers(evidence);
    this.trafficEvidence.set(evidence.id, evidence);
    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.traffic_monitoring_evidence_recorded",
      resourceType: RESOURCE_TYPES.TERMINAL_CONNECTION_PROFILE,
      resourceId: evidence.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: evidence.blockers.length ? "deny" : "allow",
      result: evidence.blockers.length ? "traffic_evidence_incomplete" : "traffic_evidence_recorded",
      newValue: this.#publicTrafficEvidence(evidence)
    });
    return this.#publicTrafficEvidence(evidence);
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
      humanHandoff: this.#bootstrapHumanHandoffPlan({
        appKey,
        mode,
        runtimeMode,
        launchUrl: this.#workloadLaunchUrl(appKey)
      }),
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
      this.#liveAccessCheck("t0_pixel_to_g1_ipsec", liveVpnReady, "Pixel direct strongSwan or Puli AX IKEv2 tunnel to G1 is established and evidenced."),
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
    const launch = this.#streamLaunchTarget({ templateKey, brokerPolicy, ready });
    const session = {
      id: newId("stream_session"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      templateKey,
      appName: execution.appName,
      state: ready ? "stream_session_ready" : "stream_session_blocked",
      launchUrl: launch.url,
      gateway: {
        role: "G2",
        host: "g2-stream.sylion.internal",
        appHost: appStreamHost,
        protocol: brokerPolicy.protocol,
        broker: brokerPolicy,
        launchMode: launch.mode,
        brokerConnectionName: launch.brokerConnectionName,
        transport: "internal_tls_via_g1_g2",
        publicInternetExposure: false,
        evidenceId: readiness?.id || null,
        runtimeManifestId: runtimeManifest?.id || null
      },
      source: {
        workloadRole: "WORKLOAD",
        readiness: streamSourceBlockers.length ? "blocked" : "ready",
        mode: "existing_workload_stream_source",
        directProbeUrl: ready ? launch.directProbeUrl : null,
        directProbeMode: "private_websockify_probe_not_production_broker",
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

  createGuacamoleHandoff({ operatorActor, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const templateKey = this.#normalizeStreamingTemplate(body.templateKey || body.app || "duckduckgo_browser");
    const appDefinition = this.#appDefinition(templateKey);
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
    const env = this.env || {};
    const readiness = this.#latestStreamingReadinessForOperator(operatorActor.operatorId);
    const runtimeManifest = this.#latestStreamingRuntimeManifestForOperator(operatorActor.operatorId);
    const brokerPolicy = this.#sessionBrokerPolicy({
      protocol: SESSION_BROKER_PROTOCOLS.GUACAMOLE,
      readiness,
      runtimeManifest
    });
    const sourceBlockers = this.#streamSourceBlockers({ templateKey, env, readiness });
    const key = this.#guacamoleJsonSecretKey();
    const supported = GUACAMOLE_HANDOFF_APPS.has(templateKey);
    const blockers = [
      ...foundation.blockers.map((blocker) => `live_access:${blocker}`),
      ...(supported ? [] : [`${templateKey}_guacamole_handoff_not_supported`]),
      ...(key ? [] : ["guacamole_json_auth_secret_missing"]),
      ...(brokerPolicy.gatewayReady ? [] : ["guacamole_broker_poc_not_ready"]),
      ...brokerPolicy.blockers,
      ...sourceBlockers,
      ...(templateKey === "zangi" && env.SYLION_ZANGI_ANDROID_NATIVE_APPROVED !== "true" ? ["zangi_android_native_provenance_required"] : []),
      ...(templateKey === "exodus" && env.SYLION_EXODUS_RISK_ACCEPTED !== "true" ? ["operator_wallet_risk_acceptance_required"] : [])
    ];
    const ready = blockers.length === 0;
    const expiresAt = new Date(Date.now() + this.#guacamoleHandoffTtlMs()).toISOString();
    const baseUrl = this.#guacamoleBaseUrl();
    const connectionName = this.#guacamoleConnectionName(templateKey);
    const clientIdentifier = this.#guacamoleClientIdentifier(connectionName);
    const handoff = {
      id: newId("guac_handoff"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      templateKey,
      appName: appDefinition.name,
      state: ready ? "guacamole_handoff_ready" : "guacamole_handoff_blocked",
      launchUrl: null,
      broker: {
        protocol: SESSION_BROKER_PROTOCOLS.GUACAMOLE,
        url: baseUrl,
        mode: "encrypted_json_auth",
        connectionName,
        clientIdentifier,
        requiredLayer: "G2",
        guacdTlsRequired: true,
        g2ToWorkloadEncryptedRequired: true
      },
      stream: {
        targetWidth: profile.stream.targetWidth,
        targetHeight: profile.stream.targetHeight,
        resizeMethod: "display-update",
        terminalReceives: ["video_pixels", "audio_optional", "input_events"],
        terminalForbidden: ["workload_files", "app_secrets", "message_database", "wallet_seed", "session_cookies"],
        terminalDataStored: false
      },
      security: {
        jsonAuthEncrypted: ready,
        urlContainsPassword: false,
        plaintextCredentialsReturned: false,
        tokenMaterialStored: false,
        auditStoresLaunchUrl: false,
        guacamoleStateResetBeforeLaunch: ready,
        jsonAuthDataInBrowserFragmentOnly: ready,
        guacamoleTokenMintedBySessionOriginShim: ready,
        guacamoleTokenInBrowserFragmentOnly: ready,
        clipboardEnabled: false,
        fileTransfer: "disabled_until_cdr_gate",
        cdrRequired: true,
        g1G2BypassAllowed: false
      },
      blockers,
      expiresAt: ready ? expiresAt : null,
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      createdAt: isoNow()
    };

    if (ready) {
      const payload = this.#guacamoleJsonAuthPayload({
        operatorActor,
        templateKey,
        connectionName,
        expiresAt
      });
      const encrypted = this.#encryptGuacamoleJsonAuthPayload(payload, key);
      handoff.launchUrl = this.#guacamoleLaunchShimUrl({
        baseUrl,
        clientIdentifier,
        encrypted
      });
    }

    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.guacamole_handoff_created",
      resourceType: RESOURCE_TYPES.TERMINAL_CONNECTION_PROFILE,
      resourceId: handoff.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: ready ? "allow" : "deny",
      result: handoff.state,
      newValue: {
        ...handoff,
        launchUrl: handoff.launchUrl ? "redacted_ephemeral_guacamole_json_auth_url" : null,
        encryptedDataReturnedToBrowser: ready,
        tokenMaterialStored: false
      }
    });
    return handoff;
  }

  async sendWorkloadInput({ operatorActor, body = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const templateKey = this.#normalizeStreamingTemplate(body.templateKey || body.app || "duckduckgo_browser");
    const appDefinition = this.#appDefinition(templateKey);
    const text = this.#safeWorkloadInputText(body.text);
    const submit = body.submit === true;
    const preKeys = this.#safeWorkloadInputKeys(body.preKeys, "preKeys");
    const postKeys = this.#safeWorkloadInputKeys(body.postKeys ?? body.keys, "postKeys");
    const specialKeyCount = preKeys.length + postKeys.length;
    if (!text && !submit && specialKeyCount === 0) {
      throw validationError("Workload input requires text, submit=true, or an allowed special key", {
        templateKey,
        allowed: "printable_ascii_text_or_allowed_special_key"
      });
    }
    const foundation = this.liveAccessFoundation({ operatorActor, correlationId: corr });
    const env = this.env || {};
    const readiness = this.#latestStreamingReadinessForOperator(operatorActor.operatorId);
    const runtimeManifest = this.#latestStreamingRuntimeManifestForOperator(operatorActor.operatorId);
    const brokerPolicy = this.#sessionBrokerPolicy({
      protocol: SESSION_BROKER_PROTOCOLS.GUACAMOLE,
      readiness,
      runtimeManifest
    });
    const sourceBlockers = this.#streamSourceBlockers({ templateKey, env, readiness });
    const supported = GUACAMOLE_HANDOFF_APPS.has(templateKey);
    const blockers = [
      ...foundation.blockers.map((blocker) => `live_access:${blocker}`),
      ...(supported ? [] : [`${templateKey}_workload_input_not_supported`]),
      ...(env.SYLION_WORKLOAD_INPUT_BRIDGE_ENABLED === "true" ? [] : ["workload_input_bridge_not_enabled"]),
      ...(brokerPolicy.gatewayReady ? [] : ["guacamole_broker_poc_not_ready"]),
      ...brokerPolicy.blockers,
      ...sourceBlockers,
      ...(templateKey === "zangi" && env.SYLION_ZANGI_ANDROID_NATIVE_APPROVED !== "true" ? ["zangi_android_native_provenance_required"] : []),
      ...(templateKey === "exodus" && env.SYLION_EXODUS_RISK_ACCEPTED !== "true" ? ["operator_wallet_risk_acceptance_required"] : [])
    ];
    const input = {
      id: newId("workload_input"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      templateKey,
      appName: appDefinition.name,
      state: blockers.length ? "workload_input_blocked" : "workload_input_pending",
      broker: {
        protocol: SESSION_BROKER_PROTOCOLS.GUACAMOLE,
        requiredLayer: "G2",
        target: "vnc_key_event_bridge",
        g2ToWorkloadEncryptedRequired: true
      },
      request: {
        textLength: text.length,
        submit,
        preKeyCount: preKeys.length,
        postKeyCount: postKeys.length,
        specialKeyCount: specialKeyCount + (submit ? 1 : 0),
        contentStored: false,
        contentAudited: false,
        terminalDataStored: false
      },
      result: null,
      blockers,
      security: {
        clipboardUsed: false,
        inputContentReturned: false,
        inputContentAudited: false,
        inputContentStoredOnTerminal: false,
        g1G2BypassAllowed: false,
        fileTransfer: "disabled_until_cdr_gate"
      },
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      createdAt: isoNow()
    };

    if (!blockers.length) {
      try {
        const result = await this.workloadInputRunner({ app: templateKey, text, submit, preKeys, postKeys, env });
        input.state = "workload_input_sent";
        input.result = this.#publicWorkloadInputRunnerResult(result);
      } catch (error) {
        input.state = "workload_input_failed";
        input.blockers = ["workload_input_bridge_execution_failed"];
        input.result = {
          component: "g2_vnc_input_bridge",
          errorCode: String(error?.message || "workload_input_bridge_failed").slice(0, 120),
          stderrCaptured: false,
          inputContentPrinted: false,
          terminalDataStored: false
        };
      }
    }

    this.audit.record({
      actorId: operatorActor.id,
      action: "operator_portal.workload_input_events_sent",
      resourceType: RESOURCE_TYPES.TERMINAL_CONNECTION_PROFILE,
      resourceId: input.id,
      tenantId: operatorActor.tenantId,
      operatorId: operatorActor.operatorId,
      correlationId: corr,
      policyDecision: input.state === "workload_input_sent" ? "allow" : "deny",
      result: input.state,
      newValue: input
    });
    return input;
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
        guacdTls: body.guacdTls === true || body.guacdSsl === true,
        g2ToWorkloadEncrypted: body.g2ToWorkloadEncrypted === true,
        workloadMicroVmLink: String(body.workloadMicroVmLink || "host_local_tap_or_vsock").slice(0, 64),
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
    const gatewayProtocol = this.#normalizeSessionBrokerProtocol(body.gateway?.protocol || SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES);
    const guacdTls = body.gateway?.guacdTls === true || body.gateway?.guacdSsl === true;
    const g2ToWorkloadEncrypted = body.gateway?.g2ToWorkloadEncrypted === true;
    const workloadMicroVmLink = String(body.gateway?.workloadMicroVmLink || "host_local_tap_or_vsock").slice(0, 64);
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
        protocol: gatewayProtocol,
        tlsMode: String(body.gateway?.tlsMode || "internal_tls_only").slice(0, 64),
        guacdTls,
        g2ToWorkloadEncrypted,
        workloadMicroVmLink,
        publicInternetExposure: body.gateway?.publicInternetExposure === true || body.publicInternetExposure === true,
        inputProxy: "server_side_input_events_only"
      },
      broker: this.#sessionBrokerPolicy({
        protocol: body.gateway?.protocol || SESSION_BROKER_PROTOCOLS.LEGACY_WEBRTC_OR_SELKIES,
        runtimeManifest: {
          ready: this.#privateBindAllowed(gatewayBind)
            && body.gateway?.publicInternetExposure !== true
            && body.publicInternetExposure !== true
            && String(body.gateway?.tlsMode || "internal_tls_only") === "internal_tls_only"
            && (
              gatewayProtocol !== SESSION_BROKER_PROTOCOLS.GUACAMOLE
              || (guacdTls && g2ToWorkloadEncrypted)
            ),
          gateway: {
            protocol: gatewayProtocol
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
        brokerToGuacdEncrypted: gatewayProtocol === SESSION_BROKER_PROTOCOLS.GUACAMOLE ? guacdTls : null,
        g2ToWorkloadEncrypted,
        workloadMicroVmLink,
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

  jurisdictionOptions({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const subscription = this.subscription({ operatorActor, correlationId });
    const options = this.#jurisdictionOptionsForSubscription(subscription);
    return {
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      tier: subscription.plan,
      subscriptionMode: subscription.quota.jurisdictionRotationMode,
      allowedModes: this.#allowedJurisdictionModes(subscription.quota.jurisdictionRotationMode),
      minFrequencyHours: subscription.quota.jurisdictionPolicy?.minFrequencyHours || 168,
      maxCountries: subscription.quota.jurisdictionPolicy?.maxCountries || subscription.quota.regionCount || 1,
      requiredRuntime: options.requiredRuntime,
      providerCatalogConfigured: options.providerCatalogConfigured,
      providers: options.providers,
      countries: options.countries,
      regions: options.regions,
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
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
    this.#assertJurisdictionSelectionsAvailable({
      subscription,
      mode,
      regions,
      countries,
      providers
    });
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
    const vpnEvidence = this.#latestVpnEvidenceForOperator(operatorId);
    const vpnReady = this.#vpnEvidenceReady(vpnEvidence);
    const streamingReadiness = this.#latestStreamingReadinessForOperator(operatorId);
    const streamingRuntime = this.#latestStreamingRuntimeManifestForOperator(operatorId);
    const streamGatewayReady = streamingReadiness?.ready === true || streamingRuntime?.ready === true;
    const routeState = vpnReady && streamGatewayReady
      ? "live_private_path_ready"
      : ready ? "local_lab_connected" : "configuration_pending";
    const routerReadiness = this.routerReadiness?.readinessForOperator(operatorId) || {
      packageStatus: "not_generated",
      postureStatus: "not_validated",
      blockers: ["router_package_required", "router_posture_validation_required"],
      readyForPhysicalSmoke: false
    };
    const hsmFidoDeferred = this.env?.SYLION_DEFER_PHYSICAL_HSM_FIDO2 === "true";
    const routerDeferred = this.env?.SYLION_PULI_AX_PHYSICAL_READY !== "true";
    const terminalCertReady = vpnEvidence?.certificateTrusted === true;
    const dnsReady = vpnEvidence?.dnsThroughTunnel === true;
    const liveFirecrackerReady = streamGatewayReady || streamingRuntime?.ready === true;
    const blockers = [
      ...(vpnReady ? [] : ["real_ipsec_profile_not_deployed"]),
      ...(terminalCertReady || hsmFidoDeferred ? [] : ["hsm_or_secure_element_client_certificate_required"]),
      ...(dnsReady ? [] : ["dns_leak_and_kill_switch_tests_required"]),
      ...(liveFirecrackerReady ? [] : ["firecracker_host_qualification_required_for_real_launch"]),
      ...(hsmFidoDeferred ? [] : ["fido2_operator_unlock_required"]),
      ...(routerDeferred || routerReadiness.readyForPhysicalSmoke ? [] : ["puli_ax_physical_package_validation_pending"]),
      ...(routerReadiness.readyForPhysicalSmoke ? [] : routerReadiness.blockers)
    ];
    const deferredBlockers = [
      ...(hsmFidoDeferred ? ["hsm_or_secure_element_client_certificate_required", "fido2_operator_unlock_required"] : []),
      ...(routerDeferred ? ["puli_ax_physical_package_validation_pending", "router_package_required", "router_posture_validation_required"] : [])
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
        status: vpnReady ? "reachable_live_ipsec" : ready ? "reachable_local_lab" : "planned"
      },
      {
        id: "g2",
        role: "G2",
        label: "G2 access broker",
        zone: "G2",
        providerResourceId: this.#resourceRef(latestEnvironment, "G2", operatorId),
        status: vpnReady ? "reachable_live_ipsec" : ready ? "reachable_local_lab" : "planned"
      },
      {
        id: "workload",
        role: "WORKLOAD",
        label: "WORKLOAD Firecracker host",
        zone: "WORKLOAD",
        providerResourceId: this.#resourceRef(latestEnvironment, "WORKLOAD", operatorId),
        status: streamGatewayReady ? "reachable_live_stream_gateway" : ready ? "reachable_local_lab" : "planned"
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
        state: vpnReady ? "live_ipsec_linked" : ready ? "local_lab_linked" : "configuration_pending",
        routePolicy: "g1_allows_only_g2_broker_routes",
        dnsPolicy: "no_terminal_dns_visibility",
        killSwitch: "g1_default_drop_until_ipsec_up",
        certRef: `cert-ref://${operatorId}/g1-to-g2`
      }),
      this.#vpnSegment({
        id: "T2",
        from: "g2",
        to: "workload",
        state: streamGatewayReady ? "live_private_workload_stream_linked" : ready ? "local_lab_linked" : "configuration_pending",
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
      liveEvidence: {
        vpnEvidenceReady: vpnReady,
        streamGatewayReady,
        streamingReadinessId: streamingReadiness?.id || null,
        streamingRuntimeManifestId: streamingRuntime?.id || null,
        terminalCertificateTrusted: terminalCertReady,
        dnsThroughTunnel: dnsReady,
        deferredPhysicalGates: deferredBlockers
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
      deferredBlockers,
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
          appRunning: result.evidence.appRunning === true,
          appCrashed: result.evidence.appCrashed === true,
          visibleWindow: result.evidence.visibleWindow === true,
          vncBannerReady: result.evidence.vncBannerReady === true,
          terminalDataStored: result.evidence.terminalDataStored === true,
          productionExecutionAllowed: result.evidence.productionExecutionAllowed === true
        } : null,
        guacamoleVncForward: result.guacamoleVncForward ? {
          key: result.guacamoleVncForward.key,
          bindReady: result.guacamoleVncForward.bindReady === true,
          targetReachable: result.guacamoleVncForward.targetReachable === true,
          transport: result.guacamoleVncForward.transport || "tls_stunnel_private_bind",
          publicInternetExposure: result.guacamoleVncForward.publicInternetExposure === true,
          blocker: result.guacamoleVncForward.blocker || null
        } : null,
        g2VncVerification: result.g2VncVerification ? {
          key: result.g2VncVerification.key,
          reachable: result.g2VncVerification.reachable === true,
          transport: result.g2VncVerification.transport || "tls_stunnel_private_bind",
          rfbBannerReady: result.g2VncVerification.rfbBannerReady === true
        } : null,
        forwardBlockers: Array.isArray(result.forwardBlockers) ? result.forwardBlockers.map(String).slice(0, 16) : []
      } : null,
      productionExecutionAllowed: false
    };
  }

  #publicLiveWorkloadStatus(snapshot = {}) {
    const apps = Array.isArray(snapshot.apps) ? snapshot.apps : [];
    return {
      generatedAt: snapshot.generatedAt || isoNow(),
      source: snapshot.source || "real_g2_and_ax102_metadata_probe",
      state: snapshot.state || "observed",
      workloadHost: snapshot.workloadHost || "AX102",
      g2Gateway: snapshot.g2Gateway || "G2",
      apps: apps.map((app) => ({
        key: String(app.key || ""),
        evidenceKey: String(app.evidenceKey || app.key || ""),
        name: String(app.name || app.key || "unknown"),
        host: String(app.host || ""),
        launchUrl: String(app.launchUrl || ""),
        runtime: String(app.runtime || "unknown"),
        class: String(app.class || "unknown"),
        transport: {
          state: app.transport?.state || "blocked",
          rootHttpStatus: app.transport?.rootHttpStatus ?? null,
          targetHttpStatus: app.transport?.targetHttpStatus ?? null,
          authRequired: app.transport?.authRequired === true,
          sylionHeadersObserved: app.transport?.sylionHeadersObserved === true
        },
        workload: {
          state: app.workload?.state || "blocked",
          evidencePresent: app.workload?.evidencePresent === true,
          checkedAt: app.workload?.checkedAt || null,
          streamReady: app.workload?.streamReady === true,
          streamAuthRequired: app.workload?.streamAuthRequired === true,
          appRunning: app.workload?.appRunning === true,
          appCrashed: app.workload?.appCrashed === true,
          visibleWindow: app.workload?.visibleWindow === true,
          vncBannerReady: app.workload?.vncBannerReady === true,
          targetContentRequired: app.workload?.targetContentRequired === true,
          targetContentVerified: app.workload?.targetContentVerified === true
        },
        functionalState: app.functionalState || "blocked",
        operatorAction: app.operatorAction || "repair_route_or_workload",
        blockers: Array.isArray(app.blockers)
          ? app.blockers.map((blocker) => {
            const value = String(blocker);
            return BOOTSTRAP_SECRET_FIELD_PATTERN.test(value) ? "redacted_sensitive_blocker" : value;
          }).slice(0, 16)
          : [],
        cdrRequired: true,
        terminalDataStored: false,
        secretsPrinted: false,
        productionExecutionAllowed: false
      })),
      summary: {
        totalApps: Number(snapshot.summary?.totalApps || apps.length),
        transportReady: Number(snapshot.summary?.transportReady || 0),
        workloadUiReady: Number(snapshot.summary?.workloadUiReady || 0),
        functionalReady: Number(snapshot.summary?.functionalReady || 0),
        accountTestRequired: Array.isArray(snapshot.summary?.accountTestRequired) ? snapshot.summary.accountTestRequired.map(String) : [],
        blocked: Array.isArray(snapshot.summary?.blocked) ? snapshot.summary.blocked.map(String) : [],
        pixelFitReviewRequired: Array.isArray(snapshot.summary?.pixelFitReviewRequired) ? snapshot.summary.pixelFitReviewRequired.map(String) : [],
        productionExecutionAllowed: false
      },
      safety: {
        contentInspected: false,
        messageContentStored: false,
        walletDataStored: false,
        terminalDataStored: false,
        cdrRequired: true,
        secretsPrinted: false
      }
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
      ...(this.#vpnTransportInterfaceReady(evidence.vpnInterface) ? [] : ["ipsec_transport_interface_missing"]),
      ...(evidence.dnsThroughTunnel ? [] : ["dns_not_through_tunnel"]),
      ...(evidence.certificateTrusted ? [] : ["internal_ca_not_trusted"]),
      ...missingHosts.map((host) => `host_unreachable:${host}`)
    ];
  }

  #vpnTransportInterfaceReady(value) {
    const iface = String(value || "").trim().toLowerCase();
    return [
      "tun1",
      "puli_ax_ipsec_gateway",
      "router_ipsec_gateway",
      "ipsec_policy_route"
    ].includes(iface);
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

  #latestTrafficEvidenceBySegment(operatorId) {
    const latest = new Map();
    for (const evidence of [...this.trafficEvidence.values()].filter((item) => item.operatorId === operatorId)) {
      const previous = latest.get(evidence.segmentId);
      if (!previous || Date.parse(evidence.observedAt) >= Date.parse(previous.observedAt)) {
        latest.set(evidence.segmentId, evidence);
      }
    }
    return latest;
  }

  #trafficSegmentDefinition(segmentId) {
    return TRAFFIC_MONITOR_SEGMENTS.find((segment) => segment.id === segmentId);
  }

  #trafficSegmentView({ definition, operatorActor, path, vpnEvidence, streamingReadiness, streamingRuntime, evidence }) {
    const inferred = this.#inferredTrafficSegment({
      definition,
      path,
      vpnEvidence,
      streamingReadiness,
      streamingRuntime
    });
    const status = evidence ? this.#normalizeTrafficStatus(evidence.status) : inferred.status;
    const blockers = [
      ...(evidence ? evidence.blockers || [] : inferred.blockers),
      ...(evidence?.encrypted === false && definition.id !== "pixel_router" ? ["encryption_not_evidenced"] : [])
    ];
    const finalStatus = blockers.length && status === "healthy" ? "degraded" : status;
    return {
      id: definition.id,
      order: definition.order,
      operatorId: operatorActor.operatorId,
      from: definition.from,
      to: definition.to,
      zone: definition.zone,
      expectedTransport: definition.transport,
      observedTransport: evidence?.transport || inferred.observedTransport || definition.transport,
      status: finalStatus,
      encrypted: evidence ? evidence.encrypted === true : inferred.encrypted,
      latencyMs: evidence?.latencyMs ?? inferred.latencyMs,
      jitterMs: evidence?.jitterMs ?? null,
      packetLossPct: evidence?.packetLossPct ?? null,
      bytesIn: evidence?.bytesIn ?? null,
      bytesOut: evidence?.bytesOut ?? null,
      lastObservedAt: evidence?.observedAt || inferred.lastObservedAt || null,
      policyDecision: evidence?.policyDecision || inferred.policyDecision,
      expectedControls: definition.expectedControls,
      blockers,
      evidenceId: evidence?.id || null,
      contentInspected: false,
      packetCaptureStored: false,
      terminalDataStored: false,
      productionExecutionAllowed: false
    };
  }

  #inferredTrafficSegment({ definition, path, vpnEvidence, streamingReadiness, streamingRuntime }) {
    const vpnReady = vpnEvidence?.ready === true || this.#vpnEvidenceReady(vpnEvidence);
    const routerReady = path.router?.readyForPhysicalSmoke === true || this.env?.SYLION_PULI_AX_PHYSICAL_READY === "true";
    const g1G2Ready = this.env?.SYLION_G1_G2_POLICY_READY === "true"
      || vpnEvidence?.reachableHosts?.includes("10.42.0.12") === true;
    const g2WorkloadReady = this.env?.SYLION_G2_WORKLOAD_POLICY_READY === "true"
      || this.env?.SYLION_G2_WORKLOAD_GATEWAY_READY === "true"
      || streamingReadiness?.gateway?.g2StreamGatewayReady === true
      || streamingRuntime?.ready === true;
    const streamSourcesReady = streamingReadiness?.ready === true
      || streamingRuntime?.ready === true
      || this.env?.SYLION_WORKLOAD_STREAM_SOURCE_READY === "true";
    if (definition.id === "pixel_router") {
      return {
        status: routerReady ? "degraded" : "blocked",
        encrypted: false,
        observedTransport: routerReady ? "puli_ax_local_link_posture_pending" : "router_physical_gate_pending",
        policyDecision: routerReady ? "review" : "deny",
        blockers: routerReady ? ["router_packet_metadata_agent_not_reporting_yet"] : ["puli_ax_physical_router_pending"],
        lastObservedAt: null,
        latencyMs: null
      };
    }
    if (definition.id === "router_g1") {
      return {
        status: vpnReady ? routerReady ? "healthy" : "degraded" : "blocked",
        encrypted: vpnReady,
        observedTransport: vpnReady ? "pixel_direct_or_router_ipsec_ikev2_evidenced" : "ipsec_ikev2_not_evidenced",
        policyDecision: vpnReady ? "allow" : "deny",
        blockers: [
          ...(vpnReady ? [] : ["vpn_evidence_missing_or_incomplete"]),
          ...(routerReady ? [] : ["puli_ax_physical_router_pending"])
        ],
        lastObservedAt: vpnEvidence?.observedAt || null,
        latencyMs: null
      };
    }
    if (definition.id === "g1_g2") {
      return {
        status: g1G2Ready ? "healthy" : "blocked",
        encrypted: g1G2Ready,
        observedTransport: g1G2Ready ? "g1_g2_policy_path_evidenced" : "g1_g2_policy_path_missing",
        policyDecision: g1G2Ready ? "allow" : "deny",
        blockers: g1G2Ready ? [] : ["g1_to_g2_evidence_missing"],
        lastObservedAt: vpnEvidence?.observedAt || null,
        latencyMs: null
      };
    }
    if (definition.id === "g2_workload") {
      return {
        status: g2WorkloadReady ? "healthy" : "blocked",
        encrypted: g2WorkloadReady,
        observedTransport: g2WorkloadReady ? "g2_workload_private_gateway_evidenced" : "g2_workload_gateway_missing",
        policyDecision: g2WorkloadReady ? "allow" : "deny",
        blockers: g2WorkloadReady ? [] : ["g2_to_workload_evidence_missing"],
        lastObservedAt: streamingRuntime?.createdAt || streamingReadiness?.observedAt || null,
        latencyMs: null
      };
    }
    return {
      status: streamSourcesReady ? "degraded" : "blocked",
      encrypted: streamSourcesReady,
      observedTransport: streamSourcesReady ? "workload_stream_source_evidenced" : "microvm_stream_source_missing",
      policyDecision: streamSourcesReady ? "review" : "deny",
      blockers: streamSourcesReady ? ["per_app_firecracker_runtime_factual_test_required"] : ["workload_microvm_evidence_missing"],
      lastObservedAt: streamingRuntime?.createdAt || streamingReadiness?.observedAt || null,
      latencyMs: null
    };
  }

  #trafficAlerts({ segments, path, vpnEvidence, streamingReadiness, streamingRuntime }) {
    const alerts = [];
    const add = (severity, code, message, segmentId = null) => {
      alerts.push({
        id: `${code}_${alerts.length + 1}`,
        severity,
        code,
        segmentId,
        message,
        contentInspected: false,
        terminalDataStored: false,
        productionExecutionAllowed: false
      });
    };
    for (const segment of segments) {
      if (segment.status === "blocked") add("critical", "segment_blocked", `${segment.from} -> ${segment.to} is blocked: ${(segment.blockers || []).join(", ") || "no evidence"}`, segment.id);
      if (segment.status === "missing") add("warning", "segment_missing", `${segment.from} -> ${segment.to} has no fresh metadata evidence.`, segment.id);
      if (segment.status === "degraded") add("warning", "segment_degraded", `${segment.from} -> ${segment.to} is degraded: ${(segment.blockers || []).join(", ") || "review required"}`, segment.id);
      if (segment.encrypted === false && segment.id !== "pixel_router") add("critical", "encryption_not_evidenced", `${segment.from} -> ${segment.to} lacks encryption evidence.`, segment.id);
    }
    if (path.router?.readyForPhysicalSmoke !== true) {
      add("warning", "puli_ax_pending", "Puli AX physical router package/posture is still pending, so router telemetry is not factual yet.", "pixel_router");
    }
    if (!vpnEvidence) {
      add("critical", "vpn_evidence_missing", "No operator-scoped VPN/IPsec evidence has been recorded for this terminal session.", "router_g1");
    } else {
      if (vpnEvidence.dnsThroughTunnel !== true) add("critical", "dns_leak_risk", "DNS-through-tunnel evidence is missing or false.", "router_g1");
      if (vpnEvidence.certificateTrusted !== true) add("warning", "internal_ca_not_trusted", "SYLION Internal CA trust is not evidenced on the terminal.", "router_g1");
    }
    if (streamingReadiness?.gateway?.publicInternetExposure === true || streamingRuntime?.gateway?.publicInternetExposure === true) {
      add("critical", "public_stream_exposure", "G2 stream gateway evidence reports public exposure, which is forbidden.", "g2_workload");
    }
    return alerts;
  }

  #trafficEvidenceBlockers(evidence) {
    return [
      ...(evidence.status === "blocked" ? ["segment_reported_blocked"] : []),
      ...(evidence.status === "missing" ? ["segment_reported_missing"] : []),
      ...(evidence.encrypted ? [] : evidence.segmentId === "pixel_router" ? [] : ["encryption_not_evidenced"]),
      ...(evidence.packetCaptureStored === false ? [] : ["packet_capture_storage_forbidden"]),
      ...(evidence.contentInspected === false ? [] : ["content_inspection_forbidden"]),
      ...(evidence.terminalDataStored === false ? [] : ["terminal_data_storage_forbidden"])
    ];
  }

  #terminalAttributionControl({ id, label, passed, blockers = [], requiredEvidence = [] }) {
    const controlBlockers = blockers.filter(Boolean);
    return {
      id,
      label,
      status: passed ? "passed" : "missing_evidence",
      blockers: passed ? [] : controlBlockers,
      requiredEvidence,
      contentInspected: false,
      messageContentStored: false,
      terminalDataStored: false,
      productionExecutionAllowed: false
    };
  }

  #publicTrafficEvidence(evidence) {
    return {
      id: evidence.id,
      operatorId: evidence.operatorId,
      terminalMode: evidence.terminalMode,
      deviceId: evidence.deviceId,
      segmentId: evidence.segmentId,
      status: evidence.status,
      encrypted: evidence.encrypted,
      transport: evidence.transport,
      latencyMs: evidence.latencyMs,
      jitterMs: evidence.jitterMs,
      packetLossPct: evidence.packetLossPct,
      bytesIn: evidence.bytesIn,
      bytesOut: evidence.bytesOut,
      policyDecision: evidence.policyDecision,
      evidenceRefs: evidence.evidenceRefs,
      blockers: evidence.blockers,
      observedAt: evidence.observedAt,
      contentInspected: false,
      packetCaptureStored: false,
      terminalDataStored: false,
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  #normalizeTrafficStatus(value) {
    const status = String(value || "observed").trim().toLowerCase();
    if (!TRAFFIC_STATUSES.has(status)) {
      throw validationError("Unsupported traffic evidence status", {
        status: value,
        supported: [...TRAFFIC_STATUSES]
      });
    }
    return status === "observed" ? "degraded" : status;
  }

  #optionalNumber(value, field, min, max) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
      throw validationError(`${field} must be a finite number in range`, { field, value, min, max });
    }
    return number;
  }

  #safeTrafficEvidenceRefs(value) {
    const items = Array.isArray(value) ? value : String(value || "").split(",");
    return items.map((item) => String(item).trim().slice(0, 160)).filter(Boolean).slice(0, 12);
  }

  #assertNoTrafficSecrets(value, path = "body") {
    if (Array.isArray(value)) {
      value.forEach((item, index) => this.#assertNoTrafficSecrets(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (TRAFFIC_FORBIDDEN_FIELD_PATTERN.test(key)) {
        throw validationError("Traffic monitoring evidence must be metadata-only", {
          field: `${path}.${key}`,
          forbidden: "secrets_payloads_messages_packet_captures_and_file_contents"
        });
      }
      this.#assertNoTrafficSecrets(nested, `${path}.${key}`);
    }
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

  #safeWorkloadInputText(value) {
    const text = String(value ?? "");
    if (text.length > 512) {
      throw validationError("Workload input text is too long", {
        maxLength: 512,
        contentStored: false
      });
    }
    for (const char of text) {
      const code = char.codePointAt(0);
      const printableLatin1 = code >= 0x20 && code <= 0x7e;
      const allowedControl = char === "\n" || char === "\t";
      if (!printableLatin1 && !allowedControl) {
        throw validationError("Workload input bridge currently accepts printable ASCII only", {
          allowed: "printable_ascii_tab_newline",
          contentStored: false
        });
      }
    }
    return text;
  }

  #safeWorkloadInputKeys(value, fieldName = "keys") {
    if (value == null) return [];
    const keys = Array.isArray(value) ? value : [value];
    if (keys.length > 64) {
      throw validationError("Too many workload input special keys", {
        fieldName,
        maxKeys: 64,
        contentStored: false
      });
    }
    return keys.map((key) => {
      const normalized = String(key || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (!WORKLOAD_INPUT_SPECIAL_KEYS.has(normalized)) {
        throw validationError("Unsupported workload input special key", {
          fieldName,
          key: normalized || "empty",
          allowed: [...WORKLOAD_INPUT_SPECIAL_KEYS],
          contentStored: false
        });
      }
      return normalized;
    });
  }

  #publicWorkloadInputRunnerResult(result = {}) {
    return {
      component: String(result.component || "g2_vnc_input_bridge"),
      app: result.app || null,
      port: result.port || null,
      keysSent: Number(result.keysSent || result.charsSent || 0),
      specialKeysSent: Number(result.specialKeysSent || 0),
      submitSent: result.submitSent === true,
      framebuffer: result.framebuffer || null,
      securityType: result.securityType || null,
      inputContentPrinted: false,
      terminalDataStored: false
    };
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
        humanHandoffRequired: this.#bootstrapNeedsPrivateHumanInput(app.key),
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

  #bootstrapNeedsPrivateHumanInput(appKey) {
    return ["signal", "whatsapp", "telegram", "threema", "zangi", "matrix_client", "exodus"].includes(appKey);
  }

  #bootstrapHumanHandoffPlan({ appKey, mode, runtimeMode, launchUrl }) {
    const communicator = appKey !== "exodus";
    return {
      state: "awaiting_operator_private_input",
      privateInputEntry: "directly_inside_workload_ui_only",
      operatorActionRequired: true,
      operatorInstruction: communicator
        ? "Open the workload stream, enter account, phone, SMS or 2FA details only inside the communicator UI, then return here and record pass/fail metadata."
        : "Open the wallet workload, perform only the approved test workflow directly inside the workload UI, then return here and record metadata plus risk acceptance.",
      codexRole: "navigate_open_stream_capture_metadata_only",
      currentLaunchUrl: launchUrl,
      appKey,
      mode,
      runtimeMode,
      orderedSteps: communicator ? [
        "Open application stream from the operator app switcher.",
        "Operator enters phone/account credentials and SMS/2FA code directly in the workload UI.",
        "Verify account is created or linked without storing the phone number, OTP, password or message content.",
        "Send and receive a harmless test message with QA contact; store only metadata that the check passed.",
        "Return to this panel and record evidence refs, latency and pass/fail checks."
      ] : [
        "Open the wallet workload stream.",
        "Operator performs approved test workflow without exposing seed, private key, wallet address or balance.",
        "Confirm viewport fit and input behavior on Pixel or laptop.",
        "Return to this panel and record metadata-only evidence plus explicit risk acceptance."
      ],
      neverCollect: [
        "phone_number",
        "otp_or_sms_code",
        "password",
        "message_content",
        "wallet_seed_or_private_key",
        "wallet_balance_or_address"
      ],
      allowedRecord: [
        "app_visible_boolean",
        "account_bootstrap_boolean",
        "send_receive_boolean",
        "latency_ms",
        "artifact_refs",
        "short_note_without_secrets"
      ],
      terminalDataStored: false,
      productionExecutionAllowed: false
    };
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
      if (typeof nested === "string" && BOOTSTRAP_SECRET_VALUE_PATTERN.test(nested)) {
        throw validationError("Account bootstrap evidence must not contain phone numbers, OTPs, passwords, seeds or token material", {
          field: currentPath.join("."),
          allowed: "Record only pass/fail metadata, artifact refs and short non-secret notes."
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
      humanHandoff: session.humanHandoff,
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

  #guacamoleConnectionName(templateKey) {
    const definition = this.#appDefinition(templateKey);
    return definition ? `SYLION ${definition.name}` : `SYLION ${templateKey}`;
  }

  #guacamoleClientIdentifier(connectionName) {
    return Buffer.from(`${connectionName}\0c\0json`, "utf8")
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/g, "");
  }

  #guacamoleBaseUrl() {
    const raw = String(this.env?.SYLION_GUACAMOLE_BASE_URL || "https://session.sylion.internal/guacamole/").trim();
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:") {
        throw validationError("Guacamole handoff requires HTTPS base URL", {
          protocol: url.protocol,
          expected: "https:"
        });
      }
      if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
      return url.toString();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw validationError("Invalid Guacamole base URL", { url: raw });
    }
  }

  #guacamoleLaunchShimUrl({ baseUrl, clientIdentifier, encrypted }) {
    const url = new URL(baseUrl);
    const shimUrl = new URL("/sylion-launch.html", url.origin);
    const params = new URLSearchParams();
    params.set("client", clientIdentifier);
    params.set("data", encrypted);
    shimUrl.hash = params.toString();
    return shimUrl.toString();
  }

  #guacamoleJsonSecretKey() {
    const raw = String(this.env?.SYLION_GUACAMOLE_JSON_SECRET_KEY || this.env?.GUACAMOLE_JSON_SECRET_KEY || "").trim();
    const hex = raw.replace(/^0x/i, "");
    if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
    return Buffer.from(hex, "hex");
  }

  #guacamoleHandoffTtlMs() {
    const seconds = Number(this.env?.SYLION_GUACAMOLE_HANDOFF_TTL_SECONDS || 120);
    const bounded = Number.isFinite(seconds) ? Math.max(30, Math.min(seconds, 300)) : 120;
    return Math.round(bounded * 1000);
  }

  #guacamoleJsonAuthPayload({ operatorActor, templateKey, connectionName, expiresAt }) {
    const username = `sylion-${String(operatorActor.operatorId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48)}`;
    return {
      username,
      expires: Date.parse(expiresAt),
      connections: {
        [connectionName]: {
          protocol: "vnc",
          parameters: this.#guacamoleConnectionParameters(templateKey)
        }
      }
    };
  }

  #guacamoleConnectionParameters(templateKey) {
    const port = GUACAMOLE_LOCAL_VNC_PORTS[templateKey];
    if (!port) {
      throw validationError("Unsupported Guacamole handoff app", {
        templateKey,
        supported: [...GUACAMOLE_HANDOFF_APPS]
      });
    }
    return {
      hostname: String(this.env?.SYLION_G2_DOCKER_BRIDGE_IP || "172.18.0.1"),
      port: String(port),
      "disable-copy": "true",
      "disable-paste": "true",
      "enable-sftp": "false",
      "autoretry": "3",
      "resize-method": "display-update"
    };
  }

  #encryptGuacamoleJsonAuthPayload(payload, key) {
    const json = Buffer.from(JSON.stringify(payload), "utf8");
    const signature = createHmac("sha256", key).update(json).digest();
    const iv = Buffer.alloc(16, 0);
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const ciphertext = Buffer.concat([cipher.update(Buffer.concat([signature, json])), cipher.final()]);
    return ciphertext.toString("base64");
  }

  #streamLaunchTarget({ templateKey, brokerPolicy, ready }) {
    if (!ready) {
      return {
        url: null,
        mode: "blocked",
        brokerConnectionName: null,
        directProbeUrl: null
      };
    }
    const host = this.#streamHostForTemplate(templateKey);
    const directProbeUrl = this.#workloadLaunchUrl(templateKey, host);
    if (brokerPolicy.protocol === SESSION_BROKER_PROTOCOLS.GUACAMOLE) {
      return {
        url: `/operator/stream.html?app=${encodeURIComponent(templateKey)}&broker=guacamole`,
        mode: "guacamole_json_auth_handoff",
        brokerConnectionName: this.#guacamoleConnectionName(templateKey),
        directProbeUrl
      };
    }
    return {
      url: directProbeUrl,
      mode: brokerPolicy.labOnly ? "private_websockify_lab_fallback" : "private_app_stream",
      brokerConnectionName: null,
      directProbeUrl
    };
  }

  #workloadLaunchUrl(templateKey, host = this.#streamHostForTemplate(templateKey)) {
    if (templateKey === "duckduckgo_browser") return `https://${host}/vnc.html?autoconnect=true&resize=remote&path=websockify`;
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
      encryption: selected === SESSION_BROKER_PROTOCOLS.GUACAMOLE ? {
        terminalToG2: "tls_over_ipsec_required",
        guacamoleWebappToGuacd: "tls_required",
        g2ToWorkload: "tls_stunnel_or_ipsec_required",
        workloadToMicroVm: "host_local_tap_or_vsock_only"
      } : {
        terminalToG2: "tls_over_ipsec_required",
        g2ToWorkload: "approved_broker_transport_required"
      },
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
      ...(evidence.gateway.protocol === SESSION_BROKER_PROTOCOLS.GUACAMOLE && evidence.gateway.guacdTls !== true ? ["guacamole_guacd_tls_required"] : []),
      ...(evidence.gateway.protocol === SESSION_BROKER_PROTOCOLS.GUACAMOLE && evidence.gateway.g2ToWorkloadEncrypted !== true ? ["g2_workload_stream_transport_encryption_required"] : []),
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
      ...(manifest.gateway.protocol === SESSION_BROKER_PROTOCOLS.GUACAMOLE && manifest.gateway.guacdTls !== true ? ["guacamole_guacd_tls_required"] : []),
      ...(manifest.gateway.protocol === SESSION_BROKER_PROTOCOLS.GUACAMOLE && manifest.gateway.g2ToWorkloadEncrypted !== true ? ["g2_workload_stream_transport_encryption_required"] : []),
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
    if (tier === TIERS.PHANTOM) return 24;
    if (tier === TIERS.SOVEREIGN) return 24;
    if (tier === TIERS.PRO) return 12;
    if (tier === TIERS.STANDARD) return 12;
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
    const allowed = this.#allowedJurisdictionModes(subscriptionMode);
    if (!allowed.includes(mode)) {
      throw validationError("Jurisdiction mode is not available in this subscription tier", {
        mode,
        subscriptionMode,
        allowed
      });
    }
  }

  #allowedJurisdictionModes(subscriptionMode) {
    return subscriptionMode === "full_policy"
      ? ["disabled", "manual", "scheduled", "full_policy"]
      : subscriptionMode === "scheduled"
        ? ["disabled", "manual", "scheduled"]
        : ["disabled", "manual"];
  }

  #jurisdictionOptionsForSubscription(subscription) {
    if (this.providers?.jurisdictionOptions) {
      return this.providers.jurisdictionOptions({
        tier: subscription.plan,
        providerPolicy: subscription.quota.providerPolicy || {}
      });
    }
    return {
      tier: subscription.plan,
      requiredRuntime: subscription.quota.providerPolicy?.confidentialComputeRequired
        ? "confidential"
        : subscription.quota.providerPolicy?.firecrackerRequired ? "firecracker" : "containers",
      providers: [],
      countries: [],
      regions: [],
      providerCatalogConfigured: false,
      productionExecutionAllowed: false
    };
  }

  #assertJurisdictionSelectionsAvailable({ subscription, mode, regions, countries, providers }) {
    if (mode === "disabled") return;
    const options = this.#jurisdictionOptionsForSubscription(subscription);
    if (!options.providerCatalogConfigured) return;
    if (!options.providers.length) {
      throw validationError("No provider locations are available for this subscription runtime policy", {
        tier: subscription.plan,
        requiredRuntime: options.requiredRuntime
      });
    }
    const availableProviders = new Set(options.providers.map((provider) => provider.providerKey));
    const availableCountries = new Set(options.countries);
    const availableRegions = new Set(options.regions.map((region) => region.region));
    const unknownProviders = providers.filter((provider) => !availableProviders.has(provider));
    const unknownCountries = countries.filter((country) => !availableCountries.has(country));
    const unknownRegions = regions.filter((region) => !availableRegions.has(region));
    const regionsByProvider = new Map(options.providers.map((provider) => [
      provider.providerKey,
      new Set(provider.regions.map((region) => region.region))
    ]));
    const countriesByProvider = new Map(options.providers.map((provider) => [
      provider.providerKey,
      new Set(provider.countries)
    ]));
    const incompatibleRegions = providers.length && regions.length
      ? regions.filter((region) => !providers.some((provider) => regionsByProvider.get(provider)?.has(region)))
      : [];
    const incompatibleCountries = providers.length && countries.length
      ? countries.filter((country) => !providers.some((provider) => countriesByProvider.get(provider)?.has(country)))
      : [];
    if (unknownProviders.length || unknownCountries.length || unknownRegions.length || incompatibleRegions.length || incompatibleCountries.length) {
      throw validationError("Jurisdiction selection is not available from configured providers for this tier", {
        tier: subscription.plan,
        requiredRuntime: options.requiredRuntime,
        unknownProviders,
        unknownCountries,
        unknownRegions,
        incompatibleRegions,
        incompatibleCountries,
        availableProviders: [...availableProviders],
        availableCountries: [...availableCountries],
        availableRegions: [...availableRegions]
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
