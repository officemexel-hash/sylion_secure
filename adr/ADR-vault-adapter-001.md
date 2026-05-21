# ADR-vault-adapter-001 — Vault / KMS / HSM backend dla `EnvSecretProvider`

| Pole | Wartość |
|---|---|
| **Status** | `DECISION PENDING` — options analysis, wymaga choice + HUMAN GATE |
| **Data** | 2026-05-21 |
| **Autor draftu** | Claude (audit agent) |
| **Wymagane podpisy** | CISO • Platform Lead • Security • Architect |
| **Scope** | Backend implementation dla `EnvSecretProvider` interface (Step 3.16). Provider tokens, eventual: PKI keys, audit chain HMAC keys, IPsec cert authority |
| **Powiązane** | Step 3.16 freeze • `services/admin-api/src/modules/secrets/secretManagerService.js` • ADR-worm-audit-001 (HMAC key custody) • ADR-cloud-provider-001 |

---

## 1. Problem

Step 3.16 wprowadził `EnvSecretProvider`:

```javascript
// services/admin-api/src/modules/secrets/secretManagerService.js (przybliżenie)
class EnvSecretProvider {
  resolveProviderToken(providerKey) { return process.env[`${providerKey.toUpperCase()}_API_TOKEN`]; }
  isConfigured(providerKey) { return Boolean(this.resolveProviderToken(providerKey)); }
}
```

Token nie wycieka (test coverage potwierdza), ale **backend = environment variable**. Step 3.16 §"Remaining Work":

> *Replace ENV provider with Vault/KMS/HSM-backed provider for production.*

Wybór backendu wpływa na:
- Token rotation enforcement (F-34 finding)
- Audit "kto, kiedy, jak długo używał klucza"
- Compliance scope (FIPS / CNSA / Common Criteria certifications)
- Operational cost (licensing, infrastructure)
- HSM placement (cloud-side vs on-prem vs hybrid)

## 2. Wymagania funkcjonalne

| Req | Opis | Source |
|---|---|---|
| F1 | Resolve provider token per provider key (Hetzner, OVH, etc.) | Step 3.16 |
| F2 | Token nigdy nie zwracany w API response, audit event, log | Step 3.16 invariant |
| F3 | Audit każdego dostępu do tokena (who, when, which token) | `human-gate-policy.md` |
| F4 | Token rotation API (per-token, scheduled, on-demand) | F-34 finding |
| F5 | Sign / encrypt operations bez wyciągania klucza poza vault | `sylion-crypto-pki-pqc` skill |
| F6 | Access control granular: konkretni operatorzy → konkretne tokens | RBAC integration |
| F7 | Break-glass procedure dla audit chain HMAC key (ADR-worm-audit-001) | DR |
| F8 | Audit log integrity (tamper-evident, signed) | `sylion-ops-sre-incident-response` |
| F9 | Multi-region HA + DR | Production |
| F10 | FIPS 140-2/3 cert (target) lub Common Criteria EAL4+ | Compliance |
| F11 | Programmatic API + IaC support (Terraform / similar) | Platform |
| F12 | Offline / air-gapped audit (kto miał root w vault?) | High-assurance |

## 3. Rozważone backendy

### 3.1 HashiCorp Vault (Open Source lub Enterprise)

| Cecha | Wartość |
|---|---|
| Backend storage | Consul / etcd / file / Postgres / S3 |
| Auth methods | AppRole, JWT, Kubernetes SA, cert, OIDC, AWS IAM, GitHub, ldap |
| Crypto | Built-in transit engine (encrypt/decrypt without key exposure), PKI engine |
| Token lifecycle | TTL + renewal, leases, revocation |
| Audit | File audit device, syslog, socket — append-only |
| HA | Built-in Raft consensus / Consul backend |
| FIPS | Vault Enterprise + HSM auto-unseal + transit FIPS-validated 140-2 |
| Cost | OSS free; Enterprise ~$$ per node + seal HSM |
| SYLION fit | ✅ Wszystko F1-F12. Mature ecosystem, Terraform provider, dobra dokumentacja |
| Operational burden | średni — wymaga zarządzania klastrem, unseal procedure, backups |

**Plus:** mature, open source baseline, Vault Enterprise opcja gdy compliance breath wymagana, można self-host EU jurisdiction (Hetzner / OVH bare metal).

**Minus:** vendor relationship z HashiCorp (po IBM acquisition 2024); Enterprise licensing może być drogi przy skali; self-hosted = self-operated DR.

### 3.2 AWS KMS / Secrets Manager

| Cecha | Wartość |
|---|---|
| Crypto | FIPS 140-2 Level 3 (CloudHSM dla custom KMK) |
| Audit | CloudTrail integration, automatic |
| HA | Multi-AZ default, multi-region opt-in |
| Cost | Per-request + per-key/month |
| SYLION fit | ❌ jurisdiction issue (US, CLOUD Act per ADR-cloud-provider-001 §3) |

**Rejected** — jurisdictional inkompatybilność z baseline cloud strategy.

### 3.3 Azure Key Vault / Managed HSM

