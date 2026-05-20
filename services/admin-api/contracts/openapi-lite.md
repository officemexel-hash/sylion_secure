# Admin API Contract V0

To jest lekki kontrakt HTTP dla pierwszego integration spine. Docelowo zostanie zastąpiony pełnym OpenAPI.

## Auth

### POST /auth/login

Request:

```json
{
  "email": "admin@sylion.local",
  "password": "ChangeMe-LocalOnly-1!",
  "fido2Verified": true
}
```

Response 200:

```json
{
  "session": {
    "id": "session_uuid",
    "token": "bearer_token",
    "adminId": "admin_global",
    "email": "admin@sylion.local",
    "role": "Global Super Admin",
    "createdAt": "iso_timestamp"
  }
}
```

## Tenants

### POST /tenants

Headers:

```text
Authorization: Bearer <token>
X-Correlation-Id: corr_example
```

Request:

```json
{
  "name": "Acme Secure Ops",
  "tier": "STANDARD"
}
```

Response 201:

```json
{
  "tenant": {
    "id": "tenant_uuid",
    "name": "Acme Secure Ops",
    "tier": "STANDARD",
    "status": "active",
    "createdAt": "iso_timestamp"
  }
}
```

## Operators

### POST /operators

Request:

```json
{
  "tenantId": "tenant_uuid",
  "displayName": "Operator One",
  "tier": "STANDARD"
}
```

Response 201:

```json
{
  "operator": {
    "id": "op_uuid",
    "tenantId": "tenant_uuid",
    "displayName": "Operator One",
    "tier": "STANDARD",
    "status": "draft",
    "baseline": {
      "vpsPerOperator": 3,
      "router": "GL.iNet GL-XE3000 Puli AX",
      "cdrMandatory": true
    }
  }
}
```

## Provisioning Plan

### POST /operators/:operatorId/provisioning-plan

Request:

```json
{
  "requestedApps": ["WhatsApp", "Signal", "Telegram"],
  "jurisdictionPolicy": {
    "mode": "limited_manual",
    "regions": ["eu-central"]
  }
}
```

## Step 3.9 Approval Gates

### GET /operators/:operatorId/readiness

Evaluates Księga 3.4 readiness for an operator. Response includes `readyForApproval`, `blockers`, `warnings`, `deviceCoverage`, provider secret references, `humanGateRequired: true`, and `sideEffectAllowed: false`.

### GET /operators/:operatorId/readiness/history

Returns persisted readiness snapshots for an operator. Snapshots are evidence records and must not contain plaintext provider secrets, workload secrets, communication content, or terminal operational data.

### GET /readiness/:readinessId

Returns one persisted readiness snapshot by id.

### GET /system/status

Returns dashboard status matrices for Księga 3.4 and PHANTOM v3.0, including blocked production gates such as real cloud mutation, real Firecracker execution, PHANTOM activation, and customer-facing security claims.

### POST /provisioning/approvals

Creates a human-gated approval record for baseline provisioning. PHANTOM resources are rejected from execution approval.

```json
{
  "operatorId": "op_uuid",
  "planId": "plan_uuid",
  "reasonCode": "provisioning_execution_review",
  "evidenceRefs": ["readiness-check", "security-review"]
}
```

### POST /provisioning/approvals/:approvalId/status

Updates approval state. `approved_for_execution` unlocks only approval-gated baseline provisioning requests and never PHANTOM records.

```json
{
  "status": "approved_for_execution",
  "note": "Human gate complete"
}
```

### POST /workload/allocations/:allocationId/lifecycle

Transitions workload metadata through valid lifecycle states without starting or deleting real microVMs.
Step 3.9 requires `approvalId` for `approved_for_activation` and `revoked`.

```json
{
  "status": "approval_required",
  "approvalId": "approval_uuid",
  "reasonCode": "operator_lifecycle_review"
}
```

### POST /orchestrator/jobs

Step 3.9 requires `approvalId` for every orchestrator execution. The approval must be `approved_for_execution`, match the requested plan when bound, and cannot be a PHANTOM record.

```json
{
  "planId": "plan_uuid",
  "approvalId": "approval_uuid"
}
```

Missing, pending, rejected, unrelated, or PHANTOM approvals return validation errors and do not create jobs.

## Step 3.9 Provider Dry-Run Boundary

### GET /providers/dry-run/vps-plans

Returns dry-run provider plans. Optional query parameter: `operatorId`.

