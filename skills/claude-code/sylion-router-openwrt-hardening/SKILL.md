---
name: sylion-router-openwrt-hardening
description: Design or review SYLION access-router firmware hardening. Use for OpenWrt, strongSwan, nftables kill switch, DNS leak prevention, firmware signing, router provisioning, router tests, and router model changes.
---

# SYLION Router OpenWrt Hardening

## References

- `../../shared/references/hardware-gates.md`
- `../../shared/references/human-gate-policy.md`
- `../../shared/references/sylion-source-map.md`
- `../../shared/references/legal-safety-boundaries.md`

## Baseline

Use Beryl AX / GL-MT3000 or validated equivalent. Do not use Mudi v2 / GL-E750V2 as baseline.

Required controls: hardened OpenWrt 23.05+, strongSwan IKEv2 cert auth, nftables default-drop kill switch loaded before VPN startup, DNS through tunnel only, no LAN-to-WAN bypass, SSH key auth only, no WAN admin, minimal packages, signed firmware, config drift reporting, inventory/cert lifecycle.

Stop for `HUMAN GATE REQUIRED` before approving unverified hardware, weakening kill switch, or accepting missing tests.

## Output

Firmware posture, config controls, boot/failure behavior, validation tests, unsupported hardware warnings, human gate status.
