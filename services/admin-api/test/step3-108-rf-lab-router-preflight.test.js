import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";
import {
  assertRfLabPreflightSafe,
  buildReadOnlyRfLabPreflightScript,
  parseKeyValueLines,
  summarizeRfLabRouterPreflight
} from "../../../scripts/lib/rf-lab-router-preflight.js";

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

async function loginClient(baseUrl) {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_step3_108_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-108-${crypto.randomUUID()}`;
  const enrollment = await anon.createEnrollmentOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  await anon.verifyEnrollment({
    challengeId: enrollment.challenge.id,
    credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
  });
  const loginOptions = await anon.createWebAuthnLoginOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  const session = await anon.verifyWebAuthnLogin({
    challengeId: loginOptions.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${loginOptions.challenge.id}:${credentialId}`,
      signCounter: 1
    }
  });
  return anon.withToken(session.token);
}

async function createOperatorAndRouter(client) {
  const tenant = await client.createTenant({ name: "Step 3.108 RF Lab Tenant", tier: "SOVEREIGN" });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Step 3.108 RF Lab Operator",
    tier: "SOVEREIGN"
  });
  const router = await client.registerDevice({
    type: "puli_ax_router",
    serial: `puli-step3-108-${crypto.randomUUID()}`,
    model: "GL.iNet GL-XE3000 Puli AX",
    assignedOperatorId: created.operator.id,
    posture: { state: "rf_lab_inventory_ready" }
  });
  return { operatorId: created.operator.id, router: router.device };
}

function labRequestBody({ operatorId, routerDeviceId }) {
  return {
    operatorId,
    routerDeviceId,
    labName: "Shielded RF validation lab",
    jurisdiction: "PL",
    purpose:
      "Closed Faraday cage router software readiness characterization with no public-network exposure.",
    faradayCageEvidenceRef: "evidence://rf-lab/faraday-cage-calibration-2026-06",
    rfLeakageTestRef: "evidence://rf-lab/leakage-test-pass-2026-06",
    legalOpinionRef: "legal://rf-lab/pl-closed-cage-review-2026-06",
    responsibleEngineer: "rf-lab-engineer",
    evidenceRefs: ["evidence://rf-lab/intake"]
  };
}

function readyPreflight() {
  return summarizeRfLabRouterPreflight(
    parseKeyValueLines(`
hostname=puli-ax-lab
kernel=5.15.167
arch=aarch64
opkg_present=true
python3_present=true
pip3_present=false
pcscd_present=true
pcsc_scan_present=true
opensc_tool_present=true
lsusb_present=true
pysim_shell_present=true
package_python3=true
package_pcscd=true
package_libpcsclite=true
package_ccid=true
package_opensc=true
package_opensc_util=false
usb_bus_present=true
usb_device_count=3
smartcard_reader_hint=true
rf_lab_preflight_read_only=true
raw_cellular_identifiers_read=false
sim_secret_material_read=false
mutation_commands_executed=false
product_runtime_executor_available=false
`),
    {
      routerIp: "192.168.8.1",
      startedAt: "2026-06-01T10:00:00.000Z",
      completedAt: "2026-06-01T10:00:01.000Z"
    }
  );
}

test("Step 3.108 summarizes router RF lab software readiness from read-only metadata", () => {
  const summary = assertRfLabPreflightSafe(readyPreflight());
  assert.equal(summary.component, "puli_ax_rf_lab_router_preflight");
  assert.equal(summary.status, "preflight_ready_for_human_gate");
  assert.equal(summary.facts.capabilities.python3Present, true);
  assert.equal(summary.facts.capabilities.pysimShellPresent, true);
  assert.equal(summary.facts.capabilities.smartcardReaderHint, true);
  assert.equal(summary.controls.rawCellularIdentifiersRead, false);
  assert.equal(summary.controls.simSecretMaterialRead, false);
  assert.equal(summary.controls.mutationCommandsExecuted, false);
  assert.equal(summary.controls.productRuntimeExecutorAvailable, false);
});

test("Step 3.108 read-only router preflight script does not include mutation or SIM-read operations", () => {
  const script = buildReadOnlyRfLabPreflightScript();
  assert.match(script, /command -v pySim-shell\.py/);
  assert.doesNotMatch(script, /pySim-read|pySim-prog|AT\+|EGMR|QCDM|QFirehose|EDL|diag/i);
  assert.doesNotMatch(script, /write|program/i);
});

test("Step 3.108 attaches sanitized router preflight metadata to an RF lab test", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operatorId, router } = await createOperatorAndRouter(client);
    const created = await client.request("/rf-lab/imei-change-tests", {
      method: "POST",
      body: labRequestBody({ operatorId, routerDeviceId: router.id })
    });
    const recorded = await client.request(
      `/rf-lab/imei-change-tests/${created.test.id}/router-preflight`,
      {
        method: "POST",
        body: {
          preflight: readyPreflight(),
          evidenceRefs: ["evidence://rf-lab/router-preflight-puli-ax-2026-06"]
        }
      }
    );
    const preflight = recorded.test.routerSoftwarePreflights.at(-1);
    assert.equal(preflight.status, "preflight_ready_for_human_gate");
    assert.equal(preflight.routerIpRef, "redacted-router-ip-ref");
    assert.equal(preflight.rawIdentifiersRedacted, true);
    assert.equal(preflight.simSecretMaterialRedacted, true);
    assert.equal(preflight.productionExecutionAllowed, false);
    assert.equal(preflight.productRuntimeExecutorAvailable, false);
  } finally {
    await close();
  }
});

test("Step 3.108 rejects unsafe router preflight evidence", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operatorId, router } = await createOperatorAndRouter(client);
    const created = await client.request("/rf-lab/imei-change-tests", {
      method: "POST",
      body: labRequestBody({ operatorId, routerDeviceId: router.id })
    });
    await assert.rejects(
      () =>
        client.request(`/rf-lab/imei-change-tests/${created.test.id}/router-preflight`, {
          method: "POST",
          body: {
            preflight: {
              ...readyPreflight(),
              controls: {
                ...readyPreflight().controls,
                mutationCommandsExecuted: true
              }
            }
          }
        }),
      (error) => error.status === 422
    );
    await assert.rejects(
      () =>
        client.request(`/rf-lab/imei-change-tests/${created.test.id}/router-preflight`, {
          method: "POST",
          body: {
            preflight: {
              ...readyPreflight(),
              facts: {
                ...readyPreflight().facts,
                hostname: "router-123456789012345"
              }
            }
          }
        }),
      (error) => error.status === 422
    );
  } finally {
    await close();
  }
});
