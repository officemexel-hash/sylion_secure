# SYLION Admin Panel V2 - Step 3.4 Masterplan

## Nazwa Etapu

```text
V2 Step 3.4 - Real WebAuthn/FIDO2 Browser Binding And Auth Hardening
```

## Decyzja Architektoniczna

```text
Decision: ACCEPT AS NEXT BASELINE IMPLEMENTATION STEP
Human gate: REQUIRED for production attestation policy and authenticator trust list
Baseline impact: strengthens admin authentication without adding bypass paths
PHANTOM impact: none; PHANTOM v3.0 remains separate and not implemented in baseline
Ksiega 3.4 impact: Step 3.4 becomes admin authentication hardening evidence
```

## Strategia

Step 3.4 ma zastapic lokalny dev-only simulator realnym WebAuthn browser ceremony boundary, zachowujac compatibility layer dla testow automatycznych.

Najwazniejsza zasada:

```text
real WebAuthn is added as a stricter path, not as a second weaker auth path
```

## Moduly Step 3.4

```text
S3.4-A WebAuthn Browser Ceremony Adapter
S3.4-B Server Verification Boundary
S3.4-C Credential Lifecycle Policy
S3.4-D Auth Policy Matrix And State Machine
S3.4-E Admin Web Security UX Upgrade
S3.4-F Compatibility Test Harness
S3.4-G Audit, RBAC And Abuse-case Validation
```

## S3.4-A WebAuthn Browser Ceremony Adapter

Cel:

```text
Dodac Admin Web adapter, ktory uzywa navigator.credentials.create/get, gdy przegladarka to wspiera.
```

Zakres:

```text
feature detection dla PublicKeyCredential
base64url encode/decode helper
create ceremony dla enrollment
get ceremony dla login
get ceremony dla step-up
fallback tylko do jawnego dev/test simulator mode
czytelny blad gdy browser nie wspiera WebAuthn
```

Acceptance criteria:

```text
UI nie zapisuje private key, PIN ani biometric material
credential rawId/response sa przekazywane do API tylko w ceremony payload
simulator nie jest domyslnie promowany jako production path
kazdy ceremony request ma x-correlation-id
```

## S3.4-B Server Verification Boundary

Cel:

```text
Wydzielic miejsce na realna weryfikacje WebAuthn bez rozsypywania AuthService.
```

Zakres:

```text
WebAuthnVerifier interface
LocalSimulatorVerifier jako obecny dev/test adapter
BrowserWebAuthnVerifier boundary dla real payload validation
rpId/origin policy
challenge hash validation
credential id binding
sign counter policy
attestation policy placeholder wymagajacy HUMAN GATE
```

Acceptance criteria:

```text
wrong rpId/origin jest odrzucany
wrong challenge jest odrzucany
wrong credential/admin binding jest odrzucany
replay pozostaje odrzucany
audit nie zawiera raw authenticator data jako niepotrzebnego blobu
```

## S3.4-C Credential Lifecycle Policy

Cel:

```text
Utworzyc jawny cykl zycia credentiali admina.
```

Zakres:

```text
credential status active/suspended/revoked
lastUsedAt i signCounter update
credential display label
credential transport metadata
revoke credential endpoint
list credentials endpoint
step-up required dla revoke/suspend
```

Zakazy:

```text
brak resetu hasla jako obejscia
brak recovery auto-enroll
brak bypassu FIDO2 przez break-glass
```

## S3.4-D Auth Policy Matrix And State Machine

Cel:

```text
Spisac i zaimplementowac jednoznaczna macierz polityk dla auth state.
```

Stany:

```text
unenrolled
enrolled
active_session
step_up_fresh
step_up_expired
locked
recovery_pending
break_glass_pending_human_gate
```

Wymagania:

```text
kazda wrazliwa akcja ma jawny policy decision
stan locked blokuje login/enrollment/step-up
recovery_pending nie odblokowuje konta
break_glass_pending_human_gate nie wykonuje side effects
```

## S3.4-E Admin Web Security UX Upgrade

Cel:

```text
Pokazac realne stany credentiali i ceremony bez marketingowego UI.
```

Widoki:

```text
Security > Credentials
Security > WebAuthn capability status
Security > Recovery queue
Security > Break-glass placeholder queue
Security > Auth audit filter
```

Wymagania:

```text
kompaktowy operacyjny layout
brak widocznych sekretow
jasne rozroznienie browser WebAuthn vs dev simulator
HUMAN GATE widoczny przy break-glass
PHANTOM oznaczony tylko jako separate track, nie funkcja baseline
```

## S3.4-F Compatibility Test Harness

Cel:

```text
Utrzymac szybkie testy Node dla simulatora i dodac browser/manual acceptance dla realnego flow.
```

Zakres:

```text
unit/contract tests dla verifier boundary
API tests dla new credential lifecycle endpoints
browser DOM check dla Security view
manual test checklist dla real FIDO2 key / platform authenticator
fallback test dla unsupported browser
```

## S3.4-G Audit, RBAC And Abuse-case Validation

Cel:

```text
Potwierdzic, ze real WebAuthn hardening nie tworzy nowych obejsc ani wyciekow.
```

Abuse cases:

```text
replay credential assertion
wrong credential id for admin
wrong actor uses step-up challenge
expired challenge reuse
lockout denial-of-service
credential revoke without fresh step-up
recovery used as auth bypass
break-glass used as side-effect execution
PHANTOM wording promoted into baseline UI
```

Required tests:

```text
negative tests for challenge/origin/rpId/credential binding
positive test for simulator compatibility path
credential revoke/list contract tests
audit no secret/no raw sensitive blob checks
browser check for Security view elements
npm.cmd test passes
```

## Kolejnosc Implementacji

```text
1. S3.4-B WebAuthnVerifier boundary and simulator adapter extraction
2. S3.4-D auth policy matrix constants/tests
3. S3.4-C credential list/revoke lifecycle endpoints with step-up
4. S3.4-A Admin Web browser ceremony adapter
5. S3.4-E Security UX upgrade
6. S3.4-G abuse-case tests
7. S3.4-F browser/manual acceptance checklist
8. docs/status update and freeze package
```

## Release Gates

```text
Gate 1: all existing Step 3.3 tests still pass.
Gate 2: simulator path remains explicit dev/test compatibility only.
Gate 3: verifier rejects wrong challenge, wrong actor, replay and invalid credential binding.
Gate 4: credential lifecycle endpoints require RBAC and step-up where sensitive.
Gate 5: UI exposes real WebAuthn capability status without storing secrets.
Gate 6: audit contains decisions without passwords, provider secrets, private keys or biometric data.
Gate 7: PHANTOM v3.0 remains separate and baseline docs do not imply autonomous behavior.
Gate 8: browser/manual checklist is present for real FIDO2 validation.
```
