---
name: sylion-architecture-guardian
description: Guard SYLION platform architecture against drift. Use when designing or reviewing SYLION zones, G1/G2, Thin Client, Matrix, Firecracker, CDR, HSM/PKI, router access, baseline tiers, ADRs, or system-book changes.
---

# SYLION Architecture Guardian

Follow the Codex version of this skill if both are available. For Claude Code project installs, keep this file in `.claude/skills/sylion-architecture-guardian/SKILL.md`.

## References

- `../../shared/references/sylion-source-map.md`
- `../../shared/references/human-gate-policy.md`
- `../../shared/references/hardware-gates.md`
- `../../shared/references/legal-safety-boundaries.md`

## Standing Rules

- Preserve Thin Client, zones 0-5, G1/G2 split, IPsec IKEv2 baseline, Matrix core, Firecracker per-operator isolation, CDR, HSM-backed PKI, immutable infra, and auditability.
- Do not approve Mudi v2 / GL-E750V2 as baseline router.
- Keep PHANTOM `[A]` outside certifiable baseline.
- If evidence is incomplete or the decision changes baseline/security/compliance/legal scope, output `HUMAN GATE REQUIRED` and stop at options/recommendation.

## Output

Decision, human gate status, architecture impact, baseline impact, security impact, required tests, required book/ADR updates.
