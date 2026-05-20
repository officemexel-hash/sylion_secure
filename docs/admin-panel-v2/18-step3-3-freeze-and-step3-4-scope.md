# SYLION Admin Panel V2 - Step 3.3 Freeze And Step 3.4 Scope

Data: 2026-05-20

## Frozen Baseline

Zamrazamy stan po implementacji:

```text
07877f4 Implement Step 3.3 recovery lockout placeholders
```

Step 3.3 jest traktowany jako zamkniety slice baseline:

```text
account lockout po powtarzalnych bledach auth/challenge
recovery request bez automatycznego odblokowania
review-only recovery workflow
break-glass placeholder z HUMAN GATE
jawna separacja PHANTOM v3.0 od baseline
Admin Web security view dla recovery i break-glass
SDK metody recovery/break-glass
36 tests passing
```

## Frozen Security Invariants

Te reguly pozostaja nienaruszalne w kolejnym kroku:

```text
terminal nie przechowuje danych operacyjnych
G1/G2/WORKLOAD pozostaja oddzielnymi warstwami
kazdy operator ma 3 VPS jako baseline izolacji
CDR pozostaje obowiazkowy dla file ingress/egress
provider secrets nie trafiaja do UI/API response/audit/logow jako plaintext
monitoring nie przechowuje tresci komunikacji
Puli AX pozostaje routerem finalnym z gate kwalifikacyjnym
break-glass w baseline nie wykonuje side effect bez HUMAN GATE
PHANTOM v3.0 pozostaje oddzielnym torem i nie jest implementowany w baseline
Ksiega 3.4 pozostaje zrodlem normatywnym
```

## Next Step Name

```text
V2 Step 3.4 - Real WebAuthn/FIDO2 Browser Binding And Auth Hardening
```

## Why This Step

Dotychczasowy WebAuthn flow jest zgodny kontraktowo, ale nadal ma lokalny simulator do dev/test.
Kolejny etap ma przygotowac przejscie do realnego WebAuthn w przegladarce bez utraty obecnych testow i bez dodawania plaintext fallback auth.

## Step 3.4 Scope

Step 3.4 obejmuje:

```text
real browser WebAuthn capability boundary
challenge ceremony adapter po stronie Admin Web
server-side attestation/assertion verification boundary
credential lifecycle hardening
auth policy matrix dla login/enrollment/step-up/recovery/break-glass
negative tests dla replay, wrong origin, wrong rpId, expired challenge, wrong actor
manual/browser acceptance path
documentation and diagrams
```

## Out Of Scope

Step 3.4 nie obejmuje:

```text
produkcyjnego break-glass access execution
PHANTOM v3.0 behavior
provider adapters Hetzner/OVH
job queue runtime
HSM production deployment
real router firmware signing
Matrix production federation hardening
```

## Human Gate Status

```text
Human gate: REQUIRED before production attestation policy, authenticator trust list,
enterprise attestation rules, break-glass semantics, or any PHANTOM-related behavior.
```

## Freeze Acceptance

```text
npm.cmd test passes before Step 3.4 branch of work
Step 3.3 docs reference HUMAN GATE and PHANTOM separation
Step 3.4 plan includes Mermaid module, dependency, deployment and roadmap graphs
Prompts are small enough for independent developers/models
Integration prompts define module joining order
Final test prompt validates behavior like a human operator
```
