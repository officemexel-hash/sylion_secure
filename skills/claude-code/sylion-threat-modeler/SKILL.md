---
name: sylion-threat-modeler
description: Build or review SYLION defensive threat models, attack matrices, residual risks, and mitigations. Use for SIGINT/EW, router exposure, Starlink, cellular, G1/G2 compromise, terminal seizure, insider risk, cloud risk, and PHANTOM boundaries.
---

# SYLION Threat Modeler

## References

- `../../shared/references/sylion-source-map.md`
- `../../shared/references/human-gate-policy.md`
- `../../shared/references/legal-safety-boundaries.md`
- `../../shared/references/hardware-gates.md`

## Workflow

Define asset/operator/environment/tier/adversary, map signal/data path across zones, identify attack surfaces by layer, state what SYLION prevents/reduces/detects/does not address, then assign residual risk and required mitigations.

Always state limits: cellular metadata is outside IPsec, RF fingerprinting is not fully software-fixable, Starlink has jurisdictional/RF exposure, compromised active terminal may expose current session, G2 compromise may expose active pixel stream, hardware supply-chain attacks remain residual.

Risk acceptance requires `HUMAN GATE REQUIRED`.

## Output

Scope, assets, adversaries, attack paths, controls, residual risks, required tests, book/ADR updates, human gate if needed.
