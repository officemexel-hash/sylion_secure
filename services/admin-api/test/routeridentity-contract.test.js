// Contract test for the router identity / cellular readiness surface.
//
// The on-disk "routerIdentity" module directory is empty; the router
// identity / readiness role for the Puli AX access router is implemented by
// RouterReadinessService (services/admin-api/src/modules/router/
// routerReadinessService.js) and exposed over HTTP as /router/packages,
// /router/postures and /operators/:id/router-package|router-posture.
//
// step3-30-puli-ax-router-vpn-readiness.test.js already covers the deep
// happy-path (IPsec T0/T1/T2 manifest, posture gates, secret rejection) with an
// admin actor. This contract test deliberately does NOT duplicate those
// operational details. It pins the module *boundaries* instead:
//   - auth/RBAC denial: the readiness surface is closed to anonymous callers
//   - input validation: identity must resolve to a real operator
//   - lab-only gating invariant: generated packages never claim production
//     execution / side-effect authority (productionExecutionAllowed=false)

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { loginClient, request, startTestServer } from "./helpers.js";

async function seedOperatorWithRouter(baseUrl, token) {
  const tenant = await request(baseUrl, "POST", "/tenants", {
    token,
    body: { name: "RouterIdentity Contract Tenant", tier: "PRO" }
  });
  assert.equal(tenant.status, 201, tenant.text);

  const operator = await request(baseUrl, "POST", "/operators", {
    token,
    body: {
      tenantId: tenant.json.tenant.id,
      displayName: "RouterIdentity Contract Operator",
      tier: "PRO",
      requestedTemplates: ["whatsapp", "signal", "telegram"]
    }
  });
  assert.equal(operator.status, 201, operator.text);

  const device = await request(baseUrl, "POST", "/devices", {
    token,
    body: {
      type: "puli_ax_router",
      serial: `puli-contract-${randomUUID()}`,
      model: "GL.iNet GL-XE3000 Puli AX",
      firmwareVersion: "OpenWrt 23.05.5",
      assignedOperatorId: operator.json.operator.id,
      posture: { state: "router_lab_pending" },
      qualificationStatus: "needs_evidence"
    }
  });
  assert.equal(device.status, 201, device.text);

  return { operator: operator.json.operator, router: device.json.device };
}

test("router readiness surface rejects anonymous callers (RBAC/auth denial)", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const packages = await request(baseUrl, "GET", "/router/packages");
    assert.equal(packages.status, 401);
    assert.equal(packages.json.error.code, "unauthenticated");

    const postures = await request(baseUrl, "GET", "/router/postures");
    assert.equal(postures.status, 401);
    assert.equal(postures.json.error.code, "unauthenticated");

    const generate = await request(baseUrl, "POST", "/operators/op_anon/router-package", {
      body: { firmwareTarget: "openwrt-23.05+" }
    });
    assert.equal(generate.status, 401);
    assert.equal(generate.json.error.code, "unauthenticated");
  } finally {
    await close();
  }
});

test("router package generation validates operator identity (unknown operator -> 404)", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const { token } = await loginClient(baseUrl, "routeridentity");
    const response = await request(baseUrl, "POST", "/operators/op_does_not_exist/router-package", {
      token,
      body: { firmwareTarget: "openwrt-23.05+" }
    });
    assert.equal(response.status, 404);
    assert.equal(response.json.error.code, "not_found");
    assert.equal(response.json.error.details.resource, "operator");
  } finally {
    await close();
  }
});

test("router package is lab-only and never claims production execution", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const { token } = await loginClient(baseUrl, "routeridentity");
    const { operator, router } = await seedOperatorWithRouter(baseUrl, token);

    const generated = await request(baseUrl, "POST", `/operators/${operator.id}/router-package`, {
      token,
      body: { routerDeviceId: router.id, firmwareTarget: "openwrt-23.05+" }
    });
    assert.equal(generated.status, 201, generated.text);
    const pkg = generated.json.package;

    // Lab-only gating invariant: a router readiness package must never grant
    // production execution or side-effect authority, and must declare no
    // private key material / secrets in its manifest.
    assert.equal(pkg.productionExecutionAllowed, false);
    assert.equal(pkg.sideEffectAllowed, false);
    assert.equal(pkg.manifest.secretsIncluded, false);
    assert.equal(pkg.manifest.privateKeyMaterialIncluded, false);
    assert.ok(
      pkg.blockers.includes("physical_router_install_pending"),
      "package must stay blocked pending physical install"
    );

    // The authenticated list endpoint returns the just-created package and
    // preserves the lab-only invariant on every record.
    const list = await request(baseUrl, "GET", `/router/packages?operatorId=${operator.id}`, {
      token
    });
    assert.equal(list.status, 200, list.text);
    assert.ok(Array.isArray(list.json.packages));
    const listed = list.json.packages.find((record) => record.id === pkg.id);
    assert.ok(listed, "generated package must appear in the operator-scoped list");
    assert.equal(listed.productionExecutionAllowed, false);
  } finally {
    await close();
  }
});
