# Step 3.89 - Pixel Kasm keyboard wrapper

## Problem

Pixel human test confirmed that DuckDuckGo can be opened through the live thin-client path and the viewport fits the phone screen. The remaining UX blocker is KasmVNC input: opening the Kasm side menu to show the keyboard often covers the field being typed into, and collapsing that side menu also closes the keyboard controls.

## Implemented Fix

Added a SYLION-owned stream wrapper served by the operator portal:

- `/operator/stream.html?app=duckduckgo_browser`
- `/operator/stream.html?app=signal`
- `/operator/stream.html?app=whatsapp`
- `/operator/stream.html?app=telegram`
- `/operator/stream.html?app=threema`
- `/operator/stream.html?app=zangi`
- `/operator/stream.html?app=libreoffice`
- `/operator/stream.html?app=exodus`

The wrapper embeds only allowlisted internal `*.sylion.internal` workload hosts and exposes a bottom toolbar outside the VNC canvas:

- `Keyboard` sends KasmVNC `show_keyboard_controls`.
- `Input tools` re-sends the same control request without opening the Kasm side drawer.
- `Fit` asks the stream to keep remote scaling active.
- `Apps` returns to `/operator#app-switcher`.
- `Panel` returns to `/operator`.

No text input field exists in the wrapper. It does not store, inspect, copy, or forward typed content. It only sends UI control messages to the embedded workload stream.

## Architecture Guardrails

- Terminal remains thin-client only: display and input transport, no operational data storage.
- No arbitrary URL is accepted; app selection is allowlist based.
- G1/G2 path is not bypassed; the frame uses existing internal workload gateway hostnames.
- This is a KasmVNC lab UX improvement, not a production broker approval. Guacamole/Selkies production broker gates remain separate.

## Verification

Required checks:

1. Open `/operator#app-switcher` on Pixel.
2. Tap DuckDuckGo.
3. Confirm `/operator/stream.html?app=duckduckgo_browser` opens.
4. Tap a field inside the remote browser.
5. Tap `Keyboard` in the SYLION bottom toolbar.
6. Confirm KasmVNC keyboard controls appear without keeping the side drawer open.
7. Type a non-secret probe string and confirm it appears in the remote field.
8. Tap `Apps` and confirm it returns to the operator app switcher.

Pass criteria:

- Field is not hidden by the Kasm side drawer.
- Pixel keyboard can be summoned without leaving the drawer open.
- The stream remains scaled to the Pixel viewport.
- No secret, OTP, seed, message content, or wallet data is entered during testing.

