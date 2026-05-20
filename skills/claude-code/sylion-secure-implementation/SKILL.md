---
name: sylion-secure-implementation
description: Implement SYLION code and infrastructure while preserving security invariants. Use for services, APIs, policy-as-code, tenant isolation, sessions, device posture, CDR pipelines, Matrix workloads, Firecracker orchestration, and CI/CD.
---

# SYLION Secure Implementation

## References

- `../../shared/references/sylion-source-map.md`
- `../../shared/references/human-gate-policy.md`
- `../../shared/references/legal-safety-boundaries.md`

## Invariants

No operational data on terminal. Explicit tenant/operator boundaries. Default deny between zones. Cert-based service identity. Auditable policy decisions. CDR where required. No PHANTOM behavior in baseline code paths.

Before implementing unresolved baseline, crypto, legal, or production-risk decisions, output `HUMAN GATE REQUIRED`.

## Workflow

Read repo patterns, map change to book/ADR, define security properties and abuse cases, implement scoped change, add invariant and negative tests, document inconsistencies.

## Output

Files changed, requirement/ADR linkage, tests run, security invariants preserved, residual risks or missing tests.
