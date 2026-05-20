# SYLION Admin Panel V1 - Module Prompt Pack

## Prompt Bazowy

```text
Budujesz moduł systemu SYLION Admin Panel V1. System zarządza operatorami, tenantami, providerami, provisioningiem 3 VPS per operator, routerem Puli AX, Pixel/GrapheneOS, Firecracker microVM, Matrix, CDR, monitoringiem, audytem, subskrypcjami i politykami jurysdykcyjnymi.

Wymagania wspólne:
- Każdy operator ma własne 3 VPS: G1, G2, Workload VPS.
- Brak współdzielenia G1/G2/Workload VPS między operatorami.
- Każda aplikacja operatora działa jako osobne środowisko/microVM.
- CDR jest obowiązkowy dla file ingress/egress.
- Panel nie może znać prywatnych sekretów operatora, np. seed phrase, haseł walleta, haseł komunikatorów.
- Wszystkie akcje wrażliwe emitują audit event z correlation_id.
- Operacje tworzące zasoby muszą obsługiwać idempotency_key.
- Nie loguj treści komunikacji.
- Sprawdzaj RBAC/permissions przed akcjami.
- Sekrety przechowuj tylko przez Secret Manager reference, nigdy plaintext w UI/logach.
- Przygotuj API contract, event contract, modele danych, walidacje, testy jednostkowe i testy kontraktowe.
- Moduł ma być budowalny niezależnie i integrowalny przez API/eventy.
```

## Prompty Modułów

### M01 Admin Shell / Frontend

```text
Zbuduj frontendowy shell panelu admina SYLION. Ma zawierać nawigację: Dashboard, Tenants, Operators, Subscriptions, Authorized Apps, Operator Workloads, Matrix Servers, Provisioning, Devices, Infrastructure, Jurisdiction Policies, CDR, Monitoring, Audit Log, Incidents, Access & Security, System Settings. Użyj mock API contracts, nie implementuj logiki bezpieczeństwa w UI, tylko wywołuj backend i pokazuj stany: healthy, degraded, provisioning, blocked, action required, incident, suspended.
```

### M02 Authentication

```text
Zbuduj moduł logowania adminów: login, FIDO2/WebAuthn, sesje, TTL sesji, lockout, password policy i auth anomaly events. Moduł musi emitować audit events dla login/logout/failed login/FIDO2 failure/session expired. Udostępnij API current_admin, session_context i validate_session.
```

### M03 RBAC / Permissions

```text
Zbuduj moduł RBAC. Obsłuż role: Global Super Admin, Security Admin, Provisioning Admin, Tenant Admin, Billing Admin, Auditor, Incident Commander, Support ReadOnly. Udostępnij can(actor, action, resource), four-eyes approval checks oraz polityki dla akcji destrukcyjnych: operator.revoke, device.wipe, vps.destroy, full jurisdiction rotation, cert rotation, sensitive audit export.
```

### M04 Tenant Management

```text
Zbuduj moduł tenantów. Obsłuż create/edit/suspend tenant, przypisanie subskrypcji, tenant policies, tenant status i izolację tenant_id. Każda zmiana ma sprawdzać RBAC, entitlements i emitować audit event.
```

### M05 Operator Management

```text
Zbuduj moduł operatorów. Obsłuż create/edit operator profile, assign tenant, assign tier, assign devices, statusy: draft, pending_approval, provisioning, awaiting_enrollment, active, degraded, suspended, revoked. Operator musi mieć docelowo własne G1/G2/Workload VPS, Pixel, Puli AX i workload limits wynikające z tieru.
```

### M06 Subscription & Entitlements

```text
Zbuduj moduł subskrypcji i limitów. Tiery: STANDARD, PRO, SOVEREIGN. Kontroluj max workload environments: Standard 3, Pro 10, Sovereign 30; Matrix jako paid add-on; jurisdiction rotation zakres zależny od tieru; CDR zawsze mandatory. Udostępnij check_entitlement(operator, feature), tier_limits i subscription_state.
```

### M07 Provisioning Plan Engine

```text
Zbuduj moduł generowania planu provisioningowego. Moduł nie tworzy zasobów, tylko planuje: 3 VPS per operator, Pixel profile, Puli AX config, certyfikaty, workloady, CDR policy, monitoring. Plan ma zawierać koszt, ryzyko, required approvals, brakujące provider credentials i human gate flags.
```

### M08 Provider Registry

```text
Zbuduj moduł providerów: Hetzner, OVH i rozszerzalny adapter dla kolejnych. Obsłuż provider account metadata, test connection, regions, quota, billing health, API secret reference i secret rotation przez Secret Manager. Nie zwracaj plaintext sekretów.
```

### M09 Infrastructure Inventory

```text
Zbuduj inventory infrastruktury. Śledź G1 VPS, G2 VPS, Workload VPS, IP, provider, region, image version, cert reference, owner operator_id, lifecycle state i drift. Wymuś regułę: jeden infrastructure set należy tylko do jednego operatora.
```

