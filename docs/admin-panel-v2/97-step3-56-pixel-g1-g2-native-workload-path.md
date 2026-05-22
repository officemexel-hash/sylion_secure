# Step 3.56 - Pixel to G1 to G2 to Native Workload Path

Status: implemented and verified

Date: 2026-05-22

## Scope

This step wires the real transport path:

```text
Pixel / GrapheneOS
  -> IKEv2/IPsec
  -> G1
  -> G2 broker
  -> IKEv2/IPsec
  -> Hetzner AX102-U WORKLOAD_NATIVE bare metal
  -> KVM / Firecracker microVM layer
```

## Live Addresses

- G1 public: `178.105.200.112`
- G1 private selector: `10.42.0.0/24`
- G2 public: `178.105.203.31`
- G2 broker: `10.42.0.12:443`
- WORKLOAD_NATIVE public: `65.109.123.72`
- WORKLOAD_NATIVE private lab IP: `10.44.0.13/32`

## Implemented

- Installed certificate-authenticated IKEv2/IPsec between G2 and WORKLOAD_NATIVE.
- Added private lab address `10.44.0.13/32` on AX102.
- Repointed G2 workload broker upstreams from the legacy workload VPS to `10.44.0.13`.
- Verified that the Pixel is currently connected to G1 via IKEv2.
- Verified G2 to AX102 tunnel with CHILD_SA installed and private ping passing.
- Verified G2 broker remains private-only on `10.42.0.12:443`.
- Verified AX102 has KVM, Firecracker, jailer and base boot-smoke evidence.

## Scripts

- `scripts/install-g2-native-workload-ipsec.mjs`
- `scripts/verify-pixel-g1-g2-native-path.mjs`

Verification command:

```powershell
node scripts/verify-pixel-g1-g2-native-path.mjs --require-ready
```

Result:

- Pixel to G1 SA: `true`
- G1 private selector: `true`
- G2 to WORKLOAD_NATIVE IPsec: `true`
- CHILD_SA installed: `true`
- G2 to AX102 private ping: `true`
- G2 broker targets native workload: `true`
- G2 broker private bind: `true`
- KVM/Firecracker/jailer on AX102: `true`
- ready for private workload stream: `true`

## Security Boundary

This step uses a lab CA for the G2-to-AX102 tunnel. It is certificate-authenticated and encrypted, but not HSM-backed yet.

Production remains blocked until:

- HSM-backed CA and certificate lifecycle are installed,
- per-app Firecracker GUI rootfs artifacts are built,
- microVM TAP networking is bound to the G2 stream broker,
- Pixel human click regression passes,
- CDR runtime evidence is collected for app file ingress/egress.

## Next Step

Build the first per-app GUI rootfs and launch one Firecracker workload behind G2:

1. Derive Signal or DuckDuckGo rootfs from the base rootfs.
2. Add TAP networking for the microVM.
3. Bind the stream service only to `10.44.0.13`.
4. Test from G2 through `10.42.0.12:443`.
5. Run Pixel ADB human regression.

