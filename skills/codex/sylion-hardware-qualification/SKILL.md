---
name: sylion-hardware-qualification
description: Qualify SYLION hardware against security, performance, firmware, lifecycle, and compliance gates. Use for routers, Pixels, HSMs, edge kits, servers, modems, procurement decisions, and model substitutions such as Mudi v2 vs Beryl AX.
---

# SYLION Hardware Qualification

## Mission

Prevent unsuitable hardware from entering SYLION baseline. A named device is not approved until it passes gates.

## Required References

- `../../shared/references/hardware-gates.md`
- `../../shared/references/human-gate-policy.md`
- `../../shared/references/sylion-source-map.md`
- `../../shared/references/legal-safety-boundaries.md` for PHANTOM/radio identity topics.

## Workflow

1. Identify hardware role: router, terminal, HSM, host, edge kit, modem, or accessory.
2. Identify target tier: STANDARD, PRO, STATE, PHANTOM-only, or lab.
3. Build a gate table: requirement, evidence, pass/fail/unknown.
4. Treat unknown evidence as not approved.
5. Check operational lifecycle: patching, firmware provenance, inventory, replacement, incident handling.
6. If evidence is missing or a gate is marginal, mark `HUMAN GATE REQUIRED`.
7. Produce a verdict and required tests.

## Router-Specific Rules

- Reject RAM < 256 MB for baseline.
- Prefer RAM >= 512 MB and flash >= 256 MB NAND.
- Require OpenWrt 23.05+ or equivalent supported hardened firmware.
- Require IPsec IKEv2 with cert-based auth.
- Require kill switch active before VPN startup.
- Require DNS leak prevention.
- Require firmware provenance and update process.

## Known Router Decisions

- Beryl AX / GL-MT3000: working reference baseline candidate.
- Mudi v2 / GL-E750V2: not baseline. Mark as reject for baseline unless a formal exception limits its role.

## Output

Always output:

- Verdict.
- Human gate status.
- Tier fit.
- Gate table.
- Residual risks.
- Required tests.
- Required document updates.
