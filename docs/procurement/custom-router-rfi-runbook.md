# Custom Mobile Router — RFI Runbook (Stage 1: pilot 50-200)

> Operacyjny runbook dla procurement custom mobile cellular router pod SYLION baseline + PHANTOM `[A]` profile capability. Stage 1 = pilot 50-200 sztuk, dual-geography RFI (PL/EU + CN parallel).

Per [`adr/ADR-router-baseline-002.md`](../../adr/ADR-router-baseline-002.md) §4.3 Watch list + §4.4 EOL monitoring policy. Realizuje wymóg C3 z [`adr/ADR-router-phantom-001.md`](../../adr/ADR-router-phantom-001.md) (custom firmware build & signing pipeline).

---

## 0. Krytyczne ramowanie — co mówić, czego NIE mówić

### ✅ Komunikuj z producentem (legitymne specs)

- OpenWrt 23.05+ mainline support
- Cellular modem **with standard AT command interface exposed to host OS** (legitimate dla diagnostics, lifecycle, modem health)
- 2× **removable nano-SIM slot** (NIE wbudowany eSIM)
- Hardware AES acceleration
- Battery + ruggedization
- Certifications (CE, EU RED, opcjonalnie FCC/IC)
- Own firmware signing key (HSM-backed)

### ❌ NIGDY nie komunikuj

- IMEI rotation / spoofing (per `legal-safety-boundaries.md` §"Restricted Work")
- IMSI manipulation
- Stealth transport / jurisdictional evasion
- PHANTOM specific operational details
- "Hide from lawful intercept"

**PHANTOM operational features (per ADR-002) implementowane we WŁASNYM firmware**, producent dostarcza tylko platformę. Manufacturer **nigdy** się nie dowiaduje o PHANTOM profile.

---

## 1. Stage 1 cele

| Parametr | Wartość |
|---|---|
| Volume target | 50-200 sztuk pilot |
| Timeline | 3-6 miesięcy od first RFI do sample evaluation |
| Budget bracket | EUR 15-50k startup (samples + pilot batch) + EUR 80-200k pilot production |
| Approach | **Modyfikacja istniejącego reference design** (NIE full custom PCB) |
| Geography | Dual: PL/EU + CN parallel RFI |
| Decision gate | Po sample evaluation T01-T10 lab testing |
| Out of scope Stage 1 | Full custom PCB, EAL4+ certification, mass production >2000 |

---

## 2. Vendor shortlist

### 2.1 🇵🇱 Polska / EU shortlist (5-7 firm)

| # | Firma | Lokalizacja | Co robią | Fit dla SYLION | Strategia kontaktu |
|---|---|---|---|---|---|
| EU1 | **Plum sp. z o.o.** | Białystok, PL | Industrial routers, M2M, IoT gateway | ⚠️ Industrial-focus, nie mobile — ale ich PCBA team może zmodyfikować ref design | Email + phone do sales@plum.pl. Targi IFE styczeń |
| EU2 | **Elproma Elektronika** | Czosnów, PL | NTP servers, M2M, custom electronics | ⚠️ Brak mobile router experience, ale custom electronics shop | Direct email |
| EU3 | **Mikronika sp. z o.o.** | Poznań, PL | SCADA, telemetry, industrial IoT | ⚠️ Industrial-focus, podobnie | LinkedIn outreach do CTO/sales |
| EU4 | **Assel SA** | Gdynia, PL | Contract manufacturing (PCBA), assembly | ⚠️ Tylko CM/EMS, **nie produkuje** ref design — przynosisz design, oni montują | Email; bardzo dobry dla pilot run jeśli mamy własny PCB |
| EU5 | **Etronika sp. z o.o.** | Gdańsk, PL | Hardware design + prototyping | ✅ Design house — mogą zaprojektować + sourceować PCBA u Assel/innego | Strong fit jeśli idziemy w pełen custom; dla Stage 1 (modyfikacja ref design) mniej |
| EU6 | **Turris / CZ.NIC** | Praga, CZ | TurrisOS routers (OS-bezpieczne, EU jurisdiction) | ✅ Custom variant Turris MOX/Omnia z LTE module — najbliżej naszemu use case w EU | Email do support / partnership. CZ.NIC jest NGO, niskie response time ale jakość |
| EU7 | **Teltonika Networks** | Wilno, LT | Industrial cellular routers | ⚠️ Ich SKU mają welded eSIM (per PHANTOM §16 niedopuszczalne), ALE **custom variant** w mid-batch może mieć removable SIM — pytaj | Direct sales contact via teltonika-networks.com |