### POST /providers/dry-run/vps-plan

Plans cloud actions for the required 3 VPS baseline without invoking real provider mutations.

```json
{
  "providerId": "provider_uuid",
  "operatorId": "op_uuid",
  "region": "fsn1",
  "vpsPerOperator": 3,
  "mutationMode": "dry_run"
}
```

Response 201 returns planned G1/G2/WORKLOAD actions with `sideEffectAllowed: false`, `executionAllowed: false`, and secret references only. Any non-`dry_run` mutation mode is blocked behind HUMAN GATE.

## Step 3.9 PHANTOM Control Plane

All PHANTOM Step 3.8 endpoints are governance/control-plane only. Responses must preserve `humanGateRequired: true`, `sideEffectAllowed: false`, `executionAllowed: false`, and `executionEnabled: false`.

### POST /phantom/review-board

Creates a PHANTOM review board item with mandatory Legal, CISO, Architect, and Compliance/Product ownership.

### POST /phantom/review-board/:itemId/ack

Records owner acknowledgement for `legal`, `ciso`, `architect`, or `compliance`. All four acknowledgements plus evidence references are required before `approved_placeholder`.

### POST /phantom/review-board/:itemId/status

Updates review board status. `approved_placeholder` remains non-executable and is blocked until required owner acknowledgements and evidence refs exist.

### POST /phantom/policy-simulations

Runs a policy simulation only. No live connector or operational execution path is invoked.

### POST /phantom/exceptions

Records an exception request for review. Step 3.9 requires `expiresAt` and can link the exception to `packageId`, `reviewBoardItemId`, and `evidenceBundleId`. Requests with `executionRequested: true` are rejected.

### GET /phantom/packages/:packageId/evidence-coverage

Computes PHANTOM evidence coverage from policy template, evidence bundles, approval packs, review board items, policy simulations and exception expiry. The result is a governance metric only: `certificationClaim: false`, `sideEffectAllowed: false`, and `executionAllowed: false`.

Response 201:

```json
{
  "plan": {
    "id": "plan_uuid",
    "operatorId": "op_uuid",
    "tenantId": "tenant_uuid",
    "tier": "STANDARD",
    "status": "draft",
    "baseline": {
      "isolatedPerOperator": true,
      "vps": [
        { "role": "G1", "name": "op_uuid-g1", "shared": false },
        { "role": "G2", "name": "op_uuid-g2", "shared": false },
        { "role": "WORKLOAD", "name": "op_uuid-workload", "shared": false }
      ],
      "router": {
        "model": "GL.iNet GL-XE3000 Puli AX",
        "qualificationRequired": true
      },
      "cdr": {
        "mandatory": true,
        "rule": "No file ingress/egress without CDR decision."
      }
    },
    "workloads": [],
    "humanGates": []
  }
}
```

## M11 Authorized App Catalog

Only `Global Super Admin` may create, approve, or block catalog entries.

### POST /apps

Request:

```json
{
  "name": "Signal Desktop",
  "type": "messaging",
  "riskClass": "medium",
  "allowedTiers": ["STANDARD", "PRO", "SOVEREIGN"],
  "microVmDefaults": { "vcpu": 2, "memoryMiB": 2048, "diskMiB": 8192 },
  "networkPolicy": { "outbound": ["tcp/443"], "inbound": [] },
  "storagePolicy": { "persistent": false, "maxEphemeralMiB": 1024 },
  "clipboardPolicy": { "mode": "metadata_only", "pasteIntoWorkload": false },
  "cdrRequired": true,
  "templateImage": "image_factory/signal-desktop:approved",
  "operatorResponsibility": "Operator must route all file exchange through CDR."
}
```

Response 201 returns an app with `status: "pending_approval"` and emits `authorized_app.created`.

### POST /apps/:appId/approve

Response 200 returns the app with `status: "approved"` and emits `authorized_app.approved`.

### POST /apps/:appId/block

Request:

```json
{
  "reason": "vendor risk review failed"
}
```

Response 200 returns the app with `status: "blocked"` and emits `authorized_app.blocked`.

## M12 CDR Service

Invariant: `No file ingress/egress without CDR decision.`

### POST /cdr/decisions

Request:

```json
{
  "tenantId": "tenant_uuid",
  "operatorId": "op_uuid",
  "appId": "app_uuid",
  "direction": "ingress",
  "file": {
    "name": "report.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 4096,
    "sha256": "sha256_hex"
  },
  "scanVerdict": "clean",
  "reconstructedObjectRef": "cdr/reconstructed/report.pdf",
  "evidence": { "scanner": "contract-cdr" }
}
```