Tożsame uzasadnienie jak AWS KMS. **Rejected** dla baseline.

### 3.4 GCP Cloud KMS

Tożsame. **Rejected**.

### 3.5 Hetzner / OVH native secret storage

- Hetzner Cloud: brak natywnego secret store
- OVHcloud: "OVH Secrets Manager" early access (2025+), niska maturity, brak FIPS cert jako 2026-05

**Rejected** dla MVP — too immature.

### 3.6 On-prem HSM (Thales / Utimaco / nCipher)

| Cecha | Wartość |
|---|---|
| Crypto | FIPS 140-2 Level 3-4, Common Criteria EAL4+ |
| Key isolation | hardware-isolated, no key exfiltration |
| Audit | hardware tamper-evident audit |
| HA | hardware cluster, vendor-specific |
| Cost | ~$10k-50k per HSM + service contract |
| SYLION fit | ✅ F1-F12 plus highest assurance |
| Operational burden | wysoki — fizyczna instalacja, key ceremonies, vendor-specific |

**Plus:** highest assurance, FIPS Level 3 default, zgodne z `sylion-crypto-pki-pqc` skill ("HSM-backed CA and auditable key custody").

**Minus:** wysoki cost + operational complexity; wymaga fizycznej lokalizacji (datacenter, biuro, customer site dla STATE tier). Dla MVP cloud-based deployment — mismatch.

### 3.7 Cloud HSM via dedicated provider (e.g., Equinix SmartKey, Fortanix)

| Cecha | Wartość |
|---|---|
| Crypto | FIPS 140-2 L3 (typically) |
| Multi-tenant via crypto isolation | Yes |
| Audit | API + native |
| Jurisdiction control | Yes (choose region) |
| SYLION fit | ✅ F1-F12, możliwy EU footprint |
| Operational burden | średni |

**Examples:**
- **Fortanix DSM (Data Security Manager)** — confidential computing-based, EU regions available, FIPS 140-2 L3
- **Equinix SmartKey** — global with EU presence
- **Atos Trustway** — EU-headquartered HSM-as-a-Service

**Plus:** wysokie assurance bez fizycznej infrastruktury; EU jurysdykcja możliwa.

**Minus:** dependency on cloud HSM vendor; price (typically $$$$); fewer audit transparency reports vs HashiCorp Vault OSS.

### 3.8 Hybrid: HashiCorp Vault + HSM auto-unseal

Vault OSS / Enterprise + HSM (on-prem lub Fortanix-style) jako auto-unseal i transit signing root. Najlepszy z dwóch światów:

| Layer | Backend |
|---|---|
| Application-facing API | Vault (mature, dev-friendly) |
| Master key custody | HSM (FIPS L3, hardware-isolated) |
| Token rotation policy | Vault policies |
| Audit | Vault file audit + HSM hardware audit |
| Compliance | Vault Enterprise + HSM = FIPS path |

**Plus:** best assurance + best DX; modular (HSM swap możliwy bez zmiany Vault config).

**Minus:** najwyższy cost + complexity; trzy systemy do operowania (Vault, HSM, IaC).

## 4. Rekomendacja

**Phased approach:**

### Phase A (MVP / Stage 1)

**HashiCorp Vault OSS** self-hosted na Hetzner / OVH bare metal, EU jurisdiction.

- Backend storage: Raft (built-in, no Consul dep)
- Auth: AppRole dla admin API; cert for HSM (future)
- Audit: file device + syslog → centralized audit (ELK lub equivalent)
- HA: 3-node Raft cluster, multi-region (DE + FR)
- Cost: ~zero licensing; ~$300-500/mc na infrastructure
- Closes F-25 partial: token rotation via Vault TTL+renewal

### Phase B (Production unlock)

**HashiCorp Vault Enterprise + HSM auto-unseal** via Fortanix DSM (EU) lub on-prem HSM.

- Vault Enterprise dla: namespacing, performance replication, FIPS transit
- HSM dla: master key custody, FIPS 140-2 L3 path, signed transit operations
- Cost: Vault Enterprise ~$2-10k+/mc + HSM ~$5-50k+ startup + $$/mc HSM operations
- Closes F-25 final, F-34, partial F-19 (audit HMAC key custody)

### Phase C (STATE tier customer / customer-deployable)

**Customer BYO-HSM** per `sylion-crypto-pki-pqc` skill: customer prowadzi własny HSM (Thales, etc.), Vault SYLION dostaje read-only delegation.

- Per tenant per region — pełna jurisdiction control
- Cost: zależny od customer HSM choice

## 5. Decision matrix

| Option | Closes F-25 | Closes F-34 | Cost MVP | Cost prod | Compliance scope | EU jurisdiction | Maturity |
|---|---|---|---|---|---|---|---|
| Vault OSS (Phase A) | ✅ | ✅ | $ | n/a | basic | ✅ | high |
| Vault Ent + HSM (Phase B) | ✅ | ✅ | n/a | $$$ | FIPS L3 | ✅ | high |
| HSM-only on-prem | ✅ | ✅ | $$$ startup | $$ | FIPS L3-4 | ✅ | very high (rigid) |
| Cloud HSM (Fortanix etc.) | ✅ | ✅ | $$ | $$$ | FIPS L3 | ✅ (EU regions) | medium-high |
| AWS / Azure / GCP KMS | ✅ | ✅ | $ | $$ | FIPS L3 | ❌ | very high |
| Hetzner / OVH native | partial | ❌ | low | low | basic | ✅ | low |

