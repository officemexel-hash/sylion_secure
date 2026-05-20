# SYLION Admin Panel V2 - Step 3.9 Prompt Pack

## Global Constraints

Use in every prompt:

```text
Preserve Ksiegi 3.4 baseline.
Do not weaken G1/G2/WORKLOAD separation.
Do not store terminal operational data.
Keep CDR mandatory.
Keep provider secrets by reference only.
Keep WebAuthn/step-up for sensitive operations.
Puli AX remains the router baseline.
PHANTOM v3.0 is separate track [A].
PHANTOM records must keep humanGateRequired=true, sideEffectAllowed=false, executionAllowed=false and executionEnabled=false.
No radio identity, evasion, stealth transport, lawful-control bypass, unauthorized-access or destructive cover-up details.
```

## Prompt S3.9-A - Mandatory Orchestrator Approval Enforcement

Implement mandatory approval for all orchestrator executions.

Scope:

```text
Update POST /orchestrator/jobs.
Require approvalId for every execution.
Require approved_for_execution status.
Remove legacy non-strict bypass.
Preserve fresh step-up and idempotency.
Update existing tests to create and approve approval records before execution.
```

Tests:

```text
missing approvalId denied
pending approval denied
rejected approval denied
approved approval allowed after step-up
PHANTOM approval denied
no side effects on denial
```

## Prompt S3.9-B - Persistent Operator Readiness Evidence

Persist readiness snapshots.

Scope:

```text
Add readiness PersistentMap.
Expose GET /operators/:operatorId/readiness/history.
Expose GET /readiness/:readinessId.
Seal readiness summary hash.
Update dashboard to show latest readiness.
```

Tests:

```text
prepared operator creates ready snapshot
blocked operator creates blockers snapshot
snapshot contains no secrets
snapshot survives persistent store restart
audit links readiness id
```

## Prompt S3.9-C - Approval-To-Lifecycle Binding

Require approval for activation/revocation transitions.

Scope:

```text
Extend workload lifecycle transition endpoint with approvalId.
Validate approval operator/allocation binding.
Require approval for approved_for_activation and revoked transitions.
Prevent approval reuse across unrelated allocations.
```

Tests:

```text
transition without approval denied
wrong operator approval denied
matching approval accepted
destructive transition requires reason and approval
```

## Prompt S3.9-D - Dashboard System Status Matrix

Add Ksiega 3.4 and PHANTOM status matrix to dashboard.

Scope:

```text
Add status cards or table to Overview/Security.
Statuses: implemented, partial, blocked, next.
Include Ksiega 3.4 baseline gates and PHANTOM v3.0 separation.
Add helptips for approval, CDR, Puli AX, provider secrets and PHANTOM.
```

Tests:

```text
static UI test checks status matrix ids
browser test verifies matrix visible
PHANTOM status says non-executable
known gaps are visible
```

## Prompt S3.9-E - Browser Test Harness Scripts

Create repeatable dashboard test harness.

Scope:

```text
Create a documented local browser smoke workflow.
Avoid unsupported locator.fill path.
Click through all primary views.
Wait for async card render.
Write screenshot and JSON summary.
```

Tests:

```text
browser smoke passes
provider card wait prevents race
audit stream visible
result file lists all scenarios
```

## Prompt S3.9-F - Mobile And Visual Regression Checks

Add mobile and desktop visual checks.

Scope:

```text
Use browser viewport capability when available.
Check desktop and mobile layouts.
Capture screenshots.
Document overlap, wrapping and navigation findings.
```

Tests:

```text
desktop screenshot saved
mobile screenshot saved
critical controls reachable
no text overlap in key cards/forms
```

## Prompt S3.9-G - Provider Adapter Dry-Run Boundary

Implement provider adapter dry-run planning.

Scope:

```text
Create provider adapter interface.
Implement Hetzner and OVH dry-run planners.
Input: provider reference, region, operator baseline, requested resources.
Output: planned cloud actions only.
No real API mutation.
```

Tests:

```text
dry-run returns planned G1/G2/WORKLOAD actions
secret value never appears
real mutation mode denied
audit records dry_run only
```

## Prompt S3.9-H - PHANTOM Review Workflow Maturity

Mature PHANTOM review board workflow.

Scope:

```text
Add owner acknowledgement fields.
Block approved_placeholder until required owners acknowledge.
Keep execution disabled.
Add dashboard controls for owner status.
```

Tests:

```text
missing owner ack blocks approval placeholder
all owners ack allows approved_placeholder
approved_placeholder still executionAllowed=false
prohibited details rejected
```

## Prompt S3.9-I - PHANTOM Evidence Coverage Map

Implement PHANTOM evidence coverage.

Scope:

```text
Map package -> policy template -> evidence -> approval pack -> review board -> simulations.
Compute coverage score, missing evidence and blockers.
Expose API and dashboard cards.
```

Tests:

```text
missing evidence lowers coverage
complete evidence raises coverage
coverage is not certification claim
coverage has no side effects
```

## Prompt S3.9-J - PHANTOM Exception Linkage And Expiry

Implement exception linkage and expiry.

Scope:

```text
Link exception to package, review board item and evidence bundle.
Require expiry/revalidation date.
Expired exception blocks readiness and returns review_required.
Reject executionRequested=true.
```

Tests:

```text
exception without expiry denied
expired exception blocks readiness
linked exception appears in package coverage
execution request denied
```

## Prompt S3.9-K - CI And Test Reporting

Prepare CI-friendly reporting.

Scope:

```text
Document commands.
Add test summary artifact format.
Ensure npm.cmd test stays stable.
Add dashboard smoke result documentation.
```

Tests:

```text
npm.cmd test passes
test summary generated
dashboard smoke checklist updated
```

## Prompt S3.9-L - SDK Contract Docs And Freeze

Update integration surface and freeze docs.

Scope:

```text
Add SDK methods for new Step 3.9 endpoints.
Update openapi-lite.
Update Mermaid diagrams.
Create Step 3.9 freeze candidate docs.
```

Tests:

```text
SDK methods covered by persistence or contract test
openapi-lite mentions mandatory approval
docs include module, deployment, runtime and roadmap Mermaid graphs
```

