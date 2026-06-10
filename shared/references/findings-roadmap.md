# SYLION — Findings Roadmap (single source of truth dla otwartych findings)

> Skonsolidowana macierz otwartych findings → ADR → faza → release gate → owner → status.
> Cel: jeden autorytatywny widok blokerów produkcyjnych, zasilający `releaseControlService` gates
> i audyty skilli. Zastępuje rozproszone referencje (F-19 tylko w ADR-worm-audit-001, F-25/F-34
> tylko w ADR-vault-adapter-001, reszta w session transcripts).

| Pole | Wartość |
|---|---|
| **Status** | `LIVING` — aktualizowany przy każdej zmianie statusu findingu |
| **Data utworzenia** | 2026-06-10 |
| **Autor** | Claude (optymalizacja + production-readiness sprint) |
| **Powiązane** | `adr/ADR-production-readiness-roadmap-001.md` • `adr/ADR-worm-audit-001.md` • `adr/ADR-vault-adapter-001.md` • `services/admin-api/IMPLEMENTATION_STATUS.md` • `human-gate-policy.md` |

---

## 1. Macierz findings (blokery produkcyjne i jakościowe)

| Finding | Opis | Blokuje gate | ADR | Faza | Owner | HUMAN GATE | Status |
|---|---|---|---|---|---|---|---|
| **F-19** | Audit hash chain to sam sha256 — brak WORM (HMAC/HSM lub external anchor) | `gate_pki_hsm`, audit integrity | [ADR-worm-audit-001](../../adr/ADR-worm-audit-001.md) | A (HMAC), B (Rekor/HSM) | CISO • Security • Compliance • Architect | ✅ | OPEN |
| **F-20** | Niestabilna kanonizacja JSON w hash chain | — | ADR-worm-audit-001 §5 | A | Security | ➖ | OPEN |
| **F-25** | Vault/KMS/HSM backend dla `EnvSecretProvider` — interfejs gotowy, env-backed | `gate_provider_mutation`, `gate_pki_hsm` | [ADR-vault-adapter-001](../../adr/ADR-vault-adapter-001.md) | A (Vault OSS), B (HSM unseal) | CISO • Platform • Security • Architect | ✅ | OPEN |
| **F-34** | Brak polityki rotacji tokenów (TTL, scheduler, renewal, revocation) | `gate_provider_mutation` | ADR-vault-adapter-001 §F4 | A (Vault TTL), B | Platform • Security | ➖ (software) → ✅ (prod) | OPEN |
| **F-31** | Brak provider rate-limit / backoff | `gate_provider_mutation` | — | A | SRE | ➖ | OPEN |
| **F-32** | Brak persistent reconciliation history | — | — | A | SRE | ➖ | OPEN |
| **F-15** | Brak branch protection na `main` | release process | — | — | Repo Admin | ✅ | OPEN |
| **F-16** | Brak wymuszonych signed commits | release process | — | — | Repo Admin | ✅ | OPEN |
| **F-17** | Brak LICENSE | — | — | — | Legal | ➖ | RESOLVED |
| **F-18** | `IMPLEMENTATION_STATUS.md` stale (Step 3.16/77 testów) | — | — | — | Dev | ➖ | RESOLVED 2026-06-10 |
| **F-1** | Router baseline conflict (Puli AX vs Beryl AX vs Mudi v2) | `gate_router_puli_ax` | [ADR-router-baseline-002](../../adr/ADR-router-baseline-002.md) | hardware | Architect • CISO • Doc Owner | ✅ | OPEN (ADR PROPOSED) |
| **F-2** | Mudi v2 inconsistency w Analizie Zagrożeń | doc consistency | ADR-router-baseline-002 | hardware | Doc Owner | ➖ | OPEN |

Legenda statusu: OPEN · RESOLVED · IN_PROGRESS. HUMAN GATE: ✅ wymagany · ➖ nie wymagany (lub tylko four-eyes operacyjny).

## 2. Nowy finding z tego sprintu

| Finding | Opis | Blokuje | Faza | Owner | Status |
|---|---|---|---|---|---|
| **F-35** | Dwa rozłączne systemy kontroli live: env-flagi (`SYLION_OPERATOR_LIVE_WORKLOAD_RUNNER_ENABLED` + fraza `RUN_LIVE_WORKLOAD_RECREATE` + `SYLION_ALLOW_WORKLOAD_WIPE` + four-eyes) realnie bramkują wykonanie, niezależnie od `releaseControlService` gates i invariantu `productionExecutionAllowed`. To drugie jest dziś invariantem **raportowym/governance**, nie egzekwującym. Dla produkcji oba systemy trzeba ujednolicić (release gate jako autorytatywne źródło, env-flag jako jego pochodna). | spójność kontroli | 1 | Platform • Architect | OPEN |

