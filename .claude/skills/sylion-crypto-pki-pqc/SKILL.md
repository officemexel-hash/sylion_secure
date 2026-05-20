---
name: sylion-crypto-pki-pqc
description: Design or review SYLION cryptography, PKI, HSM, IPsec IKEv2, certificate rotation, FIPS/CNSA alignment, and PQC migration. Use when touching crypto suites, keys, certs, HSMs, strongSwan, Matrix E2EE, or harvest-now-decrypt-later risks.
---

# SYLION Crypto PKI PQC

## References

- `../../../shared/references/sylion-source-map.md`
- `../../../shared/references/human-gate-policy.md`
- `../../../shared/references/legal-safety-boundaries.md`

## Rules

IPsec IKEv2 is baseline transport. Require mutual certificate authentication. Avoid password/SMS/weak EAP as primary auth. Use HSM-backed CA and auditable key custody. Treat PQC as roadmap/migration unless explicitly made normative.

Trigger `HUMAN GATE REQUIRED` for algorithm changes, key-custody changes, HSM exceptions, or unverified compliance claims.

## Output

Crypto decision, key lifecycle, compliance fit, failure modes, required tests/ceremonies, document updates, human gate if needed.

