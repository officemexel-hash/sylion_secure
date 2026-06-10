import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { DEVICE_STATUSES, DEVICE_TYPES, TIERS } from "../src/domain/constants.js";
import { DeviceInventoryService } from "../src/modules/devices/deviceInventoryService.js";
import { InventoryService } from "../src/modules/inventory/inventoryService.js";

const actor = {
  id: "admin_global",
  email: "admin@sylion.local",
  role: "Global Super Admin",
  sessionId: "session_perf_indexes"
};

function provisionOperator(services, displayName) {
  const tenant = services.tenants.create({
    actor,
    name: `${displayName} Tenant`,
    tier: TIERS.STANDARD,
    correlationId: `corr_${displayName.replaceAll(" ", "_")}_tenant`
  });
  return services.operators.create({
    actor,
    tenantId: tenant.id,
    displayName,
    tier: TIERS.STANDARD,
    correlationId: `corr_${displayName.replaceAll(" ", "_")}_operator`
  });
}

// Reference implementation: the pre-index full collection scan. The indexed
// lookup must stay deepEqual (content AND order) to this at every checkpoint.
function fullScanDevices(service, operatorId) {
  return [...service.devices.values()].filter((device) => device.assignedOperatorId === operatorId);
}

function fullScanVpsSets(service, operatorId) {
  return [...service.vpsSets.values()].filter((set) => set.operatorId === operatorId);
}

function createMemoryStore() {
  const collections = new Map();
  return {
    listEntries(collection) {
      const entries = collections.get(collection) || new Map();
      return [...entries.entries()].map(([key, value]) => ({ key, value }));
    },
    save(collection, key, value) {
      if (!collections.has(collection)) {
        collections.set(collection, new Map());
      }
      collections.get(collection).set(key, value);
    },
    delete(collection, key) {
      const entries = collections.get(collection);
      if (entries) {
        entries.delete(key);
      }
    }
  };
}

function vpsSet(prefix) {
  return [
    { role: "G1", providerResourceId: `${prefix}-g1` },
    { role: "G2", providerResourceId: `${prefix}-g2` },
    { role: "WORKLOAD", providerResourceId: `${prefix}-workload` }
  ];
}

test("device operator index matches full scan across register/assign/posture/certificate", () => {
  const app = createApp();
  const store = createMemoryStore();
  const devices = new DeviceInventoryService({
    audit: app.services.audit,
    rbac: app.services.rbac,
    operators: app.services.operators,
    store
  });
  const operatorA = provisionOperator(app.services, "Operator IndexA");
  const operatorB = provisionOperator(app.services, "Operator IndexB");

  const verify = (service) => {
    for (const operatorId of [operatorA.id, operatorB.id, null, "op_unknown"]) {
      assert.deepEqual(
        service.listForOperatorScoped(operatorId),
        fullScanDevices(service, operatorId)
      );
    }
  };

  const d1 = devices.register({
    actor,
    type: DEVICE_TYPES.ROUTER,
    serial: "serial-idx-1",
    model: "Puli AX",
    assignedOperatorId: operatorA.id,
    correlationId: "corr_idx_d1"
  });
  const d2 = devices.register({
    actor,
    type: DEVICE_TYPES.PIXEL,
    serial: "serial-idx-2",
    model: "Pixel 8 Pro",
    assignedOperatorId: operatorB.id,
    correlationId: "corr_idx_d2"
  });
  const d3 = devices.register({
    actor,
    type: DEVICE_TYPES.ROUTER,
    serial: "serial-idx-3",
    model: "Puli AX",
    correlationId: "corr_idx_d3"
  });
  const d4 = devices.register({
    actor,
    type: DEVICE_TYPES.FIDO2,
    serial: "serial-idx-4",
    model: "FIDO2 Key",
    assignedOperatorId: operatorA.id,
    correlationId: "corr_idx_d4"
  });
  verify(devices);
  assert.deepEqual(
    devices.listForOperatorScoped(operatorA.id).map((device) => device.id),
    [d1.id, d4.id]
  );

  // null -> operatorA: index must drop the device from the unassigned bucket
  // and insert it into operatorA preserving registration order (d1, d3, d4).
  devices.assign({
    actor,
    deviceId: d3.id,
    operatorId: operatorA.id,
    correlationId: "corr_idx_a1"
  });
  verify(devices);
  assert.deepEqual(
    devices.listForOperatorScoped(operatorA.id).map((device) => device.id),
    [d1.id, d3.id, d4.id]
  );

  // operatorB -> operatorA: old operator bucket must be emptied too.
  devices.assign({
    actor,
    deviceId: d2.id,
    operatorId: operatorA.id,
    correlationId: "corr_idx_a2"
  });
  verify(devices);
  assert.deepEqual(devices.listForOperatorScoped(operatorB.id), []);
  assert.deepEqual(
    devices.listForOperatorScoped(operatorA.id).map((device) => device.id),
    [d1.id, d2.id, d3.id, d4.id]
  );

  // Mutations that keep operatorId must not disturb the index.
  devices.updatePosture({
    actor,
    deviceId: d1.id,
    posture: { state: "healthy" },
    status: DEVICE_STATUSES.ACTIVE,
    correlationId: "corr_idx_p1"
  });
  devices.attachCertificate({
    actor,
    deviceId: d4.id,
    certificateRef: "hsm-certref://index/fido2",
    correlationId: "corr_idx_c1"
  });
  verify(devices);
  assert.equal(devices.listForOperatorScoped(operatorA.id).at(-1).id, d4.id);

  // Constructor rebuild from a persisted store must produce the same index.
  const rehydrated = new DeviceInventoryService({
    audit: app.services.audit,
    rbac: app.services.rbac,
    operators: app.services.operators,
    store
  });
  verify(rehydrated);
  assert.deepEqual(
    rehydrated.listForOperatorScoped(operatorA.id),
    devices.listForOperatorScoped(operatorA.id)
  );

  // Mutating the rehydrated instance keeps its rebuilt index consistent.
  rehydrated.assign({
    actor,
    deviceId: d4.id,
    operatorId: operatorB.id,
    correlationId: "corr_idx_a3"
  });
  verify(rehydrated);
  assert.deepEqual(
    rehydrated.listForOperatorScoped(operatorB.id).map((device) => device.id),
    [d4.id]
  );
});

