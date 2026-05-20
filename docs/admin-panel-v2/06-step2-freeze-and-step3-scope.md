# SYLION Admin Panel V2 - Step 2 Freeze And Step 3 Scope

Data: 2026-05-20

## Freeze Step 2

Zamrazamy stan po `V2 Step 2 - Live Admin Shell`.

### Stan Techniczny

```text
commit: 946116a Implement V2 live admin shell
branch: main
remote: git@github.com-sylion-secure:officemexel-hash/sylion_secure.git
```

### Co Jest Gotowe

```text
Admin API dziala przez HTTP
SQLite persistence foundation istnieje
Admin Web jest serwowany przez Admin API pod /admin
Global Super Admin moze zalogowac sie do panelu
Panel tworzy tenantow, operatorow, providerow i devices
Panel generuje provisioning plan
Panel uruchamia orchestrator job
Panel pokazuje dashboard, audit, providers, devices, jobs
Demo flow dziala z przegladarki end-to-end
Provider secrets sa write-time only i UI pokazuje tylko secret reference
```

### Testy Zamrozenia

```text
npm.cmd test
25 tests
25 passing
0 failing
```

### Invarianty Zachowane

```text
kazdy operator ma baseline 3 VPS: G1, G2, WORKLOAD
brak wspoldzielenia G1/G2/WORKLOAD VPS miedzy operatorami
CDR pozostaje mandatory
provider secrets nie wracaja jako plaintext przez API/UI/audit
monitoring nie zawiera tresci komunikacji
audit events sa hash-chained
Puli AX pozostaje za gate kwalifikacyjnym do produkcji
```

## Dlaczego Step 3

Step 2 nadal uzywa dev uproszczenia:

```text
fido2Verified: true
```

To musi zostac zastapione realnym, testowalnym kontraktem WebAuthn/FIDO2, zanim panel bedzie rozbudowywany o bardziej wrazliwe operacje: rotacje sekretow, destructive actions, provisioning wysokiego ryzyka, jurisdiction rotation i four-eyes approvals.

## Step 3 Cel

```text
Zastapic dev flage fido2Verified kontrolowanym WebAuthn/FIDO2-compatible flow,
dodac enrollment, authentication challenge, step-up security, session policy,
lockout/recovery i pelny audit bez logowania sekretow.
```

## Step 3 Zakres

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

## Poza Zakresem Step 3

```text
produkcyjna integracja z HSM
produkcyjny lifecycle PKI poza obecnym certificate module
realne tworzenie VPS u providerow
realny build GrapheneOS / Puli AX firmware
destrukcyjne operacje na infrastrukturze produkcyjnej
PHANTOM lub inne funkcje spoza baseline
```

## Definition Of Done Step 3

```text
dev flaga fido2Verified nie jest publicznym login boundary
istnieje enrollment challenge dla admina
istnieje authentication challenge dla loginu
challenge ma TTL i replay protection
credential registry nie przechowuje prywatnych kluczy
sesja ma TTL i step-up freshness
wrazliwe akcje moga wymagac step-up
lockout/recovery sa jawnie opisane i audytowane
UI obsluguje enrollment/login/step-up states
testy API + UI przechodza
secret leakage tests przechodza
audit pokazuje decyzje, ale bez sekretow i bez materialu kryptograficznego
```
