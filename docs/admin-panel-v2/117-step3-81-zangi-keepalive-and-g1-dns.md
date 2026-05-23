# Step 3.81 - Zangi Keepalive and G1 DNS Repair

Date: 2026-05-23

Status: implemented and applied to live AX102/G1.

## Scope

This step fixes the degraded live thin-client path found after the heartbeat monitor reported:

- `Zangi Waydroid session = STOPPED`
- `session.sylion.internal` missing from Pixel DNS resolution
- `Exodus` missing as a real Firecracker/RFB workload

The heartbeat automation `sylion-live-path-monitor` was deleted before the repair.

## Implementation

- `scripts/launch-android-native-workload.mjs`
  - Replaced one-shot `nohup` process launch with systemd-managed runtime units:
    - `sylion-zangi-weston-vnc.service`
    - `sylion-zangi-vnc-proxy.service`
    - `sylion-zangi-websockify.service`
    - `sylion-zangi-android-session.service`
  - Added `dbus-run-session` for Waydroid UI startup under systemd.
  - Added a keepalive wrapper that restarts the Waydroid session when the container restarts.
  - Kept production gate: `productionExecutionAllowed=false`.

- `scripts/install-g1-internal-dns.mjs`
  - New idempotent G1 DNS installer for `/etc/dnsmasq.d/sylion-internal.conf`.
  - Adds `session.sylion.internal -> 10.42.0.12` alongside admin/operator/app hostnames.
  - Verifies `dnsmasq --test`, restarts `dnsmasq`, and checks lookup metadata.

- `scripts/pixel-live-human-regression.mjs`
  - Adds `session.sylion.internal` to Pixel DNS checks.

- `scripts/launch-native-firecracker-gui-workload.mjs`
  - Replaces the non-deterministic Exodus `latest` artifact with a versioned official `.deb` URL.
  - Verifies SHA256 before installing the wallet artifact.
  - Starts Exodus without unsupported Chromium flags because Exodus rejects non-whitelisted app flags.
  - Uses a wider desktop canvas for the Exodus workload; Pixel still scales the remote stream through noVNC/Guacamole.
  - Keeps the wallet invariant: no wallet secrets, phrases, balances, or operator data are stored in SYLION control-plane metadata.

- `scripts/install-workload-guacamole-vnc-forwards.mjs`
  - Verifies all app-scoped raw VNC forwards from G2, including optional/live wallet workloads.

- `scripts/seed-g2-guacamole-workload-connections.mjs`
  - Seeds 8 Guacamole connections now that the Exodus Firecracker target is factual-live.

## Live Evidence

AX102 after repair:

```text
zangi_session=RUNNING
zangi_container=RUNNING
sylion-zangi-weston-vnc.service=active
sylion-zangi-vnc-proxy.service=active
sylion-zangi-websockify.service=active
sylion-zangi-android-session.service=active
zangi_proxy_handshake=true
```

G2 RFB reachability:

```text
duckduckgo_browser=true:RFB 003.008
libreoffice=true:RFB 003.008
whatsapp=true:RFB 003.008
telegram=true:RFB 003.008
threema=true:RFB 003.008
signal=true:RFB 003.008
exodus=true:RFB 003.008
zangi=true:RFB 003.008
```

Exodus Firecracker workload:

```text
appKey=exodus
ready=true
appRunning=true
visibleWindow=true
vncBannerReady=true
blockers=[]
```

G2 HTTPS/noVNC:

```text
duckduckgo=200:noVNC
libreoffice=200:noVNC
whatsapp=200:noVNC
telegram=200:noVNC
threema=200:noVNC
signal=200:noVNC
exodus=200:noVNC
zangi=200:noVNC
```

Guacamole session broker:

```text
session.sylion.internal/guacamole=200
SYLION connection_count=8
max_connections_per_user=10
connections include SYLION Exodus
```

Pixel ADB human regression:

```text
zangi transport=true pixelUiVisible=true functionalReady=false
exodus transport=true pixelUiVisible=false functionalReady=false
```

The Exodus backend path is live, but Pixel visual validation still shows a blank/white Exodus window. This is a real remaining UI/rendering defect, not a routing failure.

Pixel DNS after G1 repair:

```text
session.sylion.internal -> 10.42.0.12
admin.sylion.internal -> 10.42.0.12
operator.sylion.internal -> 10.42.0.12
zangi.sylion.internal -> 10.42.0.12
```

## Remaining Gates

- Zangi app package is still not installed: approved APK provenance and checksum are required.
- Exodus is live as a Firecracker GUI workload and Guacamole connection, but Pixel visual validation still fails with a blank/white window. Human wallet workflow remains gated by explicit operator risk acceptance; wallet secrets must never enter the control-plane.
- HSM/FIDO2 remains deferred until physical devices are available.
- Puli AX router package remains deferred until the router arrives.

## Verification

```text
node --test services/admin-api/test/step3-77-android-native-launcher.test.js
node --test services/admin-api/test/step3-81-g1-internal-dns.test.js
node --test services/admin-api/test/step3-61-native-firecracker-runner.test.js
node --test services/admin-api/test/step3-80-guacamole-workload-connections.test.js
npm run live:android-native-launch -- --host=65.109.123.72 --user=root --key=.deploy\sylion_hetzner_admin_ed25519 --app=zangi --package=com.beint.zangi --port=5914 --width=412 --height=915 --apply --confirm=LAUNCH_ANDROID_UI
node scripts/install-g1-internal-dns.mjs --apply --confirm=INSTALL_G1_DNS
SYLION_GUI_APP=exodus node scripts/launch-native-firecracker-gui-workload.mjs --apply --require-ready
node scripts/install-workload-guacamole-vnc-forwards.mjs --apply
node scripts/seed-g2-guacamole-workload-connections.mjs --apply
```
