# Deployment Secrets Contract

> Pełna specyfikacja sekretów wymaganych do deploymentu SYLION. Definiuje **jakie sekrety**, **gdzie żyją** (GitHub Secrets vs Vault vs HSM vs operator local), **kto ma do nich dostęp** (custody), **kiedy się rotują**.

**WAŻNE:** żadna **wartość** sekretu nie jest w tym pliku ani w żadnym pliku tego repo. Plik opisuje **kontrakt** (nazwy, format, lokacja, custody), nie sekrety.

Per [`shared/references/legal-safety-boundaries.md`](../shared/references/legal-safety-boundaries.md) + [`adr/ADR-vault-adapter-001.md`](../adr/ADR-vault-adapter-001.md) + Step 3.16 freeze.

---

## 1. Kategorie sekretów

| Kategoria | Przykład | Custody | Rotation |
|---|---|---|---|
| **Cloud provider API tokens** | `HETZNER_API_TOKEN`, `OVH_APPLICATION_SECRET` | GitHub Secrets + operator local | 30 dni |
| **SSH deploy keys** | `SYLION_DEPLOY_SSH_KEY` (ed25519) | GitHub Secrets | 90 dni |
| **SSH host keys (known_hosts)** | `SYLION_G1_HOST_FINGERPRINTS` | Public, w repo |
| **Vault unseal keys** (Phase B) | Shamir 5-of-3 split | HSM + operator key custody | nigdy (one-time setup) |
| **Audit chain HMAC root** (Phase B) | Vault transit key | Vault, never extracted | 90 dni z overlap |
| **Operator FIDO2 attestation roots** | Public + private CA | HSM (production) | 365 dni |
| **Customer PHANTOM Legal mandates** | PDFs, signed | Vault evidence bundle | per-jurisdiction |
| **Provider OAuth client secrets** | Hetzner OAuth (jeśli używany) | GitHub Secrets | 90 dni |
| **Database passwords** (Vault backend) | Postgres / Raft | Vault auto-generated | 30 dni |

## 2. GitHub Secrets — pełna lista wymaganych

Dodaj w GitHub UI: **Settings → Secrets and variables → Actions → New repository secret**.

### 2.1 Cloud provider credentials

```
HETZNER_API_TOKEN
  Format: hcloud_<64 char hex>
  Source: Hetzner Cloud Console → API tokens
  Permissions: Read & Write (dla resource provisioning)
  Rotation: 30 dni (calendar reminder)
  Owner: Platform Lead

OVH_APPLICATION_KEY
OVH_APPLICATION_SECRET
OVH_CONSUMER_KEY
  Format: standard OVH API credentials
  Source: api.ovh.com → Create app
  Rotation: 90 dni
  Owner: Platform Lead
```

### 2.2 SSH deploy credentials

```
SYLION_DEPLOY_SSH_PRIVATE_KEY
  Format: OpenSSH ed25519 private key (-----BEGIN OPENSSH PRIVATE KEY-----)
  Generation: ssh-keygen -t ed25519 -f deploy_key -C "sylion-ci-deploy"
  Public key: pre-installed na każdym G1/G2/WORKLOAD VPS via cloud-init
  Rotation: 90 dni
  Owner: DevOps + CISO co-custody

SYLION_DEPLOY_SSH_USER
  Format: string, default "sylion-deploy"
  Source: defined per Terraform variable

SYLION_KNOWN_HOSTS
  Format: ssh known_hosts content (multi-line)
  Source: ssh-keyscan -H g1-fsn1.sylion.internal etc.
  Updated: per-host basis when new VPS dodany
```

### 2.3 SYLION admin API credentials (post-deploy provisioning)

```
SYLION_ADMIN_BOOTSTRAP_TOKEN
  Format: opaque ~64 char token
  Source: generated jednorazowo per first deploy
  Use: tylko initial admin bootstrap, then revoked
  Rotation: discarded after first use

SYLION_ADMIN_API_HEALTH_TOKEN
  Format: opaque
  Use: health check bot dla CI (read-only)
  Permissions: ROLE=AUDITOR (least privilege)
  Rotation: 30 dni
```

### 2.4 Monitoring & observability

