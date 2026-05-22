import { randomBytes } from "node:crypto";
import { DEVICE_TYPES, RESOURCE_TYPES, TIERS } from "../../domain/constants.js";
import { AppError, notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

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

const WORKLOAD_CONTROL_ACTIONS = new Set(["scale_to_counts", "rotate_app", "recreate_all"]);
const UNLOCK_LAYERS = Object.freeze(["g1", "g2", "workload"]);
const PANIC_LEVELS = Object.freeze(["data_wipe", "environment_destroy", "account_revoke"]);
const JURISDICTION_MODES = Object.freeze(["disabled", "manual", "scheduled", "full_policy"]);

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

export class OperatorPortalService {
  constructor({ audit, rbac, operators, devices, subscriptions, operatorEnvironments, securityProfiles, routerReadiness = null, env = process.env, store = null }) {
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
        productionExecutionAllowed: false,
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
    const state = ready ? "local_lab_connected" : "configuration_pending";
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
        "Puli AX IPsec gateway",
        "G1 network gateway",
        "G2 access broker",
        "WORKLOAD microVM layer"
      ],
      segments: path.segments,
      microVmSlots: path.microVmSlots,
      lastHandshake: null,
      sideEffectAllowed: false,
      productionExecutionAllowed: false
    };
  }

  vpnInstallPackage({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    const vpn = this.vpnStatus({ operatorActor, correlationId });
    const readyForRealInstall = false;
    return {
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      packageType: "android_ipsec_ikev2_profile",
      transport: "ipsec_ikev2_certificate_auth",
      installState: readyForRealInstall ? "ready" : "blocked_human_gate",
      readyForRealInstall,
      profileDelivery: "adb_lab_preview_only",
      androidPackageInstallAllowed: false,
      requires: [
        "real_g1_public_ipsec_endpoint",
        "hsm_or_secure_element_client_certificate",
        "router_puli_ax_package_validation",
        "dns_leak_and_kill_switch_tests",
        "fido2_operator_unlock"
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
      productionExecutionAllowed: false,
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

  workloadSessionBroker({ operatorActor, templateKey = "signal", correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const execution = this.#workloadExecutionForOperator({
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId,
      templateKey
    });
    const app = String(templateKey || "signal").trim().toLowerCase();
    const host = `${app === "duckduckgo_browser" ? "duckduckgo" : app}.sylion.internal`;
    const broker = {
      id: newId("workload_broker"),
      operatorId: operatorActor.operatorId,
      tenantId: operatorActor.tenantId,
      templateKey: execution.templateKey,
      appName: execution.appName,
      state: execution.launchAllowed ? "session_ready" : "session_prepared_with_blockers",
      url: `https://${host}/`,
      authMode: app === "signal" ? "kasm_session_broker_required" : "g2_internal_tls",
      handoff: {
        terminalMode: operatorActor.terminalMode,
        opensInBrowser: true,
        returnsViaAndroidBack: true,
        storesOperationalDataOnTerminal: false,
        clipboardEnabled: false,
        fileTransfer: "cdr_required"
      },
      blockers: [
        ...execution.blockers,
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
        protocol: "webrtc_planned",
        source: "G2 pixel stream gateway",
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
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      destructiveCleanupAllowed: false,
      requestedAt: request.requestedAt
    };
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
    const checks = [
      {
        key: "kvm_device",
        status: env.SYLION_ANDROID_KVM_READY === "true" || env.SYLION_KVM_READY === "true" ? "passed" : "blocked",
        detail: "/dev/kvm must be present on the WORKLOAD host or a dedicated Android runtime host"
      },
      {
        key: "binder_or_binderfs",
        status: env.SYLION_ANDROID_BINDER_READY === "true" || env.SYLION_ANDROID_BINDERFS_READY === "true" ? "passed" : "blocked",
        detail: "Android workloads require binder/binderfs support"
      },
      {
        key: "approved_android_image",
        status: env.SYLION_ANDROID_WORKLOAD_IMAGE_REF ? "passed" : "blocked",
        detail: "Android system image must be approved and pinned"
      },
      {
        key: "approved_zangi_apk_ref",
        status: env.SYLION_ZANGI_APK_REF ? "passed" : "blocked",
        detail: "Zangi APK/source reference must be approved before native launch"
      }
    ];
    const blockers = checks.filter((check) => check.status !== "passed").map((check) => check.key);
    return {
      required: true,
      runtimeClass: "android_workload",
      hostRequirement: "kvm_or_bare_metal_with_binderfs",
      currentProviderFit: blockers.length ? "blocked_on_current_host" : "ready_for_android_runner_review",
      ready: blockers.length === 0,
      checks,
      blockers
    };
  }

  #workloadExecutionForOperator({ operatorId, terminalMode, deviceId, templateKey }) {
    const path = this.#connectionPathForOperator({ operatorId, terminalMode, deviceId });
    const normalizedTemplate = String(templateKey || "signal").trim().toLowerCase();
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
      appName: slot?.appName || (normalizedTemplate === "zangi" ? "Zangi" : "Signal"),
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
