# SYLION Admin Panel V2 - Masterplan

## Strategia

V2 dzielimy na moduły wdrożeniowe prefiksowane `V2-*`. Nie zastępują one domen V1, tylko utwardzają je do aplikacji operacyjnej.

## Workstreamy V2

```text
V2-A Frontend Live Admin Shell
V2-B Persistence Layer
V2-C Auth/WebAuthn Foundation
V2-D Provider Adapter Boundary
V2-E Job Queue and Orchestrator Runtime
V2-F Image/Artifact Pipeline Boundary
V2-G Observability Dashboard
V2-H API Contracts and SDK
V2-I Deployment and Dev Environment
V2-J Human E2E Test Harness
```

## V2-A Frontend Live Admin Shell

Cel:

```text
zamienić statyczny shell na interaktywny panel używający Admin API
```

Zakres:

```text
login screen
dashboard
tenants
operators
providers
devices
authorized apps
CDR
provisioning plans
orchestrator jobs
monitoring
incidents
audit
```

Wymagania:

```text
loading/error/empty/success states
formularze z walidacją
bezpieczeństwo decyzji po stronie API
brak sekretów w UI po wysłaniu
potwierdzenia dla akcji ryzykownych
```

## V2-B Persistence Layer

Cel:

```text
zastąpić in-memory store trwałym storage
```

Preferencja V2:

```text
SQLite for local/dev
repo-local migrations
adapter interface pod PostgreSQL w kolejnym kroku
```

Zakres:

```text
audit_events
admins/sessions
tenants
operators
providers
secret_references
devices
apps
cdr_decisions
infrastructure_sets
certificates
image_artifacts
jobs
monitoring_events
incidents
matrix_servers
jurisdiction_policies
```

## V2-C Auth/WebAuthn Foundation

Cel:

```text
usunąć dev flag fido2Verified i przygotować realny WebAuthn flow
```

Zakres:

```text
admin credentials
session store
WebAuthn registration challenge
WebAuthn authentication challenge
replay protection
session TTL
lockout
audit
```

W V2 może być lokalny WebAuthn simulator, ale kontrakt musi pasować do produkcyjnego WebAuthn.

## V2-D Provider Adapter Boundary

Cel:

```text
utrzymać mock provider, ale dodać prawdziwy adapter boundary
```

Zakres:

```text
ProviderAdapter interface
MockProviderAdapter
HetznerAdapter skeleton
OVHAdapter skeleton
capabilities
region discovery
quota discovery
dry-run create server
error mapping
idempotency
```

V2 nie musi tworzyć realnego VPS, ale adapter ma być gotowy do wpięcia.

## V2-E Job Queue And Orchestrator Runtime

Cel:

```text
zmienić synchroniczny Orchestrator w job runtime
```

Zakres:

```text
job queue table
job worker loop
step state
retry policy
rollback plan
idempotency
job logs bez sekretów
resume after restart
```

## V2-F Image/Artifact Pipeline Boundary

Cel:

```text
zdefiniować pipeline artefaktów bez udawania produkcyjnego builda
```

Zakres:

```text
artifact manifest
policy attachment
signature reference
build inputs validation
secret redaction
Pixel profile manifest
Puli AX config manifest
microVM template manifest
```

## V2-G Observability Dashboard

Cel:

```text
zrobić realne dashboardy z API
```

Zakres:

```text
system health
operator health
job status
CDR queue/failures
cert expiry
DNS leak/IPsec down simulated signals
incidents
audit stream
```

## V2-H API Contracts And SDK

Cel:

```text
zamienić openapi-lite.md w pełniejszy kontrakt i klienta frontendowego
```

Zakres:

```text
OpenAPI JSON/YAML
shared types
API client wrapper
error model
pagination/filtering conventions
correlation id middleware
idempotency middleware
```

## V2-I Deployment And Dev Environment

Cel:

```text
jedna komenda uruchamia backend, frontend i storage
```

Zakres:

```text
dev scripts
seed data
local config
.env.example
health checks
docs/run-local.md
```

## V2-J Human E2E Test Harness

Cel:

```text
testy nie tylko API, ale też przepływ panelu jak admin
```

Zakres:

```text
browser tests
manual QA checklist
API E2E
UI E2E
security negative tests
secret leakage checks
restart/persistence tests
```

## V2 Definition Of Done

```text
frontend działa z API
dane przeżywają restart
auth nie używa fido2Verified jako produkcyjnego wejścia
provider adaptery mają kontrakt
orchestrator działa jako job runtime
dashboardy pokazują realne dane z API
pełny UI human-flow przechodzi
sekrety nie pojawiają się w UI/API/logach/audycie
testy API i UI przechodzą
```

