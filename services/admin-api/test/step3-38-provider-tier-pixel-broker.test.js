import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

async function startTestServer(options = {}) {
  const app = createApp(options);
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
    correlationIdFactory: () => `corr_step3_38_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-38-${crypto.randomUUID()}`;
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

async function stepUp(client, credentialId) {
  const options = await client.createStepUpOptions();
  await client.verifyStepUp({
    challengeId: options.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${options.challenge.id}:${credentialId}`,
      signCounter: 2
    }
  });
}

async function operatorRequest(baseUrl, token, path, { method = "GET", body, expectOk = true } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": `corr_step3_38_operator_${crypto.randomUUID()}`,
      authorization: `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (expectOk && !response.ok) {
    const error = new Error(payload?.error?.message || "operator request failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return { status: response.status, payload };
}

async function seedOperator(client, tier = "PRO") {
  const tenant = await client.createTenant({ name: `Step 3.38 ${tier} Tenant`, tier });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: `Step 3.38 ${tier} Operator`,
    tier
  });
  const session = await client.request("/operator-api/sessions/local-simulator", {
    method: "POST",
    body: {
      operatorId: created.operator.id,
      terminalMode: "pixel_grapheneos"
    }
  });
  return { tenant, operator: created.operator, session: session.session };
}

test("Step 3.38 provider registry supports country and Firecracker/confidential capability filters", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const { client, credentialId } = await loginClient(baseUrl);
    await stepUp(client, credentialId);
    const provider = await client.createProvider({
      providerType: "scaleway",
      apiSecret: "step3-38-provider-secret-never-return",
      countries: ["FR", "PL"],
      regions: ["fr-par", "pl-waw"],
      regionCatalog: [
        { region: "fr-par", country: "FR", city: "Paris" },
        { region: "pl-waw", country: "PL", city: "Warsaw" }
      ],
      runtimeCapabilities: {
        containers: true,
        nestedKvm: false,
        bareMetalKvm: true,
        firecracker: true,
        androidWorkloads: true,
        intelTdx: false,
        amdSevSnp: false,
        recommendedTier: "PRO"
      },
      testConnection: { mode: "mock", status: "passed" }
    });
    assert.deepEqual(provider.provider.countries, ["FR", "PL"]);
    assert.equal(provider.provider.regionCatalog[1].country, "PL");
    assert.equal(JSON.stringify(provider).includes("step3-38-provider-secret-never-return"), false);

    const eligible = await client.request("/providers/eligible?capability=firecracker&country=PL&tier=PRO");
    assert.equal(eligible.providers.length, 1);
    assert.equal(eligible.providers[0].providerKey, "scaleway");
    assert.equal(eligible.providers[0].regions[0].region, "pl-waw");
    assert.equal(eligible.providers[0].productionExecutionAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.38 subscription plans expose exact tier policies for providers, sessions and jurisdiction", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const { client } = await loginClient(baseUrl);
    const plans = await client.request("/subscription/plans");
    const standard = plans.plans.find((plan) => plan.tier === "STANDARD");
    const pro = plans.plans.find((plan) => plan.tier === "PRO");
    const sovereign = plans.plans.find((plan) => plan.tier === "SOVEREIGN");
    assert.deepEqual(standard.providerPolicy.allowedRuntimeClasses, ["containers"]);
    assert.equal(pro.providerPolicy.firecrackerRequired, true);
    assert.equal(pro.jurisdictionPolicy.minFrequencyHours, 24);
    assert.equal(sovereign.providerPolicy.confidentialComputeRequired, true);
    assert.equal(sovereign.jurisdictionPolicy.allVpsRotationAllowed, true);
    assert.equal(sovereign.sessionPolicy.maxHours, 24);
  } finally {
    await close();
  }
});

test("Step 3.38 operator jurisdiction policy includes countries, providers and tier frequency gates", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const { client } = await loginClient(baseUrl);
    const standard = await seedOperator(client, "STANDARD");
    const denied = await operatorRequest(baseUrl, standard.session.token, "/operator-api/settings/jurisdiction", {
      method: "POST",
      expectOk: false,
      body: {
        mode: "scheduled",
        countries: ["DE", "FI"],
        providers: ["hetzner", "ovh"],
        frequencyHours: 24
      }
    });
    assert.equal(denied.status, 422);

    const pro = await seedOperator(client, "PRO");
    const saved = await operatorRequest(baseUrl, pro.session.token, "/operator-api/settings/jurisdiction", {
      method: "POST",
      body: {
        mode: "scheduled",
        regions: ["fsn1", "hel1"],
        countries: ["DE", "FI"],
        providers: ["hetzner", "scaleway"],
        frequencyHours: 24
      }
    });
    assert.deepEqual(saved.payload.policy.countries, ["DE", "FI"]);
    assert.deepEqual(saved.payload.policy.providers, ["hetzner", "scaleway"]);
    assert.equal(saved.payload.policy.frequencyHours, 24);
    assert.ok(saved.payload.policy.rotationScopes.includes("provider"));
    assert.equal(saved.payload.policy.productionExecutionAllowed, false);
  } finally {
    await close();
  }
});

