# SYLION Admin Panel V2 - Step 3.7 Masterplan

## Step Name

```text
V2 Step 3.7 - Subscription, Workload Environment And Billing Controls
```

## Objective

Build the administrative layer that controls what each tenant and operator is allowed to provision before any workload or infrastructure mutation happens.

The panel must let an admin inspect and manage:

```text
subscription tier
paid add-ons
workload environment limits
authorized application allocations
microVM sizing plans
billing state
suspension state
subscription audit evidence
```

## Architecture Decision

Decision: ACCEPT AS PLANNING BASELINE

Human gate: NOT REQUIRED for planning. REQUIRED before real payment processor integration, production suspension automation, customer-facing legal claims, or any PHANTOM production activation.

Architecture impact:

```text
Adds subscription ledger and quota engine around tenant/operator provisioning.
Does not change G1/G2/WORKLOAD baseline.
Does not change CDR requirement.
Does not change Puli AX router gate.
Does not add PHANTOM execution.
```

## Core Invariants

```text
No terminal operational data.
No communication content in subscription, quota, billing or monitoring records.
No provider plaintext secrets.
No workload private keys or app secrets.
No shared VPS baseline between operators.
CDR remains mandatory.
Quota checks happen before workload allocation.
Billing suspension blocks new allocation but preserves evidence and audit.
PHANTOM remains separate track [A].
```

## Module Breakdown

### S3.7-A Subscription Plan Catalog

Responsibility:

```text
Define tier templates and limits.
Expose STANDARD, PRO and SOVEREIGN as auditable plan records.
Support future custom plan records without weakening defaults.
```

Data:

```text
planId
tier
maxWorkloadEnvironments
maxAppsPerOperator
regionCount
jurisdictionRotationMode
matrixAddonAvailable
phantomAdminLifecycleAvailable
cdrMandatory
supportLevel
status
```

Acceptance:

```text
Only authorized roles can create/update custom plans.
Default plans cannot be deleted.
All plans enforce cdrMandatory=true.
No PHANTOM plan flag implies execution.
```

### S3.7-B Tenant Subscription Ledger

Responsibility:

```text
Track each tenant's active subscription plan, add-ons and billing status.
Keep effective entitlement snapshots for audit.
```

Data:

```text
tenantId
tier
planId
addons
billingStatus
suspensionState
effectiveLimits
activatedAt
changedAt
changedBy
```

Acceptance:

```text
Creating a tenant initializes subscription ledger.
Subscription updates are audited.
Suspended tenants cannot create new workload allocations.
Existing audit/evidence remains readable.
```

### S3.7-C Workload Environment Quota Engine

Responsibility:

```text
Count app-instance workload environments per operator.
Block total counts above tier limit.
Block per-app counts above configured limit.
```

Data:

```text
operatorId
tenantId
appKey
requestedCount
currentCount
totalAfterChange
tierLimit
decision
```

Acceptance:

```text
STANDARD, PRO and SOVEREIGN limits are enforced.
Quota decisions are audited.
Denied requests have no side effects.
```

### S3.7-D Authorized Application Allocation Matrix

Responsibility:

```text
Map authorized commercial or custom apps to operator workload allocations.
Count WhatsApp, Signal, Threema, Telegram, Zangi and custom authorized apps by instance.
```

Acceptance:

```text
Only Global Super Admin can authorize app catalog entries.
Operators/admins can allocate only already authorized apps.
CDR requirement must remain visible for file-capable apps.
```

### S3.7-E MicroVM Sizing And Placement Planner

Responsibility:

```text
Plan CPU, memory and disk for each workload environment.
Confirm placement on the operator's own WORKLOAD VPS layer.
Do not execute Firecracker or cloud changes in this step.
```

Acceptance:

```text
Planner returns a plan, not live mutation.
Planner keeps G1/G2/WORKLOAD separation.
No operator receives another operator's VPS resources.
```

### S3.7-F Add-on Manager For Matrix And PHANTOM Admin Features

Responsibility:

```text
Control paid optional add-ons.
Matrix custom server creation remains add-on gated.
PHANTOM admin lifecycle visibility remains add-on gated and non-executable.
```

Acceptance:

```text
Matrix add-on can enable Matrix server manager.
PHANTOM admin lifecycle add-on can expose admin controls.
PHANTOM execution remains false regardless of add-on state.
```

### S3.7-G Billing State And Suspension Controls

Responsibility:

```text
Represent billing state as metadata.
Block new allocation/provisioning when suspended.
Avoid destructive deletion or evidence removal.
```

States:

```text
trial
active
past_due
suspended
cancelled
```

Acceptance:

```text
past_due can warn.
suspended blocks new allocations.
cancelled requires HUMAN GATE before destructive cleanup.
```

### S3.7-H Admin UI Subscription And Workload Views

Responsibility:

```text
Add beautiful, modern and practical panel sections for subscriptions and workload allocation.
Use clear metrics, tables, quota meters and helptips.
```

Required UI:

```text
Subscriptions navigation item or section
tenant subscription cards
tier limit view
add-on toggles
workload allocation form
quota utilization meters
billing state controls
PHANTOM admin lifecycle add-on marker
```

### S3.7-I SDK And Contract Updates

Responsibility:

```text
Add SDK methods and contract documentation for subscription, quota and allocation endpoints.
```

### S3.7-J Security And Human Browser Tests

Responsibility:

```text
Add automated API tests and browser-style human flow checks.
```

## Endpoint Draft

```text
GET  /subscription/plans
POST /subscription/plans
GET  /tenants/:tenantId/subscription
POST /tenants/:tenantId/subscription
POST /tenants/:tenantId/subscription/addons
POST /tenants/:tenantId/billing-state
GET  /operators/:operatorId/workload-allocations
POST /operators/:operatorId/workload-allocations
POST /operators/:operatorId/workload-allocations/quote
POST /operators/:operatorId/microvm-placement-plan
GET  /subscription/quota-decisions
```

## Data Flow

```text
Admin UI
  -> Admin API
  -> RBAC
  -> Subscription Ledger
  -> Entitlement Service
  -> Quota Engine
  -> Authorized App Catalog
  -> Allocation Store
  -> Audit Service
```

## Abuse Cases

```text
User tries to allocate more workload environments than tier allows.
User tries to allocate a non-authorized app.
User tries to bypass Matrix add-on gate.
User tries to enable PHANTOM execution through a paid add-on.
Billing suspension is used to delete evidence.
Readonly role attempts subscription mutation.
Quota denial leaks app secrets or communication content.
```

## Required Tests

```text
default plans are visible
tenant subscription is initialized
subscription updates are audited
over-limit workload allocation is blocked
per-app and total counts are enforced
unauthorized app allocation is blocked
Matrix add-on gate is enforced
PHANTOM admin lifecycle add-on never enables execution
billing suspended tenant cannot allocate new workloads
support readonly cannot mutate subscription
UI static test detects subscription/workload sections and helptips
full human flow covers subscription -> allocation quote -> allocation -> audit
```

## Release Criteria

```text
npm.cmd test passes
docs and contract updated
Mermaid graphs added
status file updated
no plaintext secrets in UI/API/audit
no PHANTOM baseline drift
```

