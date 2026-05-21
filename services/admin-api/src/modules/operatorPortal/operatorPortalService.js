import { randomBytes } from "node:crypto";
import { DEVICE_TYPES, RESOURCE_TYPES } from "../../domain/constants.js";
import { AppError, notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const TERMINAL_MODES = Object.freeze({
  PIXEL: "pixel_grapheneos",
  LAPTOP: "laptop_web_terminal"
});

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
    expiresAt: session.expiresAt,
    productionExecutionAllowed: false,
    sideEffectAllowed: false,
    token: session.token
  };
}

export class OperatorPortalService {
  constructor({ audit, rbac, operators, devices, subscriptions, operatorEnvironments, securityProfiles, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.operators = operators;
    this.devices = devices;
    this.subscriptions = subscriptions;
    this.operatorEnvironments = operatorEnvironments;
    this.securityProfiles = securityProfiles;
    this.sessions = new PersistentMap({ store, collection: "operator_portal_sessions" });
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
    const session = {
      id: newId("op_session"),
      token,
      operatorId,
      tenantId: operator.tenantId,
      terminalMode: mode,
      deviceId: device?.id || null,
      postureState: device?.posture?.state || "configuration_pending",
      createdAt: isoNow(),
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
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

  connectionPath({ operatorActor, correlationId }) {
    requireCorrelationId(correlationId);
    return this.#connectionPathForOperator({
      operatorId: operatorActor.operatorId,
      terminalMode: operatorActor.terminalMode,
      deviceId: operatorActor.deviceId
    });
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
      destructiveCleanupAllowed: false
    };
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
    const blockers = [
      "real_ipsec_profile_not_deployed",
      "hsm_or_secure_element_client_certificate_required",
      "puli_ax_physical_package_validation_pending",
      "dns_leak_and_kill_switch_tests_required",
      "firecracker_host_qualification_required_for_real_launch",
      "fido2_operator_unlock_required"
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
        packageStatus: "physical_validation_pending",
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
