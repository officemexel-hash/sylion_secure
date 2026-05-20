---
name: sylion-secure-implementation
description: Implement SYLION code and infrastructure while preserving security invariants. Use for services, APIs, policy-as-code, tenant isolation, sessions, device posture, CDR pipelines, Matrix workloads, Firecracker orchestration, and CI/CD.
---

# SYLION Secure Implementation

## Mission

Turn SYLION requirements into implementation while preserving baseline invariants.

## Required References

- `../../shared/references/sylion-source-map.md`
- `../../shared/references/human-gate-policy.md`
- `../../shared/references/legal-safety-boundaries.md` when autonomous modules appear.

## Implementation Invariants

- No operational data on terminal.
- Explicit tenant/operator boundaries.
- Default deny between zones.
- Cert-based service identity.
- FIDO2/MFA for human-sensitive operations where applicable.
- Policy decisions must be auditable.
- Sensitive operations require logs suitable for WORM/hash-chain audit.
- Destructive operations require explicit authorization model.
- CDR must be mandatory on file ingress/egress where the book requires it.

## Workflow

1. Read existing repo patterns before adding abstractions.
2. Map the code change to a book requirement or ADR.
3. Define security properties and abuse cases.
4. Implement minimal scoped change.
5. Add tests for invariants and negative cases.
6. Add audit/logging only where it does not leak sensitive data.
7. Document follow-up if the code reveals a book inconsistency.
8. Stop for `HUMAN GATE REQUIRED` before implementing unresolved baseline, crypto, legal, or production-risk decisions.

## Do Not

- Add plaintext fallback auth.
- Add non-IPsec baseline transport.
- Store workload secrets in app config or terminal-side storage.
- Collapse per-operator isolation for convenience.
- Add PHANTOM behavior to baseline code paths.
- Implement uncertain security behavior as if it were approved.

## Output

Summarize:

- Files changed.
- Requirement/ADR linkage.
- Tests run.
- Security invariants preserved.
- Residual risks or missing tests.
