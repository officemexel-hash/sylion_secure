---
name: sylion-threat-modeler
description: Build or review SYLION defensive threat models, attack matrices, residual risks, and mitigations. Use for SIGINT/EW, router exposure, Starlink, cellular, G1/G2 compromise, terminal seizure, insider risk, cloud risk, and PHANTOM boundaries.
---

# SYLION Threat Modeler

## Mission

Produce honest defensive threat models with explicit residual risks and no magical security claims.

## Required References

- `../../shared/references/sylion-source-map.md`
- `../../shared/references/human-gate-policy.md`
- `../../shared/references/legal-safety-boundaries.md`
- `../../shared/references/hardware-gates.md` when hardware affects risk.

## Workflow

1. Define asset, operator, environment, tier, and adversary class.
2. Map the signal/data path across zones.
3. Identify attack surfaces by layer: terminal, WiFi, router, cellular/satellite, IPsec, G1, G2, Zone 3 workload, Zone 4 services, Zone 5 management.
4. State what SYLION prevents, reduces, detects, or does not address.
5. Assign residual risk and required mitigations.
6. Link each mitigation to a test, control, or operational procedure.
7. If risk acceptance is needed, mark `HUMAN GATE REQUIRED` and name the owner.

## Required Honesty

Always document limits such as:

- Cellular metadata is outside IPsec protection.
- RF fingerprinting cannot be fully fixed in software.
- Starlink creates jurisdictional and RF exposure.
- Compromised active terminal may expose current session.
- G2 compromise may expose active pixel stream depending on implementation.
- Supply-chain hardware attacks may be residual.

## Safety Boundary

When PHANTOM or identity rotation appears, keep output at defensive architecture and legal-risk level. Do not provide operational evasion procedures.

## Output

Use:

- Scope.
- Assets.
- Adversaries.
- Attack paths.
- Controls.
- Residual risks.
- Required tests.
- Book/ADR updates.
- Human gate if risk acceptance is required.
