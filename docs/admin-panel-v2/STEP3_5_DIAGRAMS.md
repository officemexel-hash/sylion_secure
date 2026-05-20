# SYLION Admin Panel V2 Step 3.5 - Mermaid Diagrams

Ten plik zbiera diagramy Step 3.5 w jednym miejscu. Te same diagramy sa zapisane jako osobne pliki `.mmd` w `docs/admin-panel-v2/diagrams/`.

## 1. Module Dependency Graph

Zrodlo: `diagrams/26-step3-5-module-dependencies.mmd`

```mermaid
flowchart TD
    Freeze["Step 3.4 Freeze<br/>WebAuthn Hardening"]
    A["S3.5-A PHANTOM Governance Boundary"]
    B["S3.5-B PHANTOM Capability Registry"]
    C["S3.5-C PHANTOM Approval Workflow"]
    D["S3.5-D PHANTOM Evidence And Risk Register"]
    E["S3.5-E Premium Dashboard IA"]
    F["S3.5-F UI Visual System Refresh"]
    G["S3.5-G HelpTip Tooltip System"]
    H["S3.5-H Visual Concept Asset"]
    I["S3.5-I Security UX And Compliance Tests"]
    Freeze --> A
    A --> B
    A --> C
    B --> C
    C --> D
    D --> E
    H --> F
    F --> E
    G --> E
    A --> E
    B --> E
    C --> E
    D --> E
    E --> I
    F --> I
    G --> I
    I --> Release["Step 3.5 Release Gate"]
```

## 2. Module Map

Zrodlo: `diagrams/27-step3-5-module-map.mmd`

```mermaid
flowchart LR
    subgraph Baseline["SYLION Baseline"]
        Book["Ksiega 3.4"]
        Admin["Admin Panel"]
        Audit["Audit Hash Chain"]
        CDR["CDR Mandatory"]
        Auth["WebAuthn + RBAC"]
    end
    subgraph Phantom["PHANTOM Separate Track"]
        Boundary["Governance Boundary"]
        Cap["Capability Registry Redacted"]
        Approval["Legal/CISO/Architect Approval"]
        Risk["Evidence + Risk Register"]
    end
    subgraph UX["Premium Admin UX"]
        Dash["Dashboard IA"]
        Visual["Visual System"]
        Tips["HelpTip System"]
        Concept["Generated Visual Concept"]
    end
    Admin --> Boundary
    Auth --> Boundary
    Boundary --> Cap
    Boundary --> Approval
    Approval --> Risk
    Boundary --> Audit
    Cap --> Audit
    Approval --> Audit
    Risk --> Audit
    Dash --> Admin
    Visual --> Admin
    Tips --> Admin
    Concept --> Visual
    Book -. "baseline rules" .-> Boundary
    CDR -. "unchanged invariant" .-> Admin
```

## 3. Deployment Graph

Zrodlo: `diagrams/28-step3-5-deployment-graph.mmd`

```mermaid
flowchart TD
    Browser["Admin Browser"]
    Web["Admin Web /admin"]
    API["Admin API"]
    PhantomService["PHANTOM Governance Service"]
    BoundaryStore["Boundary Store"]
    CapabilityStore["Capability Registry Store"]
    ApprovalStore["Approval Store"]
    RiskStore["Risk Register Store"]
    Audit["Audit Hash Chain"]
    Store["SQLite Store"]
    Tests["API + Static + Browser Tests"]
    HumanGate["HUMAN GATE<br/>Architect + CISO + Legal"]
    Browser --> Web
    Web --> API
    API --> PhantomService
    PhantomService --> BoundaryStore
    PhantomService --> CapabilityStore
    PhantomService --> ApprovalStore
    PhantomService --> RiskStore
    PhantomService --> Audit
    BoundaryStore --> Store
    CapabilityStore --> Store
    ApprovalStore --> Store
    RiskStore --> Store
    Audit --> Store
    PhantomService -. "no execution" .-> HumanGate
    Tests --> Web
    Tests --> API
```

## 4. Runtime Flow

Zrodlo: `diagrams/29-step3-5-runtime-flow.mmd`

```mermaid
sequenceDiagram
    participant Admin as Global Super Admin
    participant UI as Admin Web
    participant API as Admin API
    participant Phantom as PHANTOM Governance Service
    participant Gate as HUMAN GATE
    participant Audit as Audit
    Admin->>UI: Open PHANTOM view
    UI->>API: GET /phantom/boundary
    API->>Phantom: read boundary
    Phantom->>Audit: phantom.boundary_read
    API-->>UI: separate track, humanGateRequired true, sideEffectAllowed false
    Admin->>UI: Create approval request
    UI->>API: POST /phantom/approvals
    API->>Phantom: create review record
    Phantom->>Audit: phantom.approval_created
    Phantom-->>Gate: requires Architect/CISO/Legal review
    API-->>UI: pending review, no execution
    Admin->>UI: Mark approved_placeholder
    UI->>API: POST /phantom/approvals/:id/status
    API->>Phantom: update status
    Phantom->>Audit: phantom.approval_status_changed
    API-->>UI: approved_placeholder, sideEffectAllowed false
```

## 5. UI Layout Graph

Zrodlo: `diagrams/30-step3-5-ui-layout.mmd`

```mermaid
flowchart TD
    Shell["Admin Shell"]
    Nav["Left Nav"]
    Top["Top Status Bar"]
    Overview["Overview Dashboard"]
    PhantomView["PHANTOM Governance View"]
    Tooltips["HelpTip Layer"]
    Shell --> Nav
    Shell --> Top
    Shell --> Overview
    Shell --> PhantomView
    Shell --> Tooltips
    Overview --> Health["System Health Strip"]
    Overview --> Risk["Operator Risk Summary"]
    Overview --> Queue["Action Required Queue"]
    Overview --> Gov["PHANTOM Governance Status"]
    Overview --> Audit["Recent Audit"]
    PhantomView --> Boundary["Boundary Card"]
    PhantomView --> Cap["Capability Registry"]
    PhantomView --> Approval["Approval Queue"]
    PhantomView --> Evidence["Evidence + Risk Register"]
    Tooltips --> Boundary
    Tooltips --> Approval
    Tooltips --> Gov
```

## 6. Roadmap Gantt

Zrodlo: `diagrams/31-step3-5-roadmap-gantt.mmd`

```mermaid
gantt
    title SYLION Admin V2 Step 3.5 Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %d.%m
    section PHANTOM Backend
    S3.5-A Governance Boundary                :a1, 2026-05-20, 2d
    S3.5-B Capability Registry                :b1, after a1, 2d
    S3.5-C Approval Workflow                  :c1, after b1, 2d
    S3.5-D Evidence And Risk Register         :d1, after c1, 2d
    section Admin UX
    S3.5-H Visual Concept Asset               :h1, 2026-05-20, 1d
    S3.5-F Visual System Refresh              :f1, after h1, 3d
    S3.5-G HelpTip System                     :g1, after h1, 2d
    S3.5-E Dashboard IA                       :e1, after f1, 3d
    section Validation
    S3.5-I Security UX Tests                  :i1, after e1, 2d
    Step 3.5 Stabilization                    :r1, after i1, 1d
```