**EU verdict:** Polska sama w sobie ma słaby ekosystem dla mobile cellular routers. Realne EU candidates: **Turris/CZ.NIC** (najbliżej naszej architektury, EU jurisdiction, EUR pricing) + **Teltonika custom variant** (jeśli zgodzą się na removable SIM). PL = głównie PCBA partner jeśli mamy własny design.

### 2.2 🇨🇳 Chiny / HK / TW shortlist (5-7 firm)

| # | Firma | Lokalizacja | Co robią | Fit | Notatka |
|---|---|---|---|---|---|
| CN1 | **GL.iNet** | Hong Kong / Shenzhen | Mobile cellular routers (X3000, XE3000, Beryl AX) — nasz current T1 | ✅ Już znamy ich SKU. Pytanie: custom variant? Min MOQ? Własne firmware signing? | Email do sales@gl-inet.com + Vince Liu (CTO) na LinkedIn. Możliwy najszybszy time-to-market |
| CN2 | **Robustel** | Guangzhou, CN | Industrial cellular routers, M2M, IoT | ✅ Doświadczeni w cellular, mają OpenWrt-based products | Email sales + Alibaba store |
| CN3 | **Cudy** | Shenzhen, CN | Consumer routers + cellular | ⚠️ Bardziej consumer, ale tańsi i otwarci na custom | Alibaba |
| CN4 | **ALFA Network** | Tajwan | Wi-Fi cards, OpenWrt-friendly | ⚠️ Niska skala, niche, ale bardzo open OpenWrt | LinkedIn |
| CN5 | **Yeacomm** | Shenzhen | LTE/5G CPE | ⚠️ Bardziej CPE niż mobile router | Alibaba |
| CN6 | **Shenzhen Yixinhang Technology** | Shenzhen | White-label custom mobile routers | ⚠️ ODM bez własnego brandu — robią dla mniejszych marek | Alibaba RFQ; mogą być najbardziej elastyczni dla custom variant |
| CN7 | **Shenzhen Wirelesscom Industries** | Shenzhen | Cellular gateway, IoT routers | ⚠️ Industrial focus, ale OpenWrt-capable | Alibaba |

**CN verdict:** **GL.iNet** ma najwyższy fit (już używamy ich SKU). Drugi natural candidate = **Shenzhen Yixinhang** lub podobny white-label ODM dla custom variant. **Robustel** dla industrial-grade variant.

### 2.3 Wykluczone z RFI

| Vendor | Powód |
|---|---|
| Foxconn / Pegatron / Wistron | Tier-1, MOQ 10k+, nie odpowiedzą |
| Peplink, Cradlepoint, Sierra Wireless | Welded eSIM = PHANTOM §16 niedopuszczalne |
| MikroTik | RouterOS proprietary, hardware-gates M1 fail |
| Niepotwierdzeni dealerzy z AliExpress | Supply chain risk, no provenance |
| Chińskie firmy na US Entity List (sprawdzić aktualne sankcje) | US-customer risk |

---

## 3. Komunikacja step-by-step

### Step 1: Inicjalny RFI (Week 1-2)

Send do wszystkich 12-14 vendorów z shortlisty parallel (oszczędność czasu). Templates §4 niżej.

### Step 2: Triaging responses (Week 3-4)

Oczekuj 50-60% response rate. Wstępne kryteria:

