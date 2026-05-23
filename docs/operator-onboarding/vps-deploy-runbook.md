# VPS Deploy Runbook (Hetzner G1/G2/WORKLOAD)

> End-to-end runbook od zera do działającej infrastruktury per ADR-cloud-provider-001 (Hetzner DE).

**Pre-requisites:**
- Hetzner Cloud account + API token (read+write na project)
- GitHub repo admin (do dodania secrets)
- Local: terraform, ansible, ssh
- SSH key pair wygenerowany dla deploy access

## Etap 0: One-time setup (jednorazowo per project)

### 0.1 Generate deploy SSH key

```bash
ssh-keygen -t ed25519 -f ~/.ssh/sylion-deploy-key -C "sylion-ci-deploy" -N ""

# Public part → Terraform variable
cat ~/.ssh/sylion-deploy-key.pub
# → wklej do infrastructure/terraform/environments/lab/terraform.tfvars (`deploy_ssh_public_key`)

# Private part → GitHub Secrets (NEVER paste w chat / commit / docs)
cat ~/.ssh/sylion-deploy-key
# Settings → Secrets and variables → Actions → New repository secret
# Name: SYLION_DEPLOY_SSH_PRIVATE_KEY
# Value: (paste private key including BEGIN/END lines)
```

### 0.2 Set Hetzner API token

```bash
# Z Hetzner Console → API tokens → Generate API token (read & write)
# NAME: sylion-ci-deploy
# PERMISSIONS: Read & Write

# Add do GitHub Secrets:
# Name: HETZNER_API_TOKEN
# Value: hcloud_<token>
```

### 0.3 Add inne secrets

Per `infrastructure/deployment-secrets-contract.md` §2, dodaj:

- `SYLION_DEPLOY_SSH_USER` = `sylion-deploy`
- `SYLION_KNOWN_HOSTS` — populate after first deploy: `ssh-keyscan -H <g1-ip>`
- `SYLION_G1_HOST` — populate after Terraform apply
- `SYLION_G1_HEALTH_URL` = `https://admin-api.sylion.internal` (or IP)
- `SYLION_ADMIN_API_HEALTH_TOKEN` — gen z admin panel

### 0.4 GitHub environment configuration

W GitHub repo: **Settings → Environments → New environment**:

- Name: `lab` — no required reviewers
- Name: `staging` — 1 required reviewer
- Name: `production` — **2+ required reviewers**, restrict deployment branches: `main` only

### 0.5 Branch protection

**Settings → Branches → Add rule** dla `main`:

- ✅ Require pull request reviews (min 1)
- ✅ Require status checks: Tests, CodeQL
- ✅ Require signed commits
- ✅ Restrict deletions
- ✅ Do not allow bypassing

## Etap 1: Terraform apply (provisioning VPS)

```bash
cd infrastructure/terraform/environments/lab

# One-time per lab
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — set deploy_ssh_public_key

export HCLOUD_TOKEN="hcloud_..."   # from Hetzner Console (NEVER commit)

terraform init
terraform plan -out=tfplan
# Review carefully — expected: ~6-7 resources (network, subnet, fw, ssh key, 3× server)

terraform apply tfplan
# Wait ~3-5 min for cloud-init

terraform output
# demo_g1_ipv4 = "1.2.3.4"
# demo_g2_ipv4 = "1.2.3.5"
# demo_workload_ipv4 = "1.2.3.6"
```

### Capture host keys (jednorazowo per VPS)

```bash
G1_IP=$(terraform output -raw demo_g1_ipv4)
G2_IP=$(terraform output -raw demo_g2_ipv4)
WL_IP=$(terraform output -raw demo_workload_ipv4)

ssh-keyscan -H $G1_IP $G2_IP $WL_IP > known_hosts-lab.txt
# Add to GH Secret SYLION_KNOWN_HOSTS (multi-line value)
```

## Etap 2: Wait for cloud-init

```bash
# Cloud-init runs on first boot — wait ~3-5 min
ssh -i ~/.ssh/sylion-deploy-key sylion-deploy@$G1_IP "cat /var/log/sylion-readiness.log 2>/dev/null"
# Should show: <timestamp> sylion-g1 ready op_lab_demo_0001 lab
```

