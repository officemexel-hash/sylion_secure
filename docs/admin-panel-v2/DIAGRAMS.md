# SYLION Admin Panel V2 - Diagramy Mermaid

Aktualizacja: diagramy kolejnego etapu po Step 2 sa w `STEP3_DIAGRAMS.md` oraz w plikach:

```text
diagrams/06-step3-module-dependencies.mmd
diagrams/07-step3-module-map.mmd
diagrams/08-step3-deployment-graph.mmd
diagrams/09-step3-runtime-sequence.mmd
diagrams/10-step3-roadmap-gantt.mmd
diagrams/11-step3-2-module-dependencies.mmd
diagrams/12-step3-2-module-map.mmd
diagrams/13-step3-2-deployment-graph.mmd
diagrams/14-step3-2-runtime-flow.mmd
diagrams/15-step3-2-roadmap-gantt.mmd
```

Ten plik zbiera diagramy w jednym miejscu. Te same diagramy są też zapisane jako osobne pliki `.mmd` w `docs/admin-panel-v2/diagrams/`.

## 1. Graf Zależności Modułów

Źródło: `diagrams/01-module-dependencies.mmd`

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

## 2. Mapa Modułów

Źródło: `diagrams/02-module-map.mmd`

```mermaid
flowchart LR
    subgraph UX["Frontend / Operator Console"]
        A["V2-A Live Admin Shell"]
        G["V2-G Observability Dashboard"]
    end

    subgraph Contracts["Contracts"]
        H["V2-H OpenAPI / SDK"]
    end

    subgraph Core["Core Platform"]
        B["V2-B Persistence Layer"]
        C["V2-C Auth/WebAuthn"]
    end

    subgraph Runtime["Runtime / Execution"]
        E["V2-E Job Queue"]
        D["V2-D Provider Adapters"]
        F["V2-F Image Pipeline"]
    end

    subgraph QA["Validation"]
        I["V2-I Dev Environment"]
        J["V2-J Human E2E Harness"]
    end

    H --> A
    H --> G
    A --> C
    A --> H
    G --> H
    C --> B
    E --> B
    E --> D
    E --> F
    E --> G
    I --> A
    I --> B
    I --> E
    J --> A
    J --> B
    J --> C
    J --> E
```

## 3. Plan Wdrożenia

Źródło: `diagrams/03-deployment-plan.mmd`

```mermaid
flowchart TD
    Start["Start V2"]

    C1["1. Freeze contracts<br/>OpenAPI + SDK conventions"]
    C2["2. Add persistence<br/>SQLite + migrations + repositories"]
    C3["3. Replace dev auth boundary<br/>WebAuthn-compatible flow"]
    C4["4. Add dev environment<br/>seed data + run-local docs"]
    C5["5. Add provider adapters<br/>Mock + Hetzner skeleton + OVH skeleton"]
    C6["6. Add image pipeline boundary<br/>artifact manifests + provenance"]
    C7["7. Convert orchestrator<br/>queue + worker + retry + resume"]
    C8["8. Build live frontend<br/>forms + dashboards + API client"]
    C9["9. Observability views<br/>jobs + CDR + certs + incidents + audit"]
    C10["10. Human E2E gate<br/>UI + API + restart + leakage tests"]

    End["V2 Release Candidate"]

    Start --> C1
    C1 --> C2
    C1 --> C4
    C2 --> C3
    C2 --> C5
    C2 --> C6
    C5 --> C7
    C6 --> C7
    C3 --> C8
    C4 --> C8
    C7 --> C9
    C8 --> C9
    C9 --> C10
    C10 --> End
```

## 4. Runtime Flow

Źródło: `diagrams/04-runtime-flow.mmd`

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

    UI->>SDK: Login request
    SDK->>Auth: WebAuthn challenge/auth
    Auth->>DB: Store session
    Auth->>Audit: Auth event

    UI->>SDK: Create tenant/operator/plan
    SDK->>API: Validated API calls
    API->>DB: Persist domain state
    API->>Audit: Domain events

    UI->>SDK: Execute plan
    SDK->>API: POST orchestrator job
    API->>Queue: Enqueue job
    API->>DB: Persist job accepted

    Worker->>Queue: Claim job
    Worker->>Adapter: Dry-run/mock provider steps
    Worker->>Images: Create artifact manifests
    Worker->>DB: Persist inventory/certs/artifacts
    Worker->>Mon: Health events
    Worker->>Audit: Job completed

    UI->>SDK: Dashboard refresh
    SDK->>API: Fetch jobs/monitoring/audit
    API->>DB: Read state
    API-->>UI: Operational state
```

## 5. Roadmap Gantt

Źródło: `diagrams/05-roadmap-gantt.mmd`

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
