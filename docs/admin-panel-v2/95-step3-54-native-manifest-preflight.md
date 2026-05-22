# Step 3.54 - Native Workload Manifest Preflight

Status: implemented and executed on the live dedicated host

Date: 2026-05-22

## Scope

This step adds a repeatable preflight process for the real Hetzner Robot dedicated `WORKLOAD_NATIVE` host.

Script:

- `scripts/workload-native-manifest-preflight.mjs`

The script:

- logs into the deployed admin API through WebAuthn simulator credentials,
- fetches workload image manifests for `WORKLOAD_NATIVE_LAB_01`,
- writes a sanitized manifest bundle to the dedicated host,
- validates KVM, Firecracker, jailer, auditd and AppArmor,
- verifies that declared stream ports are not publicly listening,
- stores host-side evidence under `/opt/sylion-workloads/evidence/native-manifest-preflight.json`.

## Live Result

Command:

```powershell
node scripts/workload-native-manifest-preflight.mjs --apply --require-ready
```

Result:

- manifest count: `4`
- host KVM: `true`
- Firecracker: `v1.15.1`
- jailer: `v1.15.1`
- auditd: `active`
- AppArmor: `active`
- public stream ports: none
- ready for lab image build: `true`
- production execution allowed: `false`

## Manifests Applied

- Signal / Firecracker microVM
- DuckDuckGo Browser / Firecracker microVM
- LibreOffice / Firecracker microVM
- Zangi / Android native workload

## Security Boundary

The preflight does not launch communicator sessions, expose public workload ports, print secrets, release workload credentials, or approve production execution.

The next gated step is to build reproducible app rootfs/package artifacts and bind the first private stream through G2 for Pixel human regression.

