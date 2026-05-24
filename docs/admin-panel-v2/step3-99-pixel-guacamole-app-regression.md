# Step 3.99 Pixel Guacamole App Regression

Date: 2026-05-24

Scope: Pixel GrapheneOS through SYLION operator portal, G1/G2 live access evidence, G2 Guacamole broker, workload host app slots.

## Evidence Summary

- Pixel ADB serial: `46141FDAP009CZ`
- VPN evidence: passed
- DNS through tunnel: passed
- Reachable internal hosts: `admin.sylion.internal`, `operator.sylion.internal`, `session.sylion.internal`, `signal.sylion.internal`, `duckduckgo.sylion.internal`, `libreoffice.sylion.internal`, `10.42.0.12`
- Operator token in UI XML dumps: not observed
- Evidence directory: `docs/admin-panel-v2/test-artifacts/step3-99-pixel-guacamole-apps-quoted/`

## Application Results

| App | Handoff | Pixel visual state | Result |
| --- | --- | --- | --- |
| LibreOffice | `guacamole_handoff_ready` | LibreOffice Writer blank document rendered | Visual pass |
| Telegram | `guacamole_handoff_ready` | Telegram Web login QR rendered | Visual pass, account login pending |
| Signal | `guacamole_handoff_ready` | Signal Desktop linked-device QR rendered | Visual pass, account link pending |
| WhatsApp | `guacamole_handoff_ready` | WhatsApp Web QR rendered | Visual pass, account link pending |
| Threema | `guacamole_handoff_ready` | Threema Web QR rendered | Visual pass, account link pending |
| DuckDuckGo | `guacamole_handoff_ready` | DuckDuckGo browser home rendered | Visual pass |
| Exodus | `guacamole_handoff_blocked` | Blocked by wallet risk gate | Correctly blocked until operator risk acceptance |
| Zangi | `guacamole_handoff_blocked` | Blocked by Android-native provenance gate | Correctly blocked until approved APK/image provenance |

## Input Finding

Pixel tap-to-focus works inside the Guacamole-rendered DuckDuckGo workload. Text injection via `adb shell input text` did not reach the remote app after focus. This is now classified as a real usability gap: mobile keyboard/input needs a Guacamole-compatible input bridge or an approved broker-side input method. The failure is not a rendering failure and not a VPN failure.

## Repair Applied

The ADB runners now quote URLs passed to `am start`. Without quoting, Android shell can split URLs containing `&` or fragments, causing false `Missing or invalid operator portal session` failures.

## Next Required Actions

1. Implement or select the mobile input bridge for Guacamole sessions.
2. Add a strict human test that types into DuckDuckGo and LibreOffice from Pixel and verifies visible text.
3. Keep Exodus blocked until explicit operator wallet risk acceptance is represented in policy and UI.
4. Keep Zangi blocked until Android-native APK/image provenance is approved.
5. After accounts or phone/SMS codes are available, run account-link tests for Signal, Telegram, WhatsApp and Threema.
