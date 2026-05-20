# SYLION Admin Panel V1 - Workplan

## Cel Tego Pliku

Ten plik mówi, jak realnie rozpocząć pracę nad modułami, jak rozdzielać zadania między developerów/modele i jak składać wyniki w całość.

## Reguła Pracy Równoległej

Każdy developer/model dostaje:

```text
1. Prompt Bazowy z 02-module-prompt-pack.md
2. Jeden prompt modułu Mxx
3. Kontrakty zależności albo mocki
4. Definition of Done modułu
```

Nie wolno implementować prywatnych zależności innego modułu przez importy lub bezpośredni dostęp do bazy. Integracja odbywa się przez:

```text
API contract
event contract
schemas
mock fixtures
contract tests
```

## Workstream A - Foundation Spine

Priorytet: najwyższy.

Moduły:

```text
M16 Audit
M02 Authentication
M03 RBAC
M06 Subscription & Entitlements
M04 Tenant Management
M05 Operator Management
M07 Provisioning Plan Engine
```

Cel:

```text
admin może się zalogować
system sprawdza role
admin tworzy tenant
admin tworzy operator
operator dostaje tier
system generuje provisioning plan
wszystko zapisuje audit events
```

Definition of Done:

```text
API contracts gotowe
event contracts gotowe
unit tests gotowe
contract tests gotowe
I01 Integration Spine przechodzi
```

## Workstream B - Provider, Inventory, Secrets

Moduły:

```text
M18 Secret Manager Adapter
M08 Provider Registry
M09 Infrastructure Inventory
M14 PKI / Certificate Lifecycle
```

Cel:

```text
providerzy są rejestrowani bez plaintext sekretów
inventory umie śledzić G1/G2/Workload VPS
PKI wydaje referencje certyfikatów
każdy zasób ma owner operator_id
```

Definition of Done:

```text
provider secrets tylko jako secret_reference
G1/G2/Workload nie mogą być współdzielone
cert lifecycle emituje audit events
```

## Workstream C - Execution

Moduły:

```text
M19 Image Factory
M20 Orchestrator / Job Runner
```

Cel:

```text
zatwierdzony plan da się wykonać jako job
job ma kroki, statusy, retry, rollback_plan
obrazy/configi mają version/signature/policy attachment
```

Definition of Done:

```text
I03 Provisioning Execution przechodzi na mock providerze
idempotency_key działa
rollback jest testowany
audit pokazuje wszystkie job steps
```

## Workstream D - Devices, Apps, CDR

Moduły:

```text
M10 Device Inventory
M11 Authorized App Catalog
M12 CDR Service
```

Cel:

```text
Pixel/Puli AX/FIDO2 są widoczne w inventory
Global Super Admin zarządza katalogiem aplikacji
operator tworzy workloady tylko z katalogu
CDR blokuje każdy file ingress/egress bez decyzji
```

Definition of Done:

```text
limity tierów działają
unknown files trafiają do block/quarantine
CDR evidence jest audytowalne
```

## Workstream E - Operations

Moduły:

```text
M15 Monitoring & Anomaly Detection
M17 Incident & Runbook Manager
M13 Jurisdiction Policy Engine
M21 Matrix Server Manager
```

Cel:

```text
monitoring pokazuje health bez treści komunikacji
alert może utworzyć incident
jurisdiction rotation respektuje tier, approvals i cooldown
Matrix działa jako paid add-on
```

Definition of Done:

```text
symulacje IPsec down, DNS leak, crash loop, cert expiry działają
incydenty mają runbook
rotacje nie wpływają na innych operatorów
Matrix wymaga entitlement/add-on
```

## Workstream F - Admin UI

Moduł:

```text
M01 Admin Shell / Frontend
```

Cel:

```text
pełny panel działa na mockach
potem jest spinany z backend API
UI pokazuje loading/error/empty/success
UI nie podejmuje decyzji bezpieczeństwa samodzielnie
```

Definition of Done:

```text
wszystkie zakładki istnieją
formularze mają walidacje
niebezpieczne akcje mają confirmation/four-eyes flow
human frontend test przechodzi
```

## Kolejność Integracji

```text
1. I01 Integration Spine
2. I02 Provisioning Planning
3. I03 Provisioning Execution
4. I04 Workload Integration
5. I05 Jurisdiction Rotation
6. I06 Matrix Add-on
7. I07 Admin Frontend Integration
8. Final Human E2E Test
```

## Definition Of Ready Dla Modułu

Moduł jest gotowy do pracy, jeśli ma:

```text
prompt modułu
listę zależności
mocki zależności
owned entities
public API draft
event draft
permissions draft
audit event draft
test scope
```

## Definition Of Done Dla Modułu

Moduł jest gotowy do integracji, jeśli ma:

```text
działający kod albo kompletny artifact implementacyjny
API contract
event contract
schema
unit tests
contract tests
security invariants
audit events
error handling
idempotency dla operacji tworzących zasoby
brak plaintext sekretów w logach/API/UI
```

## Pierwsze Zadania Do Uruchomienia

Najpierw uruchomić równolegle:

```text
Task A1: M16 Audit
Task A2: M06 Subscription & Entitlements
Task A3: M02 Authentication
Task A4: M03 RBAC
Task A5: M04 Tenant Management on mocks
Task A6: M05 Operator Management on mocks
Task A7: M07 Provisioning Plan Engine skeleton
```

Pierwsza integracja:

```text
I01 Integration Spine
```

Pierwszy test człowieka:

```text
admin login -> create tenant -> create operator -> assign tier -> generate provisioning plan -> inspect audit log
```

