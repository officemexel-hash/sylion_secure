# CLAUDE.md — SYLION Secure agent conventions

> Plik konwencji dla agentów (Claude Code, Codex, etc.). Czytany przy starcie sesji jako project context.

## Projekt

SYLION Secure to platforma control-plane. Patrz [`README.md`](./README.md) dla pełnego opisu.

**Twardy invariant:** `productionExecutionAllowed = false`. Nie wolno tego zmieniać bez explicit HUMAN GATE od Architect + CISO + Legal + Compliance.

## Skille SYLION

Repo zawiera 10 skilli w `.claude/skills/` które egzekwują reguły projektowe. Ładowane przy starcie sesji Claude Code. Każdy ma frontmatter `description` decydujący o auto-trigger.

```
sylion-architecture-guardian            # zone model, G1/G2, Thin Client, baseline integrity
sylion-compliance-legal-guardrails      # GDPR, NIS2, DORA, ISO 27001, SOC 2, FIPS, FedRAMP
sylion-crypto-pki-pqc                   # IPsec IKEv2, HSM, FIPS/CNSA, PQC migration
sylion-doc-consistency-auditor          # Ksiega 3.4 audits, contradictions, normativity
sylion-hardware-qualification           # routers, Pixels, HSMs, gate tables
sylion-ops-sre-incident-response        # SRE, WORM audit, DR, four-eyes
sylion-router-openwrt-hardening         # OpenWrt, strongSwan, nftables kill switch
sylion-secure-implementation            # code/infra implementation preserving invariants
sylion-skill-packager                   # skill set maintenance
sylion-threat-modeler                   # threat models, residual risks, R1-R18
```

Source: `skills/claude-code/<name>/SKILL.md`. Codex equivalents: `skills/codex/`. Shared refs: `shared/references/` (i `skills/shared/references/` — duplikat, sync manual).

## Reguły agentowe

### Skille auto-trigger

Jeśli zadanie pasuje do `description` skilla, użyj go. Lista skilli pojawia się w system reminder przy starcie sesji.

### HUMAN GATE

Z `shared/references/human-gate-policy.md`:

- Source conflicts touching baseline/security/compliance/hardware/crypto/legal → `HUMAN GATE REQUIRED`
- Missing evidence dla mandatory gate → `HUMAN GATE REQUIRED`
- Promote `[E]/[O]/[R]/[A]` → baseline → `HUMAN GATE REQUIRED`
- Destruktywne / root-level actions → four-eyes (per `sylion-ops-sre-incident-response`)
- PHANTOM, radio identity, jurisdictional rotation, lawful access → legal review

Model **może**: summarize facts, produce options z pros/cons, recommend preferred option z evidence, draft non-final wording, create test plans / ADR drafts.

Model **nie może**: claim certainty bez evidence, approve hardware/crypto/baseline na incomplete evidence, fabricate specs/citations/test-results/legal conclusions, ukrywać konfliktów źródeł, zamieniać PHANTOM `[A]` content w implementation steps.

### PHANTOM `[A]` boundary

- PHANTOM **nigdy nie** dostaje `executionAllowed = true` w runtime (`record.resourceType !== "phantom"` check)
- PHANTOM materiały (`SYLION_PHANTOM_v3.0.docx`, `SYLION-Analiza-Zagrozen-COMPLETE.pdf`) zawierają legal-review zones: IMEI/IMSI rotation, stealth transport, jurisdictional rotation poza lawful controls
- Tych terminów nie wolno reproducować w kodzie produkcyjnym poza `PROHIBITED_TERMS` blocklist w `phantomGovernanceService.js`
- ADR-y dotykające PHANTOM execution wymagają Legal + CISO + Architect sign-off

### Working tree etiquette

W repo pracuje równolegle **SYLION Codex** (autor 99% commitów) — głównie `services/admin-api/src/`, `apps/admin-web/`, i odpowiadające `docs/admin-panel-v2/<NN>-step3-X-*.md`.

**Bezpieczne ścieżki dla parallel work** (Codex ich nie rusza):

- `/README.md`, `/LICENSE`, `/SECURITY.md`, `/CLAUDE.md`
- `/.github/`
- `/adr/`
- `/shared/references/`
- `/.claude/skills/`
- `/skills/`

**Konfliktowe ścieżki** (zawsze sprawdź `git status` zanim editujesz):

- `/services/admin-api/src/**`
- `/apps/admin-web/**`
- `/services/admin-api/test/**`
- `/services/admin-api/IMPLEMENTATION_STATUS.md` — Codex go nie aktualizuje (znany finding F-18), więc można edytować, ale można też spowodować konflikt jeśli Codex pierwszy raz w sesji to zrobi
- `/docs/admin-panel-v2/` — Codex dodaje pliki `NN-step3-X-*.md` + diagrams + test-artifacts/

### Commit hygiene

- Nigdy nie commituj bez explicit user ask
- Co-author: `Co-Authored-By: <agent identifier>` w stopce
- Nie skipuj hooks (`--no-verify`, `--no-gpg-sign`) bez explicit user permission
- Branch protection (gdy włączone): wymagana review, signed commits
- Patrz `.github/CODEOWNERS` dla code-ownership rules

## Source documents (canonical)

```
SYLION Ksiega v3 4 FIXED.docx     -- normative system book; [N] requirements
SYLION_PHANTOM_v3.0.docx          -- autonomous [A] spec; outside certifiable core
SYLION-Analiza-Zagrozen-COMPLETE.pdf -- threat model; R1-R18 recommendations
shared/references/sylion-source-map.md -- mapowanie normatywności + router conflict notice
```

Hierarchia normatywności: `[N] Normative > [R] Recommended > [O] Optional > [E] Experimental > [A] Autonomous`.

## Test commands

```powershell
npm.cmd test                # 77 unit + e2e (Step 3.16 baseline)
npm.cmd run test:dashboard  # Playwright dashboard regression
```

PowerShell blokuje `npm.ps1` — zawsze `npm.cmd`.

## Audit trail

Run-by-run audit findings w session transcripts (F-1..F-34 series). High-priority unresolved:

- **F-1**: Router baseline conflict (Puli AX produkt vs Beryl AX refs)
- **F-2**: Mudi v2 inconsistency w Analiza Zagrożeń
- **F-13**: brak README → adresowane w tym sprincie
- **F-14**: brak CI → adresowane w tym sprincie
- **F-17**: brak LICENSE → adresowane w tym sprincie
- **F-18**: stale `IMPLEMENTATION_STATUS.md` → adresowane w tym sprincie
- **F-19**: audit hash chain nie jest WORM (krytyczne w świetle Step 3.16 live exec)
- **F-25**: vault adapter pending (interface ready, env-backed)
- **F-34**: token rotation policy missing

Pełna lista findings w session history (rounds 1-4 audit reports).

## Quick links

- Architecture decisions: [`/adr/`](./adr/)
- Normative refs: [`/shared/references/`](./shared/references/)
- Release control gates: [`services/admin-api/src/modules/release/releaseControlService.js`](./services/admin-api/src/modules/release/releaseControlService.js)
- PHANTOM boundary: [`services/admin-api/src/modules/phantom/phantomGovernanceService.js`](./services/admin-api/src/modules/phantom/phantomGovernanceService.js)
- Production readiness audit: [`docs/admin-panel-v2/55-step3-11-implementation-freeze-production-readiness.md`](./docs/admin-panel-v2/55-step3-11-implementation-freeze-production-readiness.md)
