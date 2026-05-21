# ADR-cloud-provider-001 — Wybór Hetzner i OVH jako baseline cloud providers

| Pole | Wartość |
|---|---|
| **Status** | `PROPOSED` — DRAFT, wymaga HUMAN GATE |
| **Data** | 2026-05-21 |
| **Autor draftu** | Claude (audit agent) |
| **Wymagane podpisy** | Architect • CISO • Legal • Compliance |
| **Scope** | Wybór cloud providers dla baseline `G1`, `G2`, `WORKLOAD` infrastruktury |
| **Powiązane** | Step 3.12 freeze (live execution gates) • Step 3.15 freeze (provider-generic route + OVH stub) • Step 3.16 freeze (Hetzner sandbox) • `releaseControlService.gate_provider_mutation` |

---

## 1. Kontekst

Step 3.12 wybrał **Hetzner** jako pierwszy live cloud adapter, bez ADR. Step 3.15 dodał **OVH** jako stub adapter (visible, blocked by `ovh_live_adapter_not_implemented`). Step 3.16 dodał real Hetzner sandbox operations (create / list / reconcile / rollback).

Decyzja architektoniczna **wpływa na**:
- Jurysdykcję danych operacyjnych (NIE communication content — patrz Thin Client + IPsec)
- Compliance scope (GDPR/NIS2/DORA dla baseline)
- Threat model — który adversary surface widzi nas (Analiza Zagrożeń §4.3)
- PHANTOM jurisdictional rotation (PHANTOM-6/12/24, ADR przyszły)
- Procurement i operational cost

Dziś brak udokumentowanego rationale.

## 2. Decyzja

**Hetzner (DE) i OVH (FR)** jako baseline cloud providers dla MVP / Stage 1 production. Multi-cloud architecture od początku, z możliwością rozszerzenia o dodatkowych providers (rotacja jurysdykcyjna).

| Provider | Jurysdykcja | Status |
|---|---|---|
| **Hetzner Cloud** | Niemcy (HQ Gunzenhausen, Bavaria) | Primary, live sandbox implementowany |
| **OVHcloud** | Francja (HQ Roubaix) | Secondary, stub adapter, implementacja Stage 2 |

## 3. Rozważone alternatywy

| Provider | Jurysdykcja HQ | Wynik | Uzasadnienie |
|---|---|---|---|
| **Hetzner** | DE 🇩🇪 | ✅ chosen | UE/EOG, GDPR-friendly, transparent ownership, brak udokumentowanych masowych nakazów intercept, competitive pricing, mature API, RAM-only VM support |
| **OVHcloud** | FR 🇫🇷 | ✅ chosen | UE/EOG, separate jurisdiction from Hetzner (dwa kraje = lepsza jurisdictional rotation), state-of-art OVHCloud datacenters, ISO 27001 + SOC 2 + HDS |
| **AWS** | US 🇺🇸 | rejected | CLOUD Act exposure, masowe nakazy intercept są precedensem (USA Patriot Act, FISA 702), per Analiza §4.3.1 |
| **Azure** | US 🇺🇸 | rejected | Tożsame uzasadnienie co AWS |
| **GCP** | US 🇺🇸 | rejected | Tożsame uzasadnienie co AWS |
| **DigitalOcean** | US 🇺🇸 | rejected | Tożsame jurisdictional concerns; HQ NYC |
| **Linode (Akamai)** | US 🇺🇸 | rejected | Tożsame; przejęty przez Akamai (US) |
| **Vultr** | US 🇺🇸 | rejected | Tożsame; HQ Florida |
| **Scaleway** | FR 🇫🇷 | considered | Mógłby być trzecim providerem przyszłości (multi-FR resilience). Aktualnie nie w MVP — zbędna powierzchnia API i koszt operacyjny |
| **UpCloud** | FI 🇫🇮 | considered | Stage 3 candidate — Finlandia jako dodatkowa jurysdykcja UE |
| **Exoscale** | CH 🇨🇭 | considered | Stage 3 candidate — Szwajcaria poza UE, dodaje jurisdictional diversity. Aktualnie nie w MVP |
| **Yandex Cloud** | RU 🇷🇺 | rejected | Rosja, niemożliwa transparentność, federalne nakazy intercept |
| **Alibaba Cloud** | CN 🇨🇳 | rejected | Chiny, MSS exposure, brak audytowalności |
| **Tencent Cloud** | CN 🇨🇳 | rejected | Tożsame jak Alibaba |

## 4. Analiza per provider

### 4.1 Hetzner Cloud

