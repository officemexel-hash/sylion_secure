import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { TIERS } from "../src/domain/constants.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startServer() {
  const app = createApp();
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          app.close();
          resolve();
        })
      )
  };
}

async function loginClient(baseUrl) {
  const client = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_operator_management_${crypto.randomUUID()}`
  });
  const session = await client.login({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!",
    fido2Verified: true
  });
  return client.withToken(session.token);
}

test("admin can rename, retier and delete operators with audit-retained confirmation", async () => {
  const server = await startServer();
  try {
    const client = await loginClient(server.baseUrl);
    const tenant = await client.createTenant({
      name: "Operator Management Tenant",
      tier: TIERS.PRO
    });
    const created = await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Original Operator",
      tier: TIERS.PRO
    });

    const updated = await client.updateOperator(created.operator.id, {
      displayName: "Renamed Operator",
      tier: TIERS.PHANTOM,
      status: "active",
      labels: ["managed", "live-cleanup"]
    });
    assert.equal(updated.operator.displayName, "Renamed Operator");
    assert.equal(updated.operator.tier, TIERS.PHANTOM);
    assert.equal(updated.operator.status, "active");
    assert.equal(updated.operator.baseline.workloadTenancy, "dedicated_operator_only");

    await assert.rejects(
      () =>
        client.deleteOperator(created.operator.id, {
          confirmation: "DELETE_OPERATOR:wrong",
          reason: "negative confirmation test"
        }),
      /confirmation did not match/
    );

    const deleted = await client.deleteOperator(created.operator.id, {
      confirmation: `DELETE_OPERATOR:${created.operator.id}`,
      reason: "operator management cleanup"
    });
    assert.equal(deleted.deletion.state, "deleted_control_plane");
    assert.equal(deleted.deletion.auditRetention, "preserved");

    const operators = await client.request("/operators");
    assert.equal(
      operators.operators.some((operator) => operator.id === created.operator.id),
      false
    );

    const audit = await client.listAuditEvents();
    assert.ok(audit.events.some((event) => event.action === "operator.updated"));
    assert.ok(audit.events.some((event) => event.action === "operator.deleted"));
  } finally {
    await server.close();
  }
});

test("admin operator commercial summary exposes segmentation, cost and subscription fields", async () => {
  const server = await startServer();
  try {
    const client = await loginClient(server.baseUrl);
    const tenant = await client.createTenant({
      name: "Commercial Segmentation Tenant",
      tier: TIERS.PRO
    });
    const created = await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Commercial Operator",
      tier: TIERS.PRO
    });

    const summary = await client.getOperatorCommercialSummary();
    assert.equal(summary.summary.totals.totalOperators, 1);
    assert.equal(summary.summary.totals.tierCounts.PRO, 1);
    assert.equal(summary.summary.totals.monthlyInfraCostPln, 760);
    assert.equal(summary.summary.totals.soldSeats, 0);
    const row = summary.summary.rows.find((item) => item.operatorId === created.operator.id);
    assert.equal(row.displayName, "Commercial Operator");
    assert.equal(row.purchase.method, "manual_admin");
    assert.equal(row.purchase.accountType, "manual_admin");
    assert.equal(row.commercial.source, "not_tracked");
    assert.equal(row.subscription.minimumMonths, 12);
    assert.equal(row.subscription.state, "active");
    assert.ok(row.subscription.daysRemaining > 350);
    assert.equal(row.tokenMaterialStoredPlaintext, false);
  } finally {
    await server.close();
  }
});