```
SYLION_MONITORING_API_TOKEN  
  Format: per-provider (Grafana Cloud, Datadog, etc.)
  Use: push metrics from admin API
  Rotation: 90 dni

SYLION_PAGERDUTY_INTEGRATION_KEY
  Format: PagerDuty integration key (32 char)
  Use: incident escalation
  Rotation: per PagerDuty rotation policy
```

### 2.5 Audit anchor (Phase B, post ADR-worm-audit-001)

```
SYLION_REKOR_SERVER
  Format: URL (np. https://rekor.sigstore.dev lub self-hosted)
  Public, NIE secret

SYLION_REKOR_SIGNING_KEY_REFERENCE
  Format: Vault key reference path
  Use: chain head signing przed Rekor anchor publish
  Custody: Vault, never extracted
```

## 3. Operator local environment

Plik `~/.config/sylion/env` na maszynie operatora administracyjnego (nie w repo):

```bash
# Operator local environment
# Plik: ~/.config/sylion/env (chmod 600)
# NIE commit, NIE share, NIE paste w chat

export SYLION_ADMIN_API_URL="https://admin-api.sylion.internal"
export SYLION_ADMIN_TOKEN="<your-personal-admin-token>"   # never share
export HETZNER_API_TOKEN="<read-only-or-deploy-token>"     # role-based
export SYLION_LIVE_ALLOWED="false"                          # safe default
export SYLION_PROVIDER_MODE="dry_run"                       # safe default
export EDITOR="vim"
```

Operator wczytuje przez `source ~/.config/sylion/env` w shell rc.

## 4. Vault (Phase B per ADR-vault-adapter-001)

Vault będzie pełnym secret backend dla:

- Provider tokens (Hetzner, OVH)
- Per-tenant operator credentials
- SSH deploy keys (renewable, short-lived)
- Audit chain HMAC root
- HSM-backed PKI roots (Phase C)
- PHANTOM evidence bundle keys

Vault paths layout (proposed):

```
sylion/
├── providers/
│   ├── hetzner/{token,read_only_token}
│   ├── ovh/{key,secret,consumer}
│   └── _meta/{rotation_history,custody_attestation}
├── ssh/
│   ├── deploy-keys/{current,previous}
│   └── host-keys/{g1-fsn1,g2-fsn1,...}
├── audit/
│   ├── hmac-root              # transit engine, never exfiltrate
│   └── rekor-signing-key
├── tenants/{tenantId}/
│   ├── operator-bootstrap-tokens/
│   └── _phantom_evidence/     # explicit phantom-a, Legal-gated access
└── _emergency/
    └── break-glass-tokens     # WORM-anchored, multi-party access
```

## 5. Custody policy

### 5.1 Co kto wie

| Persona | Może widzieć | Może rotować | Może revokować |
|---|---|---|---|
| **Architect** | nazwy + format | nie | po incident |
| **CISO** | nazwy + custody chain | tak (z DR plan) | tak |
| **DevOps Platform** | values (operacyjnie) | tak (per schedule) | nie sam |
| **Security** | values audit only | konsultacja | tak (z CISO) |
| **Operator** | own scoped subset | nie | nie |
| **Customer** | own customer-scoped only | nie | nie |
| **CI bot** | injected only przy run, nigdy persistent | nie | nie |

### 5.2 Cztery oczy (per `sylion-ops-sre-incident-response`)

Wymagane dla:

- HSM key generation (multi-party key ceremony)
- Vault unseal (Shamir threshold)
- Rotation production token before scheduled
- Emergency break-glass token use
- Audit chain HMAC root rotation
- VPS teardown w production

### 5.3 Zakaz absolutny

**Wartości sekretów NIGDY nie znajdują się w:**

- Chat (Claude, ChatGPT, etc.)
- Commit messages
- Pull request descriptions
- GitHub issues
- Slack / Discord / Teams
- Email (plain text)
- Audit logs (sanitized only)
- Documentation files
- Test files
- Screenshots
- Test artifact PNG / JSON files

**Per `phantomGovernanceService.js` PROHIBITED_TERMS guard** — runtime block dla każdej próby zapisu sekretów w PHANTOM governance records.

## 6. Rotation calendar

```
Daily:    automated health-check token (CI-generated)
Weekly:   nothing (intentional, reduce churn)
Monthly:  Hetzner API token, deploy SSH key (Phase A)
Quarterly: OVH credentials, monitoring tokens, Vault Postgres
Yearly:   FIDO2 attestation root (with overlap window)
On-event: emergency rotation, rotation post-incident, rotation
          post-CVE w komponencie używającym key, post-employee-leave
```

