# Admin API Implementation Status

Status na 2026-05-20.

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
M11 Authorized App Catalog
M12 CDR Service
M13 Jurisdiction Policy Engine
M14 PKI / Certificate Lifecycle
M15 Monitoring & Anomaly Detection
M16 Audit / WORM / Hash-chain
M17 Incident & Runbook Manager
M18 Secret Manager Adapter
M21 Matrix Server Manager
```

## Częściowo Zaimplementowane

```text
M01 Admin Shell / Frontend
  Nie ma jeszcze frontendu. Admin API ma kontrakt HTTP i testy e2e.

M10 Device Inventory
  Urządzenia są uwzględnione w planie i PKI, ale osobny moduł inventory Pixel/Puli AX/FIDO2 jeszcze nie istnieje.

M19 Image Factory
  Plan provisioningowy i Matrix/workload artifacts mają pola referencyjne, ale nie ma jeszcze factory obrazów.

M20 Orchestrator / Job Runner
  Istnieje plan provisioningowy, inventory i PKI, ale wykonawca planów nie tworzy jeszcze zasobów.
```

## Najważniejsze Testy

```text
full-admin-human-flow.e2e.test.js
  Pełny przepływ przez HTTP:
  login -> tenant -> operator -> provider -> app -> CDR -> provisioning plan
  -> inventory -> PKI -> jurisdiction -> Matrix -> monitoring -> incident -> audit.

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
20 tests
20 passing
0 failing
```

## Następny Priorytet

```text
1. M10 Device Inventory
2. M19 Image Factory
3. M20 Orchestrator / Job Runner
4. M01 Admin Shell / Frontend
```

