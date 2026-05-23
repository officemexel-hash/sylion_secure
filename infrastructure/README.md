# SYLION Infrastructure-as-Code

> Deployment-as-code layer dla SYLION baseline + PHANTOM `[A]` infrastructure.

## Layout

```
infrastructure/
├── README.md                       # ten plik
├── deployment-secrets-contract.md  # jakie GitHub secrets, gdzie, custody policy
├── terraform/                      # Hetzner/OVH VPS prowisjonowanie
│   ├── main.tf
│   ├── variables.tf
│   ├── modules/                    # VPS, network, firewall modules
│   └── environments/               # lab, staging, production
├── ansible/                        # Post-Terraform configuration
│   ├── playbooks/                  # g1-bootstrap, g2-bootstrap, etc.
│   ├── roles/                      # common, strongswan, nftables, etc.
│   └── inventory/                  # *.example templates
└── puli-ax/                        # OpenWrt UCI bundle dla GL.iNet Puli AX
    ├── setup.sh
    ├── config/                     # UCI config files (network, firewall, ipsec, dhcp)
    └── test-suite/                 # T01-T10 from ADR-router-phantom-001 §9
```

## Per ADR

| Per | Sekcja | Implementacja |
|---|---|---|
| [`ADR-router-phantom-001`](../adr/ADR-router-phantom-001.md) | §6 conditions C1-C11 (Puli AX qualification) | `puli-ax/` |
| [`ADR-router-baseline-002`](../adr/ADR-router-baseline-002.md) | §4 BoM hierarchy (T1-T4) | `terraform/modules/` (T1 Puli AX, T3 BPI-R4 alt) |
| [`ADR-cloud-provider-001`](../adr/ADR-cloud-provider-001-hetzner-ovh.md) | Hetzner DE + OVH FR multi-cloud | `terraform/` Hetzner provider primary, OVH secondary |
| [`ADR-vault-adapter-001`](../adr/ADR-vault-adapter-001.md) | Phase A: Vault OSS self-hosted | `ansible/playbooks/vault-cluster.yml` (TBD) |
| [`ADR-worm-audit-001`](../adr/ADR-worm-audit-001.md) | HMAC + HSM key custody | `ansible/roles/audit-anchor/` (TBD) |
| [`ADR-terminal-modes-001`](../adr/ADR-terminal-modes-001.md) | Operator portal at /operator | `ansible/roles/sylion-admin-api/` |

## Tier separation (per ADR-router-baseline-002 §4)

| Tier | Hardware/Provider | Use case |
|---|---|---|
| **T1 baseline** | Puli AX + Hetzner Cloud | Production STANDARD/PRO/SOVEREIGN operators |
| **T2 secondary** | Beryl AX + Hetzner | Backup / lab |
| **T3 custom** | BPI-R4 + dedicated bare-metal (Hetzner Robot) | STATE tier |
| **T4 DIY** | NanoPi + bare-metal | High-assurance customer |

## Secret management

**WAŻNE**: żadne sekrety nie są w tym repo. Wszystkie wartości przez:

1. **GitHub Secrets** (per `deployment-secrets-contract.md`) — dla CI deploy workflows
2. **Operator local env** — `~/.config/sylion/` na maszynie operatora dla manual operations
3. **Vault** (po implementacji ADR-vault-adapter-001 Phase A) — production runtime secrets

`.env` files są w `.gitignore`. Plik `.env.example` na root pokazuje wymagane variable bez wartości.

Patrz [`deployment-secrets-contract.md`](./deployment-secrets-contract.md) dla pełnej listy + custody policy.

## Production execution gate

Per [`ADR-router-phantom-001`](../adr/ADR-router-phantom-001.md) i `productionExecutionAllowed=false` invariant — **żaden script w tym katalogu nie wykonuje production mutations** bez:

1. Explicit user confirmation (`--apply` flag + `SYLION_CONFIRM_PRODUCTION=yes`)
2. Fresh FIDO2 step-up (gdy implementowane via admin API)
3. Per Step 3.12 freeze runtime gates: env allowlist, region allowlist, server cap
4. PR review approval (dla CI-triggered deploys)
5. CISO/Architect sign-off dla nowych operator deployments

Default mode dla wszystkich scripts = **dry-run** lub **plan only**.

## Workflow

```
1. RFI / vendor selection (per docs/procurement/custom-router-rfi-runbook.md)
2. Terraform plan + apply (jeden raz per nowy operator/region)
   └─> tworzy G1/G2/WORKLOAD VPS w Hetzner
3. Ansible bootstrap (idempotent, można re-run)
   └─> instaluje strongSwan, nftables, Firecracker, sylion-admin-api, etc.
4. Puli AX physical setup (manual, per puli-ax/setup.sh)
   └─> SSH na router, run setup, test T01-T10
5. Operator enrollment (via /admin GUI lub API)
   └─> Pixel device registration, certificate provisioning
6. Health checks + monitoring activation
7. Operator first login (per docs/operator-onboarding/)
```

Każdy krok ma osobny runbook w `docs/operator-onboarding/` lub dedykowany w `infrastructure/<layer>/README.md`.

## Local development

```bash
# Terraform plan (no credentials needed dla plan, tylko apply)
cd infrastructure/terraform/environments/lab
terraform init
terraform plan

# Ansible dry-run
cd infrastructure/ansible
ansible-playbook -i inventory/lab.yml playbooks/g1-bootstrap.yml --check

# Puli AX local syntax check
cd infrastructure/puli-ax
./setup.sh --dry-run
```

## CI/CD

GitHub Actions workflows w `.github/workflows/`:

| Workflow | Trigger | Akcja |
|---|---|---|
| `test.yml` | push, PR | npm test + secret-scan + prohibited-terms |
| `codeql.yml` | push, PR, schedule | CodeQL security analysis |
| `terraform-plan.yml` | PR ze zmianami w `infrastructure/terraform/**` | Terraform plan w komentarzu PR |
| `terraform-apply.yml` | push do main z env approval | Terraform apply z `production` environment gate |
| `deploy-admin-api.yml` | push do main z env approval | SSH deploy admin API do G1 |

Wszystkie deploy workflows wymagają **environment approval** w GitHub UI (manual gate przed apply).

## HUMAN GATE matrix

| Operation | Auto-CI | Approval Required |
|---|---|---|
| Terraform plan | ✅ | NIE |
| Terraform apply (lab) | ✅ | NIE |
| Terraform apply (production) | ✅ z gate | TAK — environment approval |
| Ansible playbook (lab) | ✅ | NIE |
| Ansible playbook (production) | ✅ z gate | TAK — environment approval |
| New operator G1/G2/WORKLOAD creation | ⚠️ | TAK — CISO + Architect |
| VPS teardown (destructive) | ❌ | **Four-eyes** — per `sylion-ops-sre-incident-response` |
| Vault key rotation | ❌ | **CISO** sign-off + Witness |
| HSM key generation | ❌ | **Multi-party key ceremony** |
| Flip `productionExecutionAllowed=true` | ❌ | **Architect+CISO+Legal+Compliance+Hardware** |

## Refs

- [`shared/references/hardware-gates.md`](../shared/references/hardware-gates.md)
- [`shared/references/human-gate-policy.md`](../shared/references/human-gate-policy.md)
- [`shared/references/legal-safety-boundaries.md`](../shared/references/legal-safety-boundaries.md)
- [`docs/operator-onboarding/`](../docs/operator-onboarding/)
- [`docs/procurement/custom-router-rfi-runbook.md`](../docs/procurement/custom-router-rfi-runbook.md)