| Sygnał | Akcja |
|---|---|
| Odpowiedź <72h, profesjonalna, konkretna | ⭐ Promote do RFQ shortlist |
| Generic auto-response, no engagement | ⚪ Wait for follow-up |
| "We can do anything, including IMEI change" | 🚫 **Drop immediately** — red flag |
| Insist na full prepayment lub crypto-only | 🚫 Drop |
| Niezdolny wskazać konkretnego SKU/ref design | ⚪ Send second mail explaining specs |
| Vendor zgadza się na NDA | ⭐ Promote |

### Step 3: NDA sign (Week 4-6)

**Przed** dzieleniem się szczegółowymi specami. Standardowy mutual NDA, EU jurisdiction (PL/DE), 3-letni term, no IP transfer.

⚠️ **Legal counsel review wymagany dla każdego NDA** — szczególnie dla CN partners (jurisdiction clauses).

Drafting template NDA: out of scope tego runbooka — użyj kancelarii.

### Step 4: RFQ (Request For Quote) (Week 6-10)

Pełny spec, MOQ pytanie, lead time, pricing tier (5/50/200/2000 sztuk).

### Step 5: Sample order (Week 10-18)

5-10 sztuk od 2-3 finalistów. Cena pre-production sample często 3-5× per-unit normal, accept.

### Step 6: Lab evaluation (Week 18-24)

Per ADR-router-phantom-001 §9 test plan T01-T10. Baseline tests pierwsze. Później T11-T16 jeśli legal sign-off na phantom-a profile.

### Step 7: Pilot production decision (Week 24+)

Wybór finalisty(-tów). PO 100-200 sztuk z penalty clause na delays.

---

## 4. RFI email templates

### 4.1 Template EU (po angielsku, polish-friendly tone)

```
Subject: RFI — Custom mobile cellular router platform inquiry

Dear [Sales Team / Mr./Ms. NAME],

We are evaluating partners for a custom mobile cellular router 
project intended for the EU market. Approximate first-year volume: 
100-200 units (pilot batch), with potential scale to 1000-5000 
units in year two depending on field results.

Target specifications (subject to refinement under NDA):

  Platform:        OpenWrt 23.05+ mainline support
  Cellular modem:  Quectel RM520N-GL 5G NSA/SA (or equivalent), 
                   with standard AT command interface exposed to 
                   the host OS
  SIM:             2× removable nano-SIM slots (no embedded eSIM)
  RAM/Flash:       ≥1 GB DDR4 / ≥256 MB NAND
  Crypto:          Hardware AES acceleration
  Battery:         Built-in, ≥10000 mAh, UN38.3 / IEC 62133 certified
  Form factor:     Pocket-sized, ruggedization acceptable
  Connectivity:    Wi-Fi 6 (AX), USB 3.0
  Certifications:  CE, EU RED required; FCC/IC desirable

Custom firmware requirements:
  - We require the ability to build, sign, and flash our own 
    firmware images using our HSM-backed signing key.
  - We require OTA update via our own infrastructure.
  - We expect collaboration on a stable hardware ABI for at 
    least 24 months of mainline OpenWrt support.

We would like to assess your capability before proceeding to a 
formal RFQ. Could you please advise:

  1. Whether your existing reference designs match the above specs 
     (which model is the closest baseline you could modify).
  2. Typical MOQ for a customized variant.
  3. Lead time from PO to first sample (5 units), and from first 
     sample to pilot production (100 units).
  4. NDA process — are you prepared to sign a mutual NDA before 
     detailed RFQ?
  5. IP ownership terms for custom hardware modifications.
  6. Whether you can ship samples to Poland / EU, and your 
     standard payment terms.

We are conducting this evaluation in parallel with several other 
EU and Asia-based partners. We would appreciate a response within 
the next 10 business days.

Best regards,
[Your name]
[Your title]
[Company name / "SYLION Procurement"]
[Email]
[Phone]
```

### 4.2 Template CN (po angielsku, direct tone)

