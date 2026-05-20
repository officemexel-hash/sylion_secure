# SYLION Admin Panel V2 - Step 3.9 Masterplan

## Step Name

```text
V2 Step 3.9 - Mandatory Approval Enforcement, Persistent Readiness, Test Harness And PHANTOM Maturity
```

## Objective

Convert Step 3.8 from a working approval/control-plane slice into a stricter implementation stage:

```text
approval is mandatory before orchestrator execution
readiness is preserved as audit evidence
dashboard has a clear Ksiega 3.4 and PHANTOM status matrix
browser tests are repeatable instead of ad hoc
provider integrations are prepared in dry-run mode only
PHANTOM review workflow becomes richer but remains non-executable
```

## Architecture Decision

Decision: ACCEPT AS PLANNING BASELINE

Human gate: NOT REQUIRED for planning and non-mutating implementation. REQUIRED before real cloud, Firecracker, router, HSM/KMS or PHANTOM production behavior.

Baseline impact:

```text
No change to Ksiegi 3.4 baseline.
No change to G1/G2/WORKLOAD separation.
No change to Puli AX router baseline.
No change to IPsec IKEv2 baseline assumption.
No change to CDR mandatory rule.
No PHANTOM execution.
```

Compliance verdict:

```text
Step 3.9 is compliance-positive if it strengthens approval, evidence, audit and testability.
Step 3.9 must not claim certification or anonymity.
PHANTOM must be described as separate-track governance only.
```

## Module Breakdown

### S3.9-A Mandatory Orchestrator Approval Enforcement

Responsibility:

```text
Remove legacy non-strict orchestrator execution path.
Require approvalId for every POST /orchestrator/jobs call.
Require approval status approved_for_execution.
Keep fresh WebAuthn step-up and idempotency.
```

Acceptance:

```text
orchestrator execution without approvalId returns 422
orchestrator execution with pending/rejected approval returns 422
orchestrator execution without fresh step-up remains blocked
approved PHANTOM records cannot unlock execution
existing tests are migrated to approval-first flow
```

### S3.9-B Persistent Operator Readiness Evidence

Responsibility:

```text
Persist readiness evaluations in storage.
Expose list/get endpoints.
Seal readiness evidence summary with hash.
Show latest readiness per operator in dashboard.
```

Acceptance:

```text
readiness snapshots survive refresh/restart when persistent store is used
no secrets in readiness snapshots
blockers and warnings are queryable
audit event references readiness snapshot id
```

### S3.9-C Approval-To-Lifecycle Binding

Responsibility:

```text
Bind workload lifecycle activation/revocation to a matching approval record.
Activation requires approved_for_execution approval.
Revocation/destructive states require explicit human gate metadata.
```

Acceptance:

```text
planned -> approval_required remains allowed
approval_required -> approved_for_activation requires approvalId
revocation_required -> revoked requires reason and approvalId
approval cannot be reused across unrelated operator/allocation
```

### S3.9-D Dashboard System Status Matrix

Responsibility:

```text
Add dashboard status matrix for Ksiega 3.4 and PHANTOM v3.0.
Show implemented, partial, blocked and next action states.
Make gaps visible without marketing claims.
```

Acceptance:

```text
dashboard shows Ksiega 3.4 baseline gates
dashboard shows PHANTOM non-executable state
known gaps are visible
helptips explain critical controls
```

### S3.9-E Browser Test Harness Scripts

Responsibility:

```text
Create repeatable dashboard test script/checklist artifact.
Cover login, operators, providers, devices, subscriptions, approvals, provisioning, PHANTOM and audit.
Record known browser backend limitations.
```

Acceptance:

```text
test script can be run after local server starts
test waits for async cards
test avoids unsupported fill path
test writes result summary and screenshot
```

### S3.9-F Mobile And Visual Regression Checks

Responsibility:

```text
Add responsive viewport checks for dashboard.
Verify no overlapping text, forms, cards, nav or helptips.
Capture desktop and mobile screenshots.
```

Acceptance:

```text
desktop screenshot exists
mobile screenshot exists
critical controls remain reachable
no obvious layout overlap
```

### S3.9-G Provider Adapter Dry-Run Boundary

Responsibility:

```text
Create provider adapter interface for Hetzner/OVH dry-run planning.
Return planned actions only.
No real cloud mutations.
No plaintext secret leakage.
```

Acceptance:

```text
dry-run create VPS plan returns no side effects
provider secret reference is used, not secret value
real mutation mode is blocked behind HUMAN GATE marker
tests prove no cloud connector is invoked
```

### S3.9-H PHANTOM Review Workflow Maturity

Responsibility:

```text
Expand PHANTOM review board transitions and owner matrix.
Track required owner acknowledgements.
Block approved_placeholder unless required owners and evidence exist.
```

Acceptance:

```text
missing Legal/CISO/Architect/Compliance owner blocks placeholder approval
approved_placeholder still executionAllowed=false
workflow transitions are audited
prohibited details are rejected
```

### S3.9-I PHANTOM Evidence Coverage Map

Responsibility:

```text
Map PHANTOM packages to required evidence, simulations, approvals and board items.
Compute coverage percentage and blockers.
```

Acceptance:

```text
coverage map is simulation/control-plane only
missing evidence creates blocker
dashboard shows coverage without implying certification
```

### S3.9-J PHANTOM Exception Linkage And Expiry

Responsibility:

```text
Link exceptions to packages, review board items and evidence.
Add expiry/revalidation date.
Auto-mark stale exceptions as review_required.
```

Acceptance:

```text
exception requires owners
exception requires expiry/revalidation
expired exception blocks readiness
executionRequested remains rejected
```

### S3.9-K CI And Test Reporting

Responsibility:

```text
Prepare CI-friendly test command and report files.
Include API tests, static UI tests and dashboard smoke checklist.
```

Acceptance:

```text
npm.cmd test passes
dashboard smoke result is documented
test summary is written to docs or artifacts
```

### S3.9-L SDK Contract Docs And Freeze

Responsibility:

```text
Update SDK methods, openapi-lite, diagrams, status docs and freeze package.
```

Acceptance:

```text
contract documents mandatory approval
docs include Mermaid graphs
freeze includes commit hash and test status
```

## Parallel Work Plan

```text
Developer A: S3.9-A, S3.9-C
Developer B: S3.9-B, S3.9-D
Developer C: S3.9-E, S3.9-F, S3.9-K
Developer D: S3.9-G
Developer E: S3.9-H, S3.9-I, S3.9-J
Integrator: S3.9-L and release gate
```

## Stop Conditions

Stop and require human decision if implementation needs:

```text
real cloud mutation
real Firecracker start/stop
router firmware signing
HSM/KMS production connection
customer-facing compliance claims
PHANTOM production activation
```

