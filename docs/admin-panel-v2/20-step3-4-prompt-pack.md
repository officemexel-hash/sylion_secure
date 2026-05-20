# SYLION Admin Panel V2 - Step 3.4 Prompt Pack

## Instrukcja Wspolna Dla Wszystkich Modulow

Wklej ten blok na poczatku kazdego prompta wykonawczego:

```text
Pracujesz w repo SYLION Secure. Obowiazuja invariants Ksiegi 3.4:
- no operational data on terminal
- explicit tenant/operator boundaries
- CDR mandatory for file ingress/egress
- provider secrets never appear as plaintext in UI/API/audit/logs
- G1/G2/WORKLOAD remain separated
- each operator has 3 VPS baseline isolation
- Puli AX remains the final router gate
- break-glass baseline has no side effect without HUMAN GATE
- PHANTOM v3.0 is a separate track and must not be implemented in baseline

Use existing code patterns. Keep edits scoped. Add negative tests. Do not add plaintext auth fallback.
Run npm.cmd test before declaring done.
```

## Prompt S3.4-A - WebAuthn Browser Ceremony Adapter

```text
Implement S3.4-A WebAuthn Browser Ceremony Adapter.

Scope:
- Update apps/admin-web/app.js only unless a tiny helper file is clearly justified.
- Add feature detection for window.PublicKeyCredential and navigator.credentials.
- Add base64url encode/decode helpers for WebAuthn binary fields.
- Add enrollment ceremony using navigator.credentials.create when available.
- Add login and step-up ceremony using navigator.credentials.get when available.
- Keep existing local simulator as explicit dev/test fallback, not production language.
- UI must report unsupported browser clearly.
- Do not store private key, PIN, biometric material, raw secrets, or provider secrets.

Acceptance:
- Existing simulator tests still pass.
- Browser page still loads under /admin.
- DOM exposes a WebAuthn capability status.
- No PHANTOM behavior or production break-glass behavior is introduced.
```

## Prompt S3.4-B - Server Verification Boundary

```text
Implement S3.4-B Server Verification Boundary.

Scope:
- Add a verifier boundary under services/admin-api/src/modules/auth/.
- Extract current simulator assertion verification into LocalSimulatorVerifier.
- Add BrowserWebAuthnVerifier placeholder interface for real WebAuthn payload validation.
- Add rpId/origin policy shape to AuthService options.
- Keep simulator compatibility for current tests.
- Reject unsupported/unknown verification modes explicitly.

Acceptance:
- AuthService delegates credential assertion validation to verifier boundary.
- Wrong credential id/admin binding remains rejected.
- Replay and expired challenge behavior remains rejected.
- Audit does not store raw authenticator blobs.
- npm.cmd test passes.
```

## Prompt S3.4-C - Credential Lifecycle Policy

```text
Implement S3.4-C Credential Lifecycle Policy.

Scope:
- Add endpoints:
  GET /auth/credentials
  POST /auth/credentials/:id/suspend
  POST /auth/credentials/:id/revoke
- Add RBAC permissions:
  auth.credential.read
  auth.credential.suspend
  auth.credential.revoke
- Require fresh step-up for suspend/revoke.
- Keep credential statuses active/suspended/revoked.
- Do not expose publicKey if not needed by UI.

Acceptance:
- List only safe metadata: id, adminId, transports, attestation format, status, createdAt, lastUsedAt.
- Suspended/revoked credentials cannot login or step-up.
- Revoke/suspend emit audit events.
- Support readonly cannot mutate credentials.
- npm.cmd test passes.
```

## Prompt S3.4-D - Auth Policy Matrix And State Machine

```text
Implement S3.4-D Auth Policy Matrix And State Machine.

Scope:
- Add a small policy module for auth states and action requirements.
- Cover states:
  unenrolled, enrolled, active_session, step_up_fresh, step_up_expired,
  locked, recovery_pending, break_glass_pending_human_gate.
- Map actions:
  login, enrollment, step-up, provider.create, provider.secret.rotate,
  orchestrator.execute, credential.revoke, recovery.update, break_glass.request.
- Use the matrix for documentation and tests first; only wire code paths where low-risk.

Acceptance:
- Tests assert that locked/recovery/break-glass states do not bypass auth.
- Sensitive actions require step-up.
- Matrix is exported in a readable way for future UI display.
- No PHANTOM behavior is added.
```

