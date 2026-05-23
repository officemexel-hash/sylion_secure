# SYLION lab environment — single demo operator setup
# Per ADR-cloud-provider-001 (Hetzner DE primary)

terraform {
  required_version = ">= 1.5"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
  # Backend: local for lab, swap to S3-compatible for production
  # backend "s3" { ... }  # see environments/production
}

provider "hcloud" {
  # HCLOUD_TOKEN injected via env (GitHub Secrets or operator local)
  # NEVER hardcoded
}

variable "environment" {
  description = "Environment name (override for plan)"
  type        = string
  default     = "lab"
}

variable "deploy_ssh_public_key" {
  description = "CI deploy public key — set via TF_VAR_deploy_ssh_public_key or *.tfvars"
  type        = string
  # No default — must be set per environment
}

variable "deploy_allowlist_cidrs" {
  description = "CIDR allowlist for SSH from CI runners"
  type        = list(string)
  default     = ["0.0.0.0/0"]  # lab only; production restricts
}

variable "admin_api_allowlist_cidrs" {
  description = "CIDR allowlist for admin API HTTPS"
  type        = list(string)
  default     = ["0.0.0.0/0"]  # lab only
}

module "demo_operator" {
  source = "../../modules/sylion-vps"

  name_prefix = "sylion-lab-demo"
  operator_id = "op_lab_demo_0001"
  environment = var.environment
  location    = "fsn1"
  image       = "debian-12"

  deploy_ssh_public_key      = var.deploy_ssh_public_key
  deploy_allowlist_cidrs     = var.deploy_allowlist_cidrs
  admin_api_allowlist_cidrs  = var.admin_api_allowlist_cidrs

  # Lab: smaller VPS types
  g1_server_type        = "cpx11"  # 2 vCPU, 2GB
  g2_server_type        = "cpx11"
  workload_server_type  = "cpx21"  # 3 vCPU, 4GB

  create_g1       = true
  create_g2       = true
  create_workload = true
}

output "demo_operator" {
  value     = module.demo_operator.manifest
  sensitive = false
}

output "demo_g1_ipv4" {
  value = module.demo_operator.g1_ipv4
}

output "demo_g2_ipv4" {
  value = module.demo_operator.g2_ipv4
}

output "demo_workload_ipv4" {
  value = module.demo_operator.workload_ipv4
}
