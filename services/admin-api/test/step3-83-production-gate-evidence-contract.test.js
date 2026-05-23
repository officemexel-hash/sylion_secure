import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startTestServer(env = {}) {
  const app = createApp({ liveExecutionOptions: { env } });
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
    correlationIdFactory: () => `corr_step3_83_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-83-${crypto.randomUUID()}`;
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

async function seedOperator(client, tier = "PRO") {
  const tenant = await client.createTenant({ name: `Step 3.83 ${tier} Tenant`, tier });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.83 ${tier} Operator`,
    tier
  });
  return { tenant: tenant.tenant, operator: created.operator };
}

test("Step 3.83 route evidence drives gate 7 without anonymity or content claims", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const { client } = await loginClient(baseUrl);
    const { tenant, operator } = await seedOperator(client, "PRO");

    const allowed = await client.recordJurisdictionRouteEvidence({
      tenantId: tenant.id,
      operatorId: operator.id,
      tier: "PRO",
      appKey: "duckduckgo_browser",
      terminalMode: "pixel_grapheneos",
      routeProfile: "qa-jurisdictional-probe",
      egressClass: "jurisdictional_vpn",
      observedCountry: "FI",
      result: "passed",
      policyDecision: "allow",
      tierEntitled: true,
      checks: {
        tierPolicyEnforced: true,
        routePolicyEnforced: true,
        egressClassObserved: true,
        terminalDataStored: false,
        contentInspected: false,
        anonymityClaimed: false
      },
      evidenceRefs: ["evidence://route/qa-jurisdictional-probe"]
    });
    assert.equal(allowed.evidence.productionExecutionAllowed, false);

    await client.recordJurisdictionRouteEvidence({
      tenantId: tenant.id,
      operatorId: operator.id,
      tier: "STANDARD",
      appKey: "duckduckgo_browser",
      terminalMode: "pixel_grapheneos",
      routeProfile: "qa-tier-deny-probe",
      egressClass: "tor",
      result: "blocked",
      policyDecision: "deny",
      tierEntitled: false,
      checks: {
        tierPolicyEnforced: true,
        routePolicyEnforced: true,
        egressClassObserved: false,
        terminalDataStored: false,
        contentInspected: false,
        anonymityClaimed: false
      },
      blockers: ["tier_does_not_allow_route_profile"],
      evidenceRefs: ["evidence://route/qa-tier-deny-probe"]
    });

    const readiness = await client.getProductionReadiness();
    const gate = readiness.readiness.productionGates.find((item) => item.id === "gate_07_tor_jurisdiction_routing");
    assert.equal(gate.state, "ready_for_human_gate");
    assert.equal(gate.evidence.routeEvidence.ready, true);
    assert.equal(gate.productionExecutionAllowed, false);

    await assert.rejects(
      () => client.recordJurisdictionRouteEvidence({
        tenantId: tenant.id,
        operatorId: operator.id,
        tier: "PRO",
        appKey: "signal",
        terminalMode: "pixel_grapheneos",
        routeProfile: "unsafe",
        egressClass: "tor",
        result: "blocked",
        checks: { messageContent: "must-not-store" }
      }),
      /Route evidence must not contain secrets or communication content/
    );
  } finally {
    await close();
  }
});

test("Step 3.83 CPU confidential evidence drives gate 9 only with attestation and secrets-release evidence", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const { client, credentialId } = await loginClient(baseUrl);
    await seedOperator(client, "SOVEREIGN");
    await stepUp(client, credentialId);
    const blocked = await client.qualifyCpuConfidentialHost({
      hostId: "AX102-U-NEGATIVE",
      cpuVendor: "amd",
      cpuModel: "AMD Ryzen 9 7950X",
      confidentialMode: "none",
      featureFlags: {
        virtualization: true,
        iommu: true,
        tpm2: false,
        secureBoot: false,
        kernelLockdown: false,
        microcodeCurrent: true
      },
      attestation: { verified: false },
      tierTarget: "PRO",
      evidenceRefs: ["evidence://ax102/negative-confidential-compute"]
    });
    assert.equal(blocked.qualification.confidentialComputingApproved, false);

    let readiness = await client.getProductionReadiness();
    let gate = readiness.readiness.productionGates.find((item) => item.id === "gate_09_confidential_compute");
    assert.equal(gate.state, "blocked");
    assert.ok(gate.evidence.cpuConfidentialEvidence.blockedAx102Observed);

    await stepUp(client, credentialId, 3);
    const approved = await client.qualifyCpuConfidentialHost({
      hostId: "TDX-SNP-LAB-APPROVED",
      cpuVendor: "amd",
      cpuModel: "AMD EPYC SEV-SNP qualified lab host",
      confidentialMode: "amd_sev_snp",
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
        measurementRef: "evidence://attestation/snp-measurement",
        verifier: "sylion-attestation-lab"
      },
      tierTarget: "SOVEREIGN",
      evidenceRefs: ["evidence://attestation/snp-measurement"]
    });
    assert.equal(approved.qualification.secretsReleaseAllowed, true);

    readiness = await client.getProductionReadiness();
    gate = readiness.readiness.productionGates.find((item) => item.id === "gate_09_confidential_compute");
    assert.equal(gate.state, "ready_for_human_gate");
    assert.equal(gate.evidence.cpuConfidentialEvidence.ready, true);
    assert.equal(gate.productionExecutionAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.83 payment token gate requires live paid token, redemption and package handoff", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const { client, credentialId } = await loginClient(baseUrl);
    const { tenant, operator } = await seedOperator(client, "PRO");
    await stepUp(client, credentialId);

    const sandbox = await client.issueSubscriptionPaymentToken({
      tier: "PRO",
      minimumMonths: 6,
      amount: 1200,
      currency: "PLN",
      providerMode: "sandbox",
      paymentStatus: "paid_sandbox",
      paymentReference: "sandbox-payment-001",
      evidenceRefs: ["evidence://payment/sandbox"]
    });
    assert.equal(sandbox.token.paymentTokenStoredPlaintext, false);
    assert.equal(typeof sandbox.redemptionToken, "string");

    let readiness = await client.getProductionReadiness();
    let gate = readiness.readiness.productionGates.find((item) => item.id === "gate_10_payment_token_provisioning");
    assert.equal(gate.state, "blocked");
    assert.ok(gate.evidence.paymentTokenEvidence.sandboxIssuedTokenObserved);
    assert.ok(gate.blockers.includes("live_payment_gateway_token_missing"));

    await stepUp(client, credentialId, 3);
    const live = await client.issueSubscriptionPaymentToken({
      tier: "PRO",
      minimumMonths: 6,
      amount: 2500,
      currency: "PLN",
      providerMode: "crypto_gateway_live",
      paymentStatus: "paid_live",
      paymentReference: "live-payment-ref-metadata-only",
      evidenceRefs: ["evidence://payment/live-gateway-receipt"]
    });

    await stepUp(client, credentialId, 4);
    const redeemed = await client.redeemSubscriptionPaymentToken({
      redemptionToken: live.redemptionToken,
      tenantId: tenant.id,
      operatorId: operator.id,
      operatorDisplayName: operator.displayName,
      packageRefs: ["package://pixel/operator", "package://workload/provisioning"],
      operatorPackageGenerated: true,
      graphenePackageGenerated: true,
      routerPackageDeferred: true,
      workloadProvisioningRequested: true
    });
    assert.equal(redeemed.redemption.paymentTokenStoredPlaintext, false);

    const listed = await client.listSubscriptionPaymentTokens();
    assert.equal(Object.prototype.hasOwnProperty.call(listed.tokens[0], "redemptionToken"), false);

    readiness = await client.getProductionReadiness();
    gate = readiness.readiness.productionGates.find((item) => item.id === "gate_10_payment_token_provisioning");
    assert.equal(gate.state, "ready_for_human_gate");
    assert.equal(gate.evidence.paymentTokenEvidence.ready, true);
    assert.equal(gate.productionExecutionAllowed, false);
  } finally {
    await close();
  }
});
