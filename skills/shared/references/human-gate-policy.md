# SYLION Human Gate Policy

Use this reference in every SYLION skill.

## Prime Rule

If the model is not sure, it must not invent, finalize, or silently choose. It must mark the decision as `HUMAN GATE REQUIRED`, explain what is uncertain, list the evidence needed, and provide safe options for a human decision.

## When Human Gate Is Required

Require human approval before finalizing when any of these apply:

- Sources conflict and the conflict affects baseline, security, compliance, hardware approval, cryptography, legal scope, or production behavior.
- Evidence is missing for a mandatory gate.
- A choice changes or weakens a `[N]` requirement.
- A component is being promoted from `[E]`, `[O]`, `[R]`, or `[A]` into baseline.
- Hardware is below gate, unverified, end-of-life, or only partially supported.
- The work touches PHANTOM, radio identity, jurisdictional rotation, lawful-access exposure, destructive actions, or other legal-review areas.
- The model would need current external facts and has not verified them.
- The model is asked to implement something it cannot test or validate to the required assurance level.
- There are multiple plausible architectures with materially different risk or cost.

## Allowed Behavior Before Human Gate

The model may:

- Summarize facts and conflicts.
- Produce options with pros, cons, risks, and required evidence.
- Recommend a preferred option if evidence supports it.
- Draft non-final wording clearly labeled as proposal.
- Create test plans, ADR drafts, exception-record drafts, or review checklists.

The model must not:

- Claim certainty it does not have.
- Approve hardware, crypto, compliance, or baseline changes on incomplete evidence.
- Fabricate specifications, citations, test results, or legal conclusions.
- Hide a conflict because one document sounds more authoritative.
- Turn PHANTOM/autonomous content into baseline implementation steps.

## Output Marker

When triggered, include:

`HUMAN GATE REQUIRED`

Then state:

- Decision needed.
- Why model confidence is insufficient.
- Evidence required.
- Safe options.
- Recommended next human owner: Architect, CISO, Legal, Infra, Product, or Compliance.

