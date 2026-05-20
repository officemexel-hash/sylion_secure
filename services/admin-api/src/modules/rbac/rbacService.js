import { ROLES } from "../../domain/constants.js";
import { forbidden } from "../../lib/errors.js";

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.GLOBAL_SUPER_ADMIN]: ["*"],
  [ROLES.SECURITY_ADMIN]: [
    "operator.read",
    "operator.suspend",
    "operator.revoke",
    "provider.read",
    "provider.secret.rotate",
    "secret.rotate",
    "device.read",
    "device.register",
    "device.assign",
    "device.posture.update",
    "device.certificate.attach",
    "image.artifact.read",
    "image.artifact.build",
    "orchestrator.job.read",
    "orchestrator.plan.execute",
    "provisioning.plan.read",
    "audit.read",
    "auth.credential.read",
    "auth.credential.suspend",
    "auth.credential.revoke",
    "auth.recovery.read",
    "auth.recovery.manage_placeholder",
    "break_glass.request",
    "break_glass.read",
    "break_glass.manage_placeholder",
    "provisioning.plan.generate"
  ],
  [ROLES.PROVISIONING_ADMIN]: [
    "tenant.read",
    "operator.read",
    "operator.create",
    "provider.read",
    "provider.create",
    "secret.create",
    "device.read",
    "device.register",
    "device.assign",
    "image.artifact.read",
    "image.artifact.build",
    "orchestrator.job.read",
    "orchestrator.plan.execute",
    "provisioning.plan.read",
    "provisioning.plan.generate"
  ],
  [ROLES.TENANT_ADMIN]: ["tenant.read", "operator.read", "operator.create"],
  [ROLES.BILLING_ADMIN]: ["tenant.read", "subscription.update"],
  [ROLES.AUDITOR]: ["audit.read", "tenant.read", "operator.read", "provider.read"],
  [ROLES.INCIDENT_COMMANDER]: ["incident.manage", "operator.suspend"],
  [ROLES.SUPPORT_READONLY]: ["tenant.read", "operator.read", "provider.read"]
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
