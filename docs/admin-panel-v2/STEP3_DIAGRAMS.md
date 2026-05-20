# SYLION Admin Panel V2 Step 3 - Mermaid Diagrams

Ten plik zbiera diagramy Step 3 w jednym miejscu. Te same diagramy sa zapisane jako osobne pliki `.mmd` w `docs/admin-panel-v2/diagrams/`.

## 1. Module Dependency Graph

Zrodlo: `diagrams/06-step3-module-dependencies.mmd`

```mermaid
flowchart TD
    Freeze["Step 2 Freeze<br/>Live Admin Shell + SQLite + SDK"]

    A["S3-A Auth API Contract"]
    B["S3-B Challenge Store"]
    C["S3-C Credential Registry"]
    D["S3-D Session And Step-up Policy"]
    E["S3-E Admin Security UI"]
    F["S3-F Audit And RBAC Integration"]
    G["S3-G Recovery, Lockout And Break-glass"]
    H["S3-H Human Security Test Harness"]

    Freeze --> A
    Freeze --> B
    Freeze --> E

    A --> B
    A --> C
    B --> C
    C --> D
    B --> D
    D --> E
    F --> A
    F --> B
    F --> C
    F --> D
    D --> G
    F --> G

    A --> H
    B --> H
    C --> H
    D --> H
    E --> H
    F --> H
    G --> H
```

## 2. Module Map

Zrodlo: `diagrams/07-step3-module-map.mmd`

```mermaid
flowchart LR
    subgraph UI["Admin Web"]
        E["S3-E Security UI"]
        Modal["Step-up Modal"]
        Status["Session Status"]
    end

    subgraph Auth["Auth Boundary"]
        A["S3-A Auth API Contract"]
        B["S3-B Challenge Store"]
        C["S3-C Credential Registry"]
        D["S3-D Session / Step-up Policy"]
    end

    subgraph Governance["Governance"]
        F["S3-F Audit + RBAC"]
        G["S3-G Recovery / Lockout / Break-glass"]
    end

    subgraph QA["Validation"]
        H["S3-H Human Security Test Harness"]
    end

    E --> A
    Modal --> A
    Status --> A
    A --> B
    A --> C
    B --> D
    C --> D
    D --> F
    G --> F
    H --> UI
    H --> Auth
    H --> Governance
```

## 3. Deployment Graph

Zrodlo: `diagrams/08-step3-deployment-graph.mmd`

```mermaid
flowchart TD
    Dev["Developer Workstation"]
    API["Admin API"]
    Web["Admin Web /admin"]
    Store["SQLite Store"]
    Sim["Local WebAuthn Simulator"]
    Browser["Browser WebAuthn Boundary"]
    Audit["Audit Hash Chain"]
    Tests["API + Browser Tests"]

    Dev --> API
    Dev --> Web
    API --> Store
    API --> Audit
    Web --> API
    Web --> Browser
    Browser --> Sim
    Sim --> API
    Tests --> Web
    Tests --> API
    Tests --> Store
    Tests --> Audit
```

## 4. Runtime Sequence

Zrodlo: `diagrams/09-step3-runtime-sequence.mmd`

```mermaid
sequenceDiagram
    participant UI as Admin Web
    participant API as Admin API
    participant Challenge as Challenge Store
    participant Cred as Credential Registry
    participant Session as Session Policy
    participant Audit as Audit
    participant Job as Orchestrator

    UI->>API: POST /auth/webauthn/login/options
    API->>Challenge: create login challenge with TTL
    API->>Audit: auth.challenge_issued
    API-->>UI: public challenge options

    UI->>API: POST /auth/webauthn/login/verify
    API->>Challenge: verify single-use challenge
    API->>Cred: validate credential and sign counter
    API->>Session: create session
    API->>Audit: auth.session_created
    API-->>UI: session token

    UI->>Job: POST /orchestrator/jobs
    Job->>Session: require fresh step-up
    Job-->>UI: step_up_required
    Job->>Audit: auth.step_up_required

    UI->>API: POST /auth/step-up/options
    API->>Challenge: create step-up challenge
    API-->>UI: step-up options

    UI->>API: POST /auth/step-up/verify
    API->>Challenge: verify single-use challenge
    API->>Session: refresh step-up freshness
    API->>Audit: auth.step_up_completed
    API-->>UI: step-up ok

    UI->>Job: retry POST /orchestrator/jobs
    Job-->>UI: job accepted/completed
```

## 5. Roadmap Gantt

Zrodlo: `diagrams/10-step3-roadmap-gantt.mmd`

```mermaid
gantt
    title SYLION Admin V2 Step 3 Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %d.%m

    section Contracts
    S3-A Auth API Contract                 :a1, 2026-05-20, 2d
    S3-F Audit/RBAC Event Model            :f1, 2026-05-20, 2d

    section Core Auth
    S3-B Challenge Store                   :b1, after a1, 3d
    S3-C Credential Registry               :c1, after b1, 3d
    S3-D Session And Step-up Policy        :d1, after c1, 4d

    section UI
    S3-E Admin Security UI                 :e1, after d1, 4d

    section Recovery
    S3-G Recovery Lockout Break-glass      :g1, after d1, 3d

    section Validation
    S3-H Human Security Test Harness       :h1, after e1, 4d
    Step 3 Stabilization                   :h2, after h1, 2d
```
