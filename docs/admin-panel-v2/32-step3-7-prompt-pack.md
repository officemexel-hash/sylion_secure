# SYLION Admin Panel V2 - Step 3.7 Prompt Pack

## Global Instructions For Every Worker

Use these constraints in every Step 3.7 prompt:

```text
Preserve Ksiegi 3.4 baseline.
Do not weaken 3 VPS per operator.
Do not share operator infrastructure.
Keep CDR mandatory.
Do not store provider secrets, private keys, workload secrets, PINs, biometrics or communication content.
PHANTOM v3.0 remains separate track [A].
PHANTOM add-ons may expose admin lifecycle visibility only; they must not enable execution.
Use existing repo patterns before adding abstractions.
Add tests for allow and deny paths.
Audit policy decisions without leaking sensitive data.
```

## Prompt S3.7-A - Subscription Plan Catalog

Implement the Step 3.7 subscription plan catalog.

Scope:

```text
Add a service module for subscription plans.
Seed STANDARD, PRO and SOVEREIGN plan records.
Expose GET /subscription/plans.
Expose POST /subscription/plans for custom plan draft records.
Add RBAC permissions for subscription read/manage.
Default plans cannot be deleted or weakened.
Every plan must have cdrMandatory=true.
PHANTOM flags must be admin lifecycle only and execution=false.
```

Tests:

```text
default plans are listed
custom plan can be created by Global Super Admin
support readonly cannot create plan
plan with cdrMandatory=false is rejected
plan with PHANTOM execution flag is rejected
```

## Prompt S3.7-B - Tenant Subscription Ledger

Implement tenant subscription ledger.

Scope:

```text
Initialize subscription record when tenant is created.
Expose GET /tenants/:tenantId/subscription.
Expose POST /tenants/:tenantId/subscription.
Store tier, planId, addons, billingStatus, suspensionState and effectiveLimits.
Audit every subscription change.
Preserve read access to audit/evidence after suspension.
```

Tests:

```text
tenant creation initializes ledger
subscription update changes effective limits
readonly cannot mutate
audit contains references only
unknown plan is rejected
```

## Prompt S3.7-C - Workload Environment Quota Engine

Implement workload environment quota engine.

Scope:

```text
Count workload environments by app instance.
Enforce maxWorkloadEnvironments.
Enforce maxAppsPerOperator where configured.
Expose POST /operators/:operatorId/workload-allocations/quote.
Quote endpoint must not create allocations.
Return allow/deny decision with blockers and remaining quota.
Audit quota decisions.
```

Tests:

```text
quote allows within tier
quote blocks above total tier limit
quote blocks above per-app limit
quote has no side effects
quota decision does not leak content or secrets
```

## Prompt S3.7-D - Authorized Application Allocation Matrix

Implement authorized app workload allocation.

Scope:

```text
Expose GET /operators/:operatorId/workload-allocations.
Expose POST /operators/:operatorId/workload-allocations.
Require app to exist in authorized app catalog and be approved.
Store appKey/appId, count, operatorId, tenantId, status and cdrRequired.
Block allocation when quota quote denies.
```

Tests:

```text
approved app can be allocated within quota
blocked/pending/unknown app cannot be allocated
allocation count contributes to total
CDR requirement remains true
allocation audit is content-free
```

## Prompt S3.7-E - MicroVM Sizing And Placement Planner

Implement microVM placement planner.

Scope:

```text
Expose POST /operators/:operatorId/microvm-placement-plan.
Use authorized app microVmDefaults when available.
Return planned vCPU, memory, disk and target layer WORKLOAD.
Do not execute Firecracker.
Do not mutate cloud infrastructure.
Require operator baseline vpsPerOperator=3.
```

Tests:

```text
planner returns WORKLOAD placement
planner rejects unknown allocation
planner never creates orchestrator jobs
planner includes no secrets
```

## Prompt S3.7-F - Add-on Manager For Matrix And PHANTOM Admin Features

Implement add-on handling.

Scope:

```text
Support addons: matrix_custom_server, phantom_admin_lifecycle.
Matrix add-on gates Matrix server creation.
PHANTOM admin lifecycle add-on gates visibility/eligibility only.
PHANTOM execution remains false regardless of add-on.
Expose POST /tenants/:tenantId/subscription/addons.
```

