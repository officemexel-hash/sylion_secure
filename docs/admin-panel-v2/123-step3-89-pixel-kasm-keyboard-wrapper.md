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
- A black framebuffer with only a cursor is a failed visual test, even when the transport is reachable.
- Workload evidence must require an actual visible window marker; a running process alone is not enough.
- No secret, OTP, seed, message content, or wallet data is entered during testing.

## 2026-05-24 Repair Note

Pixel testing found a black DuckDuckGo stream with a visible cursor. The transport and VNC controls were reachable, but the previous KasmVNC evidence path could incorrectly mark the workload ready when the app process was running while `sylion-visible-window=false` was present in the serial log.

Repair:

- Recreated DuckDuckGo as a fresh Firecracker GUI workload with TigerVNC/noVNC on AX102.
- Verified G2 stream route returns `200`, noVNC marker is present, and `visibleWindow=true`.
- Re-tested from Pixel and confirmed the DuckDuckGo page and search field are visible through `/operator/stream.html?app=duckduckgo_browser`.
- Tightened the runner so KasmVNC can no longer convert `appRunning=true` into `visibleWindow=true`.
