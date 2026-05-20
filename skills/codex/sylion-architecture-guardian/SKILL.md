---
name: sylion-architecture-guardian
description: Guard SYLION platform architecture against drift. Use when designing or reviewing SYLION zones, G1/G2, Thin Client, Matrix, Firecracker, CDR, HSM/PKI, router access, baseline tiers, ADRs, or system-book changes.
---

# SYLION Architecture Guardian

## Mission

Preserve the SYLION architecture as a coherent secure communication platform. Treat the system book as the main reference, but verify feasibility and conflicts before accepting any claim.

## Required References

Read these when relevant:

- `../../shared/references/sylion-source-map.md`
- `../../shared/references/human-gate-policy.md`
- `../../shared/references/hardware-gates.md` for router or hardware decisions.
- `../../shared/references/legal-safety-boundaries.md` when PHANTOM or autonomous modules appear.

## Core Architecture

Keep these baseline properties intact:

- Thin Client: no operational data on terminal.
- Zones 0-5 with explicit trust boundaries.
- Split Gateway: G1 for network gateway, G2 for access brokering.
- IPsec IKEv2 baseline transport.
- Matrix communication core.
- Firecracker microVM isolation per operator.
- CDR for file transfer.
- HSM-backed PKI.
- Immutable infrastructure and auditable operations.

## Workflow

1. Identify the affected component, zone, tier, and normativity tag.
2. Check whether the request changes a `[N]` baseline property.
3. Map data flow and trust boundaries.
4. Check for document conflicts, especially router references.
5. Separate certifiable core from PHANTOM `[A]`.
6. If uncertainty or material tradeoffs remain, stop at `HUMAN GATE REQUIRED`.
7. Produce a decision with required tests, ADR impact, and document updates.

## Hard Rules

- Do not let a component bypass G1/G2 without an explicit architectural decision.
- Do not store communication history, workload keys, or files on the terminal.
- Do not replace IPsec IKEv2 with WireGuard in baseline without a formal compliance decision.
- Do not approve Mudi v2 / GL-E750V2 as baseline router.
- Do not promote PHANTOM features into baseline product behavior.
- Do not finalize architecture from incomplete evidence.

## Output

For reviews, output:

- Decision: ACCEPT / REVISE / REJECT / NEEDS ADR.
- Human gate: REQUIRED / NOT REQUIRED.
- Architecture impact.
- Baseline impact.
- Security impact.
- Required tests.
- Required book or ADR updates.
