---
name: sylion-router-openwrt-hardening
description: Design or review SYLION access-router firmware hardening. Use for OpenWrt, strongSwan, nftables kill switch, DNS leak prevention, firmware signing, router provisioning, router tests, and router model changes.
---

# SYLION Router OpenWrt Hardening

## Mission

Ensure SYLION access routers enforce the security boundary expected by the architecture.

## Required References

- `../../shared/references/hardware-gates.md`
- `../../shared/references/human-gate-policy.md`
- `../../shared/references/sylion-source-map.md`
- `../../shared/references/legal-safety-boundaries.md`

## Baseline Router

Use Beryl AX / GL-MT3000 or validated equivalent as the working baseline. Do not use Mudi v2 / GL-E750V2 as baseline.

## Required Controls

- Hardened OpenWrt 23.05+ or equivalent.
- strongSwan IKEv2 certificate auth.
- nftables default-drop kill switch loaded before VPN startup.
- DNS forwarding only through tunnel.
- No LAN-to-WAN bypass.
- SSH key auth only; no WAN admin panel.
- Minimal packages.
- Signed firmware and reproducible build pipeline.
- Config drift reporting.
- Inventory and certificate lifecycle.

## Workflow

1. Validate hardware gates before firmware design.
2. Define package set and removed services.
3. Define IPsec profile and certificate provisioning.
4. Define kill switch rules and boot order.
5. Define DNS leak prevention.
6. Define update/signature process.
7. Define tests under failure: boot, tunnel down, DNS, rekey, power loss.
8. Stop for `HUMAN GATE REQUIRED` before approving unverified hardware, weakening kill switch, or accepting missing tests.

## Safety Boundary

Do not provide implementation steps for illegal radio identity manipulation. If source documents mention such behavior, mark it PHANTOM/legal-review only.

## Output

- Firmware posture.
- Config controls.
- Boot/failure behavior.
- Validation tests.
- Unsupported hardware warnings.
- Human gate status.
