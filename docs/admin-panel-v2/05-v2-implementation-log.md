# SYLION Admin Panel V2 - Implementation Log

## Step 1 - API SDK + SQLite Persistence Foundation

Status: implemented
Data: 2026-05-20

### Zakres

Zaimplementowano pierwszy krok V2:

```text
API client / SDK foundation
SQLite persistence adapter
persistent maps dla domen
restart/persistence test
dev env hint przez .env.example
```

### Pliki

```text
services/admin-api/src/storage/sqliteStore.js
services/admin-api/src/storage/persistentMap.js
services/admin-api/src/sdk/adminApiClient.js
services/admin-api/test/persistence-sdk.v2.test.js
.env.example
```

### Persistence

Dodano `SqliteStore` oparty o `node:sqlite`.

V2 Step 1 używa prostego KV schema:

```text
collection
key
value_json
updated_at
```

To jest świadomy etap przejściowy. Pozwala utrwalić obecne domeny bez przepisywania logiki. W kolejnym kroku można migrować wybrane kolekcje do jawnych tabel.

### Objęte Domeny

Persistence podłączono do:

```text
audit
auth admins/sessions
tenants
operators
provisioning plans
providers
secrets
devices
apps
CDR decisions
CDR monitoring events
infrastructure sets
certificates
image artifacts
monitoring events
incidents
jurisdiction policies
matrix servers
orchestrator jobs
```

### SDK

Dodano `AdminApiClient`:

```text
login
createTenant
createOperator
createProvider
registerDevice
createProvisioningPlan
executeJob
listAuditEvents
generic request
```

### Test

Dodano test:

```text
persistence-sdk.v2.test.js
```

Test:

```text
startuje Admin API z SQLite
tworzy tenant/operator/provider/devices/plan/job
zamyka backend
uruchamia backend ponownie na tym samym DB
sprawdza tenant/operator/provider/devices/plan/job/audit
sprawdza brak plaintext provider secret
```

### Wynik

```text
npm.cmd test
24 tests
24 passing
0 failing
```

### Nastepny Krok

```text
V2-A Live Admin Shell with SDK
```

Równolegle można zacząć:

```text
V2-D Provider Adapter Boundary
V2-E Job Queue Runtime
```

## Step 2 - Live Admin Shell

Status: implemented
Data: 2026-05-20

### Zakres

Zaimplementowano drugi krok V2:

```text
Admin Web serwowany przez Admin API pod /admin
login do API z poziomu UI
dashboard health/metrics/audit
formularze tenant/operator/provider/device
generowanie provisioning planu
uruchamianie orchestrator job
demo flow end-to-end z poziomu przegladarki
```

### Pliki

```text
apps/admin-web/index.html
apps/admin-web/styles.css
apps/admin-web/app.js
apps/admin-web/README.md
services/admin-api/src/app.js
services/admin-api/test/admin-web-static.test.js
```

### Security Notes

```text
provider secret jest wysylany tylko przy zapisie i czyszczony z formularza
UI pokazuje tylko secret reference, nie plaintext secret
panel korzysta z tokenu sesji Admin API
kazda operacja UI dodaje x-correlation-id
audit pozostaje hash-chained
CDR pozostaje oznaczone jako obowiazkowy invariant
Puli AX nadal ma gate kwalifikacyjny do produkcji
```

### Następny Krok

```text
V2 Step 3 - WebAuthn/FIDO2 enrollment and step-up security UX
```

## Step 2 Freeze / Step 3 Planning Package

Status: planned
Data: 2026-05-20

Dodano pakiet planistyczny kolejnego etapu:

```text
06-step2-freeze-and-step3-scope.md
07-step3-masterplan.md
08-step3-prompt-pack.md
09-step3-graphs-roadmap.md
STEP3_DIAGRAMS.md
diagrams/06-step3-module-dependencies.mmd
diagrams/07-step3-module-map.mmd
diagrams/08-step3-deployment-graph.mmd
diagrams/09-step3-runtime-sequence.mmd
diagrams/10-step3-roadmap-gantt.mmd
```

Kolejny etap zostal zdefiniowany jako:

```text
V2 Step 3 - WebAuthn/FIDO2 And Step-up Security
```

## Step 3.1 - WebAuthn-Compatible Auth Core

Status: implemented
Data: 2026-05-20

