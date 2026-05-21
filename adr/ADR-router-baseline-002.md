# ADR-router-baseline-002 — Rozstrzygnięcie konfliktu Mudi v2 vs Beryl AX vs Puli AX w dokumentach normatywnych

| Pole | Wartość |
|---|---|
| **Status** | `PROPOSED` — DRAFT, wymaga HUMAN GATE |
| **Data** | 2026-05-21 |
| **Autor draftu** | Claude (audit agent) |
| **Wymagane podpisy** | Architect • CISO • Doc Owner |
| **Scope** | Doc consistency dla całego portfolio: Księga v3.4 + Analiza Zagrożeń + skille + hardware-gates.md |
| **Powiązane** | `ADR-router-phantom-001` (rewizja) • `sylion-source-map.md` §"Router Conflict To Preserve" • `update-księga-34-checklist.md` |

---

## 1. Problem

Trzy dokumenty normatywne zawierają niespójne informacje o routerze:

| Źródło | Router | Status |
|---|---|---|
| `SYLION Ksiega v3 4 FIXED.docx` §33 | **GL.iNet Beryl AX / GL-MT3000** | "baseline router" |
| `SYLION Ksiega v3 4 FIXED.docx` indeks komponentów | **GL.iNet Mudi v2 / GL-E750V2** | wciąż wymieniony |
| `SYLION-Analiza-Zagrozen-COMPLETE.pdf` cały threat model | **GL.iNet Mudi v2 / GL-E750V2** | "jedyny external mobile router" |
| `SYLION_PHANTOM_v3.0.docx` §16 | Puli AX / Spitz AX / Mudi v2 / EG25-G | różne role |
| `docs/admin-panel-v1/00-freeze-v1.md` line 100 | **Puli AX** dla wszystkich tierów | produktowa decyzja |
| `services/admin-api/src/modules/release/releaseControlService.js` | **Puli AX** (gate_router_puli_ax) | runtime gate |
| `shared/references/hardware-gates.md` | Beryl AX = "working baseline candidate" | reference |
| `.claude/skills/sylion-router-openwrt-hardening/SKILL.md` | Beryl AX | rule |

Dwie różne decyzje koegzystują:
- **Pre-2026-05-20 normatywne refs**: Beryl AX baseline, Puli AX = PHANTOM only
- **Post-freeze-v1 product decision**: Puli AX baseline dla wszystkich tierów

Konflikt blokuje:
- Audyt zewnętrzny (ktora wersja autorytatywna?)
- Procurement (co kupować?)
- Threat model update (od czego liczyć baseband CVE?)
- Compliance scope (Mudi v2 jest poniżej RAM gate — czy to wpływa na ISO scope?)

---

## 2. Decyzja

**Konsoliduj wokół Puli AX (GL-XE3000)** jako jedynego baseline routera (per `ADR-router-phantom-001` REVISED).

**Mudi v2 (GL-E750V2)** dostaje formalny status `LEGACY / EXCEPTION-ONLY` — nie wykorzystywany w nowych deploymentach, dopuszczalny tylko w istniejących instalacjach pod risk-register entry, do migracji w okresie 12 miesięcy od ACCEPTED status tego ADR.

**Beryl AX (GL-MT3000)** dostaje formalny status `SECONDARY BoM / FALLBACK` — utrzymywany jako alternative na wypadek EOL Puli AX lub jako stationary deployment dla profile gdzie bateria nie jest wymagana.

---

## 3. Wymagane patches per dokument

### 3.1 `SYLION Ksiega v3 4 FIXED.docx`

| Sekcja | Stary tekst | Nowy tekst (proponowany) |
|---|---|---|
| §33 routery — baseline | "GL-iNet Beryl AX / GL-MT3000" | "GL.iNet Puli AX / GL-XE3000 (per ADR-router-phantom-001). Secondary BoM: GL-iNet Beryl AX / GL-MT3000." |
| §33 routery — minimum requirements | (zachować) RAM ≥256MB, OpenWrt 23.05+, strongSwan, AES, kill switch | bez zmian — Puli AX te wymagania spełnia z marginesem |
| Indeks komponentów | "Mudi v2 Router (GL-E750V2)" | usunąć z baseline indexu. Jeśli zachować jako legacy: "Mudi v2 (GL-E750V2) — LEGACY, exception-only, patrz ADR-router-baseline-002" |
| §X (gdziekolwiek) — bateria operatorska | brak / nieaktualne | dodać: "Bateria 10 000 mAh wbudowana w Puli AX umożliwia chosen power isolation per `legal-safety-boundaries.md`" |

### 3.2 `SYLION-Analiza-Zagrozen-COMPLETE.pdf`

