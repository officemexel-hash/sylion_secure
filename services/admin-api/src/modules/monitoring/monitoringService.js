import { validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";

const EVENT_TYPES = Object.freeze({
  HEALTH_STATUS: "health_status",
  ALERT: "alert",
  ANOMALY_EVENT: "anomaly_event"
});

const SIGNAL_DEFINITIONS = Object.freeze({
  ipsec_down: {
    eventType: EVENT_TYPES.ALERT,
    severity: "critical",
    summary: "IPsec tunnel down",
    resourceKind: "network"
  },
  dns_leak: {
    eventType: EVENT_TYPES.ANOMALY_EVENT,
    severity: "critical",
    summary: "DNS leak detected",
    resourceKind: "network"
  },
  microvm_crash_loop: {
    eventType: EVENT_TYPES.ALERT,
    severity: "high",
    summary: "microVM crash loop",
    resourceKind: "microvm"
  },
  cert_expiry: {
    eventType: EVENT_TYPES.ALERT,
    severity: "high",
    summary: "Certificate nearing expiry",
    resourceKind: "certificate"
  },
  cdr_failure: {
    eventType: EVENT_TYPES.ALERT,
    severity: "high",
    summary: "CDR processing failure",
    resourceKind: "cdr"
  },
  provider_drift: {
    eventType: EVENT_TYPES.ANOMALY_EVENT,
    severity: "medium",
    summary: "Provider configuration drift",
    resourceKind: "provider"
  }
});

const CONTENT_FIELD_NAMES = new Set([
  "content",
  "message",
  "body",
  "payload",
  "plaintext",
  "conversation",
  "chat",
  "text",
  "fileContents",
  "packetCapture"
]);

function assertNoCommunicationContent(value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCommunicationContent(item, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (CONTENT_FIELD_NAMES.has(key)) {
      throw validationError("Monitoring telemetry must not include communication content", {
        field: [...path, key].join("."),
        invariant: "no_communication_content"
      });
    }
    assertNoCommunicationContent(nested, [...path, key]);
  }
}

function metadata(input) {
  return {
    detector: input.detector || "admin-api",
    observedAt: input.observedAt || new Date().toISOString(),
    evidenceRef: input.evidenceRef || null,
    metric: input.metric || null,
    threshold: input.threshold || null,
    observedValue: input.observedValue || null
  };
}

export class MonitoringService {
  constructor({ audit, rbac }) {
    this.audit = audit;
    this.rbac = rbac;
    this.events = new Map();
  }

  recordHealthStatus({ actor, tenantId, operatorId, resource, status, details = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "audit.read", { tenantId, operatorId, correlationId: corr });
    assertNoCommunicationContent(details);
    if (!resource?.id || !resource?.kind) {
      throw validationError("Health status resource id and kind are required");
    }
    if (!["healthy", "degraded", "down", "unknown"].includes(status)) {
      throw validationError("Unsupported health status", { allowed: ["healthy", "degraded", "down", "unknown"] });
    }

    return this.storeEvent({
      actor,
      eventType: EVENT_TYPES.HEALTH_STATUS,
      signal: "health_status",
      severity: status === "healthy" ? "info" : "medium",
      tenantId,
      operatorId,
      resource,
      summary: `${resource.kind} ${status}`,
      details: { ...metadata(details), status },
      correlationId: corr
    });
  }

  recordSignal({ actor, signal, tenantId, operatorId, resource = {}, details = {}, severity, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "audit.read", { tenantId, operatorId, correlationId: corr });
    assertNoCommunicationContent({ resource, details });
    const definition = SIGNAL_DEFINITIONS[signal];
    if (!definition) {
      throw validationError("Unsupported monitoring signal", { signal, allowed: Object.keys(SIGNAL_DEFINITIONS) });
    }
    if (!resource.id) {
      throw validationError("Monitoring signal resource id is required");
    }

    return this.storeEvent({
      actor,
      eventType: definition.eventType,
      signal,
      severity: severity || definition.severity,
      tenantId,
      operatorId,
      resource: {
        id: resource.id,
        kind: resource.kind || definition.resourceKind
      },
      summary: definition.summary,
      details: metadata(details),
      correlationId: corr
    });
  }

  get(id) {
    return this.events.get(id);
  }

  list(filter = {}) {
    return [...this.events.values()].filter((event) => {
      return (!filter.eventType || event.eventType === filter.eventType)
        && (!filter.operatorId || event.operatorId === filter.operatorId)
        && (!filter.tenantId || event.tenantId === filter.tenantId);
    });
  }

  storeEvent(input) {
    const event = {
      id: newId("mon"),
      eventType: input.eventType,
      signal: input.signal,
      severity: input.severity,
      tenantId: input.tenantId || null,
      operatorId: input.operatorId || null,
      resource: input.resource,
      summary: input.summary,
      details: input.details,
      createdAt: new Date().toISOString()
    };
    this.events.set(event.id, event);
    this.audit.record({
      actorId: input.actor.id,
      action: `monitoring.${input.eventType}`,
      resourceType: "monitoring_event",
      resourceId: event.id,
      tenantId: event.tenantId,
      operatorId: event.operatorId,
      correlationId: input.correlationId,
      newValue: event
    });
    return event;
  }
}

export const MONITORING_EVENT_TYPES = EVENT_TYPES;
