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
