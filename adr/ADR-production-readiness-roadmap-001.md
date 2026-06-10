# ADR-production-readiness-roadmap-001 — Roadmapa do produkcji wg Księgi 4.0

| Pole | Wartość |
|---|---|
| **Status** | `PROPOSED` — DRAFT, wymaga HUMAN GATE |
| **Data** | 2026-06-10 |
| **Autor draftu** | Claude (production-readiness analysis sprint) |
| **Wymagane podpisy** | Architect • CISO • Legal • Compliance |
| **Scope** | Cała platforma SYLION: ścieżka od obecnego control-plane do certyfikowalnego baseline produkcyjnego STANDARD |
| **Źródło wymagań** | `docs/ksiega-4-0-full/KSIEGA_4_0_FULL_BASELINE_SYLION_PHANTOM.pdf` (Rozdz. 1, 2, 3.3-3.6, 26, 33-36, 38-39, 42-43, 47, 52-57) |
| **Powiązane** | `shared/references/findings-roadmap.md` • ADR-worm-audit-001 (F-19) • ADR-vault-adapter-001 (F-25/F-34) • ADR-router-baseline-002 (F-1) • ADR-g2-session-broker-001 • ADR-terminal-modes-001 • `human-gate-policy.md` |

---

## 1. Problem i kontekst

Użytkownik chce doprowadzić SYLION do **wersji produkcyjnej**. Księga 4.0 (Rozdz. 1.4-1.6) definiuje twardą poprzeczkę:

> *„Każde wdrożenie produkcyjne SYLION musi spełniać 100% wymagań baseline. Nie istnieje mechanizm częściowej zgodności — niespełnienie dowolnego wymagania [N] blokuje certyfikację."*

To oznacza, że „dojście do produkcji" jest **programem inżyniersko-compliance'owym**, a nie zmianą flagi. Invariant `productionExecutionAllowed = false` jest egzekwowany uniwersalnie ([releaseControlService.js:828,874](../services/admin-api/src/modules/release/releaseControlService.js)) i może zostać zmieniony **wyłącznie** decyzją Architect + CISO + Legal + Compliance po dowodzie 100% zgodności [N] (per `CLAUDE.md` hard invariant + `human-gate-policy.md`).

**Stan wyjściowy (2026-06-10):** repo to dojrzała warstwa **control-plane / governance** (admin-api: 25+ modułów, ~26K LOC, 305 testów; panele admin/operator/customer; release gates; audyt; live execution scripts). Realny baseline [N] wymaga jednak twardej infrastruktury bezpieczeństwa, która dziś jest *metadata-only / symulowana / env-gated*.

## 2. Macierz luk: wymaganie [N] → bramka → stan → faza → owner