Response 201 returns a CDR decision. Supported outcomes are `allow_reconstructed`, `block`, and `quarantine`. Unknown or unsupported file types return `quarantine`; malicious or policy-failure verdicts return `block`; clean files require a reconstructed object reference to return `allow_reconstructed`. Emits `cdr.decision_recorded` plus a content-free monitoring-compatible event.

### POST /cdr/file-transfers

Request:

```json
{
  "decisionId": "cdr_uuid"
}
```

Response 201 authorizes only `allow_reconstructed` decisions. Missing, blocked, or quarantined decisions return `409 cdr_decision_required` and emit a deny audit event.

## M08 Provider Registry / M18 Secret Manager Adapter

Provider API credentials are write-time only. Responses and audit events expose `apiSecretReference.secretReference`; they do not expose plaintext.

### POST /providers

Request:

```json
{
  "providerType": "hetzner",
  "apiSecret": "write_time_only",
  "regions": ["fsn1", "nbg1"],
  "quota": {
    "instances": 12,
    "vcpu": 24,
    "memoryGb": 96,
    "storageGb": 750
  },
  "billingHealth": {
    "status": "healthy"
  },
  "testConnection": {
    "mode": "mock",
    "status": "passed"
  }
}
```

Response 201:

```json
{
  "provider": {
    "id": "provider_uuid",
    "providerKey": "hetzner",
    "displayName": "Hetzner Cloud",
    "metadata": {
      "providerKey": "hetzner",
      "apiType": "token",
      "docsUrl": "https://docs.hetzner.cloud/",
      "extensible": false
    },
    "apiSecretReference": {
      "secretReference": "secret://admin-api/secret_uuid/v1",
      "version": 1,
      "rotatedAt": "iso_timestamp"
    },
    "regions": ["fsn1", "nbg1"],
    "quota": {
      "instances": 12,
      "vcpu": 24,
      "memoryGb": 96,
      "storageGb": 750
    },
    "billingHealth": {
      "status": "healthy",
      "checkedAt": null,
      "message": null
    },
    "connection": {
      "status": "passed",
      "mode": "mock",
      "checkedAt": "iso_timestamp",
      "message": null
    }
  }
}
```

Built-in provider metadata supports `hetzner` and `ovh`. Custom providers are accepted when `displayName`, `regions`, and explicit `metadata` are supplied.

### GET /providers

Response 200:

```json
{
  "providers": [
    {
      "id": "provider_uuid",
      "providerKey": "ovh",
      "apiSecretReference": {
        "secretReference": "secret://admin-api/secret_uuid/v1",
        "version": 1,
        "rotatedAt": "iso_timestamp"
      }
    }
  ]
}
```

### POST /providers/:providerId/secret-rotation

Request:

```json
{
  "apiSecret": "write_time_only_replacement",
  "testConnection": {
    "mode": "mock",
    "status": "passed"
  }
}
```

Response 200:

```json
{
  "provider": {
    "id": "provider_uuid",
    "apiSecretReference": {
      "secretReference": "secret://admin-api/secret_uuid/v2",
      "version": 2,
      "rotatedAt": "iso_timestamp"
    }
  }
}
```

Rotation emits `secret.rotated` and `provider.api_secret_rotated` audit events containing only secret references.

## Audit

### GET /audit/events

Response 200:

```json
{
  "events": [
    {
      "id": "audit_uuid",
      "actorId": "admin_global",
      "action": "operator.created",
      "resourceType": "operator",
      "resourceId": "op_uuid",
      "correlationId": "corr_example",
      "hash": "sha256_hash"
    }
  ]
}
```

## PHANTOM Step 3.6 Administrative Lifecycle

PHANTOM v3.0 is a separate `[A]` track outside the certifiable SYLION baseline. These endpoints provide administrative lifecycle, evidence, readiness and audit controls only. They do not execute PHANTOM behavior.

Invariant for all PHANTOM lifecycle responses:

```text
humanGateRequired=true
sideEffectAllowed=false
executionAllowed=false
executionEnabled=false where applicable
```

### GET /phantom/policy-templates

Returns safe policy templates such as Legal/CISO/Architect Review, Simulation-Only Readiness and Sovereign Exception Review.

### POST /phantom/policy-templates

