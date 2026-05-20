# SYLION Admin Panel - V1 Freeze I V2 Scope

Status: V1 frozen, V2 planning baseline  
Data: 2026-05-20

## V1 Freeze

V1 uznajemy za zakończony etap prototypu domenowego.

V1 zawiera:

```text
M02 Authentication
M03 RBAC / Permissions
M04 Tenant Management
M05 Operator Management
M06 Subscription & Entitlements
M07 Provisioning Plan Engine
M08 Provider Registry
M09 Infrastructure Inventory
M10 Device Inventory
M11 Authorized App Catalog
M12 CDR Service
M13 Jurisdiction Policy Engine
M14 PKI / Certificate Lifecycle
M15 Monitoring & Anomaly Detection
M16 Audit / WORM / Hash-chain
M17 Incident & Runbook Manager
M18 Secret Manager Adapter
M19 Image Factory
M20 Orchestrator / Job Runner
M21 Matrix Server Manager
M01 minimal static Admin Shell
```

V1 test status:

```text
23 tests
23 passing
0 failing
```

V1 jest świadomie:

```text
in-memory
dev-auth
mock-provider
mock-image-build
mock-orchestration
static UI shell
```

## V2 Goal

V2 ma przejść od prototypu domenowego do aplikacji operacyjnej, którą da się uruchomić lokalnie jako spójny system:

```text
live frontend
persistent storage
real session/auth foundation
real provider adapter boundary
job queue semantics
API-backed workflows
rendered status dashboards
seed/demo environment
deployment-ready structure
```

## V2 Non-Goals

V2 nie musi jeszcze:

```text
tworzyć produkcyjnych VPS u Hetzner/OVH
budować prawdziwego GrapheneOS image
flashować Puli AX
wdrażać realnego Firecracker runtime
wdrażać produkcyjnego HSM
być certyfikowalnym środowiskiem produkcyjnym
```

V2 musi jednak zdefiniować stabilne adaptery i kontrakty pod te elementy.

## V2 Primary Outcome

Na koniec V2 oczekujemy:

```text
admin loguje się do panelu
tworzy tenant/operator/provider/app
tworzy urządzenia
generuje provisioning plan
wykonuje job orchestratora w trybie mock/adapter
widzi inventory, certyfikaty, artifacty, CDR, monitoring, incydenty i audit
system zachowuje dane po restarcie
testy e2e przechodzą przez UI i API
```

## Human Gate

HUMAN GATE REQUIRED pozostaje dla:

```text
produkcyjnego Puli AX qualification
realnych provider credentials na prawdziwych kontach
produkcyjnego WebAuthn/FIDO2 policy
image signing / key custody
jurisdiction policy wording per rynek
HSM/KMS/BYO-HSM decyzji
```

