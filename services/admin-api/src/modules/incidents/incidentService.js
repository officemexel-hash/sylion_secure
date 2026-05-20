import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const DESTRUCTIVE_ACTIONS = new Set([
  "operator.suspend",
  "operator.revoke",
  "device.wipe",
  "vps.destroy",
  "cert.rotate",
  "cert.revoke",
  "microvm.rebuild",
  "workload.isolate"
]);

const DEFAULT_RUNBOOKS = Object.freeze({
  ipsec_down: [
    { title: "Confirm tunnel endpoint health", action: "network.inspect", destructive: false },
    { title: "Rotate affected IPsec certificate if compromise is suspected", action: "cert.rotate", destructive: true },
    { title: "Suspend affected operator access if tunnel cannot be restored", action: "operator.suspend", destructive: true }
  ],
  dns_leak: [
    { title: "Confirm resolver path and kill switch state", action: "network.inspect", destructive: false },
    { title: "Isolate affected workload while resolver policy is repaired", action: "workload.isolate", destructive: true }
  ],
  microvm_crash_loop: [
    { title: "Collect crash-loop metadata and image version", action: "microvm.inspect", destructive: false },
    { title: "Rebuild microVM from approved immutable image", action: "microvm.rebuild", destructive: true }
  ],
  cert_expiry: [
    { title: "Identify certificate owner and service identity", action: "cert.inspect", destructive: false },
    { title: "Rotate certificate through PKI approval flow", action: "cert.rotate", destructive: true }
  ],
  cdr_failure: [
    { title: "Confirm CDR queue and evidence reference", action: "cdr.inspect", destructive: false },
    { title: "Isolate affected workload ingress and egress", action: "workload.isolate", destructive: true }
  ],
  provider_drift: [
    { title: "Compare provider state with approved inventory", action: "provider.inspect", destructive: false },
    { title: "Suspend operator access if ownership boundaries are uncertain", action: "operator.suspend", destructive: true }
  ]
});

function normalizeRunbookTask(task, index) {
  if (!task.title || !task.action) {
    throw validationError("Runbook task title and action are required", { index });
  }
  const destructive = task.destructive === true || DESTRUCTIVE_ACTIONS.has(task.action);
  return {
    id: newId("task"),
    title: task.title,
    action: task.action,
    status: "pending",
    destructive,
    approvalRequired: destructive,
    fourEyes: destructive,
    approvalId: null
  };
}

function defaultRunbook(signal) {
  return (DEFAULT_RUNBOOKS[signal] || [
    { title: "Triage alert metadata and affected resources", action: "incident.triage", destructive: false }
  ]).map(normalizeRunbookTask);
}

export class IncidentService {
  constructor({ audit, rbac, monitoring, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.monitoring = monitoring;
    this.incidents = new PersistentMap({ store, collection: "incidents" });
  }

  createFromAlert({ actor, alertId, ownerId, severity, affectedResources, runbookTasks, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "incident.manage", { correlationId: corr });
    const alert = this.monitoring.get(alertId);
    if (!alert) {
      throw notFound("monitoring_event", alertId);
    }
    if (!["alert", "anomaly_event"].includes(alert.eventType)) {
      throw validationError("Incidents can only be created from alerts or anomaly events", { alertId, eventType: alert.eventType });
    }

    const resources = affectedResources || [alert.resource];
    if (!Array.isArray(resources) || resources.length === 0) {
      throw validationError("Incident affected resources are required");
    }

    const incident = {
      id: newId("inc"),
      sourceAlertId: alert.id,
      sourceSignal: alert.signal,
      status: "open",
      severity: severity || alert.severity,
      tenantId: alert.tenantId,
      operatorId: alert.operatorId,
      ownerId: ownerId || actor.id,
      affectedResources: resources,
      runbookTasks: runbookTasks ? runbookTasks.map(normalizeRunbookTask) : defaultRunbook(alert.signal),
      timeline: [
        {
          id: newId("tl"),
          type: "created_from_alert",
          actorId: actor.id,
          at: new Date().toISOString(),
          note: alert.summary
        }
      ],
      createdAt: new Date().toISOString()
    };
    this.incidents.set(incident.id, incident);
    this.audit.record({
      actorId: actor.id,
      action: "incident.created_from_alert",
      resourceType: "incident",
      resourceId: incident.id,
      tenantId: incident.tenantId,
      operatorId: incident.operatorId,
      correlationId: corr,
      newValue: incident
    });
    return incident;
  }

  addTimelineEntry({ actor, incidentId, type, note, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "incident.manage", { resourceId: incidentId, correlationId: corr });
    const incident = this.getOrThrow(incidentId);
    if (!type || !note) {
      throw validationError("Timeline type and note are required");
    }
    const entry = {
      id: newId("tl"),
      type,
      actorId: actor.id,
      at: new Date().toISOString(),
      note
    };
    incident.timeline.push(entry);
    this.incidents.set(incident.id, incident);
    this.audit.record({
      actorId: actor.id,
      action: "incident.timeline_added",
      resourceType: "incident",
      resourceId: incident.id,
      tenantId: incident.tenantId,
      operatorId: incident.operatorId,
      correlationId: corr,
      newValue: entry
    });
    return incident;
  }

  list() {
    return [...this.incidents.values()];
  }

  getOrThrow(id) {
    const incident = this.incidents.get(id);
    if (!incident) {
      throw notFound("incident", id);
    }
    return incident;
  }
}
