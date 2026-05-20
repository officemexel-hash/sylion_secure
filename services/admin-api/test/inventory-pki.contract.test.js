import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { TIERS } from "../src/domain/constants.js";
import { InventoryService } from "../src/modules/inventory/inventoryService.js";
import { PkiService } from "../src/modules/pki/pkiService.js";

const actor = {
  id: "admin_global",
  email: "admin@sylion.local",
  role: "Global Super Admin",
  sessionId: "session_contract"
};

function provisionOperator(services, displayName) {
  const tenant = services.tenants.create({
    actor,
    name: `${displayName} Tenant`,
    tier: TIERS.STANDARD,
    correlationId: `corr_${displayName}_tenant`
  });
  return services.operators.create({
    actor,
    tenantId: tenant.id,
    displayName,
    tier: TIERS.STANDARD,
    correlationId: `corr_${displayName}_operator`
  });
}

function vpsSet(prefix) {
  return [
    { role: "G1", providerResourceId: `${prefix}-g1` },
    { role: "G2", providerResourceId: `${prefix}-g2` },
    { role: "WORKLOAD", providerResourceId: `${prefix}-workload` }
  ];
}

test("M09 tracks exactly three isolated VPS per operator and rejects shared infrastructure", () => {
  const app = createApp();
  const inventory = new InventoryService({
    audit: app.services.audit,
    rbac: app.services.rbac,
    operators: app.services.operators
  });
  const operatorA = provisionOperator(app.services, "Operator Alpha");
  const operatorB = provisionOperator(app.services, "Operator Beta");

  const alphaSet = inventory.registerVpsSet({
    actor,
    operatorId: operatorA.id,
    infrastructureSetId: "infra_set_alpha",
    provider: "provider-a",
    region: "eu-central-1",
    imageRef: "image/workload/2026.05.20",
    certRefs: {
      G1: "certref/g1/alpha",
      G2: "certref/g2/alpha",
      WORKLOAD: "certref/workload/alpha"
    },
    vps: vpsSet("alpha"),
    lifecycleState: "active",
    correlationId: "corr_inventory_alpha"
  });

  assert.equal(alphaSet.operatorId, operatorA.id);
  assert.equal(alphaSet.lifecycleState, "active");
  assert.equal(alphaSet.isolatedPerOperator, true);
  assert.deepEqual(alphaSet.vps.map((item) => item.role), ["G1", "G2", "WORKLOAD"]);
  assert.ok(alphaSet.vps.every((item) => item.shared === false));
  assert.ok(alphaSet.vps.every((item) => item.provider === "provider-a"));
  assert.ok(alphaSet.vps.every((item) => item.region === "eu-central-1"));
  assert.ok(alphaSet.vps.every((item) => item.imageRef === "image/workload/2026.05.20"));
  assert.deepEqual(alphaSet.vps.map((item) => item.certRef), [
    "certref/g1/alpha",
    "certref/g2/alpha",
    "certref/workload/alpha"
  ]);

  assert.throws(
    () =>
      inventory.registerVpsSet({
        actor,
        operatorId: operatorB.id,
        infrastructureSetId: "infra_set_alpha",
        provider: "provider-a",
        region: "eu-central-1",
        imageRef: "image/workload/2026.05.20",
        vps: vpsSet("beta"),
        correlationId: "corr_inventory_shared_set"
      }),
    /Infrastructure set is already assigned to another operator/
  );

  assert.throws(
    () =>
      inventory.registerVpsSet({
        actor,
        operatorId: operatorB.id,
        infrastructureSetId: "infra_set_beta",
        provider: "provider-b",
        region: "eu-west-1",
        imageRef: "image/workload/2026.05.20",
        vps: [
          { role: "G1", providerResourceId: "alpha-g1" },
          { role: "G2", providerResourceId: "beta-g2" },
          { role: "WORKLOAD", providerResourceId: "beta-workload" }
        ],
        correlationId: "corr_inventory_shared_vps"
      }),
    /VPS provider resource is already assigned to another operator/
  );

  const betaSet = inventory.registerVpsSet({
    actor,
    operatorId: operatorB.id,
    infrastructureSetId: "infra_set_beta",
    provider: "provider-b",
    region: "eu-west-1",
    imageRef: "image/workload/2026.05.20",
    vps: vpsSet("beta"),
    correlationId: "corr_inventory_beta"
  });

  assert.equal(betaSet.vps.length, 3);
  assert.equal(inventory.listForOperator({ actor, operatorId: operatorA.id, correlationId: "corr_list_alpha" }).length, 1);
  assert.equal(inventory.listForOperator({ actor, operatorId: operatorB.id, correlationId: "corr_list_beta" }).length, 1);
});

