# SYLION Admin Panel V2 - Step 3.1 Freeze And Step 3.2 Scope

Data: 2026-05-20

## Freeze Step 3.1

Zamrazamy stan po `V2 Step 3.1 - WebAuthn-Compatible Auth Core`.

### Stan Techniczny

```text
commit: 90b194d Implement Step 3 WebAuthn auth core
branch: main
remote: git@github.com-sylion-secure:officemexel-hash/sylion_secure.git
```

### Co Jest Gotowe

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
SDK metody dla enrollment/login/session/step-up
Security session card w panelu
```

### Testy Zamrozenia

```text
npm.cmd test
30 tests
30 passing
0 failing
```

### Invarianty Zachowane

```text
fido2Verified nie jest juz publicznym login flow panelu
challenge jest single-use
challenge ma TTL
replay challenge jest blokowany i audytowany
step-up challenge jest przypisany do konkretnej sesji
credential registry nie zwraca private key, PIN ani biometric data
provider secrets pozostaja write-time only
audit pozostaje hash-chained
CDR pozostaje mandatory
```

## Dlaczego Step 3.2

Step 3.1 ma juz techniczny mechanizm step-up, ale nie wymusza go jeszcze jako polityki na operacjach wysokiego ryzyka. To znaczy, ze system potrafi wykonac step-up, ale wrazliwe endpointy nadal nie maja centralnej bramki swiezosci.

Step 3.2 zamienia mechanizm w egzekwowana polityke.

## Step 3.2 Cel

```text
Wymusic step-up freshness na operacjach wrazliwych, obsluzyc step_up_required w Admin Web,
dodac audit/RBAC traceability i testy human-flow.
```

## Step 3.2 Zakres

```text
S3.2-A Sensitive Action Policy
S3.2-B API Step-up Enforcement
S3.2-C Admin Web Step-up UX
S3.2-D SDK Step-up Retry Helper
S3.2-E Audit And Monitoring Traceability
S3.2-F Negative And Human E2E Tests
```

## Operacje Chronione W Step 3.2

Minimalny zakres:

```text
POST /orchestrator/jobs
POST /providers
POST /providers/:id/secret-rotation
```

Zakres przygotowany jako future policy:

```text
future destructive infrastructure lifecycle
future jurisdiction high-risk rotation
future credential revocation
future break-glass request / approval
```

## Poza Zakresem Step 3.2

```text
produkcyjny hardware WebAuthn zamiast local simulator
produkcyjna polityka break-glass
realne tworzenie VPS u providerow
realny provider adapter Hetzner/OVH
realny queue worker runtime
```

## Definition Of Done Step 3.2

```text
centralny helper requireFreshStepUp istnieje
API zwraca step_up_required dla chronionych operacji bez swiezego step-up
step_up_required ma jawny error code, action, requiredFreshness i next endpoint
Admin Web pokazuje step-up modal przy chronionej akcji
po step-up UI ponawia akcje i dostaje sukces
audit zapisuje auth.step_up_required i auth.step_up_completed
testy sprawdzaja brak wycieku provider secret przy step_up_required
testy sprawdzaja, ze legacy token bez step-up nie przechodzi
npm.cmd test przechodzi
browser verification przechodzi dla execute job
```