### M10 Device Inventory

```text
Zbuduj moduł urządzeń. Obsłuż Pixel/GrapheneOS, Puli AX router i FIDO2 keys. Śledź serial, assigned operator, firmware/config version, posture, certificate serial, last seen, compliance status i router qualification status.
```

### M11 Authorized App Catalog

```text
Zbuduj globalny katalog autoryzowanych aplikacji. Tylko Global Super Admin może dodawać, zatwierdzać, blokować i zmieniać aplikacje. Pola: app name, type, risk class, allowed tiers, default microVM resources, network policy, storage policy, clipboard policy, CDR required, template image, operator responsibility notice, status.
```

### M12 CDR Service

```text
Zbuduj moduł CDR. Zasada: No file ingress/egress without CDR decision. Obsłuż scan, disarm/reconstruct, block, quarantine, CDR evidence, per-app/per-tenant policies, queue, failures i audit. Domyślnie blokuj unknown/unsupported file types albo kieruj do quarantine.
```

### M13 Jurisdiction Policy Engine

```text
Zbuduj moduł polityk jurysdykcyjnych. Obsłuż allowed/blocked providers, countries, regions, rotation frequency, cooldown, approval requirements i rotation scope: session, IP route, microVM, Workload VPS, G1, G2, all 3 VPS, provider, region, certificates. Funkcja ma być opisana jako lawful region/provider control, nie stealth.
```

### M14 PKI / Certificate Lifecycle

```text
Zbuduj moduł PKI. Obsłuż issue, rotate, revoke, certificate status, serial tracking, certyfikaty routera, G1, G2, Workload VPS, IPsec i service identity. Klucze prywatne muszą być poza modułem, przez Secret Manager/HSM reference.
```

### M15 Monitoring & Anomaly Detection

```text
Zbuduj monitoring bez treści komunikacji. Monitoruj G1, G2, Workload VPS, microVMs, router Puli AX, Pixel posture, IPsec, DNS leak, CDR failures, FIDO2 failures, provider drift, cost anomalies i cert expiration. Emituj health_status, alert i anomaly_event.
```

### M16 Audit / WORM / Hash-chain

```text
Zbuduj moduł audytu jako fundament systemu. Obsłuż record audit event, hash-chain, WORM-ready export, audit search i evidence package. Event ma zawierać actor, action, resource, timestamp, correlation_id, previous value, new value, policy decision, result.
```

### M17 Incident & Runbook Manager

```text
Zbuduj moduł incydentów. Obsłuż create incident, severity, affected resources, timeline, owner, runbook checklist, actions: suspend, revoke, isolate, rotate certs, rebuild. Każda akcja musi iść przez RBAC/four-eyes, jeśli destrukcyjna.
```

### M18 Secret Manager Adapter

```text
Zbuduj adapter sekretów. Wspieraj backendy: Vault, Cloud KMS, HSM, BYO-HSM jako abstrakcję. Moduł zwraca wyłącznie secret_reference, signing_operation i rotation_event, nigdy plaintext do UI/logów.
```

### M19 Image Factory

```text
Zbuduj moduł Image Factory. Obsłuż Pixel/GrapheneOS profile, Puli AX router config, workload image i microVM template. Każdy artifact ma mieć version, signature, policy attachment, certificate reference i audit trail.
```

### M20 Orchestrator / Job Runner

```text
Zbuduj wykonawcę planów provisioningowych. Orchestrator przyjmuje zatwierdzony plan z M07 i wykonuje job steps: create 3 VPS, configure G1, configure G2, configure Workload VPS, issue certs, build/apply images, create microVMs, attach CDR, enable monitoring. Obsłuż retries, rollback_plan, idempotency_key i job status.
```

### M21 Matrix Server Manager

```text
Zbuduj moduł Matrix jako paid add-on. Obsłuż shared Matrix, dedicated tenant Matrix i dedicated operator Matrix. Pola: owner, provider, region, federation policy, retention policy, backup policy, cert status, health, cost estimate. Sprawdzaj entitlements przed utworzeniem.
```

## Prompty Integracyjne

### I01 Integration Spine

```text
Połącz M16 Audit, M02 Auth, M03 RBAC, M04 Tenants, M05 Operators i M06 Entitlements w działający spine. Scenariusz: admin loguje się, system sprawdza permissions, tworzy tenant, tworzy operatora, przypisuje tier, zapisuje audit events. Dodaj testy kontraktowe i end-to-end dla tego przepływu.
```

### I02 Provisioning Planning

```text
Połącz M07 Provisioning Plan Engine z M04, M05, M06, M08, M09, M10, M11, M13 i M16. Scenariusz: admin generuje plan dla operatora, system sprawdza tier, providerów, regiony, urządzenia, aplikacje, jurisdiction policy, koszt i required approvals. Plan nie tworzy zasobów.
```

### I03 Provisioning Execution

