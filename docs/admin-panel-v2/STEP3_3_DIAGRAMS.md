# SYLION Admin Panel V2 Step 3.3 - Mermaid Diagrams

Ten plik zbiera diagramy Step 3.3 w jednym miejscu. Te same diagramy sa zapisane jako osobne pliki `.mmd` w `docs/admin-panel-v2/diagrams/`.

## 1. Module Dependency Graph

Zrodlo: `diagrams/16-step3-3-module-dependencies.mmd`

```mermaid
flowchart TD
    Freeze["Step 3.2 Freeze<br/>Step-up Enforcement"]

    A["S3.3-A Lockout Policy"]
    B["S3.3-B Recovery Request Model"]
    C["S3.3-C Break-glass Placeholder Boundary"]
    D["S3.3-D Admin Security UI States"]
    E["S3.3-E Audit, RBAC And Human Gate Traceability"]
    F["S3.3-F Threat Model And Abuse-case Tests"]

    Freeze --> A
    Freeze --> E
    A --> B
    A --> C
    E --> B
    E --> C
    B --> D
    C --> D
    A --> F
    B --> F
    C --> F
    D --> F
    E --> F
```

## 2. Module Map

Zrodlo: `diagrams/17-step3-3-module-map.mmd`

```mermaid
flowchart LR
    subgraph Auth["Auth Boundary"]
        A["S3.3-A Lockout Policy"]
        B["S3.3-B Recovery Requests"]
        C["S3.3-C Break-glass Placeholder"]
    end

    subgraph Governance["Governance"]
        E["S3.3-E Audit + RBAC + Human Gate"]
        Book["Ksiega 3.4 Baseline"]
        Phantom["PHANTOM v3.0 Separate Track"]
    end

    subgraph UI["Admin Web"]
        D["S3.3-D Security UI States"]
    end

    subgraph QA["Validation"]
        F["S3.3-F Abuse-case Tests"]
    end

    A --> E
    B --> E
    C --> E
    E --> Book
    E -. "separation only" .-> Phantom
    B --> D
    C --> D
    D --> F
    E --> F
```

## 3. Deployment Graph

Zrodlo: `diagrams/18-step3-3-deployment-graph.mmd`

```mermaid
flowchart TD
    Browser["Admin Browser"]
    Web["Admin Web /admin"]
    API["Admin API"]
    Auth["Auth Service"]
    Lockout["Lockout Policy"]
    Recovery["Recovery Store"]
    BreakGlass["Break-glass Placeholder Store"]
    Audit["Audit Hash Chain"]
    Store["SQLite Store"]
    Tests["API + Browser Tests"]

    Browser --> Web
    Web --> API
    API --> Auth
    Auth --> Lockout
    Auth --> Recovery
    Auth --> BreakGlass
    Lockout --> Audit
    Recovery --> Audit
    BreakGlass --> Audit
    Auth --> Store
    Audit --> Store
    Tests --> API
    Tests --> Web
```

## 4. Runtime Flow

Zrodlo: `diagrams/19-step3-3-runtime-flow.mmd`

```mermaid
sequenceDiagram
    participant Admin as Admin
    participant UI as Admin Web
    participant API as Admin API
    participant Auth as Auth Service
    participant Lockout as Lockout Policy
    participant Recovery as Recovery Model
    participant BreakGlass as Break-glass Placeholder
    participant Audit as Audit

    Admin->>UI: Failed login attempts
    UI->>API: Auth verify requests
    API->>Auth: validate
    Auth->>Lockout: increment failure
    Lockout->>Audit: auth.lockout_started when threshold reached
    API-->>UI: locked / denied

    Admin->>UI: Request recovery
    UI->>API: POST /auth/recovery/request
    API->>Recovery: create pending request
    Recovery->>Audit: auth.recovery_started
    API-->>UI: pending recovery, no unlock

    Admin->>UI: Request break-glass placeholder
    UI->>API: POST /auth/break-glass/requests
    API->>BreakGlass: create pending_human_gate request
    BreakGlass->>Audit: auth.break_glass_requested
    BreakGlass->>Audit: auth.break_glass_human_gate_required
    API-->>UI: humanGateRequired true, no side effect
```

## 5. Roadmap Gantt

Zrodlo: `diagrams/20-step3-3-roadmap-gantt.mmd`

```mermaid
gantt
    title SYLION Admin V2 Step 3.3 Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %d.%m

    section Policy
    S3.3-A Lockout Policy                     :a1, 2026-05-20, 2d
    S3.3-E RBAC + Audit Events                :e1, 2026-05-20, 1d

    section Recovery
    S3.3-B Recovery Request Model             :b1, after a1, 2d
    S3.3-C Break-glass Placeholder            :c1, after b1, 2d

    section UI
    S3.3-D Admin Security UI States           :d1, after c1, 2d

    section Validation
    S3.3-F Threat Model + Abuse-case Tests    :f1, after d1, 2d
    Step 3.3 Stabilization                    :f2, after f1, 1d
```

