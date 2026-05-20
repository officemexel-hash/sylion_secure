import { APP_STATUSES, RESOURCE_TYPES, TIERS } from "../../domain/constants.js";
import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";

const APP_TYPES = new Set(["messaging", "browser", "file_transfer", "productivity", "custom"]);
const RISK_CLASSES = new Set(["low", "medium", "high", "restricted"]);
const TIER_VALUES = new Set(Object.values(TIERS));

function requireText(value, field) {
  if (!value || typeof value !== "string" || value.trim().length < 2) {
    throw validationError(`${field} is required`, { field });
  }
  return value.trim();
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(`${field} is required`, { field });
  }
  return { ...value };
}

function requireAllowedTiers(allowedTiers) {
  if (!Array.isArray(allowedTiers) || allowedTiers.length === 0) {
    throw validationError("allowedTiers must contain at least one tier");
  }
  const unknown = allowedTiers.filter((tier) => !TIER_VALUES.has(tier));
  if (unknown.length > 0) {
    throw validationError("allowedTiers contains unknown tiers", { unknown });
  }
  return [...new Set(allowedTiers)];
}

export class AppCatalogService {
  constructor({ audit, rbac }) {
    this.audit = audit;
    this.rbac = rbac;
    this.apps = new Map();
  }

  create({
    actor,
    name,
    type,
    riskClass,
    allowedTiers,
    microVmDefaults,
    networkPolicy,
    storagePolicy,
    clipboardPolicy,
    cdrRequired,
    templateImage = null,
    operatorResponsibility,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "app.create", { correlationId: corr });

    const appType = requireText(type, "type");
    if (!APP_TYPES.has(appType)) {
      throw validationError("Unsupported app type", { type: appType, supported: [...APP_TYPES] });
    }
    const appRiskClass = requireText(riskClass, "riskClass");
    if (!RISK_CLASSES.has(appRiskClass)) {
      throw validationError("Unsupported risk class", { riskClass: appRiskClass, supported: [...RISK_CLASSES] });
    }

    const app = {
      id: newId("app"),
      name: requireText(name, "name"),
      type: appType,
      riskClass: appRiskClass,
      allowedTiers: requireAllowedTiers(allowedTiers),
      microVmDefaults: requireObject(microVmDefaults, "microVmDefaults"),
      networkPolicy: requireObject(networkPolicy, "networkPolicy"),
      storagePolicy: requireObject(storagePolicy, "storagePolicy"),
      clipboardPolicy: requireObject(clipboardPolicy, "clipboardPolicy"),
      cdrRequired: cdrRequired === true,
      templateImage,
      operatorResponsibility: requireText(operatorResponsibility, "operatorResponsibility"),
      status: APP_STATUSES.PENDING_APPROVAL,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      blockedAt: null
    };

    if (app.cdrRequired !== true) {
      throw validationError("Authorized apps must require CDR for file ingress/egress", { cdrRequired });
    }

    this.apps.set(app.id, app);
    this.audit.record({
      actorId: actor.id,
      action: "authorized_app.created",
      resourceType: RESOURCE_TYPES.AUTHORIZED_APP,
      resourceId: app.id,
      correlationId: corr,
      newValue: app
    });
    return app;
  }

  approve({ actor, appId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "app.approve", { resourceType: RESOURCE_TYPES.AUTHORIZED_APP, resourceId: appId, correlationId: corr });
    return this.updateStatus({ actor, appId, status: APP_STATUSES.APPROVED, action: "authorized_app.approved", timestampField: "approvedAt", correlationId: corr });
  }

  block({ actor, appId, reason, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "app.block", { resourceType: RESOURCE_TYPES.AUTHORIZED_APP, resourceId: appId, correlationId: corr });
    const previous = this.apps.get(appId);
    if (!previous) {
      throw notFound("authorized_app", appId);
    }
    const app = {
      ...previous,
      status: APP_STATUSES.BLOCKED,
      blockedAt: new Date().toISOString(),
      blockReason: requireText(reason || "blocked_by_global_super_admin", "reason")
    };
    this.apps.set(app.id, app);
    this.audit.record({
      actorId: actor.id,
      action: "authorized_app.blocked",
      resourceType: RESOURCE_TYPES.AUTHORIZED_APP,
      resourceId: app.id,
      correlationId: corr,
      previousValue: previous,
      newValue: app
    });
    return app;
  }

  updateStatus({ actor, appId, status, action, timestampField, correlationId }) {
    const previous = this.apps.get(appId);
    if (!previous) {
      throw notFound("authorized_app", appId);
    }
    const app = {
      ...previous,
      status,
      [timestampField]: new Date().toISOString()
    };
    this.apps.set(app.id, app);
    this.audit.record({
      actorId: actor.id,
      action,
      resourceType: RESOURCE_TYPES.AUTHORIZED_APP,
      resourceId: app.id,
      correlationId,
      previousValue: previous,
      newValue: app
    });
    return app;
  }

  get(appId) {
    return this.apps.get(appId);
  }

  list() {
    return [...this.apps.values()];
  }
}