Creates a safe administrative template.

Request:

```json
{
  "name": "Legal/CISO/Architect Review",
  "tierMinimum": "PRO",
  "controlObjectives": ["Separate track claim review"],
  "requiredEvidenceTypes": ["legal memo"]
}
```

### POST /phantom/packages

Builds an administrative capability package from policy templates and redacted capability metadata.

Request:

```json
{
  "name": "PHANTOM Lifecycle Admin Package",
  "description": "Administrative readiness and evidence lifecycle only",
  "policyTemplateId": "phantom_template_legal_ciso_architect",
  "capabilityIds": ["phantom_capability_uuid"],
  "tierMinimum": "PRO"
}
```

Response 201 includes `stage`, `readinessState`, `sideEffectAllowed: false` and `executionAllowed: false`.

### POST /phantom/evidence-bundles

Stores sealed evidence references. The request must contain references only, not secrets, communication content, or operational PHANTOM parameters.

```json
{
  "packageId": "phantom_package_uuid",
  "summary": "Review evidence references for HUMAN GATE",
  "evidenceRefs": ["legal-memo-ref", "ciso-risk-note-ref"],
  "controlsSatisfied": ["Human gate ownership"],
  "retentionClass": "worm_audit"
}
```

### POST /phantom/approval-packs

Bundles approvals and evidence for HUMAN GATE review.

```json
{
  "packageId": "phantom_package_uuid",
  "approvalIds": ["phantom_approval_uuid"],
  "evidenceBundleIds": ["phantom_evidence_uuid"],
  "summary": "Owners and evidence are ready for HUMAN GATE review"
}
```

### POST /phantom/readiness/evaluate

Evaluates completeness and subscription fit. Even `ready_for_human_gate` remains non-executable in baseline.

```json
{
  "packageId": "phantom_package_uuid",
  "approvalPackId": "phantom_approval_pack_uuid",
  "evidenceBundleId": "phantom_evidence_uuid",
  "operatorId": "op_uuid"
}
```

Response 201 includes `readinessState`, `readinessScore`, `blockers`, `warnings`, `gateState`, and always `executionAllowed: false`.

### POST /phantom/simulations

Creates a simulation-only review run.

```json
{
  "packageId": "phantom_package_uuid",
  "scenario": "readiness_review",
  "assumptions": ["No live connector", "Panel review only"]
}
```

Response includes `mode: "simulation_only"`, `sideEffectAllowed: false`, and `executionAllowed: false`.

### POST /phantom/assignment-plans

Checks operator eligibility against tier and baseline constraints.

```json
{
  "packageId": "phantom_package_uuid",
  "operatorIds": ["op_uuid"]
}
```

Response includes operator summaries with `vpsPerOperator`, `cdrMandatory`, router baseline and eligibility state. It does not create, rotate, delete, or execute infrastructure.

### GET /phantom/audit-correlation

Returns PHANTOM audit metadata summary and latest hash reference. Optional query parameter: `packageId`.

## Step 3.7 Subscription, Workload And Billing Controls

These endpoints control subscription limits and workload allocation metadata before provisioning. They do not execute Firecracker, mutate cloud resources, store workload secrets, or weaken the 3 VPS per operator baseline.

### GET /subscription/plans

Returns STANDARD, PRO and SOVEREIGN plan records.

Each plan includes:

```json
{
  "id": "plan_pro",
  "tier": "PRO",
  "maxWorkloadEnvironments": 10,
  "maxAppsPerOperator": 5,
  "matrixAddonAvailable": true,
  "phantomAdminLifecycleAvailable": true,
  "phantomExecutionAllowed": false,
  "cdrMandatory": true
}
```

### POST /subscription/plans

Creates a custom draft plan. `cdrMandatory` must remain `true`.

### GET /tenants/:tenantId/subscription

Returns tenant subscription ledger with effective limits, add-ons and billing state.

### POST /tenants/:tenantId/subscription

Updates tenant plan and add-ons.

```json
{
  "planId": "plan_pro",
  "addons": ["matrix_custom_server", "phantom_admin_lifecycle"]
}
```

PHANTOM add-on exposes admin lifecycle visibility only. It never sets PHANTOM execution to true.

### POST /tenants/:tenantId/billing-state

Supported states:

```text
trial
active
past_due
suspended
cancelled
```

Suspended tenants cannot create new workload allocations or provisioning plans. Audit and evidence remain readable.

