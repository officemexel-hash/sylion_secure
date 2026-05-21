# SYLION Admin Panel V2 - Step 3.11 Graphs and Roadmap

Status: planned
Date: 2026-05-21

## Module Dependency Graph

```mermaid
flowchart TD
  Status["System Status API"] --> Gate["M31 Release Gate Dashboard"]
  Tests["M32 Human Test Center"] --> Gate
  Problems["M33 Problem Registry"] --> Gate
  K34["M34 Księga 3.4 Matrix"] --> Gate
  Phantom["M35 PHANTOM Review Workbench"] --> Gate
  Evidence["M36 Evidence Artifact Index"] --> Gate
  Deploy["M37 Deployment Readiness Planner"] --> Gate
  Playwright["M38 Playwright Regression Expansion"] --> Tests
  Playwright --> Evidence
  Tests --> Problems
  Problems --> Evidence
  K34 --> Problems
  Phantom --> Problems
  Deploy --> Problems
  Gate --> Freeze["M39 Documentation Freeze Pack"]
```

## PHANTOM Governance Graph

```mermaid
flowchart TD
  Package["PHANTOM Package"] --> Evidence["Evidence Bundles"]
  Package --> Review["Review Board"]
  Review --> Ack["Owner Acknowledgements"]
  Package --> Exception["Exceptions"]
  Package --> Simulation["Policy Simulations"]
  Evidence --> Coverage["Evidence Coverage"]
  Ack --> Coverage
  Exception --> Coverage
  Simulation --> Coverage
  Coverage --> Workbench["PHANTOM Review Workbench"]
  Workbench --> Gate["Release Gate Dashboard"]
  Workbench --> Problem["Problem Registry"]
  Workbench --> Human["Human Gate"]
  Human -->|does not unlock| Baseline["Baseline Orchestrator"]
```

## Deployment Readiness Graph

```mermaid
flowchart LR
  Dev["Local Dev"] --> API["Admin API"]
  Dev --> Web["Admin Web"]
  API --> Store["Persistence"]
  API --> Audit["Audit Hash Chain"]
  API --> Monitor["Monitoring Metadata"]
  API --> Providers["Provider Dry-Run Adapters"]
  API --> Phantom["PHANTOM Governance"]
  API --> Tests["API Tests"]
  Web --> PWT["Playwright Dashboard Tests"]
  PWT --> Artifacts["Evidence Artifacts"]
  Tests --> Artifacts
  Artifacts --> Gate["Release Gate"]
  Providers -->|production mutation blocked| HumanGate["HUMAN GATE"]
  Phantom -->|execution blocked| HumanGate
  Gate --> Freeze["Step 3.11 Freeze"]
```

## Human Test Flow

```mermaid
sequenceDiagram
  participant Admin as Human Admin
  participant UI as Admin Dashboard
  participant API as Admin API
  participant Tests as Human Test Center
  participant Problems as Problem Registry
  participant Evidence as Evidence Index
  Admin->>UI: Sign in with FIDO2 simulator
  Admin->>UI: Run demo flow
  Admin->>UI: Click every major view
  UI->>API: Load release gates, Księga 3.4, PHANTOM, artifacts
  Admin->>Tests: Mark scenario result
  Tests->>Evidence: Attach screenshot/log hash
  Admin->>Problems: Record visible defect or gap
  Problems->>UI: Roll up blocker to Release Gate
  UI->>Admin: Show release decision and human gates
```

## Release Gate State Machine

```mermaid
stateDiagram-v2
  [*] --> planned
  planned --> simulated: metadata exists
  simulated --> dry_run_ready: dry-run tests pass
  dry_run_ready --> human_gate_required: production mutation or claim
  dry_run_ready --> ready_for_review: no production mutation
  human_gate_required --> blocked: owner rejects or evidence missing
  human_gate_required --> ready_for_review: approved metadata only
  ready_for_review --> verified: tests and evidence pass
  blocked --> planned: remediation scheduled
  verified --> [*]
```

## Roadmap

### Sprint 3.11-A: Data Model and API

- release gate service,
- problem registry service,
- evidence artifact service,
- human test scenario service,
- API tests and negative tests.

### Sprint 3.11-B: Admin UI

- Release Gate view,
- Human Test Center view,
- Problem Registry view,
- PHANTOM Review Workbench expansion,
- Księga 3.4 matrix cards.

### Sprint 3.11-C: Playwright Expansion

- scenario runner,
- JSON summary,
- screenshot index,
- mobile viewport,
- negative path checks.

### Sprint 3.11-D: Freeze and Release Review

- status report,
- known problems list,
- residual risk list,
- Mermaid graphs,
- final acceptance checklist.

## Roadmap Gantt

```mermaid
gantt
  title Step 3.11 Release Gate + Human Test Center Roadmap
  dateFormat  YYYY-MM-DD
  section API
  Release gate service        :a1, 2026-05-21, 1d
  Problem registry service    :a2, after a1, 1d
  Evidence artifact service   :a3, after a2, 1d
  section UI
  Release dashboard           :b1, after a1, 1d
  Human Test Center           :b2, after a2, 1d
  PHANTOM Workbench expansion :b3, after b1, 1d
  section Testing
  API negative tests          :c1, after a3, 1d
  Playwright scenario runner  :c2, after b3, 1d
  Mobile and artifact checks  :c3, after c2, 1d
  section Freeze
  Docs and Mermaid pack       :d1, after c3, 1d
```

## Acceptance Graph

```mermaid
flowchart TD
  A["API tests pass"] --> DOD["Step 3.11 Done"]
  B["Dashboard Playwright passes"] --> DOD
  C["No PHANTOM execution path"] --> DOD
  D["Księga 3.4 blocked items visible"] --> DOD
  E["Problems can be recorded and linked"] --> DOD
  F["Evidence artifacts indexed"] --> DOD
  G["Docs freeze complete"] --> DOD
```