```text
Połącz M20 Orchestrator z M07, M08, M09, M14, M18, M19, M12, M15 i M16. Scenariusz: zatwierdzony plan tworzy 3 VPS per operator, certyfikaty, konfiguracje Pixel/Puli AX, workload templates, CDR policies i monitoring. Zweryfikuj idempotency, rollback i audit.
```

### I04 Workload Integration

```text
Połącz M11 Authorized App Catalog, M12 CDR, M19 Image Factory, M20 Orchestrator, M09 Inventory i M06 Entitlements. Scenariusz: operator tworzy kilka środowisk aplikacji z katalogu, system sprawdza limity tieru, tworzy microVM per środowisko i wymusza CDR dla plików.
```

### I05 Jurisdiction Rotation

```text
Połącz M13 Jurisdiction Policy Engine z M06, M08, M09, M14, M20, M15 i M16. Scenariusz: admin/operator uruchamia rotację zgodną z tierem: region, provider, VPS, certyfikaty albo cały zestaw 3 VPS. Sprawdź approvals, cooldown, audit, rollback i brak wpływu na innych operatorów.
```

### I06 Matrix Add-on

```text
Połącz M21 Matrix Server Manager z M04, M05, M06, M08, M09, M14, M15, M16 i M20. Scenariusz: tenant lub operator kupuje add-on Matrix, system sprawdza entitlement, tworzy serwer Matrix, certyfikaty, monitoring, inventory i audit.
```

### I07 Admin Frontend Integration

```text
Połącz M01 Admin Shell z backendami M02-M21. Zbuduj kompletne widoki dla Dashboard, Tenants, Operators, Subscriptions, Authorized Apps, Workloads, Matrix, Provisioning, Devices, Infrastructure, Jurisdiction, CDR, Monitoring, Audit, Incidents, Access & Security. UI ma pokazywać loading/error/empty/success states i nie może zawierać logiki bezpieczeństwa poza prezentacją decyzji backendu.
```

## Prompt Testowy Końcowy

```text
Przetestuj SYLION Admin Panel V1 jak człowiek, pełnym scenariuszem end-to-end, nie tylko unit testami.

Wykonaj testy:
1. Admin login: poprawne hasło, błędne hasło, FIDO2 success, FIDO2 failure, lockout, session TTL.
2. RBAC: każda rola próbuje akcji dozwolonych i zakazanych; sprawdź four-eyes dla akcji destrukcyjnych.
3. Tenant: utwórz, edytuj, zawieś, przypisz subskrypcję.
4. Operator: utwórz operatora, przypisz tier, sprawdź statusy od draft do active.
5. Entitlements: Standard ma limit 3 workloadów, Pro 10, Sovereign 30; przekroczenie limitu ma być blokowane.
6. Authorized Apps: tylko Global Super Admin może dodać i zatwierdzić aplikację.
7. Workloads: utwórz wiele środowisk, np. 2x WhatsApp, 2x Signal, 1x Telegram; każde ma osobną microVM.
8. CDR: przetestuj upload/download plików do/z microVM; plik nie może przejść bez decyzji CDR; unknown file idzie do block/quarantine.
9. Provisioning plan: wygeneruj plan dla operatora; sprawdź 3 VPS, Pixel, Puli AX, certyfikaty, workloady, CDR, monitoring, koszt, approvals.
10. Orchestrator: wykonaj zatwierdzony plan; sprawdź idempotency_key, retry, rollback i inventory.
11. Isolation: upewnij się, że Operator A nie widzi i nie używa G1/G2/Workload VPS Operatora B.
12. PKI: issue/rotate/revoke cert; sprawdź audit i wpływ na router/G1/G2.
13. Jurisdiction: przetestuj rotację zgodną z tierem i próbę rotacji ponad tier; sprawdź cooldown i approvals.
14. Matrix add-on: utwórz shared/dedicated Matrix tylko, gdy entitlement/add-on jest aktywny.
15. Monitoring: zasymuluj IPsec down, DNS leak, microVM crash loop, cert expiry, CDR failure, provider drift.
16. Incidents: alert tworzy incydent, runbook ma kroki, akcje destrukcyjne wymagają approval.
17. Audit: każda akcja wrażliwa ma audit event z actor, action, resource, timestamp, correlation_id, previous/new value, decision, result.
18. Secrets: sprawdź, że UI/logi/API nie pokazują plaintext sekretów, seed phrase, haseł walleta ani tokenów providera.
19. Frontend human test: przejdź panel jak realny admin; sprawdź czy formularze mają walidacje, błędy są zrozumiałe, stany loading/error/success działają, a niebezpieczne akcje są wyraźnie potwierdzane.
20. Regression: uruchom unit, contract, integration i e2e tests; wygeneruj raport: passed/failed, security findings, UX findings, blocking issues.

Wynik testów ma zawierać:
- listę scenariuszy wykonanych ręcznie
- listę testów automatycznych
- znalezione błędy z priorytetem
- ryzyka bezpieczeństwa
- decyzję: PASS / PASS WITH ISSUES / FAIL
- rekomendowane poprawki przed produkcją
```