| Cecha | Wartość |
|---|---|
| Lokalizacja datacentrów | DE (Falkenstein, Nuremberg, Helsinki — FI też), FI, US (Ashburn, Hillsboro), Singapore |
| Lokalizacje stosowane | **wyłącznie EU**: `fsn1` (Falkenstein), `nbg1` (Nuremberg), `hel1` (Helsinki) — po `SYLION_LIVE_ALLOWED_REGIONS` allowlist |
| Compliance | ISO 27001:2017, ISO 50001 |
| API maturity | REST API, OpenAPI spec, Terraform provider, mature client libraries |
| Confidential computing | brak natywnej AMD SEV-SNP / Intel TDX exposure dla cloud VPS jako 2026-05 (sprawdzić przed unlock) |
| RAM-only / memory clearance | shutdown=immediate, brak persistent disk wymuszony przez SYLION konfigurację |
| Pricing model | per-hour + per-month, transparent |
| Audit / transparency | Hetzner publikuje rocznie transparency report (governmental data requests) |

**Residual risks:**
- BSI (German federal cybersecurity) może wymagać kooperacji per niemieckim TKG / TR-02102. Mitigated by: IPsec content encryption + Thin Client (brak operational data w VPS poza ramem).
- DE jurysdykcja jest częścią Five Eyes "third-party"-ish (NSA Memorandum of Understanding) per Analiza §3.1.

### 4.2 OVHcloud

| Cecha | Wartość |
|---|---|
| Lokalizacja datacentrów | FR (Roubaix, Strasbourg, Gravelines), CA (Beauharnois), DE (Limburg), PL (Warsaw), UK (London) |
| Lokalizacje stosowane | EU: `RBX`, `SBG`, `GRA`, `WAW` (Warsaw — extra jurisdiction option) |
| Compliance | ISO 27001, ISO 27017, ISO 27018, SOC 2 Type II, HDS (health data certified), PCI DSS |
| API maturity | OVH API v1/v2, OpenStack dla niektórych product lines |
| Confidential computing | OVH "Bare Metal" linia może być AMD SEV-SNP capable, sprawdzić przed unlock |
| RAM-only | jak Hetzner — wymuszone przez SYLION konfigurację |
| Pricing | per-hour + per-month |
| Audit | OVH publikuje transparency report rocznie |

**Residual risks:**
- FR jurysdykcja: France's Loi de Programmation Militaire (LPM) 2013 + Loi Renseignement 2015 — szeroka power do intercept, ale wymaga warrant. Mitigated tak jak DE.
- Roubaix fire incident 2021 (OVH SBG2) — pamiętać o backup strategy (multi-region multi-provider).

### 4.3 Multi-provider rationale

Dwa providerzy z **różnych jurysdykcji EU** (DE + FR) daje:
- **Jurisdictional resilience**: jeden government action na jednego providera nie przerwie usługi
- **PHANTOM rotation foundation**: PHANTOM v3.0 rotacja może chodzić między DE↔FR↔dodatkowe (Stage 3: FI/CH)
- **Avoid vendor lock-in**: provider-generic route w Step 3.15 jest tego rezultatem
- **Compliance breadth**: GDPR central (oba), DORA (oba EU/EEA), NIS2 (oba), HDS (OVH dodatkowo)

## 5. Decision factors

| Factor | Hetzner | OVH | AWS/GCP/Azure |
|---|---|---|---|
| EU jurysdykcja | ✅ DE | ✅ FR | ❌ US (data residency tylko w US-controlled regions) |
| CLOUD Act exposure | ❌ low (EU-only entity) | ❌ low | ⚠️ high |
| Transparency reports | ✅ rocznie | ✅ rocznie | ✅ ale CLOUD Act footprint |
| API maturity | ✅ | ✅ | ✅ (najmocniejsze) |
| Confidential computing native | ⚠️ TBD | ⚠️ TBD | ✅ (AWS Nitro, Azure DCsv3, GCP CC) |
| Pricing | ✅ niski koszt | ✅ konkurencyjny | ❌ wyższy + complexity |
| GDPR-by-default | ✅ | ✅ | ⚠️ wymaga Standard Contractual Clauses |
| Audit / certification breadth | ⚠️ średnia | ✅ wysoka (HDS, SOC 2) | ✅ największa |
| Strategic risk (US gov pressure) | ✅ low | ✅ low | ❌ high (FISA, CLOUD Act) |

**Trade-off przyjmowany:** odbieramy AWS/GCP/Azure breadth w certification i confidential computing-native dla **jurisdictional independence**. Confidential computing zaadresowany przez Step 3.12 CPU gate (Intel TDX / AMD SEV-SNP attestation) który działa **niezależnie od providera** (verified at host level).