test("M14 issues, rotates, and revokes certificate references without private keys and emits audit", () => {
  const app = createApp();
  const inventory = new InventoryService({
    audit: app.services.audit,
    rbac: app.services.rbac,
    operators: app.services.operators
  });
  const pki = new PkiService({
    audit: app.services.audit,
    rbac: app.services.rbac,
    operators: app.services.operators,
    inventory
  });
  const operator = provisionOperator(app.services, "Operator Cert");
  const infra = inventory.registerVpsSet({
    actor,
    operatorId: operator.id,
    infrastructureSetId: "infra_set_cert",
    provider: "provider-a",
    region: "eu-central-1",
    imageRef: "image/g1/2026.05.20",
    vps: vpsSet("cert"),
    correlationId: "corr_inventory_cert"
  });

  const issued = pki.issue({
    actor,
    operatorId: operator.id,
    subjectType: "G1",
    subjectRef: infra.vps[0].id,
    serial: "serial-001",
    certificateRef: "hsm-certref://operator-cert/g1/serial-001",
    caRef: "hsm-ca://sylion/intermediate-01",
    infrastructureSetId: infra.id,
    vpsRole: "G1",
    notBefore: "2026-05-20T00:00:00.000Z",
    notAfter: "2026-08-20T00:00:00.000Z",
    correlationId: "corr_cert_issue"
  });

  assert.equal(issued.status, "issued");
  assert.equal(issued.privateKeyStored, false);
  assert.equal(issued.keyCustody, "external_hsm_or_secret_manager_reference");
  assert.equal(inventory.get(infra.id).certRefs.G1, "hsm-certref://operator-cert/g1/serial-001");

  assert.throws(
    () =>
      pki.issue({
        actor,
        operatorId: operator.id,
        subjectType: "G2",
        subjectRef: infra.vps[1].id,
        serial: "serial-private",
        certificateRef: "hsm-certref://operator-cert/g2/serial-private",
        caRef: "hsm-ca://sylion/intermediate-01",
        privateKeyPem: "-----BEGIN PRIVATE KEY-----",
        correlationId: "corr_cert_private_key"
      }),
    /private keys are out of scope/
  );

  const rotation = pki.rotate({
    actor,
    certificateId: issued.id,
    serial: "serial-002",
    certificateRef: "hsm-certref://operator-cert/g1/serial-002",
    caRef: "hsm-ca://sylion/intermediate-01",
    correlationId: "corr_cert_rotate"
  });

  assert.equal(rotation.rotated.status, "rotated");
  assert.equal(rotation.replacement.status, "issued");
  assert.equal(rotation.replacement.previousCertificateId, issued.id);

  const revoked = pki.revoke({
    actor,
    certificateId: rotation.replacement.id,
    reason: "operator rotation complete",
    correlationId: "corr_cert_revoke"
  });

  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revocationReason, "operator rotation complete");

  const events = app.services.audit.list();
  assert.ok(events.some((event) => event.action === "pki.certificate.issued" && event.resourceId === issued.id));
  assert.ok(events.some((event) => event.action === "pki.certificate.rotated" && event.resourceId === issued.id));
  assert.ok(events.some((event) => event.action === "pki.certificate.revoked" && event.resourceId === rotation.replacement.id));
});
