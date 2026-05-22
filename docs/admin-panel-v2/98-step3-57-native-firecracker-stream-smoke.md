# Step 3.57 - Native Firecracker Stream Smoke on AX102

Status: implemented as lab evidence, not production release.

This step proves the first end-to-end private stream path from G2 into a real Firecracker microVM on the Hetzner AX102 dedicated workload host.

## Scope

- Workload host: `sylion-workload-native-lab-01`
- Workload public address: `65.109.123.72`
- Workload private lab address: `10.44.0.13/32`
- G2 private broker address: `10.42.0.12:443`
- MicroVM guest address: `172.16.56.2/30`
- Host tap address: `172.16.56.1/30`
- Host stream bind: `10.44.0.13:3001`
- G2 route tested through: `duckduckgo.sylion.internal`

## Implemented

- `scripts/launch-native-firecracker-stream-smoke.mjs`
  - Creates a per-run Firecracker rootfs copy from the native base image.
  - Injects a minimal `sylion-init` for deterministic smoke boot.
  - Creates a tap interface for the microVM.
  - Starts Firecracker with KVM on AX102.
  - Starts a minimal HTTP stream-smoke endpoint inside the microVM.
  - Publishes the endpoint only on the workload private address.
  - Verifies access through G2 with CDR and terminal-safety headers.
  - Writes sanitized evidence to `/opt/sylion-workloads/evidence/native-firecracker-stream-smoke.json`.

- `scripts/verify-pixel-g1-g2-native-path.mjs`
  - Now verifies native stream-smoke evidence in addition to:
    - Pixel IPsec SA on G1.
    - G2 to AX102 IPsec SA.
    - Private G2 broker bind.
    - KVM, Firecracker, jailer and base boot evidence on AX102.

## Verified Evidence

Latest successful run:

```json
{
  "component": "native_firecracker_stream_smoke",
  "hostHttpCode": "200",
  "ready": true,
  "g2": {
    "code": "200",
    "marker": true,
    "g2_header": true,
    "terminal_header": true
  },
  "readyThroughG2": true,
  "terminalDataStored": false,
  "productionExecutionAllowed": false
}
```

Full path verification:

```json
{
  "component": "pixel_g1_g2_native_workload_path",
  "g1Pixel": {
    "pixelSaEstablished": true,
    "pixelPoolPresent": true,
    "g1PrivateTrafficSelector": true
  },
  "g2Workload": {
    "ipsecEstablished": true,
    "childInstalled": true,
    "pingOk": true,
    "brokerTargetsNativeWorkload": true,
    "brokerPrivateBind": true
  },
  "workloadHost": {
    "privateIpPresent": true,
    "kvmPresent": true,
    "firecrackerPresent": true,
    "jailerPresent": true,
    "baseBootSmokeEvidence": true,
    "nativeStreamSmokeEvidence": true
  },
  "readyForPrivateWorkloadStream": true
}
```

## Security Boundary

- No workload service is exposed publicly.
- G2 remains the workload broker.
- G1/G2 bypass remains blocked.
- Terminal data storage remains false.
- CDR is still required on ingress/egress.
- This smoke endpoint is not a real DuckDuckGo/Signal/WhatsApp GUI session.
- HSM-backed CA remains a production blocker; current live lab evidence uses bootstrap/lab material.

## Remaining Blockers

- Build per-app GUI rootfs images.
- Replace stream-smoke with full noVNC/WebRTC thin-client runtime.
- Add per-app Firecracker lifecycle control from operator panel.
- Run Pixel ADB human regression against the G2-brokered stream URL.
- Replace bootstrap CA with the production HSM-backed CA ceremony.

## Commands

```powershell
node scripts/launch-native-firecracker-stream-smoke.mjs --apply --require-ready
node scripts/verify-pixel-g1-g2-native-path.mjs --require-ready
npm.cmd test
```

