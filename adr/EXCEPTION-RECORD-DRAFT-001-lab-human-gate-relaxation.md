# EXCEPTION RECORD DRAFT 001 - Lab Human-Gate Relaxation Request

| Field | Value |
|---|---|
| Status | `DRAFT - NOT APPROVED - NOT IN EFFECT` |
| Type | Human-gate exception request |
| Raised by | Operator via agent session, 2026-05-29 |
| Decision owners | Legal counsel, CISO, Architect, Compliance/Product |
| Hard invariant in question | `productionExecutionAllowed=false`, ADR-002 cellular identity mutation prohibition, PHANTOM prohibited-terms guard |

This record is a non-effective draft. It does not relax, remove, or bypass any SYLION control.

## Current Decision

The blanket request to remove human gates is rejected for product execution. Non-prohibited, reversible lab work can continue under existing controls. Product code must not implement or execute public-network cellular identity mutation.

ADR-002 now supersedes earlier draft language and explicitly rejects product support for:

- IMEI override or write,
- IMSI programming for public mobile networks,
- Ki/OPc writing,
- TAC spoofing,
- modem unlock routines for identity mutation,
- boot-time cellular identity rotation,
- public-network identity spoofing.

## Remediation

Earlier working-tree concepts for router cellular identity mutation have been replaced by:

- metadata-only cellular inventory,
- terminal admission policy,
- hard-deny policy for prohibited cellular actions,
- audit records without raw IMEI/IMSI/ICCID values.

Any future RF lab research must be isolated from public mobile networks and approved by Legal + CISO + Architect outside the product runtime.

## Safe Scope For Lab Work

Allowed:

- Pixel/Puli/G1/G2/workload path testing,
- router posture testing,
- IPsec and kill-switch testing,
- CDR tests,
- workload reset/recreate tests,
- metadata-only cellular inventory.

Not allowed:

- changing public-network radio identifiers,
- storing raw SIM identifiers or SIM secrets,
- disabling PHANTOM prohibited-term controls,
- flipping `productionExecutionAllowed` to true without formal release gate,
- removing four-eyes governance for destructive or legally sensitive operations.

## Sign-Off

No owner approval is recorded.

| Role | Name | Date | Decision |
|---|---|---|---|
| Legal counsel |  |  |  |
| CISO |  |  |  |
| Architect |  |  |  |
| Compliance/Product |  |  |  |
