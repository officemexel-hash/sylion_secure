# SYLION Admin Panel V2 - Step 3.9 Graphs And Roadmap

## Diagram Files

```text
diagrams/53-step3-9-module-dependencies.mmd
diagrams/54-step3-9-module-map.mmd
diagrams/55-step3-9-deployment-graph.mmd
diagrams/56-step3-9-runtime-flow.mmd
diagrams/57-step3-9-phantom-workflow.mmd
diagrams/58-step3-9-test-harness.mmd
diagrams/59-step3-9-roadmap-gantt.mmd
```

## Module Dependencies

```mermaid
flowchart TD
    Freeze["Step 3.8 Freeze"]
    A["S3.9-A Mandatory Orchestrator Approval"]
    B["S3.9-B Persistent Readiness Evidence"]
    C["S3.9-C Approval-To-Lifecycle Binding"]
    D["S3.9-D Dashboard Status Matrix"]
    E["S3.9-E Browser Test Harness"]
    F["S3.9-F Mobile Visual Checks"]
    G["S3.9-G Provider Dry-Run Boundary"]
    H["S3.9-H PHANTOM Review Workflow"]
    I["S3.9-I PHANTOM Evidence Coverage"]
    J["S3.9-J PHANTOM Exception Expiry"]
    K["S3.9-K CI Test Reporting"]
    L["S3.9-L SDK Contract Docs Freeze"]
    Release["Step 3.9 Release Gate"]

    Freeze --> A
    Freeze --> B
    Freeze --> H
    A --> C
    B --> C
    B --> D
    C --> D
    G --> D
    H --> I
    I --> J
    J --> D
    D --> E
    E --> F
    E --> K
    F --> K
    A --> L
    B --> L
    C --> L
    G --> L
    H --> L
    I --> L
    J --> L
    K --> Release
    L --> Release
```

## Module Map

```mermaid
flowchart LR
    subgraph UI["Admin Web"]
        Overview["Status Matrix"]
        Approvals["Approvals View"]
        PhantomUI["PHANTOM Workflow View"]
        TestUI["Dashboard Smoke Evidence"]
    end
    subgraph API["Admin API"]
        Approval["Approval Enforcement"]
        Readiness["Persistent Readiness"]
        Lifecycle["Approval-Bound Lifecycle"]
        ProviderDryRun["Provider Dry-Run Planner"]
        PhantomWorkflow["PHANTOM Review Workflow"]
        PhantomCoverage["PHANTOM Evidence Coverage"]
        TestReport["Test Reporting"]
    end
    subgraph Core["Existing Core"]
        Auth["WebAuthn Step-Up"]
        Subs["Subscription Limits"]
        Devices["Pixel/Puli/FIDO2"]
        Orch["Orchestrator"]
        Audit["Audit Hash Chain"]
    end

    UI --> API
    Approval --> Auth
    Approval --> Orch
    Readiness --> Subs
    Readiness --> Devices
    Lifecycle --> Approval
    ProviderDryRun --> Readiness
    PhantomWorkflow --> PhantomCoverage
    PhantomCoverage --> Audit
    Approval --> Audit
    Readiness --> Audit
    Lifecycle --> Audit
    TestReport --> Audit
```

## Deployment Graph

```mermaid
flowchart TD
    Browser["Admin Browser"]
    Web["Admin Web Static App"]
    API["Admin API"]
    Store["Persistent Store"]
    Audit["Audit Hash Chain"]
    Approval["Mandatory Approval Gate"]
    Ready["Readiness Evidence Store"]
    DryRun["Provider Dry-Run Adapter"]
    Phantom["PHANTOM Governance Store"]
    Orchestrator["Orchestrator Metadata Executor"]
    CI["CI / Test Runner"]

    Browser --> Web
    Web --> API
    CI --> API
    CI --> Web
    API --> Approval
    API --> Ready
    API --> DryRun
    API --> Phantom
    Approval --> Orchestrator
    Approval --> Store
    Ready --> Store
    DryRun --> Store
    Phantom --> Store
    Approval --> Audit
    Ready --> Audit
    DryRun --> Audit
    Phantom --> Audit
    Orchestrator --> Audit
```

## Runtime Flow

```mermaid
sequenceDiagram
    actor Admin
    participant UI as Admin Web
    participant API as Admin API
    participant Ready as Readiness Evidence
    participant Approval as Approval Gate
    participant Life as Workload Lifecycle
    participant Orch as Orchestrator
    participant Audit as Audit

    Admin->>UI: Review operator status
    UI->>API: GET readiness/latest
    API->>Ready: load persisted snapshot
    Ready-->>API: blockers, warnings, evidence hash
    Admin->>UI: Approve provisioning
    UI->>API: POST approval status
    API->>Approval: approved_for_execution
    Approval->>Audit: approval.status_changed
    Admin->>UI: Activate workload
    UI->>API: POST lifecycle with approvalId
    API->>Life: validate transition and approval binding
    Life->>Audit: workload.lifecycle_transitioned
    Admin->>UI: Execute plan
    UI->>API: POST orchestrator job with approvalId
    API->>Approval: mandatory preflight
    API->>Orch: execute only after approval + step-up
    Orch->>Audit: orchestrator.job_created
```

## PHANTOM Workflow

```mermaid
stateDiagram-v2
    [*] --> intake
    intake --> legal_review
    legal_review --> ciso_review
    ciso_review --> architect_review
    architect_review --> compliance_review
    compliance_review --> evidence_coverage
    evidence_coverage --> approved_placeholder
    evidence_coverage --> blocked
    approved_placeholder --> expiry_monitoring
    expiry_monitoring --> review_required
    review_required --> legal_review
    blocked --> closed
    approved_placeholder --> closed
    closed --> [*]

    note right of approved_placeholder
      humanGateRequired=true
      sideEffectAllowed=false
      executionAllowed=false
      executionEnabled=false
    end note
```

## Test Harness Flow

```mermaid
flowchart TD
    Start["Start local Admin API"]
    Login["Login through dashboard"]
    Operators["Click Operators"]
    Providers["Click Providers"]
    Devices["Click Devices"]
    Subscriptions["Click Subscriptions"]
    Approvals["Click Approvals"]
    Provisioning["Click Provisioning"]
    Phantom["Click PHANTOM"]
    Audit["Click Audit"]
    Screens["Capture screenshots"]
    Report["Write smoke summary"]

    Start --> Login
    Login --> Operators
    Operators --> Providers
    Providers --> Devices
    Devices --> Subscriptions
    Subscriptions --> Approvals
    Approvals --> Provisioning
    Provisioning --> Phantom
    Phantom --> Audit
    Audit --> Screens
    Screens --> Report
```

## Roadmap

```mermaid
gantt
    title SYLION Admin V2 Step 3.9 Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %m-%d
    section Approval Hardening
    Mandatory approval enforcement          :a1, 2026-05-20, 1d
    Approval lifecycle binding              :a2, after a1, 1d
    section Readiness And Status
    Persistent readiness evidence           :r1, 2026-05-20, 1d
    Dashboard status matrix                 :r2, after r1, 1d
    section Provider Boundary
    Provider dry-run adapters               :p1, after r1, 1d
    section PHANTOM Maturity
    Review workflow owners                  :ph1, 2026-05-20, 1d
    Evidence coverage map                   :ph2, after ph1, 1d
    Exception linkage and expiry            :ph3, after ph2, 1d
    section Tests And Freeze
    Browser test harness                    :t1, after r2, 1d
    Mobile visual checks                    :t2, after t1, 1d
    CI test reporting                       :t3, after t2, 1d
    SDK contract docs freeze                :t4, after t3, 1d
```

