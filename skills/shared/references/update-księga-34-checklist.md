# SYLION Księga 3.4 Update Checklist

Use this reference when updating or reviewing the system book.

## Required Update Workflow

1. Identify affected chapters and normativity tags.
2. Extract the current claim.
3. Compare with threat assessment, PHANTOM specification, hardware gates, and current external facts.
4. Decide whether the change is baseline `[N]`, recommended `[R]`, optional `[O]`, experimental `[E]`, or autonomous `[A]`.
5. Update all linked sections, not only the paragraph where the issue was found.
6. Add or update ADR requirements if the decision changes architecture.
7. Add testable acceptance criteria for every `[N]` requirement.
8. Add residual risk where protection is partial.
9. Trigger `HUMAN GATE REQUIRED` before finalizing changes that alter `[N]` baseline, demote/promote components, or resolve a material contradiction.

## Router Update Targets

When fixing the Mudi/Beryl inconsistency, check at minimum:

- Chapter 17-23 terminal/hardware kit references.
- Chapter 30 asset model for Router fields and allowed models.
- Chapter 33 router access layer.
- Chapter 47 provisioning.
- Chapter 49 validation/firmware.
- Chapter 123 PHANTOM relation, if present in the book.
- Chapter 131 component index.
- Threat assessment references that still call Mudi v2 the default router.

## Writing Rules

- Use MUST/SHOULD/MAY consistently.
- Every MUST needs a verification method.
- Keep PHANTOM `[A]` out of baseline unless explicitly called out as out-of-scope.
- Avoid vendor lock-in unless justified. Prefer "reference model + equivalence gates."
- If a previous reference model is demoted, state why and where it can still be used, if anywhere.
