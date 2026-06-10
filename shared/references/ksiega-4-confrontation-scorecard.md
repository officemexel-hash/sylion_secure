# SYLION — Scorecard konfrontacji z Księgą 4.0

> Uczciwy przegląd zgodności z wymaganiami **[N]** Księgi 4.0 (baseline produkcyjny STANDARD).
> Nie jest claimem produkcyjności. `productionExecutionAllowed = false` pozostaje; unlock to HUMAN GATE
> (Architect + CISO + Legal + Compliance) po dowodzie **100% [N]** (Księga 1.4-1.6).

| Pole | Wartość |
|---|---|
| **Data** | 2026-06-10 |
| **Powiązane** | `adr/ADR-production-readiness-roadmap-001.md` • `findings-roadmap.md` • Księga 4.0 Rozdz. 1,2,33-47,52-57 |
| **Legenda** | ✅ zweryfikowane • 🟢 gotowe software (flagged/scaffolding) • 🟡 częściowe • 🔴 luka (infra/procurement) • 🔒 HUMAN GATE |

## 1. Status per wymaganie [N]

| Wymaganie [N] (Księga) | Status | Evidence / uwaga |
|---|---|---|
| Thin client, brak danych roboczych na terminalu (KS-TERM-1) | ✅ | Pixel: brak default route poza LAN, metadata-only policy w runnerach |
| IPsec IKEv2 do G1, cipher CNSA (KS-IPSEC-1, KS-ROUTER-5) | ✅ | **Na żywo:** SA ESTABLISHED, `AES_GCM_16-256/SHA-384/ECP-384` |
| Kill switch nftables (KS-ROUTER-6) | ✅ | **Na żywo:** `inet sylion_killswitch` policy drop in/fwd/out |
| G1/G2 per operator, strefa 2 osiągalna (KS-G1-*, KS-G2-*) | ✅ | **Na żywo:** Pixel→G1 `10.42.0.11` 3/3, G2 `10.42.0.12` 3/3 (~60-90ms) |
| Factual testing człowiek/ADB (KS-TEST-1) | ✅ | pixel-regression, workload runners, end-to-end ping z Pixela |
| Portal publiczny na osobnym VPS (KS-PORTAL-1) | ✅ | `services/public-portal` + allowlist proxy (test public-portal-split) |
| Panel admin blue-team / panel operatora (KS-ADMIN-1, KS-OPERATOR-1) | ✅ | admin-web + operator-web, 334 testów |
| Audit hash chain integrity (KS-AUDIT-TRANSFERS-1) | 🟢 | F-20 bug naprawiony (chain obejmuje pełną treść); F-19 HMAC za flagą; **WORM pending** (Vault transit, nie HSM) |
| Rotacja kluczy/tokenów progi (KS-KEYROT-5) | 🟢 | F-34: `evaluateRotation` WARN 14d/HIGH 7d/CRITICAL 1d — **zgodne z Księgą**; scheduler realny pending |
| Secret backend Vault (KS-VAULT-6) | 🟢/🔒 | **F-25: realny adapter HTTP** (KV v2 + Transit HMAC + AppRole), flagged `SYLION_SECRET_BACKEND=vault`, test na mock-serwerze; brakuje uruchomionego Vault OSS + async-wiring live path; **sealing HSM = ostatni krok** |
| Workload Firecracker microVM (KS-WKL-1, KS-WORKLOAD-ISOLATION-4) | 🟡 | realny microVM uruchamiany (skrypty); **per-tier (Podman/FC/SEV-SNP) + gate enforcement** niepełne |
| CDR realny (KS-CDR-*: AV+magic-bytes+mat2+disarm) | 🔴 | `cdrService` to polityka/metadata; brak ClamAV/DocBleach/OPSWAT — duża luka |
| Matrix homeserver E2EE + federacja (KS-MATRIX-*) | 🔴 | `matrixServerService` 60 LOC metadata; komunikatory jako workloady, nie Matrix — brak Synapse/Dendrite |
| OPA/Rego policy engine (KS-G2-2, API-OPA-30) | 🟢 | **adapter `opaPolicyProvider` + `sylion-authz.rego`** flagged `SYLION_AUTHZ_ENGINE` (default rbac); brakuje uruchomionego OPA + pełnego portu ROLE_PERMISSIONS do Rego + enforcement (HUMAN GATE) |
| OIDC (API-OIDC-26, API-JWT-28) | 🟢 | **`oidcTokenVerifier`** (JWKS, RS/PS/ES/EdDSA, anty alg:none/key-confusion) flagged `SYLION_AUTH_OIDC` (default off); brakuje realnego IdP + wiring login path |
| mTLS service mesh (API-MTLS-27) | 🔴 | brak Envoy/SPIFFE mesh — wymaga deploymentu |
| Immutable infra / IaC, no-SSH-to-prod (KS-INFRA-1) | 🟡 | `infrastructure/terraform` częściowo; pełny destroy-rebuild niepełny |
| Confidential computing SEV-SNP/TDX + attestation (KS-WORKLOAD-ISOLATION-5) | 🔴/🔒 | tier STATE; attestation niezintegrowana |
| Router firmware signing Ed25519 + OpenWrt 23.05+ (KS-ROUTER-3,4) | 🔴/🔒 | **F-36: router na OpenWrt 21.02** (<23.05); pipeline signing brak |
| GrapheneOS image build pipeline | 🔴/🔒 | pipeline nie istnieje |
| **HSM FIPS 140-2/3 + PKI root (KS-HSM-1, KS-PKI-2)** | 🔒 **OSTATNI** | decyzja owner: HSM na sam koniec; `pkiService` metadata-only |
| **YubiKey/FIDO2 fizyczny enrollment (KS-G2-5)** | 🔒 **OSTATNI** | polityki FIDO2 gotowe software; fizyczne klucze na koniec z HSM |
| PHANTOM `[A]` nie odblokowuje execution (KS-PHAN-1) | ✅ | invariant egzekwowany; `gate_phantom_v3` nie może przejść w verified |
| RF/SIM/IMEI lab-only (KS-RFLAB-1) | ✅ | governance-only, rawIdentifiersForbidden, brak executorów produktu |

