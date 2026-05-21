import { ROLES } from "../../domain/constants.js";
import { forbidden } from "../../lib/errors.js";

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.GLOBAL_SUPER_ADMIN]: ["*"],
  [ROLES.SECURITY_ADMIN]: [
    "operator.read",
    "operator.suspend",
    "operator.revoke",
    "provider.read",
    "provider.dry_run.plan",
    "provider.secret.rotate",
    "subscription.read",
    "subscription.manage",
    "workload.allocation.read",
    "workload.allocation.manage",
    "workload.placement.plan",
    "workload.lifecycle.manage",
    "operator.readiness.read",
    "provisioning.approval.read",
    "provisioning.approval.manage",
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
    "phantom.boundary.read",
    "phantom.boundary.manage_placeholder",
    "phantom.capability.read",
    "phantom.capability.manage_placeholder",
    "phantom.approval.read",
    "phantom.approval.manage_placeholder",
    "phantom.risk.read",
    "phantom.risk.manage_placeholder",
    "phantom.lifecycle.read",
    "phantom.lifecycle.manage_placeholder",
    "release.read",
    "release.manage",
    "provisioning.plan.generate"
  ],
  [ROLES.PROVISIONING_ADMIN]: [
    "tenant.read",
    "operator.read",
    "operator.create",
    "subscription.read",
    "workload.allocation.read",
    "workload.allocation.manage",
    "workload.placement.plan",
    "workload.lifecycle.manage",
    "operator.readiness.read",
    "provisioning.approval.read",
    "provisioning.approval.manage",
    "provider.read",
    "provider.dry_run.plan",
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
    "release.read",
    "provisioning.plan.generate"
  ],
  [ROLES.TENANT_ADMIN]: ["tenant.read", "operator.read", "operator.create", "subscription.read", "workload.allocation.read", "operator.readiness.read", "provisioning.approval.read"],
  [ROLES.BILLING_ADMIN]: ["tenant.read", "subscription.read", "subscription.manage"],
  [ROLES.AUDITOR]: ["audit.read", "tenant.read", "operator.read", "provider.read", "release.read"],
  [ROLES.INCIDENT_COMMANDER]: ["incident.manage", "operator.suspend"],
  [ROLES.SUPPORT_READONLY]: ["tenant.read", "operator.read", "provider.read", "subscription.read", "workload.allocation.read", "operator.readiness.read", "provisioning.approval.read", "release.read"]
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
