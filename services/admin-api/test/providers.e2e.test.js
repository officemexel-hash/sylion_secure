import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

async function startTestServer() {
  const app = createApp();
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function request(baseUrl, path, { method = "GET", token, body, correlationId = "corr_provider_e2e" } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": correlationId,
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function login(baseUrl) {
  const credentialId = "cred-provider-e2e";
  const enrollOptions = await request(baseUrl, "/auth/webauthn/enrollment/options", {
    method: "POST",
    body: {
      email: "admin@sylion.local",
      password: "ChangeMe-LocalOnly-1!"
    }
  });
  assert.equal(enrollOptions.status, 201);
  const enrolled = await request(baseUrl, "/auth/webauthn/enrollment/verify", {
    method: "POST",
    body: {
      challengeId: enrollOptions.payload.challenge.id,
      credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
    }
  });
  assert.equal(enrolled.status, 201);
  const loginOptions = await request(baseUrl, "/auth/webauthn/login/options", {
    method: "POST",
    body: {
      email: "admin@sylion.local",
      password: "ChangeMe-LocalOnly-1!"
    }
  });
  assert.equal(loginOptions.status, 201);
  const result = await request(baseUrl, "/auth/webauthn/login/verify", {
    method: "POST",
    body: {
      challengeId: loginOptions.payload.challenge.id,
      credentialId,
      assertion: {
        signature: `simulated:${loginOptions.payload.challenge.id}:${credentialId}`,
        signCounter: 1
      }
    }
  });
  assert.equal(result.status, 200);
  return result.payload.session.token;
}

test("provider creation, list, and rotation expose secret references only", async () => {
  const { baseUrl, close } = await startTestServer();
  const firstSecret = "hetzner-e2e-token-never-leak";
  const rotatedSecret = "hetzner-e2e-rotated-token-never-leak";

  try {
    const token = await login(baseUrl);
    const created = await request(baseUrl, "/providers", {
      method: "POST",
      token,
      body: {
        providerType: "hetzner",
        apiSecret: firstSecret,
        regions: ["fsn1", "nbg1"],
        quota: { instances: 12, vcpu: 24, memoryGb: 96, storageGb: 750 },
        billingHealth: { status: "healthy" },
        testConnection: { mode: "mock", status: "passed" }
      }
    });

    assert.equal(created.status, 201);
    assert.equal(created.payload.provider.providerKey, "hetzner");
    assert.deepEqual(created.payload.provider.regions, ["fsn1", "nbg1"]);
    assert.equal(created.payload.provider.quota.vcpu, 24);
    assert.equal(created.payload.provider.billingHealth.status, "healthy");
    assert.match(created.payload.provider.apiSecretReference.secretReference, /^secret:\/\/admin-api\/secret_/);
    assert.equal(JSON.stringify(created.payload).includes(firstSecret), false);

    const listed = await request(baseUrl, "/providers", { token });
    assert.equal(listed.status, 200);
    assert.equal(listed.payload.providers.length, 1);
    assert.equal(listed.payload.providers[0].providerKey, "hetzner");
    assert.equal(JSON.stringify(listed.payload).includes(firstSecret), false);

    const rotated = await request(baseUrl, `/providers/${created.payload.provider.id}/secret-rotation`, {
      method: "POST",
      token,
      body: {
        apiSecret: rotatedSecret,
        testConnection: { mode: "mock", status: "passed" }
      }
    });
    assert.equal(rotated.status, 200);
    assert.equal(rotated.payload.provider.apiSecretReference.version, 2);
    assert.notEqual(
      rotated.payload.provider.apiSecretReference.secretReference,
      created.payload.provider.apiSecretReference.secretReference
    );
    assert.equal(JSON.stringify(rotated.payload).includes(rotatedSecret), false);

    const audit = await request(baseUrl, "/audit/events", { token });
    assert.equal(audit.status, 200);
    const auditJson = JSON.stringify(audit.payload);
    assert.equal(auditJson.includes(firstSecret), false);
    assert.equal(auditJson.includes(rotatedSecret), false);
    const actions = audit.payload.events.map((event) => event.action);
    assert.ok(actions.includes("provider.created"));
    assert.ok(actions.includes("provider.api_secret_rotated"));
  } finally {
    await close();
  }
});

test("custom providers are accepted with explicit metadata", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const token = await login(baseUrl);
    const created = await request(baseUrl, "/providers", {
      method: "POST",
      token,
      body: {
        providerType: "sovereign-lab",
        displayName: "Sovereign Lab",
        apiSecret: "custom-provider-secret-never-leak",
        regions: ["lab-waw-1"],
        metadata: { apiType: "token", docsUrl: "https://example.invalid/provider-docs" },
        billingHealth: { status: "unknown" },
        testConnection: { mode: "mock", status: "passed" }
      }
    });

    assert.equal(created.status, 201);
    assert.equal(created.payload.provider.providerKey, "sovereign-lab");
    assert.equal(created.payload.provider.metadata.extensible, true);
    assert.equal(created.payload.provider.metadata.docsUrl, "https://example.invalid/provider-docs");
    assert.equal(JSON.stringify(created.payload).includes("custom-provider-secret-never-leak"), false);
  } finally {
    await close();
  }
});
