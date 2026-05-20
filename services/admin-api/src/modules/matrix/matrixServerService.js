import { validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const MATRIX_MODES = new Set(["shared", "dedicated_tenant", "dedicated_operator"]);

export class MatrixServerService {
  constructor({ audit, rbac, entitlements, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.entitlements = entitlements;
    this.servers = new PersistentMap({ store, collection: "matrix_servers" });
  }

  create({ actor, tenantId, operatorId = null, tier, addonEnabled, mode, provider, region, federationEnabled = false, retentionPolicy = "default", backupPolicy = "daily", correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "matrix.server.create", { tenantId, operatorId, correlationId: corr });
    const limits = this.entitlements.getTier(tier);
    if (!limits.matrixAddonAvailable || addonEnabled !== true) {
      throw validationError("Matrix add-on is not enabled for this tenant/operator", { tier });
    }
    if (!MATRIX_MODES.has(mode)) {
      throw validationError("Unknown Matrix server mode", { mode });
    }
    if (mode === "dedicated_operator" && !operatorId) {
      throw validationError("Dedicated operator Matrix requires operatorId");
    }
    if (!provider || !region) {
      throw validationError("Provider and region are required for Matrix server provisioning");
    }

    const server = {
      id: newId("matrix"),
      tenantId,
      operatorId,
      tier,
      mode,
      provider,
      region,
      federationEnabled,
      retentionPolicy,
      backupPolicy,
      certificateStatus: "pending_issue",
      health: "provisioning",
      createdAt: new Date().toISOString()
    };
    this.servers.set(server.id, server);
    this.audit.record({
      actorId: actor.id,
      action: "matrix_server.created",
      resourceType: "matrix_server",
      resourceId: server.id,
      tenantId,
      operatorId,
      correlationId: corr,
      newValue: server
    });
    return server;
  }
}
