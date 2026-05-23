import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { AdminApiClient } from "../src/sdk/adminApiClient.js";

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
    correlationIdFactory: () => `corr_step3_17_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-17-${crypto.randomUUID()}`;
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

async function operatorRequest(baseUrl, token, path, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": `corr_step3_17_operator_${crypto.randomUUID()}`,
      authorization: `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
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

async function operatorCookieRequest(baseUrl, cookie, path, { method = "GET", body, csrf = true } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": `corr_step3_17_operator_cookie_${crypto.randomUUID()}`,
      ...(csrf ? { "x-sylion-operator-csrf": "same-origin-ui" } : {}),
      cookie
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "operator cookie request failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

test("Step 3.17 exposes admin and operator-layer FIDO2/HSM configuration without physical enrollment", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const tenant = await client.createTenant({ name: "Step 3.17 Tenant", tier: "PRO" });
    const created = await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Step 3.17 Operator",
      tier: "PRO"
    });
    const operatorId = created.operator.id;

    const adminFido = await client.request("/security/admin/fido2-policy", {
      method: "POST",
      body: {
        mode: "enrollment_deferred",
        defaultSessionHours: 12,
        allowedTransports: ["usb", "nfc"]
      }
    });
    assert.equal(adminFido.policy.scope, "admin");
    assert.equal(adminFido.policy.actualEnrollmentAllowed, false);

    const adminHsm = await client.request("/security/admin/hsm-profile", {
      method: "POST",
      body: {
        mode: "reference_only",
        provider: "vault_hsm_planned",
        references: ["hsm-ref://admin/root-ca"],
        attestationRefs: ["evidence://hsm/admin-attestation"]
      }
    });
    assert.equal(adminHsm.profile.scope, "admin");
    assert.equal(adminHsm.profile.materialStored, false);

    const operatorFido = await client.request(`/operators/${operatorId}/security/fido2-policy`, {
      method: "POST",
      body: {
        mode: "enrollment_deferred",
        defaultSessionHours: 8,
        allowedTransports: ["usb", "nfc"]
      }
    });
    assert.equal(operatorFido.policy.scope, "operator");
    assert.equal(operatorFido.policy.operatorId, operatorId);
    assert.equal(operatorFido.policy.defaultSessionHours, 8);

    const operatorHsm = await client.request(`/operators/${operatorId}/security/hsm-profile`, {
      method: "POST",
      body: {
        mode: "byo_hsm_deferred",
        references: ["hsm-ref://operator/signing-key"],
        attestationRefs: ["evidence://operator/hsm-deferred"]
      }
    });
    assert.equal(operatorHsm.profile.scope, "operator");
    assert.equal(operatorHsm.profile.physicalHsmDeferred, true);
    assert.equal(JSON.stringify(operatorHsm).includes("private"), false);
    assert.ok(app.services.audit.list().some((event) => event.action === "security.hsm_profile.updated"));
  } finally {
    await close();
  }
});

test("Step 3.17 scopes operator portal sessions to Pixel or laptop terminal VPN profiles", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const tenant = await client.createTenant({ name: "Step 3.17 Terminal Tenant", tier: "PRO" });
    const created = await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Step 3.17 Terminal Operator",
      tier: "PRO"
    });
    const operatorId = created.operator.id;
    const pixel = await client.registerDevice({
      type: "pixel_grapheneos",
      serial: `pixel-step3-17-${crypto.randomUUID()}`,
      model: "Pixel GrapheneOS ADB unlocked lab",
      assignedOperatorId: operatorId,
      posture: { state: "adb_lab_ready", os: "GrapheneOS" }
    });
    await client.registerDevice({
      type: "laptop_web_terminal",
      serial: `laptop-step3-17-${crypto.randomUUID()}`,
      model: "Laptop web thin client",
      assignedOperatorId: operatorId,
      posture: { state: "browser_lab_ready" }
    });

    const unauth = await fetch(`${baseUrl}/operator-api/me`, {
      headers: { "x-correlation-id": "corr_step3_17_unauth" }
    });
    assert.equal(unauth.status, 401);

    const sessionPayload = await client.request("/operator-api/sessions/local-simulator", {
      method: "POST",
      body: {
        operatorId,
        terminalMode: "pixel_grapheneos",
        deviceId: pixel.device.id
      }
    });
    assert.equal(sessionPayload.session.operatorId, operatorId);
    assert.equal(sessionPayload.session.terminalMode, "pixel_grapheneos");
    assert.equal(sessionPayload.session.productionExecutionAllowed, false);

    const me = await operatorRequest(baseUrl, sessionPayload.session.token, "/operator-api/me");
    assert.equal(me.me.operatorId, operatorId);
    assert.equal(me.me.terminalMode, "pixel_grapheneos");

    const devices = await operatorRequest(baseUrl, sessionPayload.session.token, "/operator-api/devices");
    assert.equal(devices.devices.length, 2);
    assert.ok(devices.devices.every((device) => device.terminalEligible === true));

    const vpn = await operatorRequest(baseUrl, sessionPayload.session.token, "/operator-api/vpn-status");
    assert.equal(vpn.vpn.transport, "ipsec_ikev2_planned");
    assert.deepEqual(vpn.vpn.path, [
      "Pixel GrapheneOS terminal",
      "Puli AX IPsec gateway",
      "G1 network gateway",
      "G2 access broker",
      "WORKLOAD microVM layer"
    ]);
    assert.equal(vpn.vpn.productionExecutionAllowed, false);

    const vpnInstall = await operatorRequest(baseUrl, sessionPayload.session.token, "/operator-api/vpn-install-package");
    assert.equal(vpnInstall.package.transport, "ipsec_ikev2_certificate_auth");
    assert.equal(vpnInstall.package.readyForRealInstall, false);
    assert.equal(vpnInstall.package.productionExecutionAllowed, false);
    assert.ok(vpnInstall.package.requires.includes("pixel_live_vpn_evidence"));

    const evidence = await operatorRequest(baseUrl, sessionPayload.session.token, "/operator-api/vpn-evidence", {
      method: "POST",
      body: {
        vpnConnected: true,
        vpnSession: "SYLION",
        vpnInterface: "tun1",
        dnsThroughTunnel: true,
        certificateTrusted: true,
        reachableHosts: [
          "admin.sylion.internal",
          "operator.sylion.internal",
          "signal.sylion.internal",
          "10.42.0.12"
        ]
      }
    });
    assert.equal(evidence.evidence.ready, true);
    assert.equal(evidence.evidence.contentInspected, false);

    const activeVpn = await operatorRequest(baseUrl, sessionPayload.session.token, "/operator-api/vpn-status");
    assert.equal(activeVpn.vpn.state, "live_ipsec_connected");
    assert.equal(activeVpn.vpn.liveEvidence.ready, true);

    const activeInstall = await operatorRequest(baseUrl, sessionPayload.session.token, "/operator-api/vpn-install-package");
    assert.equal(activeInstall.package.installState, "active_live_evidence");
    assert.equal(activeInstall.package.readyForRealInstall, true);
    assert.deepEqual(activeInstall.package.requires, []);

    const stream = await operatorRequest(baseUrl, sessionPayload.session.token, "/operator-api/streaming-profile?width=390&height=844&dpr=3");
    assert.equal(stream.profile.terminalMode, "pixel_grapheneos");
    assert.equal(stream.profile.stream.operationalDataOnTerminal, false);
    assert.equal(stream.profile.stream.resizePolicy, "server_side_dynamic_resolution");
    assert.equal(stream.profile.stream.targetHeight, 1280);
    assert.ok(stream.profile.stream.targetWidth >= 590);

    const profiles = await operatorRequest(baseUrl, sessionPayload.session.token, "/operator-api/terminal-profiles");
    assert.equal(profiles.profiles.length, 2);
    assert.ok(profiles.profiles.some((profile) => profile.mode === "laptop_web_terminal" && profile.browserThinClientSupported));
    assert.ok(profiles.profiles.some((profile) => profile.mode === "pixel_grapheneos" && profile.adbSupportedForLab));
  } finally {
    await close();
  }
});

test("Step 3.17 binds operator session to HttpOnly cookie for new-tab handoff and keeps CSRF on mutations", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const tenant = await client.createTenant({ name: "Step 3.17 Cookie Handoff Tenant", tier: "PRO" });
    const created = await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Step 3.17 Cookie Handoff Operator",
      tier: "PRO"
    });
    const pixel = await client.registerDevice({
      type: "pixel_grapheneos",
      serial: `pixel-cookie-handoff-${crypto.randomUUID()}`,
      model: "Pixel GrapheneOS ADB unlocked lab",
      assignedOperatorId: created.operator.id,
      posture: { state: "adb_lab_ready", os: "GrapheneOS" }
    });
    const sessionPayload = await client.request("/operator-api/sessions/local-simulator", {
      method: "POST",
      body: {
        operatorId: created.operator.id,
        terminalMode: "pixel_grapheneos",
        deviceId: pixel.device.id
      }
    });

    const attach = await fetch(`${baseUrl}/operator-api/sessions/attach`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": `corr_step3_17_attach_${crypto.randomUUID()}`,
        authorization: `Bearer ${sessionPayload.session.token}`
      }
    });
    const attached = await attach.json();
    assert.equal(attach.status, 200);
    assert.equal(attached.cookieBound, true);
    assert.equal(attached.session.operatorId, created.operator.id);
    assert.equal(Object.hasOwn(attached.session, "token"), false);
    const setCookie = attach.headers.get("set-cookie");
    assert.match(setCookie, /sylion_operator_session=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Path=\/operator-api/);

    const cookie = setCookie.split(";")[0];
    const restored = await operatorCookieRequest(baseUrl, cookie, "/operator-api/sessions/current");
    assert.equal(restored.session.operatorId, created.operator.id);
    assert.equal(Object.hasOwn(restored.session, "token"), false);

    const me = await operatorCookieRequest(baseUrl, cookie, "/operator-api/me");
    assert.equal(me.me.operatorId, created.operator.id);

    await assert.rejects(
      () => operatorCookieRequest(baseUrl, cookie, "/operator-api/workload-control/requests", {
        method: "POST",
        csrf: false,
        body: {
          action: "scale_to_counts",
          desiredCounts: { signal: 1 }
        }
      }),
      (error) => error.status === 403 && error.payload.error.code === "csrf_required"
    );

    const queued = await operatorCookieRequest(baseUrl, cookie, "/operator-api/workload-control/requests", {
      method: "POST",
      body: {
        action: "scale_to_counts",
        desiredCounts: { signal: 1, whatsapp: 1 }
      }
    });
    assert.equal(queued.request.operatorId, created.operator.id);
    assert.equal(queued.request.state, "queued_control_plane_update");
  } finally {
    await close();
  }
});

test("Step 3.17 lets operator configure deferred FIDO2/HSM refs but rejects secret material", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const client = await loginClient(baseUrl);
    const tenant = await client.createTenant({ name: "Step 3.17 Security Tenant", tier: "PRO" });
    const created = await client.createOperator({
      tenantId: tenant.tenant.id,
      displayName: "Step 3.17 Security Operator",
      tier: "PRO"
    });
    const sessionPayload = await client.request("/operator-api/sessions/local-simulator", {
      method: "POST",
      body: {
        operatorId: created.operator.id,
        terminalMode: "laptop_web_terminal"
      }
    });

    const fido = await operatorRequest(baseUrl, sessionPayload.session.token, "/operator-api/settings/fido2", {
      method: "POST",
      body: {
        mode: "enrollment_deferred",
        defaultSessionHours: 12,
        allowedTransports: ["usb", "nfc"]
      }
    });
    assert.equal(fido.policy.operatorId, created.operator.id);
    assert.equal(fido.policy.actualEnrollmentAllowed, false);

    const hsm = await operatorRequest(baseUrl, sessionPayload.session.token, "/operator-api/settings/hsm", {
      method: "POST",
      body: {
        mode: "byo_hsm_deferred",
        references: ["hsm-ref://operator/deferred-key"],
        attestationRefs: ["evidence://operator/hsm"]
      }
    });
    assert.equal(hsm.profile.materialStored, false);

    await assert.rejects(
      () => operatorRequest(baseUrl, sessionPayload.session.token, "/operator-api/settings/hsm", {
        method: "POST",
        body: {
          mode: "byo_hsm_deferred",
          privateKey: "must-not-store"
        }
      }),
      (error) => error.status === 422 && error.payload.error.code === "validation_error"
    );
  } finally {
    await close();
  }
});
