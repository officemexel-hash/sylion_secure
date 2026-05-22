# Step 3.53 - Workload Image Manifests

Status: implemented and tested

Date: 2026-05-22

## Scope

This step adds the missing control-plane contract between the delivered Hetzner AX102-U `WORKLOAD_NATIVE` host and future real application launches.

The admin panel can now register workload image manifests for:

- Signal
- Telegram
- WhatsApp
- Threema
- Zangi
- DuckDuckGo Browser
- LibreOffice
- Exodus

## Security Rules

- Production execution remains blocked.
- Secrets release remains blocked.
- Terminal data storage is explicitly false.
- CDR is mandatory for every workload image manifest.
- Stream sources must bind privately and route through G2.
- Pixel viewport/touch readiness must be declared before lab launch readiness.
- Zangi is treated as Android-native until a supported desktop/microVM package is approved.
- Container runtimes remain lab helpers unless a tier-specific ADR approves them.

## API

- `GET /live-execution/workload-images/manifests`
- `POST /live-execution/workload-images/manifests`

POST requires a fresh admin step-up.

## Admin UI

The Live Execution view now includes:

- Workload Image form
- Workload Image Manifests cards

Each card shows host, runtime, image reference, private stream binding, CDR reference, checks, blockers and next actions.

## Lab Host Link

The manifests attach to the registered host:

- Host ID: `WORKLOAD_NATIVE_LAB_01`
- Server: Hetzner Robot `AX102-U #2983993`
- IPv4: `65.109.123.72`
- Region: `hel1`

## Remaining Production Blockers

- `g1_g2_private_path_not_bound`
- `g2_stream_broker_not_bound`
- `pixel_human_regression_pending`
- `hsm_pki_not_integrated`
- `app_image_build_not_reproducible_yet`

## Tests

`npm.cmd test`

Result: 159 passing tests.

New test file:

- `services/admin-api/test/step3-53-workload-image-manifests.test.js`

Coverage:

- CDR-gated Signal Firecracker manifest can become lab-launch ready.
- Public stream binding is blocked.
- Sensitive build evidence is rejected.
- Zangi requires Android-native evidence.

