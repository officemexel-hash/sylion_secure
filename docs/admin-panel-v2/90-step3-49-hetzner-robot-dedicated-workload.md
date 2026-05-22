# Step 3.49 - Hetzner Robot Dedicated WORKLOAD_NATIVE Gate

Date: 2026-05-22

## Freeze

Hetzner Robot webservice ordering is now modeled as a separate provider path from Hetzner Cloud.

- `hetzner` remains the Cloud API adapter for G1/G2/basic VPS workflows.
- `hetzner_robot` represents dedicated/root server ordering for per-operator `WORKLOAD_NATIVE`.
- Every operator still keeps the Ksiegi 3.4 baseline of exactly 3 machines: G1, G2 and WORKLOAD.
- The WORKLOAD may be upgraded to a dedicated bare-metal host when Firecracker/KVM/Android native workloads are required.
- Ordering is default-deny and requires admin step-up, an approved provisioning approval, explicit live/cost/hardware confirmations and runtime env gates.
- No Robot username/password is stored in provider records, audit events, API responses or terminal-side state.

## Runtime Gates

Required env for Robot test/live execution:

```text
SYLION_PROVIDER_MODE=live
SYLION_LIVE_ALLOWED=true
SYLION_LIVE_ALLOWLIST_OPERATORS=*
SYLION_LIVE_ALLOWED_REGIONS=fsn1,nbg1,hel1
SYLION_HETZNER_ROBOT_ALLOWED_PRODUCTS=AX102,...
SYLION_HETZNER_ROBOT_MAX_MONTHLY_EUR=120
SYLION_HETZNER_ROBOT_USER=<runtime secret>
SYLION_HETZNER_ROBOT_PASSWORD=<runtime secret>
SYLION_HETZNER_ROBOT_ORDERING_ENABLED=true
```

Additional paid order gate:

```text
SYLION_HETZNER_ROBOT_PAID_ORDER_ALLOWED=true
```

Without the paid gate the system can still record `plan_only` and, when Robot supports it safely for the selected transaction, `robot_test` flows, but it must not place a paid order.

## Admin Panel

The Providers view now includes:

- provider type `Hetzner Robot Dedicated`
- dedicated workload order form
- product allowlist fields via env gates
- order modes:
  - `plan_only`
  - `robot_test`
  - `live_order`
- evidence cards for dedicated workload orders

The form is intentionally explicit about paid risk and hardware verification. KVM/binderfs must still be verified on the delivered server before Firecracker or Android workload secrets are released.

## Dependency Graph

```mermaid
flowchart TD
    A["Admin creates operator"] --> B["Operator baseline: G1 + G2 + WORKLOAD"]
    B --> C["Hetzner Cloud provider"]
    B --> D["Hetzner Robot provider"]
    C --> E["G1 VPS"]
    C --> F["G2 VPS"]
    D --> G["Dedicated WORKLOAD_NATIVE order gate"]
    G --> H{"All gates passed?"}
    H -- "no" --> I["Blocked audit event"]
    H -- "plan_only" --> J["Plan only, no provider mutation"]
    H -- "robot_test/live_order" --> K["Robot transaction"]
    K --> L["Delivered bare metal"]
    L --> M["Host preflight: /dev/kvm, binderfs, nftables, CDR"]
    M --> N{"KVM + Android gates pass?"}
    N -- "no" --> O["No secrets release, no production workload"]
    N -- "yes" --> P["Firecracker/Android workload installation"]
    P --> Q["Pixel thin client through VPN -> G1 -> G2 -> WORKLOAD"]
```

## Implemented

- `services/admin-api/src/modules/live/hetznerRobotAdapter.js`
- `hetzner_robot` provider metadata and capabilities
- dedicated workload order persistence and API routes
- admin panel order controls and evidence cards
- SDK methods for dedicated workload orders
- tests for:
  - Robot provider capability matrix
  - blocked paid ordering without gates
  - plan-only flow without provider mutation
  - Robot adapter Basic auth and sanitized responses

## Verification

```text
npm.cmd test
151/151 passing
```

## Remaining Production Work

- Configure Robot credentials only on the admin VPS runtime environment.
- Add real product discovery UI from `/order/server/product` before paid ordering is enabled.
- After a dedicated server is delivered, run host preflight:

```bash
ls -l /dev/kvm
egrep -c '(vmx|svm)' /proc/cpuinfo
lsmod | grep kvm
mount | grep binder
uname -a
```

- Install Firecracker/KVM runtime and Android workload runner only after gates pass.
- Rerun Pixel human regression against the new `WORKLOAD_NATIVE` path.
