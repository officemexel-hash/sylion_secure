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
  FILE_TRANSFER: "file_transfer",
  PHANTOM_BOUNDARY: "phantom_boundary",
  PHANTOM_CAPABILITY: "phantom_capability",
  PHANTOM_APPROVAL: "phantom_approval",
  PHANTOM_RISK: "phantom_risk",
  PHANTOM_POLICY_TEMPLATE: "phantom_policy_template",
  PHANTOM_PACKAGE: "phantom_package",
  PHANTOM_EVIDENCE_BUNDLE: "phantom_evidence_bundle",
  PHANTOM_APPROVAL_PACK: "phantom_approval_pack",
  PHANTOM_READINESS: "phantom_readiness",
  PHANTOM_SIMULATION: "phantom_simulation",
  PHANTOM_ASSIGNMENT_PLAN: "phantom_assignment_plan",
  SUBSCRIPTION_PLAN: "subscription_plan",
  TENANT_SUBSCRIPTION: "tenant_subscription",
  WORKLOAD_ALLOCATION: "workload_allocation",
  WORKLOAD_QUOTA_DECISION: "workload_quota_decision",
  MICROVM_PLACEMENT_PLAN: "microvm_placement_plan"
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
