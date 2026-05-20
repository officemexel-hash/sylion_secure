import { APP_STATUSES, CDR_DECISIONS, RESOURCE_TYPES } from "../../domain/constants.js";
import { AppError, notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);
const DIRECTIONS = new Set(["ingress", "egress"]);
const BLOCKING_VERDICTS = new Set(["malicious", "policy_violation", "failed"]);

function requireText(value, field) {
  if (!value || typeof value !== "string" || value.trim().length < 2) {
    throw validationError(`${field} is required`, { field });
  }
  return value.trim();
}

function sanitizeFile(file = {}) {
  const mimeType = requireText(file.mimeType, "file.mimeType");
  return {
    name: requireText(file.name, "file.name"),
    mimeType,
    sizeBytes: Number.isInteger(file.sizeBytes) && file.sizeBytes >= 0 ? file.sizeBytes : 0,
    sha256: file.sha256 || null,
    supported: SUPPORTED_MIME_TYPES.has(mimeType)
  };
}

export class CdrService {
  constructor({ audit, appCatalog, store = null }) {
    this.audit = audit;
    this.appCatalog = appCatalog;
    this.decisions = new PersistentMap({ store, collection: "cdr_decisions" });
    this.monitoringEvents = store ? store.list("cdr_monitoring_events") : [];
    this.store = store;
  }

  decide({
    actor,
    tenantId,
    operatorId,
    appId,
    direction,
    file,
    scanVerdict = "unknown",
    reconstructedObjectRef = null,
    evidence = {},
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    const cdrDirection = requireText(direction, "direction");
    if (!DIRECTIONS.has(cdrDirection)) {
      throw validationError("Unsupported CDR direction", { direction: cdrDirection, supported: [...DIRECTIONS] });
    }

    const app = this.appCatalog.get(appId);
    if (!app) {
      throw notFound("authorized_app", appId);
    }
    if (app.status !== APP_STATUSES.APPROVED || app.cdrRequired !== true) {
      throw new AppError("cdr_app_not_authorized", "CDR can only process approved catalog apps that require CDR", 409, {
        appId,
        status: app.status,
        cdrRequired: app.cdrRequired
      });
    }

    const fileRecord = sanitizeFile(file);
    const decision = this.resolveDecision({ scanVerdict, file: fileRecord, reconstructedObjectRef });
    const record = {
      id: newId("cdr"),
      tenantId: requireText(tenantId, "tenantId"),
      operatorId: requireText(operatorId, "operatorId"),
      appId,
      direction: cdrDirection,
      file: fileRecord,
      scanVerdict,
      decision,
      reconstructedObjectRef: decision === CDR_DECISIONS.ALLOW_RECONSTRUCTED ? reconstructedObjectRef : null,
      evidence: {
        scanner: evidence.scanner || "local-cdr-simulator",
        signatureSet: evidence.signatureSet || "dev",
        contentStored: false
      },
      createdAt: new Date().toISOString()
    };

    this.decisions.set(record.id, record);
    this.audit.record({
      actorId: actor?.id || "system",
      action: "cdr.decision_recorded",
      resourceType: RESOURCE_TYPES.CDR_DECISION,
      resourceId: record.id,
      tenantId: record.tenantId,
      operatorId: record.operatorId,
      correlationId: corr,
      policyDecision: decision === CDR_DECISIONS.ALLOW_RECONSTRUCTED ? "allow" : "deny",
      result: decision === CDR_DECISIONS.ALLOW_RECONSTRUCTED ? "success" : "denied",
      newValue: record
    });
    this.emitMonitoringEvent({ decision: record, correlationId: corr });
    return record;
  }

  resolveDecision({ scanVerdict, file, reconstructedObjectRef }) {
    if (!file.supported || scanVerdict === "unknown" || scanVerdict === "unsupported") {
      return CDR_DECISIONS.QUARANTINE;
    }
    if (BLOCKING_VERDICTS.has(scanVerdict)) {
      return CDR_DECISIONS.BLOCK;
    }
    if (scanVerdict === "clean" && reconstructedObjectRef) {
      return CDR_DECISIONS.ALLOW_RECONSTRUCTED;
    }
    return CDR_DECISIONS.QUARANTINE;
  }

  authorizeTransfer({ actor, decisionId, tenantId, operatorId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const decision = decisionId ? this.decisions.get(decisionId) : null;
    const allowed = Boolean(decision) && decision.decision === CDR_DECISIONS.ALLOW_RECONSTRUCTED;
    const transfer = {
      id: newId("transfer"),
      tenantId: tenantId || decision?.tenantId || null,
      operatorId: operatorId || decision?.operatorId || null,
      decisionId: decisionId || null,
      allowed,
      rule: "No file ingress/egress without CDR decision.",
      reason: allowed ? "cdr_allow_reconstructed" : "missing_or_non_allowing_cdr_decision",
      createdAt: new Date().toISOString()
    };

    this.audit.record({
      actorId: actor?.id || "system",
      action: "cdr.file_transfer_authorized",
      resourceType: RESOURCE_TYPES.FILE_TRANSFER,
      resourceId: transfer.id,
      tenantId: transfer.tenantId,
      operatorId: transfer.operatorId,
      correlationId: corr,
      policyDecision: allowed ? "allow" : "deny",
      result: allowed ? "success" : "denied",
      newValue: transfer
    });
    this.emitMonitoringEvent({ transfer, correlationId: corr });

    if (!allowed) {
      throw new AppError("cdr_decision_required", "No file ingress/egress without CDR decision", 409, transfer);
    }
    return transfer;
  }

  emitMonitoringEvent({ decision, transfer, correlationId }) {
    const event = {
      id: newId("mon"),
      eventType: decision ? "cdr.decision" : "cdr.file_transfer",
      severity: decision?.decision === CDR_DECISIONS.ALLOW_RECONSTRUCTED || transfer?.allowed ? "info" : "warning",
      tenantId: decision?.tenantId || transfer?.tenantId || null,
      operatorId: decision?.operatorId || transfer?.operatorId || null,
      correlationId,
      metric: decision ? "cdr_decision_total" : "cdr_file_transfer_total",
      labels: decision
        ? { decision: decision.decision, direction: decision.direction, appId: decision.appId }
        : { allowed: String(transfer.allowed), reason: transfer.reason },
      timestamp: new Date().toISOString()
    };
    this.monitoringEvents.push(event);
    if (this.store) {
      this.store.save("cdr_monitoring_events", event.id, event);
    }
    return event;
  }

  listDecisions() {
    return [...this.decisions.values()];
  }

  listMonitoringEvents() {
    return [...this.monitoringEvents];
  }
}
