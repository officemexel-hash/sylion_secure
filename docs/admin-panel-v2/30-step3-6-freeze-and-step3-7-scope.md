# SYLION Admin Panel V2 - Step 3.6 Freeze And Step 3.7 Scope

Status: planned
Date: 2026-05-20

## Frozen State

Current implementation head:

```text
846bb75 Implement Step 3.6 PHANTOM lifecycle gates
```

Step 3.6 is frozen as an implemented slice:

```text
PHANTOM policy template library
PHANTOM capability package builder
PHANTOM sealed evidence bundles
PHANTOM approval packs
PHANTOM readiness/gate evaluator
PHANTOM simulation-only runner
PHANTOM subscription-aware assignment planning
PHANTOM audit correlation
PHANTOM full lifecycle UI controls
45 passing tests
```

## Frozen Security Decisions

```text
PHANTOM v3.0 remains separate track [A]
PHANTOM is outside certifiable SYLION baseline
PHANTOM execution is not enabled
sideEffectAllowed=false for PHANTOM lifecycle records
executionAllowed=false for PHANTOM lifecycle records
executionEnabled=false where applicable
HUMAN GATE REQUIRED before any production PHANTOM behavior
Ksiegi 3.4 baseline remains: 3 VPS per operator, G1/G2/WORKLOAD separation, CDR mandatory, Puli AX gate, WebAuthn step-up, provider secrets by reference only
```

## Next Step Name

```text
V2 Step 3.7 - Subscription, Workload Environment And Billing Controls
```

## Why Step 3.7

The admin panel can already create tenants/operators, providers, devices, plans, PHANTOM governance records and PHANTOM administrative lifecycle records.

The next missing operational management layer is:

```text
subscription plans and add-ons
workload environment quotas
per-operator application allocation
microVM allocation planning
tenant billing state
over-limit prevention
operator-facing entitlement visibility
audit evidence for subscription decisions
```

This step is required before advanced provisioning because environment counts must be policy-controlled before the system creates or rotates workloads.

## Step 3.7 Scope

Step 3.7 includes:

```text
S3.7-A Subscription Plan Catalog
S3.7-B Tenant Subscription Ledger
S3.7-C Workload Environment Quota Engine
S3.7-D Authorized Application Allocation Matrix
S3.7-E MicroVM Sizing And Placement Planner
S3.7-F Add-on Manager For Matrix And PHANTOM Admin Features
S3.7-G Billing State And Suspension Controls
S3.7-H Admin UI Subscription And Workload Views
S3.7-I SDK And Contract Updates
S3.7-J Security And Human Browser Tests
```

## Out Of Scope

Step 3.7 does not include:

```text
payment processor integration
real invoice collection
tax calculation
production cloud resource mutation
autonomous PHANTOM execution
workload secret storage in panel
communication content monitoring
terminal-side operational data
weakening 3 VPS per operator
changing Puli AX router baseline
```

## Subscription Model Baseline

Initial tier model remains:

```text
STANDARD
PRO
SOVEREIGN
```

Each tier must define at least:

```text
maxWorkloadEnvironments
maxAppsPerOperator
regionCount
jurisdictionRotationMode
matrixAddonAvailable
phantomAdminLifecycleAvailable
cdrMandatory
supportLevel
```

## Workload Environment Rule

The user requirement remains:

```text
Limits are counted by application instance, but total cannot exceed the tier limit.
Example: 3 WhatsApp + 2 Signal + 2 Telegram = 7 workload environments.
```

Each workload environment represents a planned isolated microVM/application environment in the operator's workload layer.

## Baseline Isolation Rule

Every operator still has:

```text
G1 VPS
G2 VPS
WORKLOAD VPS
```

No Step 3.7 feature may share one operator's VPS baseline with another operator.

## PHANTOM Boundary

Step 3.7 may expose subscription eligibility for PHANTOM administrative lifecycle features only.

Allowed:

```text
PHANTOM admin lifecycle add-on visibility
PHANTOM governance/readiness feature entitlement
PHANTOM audit/readiness UI labels
```

Not allowed:

```text
PHANTOM autonomous execution
PHANTOM production activation
radio identity or evasion parameters
lawful-control bypass details
stealth transport implementation
destructive cover-up behavior
```

## Release Gates

Step 3.7 can be considered done only when:

```text
subscription plan catalog exists and is auditable
tenant subscription ledger exists
quota checks block over-limit workload allocations
authorized app allocation is counted per app instance and total
Matrix add-on is enforced
PHANTOM admin lifecycle add-on is visible but non-executable
billing suspension blocks new provisioning/workload allocation but does not delete evidence
UI shows subscription state and workload limits with helptips
tests cover allowed, blocked, suspended, add-on and PHANTOM separation cases
npm.cmd test passes
```

