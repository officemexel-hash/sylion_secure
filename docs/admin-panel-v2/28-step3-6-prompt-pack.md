# SYLION Admin Panel V2 - Step 3.6 Prompt Pack

## Instrukcja Wspolna

```text
Pracujesz w repo SYLION Secure.

Hard invariants:
- PHANTOM v3.0 remains separate track [A], outside certifiable baseline.
- Do not implement operational PHANTOM execution.
- Do not include instructions or parameters for radio identity, IMEI/IMSI, stealth transport, evasion, lawful-control bypass, unauthorized access, or destructive cover-up.
- Every PHANTOM lifecycle object must keep humanGateRequired=true.
- Baseline executionAllowed=false and sideEffectAllowed=false.
- CDR, G1/G2, HSM/PKI, Matrix, Firecracker, Puli AX gate, WebAuthn and audit invariants remain intact.
- Add tests and run npm.cmd test.
```

## Prompt S3.6-A - Capability Package Builder

```text
Implement PHANTOM Capability Package Builder.

Scope:
- Add package model to phantom service.
- Fields: id, name, version, classification, requiredApprovals, requiredEvidenceRefs, riskControls, operatorEligibility, entitlementConstraints, readinessGateRefs.
- Add endpoints:
  GET /phantom/packages
  POST /phantom/packages
  POST /phantom/packages/:id/status
- Always return humanGateRequired=true, sideEffectAllowed=false, executionEnabled=false.
- Reject operational/prohibited details.

Acceptance:
- Tests cover create/list/status.
- approved_placeholder does not enable execution.
```

## Prompt S3.6-B - Policy Template Library

```text
Implement PHANTOM Policy Template Library.

Scope:
- Add read-only seeded policy templates:
  legal_review_policy, ciso_review_policy, architect_review_policy,
  evidence_required_policy, jurisdiction_review_policy,
  data_residency_review_policy, operator_assignment_policy,
  monitoring_correlation_policy, execution_gate_policy.
- Add endpoints:
  GET /phantom/policy-templates
  POST /phantom/policy-templates/:id/decision
- Decisions are governance records only.

Acceptance:
- No template contains operational instructions.
- Decisions are audited.
```

## Prompt S3.6-C - Readiness And Gate Engine

```text
Implement PHANTOM Readiness And Gate Engine.

Scope:
- Compute readinessScore 0-100 from approvals/evidence/risk/operator/entitlement gates.
- Return blockingGates[] and warnings[].
- Add endpoint:
  POST /phantom/readiness/evaluate
- Baseline always returns executionAllowed=false unless HUMAN GATE decision object exists, and even then do not execute.

Acceptance:
- Missing evidence lowers readiness.
- Missing legal/CISO/architect approvals are blockers.
- executionAllowed remains false in Step 3.6 tests.
```

## Prompt S3.6-D - Approval Pack Builder

```text
Implement PHANTOM Approval Pack Builder.

Scope:
- Add approval pack model:
  packageId, readinessScore, blockingGates, evidenceRefs, riskSummary, owners, residualRisk, recommendation.
- Add endpoints:
  GET /phantom/approval-packs
  POST /phantom/approval-packs
  POST /phantom/approval-packs/:id/status
- Status approved_placeholder must not enable execution.

Acceptance:
- Pack is auditable and safe to export as governance evidence.
- No operational details.
```

## Prompt S3.6-E - Evidence Bundle Store

```text
Implement PHANTOM Evidence Bundle Store.

Scope:
- Add evidence bundle model:
  refs, owner, classification, retentionPolicy, hash/reference, createdAt.
- Add endpoints:
  GET /phantom/evidence-bundles
  POST /phantom/evidence-bundles
- Store references only, never secrets or file contents.

Acceptance:
- Reject content/body/payload/plaintext fields.
- Audit contains refs only.
```

## Prompt S3.6-F - Simulation-Only Risk Runner

```text
Implement PHANTOM Simulation-Only Risk Runner.

Scope:
- Add endpoint:
  POST /phantom/simulations/risk
- Allow simulations:
  policy completeness, approval readiness, missing evidence,
  operator eligibility, audit coverage.
- No live network/device/radio/PHANTOM execution.

Acceptance:
- sideEffectAllowed=false.
- simulationType outside allowlist is rejected.
- audit proves no execution.
```

