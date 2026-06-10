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
    correlationIdFactory: () => `corr_step3_12_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-12-${crypto.randomUUID()}`;
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

async function createApprovedBaseline(client) {
  const tenant = await client.createTenant({ name: "Live Gate Tenant", tier: "PRO" });
  const operator = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Live Gate Operator",
    tier: "PRO"
  });
  const provider = await client.createProvider({
    providerType: "hetzner",
    apiSecret: "test-secret-never-leak-step3-12",
    regions: ["fsn1"],
    billingHealth: { status: "healthy" },
    testConnection: { mode: "mock", status: "passed" }
  });
  const approval = await client.createProvisioningApproval({
    operatorId: operator.operator.id,
    reasonCode: "live_cloud_smoke_review",
    evidenceRefs: ["release://step3-12/live-gate"]
  });
  const approved = await client.updateProvisioningApprovalStatus(approval.approval.id, {
    status: "approved_for_execution",
    evidenceRefs: ["release://step3-12/live-gate"],
    note: "Approved for gated live smoke test"
  });
  return {
    tenant: tenant.tenant,
    operator: operator.operator,
    provider: provider.provider,
    approval: approved.approval
  };
}

async function assertRejectsWithStatus(operation, status, pattern) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.status, status);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test("Step 3.12 live cloud request defaults to blocked without env unlock and never leaks provider token", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const { operator, provider, approval } = await createApprovedBaseline(client);

    const blocked = await client.requestHetznerLiveVpsSet({
      providerId: provider.id,
      operatorId: operator.id,
      approvalId: approval.id,
      region: "fsn1",
      idempotencyKey: "step3-12-blocked-live",
      liveConfirmed: true
    });

    assert.equal(blocked.request.status, "blocked_human_gate");
    assert.equal(blocked.request.executionAllowed, false);
    assert.equal(blocked.request.sideEffectAllowed, false);
    assert.ok(blocked.request.gate.blockers.includes("provider_mode_not_live"));
    assert.equal(JSON.stringify(blocked).includes("test-secret-never-leak-step3-12"), false);

    const auditJson = JSON.stringify(app.services.audit.list());
    assert.equal(auditJson.includes("test-secret-never-leak-step3-12"), false);
    assert.ok(
      app.services.audit.list().some((event) => event.action === "live_cloud.vps_set_blocked")
    );
  } finally {
    await close();
  }
});

test("Step 3.12 live cloud gate calls Hetzner adapter only after approval, env allowlist and explicit confirmation", async () => {
  const calls = [];
  const env = {
    SYLION_PROVIDER_MODE: "live",
    SYLION_LIVE_ALLOWED: "true",
    HETZNER_API_TOKEN: "test-token-only-in-env",
    SYLION_LIVE_ALLOWLIST_OPERATORS: "*",
    SYLION_LIVE_ALLOWED_REGIONS: "fsn1",
    SYLION_LIVE_MAX_SERVERS: "3"
  };
  const { app, baseUrl, close } = await startTestServer({
    env,
    adapterFactory: () => ({
      async createVpsSet(input) {
        calls.push(input);
        return [
          { role: "G1", providerResourceId: "hcloud-g1" },
          { role: "G2", providerResourceId: "hcloud-g2" },
          { role: "WORKLOAD", providerResourceId: "hcloud-workload" }
        ];
      }
    })
  });
  try {
    const client = await loginClient(baseUrl);
    const { operator, provider, approval } = await createApprovedBaseline(client);

    await assertRejectsWithStatus(
      () =>
        client.requestHetznerLiveVpsSet({
          providerId: provider.id,
          operatorId: operator.id,
          approvalId: "missing-approval",
          region: "fsn1",
          idempotencyKey: "step3-12-missing-approval",
          liveConfirmed: true
        }),
      404,
      /provisioning_approval/
    );

    const executed = await client.requestHetznerLiveVpsSet({
      providerId: provider.id,
      operatorId: operator.id,
      approvalId: approval.id,
      region: "fsn1",
      idempotencyKey: "step3-12-executed-live",
      liveConfirmed: true
    });

    assert.equal(executed.request.status, "executed_provider_mutation");
    assert.equal(executed.request.resources.length, 3);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].operatorId, operator.id);
    assert.equal(calls[0].region, "fsn1");
    assert.equal(JSON.stringify(executed).includes("test-token-only-in-env"), false);
    assert.ok(
      app.services.audit.list().some((event) => event.action === "live_cloud.vps_set_created")
    );
  } finally {
    await close();
  }
});