**Uwaga (zweryfikowane 2026-06-10):** ścieżka `executeWorkloadControlRequest` **NIE jest** otwartą dziurą — jest bramkowana env-flagiem + frazą potwierdzającą + four-eyes dla wipe + audytem na każdym kroku ([operatorPortalService.js:1099-1235](../../services/admin-api/src/modules/operatorPortal/operatorPortalService.js)). F-35 to dług architektoniczny (rozjazd dwóch płaszczyzn kontroli), nie luka bezpieczeństwa.

## 2b. Live evidence Puli AX (2026-06-10, read-only SSH, GL-XE3000)

Diagnostyka na żywym routerze (key-auth, bez mutacji). **Pozytywne — transport działa:**

| Wymaganie [N] | Stan na sprzęcie | Evidence |
|---|---|---|
| IPsec IKEv2 do G1 (KS-ROUTER-5, KS-IPSEC-1) | ✅ **ESTABLISHED** (`router.OP-001@sylion.internal … g1.sylion.internal`), tunel `10.43.0.2/32 === 10.42.0.0/24` | `swanctl --list-sas` |
| Cipher CNSA 2.0 (KS-ROUTER-5, KS-ROUTER-11) | ✅ `AES_GCM_16-256 / PRF_HMAC_SHA2_384 / ECP_384`, ESP `AES_GCM_16-256/ECP_384` | `swanctl` |
| Kill switch nftables (KS-ROUTER-6) | ✅ `table inet sylion_killswitch`, policy drop input/forward/output; forward `br-lan ↔ 10.42.0.0/16` dozwolony; output DNS→`10.42.0.11:53`, IKE 500/4500, NTP | `nft list table inet sylion_killswitch` |
| strongSwan full (KS-ROUTER-3) | ✅ strongSwan 5.9.2-full | `opkg list-installed` |

**End-to-end z Pixela (2026-06-10, Pixel 9 Pro / GrapheneOS, klient LAN `192.168.8.175`):**

| Test | Wynik | Znaczenie |
|---|---|---|
| ping G1 internal DNS `10.42.0.11` | ✅ **3/3, ~60ms RTT** | Pixel → Puli AX → IPsec → G1 **działa** (KS-TEST-1 factual) |
| ping G2 broker `10.42.0.12` | ✅ **3/3, ~89ms** | strefa G2 osiągalna przez tunel |
| ping `10.42.0.10` | ✅ 2/2 | strefa G1 osiągalna |
| ping workload `10.44.0.13` | ❌ 0/2 | oczekiwane — TS tunelu to tylko `10.42.0.0/24`; workloady przez G2 broker |
| default route Pixela | brak poza `192.168.8.0/24` | Pixel rozmawia wyłącznie z siecią SYLION (postura kill-switch) |

→ **Korekta:** data-plane Pixel→router→G1/G2 jest **zweryfikowany jako działający**. Wcześniejszy
brak odpowiedzi dotyczył ruchu źródłowanego przez sam router (`10.43.0.2`), nie ścieżki klienta LAN.

**Luki / do domknięcia:**
- ⚠️ Osiągalność **workloadów** (`10.44.0.0`) przez G2 session broker — do weryfikacji factual (uruchomiony workload + handoff).
- ⚠️ Uplink przez **wwan/Wi-Fi** (`apclix0`, default via `192.168.6.1`), port WAN eth0 down — OK dla lab, produkcja oczekuje zdefiniowanego uplinku. (Smoke `puli-ax-physical-smoke` fałszywie raportuje `wan_not_ready` bo sprawdza eth0, nie wwan — kandydat na fix skryptu.)

| **F-36** | OpenWrt **21.02-SNAPSHOT** na Puli AX (GL-XE3000) — Księga 4.0 KS-ROUTER-3 wymaga **OpenWrt 23.05+**. Firmware poniżej bramki. | `gate_router_puli_ax` | hardware (firmware) | Hardware | OPEN |

## 3. Zależności blokad

```
F-25 (Vault) ──► F-34 (rotacja przez Vault TTL)
            └──► F-19 Phase B (HMAC key custody w Vault/HSM)
F-25 + F-19 ──► gate_pki_hsm ──► gate_provider_mutation ──► live cloud production
F-1 (router baseline ADR) ──► gate_router_puli_ax ──► firmware signing pipeline
```

Krytyczna ścieżka do `gate_pki_hsm`: **F-25 Phase A (Vault OSS) → F-19 Phase A (HMAC) → F-34 (rotacja) → integracja realnego HSM (Phase B) → HUMAN GATE Security**.