Rotation runbook: `docs/operator-onboarding/secret-rotation-runbook.md` (TBD).

## 7. Initial setup checklist (jednorazowo)

```
[ ] 1. Create GitHub repo secrets per §2 (Platform Lead)
[ ] 2. Generate deploy SSH key pair (DevOps)
       ssh-keygen -t ed25519 -f deploy_key -C "sylion-deploy" -N ""
[ ] 3. Add deploy public key do Terraform variables (cloud-init pre-installs)
[ ] 4. Add deploy private key do GitHub Secrets (NEVER commit)
[ ] 5. Generate Hetzner API token z minimal permissions
       (read+write na project, nie account-wide)
[ ] 6. Add do GitHub Secrets
[ ] 7. Configure GH environment "production" z required reviewers
       (Settings → Environments → New environment "production")
[ ] 8. Configure branch protection na main
       (Settings → Branches → Add rule)
       - Require pull request reviews before merging
       - Require status checks: Tests, CodeQL
       - Require signed commits
       - Restrict deletions
[ ] 9. Document rotation calendar w Calendar/PagerDuty
[ ] 10. CISO sign-off on initial custody
```

## 8. Incident: what if a secret leaks

**Per `docs/operator-onboarding/secret-incident-runbook.md` (TBD):**

1. **Revoke immediate** — provider console + Vault revoke
2. **Generate new** — different key pair, new token
3. **Update GH Secrets** — replace stary
4. **Force redeploy** wszystkich workflows które używały
5. **Audit chain inspection** — wszystkie operations przez compromised token
6. **CISO incident report** w `services/admin-api/.../incidents/`
7. **Forensic** — kto miał access, gdzie wyciekło, jakie blast radius
8. **Postmortem** + ADR/runbook update

## 9. Tooling refs

| Tool | Use |
|---|---|
| **`gitleaks`** | Workflow `.github/workflows/test.yml` job `secret-scan` — block jeśli secret pattern w commit |
| **CodeQL** | Workflow detekcja unsafe secret patterns w code |
| **Vault CLI** (Phase B) | `vault kv get sylion/providers/hetzner` |
| **age** / **sops** | Plik-poziom encryption gdy potrzeba (np. Ansible vault) |
| **YubiKey / hardware FIDO2** | Authentication operator do admin panel |

## 10. Co teraz wymaga akcji

Zanim którykolwiek deploy workflow działa:

| # | Akcja | Owner | Status |
|---|---|---|---|
| 1 | Create GH Secrets per §2.1 (Hetzner, OVH) | Platform Lead | ⏳ |
| 2 | Generate + upload deploy SSH key | DevOps | ⏳ |
| 3 | Configure "production" GH environment z reviewers | DevOps Admin | ⏳ |
| 4 | Branch protection rules na main | Repo Admin | ⏳ |
| 5 | Vault Phase A deployment (per ADR-vault-adapter-001) | Platform + Security | depending on ADR sign-off |
| 6 | Rotation calendar w PagerDuty | DevOps | ⏳ |
| 7 | Operator local env template release | Doc owner | ⏳ |

**Bez kroków 1-4 żadne CI deploy workflow nie zadziała w production.**

---

## Appendix A — Źródła

- [`adr/ADR-vault-adapter-001.md`](../adr/ADR-vault-adapter-001.md) Phase A self-hosted Vault, Phase B + HSM
- [`adr/ADR-worm-audit-001.md`](../adr/ADR-worm-audit-001.md) HMAC + Rekor anchor
- [`shared/references/legal-safety-boundaries.md`](../shared/references/legal-safety-boundaries.md) §"Restricted Work"
- [`shared/references/human-gate-policy.md`](../shared/references/human-gate-policy.md) cztery oczy
- Step 3.12 freeze §"Runtime Gates" — `HETZNER_API_TOKEN="set outside chat"`
- Step 3.16 freeze §"Security Invariants" — runtime-only provider secrets
- Step 3.19 freeze — secret backend contract (interface ready, swap pending)
- `services/admin-api/src/modules/secrets/secretManagerService.js` `EnvSecretProvider`
- `.github/workflows/test.yml` — `gitleaks` job
