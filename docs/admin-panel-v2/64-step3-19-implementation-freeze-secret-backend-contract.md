# Step 3.19 Freeze - Secret Backend Contract

Date: 2026-05-21

## Scope

Step 3.19 adds the production-facing contract for secret backends without claiming production HSM readiness. The Admin API can now register Vault, Cloud KMS, HSM and BYO-HSM backend references, expose backend posture in the dashboard, and attach provider credentials to external secret references instead of write-time plaintext.

## Implemented

- `GET /secrets/backend-status`
- `GET /secrets/backends`
- `POST /secrets/backends`
- `SecretManagerService.configureBackend`
- `SecretManagerService.createExternalReference`
- `SecretManagerService.rotateExternalReference`
- Provider creation can use `externalSecretReference + secretBackendId`.
- Provider secret rotation can rotate an external reference.
- Admin dashboard Secret Backend form and status cards.
- Dashboard Playwright smoke clicks Secret Backend registration.
- Tests for:
  - Vault/KMS/HSM backend contract remains reference-only.
  - env runtime token status does not leak plaintext.
  - provider external secret references avoid API-key plaintext.
  - external references containing secret material are rejected.

## Security Invariants

- Secret backend registration stores references and evidence only.
- Plaintext retrieval remains `false`.
- Production secret release remains `false`.
- HSM/BYO-HSM is not marked production ready.
- Runtime environment remains a gated resolver only for live smoke.
- Provider tokens are not returned by API, UI, audit or artifacts.
- PHANTOM remains separate and cannot unlock baseline secrets.

## Mermaid

```mermaid
flowchart TD
  Admin["Admin dashboard"] --> API["Admin API"]
  API --> Secrets["Secret Manager"]
  Secrets --> Local["Local reference store"]
  Secrets --> Env["Runtime env resolver"]
  Secrets --> Vault["Vault reference"]
  Secrets --> KMS["Cloud KMS reference"]
  Secrets --> HSM["HSM/BYO-HSM reference"]
  Provider["Provider Registry"] --> Secrets
  Secrets --> Audit["Hash-chain audit"]
  Vault --> Gate["Human gate"]
  KMS --> Gate
  HSM --> Gate
  Gate --> Block["productionSecretReleaseAllowed=false"]
```

```mermaid
sequenceDiagram
  participant UI as "Admin dashboard"
  participant API as "Admin API"
  participant Auth as "FIDO2 step-up"
  participant Secrets as "Secret Manager"
  participant Provider as "Provider Registry"
  participant Audit as "Audit"

  UI->>API: POST /secrets/backends
  API->>Auth: require fresh step-up
  Auth-->>API: allow
  API->>Secrets: configureBackend(reference-only)
  Secrets->>Audit: secret.backend_configured
  API-->>UI: backend, plaintextRetrievalAllowed=false

  UI->>API: POST /providers externalSecretReference
  API->>Auth: require fresh step-up
  API->>Provider: create provider
  Provider->>Secrets: createExternalReference
  Secrets->>Audit: secret.external_reference_created
  API-->>UI: secret://admin-api/... metadata only
```

## Remaining

- Real Vault token/auth method integration.
- Real KMS/HSM attestation and signing operations.
- External WORM anchor for audit hash chain.
- Production HSM go-live requires HUMAN GATE with Security, Infra and Compliance.