test("inventory operator index matches full scan across register/re-register/lifecycle/cert", () => {
  const app = createApp();
  const inventory = new InventoryService({
    audit: app.services.audit,
    rbac: app.services.rbac,
    operators: app.services.operators
  });
  const operatorA = provisionOperator(app.services, "Operator InvA");
  const operatorB = provisionOperator(app.services, "Operator InvB");
  const operatorC = provisionOperator(app.services, "Operator InvC");

  const verify = () => {
    for (const operator of [operatorA, operatorB, operatorC]) {
      assert.deepEqual(
        inventory.listForOperator({
          actor,
          operatorId: operator.id,
          correlationId: `corr_inv_list_${operator.id}`
        }),
        fullScanVpsSets(inventory, operator.id)
      );
    }
  };

  inventory.registerVpsSet({
    actor,
    operatorId: operatorA.id,
    infrastructureSetId: "infra_idx_a1",
    provider: "provider-a",
    region: "eu-central-1",
    imageRef: "image/workload/2026.06.01",
    vps: vpsSet("idx-a1"),
    correlationId: "corr_inv_a1"
  });
  inventory.registerVpsSet({
    actor,
    operatorId: operatorB.id,
    infrastructureSetId: "infra_idx_b1",
    provider: "provider-b",
    region: "eu-west-1",
    imageRef: "image/workload/2026.06.01",
    vps: vpsSet("idx-b1"),
    correlationId: "corr_inv_b1"
  });
  inventory.registerVpsSet({
    actor,
    operatorId: operatorA.id,
    infrastructureSetId: "infra_idx_a2",
    provider: "provider-a",
    region: "eu-central-1",
    imageRef: "image/workload/2026.06.01",
    vps: vpsSet("idx-a2"),
    correlationId: "corr_inv_a2"
  });
  verify();
  assert.deepEqual(
    inventory
      .listForOperator({ actor, operatorId: operatorA.id, correlationId: "corr_inv_order" })
      .map((set) => set.id),
    ["infra_idx_a1", "infra_idx_a2"]
  );
  assert.deepEqual(
    inventory.listForOperator({
      actor,
      operatorId: operatorC.id,
      correlationId: "corr_inv_empty"
    }),
    []
  );
  assert.throws(
    () =>
      inventory.listForOperator({
        actor,
        operatorId: "op_missing",
        correlationId: "corr_inv_missing"
      }),
    /operator not found/
  );

  // Re-registering the same set for the same operator must not duplicate it.
  inventory.registerVpsSet({
    actor,
    operatorId: operatorA.id,
    infrastructureSetId: "infra_idx_a1",
    provider: "provider-a",
    region: "eu-north-1",
    imageRef: "image/workload/2026.06.02",
    vps: vpsSet("idx-a1"),
    correlationId: "corr_inv_a1_again"
  });
  verify();
  const alphaSets = inventory.listForOperator({
    actor,
    operatorId: operatorA.id,
    correlationId: "corr_inv_after_rereg"
  });
  assert.equal(alphaSets.length, 2);
  assert.equal(alphaSets.find((set) => set.id === "infra_idx_a1").region, "eu-north-1");

  // Cross-operator takeover is still rejected and leaves indexes untouched.
  assert.throws(
    () =>
      inventory.registerVpsSet({
        actor,
        operatorId: operatorB.id,
        infrastructureSetId: "infra_idx_a1",
        provider: "provider-b",
        region: "eu-west-1",
        imageRef: "image/workload/2026.06.02",
        vps: vpsSet("idx-takeover"),
        correlationId: "corr_inv_takeover"
      }),
    /Infrastructure set is already assigned to another operator/
  );
  verify();

  inventory.transitionLifecycle({
    actor,
    infrastructureSetId: "infra_idx_b1",
    lifecycleState: "active",
    correlationId: "corr_inv_lifecycle"
  });
  inventory.attachCertificateReference({
    actor,
    infrastructureSetId: "infra_idx_a2",
    role: "G1",
    certRef: "hsm-certref://index/g1",
    correlationId: "corr_inv_cert"
  });
  verify();
  assert.equal(
    inventory
      .listForOperator({ actor, operatorId: operatorB.id, correlationId: "corr_inv_final" })
      .at(-1).lifecycleState,
    "active"
  );
});
