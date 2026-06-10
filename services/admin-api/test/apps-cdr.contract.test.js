import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { APP_STATUSES, CDR_DECISIONS, TIERS } from "../src/domain/constants.js";

async function startTestServer() {
  const app = createApp();
  const server = await app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    app,
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function request(
  baseUrl,
  path,
  { method = "GET", token, body, correlationId = "corr_apps_cdr_test" } = {}
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
  const payload = await response.json();
  return { status: response.status, payload };
}

async function login(baseUrl, email = "admin@sylion.local", password = "ChangeMe-LocalOnly-1!") {
  const response = await request(baseUrl, "/auth/login", {
    method: "POST",
    body: { email, password, fido2Verified: true }
  });
  assert.equal(response.status, 200);
  return response.payload.session.token;
}

function appPayload(name = "Signal Desktop") {
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
    templateImage: "image_factory/signal-desktop:approved",
    operatorResponsibility:
      "Operator must use app only for assigned tenant workflows and route all file exchange through CDR."
  };
}

test("M11 app catalog creation and approval are restricted to Global Super Admin", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const readonlyToken = await login(baseUrl, "readonly@sylion.local", "ReadOnly-LocalOnly-1!");
    const deniedCreate = await request(baseUrl, "/apps", {
      method: "POST",
      token: readonlyToken,
      body: appPayload()
    });
    assert.equal(deniedCreate.status, 403);
    assert.equal(deniedCreate.payload.error.code, "forbidden");

    const adminToken = await login(baseUrl);
    const created = await request(baseUrl, "/apps", {
      method: "POST",
      token: adminToken,
      body: appPayload()
    });
    assert.equal(created.status, 201);
    assert.equal(created.payload.app.status, APP_STATUSES.PENDING_APPROVAL);
    assert.equal(created.payload.app.cdrRequired, true);
    assert.deepEqual(created.payload.app.allowedTiers, [
      TIERS.STANDARD,
      TIERS.PRO,
      TIERS.SOVEREIGN
    ]);

    const approved = await request(baseUrl, `/apps/${created.payload.app.id}/approve`, {
      method: "POST",
      token: adminToken
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.payload.app.status, APP_STATUSES.APPROVED);
    assert.ok(approved.payload.app.approvedAt);

    const audit = await request(baseUrl, "/audit/events", { token: adminToken });
    const actions = audit.payload.events.map((event) => event.action);
    assert.ok(actions.includes("authorized_app.created"));
    assert.ok(actions.includes("authorized_app.approved"));
  } finally {
    await close();
  }
});

test("M11 blocks authorized apps and rejects catalog entries without mandatory CDR", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const adminToken = await login(baseUrl);
    const noCdr = await request(baseUrl, "/apps", {
      method: "POST",
      token: adminToken,
      body: { ...appPayload("Unsafe App"), cdrRequired: false }
    });
    assert.equal(noCdr.status, 422);
    assert.equal(noCdr.payload.error.code, "validation_error");

    const created = await request(baseUrl, "/apps", {
      method: "POST",
      token: adminToken,
      body: appPayload("Blocked Later")
    });
    const blocked = await request(baseUrl, `/apps/${created.payload.app.id}/block`, {
      method: "POST",
      token: adminToken,
      body: { reason: "vendor risk review failed" }
    });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.payload.app.status, APP_STATUSES.BLOCKED);
    assert.equal(blocked.payload.app.blockReason, "vendor risk review failed");
  } finally {
    await close();
  }
});

