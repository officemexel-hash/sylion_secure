# SYLION Admin Panel V2 - Step 3.8 Graphs And Roadmap

## Diagram Files

```text
diagrams/46-step3-8-module-dependencies.mmd
diagrams/47-step3-8-module-map.mmd
diagrams/48-step3-8-deployment-graph.mmd
diagrams/49-step3-8-runtime-flow.mmd
diagrams/50-step3-8-workload-lifecycle.mmd
diagrams/51-step3-8-phantom-review-flow.mmd
diagrams/52-step3-8-roadmap-gantt.mmd
```

## Module Dependencies

```mermaid
flowchart TD
    Freeze["Step 3.7 Freeze"]
    A["S3.8-A Provisioning Approval Queue"]
    B["S3.8-B Workload Lifecycle State Machine"]
    C["S3.8-C Operator Enrollment Readiness Gate"]
    D["S3.8-D Orchestrator Preflight Approval Guard"]
    E["S3.8-E Dashboard Regression Harness"]
    F["S3.8-F Visual And Mobile Verification"]
    G["S3.8-G PHANTOM Control Plane Review Board"]
    H["S3.8-H PHANTOM Policy Simulation Harness"]
    I["S3.8-I PHANTOM Exception Review"]
    J["S3.8-J SDK Contract Docs"]
    Release["Step 3.8 Release Gate"]

    Freeze --> A
    Freeze --> B
    Freeze --> C
    A --> D
    B --> D
    C --> D
    G --> H
    G --> I
    H --> I
    A --> E
    B --> E
    C --> E
    D --> E
    G --> E
    E --> F
    A --> J
    B --> J
    C --> J
    D --> J
    G --> J
    H --> J
    I --> J
    F --> Release
    J --> Release
```

## Module Map

```mermaid
flowchart LR
    subgraph UI["Admin Web"]
        Dash["Dashboard Regression"]
        ApprovalView["Approval Queue View"]
        LifecycleView["Workload Lifecycle View"]
        PhantomView["PHANTOM Review Board"]
    end
    subgraph API["Admin API"]
        Approval["Provisioning Approval Service"]
        Lifecycle["Workload Lifecycle Service"]
        Readiness["Operator Readiness Gate"]
        Guard["Orchestrator Preflight Guard"]
        PhantomBoard["PHANTOM Review Board Service"]
        PhantomSim["PHANTOM Simulation Harness"]
    end
    subgraph Core["Existing Core"]
        Subs["Subscription Service"]
        Workloads["Workload Allocations"]
        Orch["Orchestrator"]
        Audit["Audit"]
    end
    UI --> API
    Approval --> Guard
    Lifecycle --> Guard
    Readiness --> Guard
    Guard --> Orch
    Subs --> Readiness
    Workloads --> Lifecycle
    PhantomBoard --> PhantomSim
    Approval --> Audit
    Lifecycle --> Audit
    Guard --> Audit
    PhantomBoard --> Audit
    PhantomSim --> Audit
```

## Deployment Graph

```mermaid
flowchart TD
    Browser["Admin Browser"]
    Static["Admin Web"]
    API["Admin API"]
    Approval["Approval Queue"]
    Lifecycle["Workload Lifecycle"]
    Readiness["Readiness Gate"]
    Phantom["PHANTOM Control Plane<br/>Non-executable"]
    Store["Persistent Store"]
    Audit["Audit"]
    Orchestrator["Orchestrator"]

    Browser --> Static
    Browser --> API
    API --> Approval
    API --> Lifecycle
    API --> Readiness
    API --> Phantom
    Approval --> Store
    Lifecycle --> Store
    Phantom --> Store
    Approval --> Audit
    Lifecycle --> Audit
    Readiness --> Audit
    Phantom --> Audit
    API --> Orchestrator
    Approval --> Orchestrator
```

## Runtime Flow

```mermaid
sequenceDiagram
    actor Admin
    participant UI as Admin Web
    participant API as Admin API
    participant Ready as Readiness Gate
    participant Approval as Approval Queue
    participant Orch as Orchestrator
    participant Audit as Audit

    Admin->>UI: Request provisioning execution
    UI->>API: POST /approvals/provisioning
    API->>Ready: evaluate operator readiness
    Ready-->>API: blockers/warnings
    API->>Approval: create pending review
    Approval->>Audit: approval.request_created
    Admin->>UI: Approve request
    UI->>API: POST /approvals/provisioning/:id/status
    API->>Approval: mark approved_for_execution
    Approval->>Audit: approval.status_changed
    UI->>API: POST /orchestrator/jobs
    API->>Approval: preflight approval check
    API->>Orch: execute only after approval + step-up
```

## Workload Lifecycle

```mermaid
stateDiagram-v2
    [*] --> planned
    planned --> approval_required
    approval_required --> approved_for_activation
    approval_required --> rejected
    approved_for_activation --> activating
    activating --> active
    activating --> degraded
    active --> suspended
    active --> revocation_required
    degraded --> suspended
    suspended --> approval_required
    revocation_required --> revoked
    rejected --> closed
    revoked --> [*]
    closed --> [*]
```

## PHANTOM Review Flow

```mermaid
stateDiagram-v2
    [*] --> intake
    intake --> legal_review
    legal_review --> ciso_review
    ciso_review --> architect_review
    architect_review --> compliance_review
    compliance_review --> approved_placeholder
    legal_review --> blocked
    ciso_review --> blocked
    architect_review --> blocked
    compliance_review --> blocked
    approved_placeholder --> closed
    blocked --> closed
    closed --> [*]
```

## Roadmap

```mermaid
gantt
    title SYLION Admin V2 Step 3.8 Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %m-%d
    section Approval And Lifecycle
    Approval queue                         :a1, 2026-05-20, 1d
    Workload lifecycle                     :a2, after a1, 1d
    Readiness gate                         :a3, after a2, 1d
    Orchestrator guard                     :a4, after a3, 1d
    section PHANTOM Control Plane
    Review board                           :p1, after a1, 1d
    Policy simulation harness              :p2, after p1, 1d
    Exception review expansion             :p3, after p2, 1d
    section UI And Tests
    Dashboard regression harness           :t1, after a4, 1d
    Visual and mobile verification         :t2, after t1, 1d
    SDK contract docs                      :t3, after p3, 1d
    Step 3.8 freeze                        :t4, after t3, 1d
```

