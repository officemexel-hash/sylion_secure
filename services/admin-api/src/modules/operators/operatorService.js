import { OPERATOR_STATUSES, RESOURCE_TYPES } from "../../domain/constants.js";
import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";

export class OperatorService {
  constructor({ audit, rbac, entitlements, tenants }) {
    this.audit = audit;
    this.rbac = rbac;
    this.entitlements = entitlements;
    this.tenants = tenants;
    this.operators = new Map();
  }

  create({ actor, tenantId, displayName, tier, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "operator.create", { tenantId, correlationId: corr });
    const tenant = this.tenants.get(tenantId);
    if (!tenant) {
      throw notFound("tenant", tenantId);
    }
    if (!displayName || displayName.trim().length < 2) {
      throw validationError("Operator display name is required");
    }
    this.entitlements.getTier(tier);

    const operator = {
      id: newId("op"),
      tenantId,
      displayName: displayName.trim(),
      tier,
      status: OPERATOR_STATUSES.DRAFT,
      baseline: {
        vpsPerOperator: 3,
        router: "GL.iNet GL-XE3000 Puli AX",
        cdrMandatory: true
      },
      createdAt: new Date().toISOString()
    };
    this.operators.set(operator.id, operator);
    this.audit.record({
      actorId: actor.id,
      action: "operator.created",
      resourceType: RESOURCE_TYPES.OPERATOR,
      resourceId: operator.id,
      tenantId,
      operatorId: operator.id,
      correlationId: corr,
      newValue: operator
    });
    return operator;
  }

  get(id) {
    return this.operators.get(id);
  }
}

