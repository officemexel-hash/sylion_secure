# SYLION Admin Panel V2 Step 3.4 - Mermaid Diagrams

Ten plik zbiera diagramy Step 3.4 w jednym miejscu. Te same diagramy sa zapisane jako osobne pliki `.mmd` w `docs/admin-panel-v2/diagrams/`.

## 1. Module Dependency Graph

Zrodlo: `diagrams/21-step3-4-module-dependencies.mmd`

```mermaid
flowchart TD
    Freeze["Step 3.3 Freeze<br/>Recovery, Lockout, Break-glass Placeholder"]

    A["S3.4-A WebAuthn Browser Ceremony Adapter"]
    B["S3.4-B Server Verification Boundary"]
    C["S3.4-C Credential Lifecycle Policy"]
    D["S3.4-D Auth Policy Matrix And State Machine"]
    E["S3.4-E Admin Web Security UX Upgrade"]
    F["S3.4-F Compatibility Test Harness"]
    G["S3.4-G Audit, RBAC And Abuse-case Validation"]

    Freeze --> B
    Freeze --> D
    B --> A
    B --> C
    D --> C
    D --> G
    C --> E
    A --> E
    A --> F
    B --> F
    C --> F
    E --> F
    F --> G
    G --> Release["Step 3.4 Release Gate"]
```

## 2. Module Map

Zrodlo: `diagrams/22-step3-4-module-map.mmd`

```mermaid
flowchart LR
    subgraph Browser["Admin Browser"]
        A["S3.4-A Browser Ceremony Adapter"]
        Capability["WebAuthn Capability Status"]
    end

    subgraph API["Admin API Auth Boundary"]
        B["S3.4-B Verification Boundary"]
        C["S3.4-C Credential Lifecycle"]
        D["S3.4-D Auth Policy Matrix"]
    end

    subgraph UI["Admin Web Security View"]
        E["S3.4-E Security UX"]
        Recovery["Recovery Queue"]
        BreakGlass["Break-glass HUMAN GATE"]
    end

    subgraph QA["Validation"]
        F["S3.4-F Compatibility Harness"]
        G["S3.4-G Abuse-case Validation"]
    end

    subgraph Governance["Governance"]
        Book["Ksiega 3.4 Baseline"]
        Phantom["PHANTOM v3.0 Separate Track"]
        HumanGate["HUMAN GATE"]
    end

    A --> B
    Capability --> E
    B --> C
    D --> C
    C --> E
    Recovery --> E
    BreakGlass --> E
    E --> F
    B --> G
    C --> G
    D --> G
    G --> Book
    G --> HumanGate
    G -. "separation only" .-> Phantom
```

## 3. Deployment Graph

Zrodlo: `diagrams/23-step3-4-deployment-graph.mmd`

```mermaid
flowchart TD
    Admin["Global Super Admin"]
    Browser["Browser With WebAuthn Support"]
    Web["Admin Web /admin"]
    API["Admin API"]
    Auth["Auth Service"]
    Verifier["WebAuthn Verifier Boundary"]
    Credentials["Credential Store"]
    Policy["Auth Policy Matrix"]
    Audit["Audit Hash Chain"]
    Store["SQLite Store"]
    Tests["Node + Browser + Manual Tests"]

    Admin --> Browser
    Browser --> Web
    Web --> API
    API --> Auth
    Auth --> Verifier
    Auth --> Credentials
    Auth --> Policy
    Verifier --> Audit
    Credentials --> Audit
    Policy --> Audit
    Credentials --> Store
    Audit --> Store
    Tests --> Web
    Tests --> API
    Tests --> Audit
```

## 4. Runtime Flow

Zrodlo: `diagrams/24-step3-4-runtime-flow.mmd`

```mermaid
sequenceDiagram
    participant Admin as Admin
    participant UI as Admin Web
    participant Browser as Browser WebAuthn
    participant API as Admin API
    participant Auth as Auth Service
    participant Verifier as Verifier Boundary
    participant Creds as Credential Store
    participant Audit as Audit

    Admin->>UI: Start enrollment/login/step-up
    UI->>API: Request challenge
    API->>Auth: create single-use challenge
    Auth->>Audit: auth.challenge_issued
    API-->>UI: publicKey options
    UI->>Browser: navigator.credentials.create/get
    Browser-->>UI: WebAuthn response
    UI->>API: Verify ceremony payload
    API->>Auth: verify challenge and credential binding
    Auth->>Verifier: validate assertion/attestation boundary
    Verifier-->>Auth: verified or denied
    Auth->>Creds: update signCounter/lastUsedAt
    Auth->>Audit: auth.credential_verified or auth.challenge_failed
    API-->>UI: session/step-up success or denial

    Admin->>UI: Revoke credential
    UI->>API: POST /auth/credentials/:id/revoke
    API->>Auth: require fresh step-up
    Auth->>Creds: mark revoked
    Auth->>Audit: auth.credential_revoked
    API-->>UI: safe credential metadata
```

## 5. Roadmap Gantt

Zrodlo: `diagrams/25-step3-4-roadmap-gantt.mmd`

```mermaid
gantt
    title SYLION Admin V2 Step 3.4 Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %d.%m

    section Auth Core
    S3.4-B Verifier Boundary                  :b1, 2026-05-20, 2d
    S3.4-D Policy Matrix                      :d1, 2026-05-20, 1d
    S3.4-C Credential Lifecycle               :c1, after b1, 2d

    section Browser UI
    S3.4-A Browser Ceremony Adapter           :a1, after b1, 2d
    S3.4-E Security UX Upgrade                :e1, after c1, 2d

    section Validation
    S3.4-F Compatibility Harness              :f1, after e1, 2d
    S3.4-G Abuse-case Validation              :g1, after f1, 2d
    Step 3.4 Stabilization                    :r1, after g1, 1d
```
