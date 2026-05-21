# ADR-router-phantom-001 — GL.iNet Puli AX (GL-XE3000) jako router platformy SYLION

| Pole | Wartość |
|---|---|
| **Status** | `PROPOSED (REVISED)` — DRAFT, wymaga HUMAN GATE |
| **Data pierwotna** | 2026-05-20 |
| **Data rewizji** | 2026-05-21 |
| **Autor draftu** | Claude (audit agent) — wymaga ludzkiego review |
| **Wymagane podpisy (HUMAN GATE)** | Architect • CISO • Legal • Hardware Lead |
| **Scope** | Baseline router (wszystkie tiery) + PHANTOM `[A]` operational profile na tej samej platformie |
| **Powiązane** | `ADR-router-baseline-002` (rozwiązanie konfliktu Mudi/Beryl) • `gate_router_puli_ax` w `releaseControlService` • Księga v3.4 §33 (do update) • PHANTOM v3.0 §16 |
| **Out of scope (osobne ADR-y)** | ADR-002 (PHANTOM operational mode / IMEI override — Legal-gated) • ADR-003 (lpac eSIM Management) • ADR-004 (custom firmware build + signing pipeline) |
| **Supersedes** | First draft (2026-05-20) z założeniem "PHANTOM-only" |

---

## 1. Tło rewizji

Pierwotny draft tego ADR (2026-05-20) zakładał Puli AX **wyłącznie** dla PHANTOM `[A]` tier, zachowując Beryl AX jako baseline router. Audit round 3 ujawnił że:

1. `docs/admin-panel-v1/00-freeze-v1.md` line 100 jasno definiuje produktową decyzję: **Puli AX dla STANDARD/PRO/SOVEREIGN** (wszystkie tiery).
2. `services/admin-api/src/modules/release/releaseControlService.js` rejestruje `gate_router_puli_ax` jako jedyny gate routera — bez paralelnego gate'a dla Beryl AX.
3. 17 plików w kodzie (src + tests) hardcoduje `puli_ax_router` jako jedyny typ urządzenia routerowego.
4. PHANTOM v3.0 §16 wymienia Puli AX jako alt PHANTOM router; baseline rozróżnienie ma być wprowadzone przez **profile firmware'u + operational mode**, nie przez inny hardware.

Wniosek: **hardware** = jeden (Puli AX). **Mode operacyjny** różni się między baseline (gated, audytowalny, lawful) a PHANTOM (autonomous `[A]`, osobny track, **outside certifiable scope**).

---

## 2. Decyzja

**GL.iNet GL-XE3000 "Puli AX"** to **referencyjny router platformy SYLION dla wszystkich tierów (STANDARD / PRO / SOVEREIGN)**, status `APPROVE WITH CONDITIONS`.

PHANTOM `[A]` używa **tej samej platformy hardware** + odrębnego firmware/mode (przedmiot osobnego ADR-002 pod Legal sign-off).

---

## 3. Rozważone alternatywy

| # | Kandydat | Wynik | Powód |
|---|---|---|---|
| A1 | GL.iNet GL-X3000 Spitz AX | rejected | Brak wbudowanej baterii. Mobilny profil operatora wymaga chosen power isolation. External pack = dodatkowy komponent supply chain |
| A2 | GL-MT3000 Beryl AX + USB cellular | rejected jako baseline | Lepszy mainline OpenWrt path (M1 gate), ale: (a) brak baterii, (b) tylko LTE Cat 4 przez dongle, (c) modem USB = większy footprint hardware. **Może wrócić jako fallback BoM** jeśli Puli AX EOL |
| A3 | Banana Pi BPI-R4 + M.2 cellular | rejected dla mobile | Najlepsza supply-chain story (open hardware), ale stationary. Kandydat dla **stationary STATE-tier** w przyszłości |
| A4 | Turris MOX A + LTE mPCIe | rejected | EU vendor, signed updates, ale stationary i cellular jako add-on słabszy niż dedykowany 5G |
| A5 | GL-E750V2 (Mudi v2) | rejected (legacy) | Poniżej `hardware-gates.md` RAM gate (M4). Pozostawiany jako legacy-only / exception, nie nowy deployment |
| A6 | GL-E5800 (Mudi 7) | rejected | PHANTOM v3.0 §16 explicit: "brak wsparcia eSIM Management" |
| A7 | Teltonika RUTX50, Peplink, Cradlepoint | rejected | PHANTOM v3.0 §16: wlutowany eSIM, brak slotu nano-SIM |

