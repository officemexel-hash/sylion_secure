# SYLION Admin Panel V2 - Step 3.11 Masterplan

Status: planned
Date: 2026-05-21

## Architecture Decision

Decision: ACCEPT WITH HUMAN GATE

Step 3.11 expands the admin panel into a release-control surface. It does not expand runtime execution. It makes visible what is implemented, blocked, tested, failed, risky or awaiting human approval.

Human gate: REQUIRED for any production execution claim or PHANTOM live behavior.

## Module Map

### M31 Release Gate Dashboard

Purpose:

- show release readiness by domain,
- show pass/fail/block state,
- link every domain to tests, screenshots, known problems and human gates.

Inputs:

- system status,
- test runs,
- problem records,
- PHANTOM coverage,
- Księga 3.4 matrix.

Outputs:

- release readiness cards,
- blocker list,
- release gate decision.

### M32 Human Test Center

Purpose:

- store human-style test scenarios,
- track execution status,
- link Playwright artifacts and manual observations.

Required scenario classes:

- login and FIDO2 simulator,
- overview navigation,
- provisioning approval path,
- subscriptions and quota,
- PHANTOM workbench,
- audit/monitoring review,
- mobile layout review.

### M33 Problem Registry

Purpose:

- record every identified problem,
- assign severity, owner, module, status and evidence,
- distinguish defect, UX issue, test gap, compliance gap and architecture gap.

Required statuses:

- open,
- triaged,
- in_progress,
- fixed_pending_test,
- verified,
- accepted_risk,
- blocked_human_gate.

### M34 Księga 3.4 Compliance Matrix

Purpose:

- map implementation status to baseline requirements,
- prevent accidental promotion of blocked items,
- show missing evidence per requirement.

Tracked controls:

- no operational data on terminal,
- G1/G2 separation,
- IPsec IKEv2 baseline,
- Matrix communication core,
- CDR mandatory,
- 3 VPS per operator,
- Puli AX router gate,
- FIDO2/MFA gates,
- provider dry-run until approval,
- audit hash chain,
- HSM/PKI production block.

### M35 PHANTOM Review Workbench

Purpose:

- give PHANTOM its own full governance workspace,
- keep PHANTOM away from baseline execution,
- show owner ack, evidence coverage, exceptions, simulations and risk state.

Required controls:

- execution false everywhere,
- certification claim false,
- owner ack matrix,
- expired exception blockers,
- prohibited term rejection,
- PHANTOM approval cannot unlock orchestrator.

### M36 Evidence Artifact Index

Purpose:

- list screenshots, test logs, release notes and coverage artifacts,
- link evidence to release gates and problem records.

### M37 Deployment Readiness Planner

Purpose:

- show which deployment modules are blocked, simulated, ready for dry-run, or ready for human gate.

Deployment layers:

- admin web,
- admin API,
- persistence,
- provider adapters,
- image builder,
- router builder,
- orchestration,
- monitoring,
- audit/WORM,
- PHANTOM governance.

### M38 Playwright Regression Expansion

Purpose:

- expand dashboard tests from smoke to scenario-level coverage,
- keep screenshot evidence,
- identify all visible UX or functional failures.

Required tests:

- all main views clickable,
- form negative paths,
- release gate visibility,
- problem registry create/update,
- PHANTOM workbench flow,
- mobile viewport,
- no visible overlap in key views.

### M39 Documentation Freeze Pack

Purpose:

- produce freeze docs, module docs, prompt pack, dependency graphs and deployment roadmap.

## Data Model Draft

```text
releaseGate:
  id
  moduleKey
  title
  księgaControlRefs[]
  phantomRefs[]
  status
  blockers[]
  testRunIds[]
  evidenceArtifactIds[]
  humanGateRequired
  owner
  updatedAt

humanTestScenario:
  id
  title
  view
  steps[]
  expectedResults[]
  status
  lastRunAt
  evidenceArtifactIds[]

problem:
  id
  title
  severity
  category
  moduleKey
  status
  evidenceArtifactIds[]
  owner
  resolutionNote

evidenceArtifact:
  id
  type
  path
  source
  linkedModule
  sha256
  createdAt
```

## Security Properties

- Release gate records are metadata only.
- Problem records must not store secrets or operational content.
- Evidence artifact paths must not expose secrets.
- PHANTOM evidence remains governance metadata only.
- All gate transitions must be audit logged.
- Human gate decisions must be explicit and traceable.

## Residual Risks

- Screenshot artifacts may accidentally reveal local test data.
- Release status can be misunderstood as production certification.
- PHANTOM maturity visibility may be mistaken for approved live behavior.
- Human-style tests may miss keyboard accessibility and screen-reader issues unless explicitly added.

## Required Tests

- Unit/API tests for release gate, problem registry and evidence artifact records.
- Negative tests for PHANTOM execution boundaries.
- Static admin web tests for new panels.
- Playwright regression tests for human workflows.
- Mobile screenshot verification.

## Definition of Done

- Step 3.11 docs exist and include graphs.
- Release Gate, Human Test Center, Problem Registry and PHANTOM Review Workbench are planned as modules.
- Prompts exist for independent developer/model work.
- Deployment roadmap is explicit.
- Human gate boundaries are named.
- Implementation can begin without architectural ambiguity.
