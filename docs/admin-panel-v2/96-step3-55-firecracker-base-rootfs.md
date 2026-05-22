# Step 3.55 - Firecracker Base Rootfs

Status: implemented and executed on the live dedicated host

Date: 2026-05-22

## Scope

This step creates the first real Firecracker base rootfs artifact on the Hetzner Robot dedicated `WORKLOAD_NATIVE` host.

Script:

- `scripts/workload-native-firecracker-base-image.mjs`

## Live Execution

Plan command:

```powershell
node scripts/workload-native-firecracker-base-image.mjs
```

Apply command:

```powershell
node scripts/workload-native-firecracker-base-image.mjs --apply
```

Result:

- image path: `/opt/sylion-firecracker/images/base/noble-base.ext4`
- suite: `noble`
- size: `4 GiB`
- status: `built`
- SHA256: `dea6101530bd19f4e90fb863d3f93a127e9e61538942d77ac78e36feec90b47e`
- evidence path: `/opt/sylion-workloads/evidence/firecracker-base-image.json`

## Security Boundary

This is a launchable base rootfs artifact only.

It does not contain communicator accounts, workload secrets, operator data, HSM/FIDO2 material, session state or terminal-side operational data.

Production execution remains blocked.

## Next Step

Derive per-app rootfs artifacts from this base:

- Signal
- DuckDuckGo Browser
- LibreOffice

Then bind the first lab stream privately through G2 and run Pixel human regression.