---

## 4. Tabela bramek vs `hardware-gates.md`

**Wartości oznaczone `?` to NEEDS EVIDENCE — weryfikacja z karty katalogowej + fizycznego egzemplarza wymagana przed głosowaniem ADR.**

### 4.1 Mandatory

| # | Gate | Status | Uwaga |
|---|---|---|---|
| M1 | OpenWrt 23.05+ lub hardened Linux | ⚠️ CONDITIONAL | GL OS 4.x = OpenWrt 21.02 base. Wymagany custom build mainline 23.05+ (ADR-004) LUB świadoma akceptacja CVE-lag GL fork z risk register entry |
| M2 | strongSwan / IPsec IKEv2 | ✅? | GL OS natywnie. **Verify**: strongSwan ≥5.9.x, proposals AES-256-GCM + SHA-384 + ECDSA P-384 |
| M3 | nftables default-deny kill switch | ✅? | OpenWrt 21+. **Verify**: GL.iNet nie nadpisuje iptables-legacy; reguły pre-tunnel (T01) |
| M4 | RAM ≥ 256 MB | ✅? | Spec recall: 1 GB DDR4. **Verify** |
| M5 | Flash sufficient | ✅? | Spec recall: 256 MB NAND. **Verify** — sprawdzić margines po hardened build |
| M6 | AES-256-GCM IPsec throughput | ⚠️ | Qualcomm crypto engine obecny, **brak liczb dla tego SKU**. Target ≥150 Mbps real traffic. Wymaga T08 |
| M7 | Separate WAN/LAN | ✅? | Standard OpenWrt |
| M8 | Firmware signing / verifiable provenance | ⚠️ CONDITIONAL | GL.iNet podpisuje swoje firmware, **brak Verified Boot bootloadera**. Custom build = własny klucz, własny pipeline (ADR-004) |
| M9 | Inventory fields | ✅ | Implementacja po stronie Orchestrator (M20), niezależna od HW |

### 4.2 Recommended

| # | Gate | Status |
|---|---|---|
| R1 | RAM ≥ 512 MB | ✅? |
| R2 | Flash ≥ 256 MB NAND | ✅? |
| R3 | HW AES acceleration | ✅? |
| R4 | USB dla LTE/5G (5G wbudowany + USB backup) | ✅ |
| R5 | Tamper-evident dla STATE | ❌ | Consumer-grade. Kompensacja: operator carry 24/7 + Faraday bag |
| R6 | Read-only rootfs + encrypted overlay | ⚠️ | Wymaga custom firmware build (ADR-004) |

### 4.3 Reject / Escalate

Wszystkie kryteria odrzucenia (RAM <256MB, brak update path, brak kill-switch enforcement, brak cert IPsec, brak auditable firmware) wymagają decyzji ADR-004 (firmware pipeline). Dziś **escalated**, nie rejected.

---

## 5. Operational profiles na tej samej platformie

| Profile | Tier | Firmware | Tryb operacyjny | Compliance |
|---|---|---|---|---|
| **`baseline`** | STANDARD / PRO / SOVEREIGN | hardened OpenWrt 23.05+ (ADR-004) | strongSwan IPsec IKEv2, nftables kill-switch, **stałe IMSI / IMEI / MAC**, audited config drift | In scope ISO/SOC review |
| **`phantom-a`** | poza tier (oddzielny `[A]` track) | hardened OpenWrt z dodatkową nakładką PHANTOM (ADR-002) | rotacja SIM (P1/P2/P3 per PHANTOM §8), **opcjonalna** rotacja IMEI/IMSI/MAC pod Legal-gated mandate | **Outside** certifiable baseline |

Kluczowe: kupowany jest **ten sam SKU** (GL-XE3000). Wybór profile to konfiguracja firmware + operator assignment, nie hardware procurement.

**Polityka:** żaden klient SYLION nie otrzymuje `phantom-a` profile bez explicit Legal sign-off na konkretnej jurysdykcji. Default = `baseline`.

---

## 6. Warunki aprobaty (refresh)