## 6. Out-of-scope dla tego ADR (osobne decyzje)

- **PHANTOM jurisdictional rotation policy** — który zestaw providerów dla phantom-a profile, jaka kadencja per profile (PHANTOM-6/12/24). Wymaga osobnego ADR + Legal sign-off per jurysdykcja.
- **Provider for OEM/STATE tier** — jeśli klient żąda BYO-cloud lub on-prem, to inny scope.
- **Disaster recovery cross-provider** — schemat backup G1↔G2 między Hetzner ↔ OVH wymaga osobnego runbook.
- **HSM placement** — czy HSM jest u providera czy poza. ADR-vault-adapter-001 / ADR-hsm-001 to adresuje.

## 7. Konsekwencje

### 7.1 Pozytywne

- Closes F-26 (no ADR for cloud provider choice)
- Documented jurisdictional rationale
- Multi-cloud foundation (już zaimplementowany przez Step 3.15)
- GDPR/NIS2/DORA compliance footprint clear

### 7.2 Negatywne

- Brak confidential-computing-native u Hetzner i OVH (jako 2026-05) — Step 3.12 CPU gate must verify per host
- Mniejsza breadth certifications vs AWS/GCP/Azure (np. brak FedRAMP)
- Procurement complexity: dwa providerzy = dwa kontrakty, dwa SLA, dwa billing
- Hetzner/OVH ograniczają niektóre regions/products vs hyperscalerzy

### 7.3 Compliance

- Both providers in EU/EEA → GDPR Article 3 jurisdiction
- No CLOUD Act direct exposure (entities are EU)
- NIS2 essential entity classification potencjalna (oba mogą być w scope jako critical infra)
- HDS (OVH) opens optional healthcare data scope

## 8. Implementation status

| Step | Status |
|---|---|
| Step 3.12 | ✅ Hetzner adapter (gated, live sandbox) — `liveExecutionService.js` |
| Step 3.15 | ✅ Provider-generic route `/cloud/:providerKey/vps-set` — supports any registered provider |
| Step 3.15 | ✅ OVH stub `ovh_live_adapter_not_implemented` |
| Step 3.16 | ✅ EnvSecretProvider — token per provider, isolated |
| TBD | ⏳ OVH adapter implementation |
| TBD | ⏳ Cross-provider disaster recovery runbook |
| TBD | ⏳ Stage 3 — additional EU jurisdiction (UpCloud FI lub Exoscale CH) |

## 9. HUMAN GATE / Open items

1. **Hetzner contract & legal review** — DPA podpisany? GDPR Standard Contractual Clauses? Customer service-level agreement?
2. **OVH contract & legal review** — j.w.
3. **Confidential computing verification** — czy Hetzner/OVH mają audytowalne TDX/SEV-SNP attestation? Step 3.12 CPU gate ma to pokrywać per host, ale to wymaga provider co-operation
4. **Cross-provider DR strategy** — kto pisze runbook
5. **Stage 3 provider** — UpCloud (FI) vs Exoscale (CH) vs Scaleway (FR) — który dla 3-jurysdykcyjnej rotacji
6. **PHANTOM jurisdictional rotation policy** — osobny ADR, ale ten ADR daje podstawę (DE + FR)

## 10. Sign-off

| Rola | Nazwisko | Data | Decyzja | Komentarz |
|---|---|---|---|---|
| Architect | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| CISO | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Legal | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Compliance | _________ | ____ | ☐ approve ☐ reject ☐ changes | |

---

## Appendix A — Źródła

- `docs/admin-panel-v2/56-step3-12-implementation-freeze-live-execution-gates.md`
- `docs/admin-panel-v2/60-step3-15-implementation-freeze-live-provider-unlock.md`
- `docs/admin-panel-v2/61-step3-16-implementation-freeze-secrets-hetzner-sandbox.md`
- `SYLION-Analiza-Zagrozen-COMPLETE.pdf` §3.1 (hierarchia sojuszy wywiadowczych), §4.3 (warstwa cloud)
- `SYLION_PHANTOM_v3.0.docx` §6 (rotacja jurysdykcyjna)
- `services/admin-api/src/modules/live/liveExecutionService.js`
- Hetzner Cloud public docs (https://docs.hetzner.cloud/)
- OVHcloud public docs (https://help.ovhcloud.com/)
- Hetzner Transparency Reports (annual)
- OVH Transparency Reports (annual)
