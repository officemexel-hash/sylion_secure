---
name: sylion-hardware-qualification
description: Qualify SYLION hardware against security, performance, firmware, lifecycle, and compliance gates. Use for routers, Pixels, HSMs, edge kits, servers, modems, procurement decisions, and model substitutions such as Mudi v2 vs Beryl AX.
---

# SYLION Hardware Qualification

## References

- `../../../shared/references/hardware-gates.md`
- `../../../shared/references/human-gate-policy.md`
- `../../../shared/references/sylion-source-map.md`
- `../../../shared/references/legal-safety-boundaries.md`

## Rules

- A named device is not approved until it passes gates.
- Unknown evidence means not approved.
- Router baseline requires OpenWrt 23.05+, strongSwan/IPsec IKEv2, nftables kill switch, RAM >= 256 MB, adequate flash, certificate auth, DNS leak prevention, firmware provenance, and tests.
- Prefer RAM >= 512 MB and flash >= 256 MB NAND.
- Beryl AX / GL-MT3000 is the current working baseline candidate.
- Mudi v2 / GL-E750V2 is not baseline.

If evidence is missing, a gate is marginal, or a human must accept risk/cost, output `HUMAN GATE REQUIRED`.

## Output

Verdict, human gate status, tier fit, gate table, residual risks, required tests, required document updates.