## 6. Decision pending — opcje dla człowieka

**Co potrzeba zdecydować:**

1. **Phase A backend** — Vault OSS (recommended) lub coś prostszego (Hashicorp Vault dev mode dla labu)?
2. **Self-hosted vs managed** — self-host Vault na własnej infrastrukturze (więcej kontroli) lub managed?
3. **Phase B HSM choice** — Fortanix DSM (EU cloud) vs on-prem Thales/Utimaco (więcej kontroli, większy cost)?
4. **HSM placement** — pojedyncze EU datacenter, multi-region pair, customer-side?
5. **Compliance target** — FIPS 140-2 L3 wystarczy czy L4 / Common Criteria EAL4+ wymagane?
6. **Budget** — MVP ~$500/mc, production $5-20k/mc + HSM CAPEX — accept?

**Recommendation (model-only, bez weryfikacji budgetu):** **Vault OSS dla Phase A, Vault Ent + Fortanix DSM (EU) dla Phase B, customer BYO-HSM dla STATE tier.**

## 7. Implementation plan (po sign-off)

| Phase | Tydzień | Deliverable |
|---|---|---|
| A.W1 | Platform | Setup Vault OSS Raft cluster, 3 nodes Hetzner + OVH |
| A.W1 | Security | Define seal config, audit destinations, AppRole policies |
| A.W2 | Codex | Implement `VaultSecretProvider` extending `EnvSecretProvider` interface |
| A.W2 | QA | Test parity z `EnvSecretProvider`: no plaintext leak, audit emission, rotation API |
| A.W3 | Platform | Migration runbook: ENV → Vault, with rollback path |
| A.W4 | Security | Token rotation policy (closes F-34): default 30 dni, rotate on event |
| B.M1-M3 | Security + Platform | Procure Fortanix DSM (or HSM), seal Vault, key ceremony |
| B.M3 | CISO | Audit + sign-off Phase B production unlock readiness |
| C.future | Customer-deployable | Per tenant runbook + IaC modules |

## 8. Konsekwencje

### 8.1 Pozytywne

- Closes F-25 (vault adapter pending)
- Closes F-34 (token rotation)
- Provides foundation dla F-19 (WORM audit HMAC key custody) — patrz ADR-worm-audit-001
- Aligns z `sylion-crypto-pki-pqc` skill ("HSM-backed CA and auditable key custody")
- Multi-cloud + multi-region by Phase A

### 8.2 Negatywne

- Operational complexity: Vault cluster wymaga babysittingu (rotation, unseal, backups)
- Phase B HSM: significant CAPEX/OPEX
- Vendor relationship (HashiCorp/IBM, Fortanix)
- Migration ENV → Vault wymaga downtime window lub blue-green

### 8.3 Compliance

- Phase A: basic — closes vault gap, no FIPS claim
- Phase B: FIPS 140-2 L3 path — opens SOC 2 / ISO 27001 path
- Phase C: customer BYO-HSM — STATE tier scope

## 9. Open items / HUMAN GATE

1. **Phase A backend choice** (Vault OSS recommended) — Platform Lead
2. **Self-hosted vs managed** — Platform + Security
3. **Phase B HSM vendor** — CISO + Procurement
4. **Compliance target** — Compliance + CISO
5. **Budget approval** — Finance / Founder
6. **Key ceremony procedures** — CISO + Security (osobny runbook po sign-off)
7. **Customer BYO-HSM** policy — Legal + Customer Success

## 10. Sign-off

| Rola | Nazwisko | Data | Decyzja | Komentarz |
|---|---|---|---|---|
| CISO | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Platform Lead | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Security | _________ | ____ | ☐ approve ☐ reject ☐ changes | |
| Architect | _________ | ____ | ☐ approve ☐ reject ☐ changes | |

---

## Appendix A — Źródła

- [`docs/admin-panel-v2/61-step3-16-implementation-freeze-secrets-hetzner-sandbox.md`](../docs/admin-panel-v2/61-step3-16-implementation-freeze-secrets-hetzner-sandbox.md)
- [`adr/ADR-cloud-provider-001-hetzner-ovh.md`](./ADR-cloud-provider-001-hetzner-ovh.md)
- `services/admin-api/src/modules/secrets/secretManagerService.js`
- `.claude/skills/sylion-crypto-pki-pqc/SKILL.md`
- `.claude/skills/sylion-secure-implementation/SKILL.md`
- HashiCorp Vault docs (https://developer.hashicorp.com/vault)
- Fortanix DSM docs (https://www.fortanix.com/products/data-security-manager)
- FIPS 140-2 / 140-3 references (NIST)
