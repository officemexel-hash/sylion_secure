# SYLION Admin Panel V2 - Step 3.10 Graphs And Roadmap

Status: planned
Date: 2026-05-21

## Diagram Files

```text
diagrams/60-step3-10-test-deployment.mmd
diagrams/61-step3-10-runtime-test-flow.mmd
diagrams/62-step3-10-roadmap-gantt.mmd
diagrams/63-step3-10-module-dependencies.mmd
diagrams/64-step3-10-module-map.mmd
diagrams/65-step3-10-phantom-sprint-flow.mmd
diagrams/66-step3-10-negative-test-matrix.mmd
diagrams/67-step3-10-release-gate-flow.mmd
```

## Module Dependencies

```mermaid
flowchart TD
    Freeze["Step 3.9 Frozen State"]
    A["Dashboard Test Runner"]
    B["SDK Contract Coverage"]
    C["Negative Dashboard Tests"]
    D["Visual Responsive QA"]
    E["PHANTOM Dashboard Maturity"]
    F["PHANTOM Negative Evidence"]
    G["Release Gate Matrix"]
    Release["Step 3.10 Release"]

    Freeze --> A
    Freeze --> B
    Freeze --> E
    A --> C
    A --> D
    B --> C
    E --> F
    C --> G
    D --> G
    F --> G
    B --> G
    G --> Release
```

## Module Map

```mermaid
flowchart LR
    subgraph UI["Admin Web"]
        Dash["Dashboard Runner Targets"]
        Providers["Provider Dry-Run UX"]
        Approvals["Approvals UX"]
        PhantomUI["PHANTOM Review UX"]
        AuditUI["Audit UX"]
    end

    subgraph API["Admin API"]
        Auth["WebAuthn / Step-Up"]
        Approval["Mandatory Approval Gate"]
        Ready["Readiness Evidence"]
        DryRun["Provider Dry-Run"]
        Phantom["PHANTOM Governance"]
        Audit["Audit Hash Chain"]
    end

    subgraph Evidence["Test Evidence"]
        JSON["Smoke JSON"]
        Screens["Screenshots"]
        Contract["SDK / openapi-lite checks"]
        Gate["Release Gate Matrix"]
    end

    Dash --> Auth
    Providers --> DryRun
    Approvals --> Approval
    Approvals --> Ready
    PhantomUI --> Phantom
    AuditUI --> Audit
    Auth --> Audit
    Approval --> Audit
    DryRun --> Audit
    Phantom --> Audit
    Dash --> JSON
    Dash --> Screens
    Contract --> Gate
    JSON --> Gate
    Screens --> Gate
```

## Deployment/Test Graph

```mermaid
flowchart TD
    Runner["Playwright Test Runner"]
    Browser["Admin Browser"]
    Web["Admin Web Static App"]
    API["Admin API"]
    SDK["Admin SDK"]
    Contract["openapi-lite"]
    Store["In-Memory or Persistent Store"]
    Audit["Audit Hash Chain"]
    Screens["Screenshot Artifacts"]
    JSON["Smoke Result JSON"]
    Gate["Release Gate Matrix"]

    Runner --> Browser
    Browser --> Web
    Web --> API
    Runner --> SDK
    SDK --> API
    API --> Store
    API --> Audit
    Runner --> Contract
    Browser --> Screens
    Runner --> JSON
    Screens --> Gate
    JSON --> Gate
    Contract --> Gate
    Audit --> Gate
```

## Runtime Test Flow

```mermaid
sequenceDiagram
    participant Test as Playwright Runner
    participant UI as Admin Web
    participant API as Admin API
    participant Approval as Approval Gate
    participant Phantom as PHANTOM Governance
    participant Audit as Audit
    participant Report as Result Artifacts

    Test->>UI: Login with WebAuthn simulator
    Test->>UI: Run Demo Flow
    UI->>API: Create tenant/operator/provider/devices/app/allocation
    UI->>Approval: Create and approve baseline approval
    UI->>API: Execute orchestrator job with approvalId
    API->>Audit: record approved baseline execution
    Test->>UI: Provider dry-run
    UI->>API: Plan G1/G2/WORKLOAD without mutation
    Test->>UI: PHANTOM workflow
    UI->>Phantom: Evidence, ack, exception, coverage
    Phantom->>Audit: record non-executable governance events
    Test->>Report: screenshots and JSON
```