test("Step 3.12 Firecracker and PHANTOM execution gates remain auditable and separate from baseline production", async () => {
  const env = {
    SYLION_FIRECRACKER_HOST_MODE: "local_qualification",
    SYLION_PHANTOM_LAB_ALLOWED: "true"
  };
  const { baseUrl, close } = await startTestServer({
    env,
    hostProbe: () => ({
      platform: "linux",
      kvmDevicePresent: true,
      firecrackerBinaryPresent: true,
      nestedVirtualizationVerified: true
    })
  });
  try {
    const client = await loginClient(baseUrl);
    const qualification = await client.qualifyFirecrackerHost({
      hostId: "bare-metal-fc-01",
      approvalId: "approval-host-review"
    });
    assert.equal(qualification.qualification.readyForFirecrackerLaunch, true);
    assert.equal(qualification.qualification.executionAllowed, false);

    const blockedPhantom = await client.createPhantomExecutionRequest({
      packageId: "pkg-phantom-step3-12",
      owners: ["legal", "ciso", "architect", "compliance"],
      evidenceRefs: [],
      expiresAt: "2026-06-30T00:00:00.000Z",
      labConfirmed: true
    });
    assert.equal(blockedPhantom.request.status, "blocked_human_gate");
    assert.equal(blockedPhantom.request.productionExecutionAllowed, false);
    assert.ok(blockedPhantom.request.blockers.includes("evidence_required"));

    const labReady = await client.createPhantomExecutionRequest({
      packageId: "pkg-phantom-step3-12",
      owners: ["legal", "ciso", "architect", "compliance"],
      evidenceRefs: ["artifact://phantom/legal-lab-review"],
      expiresAt: "2026-06-30T00:00:00.000Z",
      labConfirmed: true
    });
    assert.equal(labReady.request.status, "approved_for_lab_review");
    assert.equal(labReady.request.labExecutionAllowed, true);
    assert.equal(labReady.request.baselineUnlockAllowed, false);
    assert.equal(labReady.request.productionExecutionAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.12 CPU confidential gate requires TDX or SEV-SNP attestation before secrets release", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);

    const blockedTdx = await client.qualifyCpuConfidentialHost({
      hostId: "intel-tdx-host-01",
      cpuVendor: "intel",
      cpuModel: "Xeon TDX-capable",
      confidentialMode: "intel_tdx",
      tierTarget: "SOVEREIGN",
      featureFlags: {
        virtualization: true,
        iommu: true,
        tpm2: true,
        secureBoot: true,
        kernelLockdown: true,
        microcodeCurrent: true
      },
      attestation: {
        verified: false,
        measurementRef: null,
        verifier: "sylion-attestation-service"
      },
      evidenceRefs: ["artifact://cpu/tdx-host-review"]
    });
    assert.equal(blockedTdx.qualification.firecrackerHostApproved, true);
    assert.equal(blockedTdx.qualification.confidentialComputingApproved, false);
    assert.equal(blockedTdx.qualification.secretsReleaseAllowed, false);
    assert.ok(
      blockedTdx.qualification.checks.some(
        (check) => check.key === "remote_attestation" && check.status === "blocked"
      )
    );

    const readySnp = await client.qualifyCpuConfidentialHost({
      hostId: "amd-snp-host-01",
      cpuVendor: "amd",
      cpuModel: "EPYC SEV-SNP-capable",
      confidentialMode: "amd_sev_snp",
      tierTarget: "SOVEREIGN",
      featureFlags: {
        virtualization: true,
        iommu: true,
        tpm2: true,
        secureBoot: true,
        kernelLockdown: true,
        microcodeCurrent: true
      },
      attestation: {
        verified: true,
        measurementRef: "attestation://snp/measurement-001",
        verifier: "sylion-attestation-service"
      },
      evidenceRefs: ["artifact://cpu/snp-host-review"]
    });
    assert.equal(readySnp.qualification.confidentialComputingApproved, true);
    assert.equal(readySnp.qualification.secretsReleaseAllowed, true);
    assert.equal(readySnp.qualification.productionExecutionAllowed, false);
    assert.ok(
      app.services.audit.list().some((event) => event.action === "cpu_confidential.host_qualified")
    );
  } finally {
    await close();
  }
});
