# KS-G2-2 / API-OPA-30 (Phase A) — SYLION authorization policy skeleton.
#
# Documentation / reference bundle. NOT wired into the runtime authorization
# path: RbacService (services/admin-api/src/modules/rbac/rbacService.js) remains
# authoritative. The OpaPolicyProvider adapter
# (services/admin-api/src/modules/policy/opaPolicyProvider.js) can POST decision
# inputs here once an operator opts in via SYLION_AUTHZ_ENGINE=opa AND a HUMAN
# GATE (Architect + CISO) promotes OPA to enforcing. enforcing=false in Phase A.
#
# Decision path: data.sylion.authz.allow  (SYLION_OPA_DECISION_PATH default
# "sylion/authz/allow"). The adapter posts:
#   { "input": { "actor": {"id","role"}, "action", "resource", "context" } }
# which mirrors the RbacService.assert(actor, action, context) call shape, with
# `resource` carrying { resourceType, resourceId, tenantId, ... }.
#
# This file encodes a FEW representative SYLION rules. It is intentionally a
# skeleton, not a full port of the RBAC permission map. It is syntactically valid
# Rego (OPA v0.x / rego.v1 compatible) but is not executed by the test suite —
# no OPA binary is assumed locally.

package sylion.authz

import rego.v1

# Default deny — fail closed. Matches the adapter's fail-closed posture.
default allow := false

# Structured decision document. The adapter normalizes either a bare `allow`
# boolean or this object form { allow, reasons }.
decision := {
	"allow": allow,
	"reasons": reasons,
}

# Global Super Admin has the "*" permission in the RBAC map — allow, EXCEPT the
# hard PHANTOM-execution boundary below still applies (deny wins).
allow if {
	input.actor.role == "Global Super Admin"
	not phantom_execution_denied
}

# Allow when the actor's role explicitly grants the requested action. This
# mirrors the RBAC role->permission lookup; the binding table is a small
# illustrative subset, not the full ROLE_PERMISSIONS map.
allow if {
	some permission in role_permissions[input.actor.role]
	permission == input.action
	not phantom_execution_denied
}

# Hard boundary: PHANTOM resources never receive execution authorization through
# this policy, regardless of role. Mirrors the runtime invariant
# (record.resourceType !== "phantom" => executionAllowed). Deny always wins.
phantom_execution_denied if {
	input.resource.resourceType == "phantom"
	input.action == "execute"
}

# ---- reasons (advisory; surfaced via decision.reasons) ---------------------

reasons contains "phantom_execution_boundary" if phantom_execution_denied

reasons contains "default_deny" if {
	not allow
	not phantom_execution_denied
}

# ---- illustrative role->permission subset ----------------------------------
# NOT the source of truth. The authoritative map lives in rbacService.js. This
# subset exists only to make the skeleton evaluate sensibly.
role_permissions := {
	"Security Admin": {"operator.read", "audit.read", "release.read"},
	"Auditor": {"audit.read", "tenant.read", "operator.read"},
	"Support ReadOnly": {"tenant.read", "operator.read", "audit.read"},
}
