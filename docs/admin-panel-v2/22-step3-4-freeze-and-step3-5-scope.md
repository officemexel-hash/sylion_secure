# SYLION Admin Panel V2 - Step 3.4 Freeze And Step 3.5 Scope

Data: 2026-05-20

## Frozen Baseline

Zamrazamy stan po implementacji:

```text
22b007a Implement Step 3.4 WebAuthn hardening
```

Step 3.4 jest zamknietym slice baseline:

```text
WebAuthnVerifier boundary
LocalSimulatorVerifier jako jawny dev/test adapter
BrowserWebAuthnVerifier placeholder z HUMAN GATE
Auth Policy Matrix endpoint
Credential Lifecycle list/suspend/revoke
step-up enforcement dla credential suspend/revoke
Admin Web WebAuthn mode selector
Admin Web credential and auth policy cards
manual browser/FIDO2 checklist
39 tests passing
```

## Frozen Security Invariants

Te reguly pozostaja nienaruszalne:

```text
terminal nie przechowuje danych operacyjnych
G1/G2/WORKLOAD pozostaja oddzielnymi warstwami
kazdy operator ma 3 VPS jako baseline izolacji
CDR pozostaje obowiazkowy dla file ingress/egress
provider secrets nie trafiaja do UI/API response/audit/logow jako plaintext
monitoring nie przechowuje tresci komunikacji
Puli AX pozostaje routerem finalnym z gate kwalifikacyjnym
break-glass w baseline nie wykonuje side effect bez HUMAN GATE
PHANTOM v3.0 pozostaje oddzielnym torem i nie jest implementowany jako baseline
Ksiega 3.4 pozostaje zrodlem normatywnym baseline
```

## Next Step Name

```text
V2 Step 3.5 - PHANTOM Governance Boundary And Premium Admin UX
```

## Why This Step

Panel administratora ma zaczac obslugiwac PHANTOM jako oddzielony modul governance:

```text
visibility without execution
legal/CISO approval gates
capability registry without operational instructions
risk and evidence tracking
audit traceability
premium UI/UX foundation for security operations
```

To nie jest wdrozenie autonomicznego PHANTOM w baseline. To jest warstwa kontroli, separacji, zgodnosci i przygotowania panelu, z wyraznym `HUMAN GATE REQUIRED`.

## Step 3.5 Scope

Step 3.5 obejmuje:

```text
M22 PHANTOM Governance Boundary
M23 PHANTOM Capability Registry, redacted and non-operational
M24 PHANTOM Approval Workflow with Legal/CISO gates
M25 PHANTOM Evidence And Risk Register
M26 Admin UX Visual System refresh
M27 HelpTip/Tooltip System
M28 Dashboard Information Architecture
M29 UI Visual Asset Direction and image concept
M30 Security UX Tests and Browser Visual Checks
```

## Out Of Scope

Step 3.5 nie obejmuje:

```text
PHANTOM autonomous execution
radio identity manipulation
IMEI/IMSI spoofing or rotation
stealth transport intended to defeat lawful controls
law-enforcement or regulator evasion behavior
destructive cover-up behavior
production break-glass execution
provider adapter real cloud provisioning
router firmware implementation
```

## Legal And Compliance Boundary

```text
Compliance verdict: PLAN WITH STRICT GUARDRAILS
Risk: PHANTOM-adjacent UI can be misread as certifiable baseline capability.
Required mitigation: every PHANTOM panel area must show separate-track, legal-review, and human-gate state.
Required approval path: Architect + CISO + Legal before any operational PHANTOM feature.
Human gate: REQUIRED
```

## UI/UX Direction

Panel ma przejsc z prostego shell UI do premium operational cockpit:

```text
modern dense dashboard
clear visual hierarchy
beautiful but quiet security aesthetic
no marketing hero page
no decorative gradient blobs
no nested cards
tooltip help circles for sensitive controls
icon-led action controls where possible
responsive layout with stable dimensions
high-quality visual concept asset for direction
```

## Freeze Acceptance

```text
npm.cmd test passes before Step 3.5 implementation
Step 3.4 docs reference HUMAN GATE and PHANTOM separation
Step 3.5 plan includes Mermaid module, dependency, deployment, runtime, UI and roadmap graphs
Prompts are small enough for independent developers/models
Final test prompt validates panel like a human administrator
```
