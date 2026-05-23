variable "name_prefix" {
  description = "Prefix for all resource names (e.g. sylion-op-abc123-lab)"
  type        = string
}

variable "operator_id" {
  description = "Operator ID (opaque, e.g. op_xxx)"
  type        = string
}

variable "environment" {
  description = "Environment: lab | staging | production"
  type        = string
  validation {
    condition     = contains(["lab", "staging", "production"], var.environment)
    error_message = "Environment must be one of: lab, staging, production"
  }
}

variable "image" {
  description = "Base image — Debian 12 recommended"
  type        = string
  default     = "debian-12"
}

variable "location" {
  description = "Hetzner location (per ADR-cloud-provider-001 EU only)"
  type        = string
  default     = "fsn1"
  validation {
    condition     = contains(["fsn1", "nbg1", "hel1"], var.location)
    error_message = "Per ADR-cloud-provider-001, only EU Hetzner locations allowed: fsn1, nbg1, hel1"
  }
}

variable "network_zone" {
  description = "Hetzner network zone"
  type        = string
  default     = "eu-central"
}

variable "g1_server_type" {
  description = "G1 VPS type. Default: cpx21 (3 vCPU, 4GB RAM)"
  type        = string
  default     = "cpx21"
}

variable "g2_server_type" {
  description = "G2 VPS type. Default: cpx21"
  type        = string
  default     = "cpx21"
}

variable "workload_server_type" {
  description = "Workload VPS type. Default: cpx31 (4 vCPU, 8GB RAM) — Firecracker needs more"
  type        = string
  default     = "cpx31"
}

variable "create_g1" {
  description = "Whether to provision G1 (network gateway)"
  type        = bool
  default     = true
}

variable "create_g2" {
  description = "Whether to provision G2 (session broker) — status [E] Experimental"
  type        = bool
  default     = true
}

variable "create_workload" {
  description = "Whether to provision WORKLOAD (microVM host) — KVM-capable required for Android native"
  type        = bool
  default     = true
}

variable "deploy_ssh_public_key" {
  description = "Public SSH key for CI deploy access (private part in GH Secrets)"
  type        = string
}

variable "deploy_user" {
  description = "Unprivileged user for CI deploys (e.g. sylion-deploy)"
  type        = string
  default     = "sylion-deploy"
}

variable "deploy_allowlist_cidrs" {
  description = "CIDR allowlist for SSH (deploy CI runners only)"
  type        = list(string)
  default     = []
}

variable "admin_api_allowlist_cidrs" {
  description = "CIDR allowlist for admin API HTTPS (operator network or VPN)"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
