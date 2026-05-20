# Admin API Implementation Status

Status na 2026-05-20.

V1 jest zamrozone. V2 Step 1, Step 2, Step 3.1, Step 3.2, Step 3.3, Step 3.4 i Step 3.5 sa zaimplementowane:

```text
Step 1: API SDK + SQLite persistence foundation
Step 2: Live Admin Shell served by Admin API under /admin
Step 3.1: WebAuthn-compatible auth API, challenge store, credential registry, session and step-up endpoints
Step 3.2: Step-up enforcement for provider secrets and orchestrator execution
Step 3.3: Recovery request workflow, account lockout and break-glass placeholder model
Step 3.4: WebAuthn verifier boundary, credential lifecycle and auth hardening
Step 3.5: PHANTOM governance-only boundary and premium admin UX foundation
```

## Zaimplementowane Moduly Domenowe

```text
M01 Admin Shell / Frontend
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

## Frontend V2 Step 2 / Step 3

```text
apps/admin-web/index.html
apps/admin-web/styles.css
apps/admin-web/app.js
```

Panel live obsluguje:

```text
WebAuthn-compatible enrollment/login przez lokalny simulator
health/status API
dashboard metryk
tworzenie tenantow i operatorow
dodawanie providerow bez ujawniania plaintext secret
rejestracje Pixel / GrapheneOS, Puli AX i FIDO2
generowanie provisioning planu
uruchamianie orchestrator job
step-up modal dla chronionych operacji
podglad audit stream
demo flow end-to-end z poziomu przegladarki
session status security view
recovery request creation without automatic unlock
break-glass placeholder creation with HUMAN GATE marker
WebAuthn mode selector and capability status
credential list/suspend/revoke with step-up protection
auth policy matrix visibility
PHANTOM governance boundary as separate track
PHANTOM capability/approval/risk governance records without execution
premium dashboard status strip and HelpTip anchors
```

## Najwazniejsze Testy

```text
admin-web-static.test.js
  Admin Web jest serwowany przez Admin API pod /admin.

auth-webauthn-step3.test.js
  WebAuthn-compatible enrollment/login, challenge replay, expired challenge,
  missing credential, session-bound step-up i leakage checks.

step-up-enforcement-step3-2.test.js
  Step-up enforcement dla provider create, provider secret rotation i orchestrator job.
  Testuje brak side effect przed step-up, retry po step-up, idempotency i leakage checks.

recovery-lockout-step3-3.test.js
  Account lockout po powtarzalnych bledach, recovery request bez auto-unlock,
  review-only status workflow, RBAC denial dla support readonly oraz break-glass
  placeholder z HUMAN GATE i separacja PHANTOM v3.0.

webauthn-hardening-step3-4.test.js
  WebAuthn verifier boundary, auth policy matrix, credential lifecycle,
  step-up dla revoke, revoked credential login block oraz audit leakage checks.

phantom-governance-step3-5.test.js
  PHANTOM governance boundary, capability registry, approval workflow, risk register,
  RBAC denial, no side effects, HUMAN GATE and prohibited operational detail rejection.

full-admin-human-flow.e2e.test.js
  Pelny przeplyw przez HTTP:
  login -> tenant -> operator -> provider -> app -> CDR -> provisioning plan
  -> devices -> orchestrator -> inventory -> PKI -> image artifacts
  -> jurisdiction -> Matrix -> monitoring -> incident -> audit.

devices-images-orchestrator.test.js
  Device Inventory, Image Factory i Orchestrator.

persistence-sdk.v2.test.js
  V2 SDK + SQLite persistence. Test tworzy flow, restartuje aplikacje i potwierdza,
  ze dane oraz audit przetrwaly.

spine.e2e.test.js
  Minimalny integration spine.

apps-cdr.contract.test.js
  Authorized App Catalog i CDR.

inventory-pki.contract.test.js
  3 VPS per operator i lifecycle certyfikatow.

monitoring-incidents.contract.test.js
  Monitoring bez tresci komunikacji i incydenty z runbookami.

providerRegistry.test.js / providers.e2e.test.js
  Provider Registry i Secret Manager bez wycieku plaintext sekretow.
```

## Uruchomienie Testow

PowerShell blokuje `npm.ps1`, dlatego uzywamy:

```powershell
npm.cmd test
```

Aktualny wynik:

```text
42 tests
42 passing
0 failing
```

## Nastepny Priorytet

```text
1. Wdrozyc Step 3.6 - PHANTOM Full Administrative Lifecycle And Execution-Readiness Gates.
2. Zaczac od capability package builder i policy template library.
3. Dodac readiness/gate engine, evidence bundles i approval packs.
4. Dodac simulation-only runner, entitlement hooks, operator planning i audit correlation.
5. Rozszerzyc PHANTOM UI o pelny lifecycle bez execution.
```
