# SYLION Admin Panel V2 - Test Plan

## Test Philosophy

V2 musi być testowane jak system operacyjny panelu, nie tylko biblioteka domenowa.

Testy muszą objąć:

```text
unit
contract
API e2e
UI e2e
manual human QA
restart/persistence
secret leakage
RBAC negative paths
job retry/rollback
monitoring/audit integrity
```

## Full Human UI Flow

```text
1. Otwórz panel.
2. Zaloguj admina przez WebAuthn-compatible flow.
3. Utwórz tenant.
4. Utwórz operatora.
5. Dodaj provider w trybie mock.
6. Sprawdź, że sekret providera nie jest widoczny po zapisie.
7. Zarejestruj Pixel.
8. Zarejestruj Puli AX.
9. Dodaj Authorized App.
10. Zatwierdź Authorized App jako Global Super Admin.
11. Wykonaj CDR decision dla pliku.
12. Wygeneruj provisioning plan.
13. Uruchom orchestrator job.
14. Obserwuj job steps.
15. Sprawdź inventory 3 VPS.
16. Sprawdź cert references.
17. Sprawdź image artifacts.
18. Utwórz jurisdiction policy.
19. Utwórz Matrix add-on.
20. Wywołaj monitoring signal.
21. Utwórz incident z alertu.
22. Sprawdź audit stream.
23. Zrestartuj backend.
24. Sprawdź, że dane nadal istnieją.
```

## Secret Leakage Tests

Sprawdź, że żadne z poniższych nie pojawia się w UI/API/audycie/logach:

```text
provider plaintext token
operator private secrets
wallet seed phrase
password plaintext
private key material
communication content
file contents
```

## RBAC Negative Tests

```text
Support ReadOnly nie tworzy tenantów.
Tenant Admin nie dodaje Authorized Apps.
Billing Admin nie wykonuje provisioning job.
Auditor nie rotuje sekretów.
Incident Commander nie zmienia providerów.
Provisioning Admin nie eksportuje sensitive audit.
```

## Persistence Tests

```text
create full flow data
stop backend
start backend
verify tenant/operator/provider/devices/plan/job/audit still exist
verify audit hash-chain continuity
```

## Job Runtime Tests

```text
job accepted
job running
job completed
job failed
retry step
resume after restart
idempotency returns same job
rollback plan is present
destructive rollback steps require approval
```

## UI Quality Tests

```text
all screens have loading states
all screens have empty states
all forms validate required fields
dangerous actions require confirmation
errors are readable
text does not overflow at mobile width
dashboard data matches API data
```

## V2 Release Gate

```text
API tests pass
UI tests pass
manual human flow pass
persistence restart pass
secret leakage pass
RBAC negative pass
job runtime pass
no critical/high security findings
```

