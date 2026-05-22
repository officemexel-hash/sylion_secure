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
  PHANTOM_REVIEW_BOARD_ITEM: "phantom_review_board_item",
  PHANTOM_POLICY_SIMULATION: "phantom_policy_simulation",
  PHANTOM_EXCEPTION: "phantom_exception",
  SUBSCRIPTION_PLAN: "subscription_plan",
  TENANT_SUBSCRIPTION: "tenant_subscription",
  WORKLOAD_ALLOCATION: "workload_allocation",
  WORKLOAD_QUOTA_DECISION: "workload_quota_decision",
  MICROVM_PLACEMENT_PLAN: "microvm_placement_plan",
  OPERATOR_PROVISIONING_PIPELINE: "operator_provisioning_pipeline",
  LOCAL_LAB_VPS_SET: "local_lab_vps_set",
  SECRETS_RELEASE_CHECK: "secrets_release_check",
  OPERATOR_ENVIRONMENT: "operator_environment",
  OPERATOR_ENVIRONMENT_EVENT: "operator_environment_event",
  MOCK_FIRECRACKER_RUNTIME: "mock_firecracker_runtime",
  LOCAL_LAB_ROLLBACK: "local_lab_rollback",
  PROVISIONING_APPROVAL: "provisioning_approval",
  OPERATOR_READINESS: "operator_readiness",
  WORKLOAD_LIFECYCLE: "workload_lifecycle",
  PROVIDER_DRY_RUN_PLAN: "provider_dry_run_plan",
  LIVE_EXECUTION_REQUEST: "live_execution_request",
  LIVE_PROVIDER_REHEARSAL: "live_provider_rehearsal",
  DEDICATED_WORKLOAD_ORDER: "dedicated_workload_order",
  FIRECRACKER_HOST_QUALIFICATION: "firecracker_host_qualification",
  FIRECRACKER_LAUNCH_REHEARSAL: "firecracker_launch_rehearsal",
  CPU_CONFIDENTIAL_QUALIFICATION: "cpu_confidential_qualification",
  LIVE_ROLLBACK_PLAN: "live_rollback_plan",
  PHANTOM_EXECUTION_REQUEST: "phantom_execution_request",
  RELEASE_GATE: "release_gate",
  RELEASE_PROBLEM: "release_problem",
  RELEASE_TEST_SCENARIO: "release_test_scenario",
  RELEASE_TEST_RUN: "release_test_run",
  EVIDENCE_ARTIFACT: "evidence_artifact",
  SECURITY_PROFILE: "security_profile",
  OPERATOR_PORTAL_SESSION: "operator_portal_session",
  TERMINAL_CONNECTION_PROFILE: "terminal_connection_profile",
  ROUTER_PACKAGE: "router_package",
  ROUTER_POSTURE: "router_posture"
});

export const DEVICE_TYPES = Object.freeze({
  PIXEL: "pixel_grapheneos",
  ROUTER: "puli_ax_router",
  FIDO2: "fido2_key",
  // Per ADR-terminal-modes-001: laptop web terminal as second operator-facing
  // terminal type alongside Pixel. Skeleton metadata only; rendering protocol,
  // posture validation and IPsec attach deferred to later phases. Not included
  // in baseline readiness loop (provisioningApprovalService) by default —
  // optional/secondary per tier policy.
  LAPTOP_TERMINAL: "laptop_web_terminal"
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