Jeśli pusty po 5 minutach — cloud-init failed. Check:
```bash
ssh sylion-deploy@$G1_IP "sudo cat /var/log/cloud-init-output.log | tail -50"
```

## Etap 3: Ansible bootstrap

```bash
cd infrastructure/ansible

# Set inventory
cp inventory/lab.yml.example inventory/lab.yml
# Edit lab.yml — fill in IPs from terraform output

# Install collections
ansible-galaxy install -r requirements.yml

# Dry-run
ansible-playbook -i inventory/lab.yml playbooks/g1-bootstrap.yml --check

# Real run
ansible-playbook -i inventory/lab.yml playbooks/g1-bootstrap.yml

# Idempotency check — should be all `ok`, no `changed`
ansible-playbook -i inventory/lab.yml playbooks/g1-bootstrap.yml
```

## Etap 4: First admin-api deploy

Trigger GH Actions workflow:

```bash
# Z lokalnego repo (po push do main z zmianami w services/admin-api/)
git push origin main

# Lub manual:
# GitHub → Actions → "Deploy admin-api" → Run workflow
# Environment: lab
```

Workflow:
1. Runs `npm test` (preflight)
2. SSH'es do G1 + `rsync` code
3. `npm ci --production` na G1
4. Smoke test (spine.e2e.test.js)
5. Atomic swap symlink
6. `systemctl restart sylion-admin-api`
7. Health check (5 retries)
8. Audit POST (best-effort)

Wait ~3-5 min, check Actions tab for results.

## Etap 5: Verify

```bash
# Health check from local
curl -fsS https://$G1_IP/health
# {"status":"ok","service":"admin-api"}

# Open admin panel w browser
firefox https://$G1_IP/admin
# (initial setup wizard powinien uruchomić)

# Open operator portal (will require operator session)
firefox https://$G1_IP/operator
```

## Etap 6: Operator enrollment

Per `services/admin-api/IMPLEMENTATION_STATUS.md` admin panel features:
1. Login z initial admin credentials (gen przy first deploy)
2. Create tenant
3. Create operator
4. Generate provisioning plan
5. Register Pixel device (po Pixel wipe runbook)
6. Register Puli AX device (po puli-ax-setup runbook)
7. Issue operator certs (download cert bundle)

## Operations cheatsheet

```bash
# SSH na G1
ssh -i ~/.ssh/sylion-deploy-key sylion-deploy@$G1_IP

# Restart admin-api
ssh sylion-deploy@$G1_IP "sudo systemctl restart sylion-admin-api"

# View logs
ssh sylion-deploy@$G1_IP "sudo journalctl -u sylion-admin-api -f"

# Tail audit
ssh sylion-deploy@$G1_IP "sudo tail -f /var/log/sylion/audit.log"

# Trigger redeploy
git push origin main   # if changes in services/admin-api/
# Or: GH Actions → Run workflow

# Teardown (lab only — production needs four-eyes)
cd infrastructure/terraform/environments/lab
terraform destroy
```

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `terraform apply` permission denied | HCLOUD_TOKEN insufficient | Generate token z Read+Write |
| `ansible-playbook` SSH timeout | Firewall blocks | Add CI IP do `deploy_allowlist_cidrs` |
| `npm ci` fails on G1 | Node not installed | `apt install nodejs npm` lub use nvm |
| `systemctl restart` no unit | systemd unit not deployed | Manual: scp etc/systemd/system/sylion-admin-api.service |
| Health check fails | admin-api crashed | `journalctl -u sylion-admin-api -e --no-pager` |
| `terraform destroy` blocked | `prevent_destroy = true` (production) | Override w `main.tf` + multi-party approval |

## Refs

- `infrastructure/README.md`
- `infrastructure/terraform/environments/lab/README.md`
- `infrastructure/ansible/README.md`
- `infrastructure/deployment-secrets-contract.md`
- `.github/workflows/deploy-admin-api.yml`
- `.github/workflows/terraform-{plan,apply}.yml`
- ADR-cloud-provider-001-hetzner-ovh