```
Subject: Custom Mobile Cellular Router RFI - EU Customer

Dear Sales Team,

We are an EU technology company evaluating partners for a custom 
mobile cellular router. Initial volume 100-200 units, scaling to 
1000-5000 units. Please advise capability.

Target specifications:

  - Platform:     OpenWrt 23.05+ supported
  - Modem:        Quectel RM520N-GL 5G or equivalent
  - SIM slots:    2x removable nano-SIM (NOT embedded eSIM)
  - RAM:          1 GB DDR4 or more
  - Flash:        256 MB NAND or more  
  - Crypto:       Hardware AES acceleration
  - Battery:      Built-in 10000+ mAh, UN38.3 certified
  - WiFi:         WiFi 6 (AX)
  - USB:          USB 3.0
  - Certs:        CE, EU RED mandatory; FCC/IC desirable

Custom firmware requirements:
  - Customer-built firmware images with customer signing key.
  - OTA update via customer infrastructure.
  - Standard AT command interface for modem exposed to host OS 
    (for diagnostics, lifecycle management).

Please confirm:
  1. Closest reference design model and modifications possible.
  2. MOQ for customized variant.
  3. Lead time: PO to 5-unit sample, sample to 100-unit pilot.
  4. NDA acceptance (mutual, EU jurisdiction).
  5. IP ownership for hardware modifications.
  6. Shipping to EU, payment terms.
  7. Whether you have similar projects with EU customers.

We are evaluating multiple partners. Response within 10 business 
days appreciated.

Best regards,
[Your name]
[Company]
[Email]
[WhatsApp / WeChat if applicable]
```

**Różnice EU vs CN template:**
- CN templates są bardziej zwięzłe, direct, action-item style
- EU templates używają więcej courtesy phrases ("Dear", "Subject to refinement", "We would appreciate")
- CN włączyć WhatsApp/WeChat — to ich główny B2B channel
- EU email-driven, telephone follow-up po 5 dniach

---

## 5. Evaluation matrix

Ocenianie responses i samples wg kryteriów. Wagi do twojej negocjacji.

| Kryterium | Waga | Skala 1-5 |
|---|---|---|
| OpenWrt 23.05+ mainline support (M1 gate) | 15% | 1=brak, 5=tested working |
| Standard AT command interface (per ADR-002 wymóg interface) | 12% | 1=blocked, 5=fully exposed |
| Removable nano-SIM ×2 (PHANTOM §16) | 12% | 1=embedded only, 5=2 removable |
| RAM ≥1 GB DDR4 + Flash ≥256 MB NAND | 8% | 1=below gate, 5=above |
| HW AES acceleration | 8% | 1=software only, 5=dedicated engine |
| Battery quality (UN38.3/IEC 62133) | 8% | 1=brak cert, 5=cert + 10000+ mAh |
| Custom firmware signing pipeline ownership | 10% | 1=vendor-locked, 5=full customer key |
| NDA acceptance + IP terms | 7% | 1=refuse, 5=mutual EU jurisdiction |
| MOQ ≤200 sztuk | 5% | 1=10000+, 5=≤100 |
| Lead time PO→sample ≤8 weeks | 5% | 1=>16, 5=<4 |
| EU/PL shipping capability | 4% | 1=no, 5=existing customers |
| CE/FCC certification track record | 3% | 1=no certs, 5=multiple SKUs certified |
| Sample cost reasonable | 3% | 1=>5× unit price, 5=2× unit price |

**Threshold:** total score ≥ 65/100 dla shortlistowania do sample order. ≥ 75 dla pilot production decision.

---

## 6. Red flags — kiedy uciekać

| Sygnał | Co znaczy |
|---|---|
| "We can do anything you want, including IMEI change" | Niewiarygodny lub niebezpieczny vendor — drop immediately |
| Brak NDA willingness | Słaba operacja lub middleman |
| Full prepayment insist | Scam risk |
| Brak CE/FCC evidence dla istniejących SKU | Niezdolny do certyfikacji |
| Pricing 10× poniżej rynkowej | Counterfeit components |
| Sub-broker bez własnej fabryki | Tylko podnosi cenę |
| Refuse factory tour (video/zdjęcia) | Phantom factory |
| Insistnie na zmianę specs bez wyjaśnienia | Próba podsunięcia gorszego komponentu |
| Brak referencji do innych EU customers | Możliwy export compliance issue |
| Sprzeciw wobec own firmware signing key | Vendor-lock-in plan |

---

