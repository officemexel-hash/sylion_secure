# SYLION Admin Panel V2 - Step 3.3 Masterplan

## Nazwa Etapu

```text
V2 Step 3.3 - Recovery, Lockout And Break-glass Placeholder Model
```

## Decyzja Architektoniczna

```text
Decision: ACCEPT AS BASELINE PLACEHOLDER
Human gate: REQUIRED for production break-glass policy
Baseline impact: adds defensive admin access resilience controls
PHANTOM impact: none; PHANTOM v3.0 remains separate and is not implemented in baseline
Ksiega 3.4 impact: Step 3.3 must be referenced as admin security control, not autonomous access bypass
```

## Strategia

Step 3.3 nie jest obejściem FIDO2. To jest defensywny model awaryjny:

```text
detect repeated auth failure
lock account/session boundary
create recovery request
record audit evidence
prepare break-glass placeholder
require human approval before any production semantics
```

## Moduly Step 3.3

```text
S3.3-A Lockout Policy
S3.3-B Recovery Request Model
S3.3-C Break-glass Placeholder Boundary
S3.3-D Admin Security UI States
S3.3-E Audit, RBAC And Human Gate Traceability
S3.3-F Threat Model And Abuse-case Tests
```

## S3.3-A Lockout Policy

Cel:

```text
Wprowadzic kontrolowany lockout po wielu nieudanych probach auth.
```

Zakres:

```text
failed attempt counter per admin
failed attempt counter per session where relevant
temporary lockout until timestamp
lockout reason
reset on successful WebAuthn login/step-up
audit auth.lockout_started
audit auth.lockout_released
```

Acceptance criteria:

```text
hasla i assertion signatures nie sa logowane
lockout blokuje enrollment/login/step-up
lockout nie blokuje read-only audit inspection dla juz uprawnionego Global Super Admin
progi sa konfigurowalne w authOptions
```

## S3.3-B Recovery Request Model

Cel:

```text
Dodac audytowalny obiekt recovery bez automatycznego przywrocenia dostepu.
```

Zakres:

```text
POST /auth/recovery/request
GET /auth/recovery/requests
recovery request status: pending/rejected/approved_placeholder/closed
reason code
affected admin id/email
requester context
createdAt/updatedAt
audit auth.recovery_started
audit auth.recovery_status_changed
```

Zakazy:

```text
brak resetu hasla
brak obejscia FIDO2
brak automatycznej eskalacji roli
brak PHANTOM v3.0 behavior
```

## S3.3-C Break-glass Placeholder Boundary

Cel:

```text
Przygotowac jawny placeholder pod break-glass bez produkcyjnego wykonania.
```

Zakres:

```text
POST /auth/break-glass/requests
GET /auth/break-glass/requests
request object with action scope
approvalRequired: true
humanGateRequired: true
status: pending_human_gate
audit auth.break_glass_requested
```

HUMAN GATE:

```text
Production break-glass semantics require explicit human decision.
Step 3.3 cannot grant access, bypass FIDO2, bypass G1/G2, or perform destructive action.
```

## S3.3-D Admin Security UI States

Cel:

```text
Pokazac administratorowi stan lockout/recovery/break-glass bez tworzenia niebezpiecznych przyciskow.
```

Widoki:

```text
Security view: lockout status
Recovery request list
Break-glass placeholder request list
Audit filter for auth.* events
```

Wymagania:

```text
zero plaintext secrets in DOM
no production unlock button
clear HUMAN GATE label for break-glass
no PHANTOM baseline language
```

## S3.3-E Audit, RBAC And Human Gate Traceability

Cel:

```text
Kazdy lockout/recovery/break-glass event ma byc widoczny i ograniczony RBAC.
```

Permissions:

```text
auth.recovery.request
auth.recovery.read
auth.recovery.manage_placeholder
break_glass.request
break_glass.read
break_glass.manage_placeholder
```

Audit events:

```text
auth.lockout_started
auth.lockout_released
auth.recovery_started
auth.recovery_status_changed
auth.break_glass_requested
auth.break_glass_human_gate_required
```

## S3.3-F Threat Model And Abuse-case Tests

Cel:

```text
Potwierdzic, ze recovery nie staje sie obejściem auth.
```

Abuse cases:

```text
attacker triggers lockout denial-of-service
insider requests recovery for another admin
break-glass request tries to execute action
recovery request leaks email/password/credential material
PHANTOM v3.0 terminology is accidentally promoted to baseline
```

Required tests:

```text
failed attempts trigger lockout
lockout blocks login/step-up
recovery request does not unlock account
break-glass request has humanGateRequired true and no side effect
RBAC denies unsupported roles
audit has events and no secrets
```

## Kolejnosc Implementacji

```text
1. S3.3-A Lockout Policy
2. S3.3-E RBAC permissions and audit event names
3. S3.3-B Recovery Request Model
4. S3.3-C Break-glass Placeholder Boundary
5. S3.3-F API negative tests
6. S3.3-D Admin Security UI states
7. S3.3-F browser/manual verification
8. docs/status update
```

