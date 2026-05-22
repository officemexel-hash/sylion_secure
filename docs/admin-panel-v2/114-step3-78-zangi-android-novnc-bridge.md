# Step 3.78 - Zangi Android Native noVNC Bridge

Date: 2026-05-22

## Scope

This step wires the Zangi Android-native workload surface into the real G2 workload gateway path:

Pixel terminal -> G1 VPN -> G2 TLS broker -> workload private network -> AX102 Android runner -> noVNC/websockify.

This is still not a production PASS for Zangi. The route exists, but the Pixel human test blocks the app because the Android screen stream does not yet render the usable Android UI and no approved Zangi APK/account bootstrap exists.

## Implemented

- `launch-android-native-workload.mjs`
  - Starts Weston for the Waydroid Android UI at Pixel-sized dimensions.
  - Keeps Weston VNC protected by its TLS security mode.
  - Starts a localhost-only VeNCrypt adapter for the Weston VNC handshake.
  - Starts websockify/noVNC bound to the workload private IP `10.44.0.13:3014`.
  - Keeps public interface drop enforcement for the underlying VNC port.
  - Keeps `productionExecutionAllowed=false`, `terminalDataStored=false`, and `cdrRequired=true`.

- `install-g2-workload-gateway.mjs`
  - Routes `zangi.sylion.internal` through G2 to `http://10.44.0.13:3014`.
  - Redirects root to `/vnc.html?autoconnect=true&resize=scale&path=websockify`.
  - Marks the route with `X-Sylion-Production-Gate: android_native_apk_provenance_required`.

- `live-factual-workload-audit.mjs`
  - Treats Zangi Android-native as a noVNC route.
  - Rejects red noVNC connection-failure screens.
  - Rejects black noVNC loading/disconnected screens.
  - Keeps messenger readiness blocked until account bootstrap and send/receive are verified.

## Live Evidence

AX102 workload host:

- `websockify` private listener: `10.44.0.13:3014`
- Weston VNC listener: `5914`
- public `65.109.123.72:5914`: blocked
- public `65.109.123.72:3014`: blocked

G2 route:

- `https://zangi.sylion.internal/vnc.html?...` returns `200`
- `/websockify` upgrades to `101 Switching Protocols`
- headers include:
  - `X-Sylion-Terminal-Data-Stored: false`
  - `X-Sylion-G1-G2-Bypass: false`
  - `X-Sylion-CDR-Required: true`
  - `X-Sylion-Workload-Gateway: g2`
  - `X-Sylion-Production-Gate: android_native_apk_provenance_required`

Pixel ADB human regression:

- Pixel device detected: yes
- G2 route/noVNC page: ready
- Workload launcher streamReady: no
- VNC proxy handshake: failed
- Pixel UI visible: no
- Functional ready: no
- Current blocker: `pixel_stream_loading_or_disconnected`
- Screenshot artifact: `docs/admin-panel-v2/test-artifacts/step3-62-factual-state-audit/pixel-zangi.png`

## Current Blockers

1. Zangi Android UI stream still stalls on the noVNC loading screen on Pixel.
2. The Weston VNC security mode exposes VeNCrypt/X509Plain behavior that noVNC does not complete through the current adapter.
3. Approved Zangi APK artifact and SHA256 are missing.
4. Zangi account bootstrap is not performed.
5. Send/receive workflow is not verified.
6. This is Android-native host execution, not Firecracker-per-app production isolation yet.

## Security Notes

- No terminal operational data is stored.
- G2 remains the workload broker; no G1/G2 bypass was introduced.
- Public workload ports remain blocked or private-bound.
- PHANTOM remains governance-only and is not part of this execution path.
- HSM/FIDO2 and Puli AX physical validation remain deferred.

## Tests

- `node --test services/admin-api/test/step3-42-g2-workload-gateway.test.js`
- `node --test services/admin-api/test/step3-70-live-factual-audit-helpers.test.js`
- `node --test services/admin-api/test/step3-75-android-native-runner-installer.test.js`
- `node --test services/admin-api/test/step3-77-android-native-launcher.test.js`
- `npm test`
- `node scripts/live-factual-workload-audit.mjs --pixel --apps=zangi`

Expected live audit result today:

- `transportReadyApps: ["zangi"]`
- `pixelUiVisibleApps: []`
- `functionalReadyApps: []`
- `blockedApps: ["zangi"]`

Expected launcher result today:

- `vnc_proxy_listener: true`
- `vnc_proxy_handshake: false`
- `web_listener: true`
- `streamReady: false`
