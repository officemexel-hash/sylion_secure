# Step 3.18 Freeze - Live Provider Rehearsal

Date: 2026-05-21

## Scope

Step 3.18 adds a controlled provider rehearsal layer for the SYLION live cloud path. It validates the 3-VPS baseline, approval binding, environment gates, adapter behavior, reconciliation and cleanup without requiring provider API keys in chat.

## Implemented

- `LIVE_PROVIDER_REHEARSAL` resource type.
- `GET /live-execution/cloud/rehearsals`
- `POST /live-execution/cloud/{provider}/rehearsal`
- `scripts/hetzner-live-smoke.mjs` real-provider smoke runner with catalog preflight.
- Admin SDK helpers for listing/running rehearsals.
- Admin dashboard Provider Rehearsal form and evidence cards.
- Playwright dashboard smoke now clicks the rehearsal path.
- Tests for:
  - Hetzner adapter sandbox without runtime token.
  - live provider rehearsal blocked unless `SYLION_LIVE_SMOKE_ALLOWED=true`.
  - live provider create/list/delete sequence behind env gate and cleanup confirmation.
  - Hetzner partial-create cleanup if provider creation fails after one or more VPS resources.

## Modes

| Mode | Provider side effects | Purpose |
| --- | --- | --- |
| `gate_only` | No | Evaluate gates only. |
| `adapter_sandbox` | No | Exercise provider-shaped create/list/delete contract with synthetic resources. |
| `live_provider` | Yes, gated | Real provider smoke only when live env gates, approval, step-up and cleanup confirmation are present. |

## Security Invariants

- No provider token is accepted through chat or stored in repo.
- Runtime provider token status is shown without plaintext.
- Live smoke preflight writes only sanitized status, HTTP code and `tokenLogged=false`.
- If a live create fails after partial server creation, the adapter attempts rollback cleanup before surfacing the failure.
- Rehearsal does not enable production execution.
- PHANTOM remains separate and cannot unlock baseline.
- Every adapter path requires G1/G2/WORKLOAD shape.
- Cleanup/rollback is mandatory for adapter and live smoke modes.
- Audit records every rehearsal outcome.

## 3.18a Live Smoke Preflight Evidence

The first Hetzner live smoke attempt did not create resources. Provider preflight failed before mutation because the supplied runtime token was rejected by Hetzner with HTTP `401`.

Evidence file:

- `docs/admin-panel-v2/test-artifacts/step3-18-hetzner-live-smoke/preflight-failed.json`

Operational decision:

- Treat the exposed one-time token as burned and revoke it.
- Next live smoke must receive a fresh project-scoped Hetzner token through runtime environment or a secret manager, not source control.
- Keep `SYLION_LIVE_SMOKE_CONFIRM=I_UNDERSTAND_COST_AND_CLEANUP` and the three-server cap enabled for cost safety.

## Mermaid

```mermaid
sequenceDiagram
  participant Admin as "Admin dashboard"
  participant API as "Admin API"
  participant Auth as "FIDO2 step-up"
  participant Gate as "Live gate"
  participant Adapter as "Provider adapter"
  participant Audit as "Hash-chain audit"

  Admin->>API: POST /live-execution/cloud/hetzner/rehearsal
  API->>Auth: require fresh step-up
  Auth-->>API: allow or deny
  API->>Gate: evaluate provider, operator, approval, env, cleanup
  alt blocked
    Gate-->>API: blockers
    API->>Audit: live_cloud.provider_rehearsal_completed
    API-->>Admin: blocked_human_gate
  else adapter_sandbox
    API->>Adapter: create synthetic G1/G2/WORKLOAD
    API->>Adapter: list synthetic resources
    API->>Adapter: cleanup synthetic resources
    API->>Audit: smoke_passed, sideEffectAllowed=false
    API-->>Admin: rehearsal evidence
  else live_provider
    API->>Adapter: create real G1/G2/WORKLOAD
    API->>Adapter: list real resources
    API->>Adapter: cleanup real resources
    API->>Audit: smoke_passed, sideEffectAllowed=true
    API-->>Admin: rehearsal evidence, productionExecutionAllowed=false
  end
```

## Remaining For 3.19-3.21

- 3.19: replace env-only secret backend with Vault/KMS/HSM adapter contract.
- 3.20: real/local Firecracker host qualification and launch rehearsal.
- 3.21: full human Playwright suite across admin + operator portals with issue inventory.
