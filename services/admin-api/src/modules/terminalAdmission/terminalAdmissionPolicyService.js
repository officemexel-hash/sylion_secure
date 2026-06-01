import { createHash } from "node:crypto";
import { DEVICE_TYPES, RESOURCE_TYPES } from "../../domain/constants.js";
import { forbidden, notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

export const PROHIBITED_CELLULAR_ACTIONS = Object.freeze([
  "imei_override",
  "imei_write",
  "imsi_programming_public_network",
  "ki_opc_write_public_network",
  "tac_spoofing",
  "modem_unlock_for_identity_mutation",
  "boot_time_cellular_identity_rotation",
  "public_network_identity_spoofing"
]);

const PROHIBITED_ACTION_SET = new Set(PROHIBITED_CELLULAR_ACTIONS);
const TERMINAL_MODES = new Set([DEVICE_TYPES.PIXEL, DEVICE_TYPES.LAPTOP_TERMINAL]);
const CELLULAR_SECRET_FIELD = /(ki|opc|adm|pin|puk|secret|password|token|private[_-]?key|seed|mnemonic)/i;
const TERMINAL_EVIDENCE_SECRET_FIELD = /(imei|imsi|iccid|ki|opc|phone|sms|otp|secret|password|token|private[_-]?key|seed|mnemonic|message|chat|payload|file[_-]?content)/i;

function isoNow() {
  return new Date().toISOString();
}

function hashIdentifier(value) {
  if (!value) return null;
  return createHash("sha256").update(String(value).trim()).digest("hex");
}

function normalizeHash(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  return /^[a-f0-9]{64}$/i.test(trimmed) ? trimmed.toLowerCase() : hashIdentifier(trimmed);
}

function rejectSecretFields(value, pattern, path = "payload") {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretFields(item, pattern, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (pattern.test(key)) {
      throw validationError("Payload contains forbidden sensitive field", { field: nestedPath });
    }
    rejectSecretFields(nested, pattern, nestedPath);
  }
}

function publicInventory(record) {
  return {
    ...record,
    rawValuesRedacted: true,
    productionExecutionAllowed: false,
    sideEffectAllowed: false
  };
}

function publicAdmission(record) {
  return {
    ...record,
    productionExecutionAllowed: record.blockers.length === 0,
    sideEffectAllowed: false
  };
}

export class TerminalAdmissionPolicyService {
  constructor({ audit, rbac, operators, devices, routerReadiness = null, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.operators = operators;
    this.devices = devices;
    this.routerReadiness = routerReadiness;
    this.inventories = new PersistentMap({ store, collection: "cellular_inventory" });
    this.admissions = new PersistentMap({ store, collection: "terminal_admissions" });
  }

  assertCellularActionAllowed({ actor, action, reason = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    if (PROHIBITED_ACTION_SET.has(action)) {
      this.audit.record({
        actorId: actor?.id,
        action: "cellular.policy.denied",
        resourceType: RESOURCE_TYPES.CELLULAR_INVENTORY,
        resourceId: action,
        correlationId: corr,
        policyDecision: "deny",
        result: "prohibited_cellular_identity_action",
        newValue: {
          action,
          reason,
          adr: "ADR-002",
          productionExecutionAllowed: false,
          sideEffectAllowed: false
        }
      });
      throw forbidden(action);
    }
    return {
      action,
      policyDecision: "allow",
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  recordCellularInventory({
    actor,
    operatorId,
    routerDeviceId = null,
    provider = null,
    country = null,
    carrier = null,
    apn = null,
    modem = {},
    sim = {},
    network = {},
    evidenceRefs = [],
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "cellular.inventory.manage", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.CELLULAR_INVENTORY
    });
    const operator = this.#requireOperator(operatorId);
    const router = routerDeviceId ? this.#requireDevice(routerDeviceId, DEVICE_TYPES.ROUTER, operatorId) : this.#latestDevice(operatorId, DEVICE_TYPES.ROUTER);
    rejectSecretFields({ modem, sim, network, evidenceRefs }, CELLULAR_SECRET_FIELD);

    const record = {
      id: newId("cellular_inventory"),
      operatorId,
      tenantId: operator.tenantId,
      routerDeviceId: router?.id || null,
      provider,
      country,
      carrier,
      apn,
      modem: {
        model: modem.model || null,
        firmware: modem.firmware || null,
        imeiHash: normalizeHash(modem.imeiHash || modem.imei || null)
      },
      sim: {
        status: sim.status || null,
        profileRef: sim.profileRef || null,
        iccidHash: normalizeHash(sim.iccidHash || sim.iccid || null),
        imsiHash: normalizeHash(sim.imsiHash || sim.imsi || null)
      },
      network: {
        registration: network.registration || null,
        signalQuality: network.signalQuality || null,
        roaming: network.roaming === true
      },
      supportedActions: ["read_only_inventory", "legal_provider_profile_lifecycle", "terminal_admission_evidence"],
      prohibitedActions: [...PROHIBITED_CELLULAR_ACTIONS],
      evidenceRefs,
      rawValuesRedacted: true,
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.inventories.set(record.id, record);
    this.audit.record({
      actorId: actor.id,
      action: "cellular.inventory.recorded",
      resourceType: RESOURCE_TYPES.CELLULAR_INVENTORY,
      resourceId: record.id,
      tenantId: operator.tenantId,
      operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: "metadata_recorded",
      newValue: publicInventory(record)
    });
    return publicInventory(record);
  }

  listCellularInventory({ actor, operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "cellular.inventory.read", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.CELLULAR_INVENTORY
    });
    return [...this.inventories.values()]
      .filter((record) => !operatorId || record.operatorId === operatorId)
      .map(publicInventory);
  }

  evaluateTerminalAdmission({
    actor,
    operatorId,
    terminalMode = DEVICE_TYPES.PIXEL,
    terminalDeviceId = null,
    routerDeviceId = null,
    fido2DeviceId = null,
    evidence = {},
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "terminal.admission.evaluate", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.TERMINAL_ADMISSION
    });
    const operator = this.#requireOperator(operatorId);
    if (!TERMINAL_MODES.has(terminalMode)) {
      throw validationError("Unsupported terminal mode", { terminalMode, supported: [...TERMINAL_MODES] });
    }
    rejectSecretFields(evidence, TERMINAL_EVIDENCE_SECRET_FIELD, "evidence");

    const terminal = terminalDeviceId
      ? this.#requireDevice(terminalDeviceId, terminalMode, operatorId)
      : this.#latestDevice(operatorId, terminalMode);
    const router = routerDeviceId
      ? this.#requireDevice(routerDeviceId, DEVICE_TYPES.ROUTER, operatorId)
      : this.#latestDevice(operatorId, DEVICE_TYPES.ROUTER);
    const fido2 = fido2DeviceId
      ? this.#requireDevice(fido2DeviceId, DEVICE_TYPES.FIDO2, operatorId)
      : null;
    const routerReadiness = this.routerReadiness?.readinessForOperator(operatorId) || null;

    const blockers = [];
    if (!terminal) blockers.push(`${terminalMode}_device_required`);
    if (!router) blockers.push("puli_ax_router_required");
    if (!fido2) blockers.push("fido2_device_required");
    if (terminalMode === DEVICE_TYPES.PIXEL && evidence.pixelCellularDisabled !== true) blockers.push("pixel_cellular_disabled_evidence_required");
    if (terminalMode === DEVICE_TYPES.PIXEL && evidence.pixelWifiOnly !== true) blockers.push("pixel_wifi_only_evidence_required");
    if (evidence.routerPairingVerified !== true) blockers.push("router_pairing_evidence_required");
    if (evidence.fido2UserVerified !== true) blockers.push("fido2_user_verification_required");
    if (evidence.ipsecToG1Established !== true) blockers.push("ipsec_to_g1_evidence_required");
    if (evidence.certificateChainTrusted !== true) blockers.push("certificate_chain_trust_evidence_required");
    if (evidence.terminalDataStored !== false) blockers.push("terminal_no_operational_data_evidence_required");
    if (routerReadiness && routerReadiness.readyForPhysicalSmoke !== true) blockers.push(...routerReadiness.blockers);
    if (!routerReadiness) blockers.push("router_readiness_service_unavailable");

    const record = {
      id: newId("terminal_admission"),
      operatorId,
      tenantId: operator.tenantId,
      terminalMode,
      terminalDeviceId: terminal?.id || null,
      routerDeviceId: router?.id || null,
      fido2DeviceId: fido2?.id || null,
      decision: blockers.length ? "blocked" : "eligible_for_g1",
      blockers: [...new Set(blockers)],
      path: [
        terminalMode === DEVICE_TYPES.PIXEL ? "Pixel GrapheneOS terminal" : "Laptop web terminal",
        "Puli AX access router",
        "G1 IPsec ingress gateway",
        "G2 access broker",
        "WORKLOAD Firecracker/container layer"
      ],
      controls: {
        pixelCellularDisabled: terminalMode === DEVICE_TYPES.PIXEL ? evidence.pixelCellularDisabled === true : "not_applicable",
        pixelWifiOnly: terminalMode === DEVICE_TYPES.PIXEL ? evidence.pixelWifiOnly === true : "not_applicable",
        routerPairingVerified: evidence.routerPairingVerified === true,
        fido2UserVerified: evidence.fido2UserVerified === true,
        ipsecToG1Established: evidence.ipsecToG1Established === true,
        certificateChainTrusted: evidence.certificateChainTrusted === true,
        terminalDataStored: false
      },
      routerReadiness,
      cdrRequired: true,
      rawValuesRedacted: true,
      evaluatedAt: isoNow(),
      evaluatedBy: actor.id
    };
    this.admissions.set(record.id, record);
    this.audit.record({
      actorId: actor.id,
      action: "terminal.admission.evaluated",
      resourceType: RESOURCE_TYPES.TERMINAL_ADMISSION,
      resourceId: record.id,
      tenantId: operator.tenantId,
      operatorId,
      correlationId: corr,
      policyDecision: blockers.length ? "deny" : "allow",
      result: record.decision,
      newValue: publicAdmission(record)
    });
    return publicAdmission(record);
  }

  listTerminalAdmissions({ actor, operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "terminal.admission.evaluate", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.TERMINAL_ADMISSION
    });
    return [...this.admissions.values()]
      .filter((record) => !operatorId || record.operatorId === operatorId)
      .map(publicAdmission);
  }

  #requireOperator(operatorId) {
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    return operator;
  }

  #latestDevice(operatorId, type) {
    return this.devices.listForOperatorScoped(operatorId).filter((device) => device.type === type).at(-1) || null;
  }

  #requireDevice(deviceId, type, operatorId) {
    const device = this.devices.get(deviceId);
    if (!device) throw notFound("device", deviceId);
    if (device.type !== type) {
      throw validationError("Device type mismatch", { deviceId, expected: type, actual: device.type });
    }
    if (device.assignedOperatorId !== operatorId) {
      throw validationError("Device is not assigned to this operator", { deviceId, operatorId });
    }
    return device;
  }
}
