# SYLION Admin Panel V2 - Step 3.9 Freeze And Step 3.10 Scope

Status: freeze candidate
Date: 2026-05-20

## Frozen Step 3.9 State

```text
Mandatory approvalId for orchestrator execution.
Approval-bound workload lifecycle activation path.
Persistent operator readiness snapshots with evidenceHash.
Dashboard Księga 3.4 and PHANTOM status cards.
Provider dry-run VPS planner with no cloud mutation.
PHANTOM review owner acknowledgements.
PHANTOM evidence coverage map.
PHANTOM exception linkage and expiry.
SDK and openapi-lite updated for Step 3.9 endpoints.
Dashboard Playwright checklist and screenshots added.
58 API tests passing.
```

## Security Decisions Frozen

```text
No real cloud mutation.
No real Firecracker execution.
No PHANTOM production activation.
No terminal operational data.
No plaintext provider secrets in responses, audit, readiness or dry-run plans.
CDR remains mandatory.
Puli AX remains router baseline.
Every operator still has 3 VPS: G1, G2, WORKLOAD.
PHANTOM remains separate [A] governance track.
```

## Step 3.10 Name

```text
V2 Step 3.10 - Repeatable Test Harness, Contract Coverage, Visual QA And Release Gate
```

## Step 3.10 Scope

```text
Turn manual Playwright checklist into a repeatable script.
Add structured dashboard smoke result JSON.
Add contract tests for new SDK/openapi-lite endpoints.
Add responsive visual regression evidence for core views.
Add negative dashboard tests for missing approval, dry-run mutation, PHANTOM execution request and expired exception.
Add release gate document that compares system state to Księga 3.4 and PHANTOM every sprint.
```

## Stop Conditions

```text
HUMAN GATE REQUIRED before provider apply mode.
HUMAN GATE REQUIRED before Firecracker execution.
HUMAN GATE REQUIRED before router firmware signing.
HUMAN GATE REQUIRED before HSM/KMS production integration.
HUMAN GATE REQUIRED before customer-facing compliance claims.
HUMAN GATE REQUIRED before any PHANTOM production behavior.
```

