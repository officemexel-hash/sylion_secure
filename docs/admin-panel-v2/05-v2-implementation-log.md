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
