# SYLION Admin Panel V2 - Step 3.2 Prompt Pack

## Prompt Bazowy Step 3.2

```text
Pracujesz nad SYLION Admin Panel V2 Step 3.2: Step-up Enforcement For Sensitive Admin Actions.

Aktualny stan jest zamrozony po Step 3.1:
- WebAuthn-compatible enrollment/login dziala.
- Challenge Store ma TTL, single-use i replay protection.
- Credential Registry nie przechowuje private key/PIN/biometric data.
- Istnieja endpointy /auth/step-up/options i /auth/step-up/verify.
- Admin Web loguje przez lokalny FIDO2 simulator.
- Testy: 30 passing.

Twoim zadaniem jest wymusic step-up freshness na operacjach wrazliwych i obsluzyc step_up_required w UI.

Nie lam invariantow:
- Provider secrets sa write-time only.
- Nie loguj plaintext sekretow, assertion signature, private key, PIN, biometric data ani tresci komunikacji.
- CDR pozostaje mandatory.
- Audit musi pokazac decyzje security.
- Side effect nie moze wykonac sie przed step-up.
- Break-glass production policy jest poza zakresem i wymaga HUMAN GATE.
```

## Prompt S3.2-A - Sensitive Action Policy

```text
Zaimplementuj centralna polityke sensitive actions.

Dodaj:
- action ids: orchestrator.plan.execute, provider.create_with_secret, provider.secret.rotate
- helper requireFreshStepUp(actor, action, context)
- step_up_required AppError z details: action, sessionId, stepUpValidUntil, requiredFreshness, stepUpEndpoint
- audit auth.step_up_required przy odmowie

Wymagania:
- brak sekretow w error details
- brak sekretow w audit
- test helpera dla valid/expired/missing step-up
```

## Prompt S3.2-B - API Step-up Enforcement

```text
Podepnij requireFreshStepUp do endpointow:
- POST /orchestrator/jobs
- POST /providers
- POST /providers/:id/secret-rotation

Wymagania:
- odmowa step_up_required przed wykonaniem side effect
- provider apiSecret nie pojawia sie w audit/error
- orchestrator idempotency pozostaje stabilne
- legacy token z /auth/login nie przechodzi bez step-up
- WebAuthn token ze swiezym step-up przechodzi

Dodaj testy API dla kazdego endpointu.
```

## Prompt S3.2-C - Admin Web Step-up UX

```text
Dodaj globalny step-up modal w apps/admin-web.

Wymagania:
- api() rozpoznaje error.code === step_up_required
- modal pokazuje nazwe akcji i prosty status
- modal wykonuje /auth/step-up/options i /auth/step-up/verify z lokalnym symulatorem
- po sukcesie ponawia pierwotna akcje raz
- jezeli ponowienie nie przejdzie, pokazuje blad bez petli
- UI nie pokazuje challenge technical material ani provider secret

Objete akcje:
- Save Provider
- Execute Plan
- Run Demo Flow
```

## Prompt S3.2-D - SDK Step-up Retry Helper

```text
Rozszerz AdminApiClient.

Dodaj:
- isStepUpRequired(error)
- createStepUpOptions()
- verifyStepUp(body)
- withStepUpRetry(operation, stepUpHandler)

Wymagania:
- SDK nie zna hasel
- SDK nie przechowuje credential secrets
- helper nie ukrywa innych bledow
- test jednostkowy lub integracyjny pokazuje retry chronionej akcji
```

## Prompt S3.2-E - Audit And Monitoring Traceability

```text
Zweryfikuj i popraw audit dla Step 3.2.

Wymagania:
- auth.step_up_required ma actorId, sessionId, action, correlationId
- auth.step_up_completed ma actorId, sessionId, credentialId, correlationId
- provider/orchestrator audit po sukcesie pozostaje bez sekretow
- step_up_required audit nie ma apiSecret ani assertion signature
- monitoring nie dostaje tresci komunikacji ani sekretow

Dodaj leakage assertions do testow.
```

## Prompt S3.2-F - Negative And Human E2E Tests

```text
Dodaj testy Step 3.2.

API negative:
- POST /orchestrator/jobs bez step-up -> step_up_required
- POST /providers bez step-up -> step_up_required
- POST /providers/:id/secret-rotation bez step-up -> step_up_required
- wrong-session step-up blocked
- expired step-up blocked
- no secret leakage in error/audit

Human/browser:
- enrollment/login
- create tenant/operator/devices/plan
- execute job -> step-up modal
- verify step-up
- retry job success
- audit contains auth.step_up_required and auth.step_up_completed
- visible secret leakage false
```

## Prompt Integracyjny Step 3.2

```text
Polacz wszystkie moduly Step 3.2.

Uruchom:
- npm.cmd test
- lokalny Admin API
- Admin Web pod /admin
- browser verification

Sprawdz:
- protected API returns step_up_required before side effects
- Admin Web modal performs step-up
- retry protected action succeeds once
- audit contains required security events
- no plaintext provider secret leakage
- no assertion signature leakage
- all tests pass

Na koniec zaktualizuj implementation log, status i freeze docs.
```

