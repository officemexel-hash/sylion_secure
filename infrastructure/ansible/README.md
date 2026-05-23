# SYLION Ansible Playbooks

> Post-Terraform configuration management. Idempotent — re-runs are safe.

Per ADR-router-phantom-001, ADR-cloud-provider-001, ADR-vault-adapter-001 Phase A.

## Layout

```
ansible/
├── README.md                            # ten plik
├── ansible.cfg                          # standardowa config
├── requirements.yml                     # collections + roles
├── inventory/
│   ├── lab.yml.example                  # template — copy do lab.yml (gitignored)
│   ├── production.yml.example           # template — copy do production.yml
│   └── group_vars/all.yml.example       # zmienne wspólne (no secrets)
├── playbooks/
│   ├── g1-bootstrap.yml                 # G1 setup: strongSwan + nftables + admin-api
│   ├── g2-bootstrap.yml                 # G2 setup: Guacamole [E] + Firecracker
│   ├── workload-bootstrap.yml           # WORKLOAD setup: Firecracker host
│   ├── operator-add.yml                 # per-operator provisioning
│   ├── operator-teardown.yml            # disposable teardown (four-eyes)
│   └── audit-anchor-rekor.yml           # Phase B: Rekor anchor publisher
└── roles/
    ├── common/                          # base hardening, ssh, timezone, packages
    ├── strongswan/                      # IPsec IKEv2 baseline
    ├── nftables/                        # firewall + kill switch
    ├── sylion-admin-api/                # admin-api service deployment
    ├── guacamole-broker/                # G2 session broker (status [E])
    ├── firecracker-host/                # microVM host setup
    ├── monitoring/                      # metrics + alerting
    └── vault-client/                    # Vault CLI + auth (Phase B)
```

## Quick start

```bash
cd infrastructure/ansible

# 1. Setup inventory
cp inventory/lab.yml.example inventory/lab.yml
# Edit lab.yml — fill in VPS IPs from `terraform output`

# 2. Install Ansible collections
pip install ansible
ansible-galaxy install -r requirements.yml

# 3. Dry-run (check mode)
ansible-playbook -i inventory/lab.yml playbooks/g1-bootstrap.yml --check

# 4. Real run
ansible-playbook -i inventory/lab.yml playbooks/g1-bootstrap.yml

# 5. Verify
ansible -i inventory/lab.yml g1 -m shell -a "systemctl is-active strongswan"
```

## Idempotency invariant

Wszystkie playbooki MUSZĄ przechodzić **`--check` clean** po pełnym apply. Jeśli drugie wywołanie zmienia coś — to bug do naprawy.

Test: `ansible-playbook ... && ansible-playbook ... --check` → wszystkie zadania `ok`, zero `changed`.

## Secret handling

- **NIGDY** plain text secrets w playbookach lub inventory
- Użyj `ansible-vault` dla per-host wrażliwych zmiennych
- Lub Vault lookup (Phase B): `{{ lookup('community.hashi_vault.hashi_vault', 'secret=sylion/...') }}`
- W CI: secrets injected przez env vars → ansible-playbook reads via `lookup('env', 'HETZNER_API_TOKEN')`

## CI integration

`.github/workflows/deploy-admin-api.yml` SSH-deploys admin-api bezpośrednio (nie przez Ansible). Ansible jest dla **infrastructure layer** (G1/G2/WORKLOAD bootstrap), nie dla **application layer** (admin-api code).

Future: dodać `.github/workflows/ansible-playbook.yml` dla CI-driven infrastructure changes.

## Per ADR

| Playbook | ADR |
|---|---|
| `g1-bootstrap.yml` | ADR-router-phantom-001, ADR-cloud-provider-001 |
| `g2-bootstrap.yml` | Ksiega §SL-03 + §64.6 (Guacamole status [E]) |
| `workload-bootstrap.yml` | Step 3.20, 3.51 (Firecracker rehearsal + lab host) |
| `operator-add.yml` | Step 3.72-3.73 (account bootstrap with admin QA review) |
| `operator-teardown.yml` | Step 3.71 (disposable teardown guardrails) |
| `audit-anchor-rekor.yml` | ADR-worm-audit-001 Phase B |

## HUMAN GATE matrix

| Playbook | Gate |
|---|---|
| `g1-bootstrap.yml` (lab) | None — auto |
| `g1-bootstrap.yml` (production) | CISO + Architect approval |
| `operator-add.yml` | Admin QA review (Step 3.73) |
| `operator-teardown.yml` | **Four-eyes** + audit |
| `audit-anchor-rekor.yml` | CISO sign-off (first run) |
