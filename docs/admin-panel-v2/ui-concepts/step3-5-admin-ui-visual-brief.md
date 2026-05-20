# SYLION Admin V2 Step 3.5 - UI Visual Brief

## Purpose

Ten brief opisuje kierunek wizualny dla premium admin cockpit oraz prompt do wygenerowania mockupu koncepcyjnego.

## Product Feeling

```text
quiet premium security operations cockpit
fast to scan
beautiful but not decorative
modern enterprise-grade
serious, confident, precise
```

## Layout Direction

```text
left navigation rail
top status bar with health and session state
overview dashboard with compact operational bands
right-side action required queue
PHANTOM governance tab as separated review/control area
tables for audit and approvals
small ? helptips near sensitive controls
no marketing hero
no nested cards
```

## Visual Tokens Draft

```text
background: #f6f8f9
surface: #ffffff
surface-alt: #eef3f4
ink: #12191f
muted: #64717a
line: #d9e1e5
primary: #0f766e
primary-dark: #075e54
review: #b7791f
danger: #b42318
phantom-marker: #00a6b2
radius: 6px to 8px
font: Inter/system sans
icon style: simple line icons, one-color except severity states
```

## Components

```text
StatusStrip
MetricTile
ActionQueueRow
BoundaryCard
ApprovalTable
CapabilityRegistryTable
RiskRegisterTable
HelpTip
AuditTable
SidePanel
```

## HelpTip Rules

```text
small circular ? beside label
visible on hover and keyboard focus
tooltip max 220px width
short operational text
never hide critical warning only inside tooltip
```

## Image Generation Prompt

```text
Use case: ui-mockup
Asset type: visual concept for SYLION Admin V2 Step 3.5
Primary request: create a high-quality modern enterprise admin dashboard mockup for a secure communications platform with a dedicated PHANTOM Governance tab.
Scene/backdrop: full desktop application screen, not a marketing landing page.
Subject: premium security operations cockpit with left navigation, top status bar, overview metrics, action required queue, audit table, and PHANTOM governance panel showing separate-track, HUMAN GATE, Legal/CISO review, risk register, and sideEffectAllowed=false.
Style/medium: polished product UI mockup, crisp realistic app interface, high-end SaaS/admin console, dense but readable.
Composition/framing: 16:9 desktop screenshot style, straight-on view, clean spacing, stable grid, no overlapping text.
Lighting/mood: bright neutral workspace, precise and calm.
Color palette: cool white surfaces, near-black ink, neutral gray lines, deep teal primary accents, amber review warnings, restrained red danger accents, subtle graphite plus signal cyan for PHANTOM separate-track marker.
Text (verbatim): "SYLION Admin", "PHANTOM Governance", "HUMAN GATE", "Separate Track", "Legal Review", "CISO Review", "sideEffectAllowed=false", "CDR Mandatory".
Constraints: UI must look usable, modern, beautiful, and operational; include small circular question-mark help tips near key controls; no decorative orbs; no gradient blob background; no marketing hero; no sci-fi fantasy; no code snippets; no sensitive operational PHANTOM details.
Avoid: stealth instructions, radio identity details, evasion language, clutter, unreadable tiny text, purple-dominated palette, dark-only theme, nested cards.
```

## Generated Asset

```text
docs/admin-panel-v2/assets/step3-5-admin-ui-concept.png
```

Ten obraz jest kierunkiem wizualnym dla implementacji UI. Nie jest dowodem funkcjonalnym i nie oznacza, ze PHANTOM jest czescia certyfikowalnego baseline.

## Implementation Note

Generated image is visual direction only. Production UI must be implemented as accessible HTML/CSS/JS and verified with browser checks.
