# SYLION Admin Panel V2 - Step 3.7 Graphs And Roadmap

## Diagram Files

```text
diagrams/39-step3-7-module-dependencies.mmd
diagrams/40-step3-7-module-map.mmd
diagrams/41-step3-7-deployment-graph.mmd
diagrams/42-step3-7-runtime-flow.mmd
diagrams/43-step3-7-quota-state-machine.mmd
diagrams/44-step3-7-ui-layout.mmd
diagrams/45-step3-7-roadmap-gantt.mmd
```

## Module Dependency Graph

```mermaid
flowchart TD
    Freeze["Step 3.6 Freeze<br/>PHANTOM Lifecycle Gates"]
    A["S3.7-A Subscription Plan Catalog"]
    B["S3.7-B Tenant Subscription Ledger"]
    C["S3.7-C Workload Environment Quota Engine"]
    D["S3.7-D Authorized App Allocation Matrix"]
    E["S3.7-E MicroVM Sizing And Placement Planner"]
    F["S3.7-F Add-on Manager"]
    G["S3.7-G Billing State And Suspension"]
    H["S3.7-H Admin UI Subscription Views"]
    I["S3.7-I SDK And Contract Updates"]
    J["S3.7-J Security And Human Browser Tests"]
    Release["Step 3.7 Release Gate"]

    Freeze --> A
    A --> B
    B --> C
    B --> F
    B --> G
    C --> D
    D --> E
    F --> D
    G --> C
    A --> H
    B --> H
    C --> H
    D --> H
    E --> H
    F --> H
    G --> H
    A --> I
    B --> I
    C --> I
    D --> I
    E --> I
    F --> I
    G --> I
    H --> J
    I --> J
    J --> Release
```

## Module Map

```mermaid
flowchart LR
    subgraph Admin["Admin Web"]
        UI["Subscription And Workload Views"]
        Help["HelpTips And Quota Meters"]
    end

    subgraph API["Admin API"]
        Plans["Plan Catalog"]
        Ledger["Subscription Ledger"]
        Quota["Quota Engine"]
        Alloc["App Allocation Matrix"]
        Placement["MicroVM Placement Planner"]
        Addons["Add-on Manager"]
        Billing["Billing State Controls"]
    end

    subgraph Core["Existing SYLION Core"]
        Tenants["Tenant Service"]
        Operators["Operator Service"]
        Apps["Authorized App Catalog"]
        Matrix["Matrix Manager"]
        Phantom["PHANTOM Admin Lifecycle<br/>Separate Track"]
        Audit["Hash-chain Audit"]
    end

    UI --> Plans
    UI --> Ledger
    UI --> Quota
    UI --> Alloc
    UI --> Placement
    UI --> Addons
    UI --> Billing
    Help --> UI
    Ledger --> Tenants
    Quota --> Operators
    Alloc --> Apps
    Addons --> Matrix
    Addons --> Phantom
    Plans --> Audit
    Ledger --> Audit
    Quota --> Audit
    Alloc --> Audit
    Billing --> Audit
```

## Deployment Graph

```mermaid
flowchart TD
    Browser["Admin Browser"]
    Static["Admin Web Static Assets"]
    API["Admin API"]
    RBAC["RBAC"]
    Subs["Subscription Service"]
    Quota["Quota Engine"]
    Apps["Authorized App Catalog"]
    Operators["Operator Service"]
    Matrix["Matrix Manager"]
    Phantom["PHANTOM Lifecycle Service<br/>Non-executable"]
    Store["Persistent Store"]
    Audit["Audit Service"]

    Browser --> Static
    Browser --> API
    API --> RBAC
    API --> Subs
    Subs --> Quota
    Quota --> Apps
    Quota --> Operators
    Subs --> Matrix
    Subs --> Phantom
    Subs --> Store
    Quota --> Store
    API --> Audit
    Subs --> Audit
    Quota --> Audit
    Matrix --> Audit
    Phantom --> Audit
```

