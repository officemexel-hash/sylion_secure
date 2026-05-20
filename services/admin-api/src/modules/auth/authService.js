import { createHash, randomBytes } from "node:crypto";
import { ROLES, RESOURCE_TYPES } from "../../domain/constants.js";
import { AppError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

function hashSecret(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nowMs() {
  return Date.now();
}

function isoNow() {
  return new Date().toISOString();
}

function futureIso(ttlMs) {
  return new Date(nowMs() + ttlMs).toISOString();
}

function challengeHash(value) {
  return hashSecret(`webauthn-challenge:${value}`);
}

function publicChallenge(challenge) {
  return {
    id: challenge.id,
    purpose: challenge.purpose,
    email: challenge.email,
    expiresAt: challenge.expiresAt,
    publicKey: {
      challenge: challenge.publicChallenge,
      timeout: challenge.ttlMs,
      rpId: "sylion.local",
      userVerification: "required"
    }
  };
}

export class AuthService {
  constructor({ audit, store = null, challengeTtlMs = 120_000, sessionTtlMs = 12 * 60 * 60 * 1000, stepUpTtlMs = 15 * 60 * 1000 }) {
    this.audit = audit;
    this.challengeTtlMs = challengeTtlMs;
    this.sessionTtlMs = sessionTtlMs;
    this.stepUpTtlMs = stepUpTtlMs;
    this.admins = new PersistentMap({ store, collection: "auth_admins" });
    this.sessions = new PersistentMap({ store, collection: "auth_sessions" });
    this.challenges = new PersistentMap({ store, collection: "auth_challenges" });
    this.credentials = new PersistentMap({ store, collection: "auth_credentials" });
    this.seedAdmin({
      id: "admin_global",
      email: "admin@sylion.local",
      passwordHash: "25bbbd5c1bffcdb47f482ac1d8a6b0626305665970c8f355ab0407f40a2480ce",
      role: ROLES.GLOBAL_SUPER_ADMIN
    });
    this.seedAdmin({
      id: "admin_readonly",
      email: "readonly@sylion.local",
      passwordHash: "1701bac3e54b43e34357926bbba5083a955d2614595927d7812f0d582bbe1fd3",
      role: ROLES.SUPPORT_READONLY
    });
  }

  seedAdmin({ id, email, password, passwordHash, role }) {
    this.admins.set(email, {
      id,
      email,
      passwordHash: passwordHash || hashSecret(password),
      role,
      locked: false
    });
  }

  login({ email, password, fido2Verified, correlationId }) {
    const admin = this.admins.get(email);
    const valid = Boolean(admin) && !admin.locked && admin.passwordHash === hashSecret(password) && fido2Verified === true;

    this.audit.record({
      actorId: admin?.id || "unknown",
      action: valid ? "auth.login_success" : "auth.login_failure",
      resourceType: RESOURCE_TYPES.SESSION,
      resourceId: email,
      correlationId,
      policyDecision: valid ? "allow" : "deny",
      result: valid ? "success" : "denied",
      newValue: { email, fido2Verified: Boolean(fido2Verified) }
    });

    if (!valid) {
      throw new AppError("invalid_credentials", "Invalid credentials or FIDO2 verification", 401);
    }

    const token = randomBytes(32).toString("hex");
    const session = {
      id: newId("session"),
      token,
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      createdAt: new Date().toISOString()
    };
    this.sessions.set(token, session);
    return session;
  }

  createEnrollmentOptions({ email, password, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const admin = this.#validatePassword({ email, password });
    const challenge = this.#createChallenge({ admin, purpose: "enrollment", correlationId: corr });
    this.#recordAudit({
      actorId: admin.id,
      action: "auth.challenge_issued",
      resourceId: challenge.id,
      correlationId: corr,
      newValue: { purpose: challenge.purpose, email: admin.email, expiresAt: challenge.expiresAt }
    });
    return {
      challenge: publicChallenge(challenge),
      user: { id: admin.id, email: admin.email },
      devSimulator: {
        mode: "local_webauthn_simulator",
        verifyEndpoint: "/auth/webauthn/enrollment/verify"
      }
    };
  }

  verifyEnrollment({ challengeId, credential = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const challenge = this.#consumeChallenge({ challengeId, purpose: "enrollment", correlationId: corr });
    const admin = this.admins.get(challenge.email);
    const credentialId = credential.id || newId("cred");
    const record = {
      id: credentialId,
      adminId: admin.id,
      email: admin.email,
      publicKey: credential.publicKey || `simulated-public-key:${credentialId}`,
      transports: Array.isArray(credential.transports) ? credential.transports : ["usb", "nfc"],
      attestation: {
        format: credential.attestationFormat || "local-simulator",
        trustPath: "dev-only"
      },
      signCounter: Number(credential.signCounter || 0),
      status: "active",
      createdAt: isoNow(),
      lastUsedAt: null
    };
    this.credentials.set(record.id, record);
    this.#recordAudit({
      actorId: admin.id,
      action: "auth.credential_enrolled",
      resourceId: record.id,
      correlationId: corr,
      newValue: {
        credentialId: record.id,
        transports: record.transports,
        attestationFormat: record.attestation.format,
        status: record.status
      }
    });
    return { credential: this.#publicCredential(record) };
  }

  createLoginOptions({ email, password, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const admin = this.#validatePassword({ email, password });
    const credentials = this.#activeCredentialsForAdmin(admin.id);
    if (credentials.length === 0) {
      throw new AppError("credential_required", "No active WebAuthn credential enrolled", 409, { email });
    }
    const challenge = this.#createChallenge({ admin, purpose: "login", correlationId: corr });
    this.#recordAudit({
      actorId: admin.id,
      action: "auth.challenge_issued",
      resourceId: challenge.id,
      correlationId: corr,
      newValue: { purpose: challenge.purpose, email: admin.email, expiresAt: challenge.expiresAt }
    });
    return {
      challenge: {
        ...publicChallenge(challenge),
        publicKey: {
          ...publicChallenge(challenge).publicKey,
          allowCredentials: credentials.map((credential) => ({
            id: credential.id,
            type: "public-key",
            transports: credential.transports
          }))
        }
      },
      devSimulator: {
        mode: "local_webauthn_simulator",
        signatureFormat: "simulated:<challengeId>:<credentialId>"
      }
    };
  }

  verifyLogin({ challengeId, credentialId, assertion = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const challenge = this.#consumeChallenge({ challengeId, purpose: "login", correlationId: corr });
    const admin = this.admins.get(challenge.email);
    const credential = this.#verifyCredentialAssertion({
      admin,
      challengeId,
      credentialId,
      assertion,
      correlationId: corr
    });
    const session = this.#createSession({ admin, authMethod: "webauthn", credentialId: credential.id });
    this.#recordAudit({
      actorId: admin.id,
      action: "auth.session_created",
      resourceId: session.id,
      correlationId: corr,
      newValue: {
        email: admin.email,
        role: admin.role,
        authMethod: session.authMethod,
        credentialId: credential.id,
        expiresAt: session.expiresAt
      }
    });
    return session;
  }

  createStepUpOptions({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const admin = this.#adminById(actor.id);
    const credentials = this.#activeCredentialsForAdmin(admin.id);
    if (credentials.length === 0) {
      throw new AppError("credential_required", "No active WebAuthn credential enrolled", 409, { adminId: admin.id });
    }
    const challenge = this.#createChallenge({ admin, purpose: "step_up", sessionId: actor.sessionId, correlationId: corr });
    this.#recordAudit({
      actorId: admin.id,
      action: "auth.challenge_issued",
      resourceId: challenge.id,
      correlationId: corr,
      newValue: { purpose: challenge.purpose, sessionId: actor.sessionId, expiresAt: challenge.expiresAt }
    });
    return {
      challenge: {
        ...publicChallenge(challenge),
        publicKey: {
          ...publicChallenge(challenge).publicKey,
          allowCredentials: credentials.map((credential) => ({
            id: credential.id,
            type: "public-key",
            transports: credential.transports
          }))
        }
      },
      devSimulator: {
        mode: "local_webauthn_simulator",
        signatureFormat: "simulated:<challengeId>:<credentialId>"
      }
    };
  }

  verifyStepUp({ actor, challengeId, credentialId, assertion = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const challenge = this.#consumeChallenge({
      challengeId,
      purpose: "step_up",
      actor,
      correlationId: corr
    });
    const admin = this.#adminById(actor.id);
    const credential = this.#verifyCredentialAssertion({
      admin,
      challengeId,
      credentialId,
      assertion,
      correlationId: corr
    });
    const session = this.#sessionByActor(actor);
    const updated = {
      ...session,
      lastFido2At: isoNow(),
      stepUpValidUntil: futureIso(this.stepUpTtlMs),
      updatedAt: isoNow()
    };
    this.sessions.set(updated.token, updated);
    this.#recordAudit({
      actorId: admin.id,
      action: "auth.step_up_completed",
      resourceId: updated.id,
      correlationId: corr,
      newValue: {
        credentialId: credential.id,
        stepUpValidUntil: updated.stepUpValidUntil
      }
    });
    return this.#publicSession(updated);
  }

  requireFreshStepUp(actor, action, { correlationId, resourceType = RESOURCE_TYPES.SESSION, resourceId = action } = {}) {
    const stepUpValidUntil = actor?.stepUpValidUntil ? Date.parse(actor.stepUpValidUntil) : 0;
    const fresh = stepUpValidUntil > nowMs();
    if (fresh) {
      return true;
    }
    this.audit.record({
      actorId: actor?.id,
      action: "auth.step_up_required",
      resourceType,
      resourceId,
      correlationId,
      policyDecision: "deny",
      result: "denied",
      newValue: {
        action,
        sessionId: actor?.sessionId,
        stepUpValidUntil: actor?.stepUpValidUntil || null,
        requiredFreshness: "fresh_fido2_step_up",
        stepUpEndpoint: "/auth/step-up/options"
      }
    });
    throw new AppError("step_up_required", "Fresh FIDO2 step-up is required", 403, {
      action,
      sessionId: actor?.sessionId,
      stepUpValidUntil: actor?.stepUpValidUntil || null,
      requiredFreshness: "fresh_fido2_step_up",
      stepUpEndpoint: "/auth/step-up/options"
    });
  }

  sessionFromActor(actor) {
    return this.#publicSession(this.#sessionByActor(actor));
  }

  logout({ actor, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const session = this.#sessionByActor(actor);
    this.sessions.delete(session.token);
    this.#recordAudit({
      actorId: actor.id,
      action: "auth.logout",
      resourceId: session.id,
      correlationId: corr,
      result: "success",
      newValue: { sessionId: session.id }
    });
    return { ok: true };
  }

  actorFromToken(token) {
    const session = this.sessions.get(token);
    if (!session) {
      throw new AppError("unauthenticated", "Missing or invalid session", 401);
    }
    if (session.expiresAt && Date.parse(session.expiresAt) <= nowMs()) {
      this.sessions.delete(token);
      this.#recordAudit({
        actorId: session.adminId,
        action: "auth.session_expired",
        resourceId: session.id,
        result: "denied",
        policyDecision: "deny",
        newValue: { sessionId: session.id, expiresAt: session.expiresAt }
      });
      throw new AppError("session_expired", "Session expired", 401);
    }
    return {
      id: session.adminId,
      email: session.email,
      role: session.role,
      sessionId: session.id,
      stepUpValidUntil: session.stepUpValidUntil || null
    };
  }

  #validatePassword({ email, password }) {
    const admin = this.admins.get(email);
    if (!admin || admin.locked || admin.passwordHash !== hashSecret(password)) {
      this.#recordAudit({
        actorId: admin?.id || "unknown",
        action: "auth.challenge_failed",
        resourceId: email,
        policyDecision: "deny",
        result: "denied",
        newValue: { email, reason: "invalid_password" }
      });
      throw new AppError("invalid_credentials", "Invalid credentials", 401);
    }
    return admin;
  }

  #createChallenge({ admin, purpose, sessionId = null }) {
    const raw = randomBytes(32).toString("base64url");
    const challenge = {
      id: newId("challenge"),
      purpose,
      email: admin.email,
      adminId: admin.id,
      sessionId,
      publicChallenge: raw,
      challengeHash: challengeHash(raw),
      ttlMs: this.challengeTtlMs,
      expiresAt: futureIso(this.challengeTtlMs),
      attempts: 0,
      consumedAt: null,
      createdAt: isoNow()
    };
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  #consumeChallenge({ challengeId, purpose, actor = null, correlationId }) {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.purpose !== purpose) {
      this.#recordAudit({
        actorId: actor?.id || "unknown",
        action: "auth.challenge_failed",
        resourceId: challengeId,
        correlationId,
        policyDecision: "deny",
        result: "denied",
        newValue: { purpose, reason: "not_found_or_wrong_purpose" }
      });
      throw new AppError("invalid_challenge", "Invalid challenge", 401);
    }
    if (challenge.consumedAt) {
      this.#recordAudit({
        actorId: actor?.id || challenge.adminId,
        action: "auth.challenge_replayed",
        resourceId: challenge.id,
        correlationId,
        policyDecision: "deny",
        result: "denied",
        newValue: { purpose: challenge.purpose, consumedAt: challenge.consumedAt }
      });
      throw new AppError("challenge_replayed", "Challenge already used", 401);
    }
    if (Date.parse(challenge.expiresAt) <= nowMs()) {
      this.#recordAudit({
        actorId: actor?.id || challenge.adminId,
        action: "auth.challenge_failed",
        resourceId: challenge.id,
        correlationId,
        policyDecision: "deny",
        result: "denied",
        newValue: { purpose: challenge.purpose, reason: "expired", expiresAt: challenge.expiresAt }
      });
      throw new AppError("challenge_expired", "Challenge expired", 401);
    }
    if (actor && (challenge.adminId !== actor.id || challenge.sessionId !== actor.sessionId)) {
      this.#recordAudit({
        actorId: actor.id,
        action: "auth.challenge_failed",
        resourceId: challenge.id,
        correlationId,
        policyDecision: "deny",
        result: "denied",
        newValue: { purpose: challenge.purpose, reason: "wrong_actor" }
      });
      throw new AppError("invalid_challenge_actor", "Challenge does not belong to this session", 403);
    }
    const consumed = { ...challenge, attempts: challenge.attempts + 1, consumedAt: isoNow() };
    this.challenges.set(consumed.id, consumed);
    this.#recordAudit({
      actorId: actor?.id || challenge.adminId,
      action: "auth.challenge_verified",
      resourceId: challenge.id,
      correlationId,
      newValue: { purpose: challenge.purpose }
    });
    return consumed;
  }

  #verifyCredentialAssertion({ admin, challengeId, credentialId, assertion, correlationId }) {
    const credential = this.credentials.get(credentialId);
    if (!credential || credential.adminId !== admin.id || credential.status !== "active") {
      this.#recordAudit({
        actorId: admin.id,
        action: "auth.challenge_failed",
        resourceId: challengeId,
        correlationId,
        policyDecision: "deny",
        result: "denied",
        newValue: { reason: "invalid_credential", credentialId }
      });
      throw new AppError("invalid_credential", "Invalid credential", 401);
    }
    const expected = `simulated:${challengeId}:${credentialId}`;
    if (assertion.signature !== expected) {
      this.#recordAudit({
        actorId: admin.id,
        action: "auth.challenge_failed",
        resourceId: challengeId,
        correlationId,
        policyDecision: "deny",
        result: "denied",
        newValue: { reason: "invalid_signature", credentialId }
      });
      throw new AppError("invalid_assertion", "Invalid WebAuthn assertion", 401);
    }
    const nextCounter = Number(assertion.signCounter || credential.signCounter + 1);
    const updated = {
      ...credential,
      signCounter: Math.max(nextCounter, credential.signCounter + 1),
      lastUsedAt: isoNow()
    };
    this.credentials.set(updated.id, updated);
    return updated;
  }

  #createSession({ admin, authMethod, credentialId }) {
    const token = randomBytes(32).toString("hex");
    const session = {
      id: newId("session"),
      token,
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      authMethod,
      credentialId,
      createdAt: isoNow(),
      expiresAt: futureIso(this.sessionTtlMs),
      lastFido2At: isoNow(),
      stepUpValidUntil: futureIso(this.stepUpTtlMs)
    };
    this.sessions.set(token, session);
    return session;
  }

  #sessionByActor(actor) {
    const session = [...this.sessions.values()].find((item) => item.id === actor.sessionId && item.adminId === actor.id);
    if (!session) {
      throw new AppError("unauthenticated", "Missing or invalid session", 401);
    }
    return session;
  }

  #adminById(adminId) {
    const admin = [...this.admins.values()].find((item) => item.id === adminId);
    if (!admin) {
      throw new AppError("not_found", "Admin not found", 404, { adminId });
    }
    return admin;
  }

  #activeCredentialsForAdmin(adminId) {
    return [...this.credentials.values()].filter((credential) => credential.adminId === adminId && credential.status === "active");
  }

  #publicCredential(credential) {
    return {
      id: credential.id,
      adminId: credential.adminId,
      transports: credential.transports,
      attestation: credential.attestation,
      signCounter: credential.signCounter,
      status: credential.status,
      createdAt: credential.createdAt,
      lastUsedAt: credential.lastUsedAt
    };
  }

  #publicSession(session) {
    return {
      id: session.id,
      adminId: session.adminId,
      email: session.email,
      role: session.role,
      authMethod: session.authMethod || "legacy_password_fido_flag",
      createdAt: session.createdAt,
      expiresAt: session.expiresAt || null,
      lastFido2At: session.lastFido2At || null,
      stepUpValidUntil: session.stepUpValidUntil || null
    };
  }

  #recordAudit({ actorId, action, resourceId, correlationId, policyDecision = "allow", result = "success", newValue = {} }) {
    this.audit.record({
      actorId,
      action,
      resourceType: RESOURCE_TYPES.SESSION,
      resourceId,
      correlationId,
      policyDecision,
      result,
      newValue
    });
  }
}
