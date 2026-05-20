# SYLION Admin Panel V2 Step 3.7 - Mermaid Diagrams

This file collects Step 3.7 diagrams in one place. The same diagrams are also stored as separate `.mmd` files in `docs/admin-panel-v2/diagrams/`.

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

