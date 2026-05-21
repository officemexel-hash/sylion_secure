# SYLION Admin Panel V2 - Step 3.11 Prompt Pack

Status: planned
Date: 2026-05-21

Use these prompts for independent developers or models. Each module must preserve Księga 3.4 and PHANTOM v3.0 boundaries.

## Global Guardrails Prompt

```text
You are implementing a SYLION Secure admin-panel module.

Mandatory invariants:
- no operational data on terminal,
- no plaintext secrets,
- no PHANTOM behavior in baseline execution paths,
- PHANTOM records remain executionAllowed=false and executionEnabled=false,
- CDR remains mandatory for file ingress/egress where applicable,
- provider and Firecracker actions remain dry-run/metadata-only unless explicit HUMAN GATE approval exists,
- every sensitive decision must be auditable,
- product claims must be evidence-based and not certification claims.

Before coding:
1. Inspect existing patterns.
2. Identify API/service/UI/test files touched.
3. Add negative tests.
4. Update docs when behavior changes.
```

## Prompt M31 - Release Gate Dashboard

```text
Implement the Release Gate Dashboard for SYLION Admin Panel V2.

Scope:
- Add API/service records for release gates if missing.
- Add dashboard cards grouped by baseline, PHANTOM, testing, deployment and compliance.
- Each gate must show status, blockers, owner, humanGateRequired, linked tests and evidence artifacts.
- Do not mark blocked production items as implemented.
- Add static UI tests and API tests.

Acceptance:
- Dashboard renders release gates.
- Księga 3.4 blocked controls remain visibly blocked.
- PHANTOM gates never show execution readiness.
- Audit event exists for gate status transitions.
```

## Prompt M32 - Human Test Center

```text
Implement Human Test Center.

Scope:
- Add scenario records with steps, expected results, status and evidence links.
- Add admin view to run or mark human-style tests.
- Store Playwright artifact paths and manual notes.
- Add default scenarios for login, provisioning, subscriptions, PHANTOM, audit and mobile review.

Acceptance:
- Test scenarios are visible and updateable.
- Scenario status can be pass/fail/blocked.
- Evidence links are listed without leaking secrets.
- API and UI tests cover create/update/list.
```

## Prompt M33 - Problem Registry

```text
Implement Problem Registry.

Scope:
- Add records for defects, UX issues, test gaps, compliance gaps and architecture gaps.
- Fields: severity, category, module, owner, status, evidence, resolution.
- Add admin UI with filters by severity/module/status.
- Problems can be linked to release gates and test scenarios.

Acceptance:
- A problem can be created from dashboard context.
- Release Gate Dashboard shows open blockers.
- Fixed problems require verification evidence.
- Audit logs record problem status changes.
```

## Prompt M34 - Księga 3.4 Compliance Matrix

```text
Implement Księga 3.4 Compliance Matrix.

Scope:
- Represent baseline controls as machine-readable records.
- Show implemented/partial/blocked states.
- Link each control to tests, docs and human gates.
- Keep production-blocked controls visibly blocked.

Acceptance:
- Matrix shows no operational data on terminal, G1/G2, IPsec, Matrix, CDR, 3 VPS, Puli AX, FIDO2, audit hash chain and HSM/PKI status.
- Blocked controls cannot be moved to implemented without human gate metadata.
- Tests verify blocked production claims remain blocked.
```

## Prompt M35 - PHANTOM Review Workbench

```text
Expand PHANTOM Review Workbench.

Scope:
- Add compact PHANTOM maturity summary.
- Add owner acknowledgement progress, exception revalidation, coverage score and risk state.
- Add negative boundary cards: cannot unlock orchestrator, cannot request execution, certificationClaim=false.
- Add filters for package/status/owner.

Acceptance:
- PHANTOM workbench shows all governance objects for a package.
- Expired exception is a visible blocker.
- Missing owner acknowledgement is visible.
- Execution remains false everywhere.
- Negative API tests continue to pass.
```

## Prompt M36 - Evidence Artifact Index

```text
Implement Evidence Artifact Index.

Scope:
- Index Playwright screenshots and test logs by path/hash/type/source.
- Link artifacts to gates, scenarios and problems.
- Do not store secret values or raw sensitive payloads.

Acceptance:
- Dashboard lists available artifacts.
- Screenshot path and hash are visible.
- Artifact links can be attached to release gates and problems.
- Static tests verify artifact panel exists.
```

## Prompt M37 - Deployment Readiness Planner

```text
Implement Deployment Readiness Planner.

Scope:
- Add deployment modules: admin web, admin API, persistence, provider adapters, image builder, router builder, orchestrator, monitoring, audit/WORM, PHANTOM governance.
- Each module has status: planned, simulated, dry_run_ready, human_gate_required, blocked, ready_for_review.
- Show dependencies and blockers.

Acceptance:
- Planner shows no real cloud or Firecracker execution as ready.
- Dry-run modules can be marked dry_run_ready.
- Human gate required for production mutation modules.
```

## Prompt M38 - Playwright Regression Expansion

```text
Expand Playwright testing.

Scope:
- Turn smoke test into scenario runner.
- Test all main views.
- Test key negative paths.
- Capture desktop and mobile screenshots.
- Write JSON summary of pass/fail/problems.

Acceptance:
- `npm run test:dashboard` exits non-zero on missing critical UI text.
- Screenshots are produced for key views.
- PHANTOM panel is tested for execution=false.
- Mobile viewport is covered.
```

## Prompt M39 - Documentation Freeze Pack

```text
Create Step 3.11 documentation freeze pack.

Scope:
- Update freeze doc.
- Add module map.
- Add prompt pack.
- Add Mermaid dependency/deployment/test graphs.
- Add release gate status vs Księga 3.4 and PHANTOM v3.0.

Acceptance:
- Docs are copyable to PDF.
- Mermaid diagrams render.
- No unsafe PHANTOM operational instructions.
```

## Integration Prompt

```text
Integrate Step 3.11 modules.

Tasks:
- Wire Release Gate Dashboard to Human Test Center, Problem Registry, Evidence Artifact Index, Księga 3.4 Matrix and PHANTOM Workbench.
- Ensure blockers roll up into release gate status.
- Ensure test artifacts can link to problems and gates.
- Preserve PHANTOM separate-track boundary.
- Run full API tests and dashboard Playwright tests.
```

## Final Human Test Prompt

```text
Act like a human administrator testing SYLION Admin Panel V2.

Test:
1. Login with WebAuthn simulator.
2. Run demo flow.
3. Open every dashboard view.
4. Create or inspect release gates.
5. Create a problem record for a visible issue.
6. Link evidence artifact to the problem.
7. Inspect Księga 3.4 matrix.
8. Inspect PHANTOM Review Workbench.
9. Verify every PHANTOM execution field remains false.
10. Test mobile viewport.
11. Capture screenshots.
12. Report all defects, UX issues, missing evidence and residual risks.

Do not approve production execution or PHANTOM live behavior.
```
