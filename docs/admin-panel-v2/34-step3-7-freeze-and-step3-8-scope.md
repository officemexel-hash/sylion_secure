# SYLION Admin Panel V2 - Step 3.7 Freeze And Step 3.8 Scope

Status: planned
Date: 2026-05-20

## Frozen State

Current implementation head:

```text
365295a Implement Step 3.7 subscription workload controls
```

Step 3.7 is frozen as an implemented slice:

```text
subscription plan catalog
tenant subscription ledger
add-on controls
billing state controls
workload quota quote engine
authorized app workload allocation
microVM placement planner
Admin Web Subscriptions view
dashboard Playwright test checklist
49 passing tests
```

## Frozen Security Decisions

```text
Ksiegi 3.4 baseline remains unchanged.
Every operator keeps 3 isolated VPS: G1, G2 and WORKLOAD.
Workload placement is plan-only until explicitly approved.
CDR remains mandatory.
Puli AX remains router baseline gate.
Provider secrets are references only.
No terminal operational data.
PHANTOM v3.0 remains separate track [A].
PHANTOM add-ons expose admin lifecycle visibility only.
PHANTOM execution remains disabled.
```

## Next Step Name

```text
V2 Step 3.8 - Provisioning Approval Queue, Workload Lifecycle And PHANTOM Control Plane Expansion
```

## Why Step 3.8

Step 3.7 gives the system subscription, quota and placement planning controls. The next missing layer is the approval and lifecycle layer between "plan exists" and "orchestrator/provisioning may act."

Step 3.8 must add:

```text
approval queue before provisioning and workload lifecycle transitions
workload lifecycle state machine
operator enrollment readiness gates
dashboard regression test harness
manual browser test expansion
PHANTOM control-plane review board expansion
PHANTOM policy simulation/test harness expansion
```

## Step 3.8 Scope

Step 3.8 includes:

```text
S3.8-A Provisioning Approval Queue
S3.8-B Workload Lifecycle State Machine
S3.8-C Operator Enrollment Readiness Gate
S3.8-D Orchestrator Preflight Approval Guard
S3.8-E Dashboard Regression Test Harness
S3.8-F Visual And Mobile UI Verification Checklist
S3.8-G PHANTOM Control Plane Review Board
S3.8-H PHANTOM Policy Simulation Test Harness
S3.8-I PHANTOM Evidence And Exception Review Expansion
S3.8-J SDK, Contract And Docs Update
```

## PHANTOM Expansion Boundary

Allowed in Step 3.8:

```text
review board records
exception review records
control-plane status dashboards
simulation-only policy tests
readiness score improvements
evidence coverage maps
approval owner matrix
manual test workflows
dashboard regression tests
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
any production PHANTOM activation
any destructive cleanup
any baseline requirement change
any real orchestrator execution policy change beyond a review gate
any customer-facing PHANTOM claim
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

Step 3.8 is complete only when:

```text
provisioning approval queue exists
orchestrator/provisioning checks approval before execution
workload lifecycle transitions are explicit and audited
operator enrollment readiness gate is visible
PHANTOM control-plane review board exists and remains non-executable
PHANTOM simulation test harness records no side effects
dashboard Playwright regression covers positive and negative flows
mobile/visual checklist exists
npm.cmd test passes
no PHANTOM baseline drift
```

