---
name: sylion-doc-consistency-auditor
description: Audit and update SYLION documents for contradictions, stale claims, normativity errors, and missing traceability. Use for Księga 3.4 updates, threat-model alignment, router inconsistencies, ADR references, and baseline wording.
---

# SYLION Doc Consistency Auditor

## References

- `../../../shared/references/sylion-source-map.md`
- `../../../shared/references/human-gate-policy.md`
- `../../../shared/references/update-księga-34-checklist.md`
- `../../../shared/references/hardware-gates.md`
- `../../../shared/references/legal-safety-boundaries.md`

## Workflow

Find all occurrences of the claim, classify normativity, compare sources, identify stale/conflicting text, propose exact corrections, and list all linked sections.

Always flag Mudi v2 / GL-E750V2 as baseline/default router text. Current working correction: Beryl AX / GL-MT3000 or validated equivalent for baseline; Mudi v2 is legacy, exception-only, or PHANTOM-specific pending human approval.

If the correction changes baseline meaning, resolves a material contradiction, or lacks evidence, output `HUMAN GATE REQUIRED`.

## Output

Findings, evidence, why it matters, proposed correction, linked sections, tests/validation, open questions, human gate owner.

