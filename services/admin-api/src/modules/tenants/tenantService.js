import { RESOURCE_TYPES } from "../../domain/constants.js";
import { validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";

export class TenantService {
  constructor({ audit, rbac, entitlements }) {
    this.audit = audit;
    this.rbac = rbac;
    this.entitlements = entitlements;
    this.tenants = new Map();
  }

  create({ actor, name, tier, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "tenant.create", { correlationId: corr });
    if (!name || name.trim().length < 2) {
      throw validationError("Tenant name is required");
    }
    this.entitlements.getTier(tier);

    const tenant = {
      id: newId("tenant"),
      name: name.trim(),
      tier,
      status: "active",
      createdAt: new Date().toISOString()
    };
    this.tenants.set(tenant.id, tenant);
    this.audit.record({
      actorId: actor.id,
      action: "tenant.created",
      resourceType: RESOURCE_TYPES.TENANT,
      resourceId: tenant.id,
      tenantId: tenant.id,
      correlationId: corr,
      newValue: tenant
    });
    return tenant;
  }

  get(id) {
    return this.tenants.get(id);
  }
}

