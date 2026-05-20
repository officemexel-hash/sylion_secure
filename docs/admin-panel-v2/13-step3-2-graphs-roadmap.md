# SYLION Admin Panel V2 - Step 3.2 Graphs And Roadmap

## Module Dependency Graph

```mermaid
flowchart TD
    Freeze["Step 3.1 Freeze<br/>WebAuthn Auth Core"]

    A["S3.2-A Sensitive Action Policy"]
    B["S3.2-B API Step-up Enforcement"]
    C["S3.2-C Admin Web Step-up UX"]
    D["S3.2-D SDK Step-up Retry Helper"]
    E["S3.2-E Audit And Monitoring Traceability"]
    F["S3.2-F Negative And Human E2E Tests"]

    Freeze --> A
    Freeze --> D
    A --> B
    A --> E
    B --> D
    D --> C
    B --> F
    C --> F
    E --> F
```

## Module Map

```mermaid
flowchart LR
    subgraph API["Admin API"]
        A["S3.2-A Sensitive Action Policy"]
        B["S3.2-B Protected Endpoints"]
        Auth["Step-up Verify"]
    end

    subgraph UI["Admin Web"]
        C["S3.2-C Step-up Modal"]
        Forms["Provider / Provisioning Forms"]
    end

    subgraph SDK["API Client"]
        D["S3.2-D Step-up Retry Helper"]
    end

    subgraph Audit["Governance"]
        E["S3.2-E Audit Traceability"]
    end

    subgraph QA["Validation"]
        F["S3.2-F Tests"]
    end

    Forms --> D
    D --> B
    B --> A
    A --> Auth
    A --> E
    B --> E
    D --> C
    C --> Auth
    F --> API
    F --> UI
    F --> Audit
```

## Deployment Graph

```mermaid
flowchart TD
    Browser["Admin Browser"]
    Web["Admin Web /admin"]
    API["Admin API"]
    Auth["Auth / Step-up Service"]
    Policy["Sensitive Action Policy"]
    Providers["Provider Registry"]
    Orchestrator["Orchestrator"]
    Store["SQLite Store"]
    Audit["Audit Hash Chain"]
    Tests["API + Browser Tests"]

    Browser --> Web
    Web --> API
    API --> Auth
    API --> Policy
    Policy --> Auth
    Policy --> Audit
    API --> Providers
    API --> Orchestrator
    Providers --> Store
    Orchestrator --> Store
    Auth --> Store
    Audit --> Store
    Tests --> Web
    Tests --> API
```

## Runtime Flow

```mermaid
sequenceDiagram
    participant UI as Admin Web
    participant SDK as AdminApiClient
    participant API as Admin API
    participant Policy as Sensitive Action Policy
    participant Auth as Step-up Service
    participant Domain as Provider/Orchestrator
    participant Audit as Audit

    UI->>SDK: Execute protected action
    SDK->>API: POST protected endpoint
    API->>Policy: requireFreshStepUp(actor, action)
    Policy->>Audit: auth.step_up_required
    API-->>SDK: 403 step_up_required
    SDK-->>UI: Step-up required error

    UI->>SDK: Start step-up
    SDK->>Auth: POST /auth/step-up/options
    Auth-->>SDK: challenge options
    UI->>SDK: Verify local simulator assertion
    SDK->>Auth: POST /auth/step-up/verify
    Auth->>Audit: auth.step_up_completed
    Auth-->>SDK: refreshed session

    UI->>SDK: Retry protected action once
    SDK->>API: POST protected endpoint
    API->>Policy: requireFreshStepUp(actor, action)
    Policy-->>API: allow
    API->>Domain: execute side effect
    Domain->>Audit: domain success event
    API-->>UI: success
```

## Implementation Roadmap

```mermaid
gantt
    title SYLION Admin V2 Step 3.2 Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %d.%m

    section Policy
    S3.2-A Sensitive Action Policy       :a1, 2026-05-20, 1d
    S3.2-E Audit Traceability            :e1, 2026-05-20, 1d

    section API
    S3.2-B API Enforcement               :b1, after a1, 2d
    API Negative Tests                    :b2, after b1, 1d

    section Client
    S3.2-D SDK Retry Helper              :d1, after b1, 1d
    S3.2-C Admin Web Step-up UX          :c1, after d1, 2d

    section Validation
    S3.2-F Human E2E Tests               :f1, after c1, 2d
    Step 3.2 Stabilization               :f2, after f1, 1d
```

## Integration Order

```text
1. Add sensitive action policy helper.
2. Add AppError shape step_up_required.
3. Enforce policy in provider/orchestrator endpoints before side effects.
4. Add API negative tests and leakage assertions.
5. Add SDK step-up helper.
6. Add Admin Web modal and one-shot retry.
7. Verify browser flow for execute job.
8. Update implementation log and status docs.
```

## Release Gates

```text
Gate 1: protected endpoints return step_up_required before side effects.
Gate 2: no provider secret appears in error/audit/log output.
Gate 3: step-up verify refreshes session freshness.
Gate 4: UI modal performs step-up and retries action once.
Gate 5: browser flow for execute job passes.
Gate 6: npm.cmd test passes.
```

