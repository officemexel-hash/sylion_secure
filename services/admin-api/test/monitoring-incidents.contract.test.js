import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

async function startTestServer() {
  const app = createApp();
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function request(
  baseUrl,
  path,
  { method = "GET", token, body, correlationId = "corr_monitoring_test" } = {}
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

test("M15 records required health, alert, and anomaly events without communication content", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const health = await request(baseUrl, "/monitoring/health-status", {
      method: "POST",
      token,
      body: {
        tenantId: "tenant_contract",
        operatorId: "op_contract",
        resource: { id: "g1-contract", kind: "g1_vps" },
        status: "degraded",
        details: { detector: "synthetic_probe", metric: "heartbeat", observedValue: 0 }
      }
    });
    assert.equal(health.status, 201);
    assert.equal(health.payload.event.eventType, "health_status");

    const signals = [
      ["ipsec_down", "alert"],
      ["dns_leak", "anomaly_event"],
      ["microvm_crash_loop", "alert"],
      ["cert_expiry", "alert"],
      ["cdr_failure", "alert"],
      ["provider_drift", "anomaly_event"]
    ];
    for (const [signal, eventType] of signals) {
      const result = await request(baseUrl, "/monitoring/signals", {
        method: "POST",
        token,
        body: {
          signal,
          tenantId: "tenant_contract",
          operatorId: "op_contract",
          resource: { id: `${signal}_resource` },
          details: { detector: "synthetic_probe", evidenceRef: `evidence://${signal}` }
        }
      });
      assert.equal(result.status, 201);
      assert.equal(result.payload.event.signal, signal);
      assert.equal(result.payload.event.eventType, eventType);
      assert.equal(result.payload.event.details.evidenceRef, `evidence://${signal}`);
    }

    const listed = await request(baseUrl, "/monitoring/events", { token });
    assert.equal(listed.status, 200);
    assert.equal(listed.payload.events.length, 7);
    assert.ok(
      listed.payload.events.every(
        (event) => JSON.stringify(event).includes("message text") === false
      )
    );

    const rejected = await request(baseUrl, "/monitoring/signals", {
      method: "POST",
      token,
      body: {
        signal: "dns_leak",
        resource: { id: "resolver-contract" },
        details: { packetCapture: "message text that must never be logged" }
      }
    });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.payload.error.details.invariant, "no_communication_content");

    const audit = await request(baseUrl, "/audit/events", { token });
    const auditText = JSON.stringify(audit.payload.events);
    assert.equal(auditText.includes("message text that must never be logged"), false);
    assert.ok(audit.payload.events.some((event) => event.action === "monitoring.health_status"));
    assert.ok(audit.payload.events.some((event) => event.action === "monitoring.alert"));
    assert.ok(audit.payload.events.some((event) => event.action === "monitoring.anomaly_event"));
  } finally {
    await close();
  }
});

test("M17 creates incidents from alerts with owner, timeline, resources, and four-eyes runbook flags", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const alert = await request(baseUrl, "/monitoring/signals", {
      method: "POST",
      token,
      body: {
        signal: "cert_expiry",
        tenantId: "tenant_contract",
        operatorId: "op_contract",
        resource: { id: "cert-ipsec-1", kind: "certificate" },
        details: { evidenceRef: "evidence://cert-expiry" }
      }
    });
    assert.equal(alert.status, 201);

    const created = await request(baseUrl, "/incidents/from-alert", {
      method: "POST",
      token,
      body: {
        alertId: alert.payload.event.id,
        severity: "critical",
        ownerId: "incident_commander_1",
        affectedResources: [{ id: "cert-ipsec-1", kind: "certificate" }]
      }
    });
    assert.equal(created.status, 201);
    const incident = created.payload.incident;
    assert.equal(incident.severity, "critical");
    assert.equal(incident.ownerId, "incident_commander_1");
    assert.deepEqual(incident.affectedResources, [{ id: "cert-ipsec-1", kind: "certificate" }]);
    assert.equal(incident.timeline[0].type, "created_from_alert");
    assert.ok(incident.runbookTasks.some((task) => task.action === "cert.rotate"));
    assert.ok(
      incident.runbookTasks
        .filter((task) => task.destructive)
        .every((task) => {
          return task.approvalRequired === true && task.fourEyes === true;
        })
    );

    const updated = await request(baseUrl, `/incidents/${incident.id}/timeline`, {
      method: "POST",
      token,
      body: {
        type: "owner_note",
        note: "PKI owner paged; waiting for approval."
      }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.payload.incident.timeline.length, 2);

    const listed = await request(baseUrl, "/incidents", { token });
    assert.equal(listed.status, 200);
    assert.equal(listed.payload.incidents.length, 1);

    const audit = await request(baseUrl, "/audit/events", { token });
    const actions = audit.payload.events.map((event) => event.action);
    assert.ok(actions.includes("incident.created_from_alert"));
    assert.ok(actions.includes("incident.timeline_added"));
  } finally {
    await close();
  }
});
