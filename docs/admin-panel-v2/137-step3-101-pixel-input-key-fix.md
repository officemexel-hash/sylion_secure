# Step 3.101 Freeze - Pixel Input Key Fix

Date: 2026-05-25

## Scope

Fix the Pixel workload input overlay so it can send real remote key events to the G2 workload bridge, not only buffered text.

## Problem

The Pixel stream wrapper showed a local input popup. Mouse/tap worked in the remote workload, but:

- pressing Enter from the Pixel keyboard did not reliably submit to the workload,
- Backspace affected only the local popup when it contained text,
- there was no explicit remote Backspace or remote field-clear action,
- ADB deep links that contained `&` could be truncated unless the URL was quoted at the Android shell layer.

## Implementation

Changed:

- `apps/operator-web/stream.html`
- `apps/operator-web/stream.js`
- `scripts/workload-input-bridge.mjs`
- `services/admin-api/src/modules/operatorPortal/operatorPortalService.js`
- `services/admin-api/test/operator-portal-skeleton.test.js`
- `services/admin-api/test/step3-79-g2-session-broker-policy.test.js`

Added:

- `enterkeyhint="go"` for the Pixel keyboard.
- UI actions: `Backspace` and `Clear field`.
- API support for allowed special keys:
  - `enter`
  - `backspace`
  - `delete`
  - `tab`
  - `escape`
  - arrow keys
  - `home`
  - `end`
  - `select_all`
- Bridge support for `preKeys` and `postKeys`.
- Metadata-only audit fields for key counts.

## Security Invariants

- The terminal remains display/input only.
- Input content is not returned in API responses.
- Input content is not stored in audit events.
- Clipboard is not used.
- File transfer remains disabled until CDR gate.
- G1/G2 bypass remains forbidden.

## Verification

Local:

```powershell
node --check scripts/workload-input-bridge.mjs
node --test --test-concurrency=1 services\admin-api\test\operator-portal-skeleton.test.js services\admin-api\test\step3-79-g2-session-broker-policy.test.js
```

Result: 25/25 passed.

Remote Admin VPS:

```bash
node --check scripts/workload-input-bridge.mjs
node --test --test-concurrency=1 services/admin-api/test/operator-portal-skeleton.test.js services/admin-api/test/step3-79-g2-session-broker-policy.test.js
```

Result: 25/25 passed.

Pixel ADB human-style evidence:

- `docs/admin-panel-v2/test-artifacts/step3-101-pixel-input-key-fix/pixel-keyboard-panel.png`
- `docs/admin-panel-v2/test-artifacts/step3-101-pixel-input-key-fix/pixel-after-enter.png`
- `docs/admin-panel-v2/test-artifacts/step3-101-pixel-input-key-fix/pixel-after-focused-clear.png`

Observed:

- New input panel loaded on Pixel with `Backspace` and `Clear field`.
- Pixel keyboard Enter submitted text to the remote DuckDuckGo/Firefox workload.
- Remote browser navigated/search after the input bridge sent key events.
- `Clear field` cleared the remote address/search field when the remote field had focus.

## Remaining UX Note

`Clear field` operates on the currently focused element inside the remote workload. If focus is on page content instead of a text field, it can select page text. The operator should tap the target remote input field first. A later UX improvement can add browser-specific controls such as `Focus address bar`.
