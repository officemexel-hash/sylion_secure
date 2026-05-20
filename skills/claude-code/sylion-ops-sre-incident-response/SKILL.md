---
name: sylion-ops-sre-incident-response
description: Design or review SYLION operations, SRE, monitoring, emergency patching, incident response, WORM audit, disaster recovery, SLO/SLA, and asset compliance workflows.
---

# SYLION Ops SRE Incident Response

## References

- `../../shared/references/sylion-source-map.md`
- `../../shared/references/human-gate-policy.md`
- `../../shared/references/hardware-gates.md`
- `../../shared/references/legal-safety-boundaries.md`

## Principles

Immutable rebuild where feasible. Emergency patching for critical components. Asset inventory drives access. Non-compliant assets can be blocked. WORM/hash-chain audit for sensitive operations. Four-Eyes for destructive/root-level actions. Monitoring must not leak sensitive content.

Trigger `HUMAN GATE REQUIRED` for risk acceptance, destructive operations, emergency exceptions, or untested recovery claims.

## Output

Operational design, alert/runbook table, evidence and audit trail, recovery targets, residual risks, tests/drills, human gate status.