### POST /operators/:operatorId/workload-allocations/quote

Dry-run quota evaluation. This endpoint records a quota decision but creates no allocation.

```json
{
  "appId": "app_uuid",
  "requestedCount": 2
}
```

Response 201:

```json
{
  "decision": {
    "decision": "allow",
    "totalAfterChange": 2,
    "tierLimit": 10,
    "remainingAfterChange": 8,
    "sideEffectAllowed": false
  }
}
```

### POST /operators/:operatorId/workload-allocations

Creates workload allocation metadata only when quota allows it and the app is approved.

Response includes:

```json
{
  "allocation": {
    "targetLayer": "WORKLOAD",
    "cdrRequired": true,
    "sideEffectAllowed": false,
    "executionPlanned": false
  }
}
```

### POST /operators/:operatorId/microvm-placement-plan

Creates a plan-only placement record for an existing allocation.

```json
{
  "allocationId": "workload_alloc_uuid"
}
```

Response includes `vpsPerOperator: 3`, `shared: false`, `targetLayer: "WORKLOAD"`, and `sideEffectAllowed: false`.

### GET /subscription/quota-decisions

Returns recent quota decision metadata. No communication content, app secrets, provider secrets or workload secrets are stored.

## Devices

### POST /devices

Registers Pixel/GrapheneOS, Puli AX, or FIDO2 inventory records.

Important invariant:

```text
Device inventory must not contain operational data, passwords, seed phrases, or private keys.
```

## Image Artifacts

### POST /images/artifacts

Builds signed artifact references for:

```text
pixel_grapheneos_profile
puli_ax_router_config
workload_image
microvm_template
```

The service returns artifact references and signature references only. It rejects plaintext secrets in artifact policies.

## Orchestrator

### POST /orchestrator/jobs

Executes an approved provisioning plan with an `Idempotency-Key` header or `idempotencyKey` body field.

Execution creates:

```text
3 VPS inventory records
G1/G2/WORKLOAD certificate references
Pixel/router/workload image artifacts
monitoring activation event
rollback plan
```

The orchestrator is idempotent by key. Repeating the same request with the same key returns the same job.

## M09 Infrastructure Inventory

### POST /operators/:operatorId/infrastructure/vps-set

Registers one isolated infrastructure set for an operator. The set must contain exactly one `G1`, one `G2`, and one `WORKLOAD` VPS. `infrastructureSetId` and provider resource IDs cannot be reused by another operator.

Request:

```json
{
  "infrastructureSetId": "infra_set_uuid",
  "provider": "provider-a",
  "region": "eu-central-1",
  "imageRef": "image/workload/2026.05.20",
  "certRefs": {
    "G1": "hsm-certref://operator/g1/serial",
    "G2": "hsm-certref://operator/g2/serial",
    "WORKLOAD": "hsm-certref://operator/workload/serial"
  },
  "lifecycleState": "active",
  "drift": { "detected": false },
  "vps": [
    { "role": "G1", "providerResourceId": "provider-vps-g1" },
    { "role": "G2", "providerResourceId": "provider-vps-g2" },
    { "role": "WORKLOAD", "providerResourceId": "provider-vps-workload" }
  ]
}
```

Response 201:

```json
{
  "infrastructureSet": {
    "id": "infra_set_uuid",
    "operatorId": "op_uuid",
    "tenantId": "tenant_uuid",
    "provider": "provider-a",
    "region": "eu-central-1",
    "imageRef": "image/workload/2026.05.20",
    "lifecycleState": "active",
    "isolatedPerOperator": true,
    "vps": [
      {
        "role": "G1",
        "providerResourceId": "provider-vps-g1",
        "certRef": "hsm-certref://operator/g1/serial",
        "shared": false
      }
    ]
  }
}
```

### POST /infrastructure/:infrastructureSetId/lifecycle

Request:

```json
{
  "lifecycleState": "rotating"
}
```

Response 200 returns the updated infrastructure set and emits `inventory.vps_set.lifecycle_transitioned`.

## M14 PKI / Certificate Lifecycle

The PKI module tracks certificate references only. It must not accept private keys, PEM key material, secrets, or raw key custody payloads. Private keys remain outside this module in HSM or Secret Manager custody.

### POST /operators/:operatorId/certificates

Request:

```json
{
  "subjectType": "G1",
  "subjectRef": "vps_uuid",
  "serial": "serial-001",
  "certificateRef": "hsm-certref://operator/g1/serial-001",
  "caRef": "hsm-ca://sylion/intermediate-01",
  "notBefore": "2026-05-20T00:00:00.000Z",
  "notAfter": "2026-08-20T00:00:00.000Z",
  "infrastructureSetId": "infra_set_uuid",
  "vpsRole": "G1"
}
```

Response 201:

```json
{
  "certificate": {
    "id": "cert_uuid",
    "operatorId": "op_uuid",
    "tenantId": "tenant_uuid",
    "subjectType": "G1",
    "subjectRef": "vps_uuid",
    "serial": "serial-001",
    "certificateRef": "hsm-certref://operator/g1/serial-001",
    "caRef": "hsm-ca://sylion/intermediate-01",
    "status": "issued",
    "privateKeyStored": false,
    "keyCustody": "external_hsm_or_secret_manager_reference"
  }
}
```

### POST /certificates/:certificateId/rotate

Request:

```json
{
  "serial": "serial-002",
  "certificateRef": "hsm-certref://operator/g1/serial-002",
  "caRef": "hsm-ca://sylion/intermediate-01"
}
```

Response 200 returns `{ "rotated": {}, "replacement": {} }` and emits `pki.certificate.rotated`.

### POST /certificates/:certificateId/revoke

Request:

```json
{
  "reason": "operator rotation complete"
}
```

Response 200 returns the revoked certificate reference and emits `pki.certificate.revoked`.

## M15 Monitoring & Anomaly Detection

Monitoring telemetry is metadata-only. Requests that include communication content fields such as `content`, `message`, `body`, `payload`, `plaintext`, `conversation`, `chat`, `text`, `fileContents`, or `packetCapture` are rejected before audit.

### POST /monitoring/health-status

Request:

```json
{
  "tenantId": "tenant_uuid",
  "operatorId": "op_uuid",
  "resource": { "id": "g1_uuid", "kind": "g1_vps" },
  "status": "degraded",
  "details": {
    "detector": "synthetic_probe",
    "metric": "heartbeat",
    "observedValue": 0
  }
}
```

Response 201:

```json
{
  "event": {
    "id": "mon_uuid",
    "eventType": "health_status",
    "signal": "health_status",
    "severity": "medium",
    "resource": { "id": "g1_uuid", "kind": "g1_vps" }
  }
}
```

### POST /monitoring/signals

Supported signals: `ipsec_down`, `dns_leak`, `microvm_crash_loop`, `cert_expiry`, `cdr_failure`, `provider_drift`.

Request:

```json
{
  "signal": "ipsec_down",
  "tenantId": "tenant_uuid",
  "operatorId": "op_uuid",
  "resource": { "id": "g1-ipsec", "kind": "network" },
  "details": {
    "detector": "synthetic_probe",
    "evidenceRef": "evidence://ipsec-down"
  }
}
```

Response 201 returns a `monitoring_event` with `eventType` of `alert` or `anomaly_event` and emits `monitoring.alert` or `monitoring.anomaly_event` audit records.

### GET /monitoring/events

Optional query filters: `eventType`, `tenantId`, `operatorId`.

Response 200:

```json
{
  "events": []
}
```

## M17 Incident & Runbook Manager

Incidents can be created from monitoring `alert` and `anomaly_event` records. Runbook tasks whose actions are destructive are returned with `approvalRequired: true` and `fourEyes: true`.

### POST /incidents/from-alert

Request:

```json
{
  "alertId": "mon_uuid",
  "severity": "critical",
  "ownerId": "incident_commander_1",
  "affectedResources": [
    { "id": "cert-ipsec-1", "kind": "certificate" }
  ]
}
```

Response 201:

```json
{
  "incident": {
    "id": "inc_uuid",
    "sourceAlertId": "mon_uuid",
    "status": "open",
    "severity": "critical",
    "ownerId": "incident_commander_1",
    "timeline": [],
    "runbookTasks": [
      {
        "id": "task_uuid",
        "title": "Rotate certificate through PKI approval flow",
        "action": "cert.rotate",
        "destructive": true,
        "approvalRequired": true,
        "fourEyes": true
      }
    ]
  }
}
```

### POST /incidents/:incidentId/timeline

Request:

```json
{
  "type": "owner_note",
  "note": "PKI owner paged; waiting for approval."
}
```

Response 200 returns the updated incident and emits `incident.timeline_added`.

### GET /incidents

Response 200:

```json
{
  "incidents": []
}
```