## PHANTOM Sprint Flow

```mermaid
stateDiagram-v2
    [*] --> PackageDraft
    PackageDraft --> EvidenceSealed
    EvidenceSealed --> ApprovalPackBuilt
    ApprovalPackBuilt --> ReviewBoard
    ReviewBoard --> OwnerAck
    OwnerAck --> PolicySimulation
    PolicySimulation --> Coverage
    Coverage --> ReadyForHumanGate
    Coverage --> Blocked
    ReadyForHumanGate --> ApprovedPlaceholder
    ApprovedPlaceholder --> NonExecutable
    Blocked --> ReviewRequired
    ReviewRequired --> ReviewBoard

    note right of NonExecutable
      PHANTOM v3.0 remains separate [A]
      executionAllowed=false
      executionEnabled=false
      certificationClaim=false
    end note
```

## Negative Test Matrix

```mermaid
flowchart TD
    Start["Negative Test Suite"]
    MissingApproval["Missing approvalId"]
    PendingApproval["Pending/rejected approval"]
    PhantomApproval["PHANTOM approval used for baseline job"]
    ProviderApply["Provider mutation mode"]
    EmptyLifecycle["Empty lifecycle allocation"]
    PhantomExec["PHANTOM executionRequested=true"]
    ExpiredException["Expired PHANTOM exception"]
    Deny["Deny without side effects"]
    Audit["Audit deny/block decision"]
    UI["Dashboard shows safe message"]

    Start --> MissingApproval
    Start --> PendingApproval
    Start --> PhantomApproval
    Start --> ProviderApply
    Start --> EmptyLifecycle
    Start --> PhantomExec
    Start --> ExpiredException
    MissingApproval --> Deny
    PendingApproval --> Deny
    PhantomApproval --> Deny
    ProviderApply --> Deny
    EmptyLifecycle --> UI
    PhantomExec --> Deny
    ExpiredException --> UI
    Deny --> Audit
    Deny --> UI
```

## Release Gate Flow

```mermaid
flowchart TD
    Tests["API + SDK + Dashboard Tests"]
    Visual["Desktop/Mobile Visual QA"]
    K34["Ksiega 3.4 Matrix"]
    Phantom["PHANTOM v3.0 Matrix"]
    Risks["Residual Risks"]
    HumanGate["HUMAN GATE List"]
    ReleaseDoc["Release Gate Document"]
    Decision{"Release Step 3.10?"}
    Freeze["Freeze Step 3.10"]
    Backlog["Create Step 3.11 Backlog"]

    Tests --> ReleaseDoc
    Visual --> ReleaseDoc
    K34 --> ReleaseDoc
    Phantom --> ReleaseDoc
    Risks --> ReleaseDoc
    HumanGate --> ReleaseDoc
    ReleaseDoc --> Decision
    Decision --> Freeze
    Decision --> Backlog
```

## Roadmap

```mermaid
gantt
    title SYLION Admin V2 Step 3.10 Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %m-%d
    section Test Harness
    Dashboard runner                  :a1, 2026-05-21, 1d
    Smoke JSON and screenshots        :a2, after a1, 1d
    section Contracts
    SDK/openapi contract tests        :b1, 2026-05-21, 1d
    section Negative UX
    Dashboard failure-path tests      :c1, after a1, 1d
    section PHANTOM Sprint
    PHANTOM dashboard maturity        :p1, 2026-05-21, 1d
    PHANTOM negative evidence         :p2, after p1, 1d
    section Visual QA
    Desktop/mobile checks             :d1, after a1, 1d
    section Release
    Release gate matrix               :e1, after b1, 1d
```

