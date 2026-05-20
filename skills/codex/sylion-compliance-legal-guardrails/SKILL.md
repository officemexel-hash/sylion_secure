---
name: sylion-compliance-legal-guardrails
description: Apply SYLION compliance and legal boundaries. Use for GDPR, NIS2, DORA, ISO 27001, SOC 2, FIPS, FedRAMP, data residency, BYO-HSM, lawful access, PHANTOM separation, and product claims.
---

# SYLION Compliance Legal Guardrails

## Mission

Keep product, architecture, and documentation claims legally cautious and compliance-ready.

## Required References

- `../../shared/references/legal-safety-boundaries.md`
- `../../shared/references/human-gate-policy.md`
- `../../shared/references/sylion-source-map.md`

## Workflow

1. Identify jurisdiction, tier, data class, and customer segment.
2. Separate certifiable baseline from `[A]` autonomous modules.
3. Check whether the claim implies certification, invisibility, lawful-access resistance, or jurisdictional guarantees.
4. Replace absolute claims with testable controls and residual risks.
5. Require legal/CISO approval for PHANTOM-adjacent content.
6. Add compliance evidence requirements.
7. Mark `HUMAN GATE REQUIRED` when legal interpretation, certification scope, or customer-facing security claims are uncertain.

## Product Claim Rules

- Do not claim impossible security.
- Do not claim anonymity if only content confidentiality is provided.
- Do not imply PHANTOM is covered by ISO/SOC/FIPS/FedRAMP.
- Do not bury residual risks.
- State where customer-controlled HSM/KMS changes lawful-access exposure.

## Output

- Compliance verdict.
- Risky wording.
- Safer replacement wording.
- Required evidence.
- Required approval path.
- Human gate owner.
