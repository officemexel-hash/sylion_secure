import { DEVICE_STATUSES, DEVICE_TYPES } from "../../domain/constants.js";
import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const DEVICE_TYPE_VALUES = new Set(Object.values(DEVICE_TYPES));
const DEVICE_STATUS_VALUES = new Set(Object.values(DEVICE_STATUSES));

function requireText(value, field) {
  if (!value || typeof value !== "string" || value.trim().length < 2) {
    throw validationError(`${field} is required`, { field });
  }
  return value.trim();
}

function assertNoOperationalData(value, path = "metadata") {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const currentPath = `${path}.${key}`;
    if (/message|chat|plaintext|seed|password|private.*key|conversation|fileContents/i.test(key)) {
      throw validationError(
        "Device inventory must not contain operational data or private secrets",
        {
          field: currentPath
        }
      );
    }
    assertNoOperationalData(nested, currentPath);
  }
}

export class DeviceInventoryService {
  constructor({ audit, rbac, operators, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.operators = operators;
    this.devices = new PersistentMap({ store, collection: "devices" });
    this.serialIndex = new Map();
    this.operatorIndex = new Map();
    this.registrationOrder = new Map();
    this.registrationSeq = 0;
    for (const device of this.devices.values()) {
      this.serialIndex.set(device.serial, device.id);
      this.registrationOrder.set(device.id, this.registrationSeq);
      this.registrationSeq += 1;
      this.#addToOperatorIndex(device.assignedOperatorId, device.id);
    }
  }

  register({
    actor,
    type,
    serial,
    model,
    firmwareVersion = null,
    configVersion = null,
    certificateRef = null,
    assignedOperatorId = null,
    posture = { state: "unknown" },
    qualificationStatus = "needs_evidence",
    metadata = {},
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "device.register", {
      operatorId: assignedOperatorId,
      correlationId: corr
    });
    if (!DEVICE_TYPE_VALUES.has(type)) {
      throw validationError("Unsupported device type", {
        type,
        supported: [...DEVICE_TYPE_VALUES]
      });
    }
    const normalizedSerial = requireText(serial, "serial");
    if (this.serialIndex.has(normalizedSerial)) {
      throw validationError("Device serial is already registered", { serial: normalizedSerial });
    }
    if (assignedOperatorId && !this.operators.get(assignedOperatorId)) {
      throw notFound("operator", assignedOperatorId);
    }
    assertNoOperationalData({ posture, metadata });

    const device = {
      id: newId("device"),
      type,
      serial: normalizedSerial,
      model: requireText(model, "model"),
      assignedOperatorId,
      status: assignedOperatorId ? DEVICE_STATUSES.ASSIGNED : DEVICE_STATUSES.REGISTERED,
      firmwareVersion,
      configVersion,
      certificateRef,
      posture,
      qualificationStatus,
      metadata,
      lastSeenAt: null,
      createdAt: new Date().toISOString()
    };
    this.devices.set(device.id, device);
    this.serialIndex.set(device.serial, device.id);
    this.registrationOrder.set(device.id, this.registrationSeq);
    this.registrationSeq += 1;
    this.#addToOperatorIndex(device.assignedOperatorId, device.id);
    this.audit.record({
      actorId: actor.id,
      action: "device.registered",
      resourceType: "device",
      resourceId: device.id,
      operatorId: assignedOperatorId,
      correlationId: corr,
      newValue: device
    });
    return device;
  }

  assign({ actor, deviceId, operatorId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "device.assign", { operatorId, correlationId: corr });
    const current = this.#requireDevice(deviceId);
    const operator = this.operators.get(operatorId);
    if (!operator) {
      throw notFound("operator", operatorId);
    }
    const next = {
      ...current,
      assignedOperatorId: operatorId,
      status: DEVICE_STATUSES.ASSIGNED,
      updatedAt: new Date().toISOString()
    };
    this.devices.set(deviceId, next);
    this.#moveOperatorIndex(current.assignedOperatorId, next.assignedOperatorId, deviceId);
    this.audit.record({
      actorId: actor.id,
      action: "device.assigned",
      resourceType: "device",
      resourceId: deviceId,
      tenantId: operator.tenantId,
      operatorId,
      correlationId: corr,
      previousValue: current,
      newValue: next
    });
    return next;
  }

  updatePosture({
    actor,
    deviceId,
    posture,
    status,
    lastSeenAt = new Date().toISOString(),
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    const current = this.#requireDevice(deviceId);
    this.rbac.assert(actor, "device.posture.update", {
      operatorId: current.assignedOperatorId,
      correlationId: corr
    });
    assertNoOperationalData({ posture });
    if (status && !DEVICE_STATUS_VALUES.has(status)) {
      throw validationError("Unsupported device status", {
        status,
        supported: [...DEVICE_STATUS_VALUES]
      });
    }
    const next = {
      ...current,
      posture: posture || current.posture,
      status: status || current.status,
      lastSeenAt,
      updatedAt: new Date().toISOString()
    };
    this.devices.set(deviceId, next);
    this.#moveOperatorIndex(current.assignedOperatorId, next.assignedOperatorId, deviceId);
    this.audit.record({
      actorId: actor.id,
      action: "device.posture_updated",
      resourceType: "device",
      resourceId: deviceId,
      operatorId: next.assignedOperatorId,
      correlationId: corr,
      previousValue: current,
      newValue: next
    });
    return next;
  }

  attachCertificate({ actor, deviceId, certificateRef, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const current = this.#requireDevice(deviceId);
    this.rbac.assert(actor, "device.certificate.attach", {
      operatorId: current.assignedOperatorId,
      correlationId: corr
    });
    const next = {
      ...current,
      certificateRef: requireText(certificateRef, "certificateRef"),
      updatedAt: new Date().toISOString()
    };
    this.devices.set(deviceId, next);
    this.#moveOperatorIndex(current.assignedOperatorId, next.assignedOperatorId, deviceId);
    this.audit.record({
      actorId: actor.id,
      action: "device.certificate_attached",
      resourceType: "device",
      resourceId: deviceId,
      operatorId: next.assignedOperatorId,
      correlationId: corr,
      previousValue: current,
      newValue: next
    });
    return next;
  }

  list({ actor, operatorId = null, type = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "device.read", { operatorId, correlationId: corr });
    return [...this.devices.values()].filter((device) => {
      return (
        (!operatorId || device.assignedOperatorId === operatorId) && (!type || device.type === type)
      );
    });
  }

  get(id) {
    return this.devices.get(id);
  }

  listForOperatorScoped(operatorId) {
    const deviceIds = this.operatorIndex.get(operatorId);
    if (!deviceIds) {
      return [];
    }
    return [...deviceIds]
      .map((deviceId) => this.devices.get(deviceId))
      .filter(Boolean)
      .sort((a, b) => this.registrationOrder.get(a.id) - this.registrationOrder.get(b.id));
  }

  #addToOperatorIndex(operatorId, deviceId) {
    let deviceIds = this.operatorIndex.get(operatorId);
    if (!deviceIds) {
      deviceIds = new Set();
      this.operatorIndex.set(operatorId, deviceIds);
    }
    deviceIds.add(deviceId);
  }

  #removeFromOperatorIndex(operatorId, deviceId) {
    const deviceIds = this.operatorIndex.get(operatorId);
    if (!deviceIds) {
      return;
    }
    deviceIds.delete(deviceId);
    if (deviceIds.size === 0) {
      this.operatorIndex.delete(operatorId);
    }
  }

  #moveOperatorIndex(previousOperatorId, nextOperatorId, deviceId) {
    if (previousOperatorId === nextOperatorId) {
      return;
    }
    this.#removeFromOperatorIndex(previousOperatorId, deviceId);
    this.#addToOperatorIndex(nextOperatorId, deviceId);
  }

  #requireDevice(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw notFound("device", deviceId);
    }
    return device;
  }
}