## 7. Timeline (Gantt-style)

```
Week  1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19  20  21  22  23  24
      |---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
RFI   [▓▓▓]
Triage    [▓▓▓▓]
NDA           [▓▓▓▓▓▓]
RFQ                [▓▓▓▓▓▓▓▓]
Quote review              [▓▓▓▓]
Sample PO                     [▓▓]
Sample build                     [▓▓▓▓▓▓▓▓]
Lab eval                                [▓▓▓▓▓▓▓▓]
Pilot PO decision                                       [▓▓▓▓]
```

Z buffer ~20%: docelowa ścieżka **22-30 tygodni** od RFI do PO pilot production.

---

## 8. Budget bracket Stage 1

| Pozycja | EUR (low) | EUR (high) |
|---|---|---|
| Legal: NDA drafting + review per vendor (×5-7) | 3 000 | 8 000 |
| RFI/RFQ time (own) | n/a | n/a |
| Sample orders (10-15 sztuk total, 2-3 vendorów) | 3 000 | 12 000 |
| Sample shipping (DHL/UPS, courier from CN) | 500 | 2 000 |
| Lab equipment (jeśli nie mamy: spectrum analyzer, RF chamber rental) | 2 000 | 15 000 |
| Lab evaluation time (own) | n/a | n/a |
| Pilot batch (100-200 sztuk) | 30 000 | 120 000 |
| Pilot shipping + customs (EU import) | 1 500 | 5 000 |
| Certification (if not vendor-provided): CE/EU RED testing | 5 000 | 15 000 |
| **TOTAL Stage 1** | **45 000** | **177 000** |

**Wholesale cost per unit estimate** (pilot 100-200 sztuk): EUR 200-500/sztuka w zależności od specs (5G modem to większość kosztu). To 2-3× ceny GL.iNet Puli AX retail (~EUR 350-450), ale uzyskujesz full firmware control + branding.

---

## 9. Specyficzne wymagania SYLION (do RFQ, po NDA)

Po podpisaniu NDA, dodać do RFQ:

- **Custom firmware build pipeline** zgodnie z `adr/ADR-router-phantom-001.md` warunek C3:
  - Vendor dostarcza ref OpenWrt build environment
  - Customer (SYLION) buduje i podpisuje firmware własnym HSM key
  - Vendor flashuje customer-signed firmware podczas production
  - Po wysyłce — Verified Boot z customer public key, bootloader locked
  
- **Hardware tamper evidence** (opcjonalnie, dla STATE tier):
  - Tamper-evident screws / seals
  - Chassis intrusion detection (digital switch)
  
- **Inventory provisioning fields** zgodnie z `shared/references/hardware-gates.md`:
  - Each unit zarejestrowany w SYLION inventory pre-shipment
  - Fields: model, serial, FW version, factory cert serial
  
- **Production transparency**:
  - Component sourcing list (BOM disclosure pod NDA)
  - Vendor change notice — 90 dni pre-change
  - End-of-life notification — 12 mc pre-EOL

---

## 10. Co po Stage 1

Stage 2 — Customer Demand & Volume Increase (Year 2):

- Pilot field deployment confirms hardware reliability
- Customer feedback → spec refinement
- Volume scale 500-2000 sztuk
- Wybór primary supplier (1) + secondary (1 backup)

Stage 3 — Full Custom Design (jeśli volume uzasadnia):

- Własny PCB design (zlecenie do design house EU2/EU5)
- Banana Pi BPI-R4 lub równoważna platforma jako baseline
- Per-customer customization (np. STATE tier z anti-tamper)
- Volume 5000+ sztuk

Patrz `adr/ADR-router-baseline-002.md` §4.1 BoM hierarchy dla tier progression strategy.

---

## 11. HUMAN GATE / Decyzje do podjęcia

