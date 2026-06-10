import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { CDR_DECISIONS, TIERS } from "../src/domain/constants.js";

async function startTestServer() {
  const app = createApp();
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function request(
  baseUrl,
  path,
  { method = "GET", token, body, correlationId = "corr_step3_39_blue_team" } = {}
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": correlationId,
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, payload: await response.json() };
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

function appPayload(name = "Blue Team Signal") {
  return {
    name,
    type: "messaging",
    riskClass: "medium",
    allowedTiers: [TIERS.STANDARD, TIERS.PRO, TIERS.SOVEREIGN],
    microVmDefaults: { vcpu: 2, memoryMiB: 2048, diskMiB: 8192 },
    networkPolicy: { outbound: ["tcp/443"], inbound: [] },
    storagePolicy: { persistent: false, maxEphemeralMiB: 1024 },
    clipboardPolicy: { mode: "metadata_only", pasteIntoWorkload: false },
    cdrRequired: true,
    templateImage: "image_factory/blue-team-cdr:approved",
    operatorResponsibility: "Operator must route every file ingress and egress through CDR."
  };
}

test("Step 3.39 Blue Team dashboard shows mandatory CDR coverage and metadata-only attack alerts", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    await request(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: "admin@sylion.local", password: "wrong-1", fido2Verified: true }
    });
    await request(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: "admin@sylion.local", password: "wrong-2", fido2Verified: true }
    });

    const token = await login(baseUrl);
    const tenant = await request(baseUrl, "/tenants", {
      method: "POST",
      token,
      body: { name: "Step 3.39 Blue Team Tenant", tier: TIERS.PRO }
    });
    assert.equal(tenant.status, 201);
    const operator = await request(baseUrl, "/operators", {
      method: "POST",
      token,
      body: {
        tenantId: tenant.payload.tenant.id,
        displayName: "Step 3.39 Blue Team Operator",
        tier: TIERS.PRO
      }
    });
    assert.equal(operator.status, 201);

    const app = await request(baseUrl, "/apps", {
      method: "POST",
      token,
      body: appPayload()
    });
    assert.equal(app.status, 201);
    await request(baseUrl, `/apps/${app.payload.app.id}/approve`, { method: "POST", token });

    const decision = await request(baseUrl, "/cdr/decisions", {
      method: "POST",
      token,
      body: {
        tenantId: tenant.payload.tenant.id,
        operatorId: operator.payload.operator.id,
        appId: app.payload.app.id,
        direction: "ingress",
        file: {
          name: "clean-brief.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
          sha256: "31f2a0f16f7f6c9a2a13b1d2c3e4f506172839405162738495a6b7c8d9e0f111"
        },
        scanVerdict: "clean",
        reconstructedObjectRef: "cdr/reconstructed/clean-brief.pdf",
        evidence: { scanner: "blue-team-cdr-test" }
      }
    });
    assert.equal(decision.status, 201);
    assert.equal(decision.payload.decision.decision, CDR_DECISIONS.ALLOW_RECONSTRUCTED);

    const keyAlert = await request(baseUrl, "/monitoring/signals", {
      method: "POST",
      token,
      body: {
        signal: "key_material_change",
        tenantId: tenant.payload.tenant.id,
        operatorId: operator.payload.operator.id,
        resource: { id: "operator-fido2-policy", kind: "key_material" },
        details: {
          detector: "admin_blue_team_panel",
          evidenceRef: "evidence://blue-team/key-material-change"
        }
      }
    });
    assert.equal(keyAlert.status, 201);

    const dashboard = await request(baseUrl, "/monitoring/blue-team-dashboard", { token });
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.payload.dashboard.metadataOnly, true);
    assert.equal(dashboard.payload.dashboard.communicationContentStored, false);
    assert.equal(dashboard.payload.dashboard.cdrMandatoryForAllOperators, true);
    assert.ok(
      dashboard.payload.dashboard.metadataSignals.some(
        (item) => item.key === "auth_attack_events" && item.value >= 2
      )
    );
    assert.ok(dashboard.payload.dashboard.alerts.some((alert) => alert.signal === "auth_attack"));
    assert.ok(
      dashboard.payload.dashboard.alerts.some((alert) => alert.signal === "key_material_change")
    );

    const coverage = dashboard.payload.dashboard.cdrCoverage.find(
      (item) => item.operatorId === operator.payload.operator.id
    );
    assert.equal(coverage.status, "active");
    assert.equal(coverage.cdrMandatory, true);
    assert.equal(coverage.decisions, 1);
    assert.equal(coverage.allowed, 1);
    assert.equal(coverage.contentStored, false);
    assert.equal(JSON.stringify(dashboard.payload.dashboard).includes("secret chat body"), false);
  } finally {
    await close();
  }
});

test("Step 3.39 Blue Team rejects content-bearing telemetry before audit storage", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const rejected = await request(baseUrl, "/monitoring/signals", {
      method: "POST",
      token,
      body: {
        signal: "auth_attack",
        resource: { id: "login-endpoint", kind: "identity" },
        details: {
          detector: "test",
          message: "secret chat body that must never be accepted"
        }
      }
    });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.payload.error.details.invariant, "no_communication_content");

    const audit = await request(baseUrl, "/audit/events", { token });
    assert.equal(
      JSON.stringify(audit.payload.events).includes("secret chat body that must never be accepted"),
      false
    );
  } finally {
    await close();
  }
});
