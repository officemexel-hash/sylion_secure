# SYLION Admin Panel V2 - Step 3.8 Prompt Pack

## Global Constraints

Use in every prompt:

```text
Preserve Ksiegi 3.4 baseline.
Do not weaken G1/G2/WORKLOAD separation.
Do not store terminal operational data.
Keep CDR mandatory.
Keep provider secrets by reference only.
Keep WebAuthn/step-up for sensitive operations.
PHANTOM v3.0 is separate track [A].
PHANTOM records must keep humanGateRequired=true, sideEffectAllowed=false and executionAllowed=false.
No radio identity, evasion, stealth transport, lawful-control bypass or destructive cover-up details.
```

## Prompt S3.8-A - Provisioning Approval Queue

Implement provisioning approval queue.

Scope:

```text
Add approval service/store for provisioning and workload activation.
Expose list/create/status endpoints.
Require RBAC.
Audit all decisions.
```

Tests:

```text
create approval request
approve request
reject request
readonly denied
PHANTOM request cannot become execution approval
```

## Prompt S3.8-B - Workload Lifecycle State Machine

Implement workload lifecycle transitions.

Scope:

```text
Expose POST /workload-allocations/:id/lifecycle.
Enforce valid transitions.
Require approval for activation/revocation.
Audit every transition.
```

Tests:

```text
planned -> approval_required allowed
planned -> active denied
approved_for_activation -> activating allowed
destructive transition requires HUMAN GATE marker
```

## Prompt S3.8-C - Operator Enrollment Readiness Gate

Implement operator readiness report.

Scope:

```text
Expose GET /operators/:operatorId/enrollment-readiness.
Check subscription, Pixel, Puli AX, FIDO2, provider reference, app allocation, CDR and auth policy.
Return blockers and warnings.
```

Tests:

```text
new operator has blockers
prepared operator shows ready_for_approval
no secrets appear
```

## Prompt S3.8-D - Orchestrator Preflight Approval Guard

Implement preflight guard.

Scope:

```text
Require provisioning approval before orchestrator job execution.
Keep fresh step-up requirement.
Keep idempotency.
```

Tests:

```text
execution denied without approval
execution denied without step-up
execution allowed with approval and step-up
denied execution has no side effects
```

## Prompt S3.8-E - Dashboard Regression Test Harness

Implement dashboard regression harness.

Scope:

```text
Add repeatable browser checklist/test artifact.
Cover dashboard navigation, subscriptions, approval queue, workload lifecycle, PHANTOM and audit.
Capture screenshots.
```

Tests:

```text
browser flow passes
screenshot saved
negative UI denial visible
```

## Prompt S3.8-F - Visual And Mobile UI Verification

Implement visual checklist.

Scope:

```text
Add desktop and mobile viewport verification notes.
Check text wrapping, cards, forms, helptips and nav.
```

Tests:

```text
desktop viewport screenshot
mobile viewport screenshot
no critical overlap noted
```

## Prompt S3.8-G - PHANTOM Control Plane Review Board

Implement PHANTOM review board.

Scope:

```text
Add PHANTOM review board records.
Owner matrix: Architect, CISO, Legal, Compliance.
Review lanes: intake, legal, ciso, architect, compliance, blocked, approved_placeholder, closed.
No execution activation.
```

Tests:

```text
create review board item
move between review states
approved_placeholder still executionAllowed=false
prohibited terms rejected before audit
```

## Prompt S3.8-H - PHANTOM Policy Simulation Harness

Implement PHANTOM simulation harness expansion.

Scope:

```text
Run simulation-only policy test cases against PHANTOM packages.
Validate evidence coverage, owner matrix and blockers.
No live connector.
```

Tests:

```text
simulation_only mode
no side effects
missing evidence creates blocker
audit summary recorded
```

## Prompt S3.8-I - PHANTOM Exception Review Expansion

Implement PHANTOM exception records.

Scope:

```text
Create exception records tied to evidence bundles and review board items.
Require Legal, CISO and Compliance owner.
Allow residual-risk notes only.
No operational parameters.
```

Tests:

```text
exception can be created with owners
exception cannot request execution
prohibited details rejected
```

## Prompt S3.8-J - SDK, Contract And Docs

Implement SDK and docs updates.

Scope:

```text
Add SDK methods.
Update openapi-lite.
Update implementation status.
Update manual tests.
Update diagrams if implementation changes them.
```

## Integration Prompt

Merge Step 3.8.

Checklist:

```text
orchestrator guard checks approval and step-up
workload lifecycle and approval queue agree
dashboard shows approval queue and PHANTOM review board
PHANTOM stays non-executable
audit has allow/deny decisions without secrets
npm.cmd test passes
browser dashboard regression passes
```

## Final Human Test Prompt

Act like a human Global Super Admin.

```text
1. Open /admin.
2. Sign in.
3. Create tenant/operator.
4. Create approved app.
5. Create subscription allocation and placement plan.
6. Create provisioning approval request.
7. Try execution before approval and confirm denial.
8. Approve request.
9. Confirm lifecycle transition is available.
10. Open PHANTOM review board.
11. Create review item and simulation.
12. Confirm PHANTOM remains non-executable.
13. Open Audit and confirm decisions.
14. Run mobile viewport check.
```

