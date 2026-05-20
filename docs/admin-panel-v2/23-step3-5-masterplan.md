# SYLION Admin Panel V2 - Step 3.5 Masterplan

## Nazwa Etapu

```text
V2 Step 3.5 - PHANTOM Governance Boundary And Premium Admin UX
```

## Decyzja Architektoniczna

```text
Decision: ACCEPT AS GOVERNANCE-ONLY PLANNING STEP
Human gate: REQUIRED before any operational PHANTOM behavior
Baseline impact: adds admin visibility and control boundary, not execution
PHANTOM impact: creates separate-track governance surface
Ksiega 3.4 impact: must label PHANTOM as outside certifiable core
```

## Strategia

Step 3.5 ma przygotowac panel administratora do obslugi PHANTOM bez mieszania go z baseline SYLION Secure.

Zasada glowna:

```text
PHANTOM can be governed, reviewed, risk-rated, and audited from the admin panel,
but cannot execute, bypass, hide, rotate identity, or alter baseline controls without HUMAN GATE.
```

## Moduly Step 3.5

```text
S3.5-A PHANTOM Governance Boundary
S3.5-B PHANTOM Capability Registry
S3.5-C PHANTOM Approval Workflow
S3.5-D PHANTOM Evidence And Risk Register
S3.5-E Premium Admin Dashboard IA
S3.5-F UI Visual System And Layout Refresh
S3.5-G HelpTip / Tooltip System
S3.5-H Visual Concept Asset And Design Tokens
S3.5-I Security UX And Compliance Tests
```

## S3.5-A PHANTOM Governance Boundary

Cel:

```text
Dodac jawny modul panelu: PHANTOM Governance, oddzielony od baseline.
```

Zakres:

```text
new Admin Web navigation item: PHANTOM
backend model: phantom_governance_boundary
status: disabled_by_default / review_only / approved_placeholder
baselineBoundary: SYLION_BASELINE_SEPARATE
phantomBoundary: PHANTOM_V3_SEPARATE_TRACK
humanGateRequired: true
sideEffectAllowed: false
audit events for boundary reads/updates
```

Zakazy:

```text
brak wykonywania operacji PHANTOM
brak obejscia G1/G2
brak ukrywania ruchu lub tozsamosci
brak radio identity manipulation
brak autonomicznego behavior
```

## S3.5-B PHANTOM Capability Registry

Cel:

```text
Pokazac rejestr zdolnosci PHANTOM jako redacted governance metadata.
```

Zakres:

```text
capability id
display name
classification: A/autonomous separate track
risk level
legal review status
CISO review status
implementation status: not_enabled / review_only / blocked / approved_placeholder
controls required
evidence references
```

Zakazy:

```text
brak instrukcji operacyjnych
brak parametrów evasion
brak danych radio identity
brak konfiguracji wykonawczej
```

## S3.5-C PHANTOM Approval Workflow

Cel:

```text
Dodac workflow approval, ktory wymusza Legal/CISO/Architect gate.
```

Statusy:

```text
draft
legal_review_required
ciso_review_required
architect_review_required
rejected
approved_placeholder
blocked
closed
```

Acceptance:

```text
approved_placeholder nie wlacza wykonania
kazda zmiana statusu jest audytowana
support readonly nie moze zmieniac statusu
Legal/CISO approvals sa modelowane jako evidence, nie jako automatyczna zgoda na execution
```

## S3.5-D PHANTOM Evidence And Risk Register

Cel:

```text
Utworzyc miejsce na ryzyka, dowody, decyzje i residual risk dla PHANTOM-adjacent work.
```

Zakres:

```text
risk id
description
severity
affected capability
jurisdiction notes
legal owner
ciso owner
residual risk
mitigation plan
evidence refs
audit trail
```

## S3.5-E Premium Admin Dashboard IA

Cel:

```text
Przebudowac informacyjna architekture panelu na nowoczesny operational cockpit.
```

Widoki:

```text
Overview
Operators
Provisioning
Devices
Providers
Security
PHANTOM
Audit
Settings
```

Dashboard:

```text
system health strip
operator risk summary
provisioning queue
security gates
CDR activity
PHANTOM governance status
recent audit
action required queue
```

## S3.5-F UI Visual System And Layout Refresh

Cel:

```text
Stworzyc piekny, nowoczesny, uzytkowy panel administratora.
```

Design rules:

```text
quiet premium security cockpit
dense but readable operational layout
8px max card radius unless component requires less
no nested cards
no landing page / no hero marketing
icons for common actions
stable grid dimensions
responsive without overlapping text
no one-note purple/blue/slate palette
no decorative gradient orbs
```

Proposed palette:

```text
ink: near black
surface: cool white
line: neutral gray
primary: deep teal
accent: amber for review gates
danger: restrained red
phantom track: graphite + signal cyan as secondary marker, not dominant theme
```

## S3.5-G HelpTip / Tooltip System

Cel:

```text
Dodac male kolka z pytajnikiem przy kluczowych kontrolkach.
```

Zakres:

```text
reusable HelpTip component
hover/focus tooltip
keyboard accessible
aria-describedby
short operational explanations
no long instructional copy in main UI
```

Pierwsze helptipy:

```text
PHANTOM Boundary
HUMAN GATE
approved_placeholder
sideEffectAllowed=false
CDR mandatory
Provider secret reference
WebAuthn mode
Credential revoke
Jurisdictional policy
Puli AX qualification gate
```

## S3.5-H Visual Concept Asset And Design Tokens

Cel:

```text
Zwizualizowac kierunek UI przed implementacja.
```

Output:

```text
high-quality UI mockup image for planning
design tokens draft
layout zones
component inventory
tooltip placement examples
PHANTOM governance tab visual treatment
```

## S3.5-I Security UX And Compliance Tests

Cel:

```text
Potwierdzic, ze UI jest piekny i uzyteczny, ale nie narusza baseline ani legal boundary.
```

Tests:

```text
static DOM anchors for PHANTOM nav, boundary cards, helptips
API tests for PHANTOM governance read/create/status update
RBAC denial tests
audit leakage tests
PHANTOM no side effect tests
browser screenshot/DOM visual check
responsive no-overlap check
npm.cmd test passes
```

## Kolejnosc Implementacji

```text
1. S3.5-A Governance boundary model and read-only API
2. S3.5-B Capability registry metadata model
3. S3.5-C Approval workflow placeholder
4. S3.5-D Evidence/risk register
5. S3.5-G HelpTip component
6. S3.5-E Dashboard IA restructure
7. S3.5-F Visual system refresh
8. S3.5-H Image concept and design tokens
9. S3.5-I tests and browser verification
10. docs/status update and freeze package
```

## Release Gates

```text
Gate 1: PHANTOM is disabled_by_default or review_only.
Gate 2: no PHANTOM endpoint executes operational behavior.
Gate 3: every PHANTOM status change is audited.
Gate 4: Legal/CISO/Architect gates are visible.
Gate 5: PHANTOM UI never claims baseline certification.
Gate 6: HelpTips exist for sensitive controls.
Gate 7: dashboard is visually coherent and responsive.
Gate 8: no secrets, operational PHANTOM parameters, or communication content leak.
Gate 9: npm.cmd test passes.
Gate 10: browser verification confirms UI anchors and no obvious overlap.
```
