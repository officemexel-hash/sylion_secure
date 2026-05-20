import { ROLES } from "../../domain/constants.js";
import { forbidden } from "../../lib/errors.js";

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.GLOBAL_SUPER_ADMIN]: ["*"],
  [ROLES.SECURITY_ADMIN]: [
    "operator.read",
    "operator.suspend",
    "operator.revoke",
    "audit.read",
    "provisioning.plan.generate"
  ],
  [ROLES.PROVISIONING_ADMIN]: [
    "tenant.read",
    "operator.read",
    "operator.create",
    "provisioning.plan.generate"
  ],
  [ROLES.TENANT_ADMIN]: ["tenant.read", "operator.read", "operator.create"],
  [ROLES.BILLING_ADMIN]: ["tenant.read", "subscription.update"],
  [ROLES.AUDITOR]: ["audit.read", "tenant.read", "operator.read"],
  [ROLES.INCIDENT_COMMANDER]: ["incident.manage", "operator.suspend"],
  [ROLES.SUPPORT_READONLY]: ["tenant.read", "operator.read"]
});

export class RbacService {
  constructor({ audit }) {
    this.audit = audit;
  }

  can(actor, action) {
    const permissions = ROLE_PERMISSIONS[actor?.role] || [];
    return permissions.includes("*") || permissions.includes(action);
  }

  assert(actor, action, context = {}) {
    const allowed = this.can(actor, action);
    this.audit.record({
      actorId: actor?.id,
      action: "rbac.permission_check",
      resourceType: context.resourceType || "permission",
      resourceId: context.resourceId || action,
      tenantId: context.tenantId,
      operatorId: context.operatorId,
      correlationId: context.correlationId,
      policyDecision: allowed ? "allow" : "deny",
      result: allowed ? "success" : "denied",
      newValue: { checkedAction: action, role: actor?.role }
    });

    if (!allowed) {
      throw forbidden(action);
    }
  }
}

