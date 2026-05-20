# SYLION Admin Panel V2 - Step 3.6 Graphs And Roadmap

## Module Dependency Graph

```mermaid
flowchart TD
    Freeze["Step 3.5 Freeze<br/>PHANTOM Governance"]
    A["S3.6-A Capability Package Builder"]
    B["S3.6-B Policy Template Library"]
    C["S3.6-C Readiness And Gate Engine"]
    D["S3.6-D Approval Pack Builder"]
    E["S3.6-E Evidence Bundle Store"]
    F["S3.6-F Simulation-Only Risk Runner"]
    G["S3.6-G Entitlement And Tier Hooks"]
    H["S3.6-H Operator Assignment Planning"]
    I["S3.6-I Monitoring And Audit Correlation"]
    J["S3.6-J Admin UX Full Lifecycle"]
    K["S3.6-K Security Compliance Tests"]
    Release["Step 3.6 Release Gate"]

    Freeze --> A
    Freeze --> B
    A --> C
    B --> C
    E --> C
    G --> C
    H --> C
    C --> D
    C --> F
    D --> I
    E --> I
    F --> I
    A --> J
    B --> J
    C --> J
    D --> J
    E --> J
    F --> J
    H --> J
    I --> J
    J --> K
    K --> Release
```

## Module Map

```mermaid
flowchart LR
    subgraph Baseline["SYLION Baseline"]
        Book["Ksiega 3.4"]
        Auth["WebAuthn/RBAC"]
        Audit["Audit Hash Chain"]
        Monitor["Monitoring"]
        Ent["Entitlements"]
        Operators["Operators"]
    end

    subgraph Phantom["PHANTOM Separate Track Admin Lifecycle"]
        Packages["Capability Packages"]
        Policies["Policy Templates"]
        Gates["Readiness Gates"]
        Packs["Approval Packs"]
        Evidence["Evidence Bundles"]
        Sims["Simulation-Only Runner"]
        Plans["Operator Planning"]
        Corr["Audit/Monitoring Correlation"]
    end

    subgraph UI["Admin Web PHANTOM Lifecycle"]
        Overview["Overview"]
        Tabs["Lifecycle Tabs"]
        Tips["HelpTips"]
    end

    Auth --> Packages
    Ent --> Gates
    Operators --> Plans
    Packages --> Gates
    Policies --> Gates
    Evidence --> Gates
    Gates --> Packs
    Gates --> Sims
    Packs --> Corr
    Sims --> Corr
    Corr --> Audit
    Corr --> Monitor
    Packages --> Tabs
    Policies --> Tabs
    Gates --> Tabs
    Packs --> Tabs
    Evidence --> Tabs
    Sims --> Tabs
    Plans --> Tabs
    Corr --> Tabs
    Tips --> Tabs
    Book -. "separation rules" .-> Phantom
```

## Deployment Graph

```mermaid
flowchart TD
    Browser["Admin Browser"]
    Web["Admin Web /admin"]
    API["Admin API"]
    Phantom["PHANTOM Lifecycle Service"]
    Store["SQLite Store"]
    Audit["Audit Hash Chain"]
    Monitoring["Monitoring Summary"]
    Entitlements["Entitlement Service"]
    Operators["Operator Service"]
    HumanGate["HUMAN GATE<br/>Architect + CISO + Legal + Compliance"]

    Browser --> Web
    Web --> API
    API --> Phantom
    Phantom --> Store
    Phantom --> Audit
    Phantom --> Monitoring
    Phantom --> Entitlements
    Phantom --> Operators
    Phantom -. "no baseline execution" .-> HumanGate
```

## Runtime Flow

```mermaid
sequenceDiagram
    participant Admin as Global Super Admin
    participant UI as Admin Web
    participant API as Admin API
    participant Phantom as PHANTOM Lifecycle Service
    participant Gate as Readiness Gate Engine
    participant Audit as Audit
    participant Human as HUMAN GATE

    Admin->>UI: Create capability package
    UI->>API: POST /phantom/packages
    API->>Phantom: store package metadata
    Phantom->>Audit: phantom.package_created
    API-->>UI: package, executionEnabled=false

    Admin->>UI: Evaluate readiness
    UI->>API: POST /phantom/readiness/evaluate
    API->>Gate: score approvals/evidence/entitlements/operator posture
    Gate-->>API: readinessScore, blockingGates, executionAllowed=false
    API-->>UI: readiness report

    Admin->>UI: Build approval pack
    UI->>API: POST /phantom/approval-packs
    API->>Phantom: compile safe evidence summary
    Phantom->>Audit: phantom.approval_pack_created
    Phantom-->>Human: review required
    API-->>UI: approval pack placeholder
```

## Gate State Machine

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> EvidenceMissing
    EvidenceMissing --> ReviewRequired
    ReviewRequired --> Blocked: rejected or prohibited detail
    ReviewRequired --> PlaceholderApproved: human approval record
    PlaceholderApproved --> ExecutionHeld: baseline sideEffectAllowed=false
    ExecutionHeld --> HumanGateRequired
    HumanGateRequired --> [*]
    Blocked --> [*]
```

## UI Lifecycle Graph

```mermaid
flowchart TD
    PhantomView["PHANTOM View"]
    Overview["Overview"]
    Packages["Packages"]
    Policies["Policies"]
    Readiness["Readiness"]
    ApprovalPacks["Approval Packs"]
    Evidence["Evidence"]
    Simulations["Simulations"]
    OperatorPlanning["Operator Planning"]
    Correlation["Correlation"]
    HelpTips["HelpTips"]

    PhantomView --> Overview
    PhantomView --> Packages
    PhantomView --> Policies
    PhantomView --> Readiness
    PhantomView --> ApprovalPacks
    PhantomView --> Evidence
    PhantomView --> Simulations
    PhantomView --> OperatorPlanning
    PhantomView --> Correlation
    HelpTips --> Overview
    HelpTips --> Packages
    HelpTips --> Readiness
    HelpTips --> ApprovalPacks
```

## Roadmap

```mermaid
gantt
    title SYLION Admin V2 Step 3.6 Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %d.%m

    section PHANTOM Lifecycle Core
    S3.6-A Capability Packages                :a1, 2026-05-20, 2d
    S3.6-B Policy Templates                   :b1, 2026-05-20, 2d
    S3.6-E Evidence Bundles                   :e1, after a1, 2d
    S3.6-C Readiness Gates                    :c1, after e1, 3d
    S3.6-D Approval Packs                     :d1, after c1, 2d

    section Integrations
    S3.6-F Simulation Runner                  :f1, after c1, 2d
    S3.6-G Entitlement Hooks                  :g1, after b1, 2d
    S3.6-H Operator Planning                  :h1, after g1, 2d
    S3.6-I Monitoring Correlation             :i1, after d1, 2d

    section UI And Validation
    S3.6-J Admin UX Lifecycle                 :j1, after i1, 3d
    S3.6-K Tests                              :k1, after j1, 2d
    Stabilization                             :r1, after k1, 1d
```

## Release Gates

```text
Gate 1: all lifecycle records keep humanGateRequired=true.
Gate 2: executionAllowed=false and sideEffectAllowed=false in baseline.
Gate 3: readiness engine returns blockers, not bypasses.
Gate 4: simulation runner has no live side effects.
Gate 5: policy templates contain no operational instructions.
Gate 6: evidence bundles store references only.
Gate 7: UI contains HelpTips for sensitive terms.
Gate 8: no prohibited PHANTOM details appear in UI/API/audit/logs.
Gate 9: npm.cmd test passes.
Gate 10: browser verification passes.
```