| # | Warunek | Owner | Termin |
|---|---|---|---|
| C1 | Weryfikacja wszystkich `?` w §4 z oficjalnego datasheet + fizycznego egzemplarza | Hardware Lead | przed T01 |
| C2 | Decyzja na M1: mainline 23.05+ build vs świadoma akceptacja GL OS CVE-lag | Architect + CISO | przed produkcją |
| C3 | Custom firmware build & signing pipeline (ADR-004) — własny klucz w HSM, audytowalny pipeline | Hardware Lead + Security | przed T06 |
| C4 | Kill-switch-before-VPN: nftables w initramfs, drop-all WAN przed startem strongSwan, weryfikacja T01 | Hardware Lead | przed produkcją |
| C5 | AES-256-GCM IPsec benchmark T08 z target ≥150 Mbps | QA + Hardware Lead | przed produkcją |
| C6 | Tamper compensation operator-side (Faraday bag, carry 24/7) — udokumentowane w runbook | Ops | przed produkcją |
| C7 | Pełne T01-T10 (baseline) przejście — raport z lab + CISO sign-off | QA + CISO | przed produkcją |
| C8 | **Tylko jeśli profile `phantom-a` jest wdrażany**: Legal opinion dla docelowych jurysdykcji (ADR-002 prereq) | Legal | przed pierwszym phantom-a deployment |
| C9 | Risk register entry dla wszystkich `accepted` ryzyk z §7 | CISO | przed produkcją |
| C10 | Inventory provisioning workflow (M9) zintegrowany z Orchestrator (M20) — confirmed via test | Ops/SRE | przed produkcją |
| C11 | Doc updates §8 wykonane (Księga §33 patch przez ADR-router-baseline-002) | Doc owner | razem z ADR-router-baseline-002 |

---

## 7. Konsekwencje

### 7.1 Pozytywne

- **Jeden SKU = prostsze procurement, single fallback BoM** (ze świadomością risk EOL = utrzymanie Beryl AX jako secondary BoM)
- Bateria → chosen power isolation dla mobile operator
- 2× nano-SIM → preloading następnej karty w polu
- 5G NSA/SA → szersze pokrycie
- PHANTOM v3.0 already lists go jako alt → minimalna doc-impact
- `releaseControlService.gate_router_puli_ax` already codifies status & owner

### 7.2 Negatywne

- GL OS = OpenWrt 21.02 base → CVE lag (mitigated by ADR-004 custom build LUB świadoma akceptacja)
- Brak Verified Boot bootloadera → partial mitigation (boot-verified rootfs hash w initramfs)
- Baseband Quectel proprietary → CVE residual (PHANTOM §4.2.3 — niezmienne)
- Brak tamper-evident → operator carry compensation (C6)
- Single-vendor (GL.iNet) → ryzyko EOL, supply pressure. Mitygacja: secondary BoM Beryl AX, monitorowany retail availability
- **Możliwa konsumpcja kontrowersyjna**: `phantom-a` profile na tej samej platformie wymaga mocnej operacyjnej separacji procurement i deployment workflow (operator nigdy nie dostaje phantom-a bez explicit Legal mandate)

### 7.3 Architecture / baseline impact

- **Zmiana baseline router** vs Księga v3.4 §33 (która nazywa Beryl AX) — wymaga osobnego ADR-router-baseline-002 + Księga patch
- Nie zmienia Thin Client, zone 0-5, G1/G2, Firecracker, Matrix
- Tworzy explicit dwa **operational profiles** na jednym hardware

### 7.4 Compliance / legal

- `baseline` profile in scope ISO 27001 / SOC 2 review (po spełnieniu C1-C11)
- `phantom-a` profile **outside** certifiable scope (per `legal-safety-boundaries.md`)
- Każda customer-facing dokumentacja **musi** explicit rozróżniać te dwa profiles — żadnego "PHANTOM ready" claimu w baseline marketingu
- Procurement vendor (GL.iNet, Hong Kong) → patrz ADR-router-baseline-002 §"Jurisdictional supply-chain"

---

## 8. Wymagane aktualizacje dokumentów

