# SYLION Admin Panel V2 - Step 3 Masterplan

## Nazwa Etapu

```text
V2 Step 3 - WebAuthn/FIDO2 And Step-up Security
```

## Strategia

Step 3 nie ma byc tylko ekranem logowania. To ma byc fundament zaufania dla panelu administratora:

```text
admin enrollment
login challenge
session security
step-up dla akcji wrazliwych
lockout/recovery
audit
UI states
human security tests
```

Najpierw budujemy kontrakt i lokalny simulator, ktory jest kompatybilny z produkcyjnym WebAuthn. Dopiero potem mozna podmienic simulator na prawdziwy browser WebAuthn.

## Moduly Step 3

```text
S3-A Auth API Contract
S3-B Challenge Store
S3-C Credential Registry
S3-D Session And Step-up Policy
S3-E Admin Security UI
S3-F Audit And RBAC Integration
S3-G Recovery, Lockout And Break-glass
S3-H Human Security Test Harness
```

## S3-A Auth API Contract

Cel:

```text
Zdefiniowac jawny kontrakt API dla enrollment, login i step-up.
```

Endpointy docelowe:

```text
POST /auth/webauthn/enrollment/options
POST /auth/webauthn/enrollment/verify
POST /auth/webauthn/login/options
POST /auth/webauthn/login/verify
POST /auth/step-up/options
POST /auth/step-up/verify
GET  /auth/session
POST /auth/logout
```

Odpowiedzialnosc:

```text
request/response shape
error model
correlation id
audit action names
compatibility with browser WebAuthn
dev simulator boundary
```

Nie robi:

```text
nie generuje UI
nie przechowuje credential
nie implementuje lockout policy
```

## S3-B Challenge Store

Cel:

```text
Bezpiecznie przechowywac challenge dla enrollment/login/step-up.
```

Wymagania:

```text
challenge id
challenge hash, nie plaintext jesli mozliwe
purpose: enrollment/login/step_up
actor/admin binding
TTL
single-use
replay protection
attempt counter
audit on issued/verified/expired/replayed
persistence across short restart if required by TTL
```

## S3-C Credential Registry

Cel:

```text
Przechowywac publiczne metadane credential admina bez prywatnych sekretow.
```

Zakres:

```text
credential id
admin id
public key reference/material allowed by WebAuthn model
transports
attestation metadata placeholder
sign counter
created_at
last_used_at
status: active/revoked/replaced
```

Zakazy:

```text
brak private key
brak raw biometric data
brak PIN/password in registry
brak sensitive material in audit
```

## S3-D Session And Step-up Policy

Cel:

```text
Powiazac sesje administratora z poziomem swiezosci uwierzytelnienia.
```

Zakres:

```text
session TTL
idle timeout
step_up_valid_until
last_fido2_at
required assurance level
policy dla akcji wrazliwych
grace period
logout
session introspection endpoint
```

Akcje wymagajace step-up w Step 3:

```text
provider secret rotation
provider creation with secret
orchestrator execute job
future destructive action placeholder
future jurisdiction high-risk rotation placeholder
future break-glass approval placeholder
```

## S3-E Admin Security UI

Cel:

```text
Dodac do panelu realne ekrany i stany security flow.
```

Widoki:

```text
Security Enrollment
Login Challenge
Session Status
Step-up Modal
Credential List
Recovery/Lockout Status
Audit Security Events
```

Wymagania UX:

```text
jasne loading/error/success states
brak technicznego materialu kryptograficznego na ekranie
brak sekretow w DOM po zakonczeniu operacji
retry bez replay challenge
czytelne komunikaty dla wygaslej sesji
```

## S3-F Audit And RBAC Integration

Cel:

```text
Kazda decyzja security ma byc audytowalna i powiazana z RBAC.
```

Audit events:

```text
auth.challenge_issued
auth.challenge_verified
auth.challenge_failed
auth.challenge_replayed
auth.credential_enrolled
auth.credential_revoked
auth.session_created
auth.session_expired
auth.step_up_required
auth.step_up_completed
auth.lockout_started
auth.recovery_started
auth.break_glass_requested
```

RBAC:

```text
credential.manage
credential.read
session.read
auth.recovery.manage
break_glass.request
break_glass.approve
```

## S3-G Recovery, Lockout And Break-glass

Cel:

```text
Przygotowac kontrolowana sciezke awaryjna bez robienia plaintext fallback auth.
```

Zakres:

```text
failed attempts threshold
temporary lockout
manual recovery request
two-person approval placeholder
break-glass event model
mandatory audit
no automatic privilege escalation
```

HUMAN GATE:

```text
Kazda produkcyjna polityka break-glass wymaga oddzielnej decyzji czlowieka.
Step 3 moze miec tylko model, endpointy i testowy placeholder.
```

## S3-H Human Security Test Harness

Cel:

```text
Przetestowac security flow jak czlowiek, nie tylko jako unit test.
```

Zakres:

```text
API tests
browser UI tests
manual checklist
challenge replay negative test
expired challenge negative test
wrong actor challenge negative test
step-up required test
session expiry test
secret leakage test
audit completeness test
restart/persistence test
```

## Kolejnosc Implementacji

```text
1. S3-A Auth API Contract
2. S3-B Challenge Store
3. S3-C Credential Registry
4. S3-D Session And Step-up Policy
5. S3-F Audit And RBAC Integration
6. S3-E Admin Security UI
7. S3-G Recovery, Lockout And Break-glass
8. S3-H Human Security Test Harness
```

## Minimalny Slice Do Pierwszego Commita

```text
challenge store
credential registry
local WebAuthn simulator
enrollment options/verify
login options/verify
tests for enrollment/login/replay
docs update
```

## Minimalny Slice Do Drugiego Commita

```text
session introspection
step-up options/verify
step-up required on orchestrator execute job
UI step-up modal
browser verification
```