test("M12 CDR allows only reconstructed clean files and emits audit plus monitoring events", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const adminToken = await login(baseUrl);
    const app = await request(baseUrl, "/apps", {
      method: "POST",
      token: adminToken,
      body: appPayload("CDR Approved App")
    });
    await request(baseUrl, `/apps/${app.payload.app.id}/approve`, {
      method: "POST",
      token: adminToken
    });

    const blockedTransfer = await request(baseUrl, "/cdr/file-transfers", {
      method: "POST",
      token: adminToken,
      body: { tenantId: "tenant_contract", operatorId: "op_contract" }
    });
    assert.equal(blockedTransfer.status, 409);
    assert.equal(blockedTransfer.payload.error.code, "cdr_decision_required");

    const decision = await request(baseUrl, "/cdr/decisions", {
      method: "POST",
      token: adminToken,
      body: {
        tenantId: "tenant_contract",
        operatorId: "op_contract",
        appId: app.payload.app.id,
        direction: "ingress",
        file: {
          name: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 4096,
          sha256: "7a38c5f6d2f1d9f1670f5f2b4c9fd4f8aa55a8f5a3f5d7d2f1f6c7a8b9c0d1e2"
        },
        scanVerdict: "clean",
        reconstructedObjectRef: "cdr/reconstructed/report.pdf",
        evidence: { scanner: "contract-cdr" }
      }
    });
    assert.equal(decision.status, 201);
    assert.equal(decision.payload.decision.decision, CDR_DECISIONS.ALLOW_RECONSTRUCTED);
    assert.equal(decision.payload.decision.evidence.contentStored, false);

    const allowedTransfer = await request(baseUrl, "/cdr/file-transfers", {
      method: "POST",
      token: adminToken,
      body: { decisionId: decision.payload.decision.id }
    });
    assert.equal(allowedTransfer.status, 201);
    assert.equal(allowedTransfer.payload.transfer.allowed, true);

    const monitoring = await request(baseUrl, "/cdr/monitoring-events", { token: adminToken });
    assert.equal(monitoring.status, 200);
    assert.ok(monitoring.payload.events.some((event) => event.eventType === "cdr.decision"));
    assert.ok(monitoring.payload.events.some((event) => event.eventType === "cdr.file_transfer"));

    const audit = await request(baseUrl, "/audit/events", { token: adminToken });
    const cdrAudit = audit.payload.events.filter((event) => event.action.startsWith("cdr."));
    assert.ok(cdrAudit.some((event) => event.action === "cdr.decision_recorded"));
    assert.ok(cdrAudit.some((event) => event.policyDecision === "deny"));
    assert.ok(cdrAudit.some((event) => event.policyDecision === "allow"));
  } finally {
    await close();
  }
});

test("M12 CDR quarantines unknown or unsupported file types and blocks malicious verdicts", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const adminToken = await login(baseUrl);
    const app = await request(baseUrl, "/apps", {
      method: "POST",
      token: adminToken,
      body: appPayload("CDR Quarantine App")
    });
    await request(baseUrl, `/apps/${app.payload.app.id}/approve`, {
      method: "POST",
      token: adminToken
    });

    const unknown = await request(baseUrl, "/cdr/decisions", {
      method: "POST",
      token: adminToken,
      body: {
        tenantId: "tenant_contract",
        operatorId: "op_contract",
        appId: app.payload.app.id,
        direction: "egress",
        file: { name: "payload.bin", mimeType: "application/octet-stream", sizeBytes: 12 },
        scanVerdict: "unknown"
      }
    });
    assert.equal(unknown.status, 201);
    assert.equal(unknown.payload.decision.decision, CDR_DECISIONS.QUARANTINE);

    const malicious = await request(baseUrl, "/cdr/decisions", {
      method: "POST",
      token: adminToken,
      body: {
        tenantId: "tenant_contract",
        operatorId: "op_contract",
        appId: app.payload.app.id,
        direction: "ingress",
        file: { name: "malware.txt", mimeType: "text/plain", sizeBytes: 12 },
        scanVerdict: "malicious",
        reconstructedObjectRef: "cdr/reconstructed/malware.txt"
      }
    });
    assert.equal(malicious.status, 201);
    assert.equal(malicious.payload.decision.decision, CDR_DECISIONS.BLOCK);

    const deniedTransfer = await request(baseUrl, "/cdr/file-transfers", {
      method: "POST",
      token: adminToken,
      body: { decisionId: unknown.payload.decision.id }
    });
    assert.equal(deniedTransfer.status, 409);
    assert.equal(deniedTransfer.payload.error.code, "cdr_decision_required");
  } finally {
    await close();
  }
});
