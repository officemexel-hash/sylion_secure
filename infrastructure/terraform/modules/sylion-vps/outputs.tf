output "g1_ipv4" {
  description = "G1 public IPv4"
  value       = var.create_g1 ? hcloud_server.g1[0].ipv4_address : null
}

output "g1_private_ip" {
  description = "G1 private IP (inside Hetzner network)"
  value       = var.create_g1 ? "10.42.1.10" : null
}

output "g2_ipv4" {
  description = "G2 public IPv4"
  value       = var.create_g2 ? hcloud_server.g2[0].ipv4_address : null
}

output "g2_private_ip" {
  description = "G2 private IP"
  value       = var.create_g2 ? "10.42.1.20" : null
}

output "workload_ipv4" {
  description = "WORKLOAD public IPv4"
  value       = var.create_workload ? hcloud_server.workload[0].ipv4_address : null
}

output "network_id" {
  description = "Hetzner network ID"
  value       = hcloud_network.sylion.id
}

output "firewall_g1_id" {
  description = "G1 firewall ID"
  value       = hcloud_firewall.sylion_g1.id
}

output "manifest" {
  description = "Provisioning manifest (per Step 3.30 RouterReadinessService format)"
  value = {
    operator_id   = var.operator_id
    environment   = var.environment
    name_prefix   = var.name_prefix
    location      = var.location
    g1            = var.create_g1
    g2            = var.create_g2
    workload      = var.create_workload
    productionExecutionAllowed = false
    adr_refs = [
      "ADR-router-phantom-001",
      "ADR-router-baseline-002",
      "ADR-cloud-provider-001-hetzner-ovh",
    ]
  }
}
