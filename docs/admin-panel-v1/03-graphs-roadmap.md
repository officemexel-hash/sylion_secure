# SYLION Admin Panel V1 - Grafy I Roadmapa

## Graf Zależności Modułów

```mermaid
flowchart TD
    M01["M01 Admin Shell / Frontend"]

    M02["M02 Authentication"]
    M03["M03 RBAC / Permissions"]
    M04["M04 Tenant Management"]
    M05["M05 Operator Management"]
    M06["M06 Subscription & Entitlements"]

    M07["M07 Provisioning Plan Engine"]
    M08["M08 Provider Registry"]
    M09["M09 Infrastructure Inventory"]
    M10["M10 Device Inventory"]
    M11["M11 Authorized App Catalog"]
    M12["M12 CDR Service"]
    M13["M13 Jurisdiction Policy Engine"]
    M14["M14 PKI / Certificate Lifecycle"]
    M15["M15 Monitoring & Anomaly Detection"]
    M16["M16 Audit / WORM / Hash-chain"]
    M17["M17 Incident & Runbook Manager"]
    M18["M18 Secret Manager Adapter"]
    M19["M19 Image Factory"]
    M20["M20 Orchestrator / Job Runner"]
    M21["M21 Matrix Server Manager"]

    M01 --> M02
    M01 --> M03
    M01 --> M04
    M01 --> M05
    M01 --> M06
    M01 --> M07
    M01 --> M08
    M01 --> M09
    M01 --> M10
    M01 --> M11
    M01 --> M12
    M01 --> M13
    M01 --> M15
    M01 --> M16
    M01 --> M17
    M01 --> M21

    M02 --> M16
    M02 --> M15

    M03 --> M02
    M03 --> M16

    M04 --> M03
    M04 --> M06
    M04 --> M16

    M05 --> M04
    M05 --> M06
    M05 --> M10
    M05 --> M16

    M06 --> M16

    M07 --> M04
    M07 --> M05
    M07 --> M06
    M07 --> M08
    M07 --> M09
    M07 --> M10
    M07 --> M11
    M07 --> M13
    M07 --> M16

    M08 --> M18
    M08 --> M16

    M09 --> M08
    M09 --> M15
    M09 --> M16

    M10 --> M05
    M10 --> M14
    M10 --> M15
    M10 --> M16

    M11 --> M03
    M11 --> M06
    M11 --> M12
    M11 --> M16

    M12 --> M04
    M12 --> M05
    M12 --> M11
    M12 --> M15
    M12 --> M16

    M13 --> M06
    M13 --> M08
    M13 --> M09
    M13 --> M14
    M13 --> M16

    M14 --> M18
    M14 --> M09
    M14 --> M10
    M14 --> M16

    M15 --> M09
    M15 --> M10
    M15 --> M12
    M15 --> M14
    M15 --> M16

    M17 --> M15
    M17 --> M05
    M17 --> M09
    M17 --> M10
    M17 --> M14
    M17 --> M16

    M18 --> M16

    M19 --> M10
    M19 --> M11
    M19 --> M12
    M19 --> M14
    M19 --> M18
    M19 --> M16

    M20 --> M07
    M20 --> M08
    M20 --> M09
    M20 --> M10
    M20 --> M11
    M20 --> M12
    M20 --> M13
    M20 --> M14
    M20 --> M18
    M20 --> M19
    M20 --> M15
    M20 --> M16

    M21 --> M04
    M21 --> M05
    M21 --> M06
    M21 --> M08
    M21 --> M09
    M21 --> M14
    M21 --> M15
    M21 --> M16
    M21 --> M20
```

## Przepływ Integracyjny

