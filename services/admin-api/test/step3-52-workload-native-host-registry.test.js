import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startTestServer() {
  const app = createApp();
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
    correlationIdFactory: () => `corr_step3_52_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-52-${crypto.randomUUID()}`;
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

const labEvidence = Object.freeze({
  bootstrap: {
    kvmDevice: "present",
    virtualizationFlags: 32,
    firecrackerBinary: "/opt/sylion/bin/firecracker",
    jailerBinary: "/opt/sylion/bin/jailer"
  },
  firecrackerInstall: {
    firecrackerVersion: "Firecracker v1.15.1",
    jailerVersion: "Jailer v1.15.1"
  },
  firecrackerSmoke: {
    microvmStarted: true,
    state: "Running"
  },
  hardware: {
    kvmDevice: "present",
    amdVirtualizationFlags: 32,
    apparmor: "active",
    auditd: "active"
  },
  containerRuntime: {
    dockerActive: "active",
    containerdActive: "active"
  }
});

test("Step 3.52 registers a delivered WORKLOAD_NATIVE lab host with no production claim", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);

    const result = await client.registerWorkloadNativeHost({
      hostId: "WORKLOAD_NATIVE_LAB_01",
      serverNumber: "2983993",
      productId: "AX102-U",
      region: "hel1",
      publicIpv4: "65.109.123.72",
      publicIpv6: "2a01:4f9:3051:1729::2",
      orderId: "dedicated_order_example",
      providerResourceId: "B20260522-3442319-3016298",
      lifecycleState: "lab_qualified",
      tenancyMode: "shared_pool",
      evidence: labEvidence,
      productionBlockers: [
        "tenant_isolation_not_validated",
        "g1_g2_private_path_not_bound",
        "thin_stream_broker_not_bound"
      ]
    });

    assert.equal(result.host.hostId, "WORKLOAD_NATIVE_LAB_01");
    assert.equal(result.host.readyForLabWorkloads, true);
    assert.equal(result.host.readyForProduction, false);
    assert.equal(result.host.productionExecutionAllowed, false);
    assert.ok(result.host.checks.every((check) => check.requiredForLab === false || check.status === "passed"));

    const listed = await client.listWorkloadNativeHosts();
    assert.equal(listed.hosts.length, 1);
    assert.equal(listed.hosts[0].serverNumber, "2983993");
  } finally {
    await close();
  }
});

test("Step 3.52 blocks sensitive material in workload-native host evidence", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);

    await assert.rejects(
      () => client.registerWorkloadNativeHost({
        hostId: "WORKLOAD_NATIVE_LAB_02",
        serverNumber: "2983994",
        productId: "AX102-U",
        region: "hel1",
        lifecycleState: "lab_qualified",
        tenancyMode: "shared_pool",
        evidence: {
          ...labEvidence,
          accidentalSecret: "api_key_should_never_be_here"
        },
        productionBlockers: ["tenant_isolation_not_validated"]
      }),
      /sensitive runtime data/
    );
  } finally {
    await close();
  }
});
