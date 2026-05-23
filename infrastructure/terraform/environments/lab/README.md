# SYLION Lab environment — Terraform

> Single demo-operator setup. **For lab/dev only.** Production has its own environment.

## Quick start

```bash
cd infrastructure/terraform/environments/lab

# 1. One-time: copy example tfvars and fill in
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — set deploy_ssh_public_key

# 2. Set Hetzner API token (NEVER commit)
export HCLOUD_TOKEN="hcloud_..."   # from Hetzner Console

# 3. Init + plan + apply
terraform init
terraform plan
terraform apply
```

## What it creates

- 1× Hetzner private network (10.42.0.0/16) in Frankfurt (fsn1)
- 1× G1 VPS (cpx11, 2 vCPU, 2GB) — network gateway, IPsec termination
- 1× G2 VPS (cpx11) — session broker (Guacamole, status [E] per Ksiega §64.6)
- 1× WORKLOAD VPS (cpx21, 3 vCPU, 4GB) — Firecracker microVM host
- 1× firewall (IKE inbound only)
- 1× SSH deploy key

## Cost estimate (Hetzner Frankfurt 2025/2026 pricing)

- cpx11: ~€5/month
- cpx21: ~€8/month
- Network: free for first 1 GB egress, then ~€1/TB

Total lab setup: **~€18/month** (3 VPS × small instance)

## After `terraform apply`

```
# Get output
terraform output

# SSH to G1
ssh -i ~/.ssh/deploy_key sylion-deploy@<g1_ipv4>

# Run Ansible bootstrap (next step)
cd ../../../ansible
ansible-playbook -i inventory/lab.yml playbooks/g1-bootstrap.yml
```

## Teardown

```bash
terraform destroy
```

⚠️ For production: `terraform destroy` requires HUMAN GATE four-eyes per `sylion-ops-sre-incident-response`.

## State backend

Lab uses local state (`terraform.tfstate`). Production uses S3-compatible
(e.g. Hetzner Object Storage) — see `environments/production/main.tf`.

## Per ADR

- [`adr/ADR-router-phantom-001.md`](../../../../adr/ADR-router-phantom-001.md) — Puli AX baseline
- [`adr/ADR-router-baseline-002.md`](../../../../adr/ADR-router-baseline-002.md) §4 BoM
- [`adr/ADR-cloud-provider-001-hetzner-ovh.md`](../../../../adr/ADR-cloud-provider-001-hetzner-ovh.md) — Hetzner DE primary

## Production execution gate

This module **does not flip productionExecutionAllowed** to true. That requires:
1. Multi-party HUMAN GATE (Architect+CISO+Legal+Compliance+Hardware)
2. ADR-002 sign-off if `phantom-a` profile
3. Vault swap (ADR-vault-adapter-001 Phase B)
4. WORM audit (ADR-worm-audit-001 Phase A+)
5. Production HSM PKI integration
