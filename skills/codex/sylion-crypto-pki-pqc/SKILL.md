---
name: sylion-crypto-pki-pqc
description: Design or review SYLION cryptography, PKI, HSM, IPsec IKEv2, certificate rotation, FIPS/CNSA alignment, and PQC migration. Use when touching crypto suites, keys, certs, HSMs, strongSwan, Matrix E2EE, or harvest-now-decrypt-later risks.
---

# SYLION Crypto PKI PQC

## Mission

Keep SYLION cryptography conservative, auditable, and aligned with baseline compliance goals.

## Required References

- `../../shared/references/sylion-source-map.md`
- `../../shared/references/human-gate-policy.md`
- `../../shared/references/legal-safety-boundaries.md` for PHANTOM key-handling claims.

## Baseline Posture

- IPsec IKEv2 is baseline transport.
- Mutual certificate authentication is required for IPsec.
- Avoid password, SMS, or weak EAP as primary auth.
- Prefer AES-256-GCM, SHA-384 where applicable, and P-384 or approved groups according to current policy.
- HSM-backed CA and key custody are core requirements.
- PQC is a roadmap/migration topic unless a section explicitly makes it normative.

## Workflow

1. Identify the protocol and trust boundary.
2. Identify key owners, storage location, rotation period, revocation path, and audit trail.
3. Check compliance target: FIPS, CNSA, FedRAMP/DoD, sovereign, or internal.
4. Reject unauthenticated or downgrade-prone designs.
5. For PQC, distinguish pilot, hybrid, and full migration states.
6. Produce testable requirements and operational runbook hooks.
7. Trigger `HUMAN GATE REQUIRED` for algorithm changes, key-custody changes, HSM exceptions, or unverified compliance claims.

## Red Flags

- WireGuard proposed as baseline replacement without compliance decision.
- Private keys leaving HSM or secure element without a documented ceremony.
- Long-lived certs without revocation checking.
- Router keys not tied to asset inventory.
- "Future PQC" used as a substitute for current crypto hygiene.

## Output

- Crypto decision.
- Key lifecycle.
- Compliance fit.
- Failure modes.
- Required tests and ceremonies.
- Document updates.
- Human gate if approval is required.