### Zakres

Zaimplementowano pierwszy slice Step 3:

```text
WebAuthn-compatible enrollment options/verify
WebAuthn-compatible login options/verify
Challenge Store z TTL, single-use i replay protection
Credential Registry bez private key / PIN / biometric data
Session introspection endpoint
Logout endpoint
Step-up options/verify endpoint
Local WebAuthn simulator boundary dla dev/test
Admin Web enrollment/login przez nowy flow
Security session card w panelu
```

### Endpointy

```text
POST /auth/webauthn/enrollment/options
POST /auth/webauthn/enrollment/verify
POST /auth/webauthn/login/options
POST /auth/webauthn/login/verify
GET  /auth/session
POST /auth/logout
POST /auth/step-up/options
POST /auth/step-up/verify
```

### Pliki

```text
services/admin-api/src/modules/auth/authService.js
services/admin-api/src/app.js
services/admin-api/src/sdk/adminApiClient.js
services/admin-api/test/auth-webauthn-step3.test.js
apps/admin-web/index.html
apps/admin-web/styles.css
apps/admin-web/app.js
```

### Security Notes

```text
dev flaga fido2Verified nie jest juz publicznym login flow panelu
challenge jest single-use
challenge ma TTL
replay challenge jest blokowany i audytowany
step-up challenge jest przypisany do konkretnej sesji
credential registry nie zwraca private key, PIN ani biometric data
UI nie pokazuje hasla ani simulated public key po loginie
```

### Test

```text
npm.cmd test
30 tests
30 passing
0 failing
```

### Browser Verification

```text
/admin
Enroll FIDO2
Sign In
Run Demo Flow
secret leakage visible in UI: false
```

### Nastepny Krok

```text
Step 3.2 - enforce step-up policy on orchestrator execute job and provider secret rotation
```

## Step 3.1 Freeze / Step 3.2 Planning Package

Status: planned
Data: 2026-05-20

Zamrozono stan po:

```text
90b194d Implement Step 3 WebAuthn auth core
```

Dodano pakiet planistyczny kolejnego etapu:

```text
10-step3-1-freeze-and-step3-2-scope.md
11-step3-2-masterplan.md
12-step3-2-prompt-pack.md
13-step3-2-graphs-roadmap.md
STEP3_2_DIAGRAMS.md
diagrams/11-step3-2-module-dependencies.mmd
diagrams/12-step3-2-module-map.mmd
diagrams/13-step3-2-deployment-graph.mmd
diagrams/14-step3-2-runtime-flow.mmd
diagrams/15-step3-2-roadmap-gantt.mmd
```

Kolejny etap zostal zdefiniowany jako:

```text
V2 Step 3.2 - Step-up Enforcement For Sensitive Admin Actions
```

## Step 3.2 - Step-up Enforcement For Sensitive Admin Actions

Status: implemented
Data: 2026-05-20

### Zakres

Zaimplementowano Step 3.2:

```text
centralny requireFreshStepUp helper
step_up_required AppError z action, sessionId, requiredFreshness i stepUpEndpoint
egzekwowanie step-up przed POST /providers
egzekwowanie step-up przed POST /providers/:id/secret-rotation
egzekwowanie step-up przed POST /orchestrator/jobs
SDK helper isStepUpRequired i withStepUpRetry
Admin Web global step-up modal
Admin Web retry chronionej akcji po step-up
API negative tests i leakage checks
```

### Pliki

```text
services/admin-api/src/modules/auth/authService.js
services/admin-api/src/app.js
services/admin-api/src/sdk/adminApiClient.js
services/admin-api/test/step-up-enforcement-step3-2.test.js
services/admin-api/test/providers.e2e.test.js
services/admin-api/test/devices-images-orchestrator.test.js
services/admin-api/test/full-admin-human-flow.e2e.test.js
services/admin-api/test/persistence-sdk.v2.test.js
apps/admin-web/index.html
apps/admin-web/styles.css
apps/admin-web/app.js
```

### Security Notes

```text
side effect jest blokowany przed step-up dla provider secrets i orchestrator job
provider apiSecret nie pojawia sie w step_up_required error
provider apiSecret nie pojawia sie w audit przy odmowie
orchestrator idempotency pozostaje stabilne po retry
legacy token bez swiezego step-up jest blokowany dla operacji wrazliwych
step-up modal ponawia akcje tylko po pozytywnej weryfikacji
```

