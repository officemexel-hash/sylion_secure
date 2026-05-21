# Admin API Implementation Status

Status na 2026-05-21. Commit HEAD: `5b04e9f` (Step 3.16).

V1 jest zamrozone. V2 Step 1, Step 2, Step 3.1, Step 3.2, Step 3.3, Step 3.4, Step 3.5, Step 3.6, Step 3.7, Step 3.8, Step 3.9, Step 3.10, Step 3.11, Step 3.12, Step 3.13, Step 3.14, Step 3.15 i Step 3.16 sa zaimplementowane:

```text
Step 1:    API SDK + SQLite persistence foundation
Step 2:    Live Admin Shell served by Admin API under /admin
Step 3.1:  WebAuthn-compatible auth API, challenge store, credential registry, session and step-up endpoints
Step 3.2:  Step-up enforcement for provider secrets and orchestrator execution
Step 3.3:  Recovery request workflow, account lockout and break-glass placeholder model
Step 3.4:  WebAuthn verifier boundary, credential lifecycle and auth hardening
Step 3.5:  PHANTOM governance-only boundary and premium admin UX foundation
Step 3.6:  PHANTOM full administrative lifecycle and execution-readiness gates
Step 3.7:  Subscription, workload environment and billing controls
Step 3.8:  Provisioning approval queue, workload lifecycle and PHANTOM control plane expansion
Step 3.9:  Approval and test hardening, system status views
Step 3.10: Dashboard testing automation and PHANTOM package review matrix
Step 3.11: Release control + production-readiness gates + Playwright dashboard regression
Step 3.12: Live execution gates (Hetzner sandbox, Firecracker host qualification, CPU confidential)
Step 3.13: Operator provisioning pipeline + local lab VPS metadata + communicator templates
Step 3.14: Local environment harness (operatorEnvironmentService)
Step 3.15: Gated live provider unlock layer (provider-generic route, OVH stub, rollback plans)
Step 3.16: Runtime secrets + Hetzner sandbox operations (EnvSecretProvider, reconcile, rollback)
```

## Zaimplementowane Moduly Domenowe

```text
M01 Admin Shell / Frontend
M02 Authentication
M03 RBAC / Permissions
M04 Tenant Management
M05 Operator Management
M06 Subscription & Entitlements
M07 Provisioning Plan Engine
M08 Provider Registry
M09 Infrastructure Inventory
M10 Device Inventory
M11 Authorized App Catalog
M12 CDR Service
M13 Jurisdiction Policy Engine
M14 PKI / Certificate Lifecycle
M15 Monitoring & Anomaly Detection
M16 Audit / WORM / Hash-chain
M17 Incident & Runbook Manager
M18 Secret Manager Adapter (+ EnvSecretProvider)
M19 Image Factory
M20 Orchestrator / Job Runner
M21 Matrix Server Manager
M22 Provisioning Approval Queue
M23 Subscription Plan Catalog + Billing Controls
M24 Release Control + Production Readiness Gates
M25 Live Execution Service (Hetzner sandbox, Firecracker qualification, CPU confidential, PHANTOM lab request)
M26 Operator Provisioning Pipeline + Communicator Templates + Local Lab VPS
M27 Operator Environment Harness
```

## Aktualna struktura `services/admin-api/src/modules/`

```text
approvals/      provisioningApprovalService (509 LOC)
apps/           appCatalogService (166 LOC)
audit/          auditService (51 LOC) — sha256 hash chain (NOT yet WORM, vide F-19)
auth/           authService (914 LOC), authPolicy, webauthnVerifier
cdr/            cdrService (188 LOC)
devices/        deviceInventoryService (208 LOC)
entitlements/   entitlementService (58 LOC)
images/         imageFactoryService (118 LOC)
incidents/      incidentService (167 LOC)
inventory/      inventoryService (281 LOC)
jurisdiction/   jurisdictionPolicyService (131 LOC)
live/           liveExecutionService (712 LOC) — gated live cloud execution
matrix/         matrixServerService (60 LOC)
monitoring/     monitoringService (194 LOC)
operators/      operatorService (64 LOC)
orchestrator/   orchestratorService (223 LOC)
phantom/        phantomGovernanceService (1413 LOC) — governance metadata only, executionAllowed=false invariant
pki/            pkiService (251 LOC) — metadata-only, no HSM integration yet
providers/      providerRegistryService (238 LOC), dryRun/providerDryRunService (100 LOC)
provisioning/   provisioningPlanService, operatorProvisioningPipelineService (281 LOC),
                operatorEnvironmentService (453 LOC)
rbac/           rbacService (119 LOC)
release/        releaseControlService (455 LOC) — release gates, problem registry, evidence index
secrets/        secretManagerService (128 LOC) — references only, EnvSecretProvider for live tokens
subscriptions/  subscriptionService (587 LOC) — plan catalog, ledger, quota, add-ons, billing
tenants/        tenantService (52 LOC)
```

