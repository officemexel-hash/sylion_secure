import assert from "node:assert/strict";
import test from "node:test";
import { ROLES } from "../src/domain/constants.js";
import { AuthService } from "../src/modules/auth/authService.js";

const ADMIN_EMAIL = "admin@sylion.local";
const ADMIN_PASSWORD = "ChangeMe-LocalOnly-1!";
const READONLY_EMAIL = "readonly@sylion.local";
const READONLY_PASSWORD = "ReadOnly-LocalOnly-1!";
const CORR = "corr_perf_auth_credential_index";

function createAuditStub() {
  return { record() {} };
}

function createMemoryStore() {
  const collections = new Map();
  return {
    save(collection, key, value) {
      if (!collections.has(collection)) {
        collections.set(collection, new Map());
      }
      collections.get(collection).set(key, value);
    },
    delete(collection, key) {
      collections.get(collection)?.delete(key);
    },
    listEntries(collection) {
      return [...(collections.get(collection) || new Map()).entries()].map(([key, value]) => ({
        key,
        value
      }));
    }
  };
}

function createService({ store = null } = {}) {
  return new AuthService({ audit: createAuditStub(), store });
}

function enroll(service, { email, password, credentialId }) {
  const options = service.createEnrollmentOptions({ email, password, correlationId: CORR });
  return service.verifyEnrollment({
    challengeId: options.challenge.id,
    credential: { id: credentialId, transports: ["usb"] },
    correlationId: CORR
  });
}

// Reference implementation: the original full scan over the credentials collection.
function fullScanActiveIds(service, adminId) {
  return [...service.credentials.values()]
    .filter((credential) => credential.adminId === adminId && credential.status === "active")
    .map((credential) => credential.id);
}

function loginAllowCredentialIds(service, { email, password }) {
  const options = service.createLoginOptions({ email, password, correlationId: CORR });
  return options.challenge.publicKey.allowCredentials.map((credential) => credential.id);
}

function stepUpAllowCredentialIds(service, adminId) {
  const options = service.createStepUpOptions({
    actor: { id: adminId, sessionId: "session_perf_index" },
    correlationId: CORR
  });
  return options.challenge.publicKey.allowCredentials.map((credential) => credential.id);
}

const superAdminActor = { id: "admin_global", role: ROLES.GLOBAL_SUPER_ADMIN };

test("credential index matches full scan after enrollment for multiple admins", () => {
  const service = createService();
  enroll(service, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, credentialId: "cred-a1" });
  enroll(service, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, credentialId: "cred-a2" });
  enroll(service, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, credentialId: "cred-a3" });
  enroll(service, {
    email: READONLY_EMAIL,
    password: READONLY_PASSWORD,
    credentialId: "cred-r1"
  });

  assert.deepEqual(
    loginAllowCredentialIds(service, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    fullScanActiveIds(service, "admin_global")
  );
  assert.deepEqual(fullScanActiveIds(service, "admin_global"), ["cred-a1", "cred-a2", "cred-a3"]);
  assert.deepEqual(
    loginAllowCredentialIds(service, { email: READONLY_EMAIL, password: READONLY_PASSWORD }),
    fullScanActiveIds(service, "admin_readonly")
  );
  assert.deepEqual(fullScanActiveIds(service, "admin_readonly"), ["cred-r1"]);
  assert.deepEqual(stepUpAllowCredentialIds(service, "admin_global"), [
    "cred-a1",
    "cred-a2",
    "cred-a3"
  ]);
});

test("credential index matches full scan after suspend, revoke and sign-counter mutations", () => {
  const service = createService();
  enroll(service, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, credentialId: "cred-a1" });
  enroll(service, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, credentialId: "cred-a2" });
  enroll(service, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, credentialId: "cred-a3" });

  // Mutation path 1: verifyLogin updates the credential record (signCounter, lastUsedAt).
  const loginOptions = service.createLoginOptions({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    correlationId: CORR
  });
  service.verifyLogin({
    challengeId: loginOptions.challenge.id,
    credentialId: "cred-a2",
    assertion: { signature: `simulated:${loginOptions.challenge.id}:cred-a2`, signCounter: 1 },
    correlationId: CORR
  });
  assert.deepEqual(
    loginAllowCredentialIds(service, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    fullScanActiveIds(service, "admin_global")
  );
  assert.deepEqual(fullScanActiveIds(service, "admin_global"), ["cred-a1", "cred-a2", "cred-a3"]);

  // Mutation path 2: suspend removes the credential from the active list.
  service.suspendCredential({
    actor: superAdminActor,
    credentialId: "cred-a1",
    correlationId: CORR
  });
  assert.deepEqual(
    loginAllowCredentialIds(service, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    fullScanActiveIds(service, "admin_global")
  );
  assert.deepEqual(fullScanActiveIds(service, "admin_global"), ["cred-a2", "cred-a3"]);

  // Mutation path 3: revoke removes the credential from the active list.
  service.revokeCredential({
    actor: superAdminActor,
    credentialId: "cred-a3",
    correlationId: CORR
  });
  assert.deepEqual(
    loginAllowCredentialIds(service, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    fullScanActiveIds(service, "admin_global")
  );
  assert.deepEqual(fullScanActiveIds(service, "admin_global"), ["cred-a2"]);

  // All credentials revoked: behaves like the full scan returning an empty list.
  service.revokeCredential({
    actor: superAdminActor,
    credentialId: "cred-a2",
    correlationId: CORR
  });
  assert.deepEqual(fullScanActiveIds(service, "admin_global"), []);
  assert.throws(
    () =>
      service.createLoginOptions({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        correlationId: CORR
      }),
    (error) => error.code === "credential_required"
  );
});

test("credential index is rebuilt from the persistent store on construction", () => {
  const store = createMemoryStore();
  const first = createService({ store });
  enroll(first, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, credentialId: "cred-p1" });
  enroll(first, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, credentialId: "cred-p2" });
  enroll(first, { email: READONLY_EMAIL, password: READONLY_PASSWORD, credentialId: "cred-p3" });
  first.revokeCredential({
    actor: superAdminActor,
    credentialId: "cred-p1",
    correlationId: CORR
  });

  const second = createService({ store });
  assert.deepEqual(
    loginAllowCredentialIds(second, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    fullScanActiveIds(second, "admin_global")
  );
  assert.deepEqual(fullScanActiveIds(second, "admin_global"), ["cred-p2"]);
  assert.deepEqual(
    loginAllowCredentialIds(second, { email: READONLY_EMAIL, password: READONLY_PASSWORD }),
    fullScanActiveIds(second, "admin_readonly")
  );
  assert.deepEqual(fullScanActiveIds(second, "admin_readonly"), ["cred-p3"]);
});
