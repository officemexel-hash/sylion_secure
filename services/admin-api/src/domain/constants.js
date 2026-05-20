export const ROLES = Object.freeze({
  GLOBAL_SUPER_ADMIN: "Global Super Admin",
  SECURITY_ADMIN: "Security Admin",
  PROVISIONING_ADMIN: "Provisioning Admin",
  TENANT_ADMIN: "Tenant Admin",
  BILLING_ADMIN: "Billing Admin",
  AUDITOR: "Auditor",
  INCIDENT_COMMANDER: "Incident Commander",
  SUPPORT_READONLY: "Support ReadOnly"
});

export const TIERS = Object.freeze({
  STANDARD: "STANDARD",
  PRO: "PRO",
  SOVEREIGN: "SOVEREIGN"
});

export const OPERATOR_STATUSES = Object.freeze({
  DRAFT: "draft",
  PENDING_APPROVAL: "pending_approval",
  PROVISIONING: "provisioning",
  AWAITING_ENROLLMENT: "awaiting_enrollment",
  ACTIVE: "active",
  DEGRADED: "degraded",
  SUSPENDED: "suspended",
  REVOKED: "revoked"
});

export const RESOURCE_TYPES = Object.freeze({
  TENANT: "tenant",
  OPERATOR: "operator",
  PROVISIONING_PLAN: "provisioning_plan",
  SESSION: "session",
  AUDIT_EVENT: "audit_event"
});