## 2. Podsumowanie liczbowe (orientacyjne)

- ✅ Zweryfikowane (w tym na żywym sprzęcie): **transport + zone model + factual testing + portal/panele + PHANTOM/RF boundary** — rdzeń strefowy działa.
- 🟢 Gotowe software (Faza 1, flagged): audit HMAC, rotacja, vault skeleton.
- 🔴 Realne luki wymagające infrastruktury/integracji (nie „dopisania kodu"): **CDR, Matrix homeserver, OPA, OIDC/mTLS, Firecracker per-tier, immutable infra**.
- 🔒 HUMAN GATE + sprzęt: confidential computing, router firmware signing (+OpenWrt 23.05), GrapheneOS pipeline, **HSM + YubiKey (ostatnie)**.

## 3. Uczciwa konkluzja

Rdzeń **transportowo-strefowy SYLION jest zweryfikowany jako działający na realnym sprzęcie**
(Pixel 9 Pro → Puli AX GL-XE3000 → IPsec CNSA → G1/G2, kill switch aktywny). Warstwa control-plane/
governance jest dojrzała (334 testy). Software'owe fundamenty zaufania (audit integrity fix, HMAC,
rotacja, vault selektor) są gotowe za flagami.

Do **certyfikowalnego baseline STANDARD** (100% [N]) brakuje jednak elementów, które są **projektami
infrastrukturalnymi, nie zmianami w kodzie**: realny CDR (silniki AV/disarm), Matrix homeserver,
OPA/OIDC/mTLS mesh, Firecracker per-tier z attestacją, immutable infra, oraz — jako **ostatni krok per
decyzja owner** — HSM i fizyczny YubiKey. Każdy z nich wymaga deploymentu realnych usług i części z nich
HUMAN GATE. Żaden `gate_*` nie został oznaczony jako `verified`; `productionExecutionAllowed` pozostaje
`false`. To jest stan faktyczny — bez claimu produkcyjności na wyrost.
