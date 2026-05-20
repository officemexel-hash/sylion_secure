# SYLION Admin Panel V1

Ten folder zawiera zamrożony pakiet startowy do budowy panelu administratora SYLION.

Status: V1 frozen. Kolejny etap jest opisany w `docs/admin-panel-v2/`.

## Pliki

```text
00-freeze-v1.md
  Zamrożone decyzje produktowe i bezpieczeństwa V1.

01-modules-masterplan.md
  Podział systemu na moduły, granice odpowiedzialności, kontrakty i kolejność budowy.

02-module-prompt-pack.md
  Prompty do budowy każdego modułu, prompty integracyjne i końcowy prompt testowy.

03-graphs-roadmap.md
  Mermaid graf zależności, sequence diagram, roadmapa i milestone definition of done.

04-workplan.md
  Plan pracy dla developerów/modeli, reguły równoległej implementacji i integracji.
```

## Najważniejsza Zasada

Najpierw budujemy integration spine:

```text
M16 Audit
M02 Authentication
M03 RBAC
M04 Tenant Management
M05 Operator Management
M06 Subscription & Entitlements
M07 Provisioning Plan Engine
```

Dopiero później dokładamy provisioning wykonawczy, urządzenia, workloady, CDR, monitoring, jurisdiction rotation i Matrix.