## Runtime Flow

```mermaid
sequenceDiagram
    actor Admin as Global Super Admin
    participant UI as Admin Web
    participant API as Admin API
    participant Subs as Subscription Ledger
    participant Quota as Quota Engine
    participant Apps as App Catalog
    participant Audit as Audit

    Admin->>UI: Open Subscriptions
    UI->>API: GET /tenants/:tenantId/subscription
    API->>Subs: Read effective limits
    Subs-->>API: Subscription + addons + limits
    API-->>UI: Render tier, billing and quota state

    Admin->>UI: Request workload allocation quote
    UI->>API: POST /operators/:operatorId/workload-allocations/quote
    API->>Quota: Evaluate app instance count
    Quota->>Apps: Confirm app is approved
    Quota->>Audit: subscription.quota_decision
    Quota-->>API: allow or deny with blockers
    API-->>UI: Decision, remaining quota, no side effects

    Admin->>UI: Create allocation within quota
    UI->>API: POST /operators/:operatorId/workload-allocations
    API->>Quota: Re-evaluate before mutation
    Quota-->>API: allow
    API->>Subs: Store allocation metadata
    API->>Audit: workload_allocation.created
    API-->>UI: Allocation record
```

## Quota State Machine

```mermaid
stateDiagram-v2
    [*] --> DraftQuote
    DraftQuote --> Denied: unknown app or tier exceeded
    DraftQuote --> Allowed: approved app and quota available
    Allowed --> Allocated: create allocation
    Allocated --> Active: billing active
    Active --> WarnOnly: billing past_due
    WarnOnly --> Active: billing recovered
    Active --> AllocationBlocked: billing suspended
    WarnOnly --> AllocationBlocked: billing suspended
    AllocationBlocked --> Active: human-approved recovery
    AllocationBlocked --> CancelledReview: cancelled
    CancelledReview --> HumanGateRequired: destructive cleanup requested
    HumanGateRequired --> [*]
    Denied --> [*]
```

## UI Layout Graph

```mermaid
flowchart TD
    Shell["SYLION Admin Shell"]
    Nav["Left Navigation"]
    Dash["Overview"]
    Subs["Subscriptions View"]
    Workloads["Workload Allocation View"]
    Security["Security View"]
    Phantom["PHANTOM View"]
    Audit["Audit View"]

    Subs --> TierCards["Tier Cards"]
    Subs --> Addons["Add-on Controls"]
    Subs --> Billing["Billing State Controls"]
    Workloads --> Quote["Allocation Quote Form"]
    Workloads --> Meters["Quota Meters"]
    Workloads --> Matrix["Authorized App Allocation"]
    Workloads --> Placement["MicroVM Placement Plan"]
    Phantom --> PhantomMarker["Separate Track Marker<br/>executionAllowed=false"]
    Audit --> Events["Subscription And Quota Decisions"]

    Shell --> Nav
    Nav --> Dash
    Nav --> Subs
    Nav --> Workloads
    Nav --> Security
    Nav --> Phantom
    Nav --> Audit
```

## Roadmap

```mermaid
gantt
    title SYLION Admin V2 Step 3.7 Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %m-%d

    section Backend Core
    Plan catalog                         :a1, 2026-05-20, 1d
    Tenant subscription ledger           :a2, after a1, 1d
    Quota engine                         :a3, after a2, 1d
    App allocation matrix                :a4, after a3, 1d

    section Controls
    MicroVM placement planner            :b1, after a4, 1d
    Add-on manager                       :b2, after a2, 1d
    Billing state controls               :b3, after b2, 1d

    section Product Surface
    Admin UI subscription views          :c1, after a4, 2d
    SDK and contract updates             :c2, after b3, 1d

    section Verification
    Security tests                       :d1, after c2, 1d
    Human browser test                   :d2, after d1, 1d
    Step 3.7 freeze                      :d3, after d2, 1d
```

