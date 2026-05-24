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

- Recreated DuckDuckGo as a fresh Firecracker GUI workload with TigerVNC/noVNC only as an emergency diagnostic fallback.
- Tightened the runner so KasmVNC can no longer convert `appRunning=true` into `visibleWindow=true`.
- Restored KasmVNC as the default Firecracker GUI streaming backend.
- Added explicit `XAUTHORITY=/home/sylion/.Xauthority` to app launch under KasmVNC so the operator application binds to the real Kasm display.
- Added a KasmVNC startup background marker so a black framebuffer with only a cursor remains a failed visual test unless the workload window is actually visible.
- Re-test requirement: DuckDuckGo must pass with `vncBackend=kasmvnc`, `streamAuthRequired=true`, `visibleWindow=true`, and visible Pixel pixels through `/operator/stream.html?app=duckduckgo_browser`.

Live result:

- AX102 DuckDuckGo Firecracker run `gui-duckduckgo-kasmvnc-restore-20260524-1` passed with `vncBackend=kasmvnc`, `streamReady=true`, `streamAuthRequired=true`, `visibleWindow=true`, `targetContentVerified=true`, and no blockers.
- G2 gateway now uses root-only per-app KasmVNC auth snippets so the Pixel iframe does not stop on a browser Basic Auth prompt.
- Per-app G2 auth handoff smoke passed for DuckDuckGo, LibreOffice, WhatsApp, Telegram, Threema, Signal, and Exodus with HTTP `200`, stream marker present, `X-Sylion-Terminal-Data-Stored: false`, and `X-Sylion-Workload-Gateway: g2`.
- Pixel visual retest passed: DuckDuckGo rendered through `operator.sylion.internal/operator/stream.html?app=duckduckgo_browser`, KasmVNC floating keyboard opened the Pixel keyboard, a non-secret probe string was typed, and DuckDuckGo search results loaded.
