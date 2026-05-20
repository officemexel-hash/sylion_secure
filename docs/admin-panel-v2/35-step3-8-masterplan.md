# SYLION Admin Panel V2 - Step 3.8 Masterplan

## Step Name

```text
V2 Step 3.8 - Provisioning Approval Queue, Workload Lifecycle And PHANTOM Control Plane Expansion
```

## Objective

Build the control layer that turns subscription-approved plans into audited, human-approved lifecycle actions.

The admin panel must support:

```text
approval queue for provisioning and workload lifecycle changes
explicit workload lifecycle states
operator enrollment readiness gate
orchestrator preflight approval guard
dashboard regression tests
PHANTOM control-plane review board
PHANTOM simulation-only policy tests
PHANTOM exception/evidence review expansion
```

## Architecture Decision

Decision: ACCEPT AS PLANNING BASELINE

Human gate: NOT REQUIRED for planning. REQUIRED before production PHANTOM activation or any baseline execution-policy change.

Baseline impact:

```text
No change to Ksiegi 3.4 baseline.
No change to G1/G2/WORKLOAD separation.
No change to Puli AX baseline.
No change to CDR mandatory rule.
No PHANTOM execution.
```

## Module Breakdown

### S3.8-A Provisioning Approval Queue

Responsibility:

```text
Create approval requests for provisioning plans, workload allocation activation and microVM placement.
Track requester, approvers, decision, blockers and evidence refs.
```

States:

```text
draft
pending_security_review
pending_provisioning_review
approved_for_execution
rejected
blocked
closed
```

Acceptance:

```text
approval records are audited
readonly cannot approve
approved_for_execution does not bypass step-up
PHANTOM records cannot be approved_for_execution
```

### S3.8-B Workload Lifecycle State Machine

Responsibility:

```text
Track workload allocation lifecycle from planned to active/suspended/revoked.
Require approval for activation and revocation.
```

States:

```text
planned
approval_required
approved_for_activation
activating
active
degraded
suspended
revocation_required
revoked
```

Acceptance:

```text
invalid transitions are rejected
state changes are audited
destructive transitions require HUMAN GATE marker
```

### S3.8-C Operator Enrollment Readiness Gate

Responsibility:

```text
Show whether operator has tenant subscription, Pixel, Puli AX, FIDO2, provider reference, app allocation and CDR controls ready.
```

Acceptance:

```text
readiness reports blockers
readiness does not execute provisioning
no secrets in readiness output
```

### S3.8-D Orchestrator Preflight Approval Guard

Responsibility:

```text
Require approved provisioning approval record before orchestrator execution.
Keep step-up enforcement.
```

Acceptance:

```text
orchestrator job denied without approval
orchestrator job denied without fresh step-up
idempotency remains intact
```

### S3.8-E Dashboard Regression Test Harness

Responsibility:

```text
Create repeatable browser-driven dashboard test flow.
Cover login, navigation, subscriptions, workload allocation, approval queue, PHANTOM view and audit.
```

Acceptance:

```text
test creates evidence screenshot
test records positive and negative flows
manual checklist updated
```

### S3.8-F Visual And Mobile UI Verification Checklist

Responsibility:

```text
Validate desktop and mobile dashboard usability.
Check no overlapping UI, readable cards, stable forms and helptips.
```

Acceptance:

```text
desktop screenshot
mobile screenshot
no overlapping text
critical helptips visible
```

### S3.8-G PHANTOM Control Plane Review Board

Responsibility:

```text
Expand PHANTOM admin lifecycle into a review board with owner matrix, review lanes and exception tracking.
```

Allowed states:

```text
intake
legal_review
ciso_review
architect_review
compliance_review
blocked
approved_placeholder
closed
```

Acceptance:

```text
all records sideEffectAllowed=false
executionAllowed=false
humanGateRequired=true
approved_placeholder does not enable execution
```

### S3.8-H PHANTOM Policy Simulation Test Harness

Responsibility:

```text
Add simulation-only test cases for PHANTOM policy packages.
Compare expected controls, evidence coverage and approval owners.
```

Acceptance:

```text
simulation mode only
no live connector
no operational parameters
test results are audit-ready
```

### S3.8-I PHANTOM Evidence And Exception Review Expansion

Responsibility:

```text
Add exception review records tied to evidence bundles, residual risk and review board owners.
```

Acceptance:

```text
exception records cannot request execution
legal/CISO/compliance owner required
audit does not store prohibited details
```

### S3.8-J SDK, Contract And Docs Update

Responsibility:

```text
Update SDK methods, openapi-lite, implementation status, manual tests and diagrams.
```

## Endpoint Draft

```text
GET  /approvals/provisioning
POST /approvals/provisioning
POST /approvals/provisioning/:id/status
GET  /operators/:operatorId/enrollment-readiness
POST /workload-allocations/:id/lifecycle
GET  /phantom/review-board
POST /phantom/review-board
POST /phantom/review-board/:id/status
POST /phantom/policy-simulations
GET  /phantom/policy-simulations
POST /phantom/exceptions
GET  /phantom/exceptions
```

## Test Strategy

```text
API tests for approval queue and lifecycle transitions
negative tests for missing approval and invalid lifecycle transition
PHANTOM tests proving non-execution
dashboard static tests
browser Playwright human regression
mobile/visual checklist
audit leakage checks
```

