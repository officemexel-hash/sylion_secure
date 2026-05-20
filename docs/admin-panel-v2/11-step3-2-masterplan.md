# SYLION Admin Panel V2 - Step 3.2 Masterplan

## Nazwa Etapu

```text
V2 Step 3.2 - Step-up Enforcement For Sensitive Admin Actions
```

## Strategia

Step 3.2 ma byc maly, twardy i testowalny. Nie budujemy jeszcze pelnego realnego WebAuthn ani break-glass. Egzekwujemy natomiast policy boundary:

```text
sensitive action -> require fresh step-up -> audit -> UI modal -> retry -> success
```

## Moduly Step 3.2

```text
S3.2-A Sensitive Action Policy
S3.2-B API Step-up Enforcement
S3.2-C Admin Web Step-up UX
S3.2-D SDK Step-up Retry Helper
S3.2-E Audit And Monitoring Traceability
S3.2-F Negative And Human E2E Tests
```

## S3.2-A Sensitive Action Policy

Cel:

```text
Zdefiniowac centralna polityke, ktore akcje wymagaja swiezego step-up.
```

Zakres:

```text
policy action ids
freshness window
error shape
helper requireFreshStepUp(actor, action)
testy jednostkowe helpera
```

Akcje:

```text
orchestrator.plan.execute
provider.create_with_secret
provider.secret.rotate
```

Acceptance criteria:

```text
brak duplikacji logiki po kontrolerach
policy nie zalezy od UI
policy nie loguje sekretow
policy daje deterministyczny error step_up_required
```

## S3.2-B API Step-up Enforcement

Cel:

```text
Podpiac polityke do endpointow wrazliwych.
```

Endpointy:

```text
POST /orchestrator/jobs
POST /providers
POST /providers/:id/secret-rotation
```

Wymagania:

```text
step_up_required przed wykonaniem side effect
idempotency zachowane dla orchestrator job
provider secret nie trafia do audit/error/log przy odmowie
legacy /auth/login token bez step-up nie przechodzi
WebAuthn login moze miec initial step-up freshness zgodnie z Step 3.1
```

## S3.2-C Admin Web Step-up UX

Cel:

```text
Dodac modal step-up do panelu admina.
```

Zakres:

```text
global step-up modal
wykrywanie error.code === step_up_required
create step-up options
verify local simulator assertion
retry ostatniej akcji
czytelny status sukces/blad
```

Akcje UI:

```text
Save Provider
Execute Plan
Run Demo Flow
future secret rotation
```

Acceptance criteria:

```text
uzytkownik widzi, ktora akcja wymaga step-up
UI nie pokazuje challenge materialu technicznego
UI nie trzyma provider secret w DOM dluzej niz formularz
po step-up akcja jest ponawiana raz, nie w petli
```

## S3.2-D SDK Step-up Retry Helper

Cel:

```text
Dodac do SDK helper, ktory rozpoznaje step_up_required i pozwala UI/API tests uzyc jednego wzorca.
```

Zakres:

```text
isStepUpRequired(error)
createStepUpOptions()
verifyStepUp()
optional withStepUpRetry callback helper
```

Nie robi:

```text
nie podejmuje decyzji policy
nie zna hasel
nie przechowuje credential secret
```

## S3.2-E Audit And Monitoring Traceability

Cel:

```text
Kazde zablokowanie i przejscie step-up musi byc widoczne w audit.
```

Audit events:

```text
auth.step_up_required
auth.step_up_completed
rbac.permission_check
provider.created
provider.secret_rotated
orchestrator.job.completed
```

Wymagania:

```text
audit event dla step_up_required zawiera action, sessionId, actorId, correlationId
audit event nie zawiera provider apiSecret
audit event nie zawiera assertion signature
monitoring nie dostaje tresci komunikacji ani sekretow
```

## S3.2-F Negative And Human E2E Tests

Cel:

```text
Potwierdzic, ze policy dziala nie tylko happy-path.
```

Testy API:

```text
legacy token bez step-up dostaje step_up_required na POST /orchestrator/jobs
legacy token bez step-up dostaje step_up_required na POST /providers
step-up challenge wrong session jest blokowany
po step-up chroniona akcja przechodzi
provider secret nie pojawia sie w step_up_required error ani audit
idempotency orchestrator pozostaje stabilne
```

Testy UI/browser:

```text
login
create tenant/operator/devices/plan
execute job -> modal step-up
verify step-up
job success
audit pokazuje auth.step_up_required i auth.step_up_completed
visible secret leakage false
```

## Kolejnosc Implementacji

```text
1. S3.2-A Sensitive Action Policy
2. S3.2-B API Step-up Enforcement
3. S3.2-F API negative tests
4. S3.2-D SDK helpers
5. S3.2-C Admin Web Step-up UX
6. S3.2-E audit review
7. S3.2-F browser/human verification
8. docs/status update
```

## Minimalny Pierwszy Commit

```text
requireFreshStepUp helper
step_up_required AppError shape
orchestrator/provider endpoint enforcement
API tests
docs update
```

## Minimalny Drugi Commit

```text
SDK helper
Admin Web modal
UI retry flow
browser verification
docs update
```