Tests:

```text
Matrix server creation blocked without add-on
Matrix server creation allowed with add-on
PHANTOM lifecycle visible with add-on
PHANTOM execution remains false with add-on
readonly cannot mutate add-ons
```

## Prompt S3.7-G - Billing State And Suspension Controls

Implement billing state metadata and suspension controls.

Scope:

```text
Expose POST /tenants/:tenantId/billing-state.
Supported states: trial, active, past_due, suspended, cancelled.
past_due warns but does not block existing reads.
suspended blocks new workload allocation and provisioning plan execution.
cancelled requires HUMAN GATE marker before destructive cleanup; do not implement deletion.
```

Tests:

```text
suspended tenant cannot create workload allocation
suspended tenant evidence/audit remains readable
cancelled does not delete data
state changes are audited
```

## Prompt S3.7-H - Admin UI Subscription And Workload Views

Implement admin UI Step 3.7.

Scope:

```text
Add Subscriptions nav or section.
Show tenant subscription cards.
Show tier limits and quota utilization.
Add workload allocation form.
Add add-on toggles/controls.
Add billing state controls.
Show PHANTOM admin lifecycle add-on as non-executable.
Add helptips near quota, suspension, add-ons, PHANTOM boundary and workload count.
Use existing visual language: restrained enterprise UI, 8px cards, clear controls, no marketing hero.
```

Tests:

```text
static admin web test finds subscription view
static admin web test finds quota/help tips
browser check confirms /admin loads and subscription controls are visible
```

## Prompt S3.7-I - SDK And Contract Updates

Implement SDK and contract updates.

Scope:

```text
Add SDK methods for plans, tenant subscription, add-ons, billing state, workload quote, allocation and placement plan.
Update openapi-lite.md.
Update implementation status.
```

Tests:

```text
SDK smoke test can drive subscription -> quote -> allocation flow.
Contract examples mention no secrets and no PHANTOM execution.
```

## Prompt S3.7-J - Security And Human Browser Tests

Implement test coverage.

Scope:

```text
Add API tests for Step 3.7.
Add static UI tests.
Run browser check against /admin.
Confirm no PHANTOM execution drift.
Confirm no plaintext secrets in audit.
```

Human browser script:

```text
1. Start Admin API.
2. Open /admin.
3. Enroll/sign in with local simulator.
4. Create tenant and operator.
5. Open Subscriptions.
6. Confirm tier limits are visible.
7. Add Matrix add-on.
8. Create workload allocation quote.
9. Create allocation within quota.
10. Try over-limit allocation and confirm denial.
11. Set billing state suspended.
12. Confirm new allocation is blocked.
13. Open PHANTOM and confirm admin lifecycle remains non-executable.
14. Open Audit and confirm policy decisions are visible.
```

## Integration Prompt I1 - Backend Join

Merge S3.7-A through S3.7-G.

Checklist:

```text
All services use existing PersistentMap pattern.
RBAC permissions are consistent.
Tenant subscription ledger integrates with TenantService.
Quota engine integrates with AppCatalogService and OperatorService.
Matrix add-on gate still works.
PHANTOM add-on does not change execution flags.
Audit events are content-free.
```

## Integration Prompt I2 - UI/API Join

Merge S3.7-H and S3.7-I.

Checklist:

```text
UI fetches subscription state.
UI handles denied quota gracefully.
Forms reset sensitive fields if any are introduced.
Helptips explain quota, billing suspension and PHANTOM separation.
No visible text claims anonymity, invisibility or certified PHANTOM behavior.
```

## Final Test Prompt - Human Complete Test

Act like a human Global Super Admin testing Step 3.7 end to end.

Pass criteria:

```text
Tenant subscription is visible.
Limits are understandable.
Workload quote explains allow/deny.
Allocation within quota succeeds.
Over-limit allocation fails without side effects.
Billing suspension blocks new allocation.
Matrix add-on state is enforced.
PHANTOM admin lifecycle is visible only as separate non-executable track.
Audit stream contains policy decisions and no sensitive data.
UI is usable, modern, clear and has helptips near critical controls.
```

