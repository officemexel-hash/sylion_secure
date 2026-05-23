import { validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

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
  },
  auth_attack: {
    eventType: EVENT_TYPES.ALERT,
    severity: "high",
    summary: "Authentication attack pattern detected",
    resourceKind: "identity"
  },
  key_material_change: {
    eventType: EVENT_TYPES.ALERT,
    severity: "high",
    summary: "Key or credential state changed",
    resourceKind: "key_material"
  },
  cdr_policy_gap: {
    eventType: EVENT_TYPES.ALERT,
    severity: "critical",
    summary: "CDR enforcement gap detected",
    resourceKind: "cdr"
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
  constructor({ audit, rbac, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.events = new PersistentMap({ store, collection: "monitoring_events" });
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

  blueTeamDashboard({ actor, auditEvents = [], cdrDecisions = [], cdrEvents = [], operators = [], correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "audit.read", { correlationId: corr });
    assertNoCommunicationContent({ cdrDecisions, cdrEvents });
    const authEvents = auditEvents.filter((event) => this.#isAuthAttackEvent(event));
    const keyEvents = auditEvents.filter((event) => this.#isKeyMaterialChangeEvent(event));
    const cdrByOperator = new Map();
    for (const decision of cdrDecisions) {
      if (!decision.operatorId) continue;
      const current = cdrByOperator.get(decision.operatorId) || {
        decisions: 0,
        allowed: 0,
        quarantined: 0,
        blocked: 0,
        lastDecisionAt: null
      };
      current.decisions += 1;
      if (decision.decision === "allow_reconstructed") current.allowed += 1;
      if (decision.decision === "quarantine") current.quarantined += 1;
      if (decision.decision === "block") current.blocked += 1;
      current.lastDecisionAt = decision.createdAt || current.lastDecisionAt;
      cdrByOperator.set(decision.operatorId, current);
    }
    const cdrCoverage = operators.map((operator) => {
      const stats = cdrByOperator.get(operator.id) || {
        decisions: 0,
        allowed: 0,
        quarantined: 0,
        blocked: 0,
        lastDecisionAt: null
      };
      return {
        operatorId: operator.id,
        tenantId: operator.tenantId,
        displayName: operator.displayName,
        tier: operator.tier,
        cdrMandatory: true,
        status: stats.decisions > 0 ? "active" : "armed_no_transfers_observed",
        ...stats,
        contentStored: false
      };
    });
    const derivedAlerts = [
      ...this.#groupAuthAttackAlerts(authEvents),
      ...keyEvents.slice(-20).map((event) => ({
        id: `derived-${event.id}`,
        signal: "key_material_change",
        severity: this.#severityForKeyEvent(event),
        summary: "Key, credential, HSM, FIDO2 or provider secret state changed",
        tenantId: event.tenantId,
        operatorId: event.operatorId,
        resource: { id: event.resourceId || event.id, kind: event.resourceType || "key_material" },
        sourceAuditEventId: event.id,
        createdAt: event.timestamp,
        contentStored: false
      })),
      ...cdrCoverage.filter((row) => row.cdrMandatory !== true).map((row) => ({
        id: `derived-cdr-gap-${row.operatorId}`,
        signal: "cdr_policy_gap",
        severity: "critical",
        summary: "Operator does not have mandatory CDR enabled",
        tenantId: row.tenantId,
        operatorId: row.operatorId,
        resource: { id: row.operatorId, kind: "operator" },
        contentStored: false
      }))
    ];
    const storedAlerts = this.list()
      .filter((event) => ["alert", "anomaly_event"].includes(event.eventType))
      .map((event) => ({ ...event, source: "monitoring_store", contentStored: false }));
    const metadataSignals = [
      { key: "audit_events", value: auditEvents.length },
      { key: "auth_attack_events", value: authEvents.length },
      { key: "key_material_change_events", value: keyEvents.length },
      { key: "cdr_decisions", value: cdrDecisions.length },
      { key: "cdr_monitoring_events", value: cdrEvents.length },
      { key: "operators_with_cdr_active", value: cdrCoverage.filter((row) => row.status === "active").length },
      { key: "operators_cdr_armed", value: cdrCoverage.filter((row) => row.status === "armed_no_transfers_observed").length }
    ];
    return {
      status: derivedAlerts.some((alert) => alert.severity === "critical") ? "critical" : derivedAlerts.length || storedAlerts.length ? "watch" : "nominal",
      metadataOnly: true,
      communicationContentStored: false,
      cdrMandatoryForAllOperators: cdrCoverage.every((row) => row.cdrMandatory === true),
      cdrCoverage,
      alerts: [...derivedAlerts, ...storedAlerts]
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 50),
      metadataSignals,
      detectors: [
        "auth_attack",
        "key_material_change",
        "cdr_policy_gap",
        "ipsec_down",
        "dns_leak",
        "microvm_crash_loop",
        "provider_drift"
      ],
      generatedAt: new Date().toISOString()
    };
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

  #isAuthAttackEvent(event) {
    const action = String(event.action || "");
    return event.result === "denied"
      || action.includes("challenge_replayed")
      || action.includes("challenge_failed")
      || action.includes("login_failure")
      || action.includes("lockout")
      || action.includes("account_locked")
      || action.includes("recovery")
      || action.includes("break_glass")
      || action.includes("login_failed");
  }

  #isKeyMaterialChangeEvent(event) {
    const action = String(event.action || "");
    return action.includes("credential")
      || action.includes("cert")
      || action.includes("secret")
      || action.includes("hsm")
      || action.includes("fido2")
      || action.includes("provider.api_secret")
      || action.includes("external_secret_reference");
  }

  #severityForKeyEvent(event) {
    const action = String(event.action || "");
    if (action.includes("revoke") || action.includes("secret") || action.includes("cert.rotate")) return "high";
    return "medium";
  }

  #groupAuthAttackAlerts(events) {
    const groups = new Map();
    for (const event of events) {
      const key = event.actorId || event.operatorId || event.tenantId || "unknown";
      const group = groups.get(key) || {
        actorId: event.actorId,
        tenantId: event.tenantId,
        operatorId: event.operatorId,
        count: 0,
        latestAt: event.timestamp,
        latestEventId: event.id
      };
      group.count += 1;
      if (String(event.timestamp || "") >= String(group.latestAt || "")) {
        group.latestAt = event.timestamp;
        group.latestEventId = event.id;
      }
      groups.set(key, group);
    }
    return [...groups.values()].map((group) => ({
      id: `derived-auth-${group.latestEventId}`,
      signal: "auth_attack",
      severity: group.count >= 3 ? "critical" : "high",
      summary: `Authentication anomaly count: ${group.count}`,
      tenantId: group.tenantId,
      operatorId: group.operatorId,
      resource: { id: group.actorId || group.operatorId || "unknown", kind: "identity" },
      sourceAuditEventId: group.latestEventId,
      createdAt: group.latestAt,
      contentStored: false
    }));
  }
}

export const MONITORING_EVENT_TYPES = EVENT_TYPES;
