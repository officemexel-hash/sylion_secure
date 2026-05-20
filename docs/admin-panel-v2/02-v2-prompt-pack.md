# SYLION Admin Panel V2 - Prompt Pack

## Prompt Bazowy V2

```text
Pracujesz nad SYLION Admin Panel V2. V1 ma działający in-memory Admin API i statyczny shell. V2 ma przekształcić to w aplikację operacyjną: live frontend, persistent storage, realniejsze auth/WebAuthn boundaries, provider adapter boundaries, job runtime, image pipeline manifests, dashboardy i pełne testy UI/API.

Nie łam invariantów:
- Każdy operator ma własne 3 VPS: G1, G2, Workload VPS.
- Brak współdzielenia G1/G2/Workload VPS między operatorami.
- CDR jest mandatory.
- Panel nie zna prywatnych sekretów operatora.
- Provider secrets są write-time only.
- Monitoring nie loguje treści komunikacji.
- Wszystkie operacje wrażliwe emitują audit events.
- Operacje tworzące zasoby mają idempotency.
- Destrukcyjne akcje mają approval/four-eyes.
```

## V2-A Frontend Live Admin Shell

```text
Rozbuduj apps/admin-web z statycznego shell do interaktywnego panelu połączonego z Admin API. Zakres: login, dashboard, tenants, operators, providers, devices, authorized apps, CDR, provisioning plans, orchestrator jobs, monitoring, incidents, audit. Użyj API client wrapper, loading/error/empty/success states, formularzy z walidacją i bez przechowywania sekretów po wysłaniu. Nie implementuj decyzji bezpieczeństwa w UI.
```

## V2-B Persistence Layer

```text
Dodaj warstwę persistent storage dla Admin API. Preferuj SQLite jako local/dev backend z adapter interface pod PostgreSQL. Zastąp in-memory Map w modułach repozytoriami. Dodaj migracje, seed data, test restart/persistence. Nie zmieniaj domenowych invariantów. Audit hash-chain musi zachować kolejność i integralność po restarcie.
```

## V2-C Auth/WebAuthn Foundation

```text
Usuń produkcyjną zależność od dev flag fido2Verified. Dodaj WebAuthn-compatible flow: registration challenge, authentication challenge, challenge store, replay protection, session TTL, lockout i audit. W V2 może istnieć local simulator do testów, ale kontrakt API musi być kompatybilny z realnym WebAuthn.
```

## V2-D Provider Adapter Boundary

```text
Dodaj ProviderAdapter interface oraz MockProviderAdapter, HetznerAdapter skeleton i OVHAdapter skeleton. Adapter ma obsługiwać capabilities, regions, quota, dry-run create server, error mapping i idempotency. V2 nie musi tworzyć prawdziwych VPS, ale Orchestrator ma używać adapter boundary zamiast bezpośredniego mockowania.
```

## V2-E Job Queue And Orchestrator Runtime

```text
Zmień Orchestrator z synchronicznego executePlan na job runtime z kolejką. Dodaj job table/store, worker loop, step states, retry policy, rollback plan, resume after restart, content-free job logs i idempotency. API ma zwracać job accepted/running/completed/failed oraz endpoint do podglądu stepów.
```

## V2-F Image/Artifact Pipeline Boundary

```text
Rozbuduj Image Factory do pipeline manifestów. Dodaj manifesty dla Pixel GrapheneOS profile, Puli AX router config i microVM templates. Każdy artifact ma mieć build inputs, policy attachment, digest, signatureRef, provenanceRef i secret-redaction checks. Nie buduj realnego firmware, ale przygotuj kontrakt pod builder.
```

## V2-G Observability Dashboard

```text
Zbuduj dashboardy operacyjne live API: system health, operator health, job status, cert expiry, CDR queue/failures, IPsec down, DNS leak, microVM crash loop, incidents i audit stream. Monitoring nie może zawierać treści komunikacji. UI ma umożliwiać filtrowanie po tenant/operator/severity/status.
```

## V2-H API Contracts And SDK

```text
Zamień openapi-lite.md w pełny OpenAPI YAML/JSON. Dodaj shared API client dla frontendu, error model, pagination/filtering conventions, correlation id middleware i idempotency middleware. Dodaj contract tests, które wykrywają rozjazd API z dokumentacją.
```

## V2-I Deployment And Dev Environment

```text
Dodaj lokalne uruchomienie całego systemu jedną ścieżką. Przygotuj .env.example, dev scripts, seed data, docs/run-local.md, health checks i instrukcję resetu lokalnego środowiska. Nie wymagaj prawdziwych provider credentials do trybu dev.
```

## V2-J Human E2E Test Harness

```text
Dodaj pełny test harness V2: API E2E, UI E2E, browser/manual checklist, restart/persistence test, secret leakage checks, RBAC negative tests i full admin journey. Test ma przejść jak człowiek: login -> create tenant -> create operator -> provider -> devices -> app -> CDR -> plan -> execute job -> monitor -> incident -> audit.
```

## Prompt Integracyjny V2

```text
Połącz wszystkie workstreamy V2. Uruchom backend, frontend i storage. Wykonaj pełny przepływ admina przez UI i potwierdź, że dane są widoczne w API, zapisują się w storage i przeżywają restart. Zweryfikuj brak plaintext sekretów w UI/API/audycie/logach. Uruchom API tests, UI tests i manual checklist. Wynik: PASS / PASS WITH ISSUES / FAIL.
```

