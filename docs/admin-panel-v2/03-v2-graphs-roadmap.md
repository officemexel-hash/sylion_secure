# SYLION Admin Panel V2 - Grafy I Roadmapa

## Graf Zależności V2

```mermaid
flowchart TD
    V1["V1 Frozen Admin API"]

    A["V2-A Live Admin Shell"]
    B["V2-B Persistence Layer"]
    C["V2-C Auth/WebAuthn Foundation"]
    D["V2-D Provider Adapter Boundary"]
    E["V2-E Job Queue / Orchestrator Runtime"]
    F["V2-F Image Pipeline Boundary"]
    G["V2-G Observability Dashboard"]
    H["V2-H API Contracts / SDK"]
    I["V2-I Dev Environment"]
    J["V2-J Human E2E Harness"]

    V1 --> B
    V1 --> H
    H --> A
    H --> J
    B --> C
    B --> E
    B --> G
    C --> A
    D --> E
    F --> E
    E --> G
    G --> A
    I --> A
    I --> J
    A --> J
    B --> J
    C --> J
    D --> J
    E --> J
    F --> J
    G --> J
```

## V2 Runtime Flow

```mermaid
sequenceDiagram
    participant UI as Live Admin Shell
    participant SDK as API Client / SDK
    participant Auth as Auth/WebAuthn
    participant API as Admin API
    participant DB as Persistence
    participant Queue as Job Queue
    participant Worker as Orchestrator Worker
    participant Adapter as Provider Adapter
    participant Images as Image Pipeline
    participant Audit as Audit
    participant Mon as Monitoring

    UI->>SDK: login request
    SDK->>Auth: WebAuthn challenge/auth
    Auth->>DB: store session
    Auth->>Audit: auth event

    UI->>SDK: create operator and plan
    SDK->>API: validated API calls
    API->>DB: persist tenant/operator/plan
    API->>Audit: domain events

    UI->>SDK: execute plan
    SDK->>API: POST orchestrator job
    API->>Queue: enqueue job
    API->>DB: persist job accepted

    Worker->>Queue: claim job
    Worker->>Adapter: dry-run/mock provider steps
    Worker->>Images: create artifact manifests
    Worker->>DB: persist inventory/certs/artifacts
    Worker->>Mon: health events
    Worker->>Audit: job completed

    UI->>SDK: dashboard refresh
    SDK->>API: fetch jobs/monitoring/audit
    API->>DB: read state
    API-->>UI: rendered operational state
```

## Roadmap V2

```mermaid
gantt
    title SYLION Admin Panel V2 Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %d.%m

    section Contracts and Storage
    V2-H API Contracts / SDK          :h1, 2026-05-20, 7d
    V2-B Persistence Layer            :b1, 2026-05-20, 12d

    section Auth and Dev Environment
    V2-C Auth/WebAuthn Foundation     :c1, after h1, 10d
    V2-I Dev Environment              :i1, after h1, 6d

    section Runtime Boundaries
    V2-D Provider Adapter Boundary    :d1, after b1, 8d
    V2-F Image Pipeline Boundary      :f1, after b1, 8d
    V2-E Job Queue / Orchestrator     :e1, after d1, 12d

    section Frontend
    V2-A Live Admin Shell             :a1, after h1, 16d
    V2-G Observability Dashboard      :g1, after e1, 8d

    section Testing
    V2-J Human E2E Harness            :j1, after a1, 10d
    V2 Stabilization                  :j2, after j1, 7d
```

## V2 Integration Order

```text
1. API Contracts / SDK
2. Persistence Layer
3. Auth/WebAuthn Foundation
4. Dev Environment
5. Provider Adapter Boundary
6. Image Pipeline Boundary
7. Job Queue / Orchestrator Runtime
8. Live Admin Shell
9. Observability Dashboard
10. Human E2E Harness
```

## V2 Milestones

| Milestone | Outcome |
|---|---|
| V2-M1 | API contract and SDK usable by frontend |
| V2-M2 | Data survives restart |
| V2-M3 | WebAuthn-compatible auth flow exists |
| V2-M4 | Orchestrator uses queue and adapters |
| V2-M5 | Frontend performs live admin workflows |
| V2-M6 | Human E2E test passes through UI/API/storage |