Łącznie: **~8508 LOC** w 25 modułach.

## Frontend V2

```text
apps/admin-web/index.html
apps/admin-web/styles.css
apps/admin-web/app.js
```

Panel live obsluguje:

```text
WebAuthn-compatible enrollment/login przez lokalny simulator
health/status API
dashboard metryk z premium status strip i HelpTip anchors
tworzenie tenantow i operatorow
dodawanie providerow bez ujawniania plaintext secret
rejestracje Pixel / GrapheneOS, Puli AX i FIDO2
generowanie provisioning planu
uruchamianie orchestrator job
step-up modal dla chronionych operacji
podglad audit stream
demo flow end-to-end z poziomu przegladarki
session status security view
recovery request creation without automatic unlock
break-glass placeholder creation with HUMAN GATE marker
WebAuthn mode selector and capability status
credential list/suspend/revoke with step-up protection
auth policy matrix visibility
PHANTOM governance boundary as separate track
PHANTOM capability/approval/risk governance records without execution
PHANTOM policy templates, packages, evidence bundles, approval packs and readiness gates
PHANTOM simulation-only runs, subscription-aware assignment planning and audit correlation
PHANTOM package review matrix + owner acknowledgement + exception revalidation
subscription plan catalog, tenant subscription ledger, workload quota and billing state controls
authorized app workload allocations and microVM placement planning
provisioning approval queue + workload lifecycle states + operator readiness
Release view: gates, human test center, problem registry, evidence index, Ksiega 3.4 matrix, PHANTOM boundary proof
Live Execution: cloud gate, Firecracker host qualification, CPU confidential gate, PHANTOM lab request
Operators: provisioning pipeline, local virtual VPS, secrets gate, communicator templates
Operator Environment harness (ready / failed states)
Live provider rollback plans visibility
Hetzner sandbox status (configured/connected, no plaintext)
```

## Najwazniejsze Testy

