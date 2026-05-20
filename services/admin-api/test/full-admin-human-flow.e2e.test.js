import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { TIERS } from "../src/domain/constants.js";

async function startTestServer() {
  const app = createApp();
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function request(baseUrl, path, { method = "GET", token, body, correlationId = "corr_full_human_flow" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": correlationId,
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function login(baseUrl) {
  const result = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: {
      email: "admin@sylion.local",
      password: "ChangeMe-LocalOnly-1!",
      fido2Verified: true
    }
  });
  assert.equal(result.status, 200);
  return result.payload.session.token;
}

test("full human admin flow covers provider, app, CDR, inventory, PKI, jurisdiction, Matrix, monitoring, incidents, audit", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);

    const tenant = await request(baseUrl, "/tenants", {
      method: "POST",
      token,
      body: { name: "Full Flow Tenant", tier: TIERS.SOVEREIGN }
    });
    assert.equal(tenant.status, 201);

    const operator = await request(baseUrl, "/operators", {
      method: "POST",
      token,
      body: {
        tenantId: tenant.payload.tenant.id,
        displayName: "Full Flow Operator",
        tier: TIERS.SOVEREIGN
      }
    });
    assert.equal(operator.status, 201);

    const provider = await request(baseUrl, "/providers", {
      method: "POST",
      token,
      body: {
        providerType: "hetzner",
        apiSecret: "full-flow-provider-secret-never-leak",
        regions: ["fsn1"],
        quota: { instances: 20, vcpu: 40, memoryGb: 160, storageGb: 1000 },
        billingHealth: { status: "healthy" },
        testConnection: { mode: "mock", status: "passed" }
      }
    });
    assert.equal(provider.status, 201);
    assert.equal(JSON.stringify(provider.payload).includes("full-flow-provider-secret-never-leak"), false);

    const app = await request(baseUrl, "/apps", {
      method: "POST",
      token,
      body: {
        name: "Signal",
        type: "messaging",
        riskClass: "medium",
        allowedTiers: [TIERS.STANDARD, TIERS.PRO, TIERS.SOVEREIGN],
        microVmDefaults: { vcpu: 1, memoryMb: 1024 },
        networkPolicy: { egress: "restricted" },
        storagePolicy: { persistence: "encrypted_overlay" },
        clipboardPolicy: { mode: "disabled" },
        cdrRequired: true,
        templateImage: "image://workload/signal/dev",
        operatorResponsibility: "Operator is responsible for app account secrets."
      }
    });
    assert.equal(app.status, 201);

    const approvedApp = await request(baseUrl, `/apps/${app.payload.app.id}/approve`, {
      method: "POST",
      token
    });
    assert.equal(approvedApp.status, 200);

    const cdrDecision = await request(baseUrl, "/cdr/decisions", {
      method: "POST",
      token,
      body: {
        tenantId: tenant.payload.tenant.id,
        operatorId: operator.payload.operator.id,
        appId: app.payload.app.id,
        direction: "ingress",
        file: {
          name: "brief.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          sha256: "abc123"
        },
        scanVerdict: "clean",
        reconstructedObjectRef: "object://cdr/reconstructed/brief"
      }
    });
    assert.equal(cdrDecision.status, 201);
    assert.equal(cdrDecision.payload.decision.decision, "allow_reconstructed");

    const transfer = await request(baseUrl, "/cdr/file-transfers", {
      method: "POST",
      token,
      body: { decisionId: cdrDecision.payload.decision.id }
    });
    assert.equal(transfer.status, 201);
    assert.equal(transfer.payload.transfer.allowed, true);

    const plan = await request(baseUrl, `/operators/${operator.payload.operator.id}/provisioning-plan`, {
      method: "POST",
      token,
      body: {
        requestedApps: ["Signal", "Telegram", "WhatsApp", "Threema"],
        jurisdictionPolicy: { mode: "full_policy", regions: ["fsn1"] }
      }
    });
    assert.equal(plan.status, 201);
    assert.equal(plan.payload.plan.baseline.vps.length, 3);
    assert.ok(plan.payload.plan.baseline.vps.every((vps) => vps.shared === false));

    const infrastructure = await request(baseUrl, "/infrastructure/vps-sets", {
      method: "POST",
      token,
      body: {
        operatorId: operator.payload.operator.id,
        provider: "hetzner",
        region: "fsn1",
        imageRef: "image://sylion/base/dev",
        certRefs: {
          G1: "cert://pending/g1",
          G2: "cert://pending/g2",
          WORKLOAD: "cert://pending/workload"
        },
        vps: [
          { role: "G1", providerResourceId: "hcloud-g1-full-flow" },
          { role: "G2", providerResourceId: "hcloud-g2-full-flow" },
          { role: "WORKLOAD", providerResourceId: "hcloud-workload-full-flow" }
        ]
      }
    });
    assert.equal(infrastructure.status, 201);
    assert.equal(infrastructure.payload.infrastructureSet.vps.length, 3);
    assert.ok(infrastructure.payload.infrastructureSet.vps.every((vps) => vps.shared === false));

    const certificate = await request(baseUrl, "/certificates", {
      method: "POST",
      token,
      body: {
        operatorId: operator.payload.operator.id,
        subjectType: "G1",
        subjectRef: "hcloud-g1-full-flow",
        serial: "serial-full-flow-g1-001",
        certificateRef: "cert://operator/g1/001",
        caRef: "ca://sylion/dev",
        infrastructureSetId: infrastructure.payload.infrastructureSet.id,
        vpsRole: "G1"
      }
    });
    assert.equal(certificate.status, 201);
    assert.equal(certificate.payload.certificate.privateKeyStored, false);

    const jurisdiction = await request(baseUrl, "/jurisdiction/policies", {
      method: "POST",
      token,
      body: {
        tenantId: tenant.payload.tenant.id,
        operatorId: operator.payload.operator.id,
        tier: TIERS.SOVEREIGN,
        name: "Full rotation policy",
        allowedProviders: ["hetzner", "ovh"],
        allowedRegions: ["fsn1", "waw"],
        rotationFrequency: "scheduled",
        rotationScopes: ["all_3_vps", "provider", "region", "certificates"]
      }
    });
    assert.equal(jurisdiction.status, 201);

    const rotation = await request(baseUrl, `/jurisdiction/policies/${jurisdiction.payload.policy.id}/rotation-plan`, {
      method: "POST",
      token,
      body: { requestedScopes: ["all_3_vps", "certificates"] }
    });
    assert.equal(rotation.status, 201);
    assert.equal(rotation.payload.rotationPlan.approvalRequired, true);

    const matrix = await request(baseUrl, "/matrix/servers", {
      method: "POST",
      token,
      body: {
        tenantId: tenant.payload.tenant.id,
        operatorId: operator.payload.operator.id,
        tier: TIERS.SOVEREIGN,
        addonEnabled: true,
        mode: "dedicated_operator",
        provider: "hetzner",
        region: "fsn1"
      }
    });
    assert.equal(matrix.status, 201);
    assert.equal(matrix.payload.server.health, "provisioning");

    const signal = await request(baseUrl, "/monitoring/signals", {
      method: "POST",
      token,
      body: {
        tenantId: tenant.payload.tenant.id,
        operatorId: operator.payload.operator.id,
        signal: "ipsec_down",
        resource: { id: "hcloud-g1-full-flow", kind: "network" },
        details: { detector: "human-flow-test", evidenceRef: "evidence://ipsec/down" }
      }
    });
    assert.equal(signal.status, 201);

    const incident = await request(baseUrl, "/incidents/from-alert", {
      method: "POST",
      token,
      body: {
        alertId: signal.payload.event.id,
        ownerId: "incident_commander_1"
      }
    });
    assert.equal(incident.status, 201);
    assert.ok(incident.payload.incident.runbookTasks.some((task) => task.fourEyes === true));

    const audit = await request(baseUrl, "/audit/events", { token });
    assert.equal(audit.status, 200);
    const auditJson = JSON.stringify(audit.payload);
    assert.equal(auditJson.includes("full-flow-provider-secret-never-leak"), false);
    for (const action of [
      "tenant.created",
      "operator.created",
      "provider.created",
      "authorized_app.created",
      "authorized_app.approved",
      "cdr.decision_recorded",
      "provisioning_plan.generated",
      "inventory.vps_set.registered",
      "pki.certificate.issued",
      "jurisdiction_policy.created",
      "jurisdiction_rotation.planned",
      "matrix_server.created",
      "monitoring.alert",
      "incident.created_from_alert"
    ]) {
      assert.ok(audit.payload.events.some((event) => event.action === action), `missing audit action ${action}`);
    }
  } finally {
    await close();
  }
});
