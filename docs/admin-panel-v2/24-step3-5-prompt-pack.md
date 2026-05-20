# SYLION Admin Panel V2 - Step 3.5 Prompt Pack

## Instrukcja Wspolna

Wklej na poczatku kazdego prompta:

```text
Pracujesz w repo SYLION Secure. Obowiazuja invariants Ksiegi 3.4:
- PHANTOM v3.0 jest osobnym torem [A], poza certyfikowalnym baseline.
- Nie implementuj autonomicznego PHANTOM execution.
- Nie dodawaj instrukcji operacyjnych dla evasion, radio identity, IMEI/IMSI, stealth transport, lawful-control bypass, ani destructive cover-up.
- Panel moze pokazac governance, approvals, evidence, risk, audit i statusy.
- Każdy PHANTOM action musi byc auditowany i domyslnie sideEffectAllowed=false.
- HUMAN GATE REQUIRED przed jakimkolwiek production PHANTOM behavior.
- Provider secrets, private keys, PIN, biometrics, communication content i PHANTOM operational parameters nie moga wyciekac do UI/API/audit/logow.
- CDR, G1/G2, 3 VPS per operator, Puli AX gate i WebAuthn hardening pozostaja nienaruszone.

Use existing code patterns. Keep edits scoped. Add negative tests. Run npm.cmd test.
```

## Prompt S3.5-A - PHANTOM Governance Boundary

```text
Implement S3.5-A PHANTOM Governance Boundary.

Scope:
- Add service module under services/admin-api/src/modules/phantom/.
- Add model for boundary state:
  disabled_by_default, review_only, approved_placeholder, blocked.
- Add fields:
  baselineBoundary, phantomBoundary, humanGateRequired, sideEffectAllowed=false.
- Add endpoints:
  GET /phantom/boundary
  POST /phantom/boundary/status
- Add audit events:
  phantom.boundary_read
  phantom.boundary_status_changed
- Add RBAC:
  phantom.boundary.read
  phantom.boundary.manage_placeholder

Acceptance:
- No endpoint executes PHANTOM behavior.
- sideEffectAllowed is always false in Step 3.5.
- HUMAN GATE is always true.
- Support readonly cannot mutate.
- npm.cmd test passes.
```

## Prompt S3.5-B - PHANTOM Capability Registry

```text
Implement S3.5-B PHANTOM Capability Registry.

Scope:
- Add redacted capability registry.
- Fields:
  id, displayName, classification, riskLevel, legalReviewStatus,
  cisoReviewStatus, implementationStatus, controlsRequired, evidenceRefs.
- Add endpoints:
  GET /phantom/capabilities
  POST /phantom/capabilities
  POST /phantom/capabilities/:id/status
- Add RBAC and audit.

Hard guardrails:
- Do not store operational steps.
- Do not expose evasion parameters.
- Do not expose radio identity details.
- Do not describe how to bypass lawful controls.

Acceptance:
- Capability entries are governance metadata only.
- approved_placeholder does not enable execution.
- audit has no prohibited details.
```

## Prompt S3.5-C - PHANTOM Approval Workflow

```text
Implement S3.5-C PHANTOM Approval Workflow.

Scope:
- Add approval request model:
  draft, legal_review_required, ciso_review_required,
  architect_review_required, rejected, approved_placeholder, blocked, closed.
- Add endpoints:
  GET /phantom/approvals
  POST /phantom/approvals
  POST /phantom/approvals/:id/status
- Required fields:
  capabilityId, reasonCode, requester, legalOwner, cisoOwner, architectOwner,
  evidenceRefs, status, humanGateRequired=true, sideEffectAllowed=false.

Acceptance:
- approved_placeholder never executes.
- all status changes audited.
- RBAC denies unsupported roles.
- no PHANTOM behavior enters baseline.
```

## Prompt S3.5-D - PHANTOM Evidence And Risk Register

```text
Implement S3.5-D PHANTOM Evidence And Risk Register.

Scope:
- Add risk/evidence model:
  id, capabilityId, description, severity, jurisdictionNotes,
  legalOwner, cisoOwner, residualRisk, mitigationPlan, evidenceRefs.
- Add endpoints:
  GET /phantom/risks
  POST /phantom/risks
  POST /phantom/risks/:id/status
- Add audit events and RBAC.

Acceptance:
- Entries contain risk/governance language only.
- No operational evasion instructions.
- Severity and residual risk are visible in UI.
```

## Prompt S3.5-E - Premium Admin Dashboard IA

```text
Implement S3.5-E Premium Admin Dashboard IA.

Scope:
- Restructure apps/admin-web/index.html and app.js navigation:
  Overview, Operators, Provisioning, Devices, Providers, Security, PHANTOM, Audit, Settings.
- Dashboard should show:
  system health strip, operator risk, provisioning queue, security gates,
  CDR activity, PHANTOM governance status, action required queue, recent audit.
- Keep existing workflows functional.

Design constraints:
- no marketing landing page
- no nested cards
- no decorative gradient blobs
- dense, readable operational cockpit
- responsive with no overlap
```

