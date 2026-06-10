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
    correlationIdFactory: () => `corr_step3_19_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-19-${crypto.randomUUID()}`;
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

async function stepUp(client, credentialId, counter = 2) {
  const options = await client.createStepUpOptions();
  await client.verifyStepUp({
    challengeId: options.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${options.challenge.id}:${credentialId}`,
      signCounter: counter
    }
  });
}

test("Step 3.19 configures Vault/KMS/HSM secret backends as reference-only and keeps production release blocked", async () => {
  const { app, baseUrl, close } = await startTestServer({
    liveExecutionOptions: { env: { HETZNER_API_TOKEN: "configured-runtime-token-never-leak" } }
  });
  try {
    const { client, credentialId } = await loginClient(baseUrl);
    await stepUp(client, credentialId);
    const backend = await client.configureSecretBackend({
      backendType: "vault",
      displayName: "Vault Transit - staging",
      endpointReference: "vault://sylion-staging/transit",
      mode: "runtime_resolver_planned",
      evidenceRefs: ["adr://step3-19-secret-backend-contract"]
    });
    assert.equal(backend.backend.backendType, "vault");
    assert.equal(backend.backend.plaintextRetrievalAllowed, false);
    assert.equal(backend.backend.productionReady, false);
    assert.equal(backend.backend.humanGateRequired, true);

    const status = await client.getSecretBackendStatus();
    assert.equal(status.status.productionSecretReleaseAllowed, false);
    assert.equal(status.status.plaintextRetrievalAllowed, false);
    assert.equal(status.status.envRuntimeConfigured.hetzner, true);
    assert.ok(status.status.activeBackends.some((item) => item.id === backend.backend.id));
    assert.equal(JSON.stringify(status).includes("configured-runtime-token-never-leak"), false);
    assert.ok(
      app.services.audit.list().some((event) => event.action === "secret.backend_configured")
    );
  } finally {
    app.close();
    await close();
  }
});

test("Step 3.19 lets provider secrets use external references without plaintext API keys", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const { client, credentialId } = await loginClient(baseUrl);
    await stepUp(client, credentialId);
    const backend = await client.configureSecretBackend({
      backendType: "hsm",
      displayName: "BYO HSM partition reference",
      hsmPartitionReference: "hsm://tenant-a/partition/provider-api",
      mode: "reference_only",
      evidenceRefs: ["hsm-evidence://tenant-a/reference-only"]
    });
    const provider = await client.createProvider({
      providerType: "hetzner",
      externalSecretReference: "hsm://tenant-a/provider/hetzner-api",
      secretBackendId: backend.backend.id,
      regions: ["fsn1"],
      billingHealth: { status: "healthy" },
      testConnection: { mode: "external_reference", status: "reference_only" }
    });
    assert.equal(provider.provider.apiSecretReference.backendType, "hsm");
    assert.equal(provider.provider.apiSecretReference.custody, "external_reference_only");
    assert.match(
      provider.provider.apiSecretReference.secretReference,
      /^secret:\/\/admin-api\/secret_/
    );

    const providers = await client.request("/providers");
    assert.equal(JSON.stringify(providers).includes("hcloud-live-token-should-not-appear"), false);
    assert.equal(
      JSON.stringify(app.services.audit.list()).includes("hcloud-live-token-should-not-appear"),
      false
    );
  } finally {
    app.close();
    await close();
  }
});

test("Step 3.19 rejects external references that contain secret material", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const { client, credentialId } = await loginClient(baseUrl);
    await stepUp(client, credentialId);
    const backend = await client.configureSecretBackend({
      backendType: "cloud_kms",
      displayName: "KMS reference contract",
      keyRingReference: "kms://project/keyring/provider-api",
      mode: "reference_only"
    });
    await assert.rejects(
      () =>
        client.createProvider({
          providerType: "hetzner",
          externalSecretReference: "vault://path?token=plaintext-secret-never-leak",
          secretBackendId: backend.backend.id,
          regions: ["fsn1"],
          billingHealth: { status: "healthy" }
        }),
      /External secret reference must not contain secret material/
    );
    assert.equal(
      JSON.stringify(app.services.audit.list()).includes("plaintext-secret-never-leak"),
      false
    );
  } finally {
    app.close();
    await close();
  }
});