## Prompt S3.4-E - Admin Web Security UX Upgrade

```text
Implement S3.4-E Admin Web Security UX Upgrade.

Scope:
- Update Security view in apps/admin-web/index.html and app.js.
- Add compact Credentials section.
- Add WebAuthn capability status.
- Keep Recovery and Break-glass sections.
- Add Auth audit filter display if low-risk and consistent with existing tables.
- Avoid marketing copy, oversized cards, nested cards, or decorative gradients.

Acceptance:
- Text fits in all visible controls.
- No secrets appear in DOM.
- HUMAN GATE remains visible for break-glass.
- PHANTOM appears only as separate track wording.
- Static web test checks new DOM anchors.
```

## Prompt S3.4-F - Compatibility Test Harness

```text
Implement S3.4-F Compatibility Test Harness.

Scope:
- Add API tests for verifier boundary and credential lifecycle.
- Add browser/static tests for WebAuthn capability UI anchors.
- Add docs/admin-panel-v2/manual-tests/step3-4-webauthn-checklist.md.
- Checklist must describe real FIDO2/platform authenticator validation steps without requiring secrets.

Acceptance:
- npm.cmd test passes.
- Manual checklist covers enrollment, login, step-up, revoke, unsupported browser, recovery not auto-unlocking.
- Tests include negative cases for replay, wrong credential/admin binding, suspended/revoked credential.
```

## Prompt S3.4-G - Audit, RBAC And Abuse-case Validation

```text
Implement S3.4-G Audit, RBAC And Abuse-case Validation.

Scope:
- Add or extend tests to verify audit events for credential lifecycle and verifier failures.
- Verify no passwords, provider secrets, private keys, PIN, biometric data or raw unnecessary WebAuthn blobs in audit.
- Verify support readonly denial for credential mutation.
- Verify Global Super Admin and Security Admin allowed paths only where intended.

Acceptance:
- Abuse-case tests fail if recovery or break-glass unlocks/bypasses auth.
- Tests fail if PHANTOM wording becomes baseline behavior.
- npm.cmd test passes.
```

## Integration Prompt I1 - Auth Core Join

```text
Integrate S3.4-B, S3.4-C and S3.4-D.

Tasks:
- Ensure AuthService uses verifier boundary and policy matrix consistently.
- Ensure credential lifecycle respects lockout and step-up rules.
- Resolve naming conflicts without changing external contracts unnecessarily.
- Run focused auth tests, then npm.cmd test.
```

## Integration Prompt I2 - Web UI Join

```text
Integrate S3.4-A and S3.4-E.

Tasks:
- Ensure browser ceremony adapter works with existing API responses.
- Ensure simulator fallback remains explicit dev/test.
- Ensure Security view renders credentials, capability, recovery and break-glass without overlap.
- Run admin-web static test and browser check under /admin.
```

## Integration Prompt I3 - Security Review Join

```text
Review the integrated Step 3.4 implementation.

Focus:
- no plaintext fallback auth
- no secrets in UI/API/audit/logs
- no PHANTOM baseline behavior
- HUMAN GATE retained for break-glass
- CDR and G1/G2 invariants untouched
- all tests passing

Output:
- findings first, with file/line references
- required fixes
- residual risk
```

## Final Human Test Prompt

```text
Act like a human Global Super Admin testing SYLION Admin V2 Step 3.4.

Run through:
1. Open /admin.
2. Check API health.
3. Check WebAuthn capability status.
4. Enroll FIDO2 or dev/test simulator credential.
5. Login.
6. Trigger step-up on provider create.
7. List credentials.
8. Attempt credential revoke without fresh step-up and confirm denial.
9. Complete step-up and revoke/suspend a test credential.
10. Confirm revoked/suspended credential cannot login.
11. Create recovery request and confirm it does not unlock.
12. Create break-glass placeholder and confirm sideEffectExecuted=false and HUMAN GATE=true.
13. Inspect audit and confirm no password, provider secret, private key, PIN, biometric data, or raw unnecessary WebAuthn blobs.
14. Confirm PHANTOM v3.0 is mentioned only as separate track, not executable baseline behavior.

Expected result:
- all critical flows work
- dangerous bypasses do not exist
- no sensitive material leaks
- npm.cmd test passes
```
