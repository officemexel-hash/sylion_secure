# SYLION Hardware Gates

Use this reference for terminal, router, HSM, host, and edge hardware qualification.

## General Rule

Do not approve hardware because a document names it. Approve hardware only after matching it against the current gates, threat model, lifecycle, and operational burden.

If any mandatory evidence is unknown, the verdict is `NEEDS EVIDENCE` or `HUMAN GATE REQUIRED`, not approval.

## Access Router Gates

### Mandatory

- OpenWrt 23.05+ support or a formally supported hardened Linux firmware path.
- strongSwan/IPsec IKEv2 package support.
- nftables or equivalent firewall support for default-deny kill switch.
- RAM >= 256 MB. Anything below this fails baseline.
- Persistent flash sufficient for hardened firmware, strongSwan, nftables, DNS forwarding, logging buffer, signed updates, config overlay, and rollback plan.
- Hardware or measured software performance adequate for AES-256-GCM IPsec at the target throughput.
- Separate WAN/LAN or equivalent isolation mode.
- Firmware signing or verifiable image provenance.
- Inventory fields: model, serial, firmware version, config version, certificate serial, assigned operator, compliance status, last seen.

### Recommended

- RAM >= 512 MB.
- Flash >= 256 MB NAND or equivalent.
- Hardware AES acceleration.
- USB for LTE/5G modem if cellular is needed.
- Tamper-evident controls for STATE tier.
- Read-only rootfs with controlled encrypted overlay where feasible.

### Reject Or Escalate

Reject for baseline unless there is a formal exception:

- RAM < 256 MB.
- Tiny flash that cannot safely carry hardened firmware plus update/rollback margin.
- No reliable OpenWrt/security update path.
- No kill switch enforcement before VPN startup.
- No certificate-based IPsec support.
- No auditable firmware build or provenance.

Escalate to human decision when a device is strategically desirable but fails or barely passes a gate.

## Known Router Posture

- GL-iNet Beryl AX / GL-MT3000: current working baseline candidate because it matches the system book's 512 MB RAM / 256 MB NAND profile and OpenWrt/IPsec role.
- GL.iNet Mudi v2 / GL-E750V2: do not use as baseline. Treat it as legacy/PHANTOM-specific or exception-only hardware because it is below the RAM gate and has constrained flash for the desired hardened stack.

## Qualification Output

Every hardware review must output:

- Verdict: APPROVE / APPROVE WITH CONDITIONS / REJECT / NEEDS EVIDENCE.
- Human gate: REQUIRED / NOT REQUIRED, with reason.
- Tier fit: STANDARD / PRO / STATE / PHANTOM-only / not suitable.
- Gate table with pass/fail/unknown.
- Residual risks.
- Required document updates.
- Required tests before production.

## Minimum Tests For Router Approval

- Boot with kill switch active before VPN establishment.
- Verify no LAN-to-WAN traffic without tunnel.
- Verify DNS cannot leak outside tunnel.
- Establish IKEv2 with certificate auth and approved proposals.
- Rekey and DPD recovery test.
- Firmware signature/update test.
- Config drift detection.
- Throughput and CPU/RAM pressure test under realistic traffic.
- Power-loss recovery test.