Cały dokument bazuje na Mudi v2 (~30 wystąpień). Wymaga **next edition** (v2):

| Sekcja | Zmiana |
|---|---|
| §1.1, §1.3 schematy terminala | Mudi v2 → Puli AX. Cellular: LTE Cat 4 (EG25-G) → 5G NSA/SA (RM520N-GL). Bateria 7000 mAh → 10 000 mAh |
| Tabele porównawcze (np. §3.2 capability) | Update parametrów Puli AX. Pamiętać o 2× nano-SIM (Mudi v2 ma 1) |
| §4.1.1 CSS — IMSI catcher | Nie zmienia conclusion (CSS niezależny od routera) |
| §4.1.2 SS7 | Nie zmienia conclusion |
| §4.2.3 baseband CVE | **Zmienia surface**: Quectel RM520N-GL ma inny set CVE niż EG25-G. Dodać CVE-2025-26782, CVE-2025-48633 |
| §4.4.3 RF fingerprinting | Conclusion (residual) bez zmian. Note: rotacja hardware nadal wymagana — patrz §3.4 niżej |
| §8 SIM/eSIM pool | Puli AX dual-SIM = preloading; pula 350+ kart eUICC nie zmienia |
| §11 R16 | **Konflikt do rozstrzygnięcia**: 30 dni vs 3-6 mc — patrz §3.4 niżej |
| §16 procurement | Update vendor list |

### 3.3 `SYLION_PHANTOM_v3.0.docx`

| Sekcja | Zmiana |
|---|---|
| §16 router list | Puli AX = primary (z pierwotnym alt), Spitz AX = alt, Mudi v2 = legacy/exception, EG25-G = backup USB |
| §7.3, §8 (IMEI/SIM rotation) | Doprecyzować że phantom-a profile na Puli AX wymaga ADR-002 + Legal mandate per jurysdykcja |

### 3.4 Harmonizacja rotacji hardware (F-8)

| Źródło | Okres | Decyzja |
|---|---|---|
| PHANTOM v3.0 §4.4.3 | "co 3-6 miesięcy w operacjach najwyższego ryzyka" | dla **phantom-a** profile, najwyższy ryzyko |
| Analiza Zagrożeń R16 | "co 30 dni" | dla **phantom-a** profile, **rekomendowane** w strefie konfliktu |

**Proponowana harmonizacja:**

```
baseline profile:    rotacja co 12-24 miesięcy (lifecycle / EOL driven)
phantom-a default:   rotacja co 90 dni (mid-point, audytowalny standard)
phantom-a high-risk: rotacja co 30 dni (per Analiza R16, dla strefy konfliktu)
phantom-a critical:  rotacja co 7 dni (nowy poziom, exception-only)
```

Wpisać do PHANTOM v3.0 §4.4.3 i Analiza R16. Closes F-8.

### 3.5 `shared/references/hardware-gates.md`

Dodać entry do §"Known Router Posture":

```markdown
- GL.iNet Puli AX / GL-XE3000: current baseline router for all tiers per
  ADR-router-phantom-001 REVISED. PHANTOM `[A]` operational profile may also
  run on this hardware under separate ADR-002 + Legal mandate.
- GL.iNet Beryl AX / GL-MT3000: secondary BoM / fallback. Retained for
  stationary deployments or when Puli AX is unavailable.
- GL.iNet Mudi v2 / GL-E750V2: LEGACY / EXCEPTION-ONLY. No new deployments.
  Existing installations require risk-register entry; migrate within 12
  months of ADR-router-baseline-002 ACCEPTED status.
```

### 3.6 `.claude/skills/sylion-router-openwrt-hardening/SKILL.md`

Zmienić `Baseline` block:

```
Use GL.iNet Puli AX / GL-XE3000 as baseline (per ADR-router-phantom-001 REVISED).
Secondary BoM: GL-iNet Beryl AX / GL-MT3000. Do not deploy GL.iNet Mudi v2 /
GL-E750V2 in new operators (legacy / exception-only per ADR-router-baseline-002).
```

### 3.7 `.claude/skills/sylion-architecture-guardian/SKILL.md`

Stara reguła "Do not approve Mudi v2 / GL-E750V2 as baseline router" — zachowana, dodać:

```
Treat Puli AX / GL-XE3000 as the baseline router across all tiers per
ADR-router-phantom-001 REVISED. PHANTOM `[A]` profile runs on the same
hardware but is outside certifiable baseline scope.
```

### 3.8 `.claude/skills/sylion-hardware-qualification/SKILL.md`

Update description i Known Router Posture per §3.5 powyżej.

### 3.9 `shared/references/sylion-source-map.md`

§"Router Conflict To Preserve" i §"Current Router Baseline" wymagają rewrite:

```markdown
## Current Router Baseline (Resolved by ADR-router-baseline-002)

GL.iNet Puli AX / GL-XE3000 is the baseline router for all tiers
(STANDARD / PRO / SOVEREIGN) per the resolved decision in ADR-router-
phantom-001 REVISED and ADR-router-baseline-002.

Pre-2026-05-21 the source documents disagreed (Księga §33 named Beryl AX,
component index and threat assessment named Mudi v2). The conflict is
formally resolved; document patches are tracked in update-księga-34-
checklist.md.

Secondary BoM: GL.iNet Beryl AX / GL-MT3000.
Legacy / exception-only: GL.iNet Mudi v2 / GL-E750V2.
```

### 3.10 `shared/references/update-księga-34-checklist.md`

Dodać item:

```
- [ ] Apply ADR-router-baseline-002 patches per §3.1-§3.9 of that ADR.
      Verify cross-doc consistency after each patch with sylion-doc-
      consistency-auditor skill.
```

---

## 4. Konsekwencje

### 4.1 Pozytywne

- Closes F-1, F-2, F-5, F-8 (rotation period harmonizacja)
- Audyt zewnętrzny dostaje single source of truth
- Procurement uproszczone do jednego SKU
- Threat model następnej edycji może być pisany świeżo, bez "ale Mudi v2" caveatów

### 4.2 Negatywne

- **Migracja istniejących Mudi v2 deployments** — 12 mc okres, ale wymaga procurement + replacement workflow
- **Analiza Zagrożeń v2** to znaczna praca (60-80% dokumentu zmienia parametry pod Puli AX)
- Beryl AX jako secondary BoM = utrzymanie znajomości hardware u zespołu HW
- Mudi v2 customers (jeśli istnieją) mogą protestować re-procurement cost

### 4.3 Compliance

- Po wdrożeniu patches: refs spójne, ISO/SOC scope clean
- `phantom-a` profile nadal `[A]`, nie wchodzi do certifiable scope
- Risk register: legacy Mudi v2 deployments = explicit risk z 12-mc remediation

---

## 5. Implementation plan

| Tydzień | Owner | Deliverable |
|---|---|---|
| W1 | Doc owner | Patch `shared/references/*.md` (§3.5, §3.9, §3.10) |
| W1 | ja | Patch `.claude/skills/sylion-*.md` (§3.6-§3.8) |
| W2 | Doc owner | Patch Księga v3.4 §33 + indeks komponentów (§3.1) |
| W3-W4 | Architect + CISO | Pisanie Analiza Zagrożeń v2 (§3.2) — major rewrite |
| W4 | Architect | Patch PHANTOM v3.0 §16 + §4.4.3 (§3.3 + §3.4) |
| W5 | CISO + Ops | Migration runbook dla legacy Mudi v2 deployments |
| W6+ | Procurement | Migracja deployments (12 mc okres) |

---

## 6. HUMAN GATE / Open items

1. **Czy są istniejące Mudi v2 deployments?** Jeśli tak, ile i z jakim ryzykiem migracji? → Architect + Ops
2. **Analiza Zagrożeń v2** — kto pisze, w jakim timeframe? → CISO + Architect
3. **Mudi v2 migration period** — 12 mc proponowane; czy akceptowalne czy potrzeba krótsze/dłuższe? → CISO + Compliance
4. **Rotacja periods (§3.4)** — czy proponowany rozkład 12-24mc / 90d / 30d / 7d akceptowalny? → CISO
5. **Secondary BoM Beryl AX** — kupić zapas teraz, czy on-demand? → Procurement

---

## 7. Sign-off

| Rola | Nazwisko | Data | Decyzja | Komentarz |
|---|---|---|---|---|
| Architect | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| CISO | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Doc Owner | _________ | ____ | ☐ approve ☐ reject ☐ changes | |

---

## Appendix A — Źródła

- [`adr/ADR-router-phantom-001.md`](./ADR-router-phantom-001.md) REVISED
- [`shared/references/sylion-source-map.md`](../shared/references/sylion-source-map.md)
- [`shared/references/hardware-gates.md`](../shared/references/hardware-gates.md)
- [`shared/references/update-księga-34-checklist.md`](../shared/references/update-księga-34-checklist.md)
- `SYLION Ksiega v3 4 FIXED.docx` (do patch)
- `SYLION-Analiza-Zagrozen-COMPLETE.pdf` (v2 rewrite)
- `SYLION_PHANTOM_v3.0.docx` §16, §4.4.3 (do patch)
- `docs/admin-panel-v1/00-freeze-v1.md` (produktowa decyzja)
- `services/admin-api/src/modules/release/releaseControlService.js` `gate_router_puli_ax`
