# SYLION Admin V2 - Step 3.4 Manual WebAuthn Checklist

Data: 2026-05-20

## Purpose

Ten checklist sluzy do walidacji Step 3.4 jak czlowiek, bez ujawniania sekretow i bez promowania PHANTOM v3.0 do baseline.

## Preconditions

```text
npm.cmd test passes
Admin API runs locally
Admin Web opens under /admin
Use Global Super Admin test account only in dev/test environment
Use a dev/test FIDO2 key or platform authenticator only
Do not use production secrets
```

## Browser Capability

```text
1. Open /admin.
2. Confirm API status is healthy.
3. Confirm WebAuthn mode selector is visible.
4. Confirm capability label shows either Browser WebAuthn available or Dev/test simulator only.
5. If Browser WebAuthn is unavailable, keep Dev/test simulator selected.
```

## Enrollment And Login

```text
1. Select Dev/test simulator for automated local validation.
2. Enroll FIDO2.
3. Sign in.
4. Confirm session card shows WebAuthn-compatible auth method.
5. Confirm password is not rendered after login.
6. Confirm credential list shows safe metadata only.
```

## Browser WebAuthn Probe

```text
1. Select Browser WebAuthn only when testing a real browser authenticator.
2. Attempt enrollment with a dev/test authenticator.
3. If the server returns HUMAN GATE / verifier-not-enabled behavior, record it as expected until production attestation policy is approved.
4. Do not treat browser payload acceptance as production-ready unless CISO/Architect approves the attestation policy.
```

## Credential Lifecycle

```text
1. List credentials in Security view.
2. Attempt suspend or revoke from a session without fresh step-up.
3. Confirm step_up_required is returned and no credential status changes.
4. Complete FIDO2 step-up.
5. Suspend or revoke a test credential.
6. Confirm credential status changes to suspended or revoked.
7. Confirm suspended/revoked credential cannot login or step-up.
8. Confirm audit includes auth.credential_suspended or auth.credential_revoked.
```

## Recovery And Break-glass

```text
1. Create recovery request.
2. Confirm autoUnlock=false.
3. Confirm recovery does not unlock a locked account.
4. Create break-glass placeholder.
5. Confirm humanGateRequired=true.
6. Confirm sideEffectExecuted=false.
7. Confirm PHANTOM v3.0 is shown only as separate track wording.
```

## Audit Leakage Check

```text
Inspect audit events and confirm none contain:
- password
- provider secret
- private key
- PIN
- biometric data
- raw unnecessary WebAuthn authenticator blobs
- communication content
```

## Acceptance

```text
PASS only if:
- auth works in dev/test simulator path
- browser WebAuthn path is clearly gated when production verifier is not approved
- credential lifecycle requires RBAC and step-up
- recovery and break-glass do not bypass auth
- PHANTOM v3.0 remains separate from baseline
- npm.cmd test passes
```

## Human Gate

```text
HUMAN GATE REQUIRED before production WebAuthn attestation policy,
authenticator trust list, enterprise attestation handling, or production break-glass semantics.
Owner: Architect + CISO.
```
