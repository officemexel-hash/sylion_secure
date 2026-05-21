import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startTestServer(liveExecutionOptions = {}) {
  const app = createApp({ liveExecutionOptions });
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
    correlationIdFactory: () => `corr_step3_20_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-20-${crypto.randomUUID()}`;
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
  return { client: anon.withToken(session.token), credentialId };
}

async function stepUp(client, credentialId, signCounter = 2) {
  const options = await client.createStepUpOptions();
  await client.verifyStepUp({
    challengeId: options.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${options.challenge.id}:${credentialId}`,
      signCounter
    }
  });
}

async function createOperator(client, suffix = "rehearsal") {
  const tenant = await client.createTenant({ name: `Step 3.20 Tenant ${suffix}`, tier: "PRO" });
  const operator = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.20 Operator ${suffix}`,
    tier: "PRO"
  });
  return operator.operator;
}

test("Step 3.20 runs Firecracker launch rehearsal without real kernel execution or secrets release", async () => {
  const { app, baseUrl, close } = await startTestServer({
    env: {
      SYLION_FIRECRACKER_HOST_MODE: "local_qualification",
      SYLION_FIRECRACKER_LAUNCH_REHEARSAL_ALLOWED: "true"
    },
    hostProbe: () => ({
      platform: "linux",
      kvmDevicePresent: true,
      firecrackerBinaryPresent: true,
      nestedVirtualizationVerified: true
    })
  });
  try {
    const { client, credentialId } = await loginClient(baseUrl);
    const operator = await createOperator(client);
    await stepUp(client, credentialId);
    const qualification = await client.qualifyFirecrackerHost({ hostId: "local-fc-01" });
    assert.equal(qualification.qualification.readyForFirecrackerLaunch, true);

    await stepUp(client, credentialId, 3);
    const rehearsal = await client.runFirecrackerLaunchRehearsal({
      hostQualificationId: qualification.qualification.id,
      operatorId: operator.id,
      workloadNames: ["signal", "telegram", "matrix"],
      rehearsalConfirmed: true
    });
    assert.equal(rehearsal.rehearsal.status, "rehearsal_passed");
    assert.equal(rehearsal.rehearsal.realKernelExecuted, false);
    assert.equal(rehearsal.rehearsal.secretsReleaseAllowed, false);
    assert.equal(rehearsal.rehearsal.productionExecutionAllowed, false);
    assert.equal(rehearsal.rehearsal.terminalDataStored, false);
    assert.deepEqual(rehearsal.rehearsal.runtimes.map((runtime) => runtime.workloadName), ["signal", "telegram", "matrix"]);
    assert.ok(rehearsal.rehearsal.phases.some((phase) => phase.name === "stop_cleanup" && phase.status === "passed"));
    assert.ok(app.services.audit.list().some((event) => event.action === "firecracker.launch_rehearsal_completed"));
  } finally {
    app.close();
    await close();
  }
});

test("Step 3.20 blocks Firecracker launch rehearsal when host or env gate is not ready", async () => {
  const { app, baseUrl, close } = await startTestServer({
    env: { SYLION_FIRECRACKER_HOST_MODE: "blocked" },
    hostProbe: () => ({
      platform: "win32",
      kvmDevicePresent: false,
      firecrackerBinaryPresent: false,
      nestedVirtualizationVerified: false
    })
  });
  try {
    const { client, credentialId } = await loginClient(baseUrl);
    const operator = await createOperator(client, "blocked");
    await stepUp(client, credentialId);
    const qualification = await client.qualifyFirecrackerHost({ hostId: "blocked-host" });
    assert.equal(qualification.qualification.readyForFirecrackerLaunch, false);

    await stepUp(client, credentialId, 3);
    const rehearsal = await client.runFirecrackerLaunchRehearsal({
      hostQualificationId: qualification.qualification.id,
      operatorId: operator.id,
      workloadNames: ["signal"],
      rehearsalConfirmed: true
    });
    assert.equal(rehearsal.rehearsal.status, "blocked_human_gate");
    assert.ok(rehearsal.rehearsal.blockers.includes("host_not_ready_for_firecracker_launch"));
    assert.ok(rehearsal.rehearsal.blockers.includes("firecracker_launch_rehearsal_env_flag_disabled"));
    assert.equal(rehearsal.rehearsal.realKernelExecuted, false);
    assert.equal(rehearsal.rehearsal.secretsReleaseAllowed, false);
  } finally {
    app.close();
    await close();
  }
});

test("Step 3.20 rejects Firecracker rehearsal metadata containing secrets or communication content", async () => {
  const { app, baseUrl, close } = await startTestServer({
    env: {
      SYLION_FIRECRACKER_HOST_MODE: "local_qualification",
      SYLION_FIRECRACKER_LAUNCH_REHEARSAL_ALLOWED: "true"
    },
    hostProbe: () => ({
      platform: "linux",
      kvmDevicePresent: true,
      firecrackerBinaryPresent: true,
      nestedVirtualizationVerified: true
    })
  });
  try {
    const { client, credentialId } = await loginClient(baseUrl);
    const operator = await createOperator(client, "secret-reject");
    await stepUp(client, credentialId);
    const qualification = await client.qualifyFirecrackerHost({ hostId: "local-fc-02" });

    await stepUp(client, credentialId, 3);
    await assert.rejects(
      () => client.runFirecrackerLaunchRehearsal({
        hostQualificationId: qualification.qualification.id,
        operatorId: operator.id,
        workloadNames: ["signal"],
        imageRef: "image://contains-secret-token",
        rehearsalConfirmed: true
      }),
      /must not contain secrets/
    );
    assert.equal(JSON.stringify(app.services.audit.list()).includes("contains-secret-token"), false);
  } finally {
    app.close();
    await close();
  }
});