## Prompt S3.5-F - UI Visual System And Layout Refresh

```text
Implement S3.5-F UI Visual System And Layout Refresh.

Scope:
- Update styles.css with design tokens.
- Use a premium quiet security cockpit look.
- Add layout utilities for status strips, split panes, compact tables and action bars.
- Keep cards <= 8px radius.
- Avoid one-note purple/blue/slate palette.
- Use restrained teal/graphite/amber/red accents.

Acceptance:
- UI looks modern and cohesive.
- Text does not overflow controls.
- Mobile layout remains readable.
- Existing tests pass.
```

## Prompt S3.5-G - HelpTip / Tooltip System

```text
Implement S3.5-G HelpTip / Tooltip System.

Scope:
- Add reusable help tip markup and CSS.
- Use small circular ? controls next to sensitive labels.
- Tooltip appears on hover and focus.
- Add aria-describedby or equivalent accessible label.
- Add helptips for:
  PHANTOM Boundary, HUMAN GATE, approved_placeholder,
  sideEffectAllowed=false, CDR mandatory, Provider secret reference,
  WebAuthn mode, Credential revoke, Jurisdictional policy, Puli AX gate.

Acceptance:
- Tooltip text is short and operational.
- No long instructional copy in main UI.
- Keyboard focus shows tooltip.
```

## Prompt S3.5-H - Visual Concept Asset And Design Tokens

```text
Implement S3.5-H Visual Concept Asset And Design Tokens.

Scope:
- Generate a high-quality UI mockup image concept for the SYLION Admin premium cockpit.
- Save final selected image into docs/admin-panel-v2/assets/.
- Add docs/admin-panel-v2/ui-concepts/step3-5-admin-ui-visual-brief.md.
- Include design tokens:
  color, spacing, typography, icon style, grid, states, tooltip styling.

Acceptance:
- Concept shows Overview + PHANTOM governance tab direction.
- It is visual direction only, not production UI.
- It does not imply PHANTOM baseline execution.
```

## Prompt S3.5-I - Security UX And Compliance Tests

```text
Implement S3.5-I Security UX And Compliance Tests.

Scope:
- API tests:
  PHANTOM no side effect
  RBAC denial
  status change audit
  approved_placeholder does not execute
- Static UI tests:
  PHANTOM nav exists
  helptips exist
  boundary cards exist
- Browser check:
  /admin loads
  PHANTOM view visible after nav click
  tooltip anchor present
  no obvious text overlap

Acceptance:
- npm.cmd test passes.
- audit contains no prohibited details.
- PHANTOM remains separate track.
```

## Integration Prompt I1 - PHANTOM Backend Join

```text
Integrate S3.5-A/B/C/D.

Tasks:
- Ensure PHANTOM service uses one consistent boundary language.
- Ensure all PHANTOM records include humanGateRequired=true and sideEffectAllowed=false.
- Ensure RBAC permissions are coherent.
- Ensure audit events do not leak prohibited details.
- Run PHANTOM-focused tests, then npm.cmd test.
```

## Integration Prompt I2 - Admin UX Join

```text
Integrate S3.5-E/F/G/H.

Tasks:
- Apply visual system without breaking existing forms.
- Add PHANTOM view and tooltip anchors.
- Keep all controls accessible and compact.
- Use generated UI concept as direction, not as a blind screenshot copy.
- Run static admin-web tests and browser verification.
```

## Integration Prompt I3 - Architecture And Compliance Review

```text
Review Step 3.5 for architecture and legal safety.

Findings first:
- Any PHANTOM operational behavior?
- Any baseline certification claim?
- Any evasion/radio identity/lawful-control bypass details?
- Any hidden side effect?
- Any audit leakage?
- Any UI wording implying PHANTOM is production baseline?

Output:
- file/line findings
- required fixes
- residual risks
- HUMAN GATE owner
```

## Final Human Test Prompt

```text
Act like a human Global Super Admin testing SYLION Admin V2 Step 3.5.

Run:
1. Open /admin.
2. Confirm premium dashboard layout loads.
3. Confirm PHANTOM nav item exists.
4. Open PHANTOM view.
5. Confirm boundary status shows separate-track, humanGateRequired=true, sideEffectAllowed=false.
6. Hover/focus help ? near PHANTOM Boundary and HUMAN GATE.
7. Confirm tooltip explains governance-only behavior.
8. Create a PHANTOM approval request.
9. Change status to approved_placeholder.
10. Confirm no execution side effect happened.
11. Add risk register entry.
12. Confirm audit records status changes.
13. Inspect UI and audit for prohibited details.
14. Confirm dashboard remains readable on mobile width.
15. Run npm.cmd test.

Expected:
- PHANTOM is visible and governable.
- PHANTOM is not executable.
- Human gate and legal/CISO review are clear.
- UI is modern, beautiful, intuitive and usable.
```
