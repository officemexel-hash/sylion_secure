# Admin API Implementation Status

Status na 2026-05-20.

V1 jest zamrożone. Rozpoczęto V2: API SDK + SQLite persistence foundation.

## Zaimplementowane Moduły Domenowe

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
```

## Częściowo Zaimplementowane

```text
M01 Admin Shell / Frontend
  Istnieje statyczny shell w apps/admin-web. Pełne formularze i integracja live z API są kolejnym etapem.
```

## Najważniejsze Testy

```text
full-admin-human-flow.e2e.test.js
  Pełny przepływ przez HTTP:
  login -> tenant -> operator -> provider -> app -> CDR -> provisioning plan
  -> devices -> orchestrator -> inventory -> PKI -> image artifacts
  -> jurisdiction -> Matrix -> monitoring -> incident -> audit.

devices-images-orchestrator.test.js
  Device Inventory, Image Factory i Orchestrator.

persistence-sdk.v2.test.js
  V2 SDK + SQLite persistence. Test tworzy flow, restartuje aplikację i potwierdza, że dane oraz audit przetrwały.

spine.e2e.test.js
  Minimalny integration spine.

apps-cdr.contract.test.js
  Authorized App Catalog i CDR.

inventory-pki.contract.test.js
  3 VPS per operator i lifecycle certyfikatów.

monitoring-incidents.contract.test.js
  Monitoring bez treści komunikacji i incydenty z runbookami.

providerRegistry.test.js / providers.e2e.test.js
  Provider Registry i Secret Manager bez wycieku plaintext sekretów.
```

## Uruchomienie Testów

PowerShell blokuje `npm.ps1`, dlatego używamy:

```powershell
node --test services/admin-api/test/*.test.js
```

Aktualny wynik:

```text
24 tests
24 passing
0 failing
```

## Następny Priorytet

```text
1. Rozbudować M01 Admin Shell do interaktywnego panelu live API.
2. Rozszerzyć SQLite schema/repositories poza KV foundation.
3. Dodać ProviderAdapter boundary dla mock/Hetzner/OVH.
4. Dodać realny WebAuthn/FIDO2 zamiast dev flag fido2Verified.
```
