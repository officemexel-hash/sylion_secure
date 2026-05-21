# Step 3.35 Freeze - Operator Workload Control Audit

Date: 2026-05-22

## Scope

This audit verifies the operator panel surface for adding, deleting and recreating workload environments for:

- WhatsApp
- Threema
- Telegram
- Signal
- Zangi
- LibreOffice
- DuckDuckGo Browser
- Exodus
- Matrix Client and Matrix Server

The operator action remains quota-controlled and audit-only until the production runner/human gate is enabled.

## Findings

| Area | Status | Evidence |
| --- | --- | --- |
| Operator Workload Control UI | fixed | Catalog now renders all authorized app families including Exodus |
| Quota enforcement | passing | PRO allows 10 total environments; STANDARD over-quota request is rejected |
| Add/delete/recreate intent | passing | `scale_to_counts`, `rotate_app`, and `recreate_all` remain explicit actions |
| Destructive safety | passing | Delete/recreate is queued as control-plane intent, not executed directly |
| Audit trail | passing | `operator_portal.workload_control_requested` is recorded per operator |
| CDR invariant | passing | every catalog entry is marked `cdrRequired: true` |
| Terminal data | passing | workload control stores no terminal-side operational data |
| Live WORKLOAD containers | fixed | Zangi and Exodus containers added to current WORKLOAD host |
| G2 routing | fixed | `zangi.sylion.internal` and `exodus.sylion.internal` now proxy through G2 |

## Live Checks

Current Hetzner WORKLOAD has:

- `sylion-duckduckgo`
- `sylion-libreoffice`
- `sylion-whatsapp-web`
- `sylion-telegram-web`
- `sylion-threema-web`
- `sylion-zangi-web`
- `sylion-exodus`
- `sylion-signal-desktop`

Current G2 checks return:

- `signal.sylion.internal` -> `401 Unauthorized` from KasmVNC auth
- `duckduckgo.sylion.internal` -> `200 OK`
- `libreoffice.sylion.internal` -> `200 OK`
- `whatsapp.sylion.internal` -> `200 OK`
- `telegram.sylion.internal` -> `200 OK`
- `threema.sylion.internal` -> `200 OK`
- `zangi.sylion.internal` -> `200 OK`
- `exodus.sylion.internal` -> `200 OK`

## Residual Risks

- Exodus is categorized as a dedicated wallet workload with operator risk acceptance. Wallet secrets must never be stored in the terminal, admin config, or plain workload metadata.
- The current Standard/Pro implementation uses containers as the live compatibility substrate. Firecracker and confidential-compute variants remain the higher-tier runner target.
- Android/Vanadium still needs the SYLION internal TLS CA installed through GrapheneOS provisioning to remove the browser warning.

## Tests

- `node --test services/admin-api/test/step3-32-operator-workload-security-control.test.js services/admin-api/test/step3-34-live-signal-workload-image.test.js`
- `SYLION_BASE_URL=http://127.0.0.1:18102 node scripts/operator-portal-smoke.mjs`
- `npm.cmd test`

