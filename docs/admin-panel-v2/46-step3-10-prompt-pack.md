# SYLION Admin Panel V2 - Step 3.10 Prompt Pack

Status: planned
Date: 2026-05-21

## Global Guardrails For Every Prompt

```text
Use SYLION skills.
Preserve Ksiega 3.4 baseline.
Keep PHANTOM v3.0 separate [A] and non-executable.
Do not add real provider mutation.
Do not start real Firecracker workloads.
Do not store secrets, workload keys, communication content or terminal operational data in tests or artifacts.
Keep CDR mandatory.
Keep Puli AX as the router baseline.
Document every found UI/API problem.
Mark HUMAN GATE REQUIRED for production-risk, legal, compliance or customer-claim decisions.
```

## Prompt S3.10-A - Dashboard Test Runner

```text
Implement a repeatable dashboard Playwright runner for SYLION Admin V2.

Scope:
- start or target the local Admin API
- open /admin
- login using dev/test WebAuthn simulator
- run demo flow
- click Overview, Operators, Providers, Devices, Subscriptions, Approvals, Provisioning, Security, PHANTOM, Audit
- exercise provider dry-run
- exercise readiness and lifecycle controls
- exercise PHANTOM review workflow controls
- capture desktop and mobile screenshots
- write JSON result artifact

Acceptance:
- runner exits non-zero on route-not-found, JS error, missing critical card, horizontal mobile overflow, or failed action
- screenshots are saved under docs/admin-panel-v2/assets or a test artifact folder
- JSON includes pass/fail per view and per critical action
- no secrets or communication content are written
```

## Prompt S3.10-B - SDK And Contract Coverage

```text
Expand SDK and contract tests for Step 3.9/3.10 endpoints.

Scope:
- test AdminApiClient methods for readiness history, get readiness, system status
- test provider dry-run SDK methods
- test PHANTOM review owner ack and evidence coverage SDK methods
- verify openapi-lite mentions mandatory approval and PHANTOM non-execution

Acceptance:
- tests fail if any SDK method points to stale route
- mandatory approval contract is enforced
- PHANTOM coverage returns certificationClaim=false
- provider dry-run returns sideEffectAllowed=false
```

## Prompt S3.10-C - Negative Dashboard Tests

```text
Add dashboard-level negative tests.

Scope:
- missing approval cannot execute job
- empty lifecycle allocation is blocked in UI
- provider apply/mutation mode is not available
- PHANTOM execution request is rejected
- expired exception creates visible blocker
- step-up required path remains clear and auditable

Acceptance:
- dashboard displays safe, user-readable error or toast
- API state is unchanged on denied actions
- audit records deny/blocked decision where applicable
```

## Prompt S3.10-D - Visual And Responsive QA

```text
Add visual regression evidence for critical dashboard views.

Scope:
- capture desktop/mobile screenshots for Overview, Providers, Approvals, PHANTOM and Audit
- check no horizontal overflow
- check controls remain reachable
- check help tips do not obscure critical controls

Acceptance:
- screenshots are stored as artifacts
- mobile overflow check is automated
- findings are written to release gate document
```

## Prompt S3.10-E - PHANTOM Dashboard Maturity

```text
Improve PHANTOM v3.0 dashboard review workflows without enabling execution.

Scope:
- show owner acknowledgement matrix
- show package evidence coverage and blockers
- show exception expiry and revalidation state
- make approved_placeholder visibly non-executable
- keep unsafe claims out of UI copy

Acceptance:
- PHANTOM cards show executionAllowed=false or equivalent non-executable marker
- expired exceptions are visually clear
- coverage is labelled review metric, not certification
- UI does not include operational evasion, stealth, identifier manipulation or bypass language
```

## Prompt S3.10-F - PHANTOM Negative Evidence

```text
Add negative API and dashboard evidence for PHANTOM boundaries.

Scope:
- PHANTOM approval cannot unlock orchestrator execution
- executionRequested=true is rejected
- prohibited operational metadata is rejected
- expired exception blocks readiness/coverage
- all PHANTOM public records preserve non-execution flags

Acceptance:
- tests assert executionAllowed=false and executionEnabled=false
- tests assert no baseline job is created from PHANTOM approval
- tests assert no side effects happen on denial
```

## Prompt S3.10-G - Release Gate Matrix

```text
Generate a release gate document for Step 3.10.

Scope:
- module status table
- Ksiega 3.4 table
- PHANTOM table
- test summary
- problems found and fixes
- residual risks
- HUMAN GATE list
- next sprint scope

Acceptance:
- release gate can be copied to PDF
- every blocked area has owner or next action
- no unsafe product claims are made
```

