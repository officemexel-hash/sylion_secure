# SYLION Admin Panel V2 - Step 3.2 Freeze And Step 3.3 Scope

Data: 2026-05-20

## Freeze Step 3.2

Zamrazamy stan po `V2 Step 3.2 - Step-up Enforcement For Sensitive Admin Actions`.

### Stan Techniczny

```text
commit: 07f38d4 Enforce step-up for sensitive admin actions
branch: main
remote: git@github.com-sylion-secure:officemexel-hash/sylion_secure.git
```

### Co Jest Gotowe

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

### Testy Zamrozenia

```text
npm.cmd test
33 tests
33 passing
0 failing
```

### Invarianty Zachowane

```text
side effect jest blokowany przed step-up dla provider secrets i orchestrator job
provider apiSecret nie pojawia sie w step_up_required error
provider apiSecret nie pojawia sie w audit przy odmowie
orchestrator idempotency pozostaje stabilne po retry
legacy token bez swiezego step-up jest blokowany dla operacji wrazliwych
CDR pozostaje mandatory
PHANTOM v3.0 nie jest mieszany z baseline SYLION
Ksiega 3.4 baseline pozostaje nadrzednym zrodlem dla normatywnych wymagan
```

## Dlaczego Step 3.3

Po Step 3.2 mamy wymuszanie step-up, ale nadal brakuje kontrolowanego modelu awaryjnego:

```text
co robimy po wielu nieudanych probach
jak blokujemy konto lub sesje
jak inicjujemy recovery bez plaintext fallback auth
jak opisujemy break-glass bez produkcyjnej eskalacji
jak audytujemy proces recovery i lockout
```

Step 3.3 tworzy model, endpointy i testy, ale nie uruchamia produkcyjnego break-glass. Produkcyjna polityka break-glass wymaga HUMAN GATE.

## Step 3.3 Cel

```text
Dodac recovery, lockout i break-glass placeholder model bez plaintext fallback auth,
bez automatycznej eskalacji uprawnien i bez przenoszenia PHANTOM v3.0 do baseline.
```

## Step 3.3 Zakres

```text
S3.3-A Lockout Policy
S3.3-B Recovery Request Model
S3.3-C Break-glass Placeholder Boundary
S3.3-D Admin Security UI States
S3.3-E Audit, RBAC And Human Gate Traceability
S3.3-F Threat Model And Abuse-case Tests
```

## Poza Zakresem Step 3.3

```text
produkcyjny break-glass approval
automatyczne odzyskiwanie dostepu
plaintext fallback password path
PHANTOM v3.0 operational behavior
lawful access automation
provider or VPS destructive operations
```

## Definition Of Done Step 3.3

```text
failed auth attempts sa liczone bez logowania hasel
lockout blokuje enrollment/login/step-up po przekroczeniu progu
recovery request tworzy audytowalny obiekt
break-glass placeholder wymaga HUMAN GATE i nie eskaluje uprawnien
RBAC ogranicza recovery/break-glass do Global Super Admin lub przyszlego Security Admin flow
UI pokazuje lockout/recovery states
testy potwierdzaja brak plaintext secrets i brak PHANTOM drift
docs wskazuja powiazanie z Ksiega 3.4 i PHANTOM v3.0 jako oddzielna sciezka
```

