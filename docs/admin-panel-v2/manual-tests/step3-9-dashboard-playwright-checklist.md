# SYLION Admin Panel V2 - Step 3.9 Dashboard Playwright Checklist

Date: 2026-05-20
Result: PASS after one UI fix

## Environment

```text
URL: http://127.0.0.1:8099/admin
Browser surface: Codex in-app browser with Playwright-backed clicks
Server: npm.cmd run start:admin-api
API tests: npm.cmd test
```

## Human-Style Click Path

```text
1. Open /admin.
2. Enroll FIDO2 with dev/test simulator.
3. Sign in as Global Super Admin.
4. Run Demo Flow.
5. Click every primary navigation item:
   Overview, Operators, Providers, Devices, Subscriptions, Approvals, Provisioning, Security, PHANTOM, Audit.
6. In Providers, click Plan Dry-Run VPS.
7. In Approvals, click Evaluate Readiness and Transition Lifecycle.
8. In PHANTOM, click each governance action:
   Add Capability, Create Approval, Add Risk, Create Package, Seal Evidence,
   Build Approval Pack, Evaluate Gate, Run Simulation, Plan Assignment,
   Create Review Item, Run Policy Simulation, Create Exception,
   Acknowledge Owner, Evaluate Coverage.
9. Capture desktop and mobile screenshots.
```

## Assertions Observed

```text
Login: PASS
Demo Flow: PASS
Readiness: PASS, ready=true after FIDO2 + Pixel + Puli AX + provider + allocation
Provider dry-run: PASS, Actions=3, Side effect=false
Lifecycle transition: PASS, approval_required metadata transition recorded
PHANTOM workflow: PASS, no execution enabled
PHANTOM coverage: PASS, certification=false
Audit view: PASS, hash-chain rows visible
Desktop visual: PASS
Mobile visual: PASS, no horizontal overflow after CSS fix
```

## Problems Found

```text
P1 fixed: Demo Flow did not create FIDO2 or workload allocation, so readiness stayed blocked and lifecycle had no valid allocation.
Fix: Demo Flow now creates FIDO2, authorized app, approved app, workload allocation and binds approval to allocation.

P2 fixed: Lifecycle UI submitted an empty allocation path and showed Route not found.
Fix: UI now guards empty allocation selection before POST.

P3 fixed: Mobile viewport had horizontal text overflow in topbar subtitle.
Fix: main min-width, overflow guards and mobile padding added.
```

## Screenshots

```text
docs/admin-panel-v2/assets/step3-9-dashboard-desktop.png
docs/admin-panel-v2/assets/step3-9-dashboard-mobile.png
```

