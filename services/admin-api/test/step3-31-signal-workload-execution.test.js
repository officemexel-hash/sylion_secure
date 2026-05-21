import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startTestServer(env = {}) {
  const app = createApp({ liveExecutionOptions: { env } });
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function loginClient(baseUrl) {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_step3_31_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-31-${crypto.randomUUID()}`;
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

async function operatorRequest(baseUrl, token, path, method = "GET") {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": `corr_step3_31_operator_${crypto.randomUUID()}`,
      authorization: `Bearer ${token}`
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "operator request failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function seedReadyOperator(client) {
  const tenant = await client.createTenant({ name: "Step 3.31 Tenant", tier: "PRO" });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Step 3.31 Operator",
    tier: "PRO",
    requestedTemplates: ["signal"]
  });
  const environment = await client.createLocalOperatorEnvironment(created.provisioningDraft.id);
  await client.startLocalOperatorEnvironment(environment.environment.id);
  const pixel = await client.registerDevice({
    type: "pixel_grapheneos",
    serial: `pixel-step3-31-${crypto.randomUUID()}`,
    model: "Pixel GrapheneOS ADB unlocked lab",
    assignedOperatorId: created.operator.id,
    posture: { state: "adb_lab_ready", os: "GrapheneOS" }
  });
  return { operator: created.operator, pixel: pixel.device };
}

test("Step 3.31 exposes production-gated Signal workload substrate with real CDR and deferred physical keys", async () => {
  const env = {
    SYLION_REAL_IPSEC_READY: "true",
    SYLION_KVM_READY: "true",
    SYLION_FIRECRACKER_BIN: "/usr/local/bin/firecracker",
    SYLION_FIRECRACKER_KERNEL: "artifact://kernel/vmlinux-6.8-sylion",
    SYLION_SIGNAL_ROOTFS: "artifact://rootfs/signal-desktop.squashfs",
    SYLION_SIGNAL_WORKLOAD_IMAGE_REF: "image://sylion/signal-workload:prod-candidate",
    SYLION_SIGNAL_PACKAGE_REF: "package://signal-desktop/linux",
    SYLION_SIGNAL_ACCOUNT_REF: "operator-secret://signal/account/enrollment",
    SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true"
  };
  const { baseUrl, close } = await startTestServer(env);
  try {
    const client = await loginClient(baseUrl);
    const { operator, pixel } = await seedReadyOperator(client);
    const session = await client.request("/operator-api/sessions/local-simulator", {
      method: "POST",
      body: {
        operatorId: operator.id,
        terminalMode: "pixel_grapheneos",
        deviceId: pixel.id
      }
    });

    const result = await operatorRequest(baseUrl, session.session.token, "/operator-api/workload-execution/signal");
    assert.equal(result.execution.templateKey, "signal");
    assert.equal(result.execution.runtime.substrate.vpn.ready, true);
    assert.equal(result.execution.runtime.substrate.firecrackerKvm.ready, true);
    assert.equal(result.execution.runtime.substrate.cdr.ready, true);
    assert.equal(result.execution.runtime.substrate.cdr.enforcement, "real_control_plane");
    assert.equal(result.execution.runtime.substrate.hsmFido2.deferred, true);
    assert.equal(result.execution.runtime.terminalDataStored, false);
    assert.equal(result.execution.productionExecutionAllowed, false);
    assert.ok(result.execution.blockers.includes("dns_leak_and_kill_switch_tests_required"));
    assert.ok(result.execution.blockers.includes("human_production_execution_approval_required"));
    assert.equal(result.execution.blockers.includes("real_ipsec_profile_required"), false);
    assert.equal(result.execution.blockers.includes("kvm_device_not_verified"), false);
    assert.equal(result.execution.blockers.includes("hsm_backed_operator_certificate_required"), false);
    assert.equal(result.execution.blockers.includes("fresh_fido2_operator_unlock_required"), false);

    const start = await operatorRequest(baseUrl, session.session.token, "/operator-api/workload-execution/signal/start", "POST");
    assert.equal(start.request.state, "blocked");
    assert.equal(start.request.launchAllowed, false);
    assert.equal(start.request.execution.runtime.substrate.cdr.rule, "No file ingress/egress without CDR decision.");
  } finally {
    await close();
  }
});

test("Step 3.31 reports exact Signal blockers when VPN or KVM substrate is missing", async () => {
  const { baseUrl, close } = await startTestServer({});
  try {
    const client = await loginClient(baseUrl);
    const { operator, pixel } = await seedReadyOperator(client);
    const session = await client.request("/operator-api/sessions/local-simulator", {
      method: "POST",
      body: {
        operatorId: operator.id,
        terminalMode: "pixel_grapheneos",
        deviceId: pixel.id
      }
    });

    const result = await operatorRequest(baseUrl, session.session.token, "/operator-api/workload-execution/signal");
    assert.equal(result.execution.runtime.substrate.vpn.ready, false);
    assert.equal(result.execution.runtime.substrate.firecrackerKvm.ready, false);
    assert.equal(result.execution.runtime.substrate.cdr.ready, true);
    assert.ok(result.execution.blockers.includes("real_ipsec_profile_required"));
    assert.ok(result.execution.blockers.includes("kvm_device_not_verified"));
    assert.ok(result.execution.blockers.includes("real_firecracker_binary_not_configured"));
    assert.ok(result.execution.blockers.includes("hsm_backed_operator_certificate_required"));
  } finally {
    await close();
  }
});
