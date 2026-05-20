# ADR-router-phantom-001 — Wybór GL.iNet Puli AX (GL-XE3000) jako routera dla tier PHANTOM `[A]`

| Pole | Wartość |
|---|---|
| **Status** | `PROPOSED` (DRAFT — wymaga HUMAN GATE) |
| **Data utworzenia** | 2026-05-20 |
| **Autor draftu** | Claude (model) — wymaga ludzkiego review |
| **Wymagane podpisy (HUMAN GATE)** | Architect • CISO • Legal • Hardware Lead |
| **Scope** | PHANTOM `[A]` — **poza certyfikowalnym baseline SYLION** |
| **Powiązane** | PHANTOM v3.0 §16 • Księga v3.4 §33 • [hardware-gates.md](../shared/references/hardware-gates.md) • [legal-safety-boundaries.md](../shared/references/legal-safety-boundaries.md) |
| **Out of scope (osobne ADR-y)** | ADR-002 (IMEI override firmware) • ADR-003 (lpac/eSIM Management) • ADR-004 (custom firmware build & signing pipeline) |

---

## 1. Kontekst

### 1.1 Cel decyzji

Wybrać hardware routera dla operatora pracującego w profilu PHANTOM `[A]` (autonomiczny, poza certifiable SYLION core). Router musi:

- spełniać mandatory gates z [hardware-gates.md §"Access Router Gates"](../shared/references/hardware-gates.md);
- spełniać PHANTOM-specific wymagania z **SYLION_PHANTOM_v3.0.docx** §16 (removable nano-SIM, eSIM Management, support dla rotacji);
- pasować do mobilnego profilu operacyjnego (przenośność, izolacja zasilania, krótki TTL stosu);
- nie naruszać `[A]/baseline` separacji ([legal-safety-boundaries.md](../shared/references/legal-safety-boundaries.md)).

### 1.2 Stan wyjściowy

