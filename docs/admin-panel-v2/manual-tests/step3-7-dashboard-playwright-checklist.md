# Step 3.7 Dashboard Playwright Test Checklist

Status: passed
Date: 2026-05-20

## Scope

This checklist validates Step 3.7 through the live admin dashboard using browser automation.

## Tested Flow

```text
1. Start Admin API on localhost.
2. Open /admin.
3. Sign in as Global Super Admin using local simulator credential flow.
4. Open Operators.
5. Create tenant.
6. Create operator.
7. Open Subscriptions.
8. Confirm plan cards are visible.
9. Create and approve an authorized workload app.
10. Enable Matrix and PHANTOM admin lifecycle add-ons.
11. Quote workload allocation.
12. Create workload allocation.
13. Create MicroVM placement plan.
14. Set billing state to suspended.
15. Try another allocation and confirm quota/billing denial is surfaced in the dashboard.
```

## Observed Results

```text
API status: API Healthy
Subscriptions view: visible
Plan cards: visible
Tenant subscription: suspended state visible
Add-ons: matrix_custom_server visible
Approved app: Signal Workload visible
Workload allocation: WORKLOAD layer visible
Quota decisions: allow decision visible
Final toast: Workload allocation denied by quota policy
HelpTips in subscriptions view: 7
PHANTOM text: PHANTOM stays non-executable
```

## Screenshot

```text
docs/admin-panel-v2/assets/step3-7-dashboard-playwright.png
```

## Security Assertions

```text
No provider plaintext secret was entered.
No workload secret was entered.
No communication content was entered.
Billing suspension blocked new allocation.
PHANTOM add-on did not enable PHANTOM execution.
MicroVM placement remained plan-only.
```

