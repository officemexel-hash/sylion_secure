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
  PROVIDER: "provider",
  SECRET: "secret",
  PROVISIONING_PLAN: "provisioning_plan",
  SESSION: "session",
  AUDIT_EVENT: "audit_event",
  AUTHORIZED_APP: "authorized_app",
  CDR_DECISION: "cdr_decision",
  FILE_TRANSFER: "file_transfer"
});

export const DEVICE_TYPES = Object.freeze({
  PIXEL: "pixel_grapheneos",
  ROUTER: "puli_ax_router",
  FIDO2: "fido2_key"
});

export const DEVICE_STATUSES = Object.freeze({
  REGISTERED: "registered",
  ASSIGNED: "assigned",
  ENROLLING: "enrolling",
  ACTIVE: "active",
  DEGRADED: "degraded",
  REVOKED: "revoked"
});

export const APP_STATUSES = Object.freeze({
  PENDING_APPROVAL: "pending_approval",
  APPROVED: "approved",
  BLOCKED: "blocked"
});

export const CDR_DECISIONS = Object.freeze({
  ALLOW_RECONSTRUCTED: "allow_reconstructed",
  BLOCK: "block",
  QUARANTINE: "quarantine"
});