test("Step 3.38 Pixel CA provisioning and workload session broker stay reference-only and terminal-safe", async () => {
  const caPem = "-----BEGIN CERTIFICATE-----\\nMIIBstep338publiconly\\n-----END CERTIFICATE-----";
  const { baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_INTERNAL_CA_CERT_PEM: caPem,
        SYLION_INTERNAL_CA_SHA256: "SHA256:step3-38",
        SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true"
      }
    }
  });
  try {
    const { client } = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    const ca = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/pixel-ca-provisioning");
    assert.equal(ca.payload.package.privateKeyIncluded, undefined);
    assert.equal(ca.payload.package.validation.privateKeyIncluded, false);
    assert.equal(ca.payload.package.caCertificatePem, caPem);
    assert.equal(ca.payload.package.installMethods[1].status, "blocked_on_grapheneos_file_uri");

    const broker = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/workload-session-broker/signal");
    assert.equal(broker.payload.broker.authMode, "g2_session_broker_required");
    assert.equal(broker.payload.broker.sessionBroker.requiredLayer, "G2");
    assert.equal(broker.payload.broker.sessionBroker.noVncProductionApproved, false);
    assert.equal(broker.payload.broker.handoff.storesOperationalDataOnTerminal, false);
    assert.ok(broker.payload.broker.blockers.includes("pixel_internal_ca_not_trusted"));
    assert.equal(JSON.stringify(broker.payload).includes("privateKey"), false);
  } finally {
    await close();
  }
});

test("Step 3.60 workload broker normalizes DuckDuckGo and reports live route truth", async () => {
  const { baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_DUCKDUCKGO_LIVE_HTTP_STATUS: "200",
        SYLION_DUCKDUCKGO_NATIVE_EVIDENCE_READY: "true",
        SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL: "true",
        SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true"
      }
    }
  });
  try {
    const { client } = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    const broker = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/workload-session-broker/duckduckgo");

    assert.equal(broker.payload.broker.templateKey, "duckduckgo_browser");
    assert.equal(broker.payload.broker.appName, "DuckDuckGo Browser");
    assert.equal(broker.payload.broker.url, "https://duckduckgo.sylion.internal/vnc.html");
    assert.equal(broker.payload.broker.routeStatus.ready, true);
    assert.equal(broker.payload.broker.routeStatus.httpStatus, 200);
    assert.equal(broker.payload.broker.handoff.storesOperationalDataOnTerminal, false);
    assert.equal(broker.payload.broker.routeStatus.cdrRequired, true);
    assert.equal(broker.payload.broker.productionExecutionAllowed, false);
    assert.equal(broker.payload.broker.blockers.includes("duckduckgo_browser_native_workload_not_built"), false);
    assert.equal(JSON.stringify(broker.payload).includes("privateKey"), false);
  } finally {
    await close();
  }
});

test("Step 3.60 workload broker exposes not-built state for missing native apps", async () => {
  const { baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: {
        SYLION_SIGNAL_LIVE_HTTP_STATUS: "502",
        SYLION_INTERNAL_CA_TRUSTED_ON_PIXEL: "true",
        SYLION_DEFER_PHYSICAL_HSM_FIDO2: "true"
      }
    }
  });
  try {
    const { client } = await loginClient(baseUrl);
    const seeded = await seedOperator(client, "PRO");
    const broker = await operatorRequest(baseUrl, seeded.session.token, "/operator-api/workload-session-broker/signal");

    assert.equal(broker.payload.broker.appName, "Signal");
    assert.equal(broker.payload.broker.routeStatus.state, "not_built");
    assert.ok(broker.payload.broker.blockers.includes("signal_native_workload_not_built"));
    assert.equal(broker.payload.broker.productionExecutionAllowed, false);
  } finally {
    await close();
  }
});