| Wymaganie [N] (Księga) | Release gate | Stan dziś | Faza | Owner | HUMAN GATE |
|---|---|---|---|---|---|
| HSM FIPS 140-2/3 + PKI (KS-HSM-1, KS-PKI-2, KS-KEYROT-5) | `gate_pki_hsm` blocked | `pkiService` metadata-only, brak HSM | 2 | Security | ✅ |
| Audit WORM (pochodna HSM/HMAC) — F-19 | audit integrity | sam sha256 | 1→2 | Security/CISO | ✅ |
| Secret backend Vault/KMS — F-25, rotacja F-34 | `gate_provider_mutation` | `EnvSecretProvider` env-backed | 1 | Platform/Security | ✅ (prod) |
| Firecracker per-tier izolacja (KS-WKL-1, KS-WORKLOAD-ISOLATION-3/4/5) | `gate_firecracker` blocked | realny microVM jest, ale per-tier (Podman→FC→SEV-SNP) i bramka nie egzekwowane | 2 | Platform | ✅ |
| Confidential computing SEV-SNP/TDX + attestation (KS-WORKLOAD-ISOLATION-5) | `gate_cpu_confidential` partial | attestation niezintegrowana (tier STATE) | 3 | Platform Security | ✅ |
| Router firmware signing Ed25519 + reproducible builds (KS-ROUTER-4) | `gate_router_puli_ax` partial | pipeline brak; baseline ADR PROPOSED (F-1) | 2 | Hardware | ✅ |
| GrapheneOS image build pipeline | `gate_graphene_image` blocked | pipeline nie istnieje | 2 | Mobile | ✅ |
| CDR realny (AV+magic-bytes+mat2+DocBleach/OPSWAT, KS-CDR-*) | `gate_cdr` „implemented" | `cdrService` 188 LOC — prawdopodobnie polityka, nie disarm | 1 | Security | częśc. |
| IPsec IKEv2 wszędzie, CNSA 2.0 (KS-IPSEC-1, KS-ROUTER-5, KS-G1-*) | — | G1 responder realny (strongSwan); mesh + rotacja cert niepełne | 2-3 | Platform/Crypto | ✅ |
| OPA/Rego policy engine (KS-G2-2, API-OPA-30) | — | brak; RBAC custom | 1 | Platform | ➖ |
| mTLS service mesh + OIDC/OAuth2 (API-MTLS-27, API-OAUTH2-25/26) | — | WebAuthn-sim + custom auth; brak OIDC providera | 1-2 | Platform/Security | ➖→✅ |
| Matrix homeserver E2EE + federacja allowlist (KS-MATRIX-*) | — | `matrixServerService` 60 LOC metadata; komunikatory jako workloady, nie Matrix | 2 | Platform | ✅ |
| Immutable infra / IaC, no-SSH-to-prod (KS-INFRA-1) | — | `infrastructure/terraform` częściowo | 2-4 | SRE | ➖ |
| Portal publiczny na osobnym VPS (KS-PORTAL-1) | — | `services/public-portal` + deploy — najbliżej zgodności | 1 | Platform | ➖ |
| Factual testing (KS-TEST-1) | — | pixel-regression + workload runners — zgodne | ✅ | QA | ➖ |
| PHANTOM `[A]` nie odblokowuje execution (KS-PHAN-1) | `gate_phantom_v3` review | invariant egzekwowany, gate nie może przejść w verified | — | Legal/CISO/Architect | ✅ |
| Spójność env-gate vs release-gate — F-35 | — | dwa rozłączne systemy kontroli | 1 | Platform/Architect | ➖ |

## 3. Fazowanie

Faza dobrana pod **tier STANDARD** (minimalny certyfikowalny baseline). PRO/STATE (HSM per-operator, SEV-SNP/TDX, PQC CNSA 2.0, bare-metal, rezydencja) to nadbudowa po STANDARD.

### Faza 0 — Fundament governance + reconcile *(w toku / częściowo zrobione)*
- ✅ Control-plane, panele, release gates, audyt, factual test harness
- ✅ Higiena repo, ESLint/Prettier/CI lint, gitleaks (sprint optymalizacji)
- ✅ Ten ADR + `findings-roadmap.md` + aktualizacja `IMPLEMENTATION_STATUS.md` (F-18)
- ⬜ CODEOWNERS realne team slugs (F-15/F-16 prereq); branch protection + signed commits

### Faza 1 — Software trust foundation *(większość bez zakupów, część HUMAN GATE na prod)*
1. **F-25 Phase A** — Vault OSS adapter pod `EnvSecretProvider` (za feature flagiem), integration test
2. **F-34** — rotacja tokenów: TTL, scheduler, renewal, revocation list, audit events
3. **F-19 Phase A** — HMAC audit chain (klucz w Vault transit) + fix kanonizacji (F-20)
4. **F-35** — ujednolicenie kontroli: release gate autorytatywny, env-flag jako pochodna
5. **OPA/Rego** policy engine (admission + per-operation) zamiast/obok custom RBAC
6. **OIDC provider** + mTLS service-to-service (krótkоterminowe certy z Vault PKI)
7. **CDR realny** — weryfikacja stanu `cdrService`, integracja ClamAV + magic-bytes + mat2 + DocBleach (STANDARD)

