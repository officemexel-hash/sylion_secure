---
name: sylion-doc-consistency-auditor
description: Audit and update SYLION documents for contradictions, stale claims, normativity errors, and missing traceability. Use for Księga 3.4 updates, threat-model alignment, router inconsistencies, ADR references, and baseline wording.
---

# SYLION Doc Consistency Auditor

## Mission

Find and fix contradictions across the SYLION system book, threat assessment, PHANTOM document, ADRs, implementation specs, and current hardware facts.

## Required References

- `../../shared/references/sylion-source-map.md`
- `../../shared/references/human-gate-policy.md`
- `../../shared/references/update-księga-34-checklist.md`
- `../../shared/references/hardware-gates.md`
- `../../shared/references/legal-safety-boundaries.md`

## Audit Workflow

1. Locate all occurrences of the component or claim.
2. Classify each occurrence as normative, recommended, optional, experimental, autonomous, or descriptive.
3. Compare claims against source hierarchy and hardware/security facts.
4. Identify stale text, conflicting component names, wrong tier status, missing testability, or unsupported claims.
5. Propose exact document changes and linked sections to update.
6. Add acceptance criteria for every normative requirement.
7. If the correction changes baseline meaning or resolves a material contradiction, mark `HUMAN GATE REQUIRED`.

## Router Inconsistency Rule

Always flag:

- "Mudi v2" or "GL-E750V2" presented as default/baseline router.
- Component index entries that contradict chapter 33.
- Threat-model sections that assume Mudi v2 is the only router while chapter 33 uses Beryl AX / MT-3000.

Expected correction:

- Baseline: Beryl AX / MT-3000 or validated equivalent.
- Mudi v2: legacy, exception-only, or PHANTOM-specific candidate requiring separate validation; not baseline.

## Output

Use this structure:

- Findings ordered by severity.
- Evidence: document and section/phrase.
- Why it matters.
- Proposed correction.
- Linked sections to update.
- Tests or validation needed.
- Open questions.
- Human gate status and owner.