1. **Budget approval Stage 1** — EUR 45-177k bracket; akceptujemy upper bound jako risk buffer?
2. **Legal counsel** dla NDA drafting (każdy vendor ma swój template, lepiej mieć własny baseline)
3. **Lab facility** — czy mamy spectrum analyzer / RF testing, czy wynajmujemy
4. **Procurement lead** — kto prowadzi rozmowy techniczne (CTO?), kto commercial (CFO?)
5. **Branding** — czy custom unit ma SYLION brand visible, czy white-label
6. **Geographic preference** — gdyby przyszło wybierać 1 supplier: PL (EU jurisdiction) vs CN (cost) — który wins
7. **Vendor diversity policy** — single supplier + risk lub dual EU+CN supplier always

---

## 12. Next concrete actions (po zatwierdzeniu tego runbooka)

```
[ ] Step 1.1: Confirm budget bracket z CFO (HUMAN GATE)
[ ] Step 1.2: Engage Legal counsel dla NDA template (HUMAN GATE)
[ ] Step 1.3: Setup vendor contact spreadsheet z 12-14 vendorów z §2
[ ] Step 1.4: Send RFI emails parallel (Week 1)
[ ] Step 1.5: Weekly status review (Week 2-4)
[ ] Step 1.6: NDA sign z 3-5 finalist (Week 4-6)
[ ] Step 1.7: Detailed RFQ send (Week 6-10)
[ ] Step 1.8: Sample order decision z 2-3 finalist (Week 14-18)
[ ] Step 1.9: Lab evaluation T01-T10 (Week 18-24)
[ ] Step 1.10: Pilot production PO decision (Week 24+)
```

---

## Appendix A — Źródła

- [`adr/ADR-router-phantom-001.md`](../../adr/ADR-router-phantom-001.md) REVISED — Puli AX baseline + conditions C1-C11
- [`adr/ADR-router-baseline-002.md`](../../adr/ADR-router-baseline-002.md) §4 BoM hierarchy, §4.3 Watch list
- [`adr/ADR-002-router-cellular-identity-override.md`](../../adr/ADR-002-router-cellular-identity-override.md) — operational features (NIE w RFI scope)
- [`shared/references/hardware-gates.md`](../../shared/references/hardware-gates.md) Access Router Gates
- [`shared/references/legal-safety-boundaries.md`](../../shared/references/legal-safety-boundaries.md) §"Restricted Work"
- PHANTOM v3.0 §16 (Dopuszczalne/Niedopuszczalne routers)

## Appendix B — Useful platforms / directories

| Platforma | URL | Use case |
|---|---|---|
| Alibaba B2B | alibaba.com | główny CN sourcing, Trade Assurance escrow |
| Made-in-China | made-in-china.com | konkurencja do Alibaby |
| Global Sources | globalsources.com | premium tier CN, lepsza weryfikacja |
| HKTDC Sourcing | sourcing.hktdc.com | Hong Kong-side, lepsza IP protection |
| Targi Hong Kong Electronics Fair | hktdc.com/event/hkelectronicsfairse | kwiecień + październik |
| MWC Barcelona | mwcbarcelona.com | luty/marzec, B2B networking |
| Targi IFE Warszawa | ife.pl | styczeń, lokalny PL B2B |
| LinkedIn search query | linkedin.com/search | "GM" + "ODM" + "cellular router" + "Shenzhen" lub "Poland" |
| EU directory | europages.com | EU B2B directory dla elektroniki |

## Appendix C — Co NIE robić

- ❌ Nie zaczynać od RFQ przed NDA (vendor poznał Twoje specs bez ochrony)
- ❌ Nie wysyłać PHANTOM `[A]` doc do producenta
- ❌ Nie akceptować vendor-supplied firmware bez review (możliwy backdoor)
- ❌ Nie kupować pre-production samples za cenę pełnej production (vendor scam)
- ❌ Nie podpisywać NDA z exclusivity clause — to lock-in
- ❌ Nie commit do mass production przed lab T01-T10 pass
- ❌ Nie ujawniać dokładnego volume Stage 2/3 w RFI (negocjacja leverage)
- ❌ Nie używać prywatnych emaili (gmail/yahoo) — sygnalizuje brak professionalizmu
- ❌ Nie wysyłać RFI z polskiej domeny `gov.pl` — sugeruje government use → niektóre CN vendors odmówią z powodu sankcji
