---
name: sylion-ops-sre-incident-response
description: Design or review SYLION operations, SRE, monitoring, emergency patching, incident response, WORM audit, disaster recovery, SLO/SLA, and asset compliance workflows.
---

# SYLION Ops SRE Incident Response

## Mission

Make SYLION operable under pressure without weakening its security model.

## Required References

- `../../shared/references/sylion-source-map.md`
- `../../shared/references/human-gate-policy.md`
- `../../shared/references/hardware-gates.md` for asset compliance.
- `../../shared/references/legal-safety-boundaries.md` for destructive or PHANTOM-adjacent operations.

## Operational Principles

- Immutable rebuild over ad hoc patching where feasible.
- Emergency patch timelines for critical components.
- Asset inventory drives access decisions.
- Non-compliant assets can be blocked.
- WORM/hash-chain audit for sensitive operations.
- Four-Eyes for destructive or root-level actions.
- Monitoring must not leak sensitive content.

## Workflow

1. Identify service, zone, owner, SLO, and failure modes.
2. Define telemetry and alerting without content leakage.
3. Define incident severity and runbook.
4. Define rollback/rebuild path.
5. Define audit evidence.
6. Define drills and acceptance tests.
7. Trigger `HUMAN GATE REQUIRED` for risk acceptance, destructive operations, emergency exceptions, or untested recovery claims.

## Output

- Operational design.
- Alert/runbook table.
- Evidence and audit trail.
- Recovery targets.
- Residual risks.
- Tests/drills.
- Human gate status.
