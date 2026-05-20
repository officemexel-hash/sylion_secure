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