```text
admin-web-static.test.js
  Admin Web jest serwowany przez Admin API pod /admin.

auth-webauthn-step3.test.js
  WebAuthn-compatible enrollment/login, challenge replay, expired challenge,
  missing credential, session-bound step-up i leakage checks.

step-up-enforcement-step3-2.test.js
  Step-up enforcement dla provider create, provider secret rotation i orchestrator job.

recovery-lockout-step3-3.test.js
  Account lockout po powtarzalnych bledach, recovery request bez auto-unlock,
  review-only status workflow, RBAC denial dla support readonly oraz break-glass
  placeholder z HUMAN GATE i separacja PHANTOM v3.0.

webauthn-hardening-step3-4.test.js
  WebAuthn verifier boundary, auth policy matrix, credential lifecycle,
  step-up dla revoke, revoked credential login block oraz audit leakage checks.

phantom-governance-step3-5.test.js
  PHANTOM governance boundary, capability registry, approval workflow, risk register,
  RBAC denial, no side effects, HUMAN GATE and prohibited operational detail rejection.

phantom-lifecycle-step3-6.test.js
  PHANTOM policy templates, capability packages, evidence bundles, approval packs,
  readiness gate, simulation-only runner, tier-aware assignment plans, audit correlation,
  RBAC denial, prohibited operational detail rejection and no execution enablement.

subscriptions-workloads-step3-7.test.js
  Subscription plan catalog, tenant subscription ledger, quota allow/deny, workload allocation,
  microVM placement planning, Matrix add-on gate, PHANTOM admin lifecycle non-execution,
  billing suspension and audit preservation.

approvals-lifecycle-step3-8.test.js
  Provisioning approval queue, workload lifecycle state machine, operator readiness gate.

step3-9-system-status-phantom-provider.test.js
  System status view + PHANTOM provider boundary tests.

step3-10-phantom-boundary-human-tests.test.js
  PHANTOM package review matrix, owner acknowledgement, exception revalidation.

release-control-step3-11.test.js (lub odpowiednik)
  Release gates, problem registry, evidence artifacts, Ksiega 3.4 matrix.

live-execution-step3-12.test.js (lub odpowiednik)
  Hetzner sandbox request, Firecracker host qualification, CPU confidential gate,
  PHANTOM execution request (approved_for_lab_review only).

step3-13-operator-provisioning-pipeline.test.js
  Auto pipeline draft per nowy operator, local lab VPS, Firecracker plan, secrets deny.

step3-14-operator-environment-harness.test.js
  Local environment lifecycle state machine.

step3-15-live-provider-unlock.test.js
  Provider-generic route, OVH blocked, rollback plans, Hetzner sandbox gates.

step3-16-secrets-hetzner-sandbox.test.js
  EnvSecretProvider zero plaintext, Hetzner reconcile/rollback, token isolation in audit.

full-admin-human-flow.e2e.test.js
  Pelny przeplyw przez HTTP:
  login -> tenant -> operator -> provider -> app -> CDR -> provisioning plan
  -> devices -> orchestrator -> inventory -> PKI -> image artifacts
  -> jurisdiction -> Matrix -> monitoring -> incident -> audit.

devices-images-orchestrator.test.js
persistence-sdk.v2.test.js
spine.e2e.test.js
apps-cdr.contract.test.js
inventory-pki.contract.test.js
monitoring-incidents.contract.test.js
jurisdiction-matrix.test.js
providerRegistry.test.js / providers.e2e.test.js
```

## Uruchomienie Testow

PowerShell blokuje `npm.ps1`, dlatego uzywamy:

```powershell
npm.cmd test
npm.cmd run test:dashboard  # Playwright
```

Aktualny wynik:

```text
77 tests
77 passing
0 failing
```

## Dashboard / Playwright Regression

Test artifacts w `docs/admin-panel-v2/test-artifacts/`:

```text
step3-11-dashboard-regression/      # release control regression
step3-12-live-execution-regression/ # live execution gates regression
step3-13-operator-pipeline-regression/
step3-14-operator-environment-regression/
step3-15-live-provider-regression/
```

Każdy katalog zawiera desktop + mobile PNG-i + `summary.json`.

## Production Readiness Status

Per `docs/admin-panel-v2/55-step3-11-implementation-freeze-production-readiness.md`:

```text
productionExecutionAllowed = false
ready_for_metadata_release_review = true (after human review)
```

Pozostają HUMAN GATE blockery (per `releaseControlService` gates):

- `gate_provider_mutation` — blocked_human_gate (Vault/KMS swap pending, owner: SRE)
- `gate_firecracker` — blocked_human_gate (real microVM launch not implemented, owner: Platform)
- `gate_hsm` — blocked_human_gate (production HSM integration, owner: Security)
- `gate_router_puli_ax` — partial (firmware signing pipeline missing, owner: Hardware)
- `gate_graphene_image` — blocked_human_gate (real image build pipeline, owner: Mobile)
- `gate_phantom_v3` — review_required (legal/CISO/architect, owner: Legal/CISO/Architect)

## Nastepny Priorytet (orientacyjnie, audit-driven)

```text
1. Vault/KMS/HSM backend pod EnvSecretProvider (zamknac F-25 final).
2. WORM hardening audit hash chain (F-19) — HMAC w HSM lub external anchor.
3. Token rotation policy + audit (F-34).
4. Provider rate-limit/backoff (F-31).
5. Persistent reconciliation history (F-32).
6. Branch protection + signed commits (F-15, F-16) — GitHub admin.
7. Rozwoj Step 3.17 - TBD (Codex decision).
```

PHANTOM v3.0 pozostaje `[A]` poza certifiable baseline. Wszystkie release gate decyzje to HUMAN GATE.