### Test

```text
npm.cmd test
33 tests
33 passing
0 failing
```

### Browser Verification

```text
/admin loads
API Healthy
step-up modal exists and is hidden by default
password is not visible in page text
Browser runtime could not type password because its virtual clipboard is unavailable
```

### Nastepny Krok

```text
Step 3.3 - recovery, lockout and break-glass placeholder model
```

## Step 3.2 Freeze / Step 3.3 Planning Package

Status: planned
Data: 2026-05-20

Zamrozono stan po:

```text
07f38d4 Enforce step-up for sensitive admin actions
```

Dodano pakiet planistyczny kolejnego etapu:

```text
14-step3-2-freeze-and-step3-3-scope.md
15-step3-3-masterplan.md
16-step3-3-prompt-pack.md
17-step3-3-graphs-roadmap.md
STEP3_3_DIAGRAMS.md
diagrams/16-step3-3-module-dependencies.mmd
diagrams/17-step3-3-module-map.mmd
diagrams/18-step3-3-deployment-graph.mmd
diagrams/19-step3-3-runtime-flow.mmd
diagrams/20-step3-3-roadmap-gantt.mmd
```

Kolejny etap zostal zdefiniowany jako:

```text
V2 Step 3.3 - Recovery, Lockout And Break-glass Placeholder Model
```

Uwagi zgodnosci:

```text
Ksiega 3.4 pozostaje baseline dla normatywnych wymagan.
PHANTOM v3.0 pozostaje oddzielna sciezka i nie jest implementowany w baseline.
Production break-glass semantics wymagaja HUMAN GATE.
```

## Step 3.3 - Recovery, Lockout And Break-glass Placeholder Model

Status: implemented
Data: 2026-05-20

### Zakres

Zaimplementowano Step 3.3:

```text
account lockout po powtarzalnych bledach logowania / challenge
lockout state jako osobna kolekcja auth_failed_attempts
publiczny recovery request bez automatycznego odblokowania konta
review-only recovery status workflow
break-glass request jako placeholder bez side effects
HUMAN GATE jako wymagana bariera dla break-glass
jawne oznaczenie, ze PHANTOM v3.0 jest oddzielnym torem i nie jest baseline
Admin Web security view z recovery i break-glass forms
SDK metody dla recovery i break-glass
testy lockout, RBAC, audit leakage i PHANTOM separation
```

### Endpointy

```text
POST /auth/recovery/request
GET  /auth/recovery/requests
POST /auth/recovery/requests/:id/status
POST /auth/break-glass/requests
GET  /auth/break-glass/requests
```

### Pliki

```text
services/admin-api/src/modules/auth/authService.js
services/admin-api/src/app.js
services/admin-api/src/modules/rbac/rbacService.js
services/admin-api/src/sdk/adminApiClient.js
services/admin-api/test/recovery-lockout-step3-3.test.js
services/admin-api/test/admin-web-static.test.js
apps/admin-web/index.html
apps/admin-web/app.js
services/admin-api/IMPLEMENTATION_STATUS.md
```

### Security Notes

```text
recovery request nigdy nie wykonuje auto-unlock
approved_placeholder nie odblokowuje konta i nie uruchamia side effect
break-glass request ma status pending_human_gate
break-glass request zwraca sideEffectExecuted=false
break-glass request ma baselineBoundary=SYLION_BASELINE_PLACEHOLDER_ONLY
break-glass request ma phantomBoundary=PHANTOM_V3_SEPARATE_TRACK_NOT_IMPLEMENTED
support readonly nie moze czytac recovery queue
audit nie zawiera hasel ani provider secrets
Ksiega 3.4 pozostaje baseline
PHANTOM v3.0 pozostaje oddzielony od produktu baseline
```

### Test

```text
npm.cmd test
36 tests
36 passing
0 failing
```

### Nastepny Krok

```text
Step 3.3 Freeze / Step 3.4 Planning Package
```

## Step 3.3 Freeze / Step 3.4 Planning Package

Status: planned
Data: 2026-05-20

Zamrozono stan po:

```text
07877f4 Implement Step 3.3 recovery lockout placeholders
```

Dodano pakiet planistyczny kolejnego etapu:

```text
18-step3-3-freeze-and-step3-4-scope.md
19-step3-4-masterplan.md
20-step3-4-prompt-pack.md
21-step3-4-graphs-roadmap.md
STEP3_4_DIAGRAMS.md
diagrams/21-step3-4-module-dependencies.mmd
diagrams/22-step3-4-module-map.mmd
diagrams/23-step3-4-deployment-graph.mmd
diagrams/24-step3-4-runtime-flow.mmd
diagrams/25-step3-4-roadmap-gantt.mmd
```

Kolejny etap zostal zdefiniowany jako:

```text
V2 Step 3.4 - Real WebAuthn/FIDO2 Browser Binding And Auth Hardening
```

Uwagi zgodnosci:

```text
Ksiega 3.4 pozostaje baseline dla wymagan admin authentication hardening.
PHANTOM v3.0 pozostaje oddzielna sciezka i nie jest implementowany w baseline.
Production attestation policy, authenticator trust list i break-glass semantics wymagaja HUMAN GATE.
```

## Step 3.4 - Real WebAuthn/FIDO2 Browser Binding And Auth Hardening

Status: implemented
Data: 2026-05-20

### Zakres

Zaimplementowano Step 3.4:

```text
WebAuthnVerifier boundary
LocalSimulatorVerifier jako jawny dev/test adapter
BrowserWebAuthnVerifier placeholder z HUMAN GATE dla produkcyjnej attestation policy
rpId policy dla lokalnego browser flow
Auth Policy Matrix endpoint
Credential Lifecycle endpoints: list/suspend/revoke
step-up enforcement dla credential suspend/revoke
Admin Web WebAuthn mode selector
Admin Web WebAuthn capability status
Admin Web credential list with suspend/revoke actions
Admin Web auth policy matrix card
SDK metody dla policy matrix i credential lifecycle
manual browser/FIDO2 checklist
negative tests dla unsupported browser payload, revoke bez step-up, revoked login block i leakage
```

### Endpointy

```text
GET  /auth/policy-matrix
GET  /auth/credentials
POST /auth/credentials/:id/suspend
POST /auth/credentials/:id/revoke
```

### Pliki

```text
services/admin-api/src/modules/auth/webauthnVerifier.js
services/admin-api/src/modules/auth/authPolicy.js
services/admin-api/src/modules/auth/authService.js
services/admin-api/src/app.js
services/admin-api/src/modules/rbac/rbacService.js
services/admin-api/src/sdk/adminApiClient.js
services/admin-api/test/webauthn-hardening-step3-4.test.js
services/admin-api/test/admin-web-static.test.js
apps/admin-web/index.html
apps/admin-web/app.js
docs/admin-panel-v2/manual-tests/step3-4-webauthn-checklist.md
services/admin-api/IMPLEMENTATION_STATUS.md
```

### Security Notes

```text
production WebAuthn attestation policy pozostaje za HUMAN GATE
local simulator jest opisany jako dev/test path
unsupported browser assertion payload jest odrzucany bez logowania raw blobow
credential publicKey nie jest zwracany przez list endpoint
credential suspend/revoke wymaga RBAC i fresh step-up
revoked credential nie moze login/step-up
recovery nadal nie wykonuje auto-unlock
break-glass nadal ma sideEffectExecuted=false
PHANTOM v3.0 pozostaje separate track i nie jest baseline behavior
```

### Test

```text
npm.cmd test
39 tests
39 passing
0 failing
```

### Browser Verification

```text
/admin loads
API Healthy
WebAuthn mode selector exists
credential cards container exists
auth policy cards container exists
HUMAN GATE and PHANTOM separation remain visible
```

### Nastepny Krok

```text
Step 3.4 Freeze / Step 3.5 Planning Package
```

## Step 3.4 Freeze / Step 3.5 Planning Package

Status: planned
Data: 2026-05-20

Zamrozono stan po:

```text
22b007a Implement Step 3.4 WebAuthn hardening
```

Dodano pakiet planistyczny kolejnego etapu:

```text
22-step3-4-freeze-and-step3-5-scope.md
23-step3-5-masterplan.md
24-step3-5-prompt-pack.md
25-step3-5-graphs-roadmap.md
STEP3_5_DIAGRAMS.md
ui-concepts/step3-5-admin-ui-visual-brief.md
diagrams/26-step3-5-module-dependencies.mmd
diagrams/27-step3-5-module-map.mmd
diagrams/28-step3-5-deployment-graph.mmd
diagrams/29-step3-5-runtime-flow.mmd
diagrams/30-step3-5-ui-layout.mmd
diagrams/31-step3-5-roadmap-gantt.mmd
```

Kolejny etap zostal zdefiniowany jako:

```text
V2 Step 3.5 - PHANTOM Governance Boundary And Premium Admin UX
```

Uwagi zgodnosci:

```text
PHANTOM v3.0 jest planowany jako oddzielny modul governance w panelu.
Step 3.5 nie implementuje PHANTOM autonomous execution.
HUMAN GATE REQUIRED dla kazdej produkcyjnej funkcji PHANTOM.
Panel ma pokazywac governance, approvals, evidence, risk i audit, bez operacyjnych instrukcji PHANTOM.
UI/UX panelu ma zostac przebudowany w kierunku premium operational cockpit z helptipami.
```

## Step 3.5 - PHANTOM Governance Boundary And Premium Admin UX

Status: implemented
Data: 2026-05-20

### Zakres

Zaimplementowano Step 3.5:

```text
PHANTOM Governance Service
PHANTOM boundary endpointy
PHANTOM capability registry jako redacted governance metadata
PHANTOM approval workflow jako placeholder bez execution
PHANTOM risk register
RBAC permissions dla PHANTOM governance
audit events phantom.*
guardrail validation przeciw prohibited operational details
Admin Web PHANTOM navigation/view
premium dashboard status strip
HelpTip tooltip system
visual concept asset copied into docs/admin-panel-v2/assets
SDK methods for PHANTOM governance
API/static tests
```

### Endpointy

```text
GET  /phantom/boundary
POST /phantom/boundary/status
GET  /phantom/capabilities
POST /phantom/capabilities
POST /phantom/capabilities/:id/status
GET  /phantom/approvals
POST /phantom/approvals
POST /phantom/approvals/:id/status
GET  /phantom/risks
POST /phantom/risks
POST /phantom/risks/:id/status
```

### Pliki

```text
services/admin-api/src/modules/phantom/phantomGovernanceService.js
services/admin-api/src/app.js
services/admin-api/src/domain/constants.js
services/admin-api/src/modules/rbac/rbacService.js
services/admin-api/src/sdk/adminApiClient.js
services/admin-api/test/phantom-governance-step3-5.test.js
services/admin-api/test/admin-web-static.test.js
apps/admin-web/index.html
apps/admin-web/app.js
apps/admin-web/styles.css
docs/admin-panel-v2/assets/step3-5-admin-ui-concept.png
docs/admin-panel-v2/ui-concepts/step3-5-admin-ui-visual-brief.md
services/admin-api/IMPLEMENTATION_STATUS.md
```

### Security Notes

```text
PHANTOM pozostaje separate track
sideEffectAllowed=false dla boundary, capability, approval i risk
executionEnabled=false dla boundary, capability i approval
humanGateRequired=true dla PHANTOM governance records
approved_placeholder nie wlacza execution
support readonly nie ma dostepu do PHANTOM governance
service odrzuca prohibited operational details jak IMEI/IMSI/spoof/evasion/lawful bypass
audit nie zapisuje prohibited rejected input
UI pokazuje PHANTOM jako governance-only, nie baseline execution
```

### Test

```text
npm.cmd test
42 tests
42 passing
0 failing
```

### Browser Verification

```text
/admin loads
API Healthy
PHANTOM nav exists
PHANTOM view exists
HelpTip anchors exist
Boundary/capability/approval/risk containers exist
HUMAN GATE and sideEffectAllowed=false are visible
```

### Nastepny Krok

```text
Step 3.5 Freeze / Step 3.6 Planning Package
```

## Step 3.5 Freeze / Step 3.6 Planning Package

Status: planned
Data: 2026-05-20

Zamrozono stan po:

```text
5a248bc Implement Step 3.5 PHANTOM governance
```

Dodano pakiet planistyczny kolejnego etapu:

```text
26-step3-5-freeze-and-step3-6-scope.md
27-step3-6-masterplan.md
28-step3-6-prompt-pack.md
29-step3-6-graphs-roadmap.md
STEP3_6_DIAGRAMS.md
diagrams/32-step3-6-module-dependencies.mmd
diagrams/33-step3-6-module-map.mmd
diagrams/34-step3-6-deployment-graph.mmd
diagrams/35-step3-6-runtime-flow.mmd
diagrams/36-step3-6-gate-state-machine.mmd
diagrams/37-step3-6-ui-lifecycle.mmd
diagrams/38-step3-6-roadmap-gantt.mmd
```

Kolejny etap zostal zdefiniowany jako:

```text
V2 Step 3.6 - PHANTOM Full Administrative Lifecycle And Execution-Readiness Gates
```

Uwagi zgodnosci:

```text
Step 3.6 planuje pelny cykl administracyjny PHANTOM, nie operacyjne wykonanie.
PHANTOM pozostaje separate track [A], poza certyfikowalnym baseline SYLION.
Execution remains blocked by HUMAN GATE and baseline sideEffectAllowed=false.
Zakazane szczegoly operacyjne pozostaja poza UI/API/docs.
```

## Step 3.6 - PHANTOM Full Administrative Lifecycle And Execution-Readiness Gates

Status: implemented
Data: 2026-05-20

Zaimplementowano Step 3.6:

```text
PHANTOM policy template library
PHANTOM capability package builder
PHANTOM evidence bundle store with sealed references
PHANTOM approval pack builder
PHANTOM readiness/gate evaluator
PHANTOM simulation-only runner
PHANTOM subscription-aware operator assignment planner
PHANTOM audit correlation summary
SDK methods for PHANTOM lifecycle endpoints
Admin Web PHANTOM full lifecycle controls
Step 3.6 security and lifecycle tests
```

Dodane endpointy:

```text
GET  /phantom/policy-templates
POST /phantom/policy-templates
GET  /phantom/packages
POST /phantom/packages
POST /phantom/packages/:id/stage
GET  /phantom/evidence-bundles
POST /phantom/evidence-bundles
GET  /phantom/approval-packs
POST /phantom/approval-packs
GET  /phantom/readiness
POST /phantom/readiness/evaluate
GET  /phantom/simulations
POST /phantom/simulations
GET  /phantom/assignment-plans
POST /phantom/assignment-plans
GET  /phantom/audit-correlation
```

Zmodyfikowane pliki:

```text
apps/admin-web/app.js
apps/admin-web/index.html
services/admin-api/src/app.js
services/admin-api/src/domain/constants.js
services/admin-api/src/modules/phantom/phantomGovernanceService.js
services/admin-api/src/modules/rbac/rbacService.js
services/admin-api/src/sdk/adminApiClient.js
services/admin-api/test/admin-web-static.test.js
services/admin-api/test/phantom-lifecycle-step3-6.test.js
services/admin-api/IMPLEMENTATION_STATUS.md
services/admin-api/contracts/openapi-lite.md
```

Security notes:

```text
PHANTOM v3.0 pozostaje separate track [A]
Step 3.6 implementuje pelny lifecycle administracyjny, nie operational execution
sideEffectAllowed=false dla wszystkich nowych rekordow PHANTOM
executionAllowed=false i executionEnabled=false w readiness, simulation, package, evidence, approval pack i assignment plan
readiness gate moze zwrocic ready_for_human_gate, ale nadal nie wlacza execution
simulation runner ma mode=simulation_only
assignment planner sprawdza tier i baseline 3 VPS/CDR, ale nie wykonuje zmian
audit correlation pokazuje metadane hash-chain bez tresci komunikacji lub sekretow
RBAC blokuje support readonly
prohibited operational details sa odrzucane przed zapisem audytu
```

Test:

```text
npm.cmd test
45 tests
45 passing
0 failing
```

## Step 3.6 Freeze / Step 3.7 Planning Package

Status: planned
Data: 2026-05-20

Zamrozono stan po:

```text
846bb75 Implement Step 3.6 PHANTOM lifecycle gates
```

Dodano pakiet planistyczny kolejnego etapu:

```text
30-step3-6-freeze-and-step3-7-scope.md
31-step3-7-masterplan.md
32-step3-7-prompt-pack.md
33-step3-7-graphs-roadmap.md
STEP3_7_DIAGRAMS.md
diagrams/39-step3-7-module-dependencies.mmd
diagrams/40-step3-7-module-map.mmd
diagrams/41-step3-7-deployment-graph.mmd
diagrams/42-step3-7-runtime-flow.mmd
diagrams/43-step3-7-quota-state-machine.mmd
diagrams/44-step3-7-ui-layout.mmd
diagrams/45-step3-7-roadmap-gantt.mmd
```

Kolejny etap zostal zdefiniowany jako:

```text
V2 Step 3.7 - Subscription, Workload Environment And Billing Controls
```

Uwagi zgodnosci:

```text
Step 3.7 planuje warstwe subskrypcji, limitow workloadow, billing state i add-on controls.
Ksiegi 3.4 baseline pozostaje: 3 VPS per operator, G1/G2/WORKLOAD separation, CDR mandatory, Puli AX gate.
PHANTOM v3.0 pozostaje separate track [A], bez execution.
PHANTOM add-on dotyczy tylko admin lifecycle visibility/eligibility, nie aktywacji operacyjnej.
Billing suspension blokuje nowe alokacje, ale nie usuwa dowodow ani audytu.
```

## Step 3.7 - Subscription, Workload Environment And Billing Controls

Status: implemented
Data: 2026-05-20

Zaimplementowano Step 3.7:

```text
SubscriptionService
default subscription plan catalog
tenant subscription ledger
tenant add-on manager
billing state controls
workload quota quote engine
authorized app workload allocation
microVM placement planner
subscription/workload SDK methods
subscription/workload Admin UI
expanded API tests
dashboard Playwright human-flow test
```

Dodane endpointy:

```text
GET  /subscription/plans
POST /subscription/plans
GET  /tenants/:tenantId/subscription
POST /tenants/:tenantId/subscription
POST /tenants/:tenantId/subscription/addons
POST /tenants/:tenantId/billing-state
GET  /operators/:operatorId/workload-allocations
POST /operators/:operatorId/workload-allocations
POST /operators/:operatorId/workload-allocations/quote
POST /operators/:operatorId/microvm-placement-plan
GET  /subscription/quota-decisions
```

Security notes:

```text
Workload quote is side-effect free.
Denied allocation creates no workload allocation.
Billing suspended blocks new allocations and provisioning plan generation.
MicroVM placement is plan-only and does not execute Firecracker.
Authorized apps keep cdrRequired=true.
PHANTOM admin lifecycle add-on never enables PHANTOM execution.
PHANTOM v3.0 remains separate track [A].
```

Test:

```text
npm.cmd test
49 tests
49 passing
0 failing
```

Dashboard Playwright test:

```text
manual-tests/step3-7-dashboard-playwright-checklist.md
assets/step3-7-dashboard-playwright.png
```

## Step 3.7 Freeze / Step 3.8 Planning Package

Status: planned
Data: 2026-05-20

Zamrozono stan po:

```text
365295a Implement Step 3.7 subscription workload controls
```

Dodano pakiet planistyczny kolejnego etapu:

```text
34-step3-7-freeze-and-step3-8-scope.md
35-step3-8-masterplan.md
36-step3-8-prompt-pack.md
37-step3-8-graphs-roadmap.md
STEP3_8_DIAGRAMS.md
diagrams/46-step3-8-module-dependencies.mmd
diagrams/47-step3-8-module-map.mmd
diagrams/48-step3-8-deployment-graph.mmd
diagrams/49-step3-8-runtime-flow.mmd
diagrams/50-step3-8-workload-lifecycle.mmd
diagrams/51-step3-8-phantom-review-flow.mmd
diagrams/52-step3-8-roadmap-gantt.mmd
```

Kolejny etap zostal zdefiniowany jako:

```text
V2 Step 3.8 - Provisioning Approval Queue, Workload Lifecycle And PHANTOM Control Plane Expansion
```

Uwagi zgodnosci:

```text
Step 3.8 planuje approval queue, workload lifecycle, operator readiness gate i expanded dashboard regression.
PHANTOM rozwijamy jako control-plane review board, policy simulation harness i exception review.
PHANTOM nadal jest separate track [A], poza certyfikowalnym baseline.
PHANTOM execution remains disabled.
HUMAN GATE REQUIRED przed produkcyjna aktywacja PHANTOM, destructive cleanup lub customer-facing claims.
```
