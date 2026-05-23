# SYLION VPS module — G1/G2/WORKLOAD VPS template
# Per ADR-cloud-provider-001 (Hetzner DE + OVH FR multi-cloud)
# Per ADR-router-baseline-002 §4 BoM hierarchy (T1 baseline, T3 dedicated)

terraform {
  required_version = ">= 1.5"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

# SSH key — pre-installed via cloud-init from public part of SYLION_DEPLOY_SSH_PRIVATE_KEY
resource "hcloud_ssh_key" "deploy" {
  name       = "${var.name_prefix}-deploy-key"
  public_key = var.deploy_ssh_public_key
  labels     = local.labels
}

resource "hcloud_network" "sylion" {
  name     = "${var.name_prefix}-net"
  ip_range = "10.42.0.0/16"
  labels   = local.labels
}

resource "hcloud_network_subnet" "sylion_subnet" {
  network_id   = hcloud_network.sylion.id
  type         = "cloud"
  network_zone = var.network_zone
  ip_range     = "10.42.1.0/24"
}

resource "hcloud_firewall" "sylion_g1" {
  name   = "${var.name_prefix}-g1-fw"
  labels = local.labels

  # IKE (UDP/500, UDP/4500) inbound for IPsec
  rule {
    direction = "in"
    protocol  = "udp"
    port      = "500"
    source_ips = ["0.0.0.0/0"]
  }
  rule {
    direction = "in"
    protocol  = "udp"
    port      = "4500"
    source_ips = ["0.0.0.0/0"]
  }

  # SSH (only from deploy CI runners, restricted by allowlist)
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "22"
    source_ips = var.deploy_allowlist_cidrs
  }

  # HTTPS for admin API (restrict per environment)
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "443"
    source_ips = var.admin_api_allowlist_cidrs
  }

  # Default-deny everything else
}

# G1 — Network Gateway (IPsec termination, tunnel to G2)
resource "hcloud_server" "g1" {
  count       = var.create_g1 ? 1 : 0
  name        = "${var.name_prefix}-g1"
  image       = var.image
  server_type = var.g1_server_type
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.deploy.id]
  firewall_ids = [hcloud_firewall.sylion_g1.id]
  labels = merge(local.labels, {
    sylion_role        = "g1"
    sylion_zone        = "1"
  })

  network {
    network_id = hcloud_network.sylion.id
    ip         = "10.42.1.10"
  }

  user_data = templatefile("${path.module}/cloud-init/g1-bootstrap.yaml", {
    operator_id   = var.operator_id
    environment   = var.environment
    g1_hostname   = "${var.name_prefix}-g1"
    deploy_user   = var.deploy_user
  })

  # Lifecycle: never destroy production without explicit confirm
  lifecycle {
    prevent_destroy = false  # toggle to true for production via override
    create_before_destroy = false
  }

  depends_on = [hcloud_network_subnet.sylion_subnet]
}

# G2 — Access Broker (Guacamole session broker, per Ksiega §SL-03)
# Status [E] Experimental per Ksiega §64.6 — review-required gate
resource "hcloud_server" "g2" {
  count       = var.create_g2 ? 1 : 0
  name        = "${var.name_prefix}-g2"
  image       = var.image
  server_type = var.g2_server_type
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.deploy.id]
  labels = merge(local.labels, {
    sylion_role         = "g2"
    sylion_zone         = "2"
    sylion_component    = "session_broker"
    sylion_status_flag  = "experimental_E_per_ksiega_64_6"
  })

  network {
    network_id = hcloud_network.sylion.id
    ip         = "10.42.1.20"
  }

  user_data = templatefile("${path.module}/cloud-init/g2-bootstrap.yaml", {
    operator_id   = var.operator_id
    environment   = var.environment
    g2_hostname   = "${var.name_prefix}-g2"
    deploy_user   = var.deploy_user
  })

  depends_on = [hcloud_network_subnet.sylion_subnet]
}

# WORKLOAD — Firecracker microVM host
resource "hcloud_server" "workload" {
  count       = var.create_workload ? 1 : 0
  name        = "${var.name_prefix}-workload"
  image       = var.image
  server_type = var.workload_server_type
  location    = var.location
  ssh_keys    = [hcloud_ssh_key.deploy.id]
  labels = merge(local.labels, {
    sylion_role        = "workload"
    sylion_zone        = "3"
  })

  network {
    network_id = hcloud_network.sylion.id
    ip         = "10.42.1.30"
  }

  user_data = templatefile("${path.module}/cloud-init/workload-bootstrap.yaml", {
    operator_id   = var.operator_id
    environment   = var.environment
    hostname      = "${var.name_prefix}-workload"
    deploy_user   = var.deploy_user
  })

  depends_on = [hcloud_network_subnet.sylion_subnet]
}

# Common labels per ADR-router-baseline-002 §4
locals {
  labels = {
    sylion_environment = var.environment
    sylion_operator_id = var.operator_id
    sylion_managed_by  = "terraform"
    sylion_adr_001     = "router-phantom-001-revised"
    sylion_adr_002     = "router-baseline-002"
    sylion_adr_cloud   = "cloud-provider-001-hetzner-ovh"
    sylion_production_execution_allowed = "false"
  }
}