## Prompt S3.6-G - Entitlement And Tier Hooks

```text
Implement PHANTOM Entitlement And Tier Hooks.

Scope:
- Add tier policy:
  STANDARD read-only summary
  PRO registry/risk read
  SOVEREIGN approval packs/readiness scoring
  ENTERPRISE future requires contract/legal approval placeholder
- Tie checks to existing entitlements where practical.

Acceptance:
- Entitlements gate admin actions, not execution.
- No tier enables operational PHANTOM behavior.
```

## Prompt S3.6-H - Operator Assignment Planning

```text
Implement PHANTOM Operator Assignment Planning.

Scope:
- Add planning object:
  operatorId, packageId, readiness, required posture, device posture, Puli AX gate, WebAuthn posture, 3 VPS baseline state.
- Add endpoints:
  GET /phantom/operator-plans
  POST /phantom/operator-plans
- Planning only, no activation.

Acceptance:
- Suspended/revoked operators rejected.
- Missing posture creates blocker.
- no terminal data storage.
```

## Prompt S3.6-I - Monitoring And Audit Correlation

```text
Implement PHANTOM Monitoring And Audit Correlation.

Scope:
- Correlate PHANTOM package/readiness/approval/risk events with audit IDs and monitoring summaries.
- Add endpoint:
  GET /phantom/correlation
- No communication content.
- No operational PHANTOM details.

Acceptance:
- Correlation is evidence-only.
- Audit hash references are visible.
```

## Prompt S3.6-J - Admin UX Full Lifecycle

```text
Implement PHANTOM Admin UX Full Lifecycle.

Scope:
- Add tabs inside PHANTOM view:
  Overview, Packages, Policies, Readiness, Approval Packs, Evidence, Simulations, Operator Planning, Correlation.
- Add HelpTips to every sensitive term.
- Keep premium cockpit style.
- No prohibited details.

Acceptance:
- Browser check confirms all tabs/anchors.
- Responsive layout has no obvious overlap.
```

## Prompt S3.6-K - Security, Compliance And Browser Tests

```text
Implement tests for Step 3.6.

Scope:
- API tests for packages, policy templates, readiness, approval packs, evidence, simulations, entitlement hooks, operator plans and correlation.
- Negative tests for prohibited terms.
- Tests proving no execution side effects.
- Static UI tests for PHANTOM lifecycle tabs and HelpTips.
- Browser verification /admin.

Acceptance:
- npm.cmd test passes.
- PHANTOM remains outside baseline.
```

## Integration Prompt I1 - Backend Lifecycle Join

```text
Integrate S3.6-A through S3.6-I.

Check:
- one consistent PHANTOM lifecycle language
- humanGateRequired=true everywhere
- sideEffectAllowed=false everywhere
- executionAllowed=false in baseline
- no prohibited details
- RBAC and audit coherent
```

## Integration Prompt I2 - UI Lifecycle Join

```text
Integrate S3.6-J with backend.

Check:
- all PHANTOM lifecycle views load
- HelpTips explain sensitive terms
- premium cockpit remains readable
- no UI copy implies PHANTOM baseline execution
```

## Integration Prompt I3 - Compliance Review

```text
Review Step 3.6 for legal/compliance boundaries.

Findings first:
- Any operational PHANTOM instruction?
- Any evasion/radio identity/lawful-control bypass detail?
- Any false certification or anonymity claim?
- Any side effect?
- Any secret or restricted detail in audit?
```

## Final Human Test Prompt

```text
Act like a human Global Super Admin testing Step 3.6.

Run:
1. Open /admin.
2. Login.
3. Open PHANTOM.
4. Create capability package.
5. Review policy templates.
6. Add evidence bundle references.
7. Evaluate readiness.
8. Create approval pack.
9. Run simulation-only risk check.
10. Plan operator assignment.
11. Open correlation view.
12. Confirm executionAllowed=false and sideEffectAllowed=false everywhere.
13. Confirm HUMAN GATE is visible.
14. Confirm no prohibited operational details appear.
15. Run npm.cmd test.
```