```mermaid
sequenceDiagram
    participant UI as M01 Admin Shell
    participant Auth as M02 Auth
    participant RBAC as M03 RBAC
    participant Op as M05 Operator
    participant Ent as M06 Entitlements
    participant Plan as M07 Plan Engine
    participant Orch as M20 Orchestrator
    participant Prov as M08 Provider Registry
    participant Inv as M09 Inventory
    participant Img as M19 Image Factory
    participant PKI as M14 PKI
    participant CDR as M12 CDR
    participant Mon as M15 Monitoring
    participant Audit as M16 Audit

    UI->>Auth: admin login / session
    Auth->>Audit: auth event

    UI->>RBAC: can create operator?
    RBAC->>Audit: permission decision

    UI->>Op: create operator profile
    Op->>Ent: check tier limits
    Op->>Audit: operator created

    UI->>Plan: generate provisioning plan
    Plan->>Ent: validate entitlements
    Plan->>Prov: check provider/region/quota
    Plan->>Inv: check existing resources
    Plan->>Audit: plan generated

    UI->>RBAC: can approve provisioning?
    UI->>Orch: execute approved plan

    Orch->>Prov: create VPS resources
    Orch->>PKI: issue certificates
    Orch->>Img: build Pixel/router/workload configs
    Orch->>CDR: attach CDR policies
    Orch->>Inv: register G1/G2/Workload VPS
    Orch->>Mon: enable monitoring
    Orch->>Audit: job completed
```

## Roadmap

```mermaid
gantt
    title SYLION Admin Panel V1 Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %d.%m

    section Phase A - Foundation
    M16 Audit                         :a1, 2026-05-20, 7d
    M02 Authentication                :a2, after a1, 7d
    M03 RBAC                          :a3, after a2, 7d
    M06 Entitlements                  :a4, after a1, 7d
    M04 Tenants                       :a5, after a3, 6d
    M05 Operators                     :a6, after a5, 8d

    section Phase B - Planning
    M18 Secret Manager                :b1, after a1, 8d
    M08 Provider Registry             :b2, after b1, 8d
    M09 Infrastructure Inventory      :b3, after b2, 8d
    M07 Provisioning Plan Engine      :b4, after a6, 10d

    section Phase C - Execution
    M14 PKI                           :c1, after b1, 10d
    M19 Image Factory                 :c2, after c1, 12d
    M20 Orchestrator                  :c3, after b4, 14d

    section Phase D - Devices and Workloads
    M10 Device Inventory              :d1, after c1, 8d
    M11 Authorized App Catalog        :d2, after a4, 8d
    M12 CDR Service                   :d3, after d2, 12d
    M21 Matrix Server Manager         :d4, after c3, 10d

    section Phase E - Operations
    M15 Monitoring                    :e1, after b3, 10d
    M17 Incidents                     :e2, after e1, 8d
    M13 Jurisdiction Policy           :e3, after b4, 10d

    section Phase F - Frontend
    M01 Admin Shell on mocks          :f1, after a3, 14d
    M01 Backend integration           :f2, after c3, 14d
    Full human testing                :f3, after f2, 10d
```

## Kolejność Integracji

```text
I01 Integration Spine
I02 Provisioning Planning
I03 Provisioning Execution
I04 Workload Integration
I05 Jurisdiction Rotation
I06 Matrix Add-on
I07 Admin Frontend Integration
Final Human E2E Test
```

## Milestone Definition Of Done

### M0 Freeze

```text
decyzje V1 zapisane
moduły rozpisane
prompty modułowe gotowe
grafy zależności gotowe
```

### M1 Spine

```text
admin login
RBAC
tenant create
operator create
tier assignment
audit events
```

### M2 Planning

```text
provider registry
inventory
provisioning plan
cost/risk/approval output
```

### M3 Execution

```text
3 VPS per operator
PKI references
image/config artifacts
orchestrator jobs
rollback/idempotency
```

### M4 Workloads

```text
authorized apps
microVM environment planning/execution
CDR policies
Matrix add-on
```

### M5 Operations

```text
monitoring
anomalies
incidents
jurisdiction rotations
audit evidence
```

### M6 Human Tested Panel

```text
frontend integrated
manual human flows tested
automated tests passing
security findings triaged
```
