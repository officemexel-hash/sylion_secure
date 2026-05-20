# SYLION Admin API

Pierwszy kodowy spine panelu administratora.

Zakres tej wersji:

```text
M16 Audit
M02 Authentication
M03 RBAC
M04 Tenant Management
M05 Operator Management
M06 Subscription & Entitlements
M07 Provisioning Plan Engine
```

To nie tworzy jeszcze prawdziwych VPS. Generuje bezpieczny, audytowalny plan provisioningowy zgodny z baseline:

```text
G1 VPS
G2 VPS
Workload VPS
Pixel / GrapheneOS profile
Puli AX router config
CDR mandatory
```

## Uruchomienie

```bash
node services/admin-api/src/server.js
```

## Testy

```bash
node --test services/admin-api/test/*.test.js
```

