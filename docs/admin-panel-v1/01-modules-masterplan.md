# SYLION Admin Panel V1 - Masterplan Modułowy

## Zasada Podziału

System budujemy jako moduły składane przez API, eventy i kontrakty. Na etapie MVP może to być modular monolith, ale granice domenowe muszą być gotowe do wydzielenia usług.

Reguły:

```text
każdy moduł ma jedną odpowiedzialność
każdy moduł ma własne modele i kontrakty
żaden moduł nie czyta bezpośrednio bazy innego modułu
integracja przez API/event bus
każdy moduł emituje audit events
każdy moduł obsługuje correlation_id
operacje tworzące zasoby obsługują idempotency_key
sekrety są tylko jako secret_reference
```

## Moduły

| ID | Moduł | Odpowiedzialność | Może być budowany niezależnie | Krytyczne zależności |
|---|---|---|---:|---|
| M01 | Admin Shell / Frontend | UI panelu | tak, na mockach | API contracts |
| M02 | Authentication | login, FIDO2, sesje | tak | M16 |
| M03 | RBAC / Permissions | role, uprawnienia, four-eyes | tak | M02, M16 |
| M04 | Tenant Management | tenanty, polityki tenantów | tak | M03, M06, M16 |
| M05 | Operator Management | profil i status operatora | tak | M04, M06, M10, M16 |
| M06 | Subscription & Entitlements | tiery, limity, add-ony | tak | M16 |
| M07 | Provisioning Plan Engine | generuje plan, nie wykonuje | częściowo | M04-M11, M13, M16 |
| M08 | Provider Registry | providerzy, regiony, quota | tak | M18, M16 |
| M09 | Infrastructure Inventory | G1/G2/Workload inventory | tak | M08, M15, M16 |
| M10 | Device Inventory | Pixel, Puli AX, FIDO2 | częściowo | M05, M14, M15, M16 |
| M11 | Authorized App Catalog | katalog aplikacji | tak | M03, M06, M12, M16 |
| M12 | CDR Service | file ingress/egress decisions | tak | M04, M05, M11, M15, M16 |
| M13 | Jurisdiction Policy Engine | regiony, providerzy, rotacje | częściowo | M06, M08, M09, M14, M16 |
| M14 | PKI / Certificate Lifecycle | certyfikaty i revocation | częściowo | M18, M09, M10, M16 |
| M15 | Monitoring & Anomaly Detection | health, alerty, anomalie | tak | M09, M10, M12, M14, M16 |
| M16 | Audit / WORM / Hash-chain | audyt systemowy | tak | brak |
| M17 | Incident & Runbook Manager | incydenty i runbooki | tak | M15, M05, M09, M10, M14, M16 |
| M18 | Secret Manager Adapter | Vault/KMS/HSM/BYO-HSM | tak | M16 |
| M19 | Image Factory | Pixel/router/workload artifacts | częściowo | M10, M11, M12, M14, M18, M16 |
| M20 | Orchestrator / Job Runner | wykonanie planów | nie jako pierwszy | M07-M19 |
| M21 | Matrix Server Manager | Matrix add-on | częściowo | M04, M05, M06, M08, M09, M14, M15, M16, M20 |

## Granice Odpowiedzialności

```text
M07 planuje, ale nie tworzy zasobów.
M20 wykonuje plan, ale nie decyduje sam o polityce.
M06 mówi, czy funkcja jest dostępna w tierze.
M03 mówi, kto może wykonać akcję.
M16 zapisuje, co się stało.
M18 nie oddaje plaintext sekretów do UI.
M12 decyduje o plikach.
M15 nie loguje treści komunikacji.
M11 zarządza katalogiem, ale nie uruchamia workloadów.
M21 zarządza Matrix, ale respektuje M06.
```

## Minimalny Integration Spine

Pierwszy działający kręgosłup:

```text
M16 Audit
M02 Authentication
M03 RBAC
M04 Tenant Management
M05 Operator Management
M06 Subscription & Entitlements
M07 Provisioning Plan Engine
```

Ten spine ma umożliwić:

```text
admin login
permission check
tenant create
operator create
tier assignment
provisioning plan generation
audit trail
```

## Proponowana Struktura Repo

```text
/apps
  /admin-web

/services
  /auth
  /rbac
  /tenants
  /operators
  /entitlements
  /provisioning-plan
  /provider-registry
  /infrastructure-inventory
  /device-inventory
  /authorized-apps
  /cdr
  /jurisdiction-policy
  /pki
  /monitoring
  /audit
  /incidents
  /secret-manager
  /image-factory
  /orchestrator
  /matrix-manager

/contracts
  /openapi
  /events
  /schemas
  /permissions

/libs
  /shared-types
  /audit-client
  /policy-client
  /test-fixtures

/docs
  /admin-panel-v1
  /architecture
  /adr
  /runbooks
```

## Minimalny Kontrakt Modułu

Każdy moduł musi dostarczyć:

```text
README.md
OpenAPI albo równoważny API contract
event contracts
data schemas
permissions required
audit events emitted
error codes
security invariants
unit tests
contract tests
mock fixtures
```

Przykład eventu:

```json
{
  "event_type": "operator.created",
  "event_version": 1,
  "tenant_id": "tenant_123",
  "operator_id": "op_123",
  "actor_id": "admin_123",
  "correlation_id": "corr_123",
  "timestamp": "2026-05-20T12:00:00Z"
}
```