- **Księga v3.4 §33** nazywa **GL-iNet Beryl AX / GL-MT3000** jako referencyjny router baseline.
- **PHANTOM v3.0 §16** listuje routery DOPUSZCZALNE w PHANTOM:
  - GL-iNet **GL-X3000 (Spitz AX)** — primary
  - GL-iNet **GL-XE3000 (Puli AX)** — alt
  - GL-iNet GL-E750V2 (Mudi v2) — "bazowy" (poniżej gate'ów RAM księgi, exception-only)
  - Quectel EG25-G USB dongle — backup
- **Konflikt w dokumentach**: indeks komponentów księgi i Analiza Zagrożeń wciąż wymieniają Mudi v2 jako baseline. ADR ten **nie rozwiązuje** tego konfliktu — jedynie wybiera router PHANTOM. Konflikt baseline router musi być adresowany osobnym ADR (`ADR-router-baseline-002`).
- **Legal/CISO mandate** — zadeklarowany przez wnioskodawcę dla operacji IMEI/IMSI w docelowych jurysdykcjach (nie zweryfikowane w tym dokumencie — wymaga formalnego załącznika `legal-mandate-phantom-2026-05.md` od counsel).

### 1.3 Wymagania funkcjonalne PHANTOM (z dokumentu źródłowego)

- Removable nano-SIM (NIE wbudowany eUICC/iSIM) — [legal-safety-boundaries: supply-chain rationale, nie evasion]
- 2× sloty SIM dla preloadingu następnej karty przed rotacją
- 5G/LTE z support dla pasm operacyjnych docelowych jurysdykcji
- Bateria wbudowana (chosen power isolation — operator może uciąć zasilanie bez pozostawienia śladu Wake-on-LAN/ARP)
- eSIM Management (panel/CLI lpac) lub poziom P1 (fizyczne SIM-y prepaid)
- IPsec IKEv2 + nftables kill switch (twardy wymóg baseline gate, nie PHANTOM-specific)
- Możliwość integracji firmware z PHANTOM Orchestrator (rotacja, posture reporting)

---

## 2. Decyzja

**Wybiera się GL.iNet GL-XE3000 "Puli AX"** jako router PHANTOM `[A]`, status `APPROVE WITH CONDITIONS`. Warunki — sekcja [§5](#5-warunki-aprobaty).

---

## 3. Rozważone alternatywy

| # | Kandydat | Powód odrzucenia / odłożenia |
|---|---|---|
| A1 | **GL-X3000 Spitz AX** | PHANTOM primary z dokumentu, ale **brak wbudowanej baterii**. External pack = dodatkowy komponent supply chain + dodatkowy IOC w polu. Profil mobilny operatora wymaga power isolation — Puli AX wygrywa na tej osi |
| A2 | **GL-MT3000 Beryl AX + Quectel EG25-G USB** | Najlepszy OpenWrt mainline path (M1 gate Pass czysto), ale: (a) brak baterii, (b) tylko LTE Cat 4 przez dongle (nie 5G), (c) modem USB jako osobny komponent = większy footprint hardware. Dobry dla baseline, **nie** dla PHANTOM mobile |
| A3 | **Banana Pi BPI-R4 + M.2 cellular** | Najsilniejsza supply-chain story (open hardware, mainline OpenWrt 24.x). Ale: (a) stationary form factor, (b) brak baterii natywnie, (c) wymaga znacznej inżynierii (firmware build, integracja M.2). Kandydat na **stationary STATE-tier** w przyszłości, nie PHANTOM mobile |
| A4 | **Turris MOX A + LTE mPCIe** | Najlepszy signed-update story (TurrisOS automatic updates z CZ.NIC). Ale: (a) stationary, (b) cellular jako add-on mPCIe = słabsza wydajność niż dedykowany modem 5G, (c) TurrisOS forking dla PHANTOM features = znaczna inwestycja. Odłożony jako alternatywa stationary |
| A5 | **GL-E750V2 (Mudi v2)** | Wymieniony w PHANTOM §16 jako "bazowy", ale **poniżej RAM gate księgi** (M4: ≥256 MB). Pozostawiamy jako legacy/exception, nie jako primary |
| A6 | **GL-E5800 (Mudi 7)** | PHANTOM §16 wprost **NIEDOPUSZCZALNE** ("brak wsparcia eSIM Management"). Re-ewaluacja możliwa po sprawdzeniu obecnego firmware — patrz `ADR-router-phantom-001-addendum-mudi7` jeśli się materializuje |
| A7 | Teltonika RUTX50 / Peplink / Cradlepoint | PHANTOM §16 wprost **NIEDOPUSZCZALNE** (wlutowany eSIM, brak slotu nano-SIM) |

---

## 4. Tabela bramek vs hardware-gates.md

**Wszystkie wartości oznaczone `?` to NEEDS EVIDENCE — wymagana weryfikacja z karty katalogowej GL.iNet i/lub fizycznego egzemplarza przed głosowaniem nad ADR.**

### 4.1 Mandatory

| # | Gate | Status | Dowód / uwaga |
|---|---|---|---|
| M1 | OpenWrt 23.05+ lub hardened Linux | ⚠️ CONDITIONAL | GL OS 4.x = OpenWrt **21.02** base. Wymaga: (a) custom build mainline 23.05+ (ADR-004), LUB (b) świadoma akceptacja CVE-lag GL fork z risk register entry |
| M2 | strongSwan / IPsec IKEv2 | ✅? | GL OS ma natywnie. **Verify**: wersja strongSwan ≥5.9.x, proposals zawierają AES-256-GCM + SHA-384 + ECDSA P-384 |
| M3 | nftables default-deny kill switch | ✅? | OpenWrt 21+ wspiera. **Verify**: GL.iNet nie nadpisuje iptables-legacy; reguły aktywne pre-tunnel (T01) |
| M4 | RAM ≥ 256 MB | ✅? | Spec recall: 1 GB DDR4. **Verify** z etykietą / GL spec sheet |
| M5 | Flash sufficient | ✅? | Spec recall: 256 MB NAND. **Verify**. Sprawdzić margines po hardened build (target: ≥30% wolne po firmware + strongSwan + logi + overlay + rollback) |
| M6 | AES-256-GCM IPsec throughput adekwatny | ⚠️ | Qualcomm crypto engine obecny, **brak liczb dla tego SKU**. Target: ≥150 Mbps real traffic. Wymaga T08 |
| M7 | Separate WAN/LAN | ✅? | Standard OpenWrt |
| M8 | Firmware signing / verifiable provenance | ⚠️ CONDITIONAL | GL.iNet podpisuje swoje firmware, **brak Verified Boot od bootloadera**. Custom build = własny klucz, własny pipeline (ADR-004) |
| M9 | Inventory fields | ✅ | Implementacja po stronie Orchestrator, niezależna od HW |

### 4.2 Recommended

| # | Gate | Status |
|---|---|---|
| R1 | RAM ≥ 512 MB | ✅? |
| R2 | Flash ≥ 256 MB NAND | ✅? (edge — wymaga marginesu) |
| R3 | HW AES acceleration | ✅? |
| R4 | USB dla LTE/5G | ✅ (5G wbudowany + USB jako backup) |
| R5 | Tamper-evident dla STATE | ❌ | Consumer-grade. Kompensacja: operator carry 24/7 + Faraday bag per PHANTOM §4.4.2 |
| R6 | Read-only rootfs + encrypted overlay | ⚠️ | Wymaga custom firmware build (ADR-004) |

### 4.3 Reject / Escalate

| Kryterium | Wynik |
|---|---|
| RAM < 256 MB | ✅ Pass (1 GB ?) |
| Tiny flash | ✅ Pass (256 MB ?) |
| Brak OpenWrt/security update path | ⚠️ ESCALATE — GL OS lag vs mainline, decision required w §5 |
| Brak kill-switch enforcement before VPN | ⚠️ ESCALATE — domyślnie GL OS startuje VPN po sieci. **Wymaga przebudowy boot order** (initramfs nftables drop-all → strongSwan → bring-up) |
| Brak cert-based IPsec | ✅ Pass |
| Brak auditable firmware build | ⚠️ ESCALATE — własny build pipeline (ADR-004) |

---

## 5. Warunki aprobaty

Aprobata staje się skuteczna po spełnieniu **wszystkich** poniższych:

| # | Warunek | Owner | Termin |
|---|---|---|---|
| C1 | Weryfikacja wszystkich `?` w §4 z oficjalnego datasheet GL.iNet i fizycznego egzemplarza | Hardware Lead | przed T01 |
| C2 | Decyzja na M1: mainline 23.05+ build vs świadoma akceptacja GL OS CVE-lag — udokumentowana | Architect + CISO | przed produkcją |
| C3 | Custom firmware build & signing pipeline (ADR-004) — projekt + own GPG/Sigstore key | Hardware Lead | przed T06 |
| C4 | Kill-switch-before-VPN — initramfs nftables drop-all, weryfikacja T01 | Hardware Lead | przed produkcją |
| C5 | AES-256-GCM IPsec benchmark — T08 z target ≥150 Mbps, raport | QA / Hardware Lead | przed produkcją |
| C6 | Legal opinion na IMEI override w pełnej liście docelowych jurysdykcji — załącznik | Legal | przed ADR-002 |
| C7 | Pełne T01-T16 przejście — raport z lab + sign-off | QA + CISO | przed produkcją |
| C8 | Doc updates §7 wykonane (Księga §33, indeks komponentów, PHANTOM §16 verified flag) | Doc owner | razem z ADR final |
| C9 | Risk register entry dla wszystkich `accepted` ryzyk z §6 | CISO | przed produkcją |
| C10 | Inventory provisioning workflow (M9) zintegrowany z Orchestrator | Ops/SRE | przed produkcją |

---

## 6. Konsekwencje

### 6.1 Pozytywne

- Bateria → chosen power isolation (lepsze OPSEC dla operatora niż Spitz AX)
- Mobilny form factor zgodny z PHANTOM operator carry (PHANTOM §4.4.2)
- 2× nano-SIM → preloading następnej karty przed rotacją bez fizycznego dostępu w polu
- 5G NSA/SA → szersze pokrycie i lepsza latencja vs LTE Cat 4
- PHANTOM v3.0 już go wymienia jako alt — minimalna doc-impact
- GL.iNet ma dojrzały ecosystem (`luci`, `lpac`, panel) → niższy bar entry dla operacji

### 6.2 Negatywne

- GL OS = OpenWrt 21.02 base → CVE lag (rozwiązywalne przez custom build, koszt: ADR-004 inżynieria)
- Brak Verified Boot bootloadera → częściowa mitygacja (boot-verified rootfs hash w initramfs)
- Baseband Quectel proprietary → CVE residual (PHANTOM §4.2.3 — niezmienne)
- Brak tamper-evident → operator carry compensation
- Single-vendor (GL.iNet) → ryzyko EOL, supply pressure. Mitygacja: utrzymać Beryl AX/Spitz jako fallback BoM

### 6.3 Architecture / baseline impact

- **Nie zmienia** baseline router (Beryl AX pozostaje per Księga §33)
- Tworzy explicit **PHANTOM-tier router** poza certifiable scope
- Wymaga jasnego wyodrębnienia w Księdze §33 między baseline i PHANTOM hardware
- Aktywuje konieczność osobnych ADR-ów: ADR-002 (IMEI), ADR-003 (lpac), ADR-004 (firmware pipeline)

### 6.4 Compliance / legal

- **NIE** wchodzi w scope ISO 27001 / SOC 2 / FedRAMP — `[A]` tier
- IMEI override → legal-review zone (legal-safety-boundaries.md) — wymaga osobnej opinii prawnej per jurysdykcja
- Claim "PHANTOM router" w materiałach klienta — **zakazany**; baseline materiały muszą oddzielnie traktować PHANTOM (legal-safety-boundaries.md §"Honest Capability Statement")

---

## 7. Wymagane aktualizacje dokumentów

| Dokument | Zmiana |
|---|---|
| Księga v3.4 §33 | Dodać explicit subsection "PHANTOM router" wskazujący Puli AX, oddzielnie od "baseline router = Beryl AX" |
| Księga v3.4 indeks komponentów | Usunąć "Mudi v2 (GL-E750V2)" z baseline, oznaczyć jako legacy/PHANTOM-exception |
| PHANTOM v3.0 §16 | Po przejściu T01-T16 zmienić oznaczenie Puli AX na "verified" |
| Risk register | Wpisy z §6.2 (CVE lag, baseband, tamper, vendor lock-in) |
| Inventory schema | Dodać tier marker `phantom-a` dla rekordów Puli AX |
| `shared/references/hardware-gates.md` | Opcjonalnie: dodać "Known Router Posture" entry dla Puli AX po finalizacji |

---

## 8. Test plan (referencja)

Pełen test plan w pliku `tests/router-phantom-test-plan.md` (TBD). Skrót w [§4.5 hardware-qualification skill output]:

```
Mandatory baseline:    T01..T10
PHANTOM-specific:      T11..T16
```

T11-T16 obejmują: SIM hot-swap, eSIM lpac rotation, IMEI override persist+revert, anti-tamper response, battery-pull klucze giną <10s, RAM-only logs po reboot.

---

## 9. Open items / wymagane decyzje HUMAN GATE

1. **Legal opinion załącznik** (C6) — która firma prawna, jakie jurysdykcje
2. **Mainline vs GL OS** (C2) — Architect+CISO decyzja
3. **Firmware signing key custody** — HSM-backed (zgodnie ze skill `sylion-crypto-pki-pqc`)
4. **EOL strategy** — fallback BoM jeśli GL.iNet wycofa SKU
5. **Liczba egzemplarzy do labu vs produkcji** — Procurement
6. **Rotacja fizyczna 3-6mc** (PHANTOM §4.4.3) — kto buduje workflow re-issue?

---

## 10. Sign-off

| Rola | Nazwisko | Data | Decyzja | Komentarz |
|---|---|---|---|---|
| Architect | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| CISO | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Legal | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Hardware Lead | _________ | ____ | ☐ approve ☐ reject ☐ changes | |

ADR staje się `ACCEPTED` po 4× approve. Single reject → revision required.

---

## Appendix A — Źródła

- [`shared/references/hardware-gates.md`](../shared/references/hardware-gates.md)
- [`shared/references/human-gate-policy.md`](../shared/references/human-gate-policy.md)
- [`shared/references/legal-safety-boundaries.md`](../shared/references/legal-safety-boundaries.md)
- [`shared/references/sylion-source-map.md`](../shared/references/sylion-source-map.md)
- `SYLION Ksiega v3 4 FIXED.docx` §33 (current baseline router)
- `SYLION_PHANTOM_v3.0.docx` §16 (PHANTOM router list), §4.x (threat model), §7.3 (IMEI override), §8 (SIM/eSIM pool)
- `SYLION-Analiza-Zagrozen-COMPLETE.pdf` — terminal path, RF fingerprinting, Mudi v2 inconsistency
