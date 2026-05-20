# SYLION Admin Panel V2 - Step 3 Prompt Pack

## Prompt Bazowy Step 3

```text
Pracujesz nad SYLION Admin Panel V2 Step 3: WebAuthn/FIDO2 and Step-up Security.

Aktualny stan jest zamrozony po Step 2:
- Admin API dziala.
- SQLite persistence foundation dziala.
- Admin Web jest live pod /admin.
- Demo flow tworzy tenant/operator/provider/devices/plan/job.
- Testy: 25 passing.

Twoim zadaniem jest zastapic dev flage fido2Verified realnym WebAuthn-compatible flow i step-up security.

Nie lam invariantow:
- Kazdy operator ma wlasne 3 VPS: G1, G2, WORKLOAD.
- Brak wspoldzielenia G1/G2/WORKLOAD VPS.
- CDR jest mandatory.
- Provider secrets sa write-time only.
- Nie loguj plaintext sekretow, materialu kluczy prywatnych, PIN, biometric data ani tresci komunikacji.
- Wszystkie decyzje auth/security musza miec audit.
- Destrukcyjne lub wysokiego ryzyka operacje wymagaja jawnej polityki i/lub step-up.
- Break-glass w produkcji wymaga HUMAN GATE.
```

## Prompt S3-A - Auth API Contract

```text
Zaprojektuj i zaimplementuj kontrakt API dla WebAuthn-compatible enrollment, login i step-up.

Dodaj endpointy:
- POST /auth/webauthn/enrollment/options
- POST /auth/webauthn/enrollment/verify
- POST /auth/webauthn/login/options
- POST /auth/webauthn/login/verify
- POST /auth/step-up/options
- POST /auth/step-up/verify
- GET /auth/session
- POST /auth/logout

Wymagania:
- wspolny error model
- x-correlation-id
- compatibility z browser WebAuthn shapes
- local simulator boundary tylko dla dev/test
- zero plaintext secret leakage
- audit names z dokumentu Step 3

Dodaj test kontraktu API.
```

## Prompt S3-B - Challenge Store

```text
Zaimplementuj Challenge Store dla enrollment/login/step-up.

Wymagania:
- challenge id
- purpose
- actor/admin binding
- TTL
- single-use
- replay protection
- attempt counter
- persistence przez obecny store
- audit dla issued/verified/expired/replayed/failed

Dodaj testy:
- poprawna weryfikacja zuzywa challenge
- replay jest blokowany
- expired challenge jest blokowany
- challenge przypisany do innego aktora jest blokowany
```

## Prompt S3-C - Credential Registry

```text
Zaimplementuj Credential Registry dla admin WebAuthn credentials.

Wymagania:
- credential id
- admin id
- public key / public material zgodny z WebAuthn modelem
- transports
- attestation placeholder
- sign counter
- created_at
- last_used_at
- status active/revoked/replaced
- persistence przez store

Zakazy:
- brak private key
- brak raw biometric data
- brak PIN/password
- brak sensitive material w audit

Dodaj testy enroll/revoke/list/update sign counter.
```

## Prompt S3-D - Session And Step-up Policy

```text
Dodaj session policy i step-up freshness.

Wymagania:
- session TTL
- idle timeout
- last_fido2_at
- step_up_valid_until
- GET /auth/session
- POST /auth/logout
- policy helper requireStepUp(actor, action)
- step-up wymagany dla orchestrator execute job i provider secret rotation

Dodaj testy:
- sesja wygasa po TTL
- step-up jest wymagany dla akcji wrazliwej
- step-up odswieza freshness
- akcja po step-up przechodzi
```

## Prompt S3-E - Admin Security UI

```text
Rozbuduj apps/admin-web o security flows.

Widoki/stany:
- Enrollment panel
- Login challenge
- Session status
- Credential list
- Step-up modal
- Recovery/lockout status
- Security audit events

Wymagania:
- UI korzysta z nowych endpointow auth
- UI nie pokazuje materialu kryptograficznego
- UI nie trzyma sekretow w DOM po operacji
- orchestrator execute job otwiera step-up modal jesli API zwroci step_up_required
- loading/error/success states

Zweryfikuj przez browser test.
```

## Prompt S3-F - Audit And RBAC Integration

```text
Zintegruj WebAuthn/FIDO2 flow z audit i RBAC.

Dodaj permissions:
- credential.manage
- credential.read
- session.read
- auth.recovery.manage
- break_glass.request
- break_glass.approve

Dodaj audit events:
- auth.challenge_issued
- auth.challenge_verified
- auth.challenge_failed
- auth.challenge_replayed
- auth.credential_enrolled
- auth.credential_revoked
- auth.session_created
- auth.session_expired
- auth.step_up_required
- auth.step_up_completed
- auth.lockout_started
- auth.recovery_started
- auth.break_glass_requested

Testy musza potwierdzac, ze audit nie zawiera sekretow ani prywatnego materialu.
```

## Prompt S3-G - Recovery, Lockout And Break-glass

```text
Dodaj recovery/lockout model bez plaintext fallback auth.

Zakres:
- failed attempts threshold
- temporary lockout
- recovery request object
- two-person approval placeholder
- break-glass request event
- mandatory audit
- no automatic privilege escalation

HUMAN GATE:
- Nie implementuj produkcyjnego break-glass bez decyzji czlowieka.
- Dodaj tylko model, endpoint placeholder i testy blokad.
```

## Prompt S3-H - Human Security Test Harness

```text
Dodaj pelny test harness dla Step 3.

Scenariusz pozytywny:
1. admin rozpoczyna enrollment
2. simulator/browser WebAuthn weryfikuje credential
3. admin loguje sie przez challenge
4. admin widzi session status
5. admin tworzy tenant/operator/provider/device/plan
6. execute job wymaga step-up
7. admin robi step-up
8. job przechodzi
9. audit pokazuje security events

Scenariusze negatywne:
- replay challenge
- expired challenge
- wrong actor challenge
- revoked credential
- step-up missing
- session expired
- secret leakage in UI/API/audit/logs

Wynik koncowy: PASS / PASS WITH ISSUES / FAIL.
```

## Prompt Integracyjny Step 3

```text
Polacz wszystkie moduly Step 3.

Uruchom:
- npm.cmd test
- lokalny Admin API
- Admin Web pod /admin
- browser verification

Sprawdz:
- enrollment
- login
- session status
- step-up required
- step-up completed
- orchestrator job po step-up
- audit security events
- brak plaintext secret leakage
- challenge replay blocked
- expired challenge blocked

Na koniec zaktualizuj implementation log i status.
```