| Dokument | Zmiana |
|---|---|
| Księga v3.4 §33 | Update routera baseline: Beryl AX → Puli AX (przez ADR-router-baseline-002) |
| Księga v3.4 indeks komponentów | Usunąć Mudi v2 z baseline, oznaczyć jako legacy-only |
| Analiza Zagrożeń (kolejna edycja) | Patch całego threat model z Mudi v2 → Puli AX (battery, dual-SIM, 5G zamiast LTE Cat 4, baseband RM520N-GL zamiast EG25-G) |
| PHANTOM v3.0 §16 | Po przejściu T01-T16: zmienić status Puli AX na "verified baseline + alt phantom" |
| `shared/references/hardware-gates.md` §"Known Router Posture" | Dodać Puli AX jako baseline candidate z linkiem do tego ADR |
| `services/admin-api/src/domain/constants.js` | Rozważyć rename `DEVICE_TYPES.ROUTER` z `puli_ax_router` na `sylion_baseline_router` żeby unzależnić od konkretnego SKU |
| Risk register | Wpisy z §7.2 (CVE lag, baseband, tamper, vendor lock-in) |
| Inventory schema | Dodać pole `operational_profile` ∈ {baseline, phantom-a} per record |

---

## 9. Test plan

Pełen test plan w `tests/router-baseline-test-plan.md` (TBD). Skrót:

```
Baseline tier (mandatory, T01-T10):
  T01 Boot z nftables kill-switch active PRZED IPsec
  T02 LAN→WAN brak ruchu bez tunelu
  T03 DNS leak: tunneled DNS only
  T04 IKEv2 cert auth + approved proposals
  T05 Rekey + DPD recovery
  T06 Firmware signature verification (try-flash modified → fail)
  T07 Config drift detection
  T08 Throughput @ AES-256-GCM ≥150 Mbps
  T09 CPU/RAM pressure pod realistycznym ruchem (4× operator concurrent)
  T10 Power-loss recovery

Mobile-specific (T11-T13):
  T11 SIM hot-swap (slot 1↔2, IPsec re-establish <30s)
  T12 Battery isolation (yank battery vs DC pull — klucze giną <10s)
  T13 Faraday bag insertion → tunnel teardown + reconnect

PHANTOM `[A]` profile-specific (T14-T16, Legal-gated):
  T14 eSIM profile rotation via lpac CLI (download/enable/delete cycle)
  T15 IMEI override persist + revert (jeśli i tylko jeśli ADR-002 mandate w jurysdykcji)
  T16 Anti-tamper response — out of scope dla baseline tier
```

---

## 10. Open items / HUMAN GATE

1. **Spec verification** (C1) — wszystkie `?` w §4
2. **Mainline vs GL OS** (C2) — Architect+CISO
3. **Firmware signing key custody** (C3) — HSM-backed (ADR-vault-adapter-001 i ADR-004)
4. **EOL strategy** — secondary BoM = Beryl AX
5. **Liczba egzemplarzy do labu vs produkcji** — Procurement
6. **`phantom-a` profile policy** — Legal opinion per jurysdykcja (osobny ADR-002)
7. **Rotacja fizyczna 3-6mc per PHANTOM §4.4.3 vs 30 dni per Analiza R16** — patrz F-8 finding, wymaga harmonizacji w ADR-router-baseline-002

---

## 11. Sign-off

| Rola | Nazwisko | Data | Decyzja | Komentarz |
|---|---|---|---|---|
| Architect | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| CISO | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Legal | _________ | ____ | ☐ approve ☐ reject ☐ changes | (Legal wymagane tylko jeśli phantom-a profile w scope) |
| Hardware Lead | _________ | ____ | ☐ approve ☐ reject ☐ changes | |

ADR staje się `ACCEPTED` po wszystkich approve. Single reject → revision.

---

## Appendix A — Źródła

- [`shared/references/hardware-gates.md`](../shared/references/hardware-gates.md)
- [`shared/references/human-gate-policy.md`](../shared/references/human-gate-policy.md)
- [`shared/references/legal-safety-boundaries.md`](../shared/references/legal-safety-boundaries.md)
- [`shared/references/sylion-source-map.md`](../shared/references/sylion-source-map.md)
- `SYLION Ksiega v3 4 FIXED.docx` §33 (baseline router, do update)
- `SYLION_PHANTOM_v3.0.docx` §16 (PHANTOM router list), §7.3, §8
- `SYLION-Analiza-Zagrozen-COMPLETE.pdf` — R1-R18, ze szczególnym uwzględnieniem R16 (rotacja HW)
- `docs/admin-panel-v1/00-freeze-v1.md` line 100 (produktowa decyzja Puli AX wszystkie tiery)
- `services/admin-api/src/modules/release/releaseControlService.js` `gate_router_puli_ax`
