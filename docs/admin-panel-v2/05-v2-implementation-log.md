# SYLION Admin Panel V2 - Implementation Log

## Step 1 - API SDK + SQLite Persistence Foundation

Status: implemented  
Data: 2026-05-20

### Zakres

Zaimplementowano pierwszy krok V2:

```text
API client / SDK foundation
SQLite persistence adapter
persistent maps dla domen
restart/persistence test
dev env hint przez .env.example
```

### Pliki

```text
services/admin-api/src/storage/sqliteStore.js
services/admin-api/src/storage/persistentMap.js
services/admin-api/src/sdk/adminApiClient.js
services/admin-api/test/persistence-sdk.v2.test.js
.env.example
```

### Persistence

Dodano `SqliteStore` oparty o `node:sqlite`.

V2 Step 1 używa prostego KV schema:

```text
collection
key
value_json
updated_at
```

To jest świadomy etap przejściowy. Pozwala utrwalić obecne domeny bez przepisywania logiki. W kolejnym kroku można migrować wybrane kolekcje do jawnych tabel.

### Objęte Domeny

Persistence podłączono do:

```text
audit
auth admins/sessions
tenants
operators
provisioning plans
providers
secrets
devices
apps
CDR decisions
CDR monitoring events
infrastructure sets
certificates
image artifacts
monitoring events
incidents
jurisdiction policies
matrix servers
orchestrator jobs
```

### SDK

Dodano `AdminApiClient`:

```text
login
createTenant
createOperator
createProvider
registerDevice
createProvisioningPlan
executeJob
listAuditEvents
generic request
```

### Test

Dodano test:

```text
persistence-sdk.v2.test.js
```

Test:

```text
startuje Admin API z SQLite
tworzy tenant/operator/provider/devices/plan/job
zamyka backend
uruchamia backend ponownie na tym samym DB
sprawdza tenant/operator/provider/devices/plan/job/audit
sprawdza brak plaintext provider secret
```

### Wynik

```text
npm.cmd test
24 tests
24 passing
0 failing
```

### Następny Krok

```text
V2-A Live Admin Shell with SDK
```

Równolegle można zacząć:

```text
V2-D Provider Adapter Boundary
V2-E Job Queue Runtime
```

