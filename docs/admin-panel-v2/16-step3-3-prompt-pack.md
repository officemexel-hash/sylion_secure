# SYLION Admin Panel V2 - Step 3.3 Prompt Pack

## Prompt Bazowy Step 3.3

```text
Pracujesz nad SYLION Admin Panel V2 Step 3.3: Recovery, Lockout And Break-glass Placeholder Model.

Aktualny stan jest zamrozony po Step 3.2:
- WebAuthn-compatible login/enrollment dziala.
- Step-up jest wymuszony na provider secrets i orchestrator job.
- Testy: 33 passing.

Twoim zadaniem jest dodac lockout, recovery request model i break-glass placeholder.

Nie lam invariantow:
- Nie dodawaj plaintext fallback auth.
- Nie dodawaj automatycznego unlock/privilege escalation.
- Nie obchodz FIDO2 ani step-up.
- Nie wykonuj produkcyjnego break-glass.
- Nie mieszaj PHANTOM v3.0 do baseline SYLION.
- Ksiega 3.4 jest nadrzednym baseline dla normatywnych wymagan.
- Wszystko musi byc audytowane bez sekretow, hasel, PIN, biometric data i assertion signatures.
```

## Prompt S3.3-A - Lockout Policy

```text
Zaimplementuj Lockout Policy w AuthService.

Dodaj:
- failed attempt counter per admin
- temporary lockout until timestamp
- lockout reason
- configurable thresholds in authOptions
- audit auth.lockout_started
- audit auth.lockout_released

Wymagania:
- lockout blokuje enrollment/login/step-up
- udany WebAuthn login lub recovery placeholder moze wyczyscic counter tylko jesli nie lamie policy
- error nie zawiera password/assertion/public key material
- testy: threshold, block, audit, no leakage
```

## Prompt S3.3-B - Recovery Request Model

```text
Dodaj recovery request model.

Endpointy:
- POST /auth/recovery/request
- GET /auth/recovery/requests
- POST /auth/recovery/requests/:id/status

Wymagania:
- status pending/rejected/approved_placeholder/closed
- reason code
- affected admin email/id
- requester actor/session/correlation id
- no auto unlock
- no role escalation
- audit auth.recovery_started i auth.recovery_status_changed
```

## Prompt S3.3-C - Break-glass Placeholder Boundary

```text
Dodaj break-glass placeholder boundary.

Endpointy:
- POST /auth/break-glass/requests
- GET /auth/break-glass/requests

Wymagania:
- status pending_human_gate
- approvalRequired true
- humanGateRequired true
- no side effects
- no bypass of FIDO2/step-up/RBAC
- audit auth.break_glass_requested i auth.break_glass_human_gate_required
- dokumentuj, ze produkcyjna semantyka wymaga HUMAN GATE
```

## Prompt S3.3-D - Admin Security UI States

```text
Rozbuduj Security view w apps/admin-web.

Dodaj:
- lockout status
- recovery request list
- break-glass placeholder request list
- visible HUMAN GATE label

Wymagania:
- brak przycisku produkcyjnego unlock
- brak PHANTOM baseline language
- brak sekretow w DOM
- recovery/break-glass UI pokazuje statusy i audit trail
```

## Prompt S3.3-E - Audit, RBAC And Human Gate Traceability

```text
Dodaj permissions i audit events dla Step 3.3.

Permissions:
- auth.recovery.request
- auth.recovery.read
- auth.recovery.manage_placeholder
- break_glass.request
- break_glass.read
- break_glass.manage_placeholder

Audit:
- auth.lockout_started
- auth.lockout_released
- auth.recovery_started
- auth.recovery_status_changed
- auth.break_glass_requested
- auth.break_glass_human_gate_required

Testy musza potwierdzac no-secret leakage i RBAC denial dla unsupported roles.
```

## Prompt S3.3-F - Threat Model And Abuse-case Tests

```text
Dodaj testy abuse-case:
- failed attempts trigger lockout
- lockout blocks login/step-up
- recovery request does not unlock account
- break-glass request has humanGateRequired true and no side effect
- unsupported role cannot manage recovery
- audit contains expected events
- audit/error do not contain password, apiSecret, assertion signature, public key, biometric/PIN data
- PHANTOM v3.0 is referenced only as separated/non-baseline boundary in docs

Wynik koncowy: PASS / PASS WITH ISSUES / FAIL.
```

## Prompt Integracyjny Step 3.3

```text
Polacz wszystkie moduly Step 3.3.

Uruchom:
- npm.cmd test
- lokalny Admin API
- Admin Web pod /admin
- browser verification

Sprawdz:
- lockout po wielu blednych probach
- recovery request creation
- break-glass placeholder creation
- HUMAN GATE label and no side effects
- no plaintext leakage
- no PHANTOM drift into baseline
- all tests pass

Na koniec zaktualizuj implementation log, status i freeze docs.
```