### Faza 2 — Hardware / infra trust *(zakupy + HUMAN GATE)*
1. **HSM** procurement + integracja (`gate_pki_hsm`) → odblokowuje F-19 Phase B, PKI real signing
2. **Firecracker** per-tier qualification + egzekwowanie bramki (`gate_firecracker`): Podman STANDARD / FC PRO
3. **Router firmware signing** pipeline Ed25519 + reproducible builds (`gate_router_puli_ax`); finalizacja ADR-router-baseline-002 (F-1)
4. **GrapheneOS image** build pipeline (`gate_graphene_image`)
5. **Matrix** homeserver (Synapse/Dendrite) E2EE + federacja allowlist + retencja
6. **Immutable infra** — pełny destroy-rebuild IaC, no-SSH-to-prod posture

### Faza 3 — Live path hardening na realnym sprzęcie (Puli AX + Pixel)
1. Domknięcie blokerów z artefaktów: WAN/cellular uplink, SSH key provisioning, **HTTP 302 na workloadach**, automatyzacja instalacji CA na GrapheneOS
2. End-to-end factual: Pixel → Puli AX → G1 → G2 → workload, kill switch, DNS leak, IPsec SA established
3. Confidential computing attestation (`gate_cpu_confidential`) — tier STATE
4. RF/SIM/IMEI pozostają **lab-only governance** (KS-RFLAB-1) — bez executorów produktu

### Faza 4 — Compliance & certyfikacja
1. **SML-3** dla każdego komponentu baseline (min. 3 miesiące doświadczenia produkcyjnego, pentest, IR/DR runbooks) — KS-SML-1
2. Evidence ISO 27001 / SOC 2 / NIS2 / DORA; audit-ready continuous (KS 9.4)
3. SLA/SLO/error budget governance (API-SLA-35, API-SLO-36)

### Faza 5 — **Production unlock decision** *(HUMAN GATE — nieprzekraczalny)*
- Atestacja 100% zgodności [N] przez Architect + CISO + Legal + Compliance
- Dopiero wtedy `productionExecutionAllowed` może zostać podniesione — **per-deployment, przez release control, nie globalnie w kodzie**
- PHANTOM `[A]` pozostaje poza certifiable core nawet po unlocku (KS-PHAN-1)

## 4. Co model MOŻE, a czego NIE MOŻE (per human-gate-policy.md)

**MOŻE:** spisać tę roadmapę, implementować Fazę 1 software za feature flagami (domyślnie OFF), pisać testy/ADR drafty, uruchamiać read-only weryfikację sprzętu (smoke/preflight), proponować opcje z evidence.

**NIE MOŻE:** zmieniać `productionExecutionAllowed`, oznaczać `gate_*` jako `verified` bez evidence + sign-off, claimować zgodności [N] bez dowodu, integrować realnego HSM/crypto/baseline na niekompletnym evidence, zamieniać PHANTOM `[A]` w kroki wykonawcze, fabrykować speców/cytatów/wyników.

## 5. Konsekwencje

**Pozytywne:** jeden autorytatywny plan z traceability [N]→gate→owner; rozdzielenie pracy software (Faza 1, robocza teraz) od hardware/compliance (HUMAN GATE); zachowanie wszystkich invariantów.

**Negatywne / koszt:** Faza 2-4 wymaga zakupów (HSM, sprzęt), wielu zespołów i ≥3 miesięcy doświadczenia produkcyjnego per komponent (SML-3). Produkcja STANDARD jest realnie wielokwartałowa; PRO/STATE dalej.

**Ryzyko:** próba skrótu (flip flagi bez 100% [N]) = naruszenie hard invariantu i utrata certyfikowalności — explicite zakazane.

## 6. Decyzja

`HUMAN GATE REQUIRED` — niniejszy ADR jest **draftem roadmapy**. Wymaga przeglądu i podpisu Architect + CISO + Legal + Compliance, którzy zatwierdzają fazowanie, ownerów i kryteria wejścia w Fazę 5. Do tego czasu zespół realizuje **Fazę 1 (software, feature-flagged OFF)** i Fazę 0 reconcile, bez dotykania invariantów.
