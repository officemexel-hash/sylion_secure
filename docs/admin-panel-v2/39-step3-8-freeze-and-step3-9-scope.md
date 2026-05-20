# SYLION Admin Panel V2 - Step 3.8 Freeze And Step 3.9 Scope

Status: planned
Date: 2026-05-20

## Frozen State

Current implementation head:

```text
1bd7902 Implement Step 3.8 approval testing controls
```

Step 3.8 is frozen as an implemented slice:

```text
provisioning approval service
operator readiness checks against Ksiegi 3.4 baseline
workload lifecycle metadata state machine
approval-gated orchestrator strict path
Admin Web Approvals view
PHANTOM review board records
PHANTOM policy simulation records
PHANTOM exception records
SDK methods for Step 3.8 endpoints
openapi-lite Step 3.8 contract notes
dashboard Playwright click-through checklist
system status report vs Ksiegi 3.4 and PHANTOM v3.0
55 passing tests
dashboard click-through: 9/9 scenarios passing
```

## Frozen Security Decisions

```text
Ksiegi 3.4 baseline remains unchanged.
Every operator keeps 3 isolated VPS: G1, G2 and WORKLOAD.
Puli AX remains the access-router baseline gate.
Pixel GrapheneOS and FIDO2 remain readiness gates.
CDR remains mandatory.
Provider secrets remain references only.
No terminal operational data.
Approval-gated orchestrator strict path exists.
Legacy non-strict orchestrator path remains a known migration gap.
PHANTOM v3.0 remains separate track [A].
PHANTOM is governance/control-plane only.
PHANTOM execution remains disabled.
```

## Known Gaps Frozen Into Step 3.9 Backlog

```text
approval must become mandatory for every orchestrator execution path
operator readiness should be persisted as evidence, not dashboard-only last state
dashboard browser tests need first-class harness scripts and mobile viewport coverage
provider adapters need dry-run boundary before any real cloud mutation
PHANTOM review board needs owner workflow, evidence coverage and exception linkage
full status page needs explicit Ksiega 3.4 and PHANTOM readiness score
CI should run API tests and dashboard smoke tests
```

## Next Step Name

```text
V2 Step 3.9 - Mandatory Approval Enforcement, Persistent Readiness, Test Harness And PHANTOM Maturity
```

## Why Step 3.9

Step 3.8 created the approval and PHANTOM governance surface. Step 3.9 must harden it into a more production-shaped control layer:

```text
make approvals mandatory across orchestrator paths
persist readiness snapshots and evidence hashes
turn dashboard clicking into repeatable test harness
add mobile/responsive verification
prepare provider dry-run adapters
expand PHANTOM review board into a complete non-executable workflow
show Ksiega 3.4 and PHANTOM status directly in the admin dashboard
```

## Step 3.9 Scope

Step 3.9 includes:

```text
S3.9-A Mandatory Orchestrator Approval Enforcement
S3.9-B Persistent Operator Readiness Evidence
S3.9-C Approval-To-Lifecycle Binding
S3.9-D Dashboard System Status Matrix
S3.9-E Browser Test Harness Scripts
S3.9-F Mobile And Visual Regression Checks
S3.9-G Provider Adapter Dry-Run Boundary
S3.9-H PHANTOM Review Workflow Maturity
S3.9-I PHANTOM Evidence Coverage Map
S3.9-J PHANTOM Exception Linkage And Expiry
S3.9-K CI And Test Reporting
S3.9-L SDK Contract Docs And Freeze
```

## PHANTOM Expansion Boundary

Allowed in Step 3.9:

```text
review workflow ownership
review board state transitions
evidence coverage maps
exception expiry and owner revalidation
policy simulation coverage scoring
dashboard PHANTOM status cards
audit correlation and test evidence
```

Not allowed:

```text
autonomous PHANTOM execution
production PHANTOM activation
radio identity or identifier manipulation
lawful-control bypass
stealth transport implementation
instructions for evasion or unauthorized access
destructive cover-up behavior
claiming PHANTOM is baseline certified
```

## Human Gate

Planning: no human gate required.

HUMAN GATE REQUIRED before:

```text
making any real provider/cloud mutation
starting real Firecracker workloads
changing Ksiegi 3.4 baseline transport, router or zone assumptions
production PHANTOM activation
customer-facing PHANTOM claims
destructive cleanup workflows
```

Owners:

```text
Architect
CISO
Legal
Compliance
Product
```

## Release Gates

Step 3.9 is complete only when:

```text
all orchestrator execution paths require approval
readiness snapshots are persisted and auditable
workload lifecycle requires matching approval for activation/revocation
dashboard shows Ksiega 3.4 and PHANTOM status matrix
browser test harness can be run repeatably
mobile/desktop visual checks are documented
provider dry-run adapters cannot mutate cloud
PHANTOM workflow links board items, evidence, simulations and exceptions
PHANTOM remains non-executable
npm.cmd test passes
dashboard smoke passes
```

