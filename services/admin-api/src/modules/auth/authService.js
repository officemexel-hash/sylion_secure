import { createHash, randomBytes } from "node:crypto";
import { ROLES, RESOURCE_TYPES } from "../../domain/constants.js";
import { AppError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";
import { createWebAuthnVerifier } from "./webauthnVerifier.js";
import { publicAuthPolicyMatrix } from "./authPolicy.js";

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

function publicChallenge(challenge, { rpId = "localhost" } = {}) {
  return {
    id: challenge.id,
    purpose: challenge.purpose,
    email: challenge.email,
    expiresAt: challenge.expiresAt,
    publicKey: {
      challenge: challenge.publicChallenge,
      timeout: challenge.ttlMs,
      rpId,
      userVerification: "required"
    }
  };
}

export class AuthService {
  #credentialsByAdmin = new Map();

  constructor({
    audit,
    store = null,
    challengeTtlMs = 120_000,
    sessionTtlMs = 12 * 60 * 60 * 1000,
    stepUpTtlMs = 15 * 60 * 1000,
    lockoutThreshold = 5,
    lockoutTtlMs = 15 * 60 * 1000,
    webAuthnVerifier = null,
    webAuthnVerifierOptions = {}
  }) {
    this.audit = audit;
    this.challengeTtlMs = challengeTtlMs;
    this.sessionTtlMs = sessionTtlMs;
    this.stepUpTtlMs = stepUpTtlMs;
    this.lockoutThreshold = lockoutThreshold;
    this.lockoutTtlMs = lockoutTtlMs;
    this.webAuthnRpId = webAuthnVerifierOptions.rpId || "localhost";
    this.webAuthnVerifier =
      webAuthnVerifier ||
      createWebAuthnVerifier({
        rpId: this.webAuthnRpId,
        ...webAuthnVerifierOptions
      });
    this.admins = new PersistentMap({ store, collection: "auth_admins" });
    this.sessions = new PersistentMap({ store, collection: "auth_sessions" });
    this.challenges = new PersistentMap({ store, collection: "auth_challenges" });
    this.credentials = new PersistentMap({ store, collection: "auth_credentials" });
    for (const credential of this.credentials.values()) {
      this.#indexCredential(credential);
    }
    this.failedAttempts = new PersistentMap({ store, collection: "auth_failed_attempts" });
    this.recoveryRequests = new PersistentMap({ store, collection: "auth_recovery_requests" });
    this.breakGlassRequests = new PersistentMap({ store, collection: "auth_break_glass_requests" });
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
    if (admin) {
      this.#assertNotLocked(admin, { correlationId });
    }
    const valid =
      Boolean(admin) && admin.passwordHash === hashSecret(password) && fido2Verified === true;

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
      this.#recordFailedAttempt({ admin, email, reason: "legacy_login_failure", correlationId });
      throw new AppError("invalid_credentials", "Invalid credentials or FIDO2 verification", 401);
    }

    this.#releaseLockout(admin, { correlationId });

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
    const admin = this.#validatePassword({ email, password, correlationId: corr });
    const challenge = this.#createChallenge({ admin, purpose: "enrollment", correlationId: corr });
    this.#recordAudit({
      actorId: admin.id,
      action: "auth.challenge_issued",
      resourceId: challenge.id,
      correlationId: corr,
      newValue: { purpose: challenge.purpose, email: admin.email, expiresAt: challenge.expiresAt }
    });
    return {
      challenge: publicChallenge(challenge, { rpId: this.webAuthnRpId }),
      user: { id: admin.id, email: admin.email },
      devSimulator: {
        mode: "local_webauthn_simulator",
        verifyEndpoint: "/auth/webauthn/enrollment/verify",
        production: false
      }
    };
  }

  verifyEnrollment({ challengeId, credential = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const challenge = this.#consumeChallenge({
      challengeId,
      purpose: "enrollment",
      correlationId: corr
    });
    const admin = this.admins.get(challenge.email);
    this.#assertNotLocked(admin, { correlationId: corr });
    const credentialId = credential.id || credential.rawId || newId("cred");
    const record = {
      id: credentialId,
      adminId: admin.id,
      email: admin.email,
      publicKey: credential.publicKey || `simulated-public-key:${credentialId}`,
      transports: Array.isArray(credential.transports) ? credential.transports : ["usb", "nfc"],
      attestation: {
        format:
          credential.attestationFormat ||
          credential.response?.attestationFormat ||
          "local-simulator",
        trustPath: credential.mode === "browser" ? "human-gate-required" : "dev-only",
        mode: credential.mode || "local_simulator"
      },
      signCounter: Number(credential.signCounter || 0),
      status: "active",
      createdAt: isoNow(),
      lastUsedAt: null
    };
    this.credentials.set(record.id, record);
    this.#indexCredential(record);
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
    const admin = this.#validatePassword({ email, password, correlationId: corr });
    const credentials = this.#activeCredentialsForAdmin(admin.id);
    if (credentials.length === 0) {
      throw new AppError("credential_required", "No active WebAuthn credential enrolled", 409, {
        email
      });
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
        ...publicChallenge(challenge, { rpId: this.webAuthnRpId }),
        publicKey: {
          ...publicChallenge(challenge, { rpId: this.webAuthnRpId }).publicKey,
          allowCredentials: credentials.map((credential) => ({
            id: credential.id,
            type: "public-key",
            transports: credential.transports
          }))
        }
      },
      devSimulator: {
        mode: "local_webauthn_simulator",
        signatureFormat: "simulated:<challengeId>:<credentialId>",
        production: false
      }
    };
  }

  verifyLogin({ challengeId, credentialId, assertion = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const challenge = this.#consumeChallenge({
      challengeId,
      purpose: "login",
      correlationId: corr
    });
    const admin = this.admins.get(challenge.email);
    this.#assertNotLocked(admin, { correlationId: corr });
    const credential = this.#verifyCredentialAssertion({
      admin,
      challengeId,
      credentialId,
      assertion,
      correlationId: corr
    });
    const session = this.#createSession({
      admin,
      authMethod: "webauthn",
      credentialId: credential.id
    });
    this.#releaseLockout(admin, { correlationId: corr });
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
    this.#assertNotLocked(admin, { correlationId: corr });
    const credentials = this.#activeCredentialsForAdmin(admin.id);
    if (credentials.length === 0) {
      throw new AppError("credential_required", "No active WebAuthn credential enrolled", 409, {
        adminId: admin.id
      });
    }
    const challenge = this.#createChallenge({
      admin,
      purpose: "step_up",
      sessionId: actor.sessionId,
      correlationId: corr
    });
    this.#recordAudit({
      actorId: admin.id,
      action: "auth.challenge_issued",
      resourceId: challenge.id,
      correlationId: corr,
      newValue: {
        purpose: challenge.purpose,
        sessionId: actor.sessionId,
        expiresAt: challenge.expiresAt
      }
    });
    return {
      challenge: {
        ...publicChallenge(challenge, { rpId: this.webAuthnRpId }),
        publicKey: {
          ...publicChallenge(challenge, { rpId: this.webAuthnRpId }).publicKey,
          allowCredentials: credentials.map((credential) => ({
            id: credential.id,
            type: "public-key",
            transports: credential.transports
          }))
        }
      },
      devSimulator: {
        mode: "local_webauthn_simulator",
        signatureFormat: "simulated:<challengeId>:<credentialId>",
        production: false
      }
    };
  }

  verifyStepUp({ actor, challengeId, credentialId, assertion = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.#consumeChallenge({
      challengeId,
      purpose: "step_up",
      actor,
      correlationId: corr
    });
    const admin = this.#adminById(actor.id);
    this.#assertNotLocked(admin, { correlationId: corr });
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

  createRecoveryRequest({
    email,
    reasonCode = "admin_access_recovery",
    requester = {},
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    const admin = this.admins.get(email);
    const request = {
      id: newId("recovery"),
      status: "pending",
      reasonCode,
      affectedAdminId: admin?.id || null,
      affectedEmail: email,
      requester: {
        actorId: requester.actorId || "unauthenticated",
        sessionId: requester.sessionId || null,
        note: requester.note || null
      },
      createdAt: isoNow(),
      updatedAt: null
    };
    this.recoveryRequests.set(request.id, request);
    this.#recordAudit({
      actorId: request.requester.actorId,
      action: "auth.recovery_started",
      resourceId: request.id,
      correlationId: corr,
      newValue: this.#publicRecoveryRequest(request)
    });
    return this.#publicRecoveryRequest(request);
  }

  listRecoveryRequests() {
    return [...this.recoveryRequests.values()].map((request) =>
      this.#publicRecoveryRequest(request)
    );
  }

  updateRecoveryStatus({ actor, requestId, status, note = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const request = this.recoveryRequests.get(requestId);
    if (!request) {
      throw new AppError("not_found", "Recovery request not found", 404, { requestId });
    }
    const allowed = new Set(["pending", "rejected", "approved_placeholder", "closed"]);
    if (!allowed.has(status)) {
      throw new AppError("validation_error", "Invalid recovery status", 422, {
        allowed: [...allowed]
      });
    }
    const updated = {
      ...request,
      status,
      note,
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.recoveryRequests.set(updated.id, updated);
    this.#recordAudit({
      actorId: actor.id,
      action: "auth.recovery_status_changed",
      resourceId: updated.id,
      correlationId: corr,
      newValue: this.#publicRecoveryRequest(updated)
    });
    return this.#publicRecoveryRequest(updated);
  }

  createBreakGlassRequest({
    actor,
    actionScope,
    reasonCode = "emergency_access_review",
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    const request = {
      id: newId("break_glass"),
      status: "pending_human_gate",
      actionScope: actionScope || "unspecified",
      reasonCode,
      requester: {
        actorId: actor.id,
        sessionId: actor.sessionId
      },
      approvalRequired: true,
      humanGateRequired: true,
      sideEffectExecuted: false,
      baselineBoundary: "SYLION_BASELINE_PLACEHOLDER_ONLY",
      phantomBoundary: "PHANTOM_V3_SEPARATE_TRACK_NOT_IMPLEMENTED",
      createdAt: isoNow()
    };
    this.breakGlassRequests.set(request.id, request);
    this.#recordAudit({
      actorId: actor.id,
      action: "auth.break_glass_requested",
      resourceId: request.id,
      correlationId: corr,
      newValue: this.#publicBreakGlassRequest(request)
    });
    this.#recordAudit({
      actorId: actor.id,
      action: "auth.break_glass_human_gate_required",
      resourceId: request.id,
      correlationId: corr,
      newValue: {
        requestId: request.id,
        humanGateRequired: true,
        sideEffectExecuted: false,
        phantomBoundary: request.phantomBoundary
      }
    });
    return this.#publicBreakGlassRequest(request);
  }

  listBreakGlassRequests() {
    return [...this.breakGlassRequests.values()].map((request) =>
      this.#publicBreakGlassRequest(request)
    );
  }

  listCredentials({ actor }) {
    const rows = [...this.credentials.values()];
    const visible =
      actor?.role === ROLES.GLOBAL_SUPER_ADMIN || actor?.role === ROLES.SECURITY_ADMIN
        ? rows
        : rows.filter((credential) => credential.adminId === actor?.id);
    return visible.map((credential) => this.#publicCredential(credential));
  }

  suspendCredential({
    actor,
    credentialId,
    reasonCode = "admin_requested_suspend",
    correlationId
  }) {
    return this.#transitionCredentialStatus({
      actor,
      credentialId,
      status: "suspended",
      reasonCode,
      auditAction: "auth.credential_suspended",
      correlationId
    });
  }

  revokeCredential({ actor, credentialId, reasonCode = "admin_requested_revoke", correlationId }) {
    return this.#transitionCredentialStatus({
      actor,
      credentialId,
      status: "revoked",
      reasonCode,
      auditAction: "auth.credential_revoked",
      correlationId
    });
  }

  authPolicyMatrix() {
    return publicAuthPolicyMatrix();
  }

  requireFreshStepUp(
    actor,
    action,
    { correlationId, resourceType = RESOURCE_TYPES.SESSION, resourceId = action } = {}
  ) {
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

  #validatePassword({ email, password, correlationId }) {
    const admin = this.admins.get(email);
    if (admin) {
      this.#assertNotLocked(admin, { correlationId });
    }
    if (!admin || admin.locked || admin.passwordHash !== hashSecret(password)) {
      this.#recordAudit({
        actorId: admin?.id || "unknown",
        action: "auth.challenge_failed",
        resourceId: email,
        correlationId,
        policyDecision: "deny",
        result: "denied",
        newValue: { email, reason: "invalid_password" }
      });
      this.#recordFailedAttempt({ admin, email, reason: "invalid_password", correlationId });
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
      throw new AppError(
        "invalid_challenge_actor",
        "Challenge does not belong to this session",
        403
      );
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
      this.#recordFailedAttempt({
        admin,
        email: admin.email,
        reason: "invalid_credential",
        correlationId
      });
      throw new AppError("invalid_credential", "Invalid credential", 401);
    }
    let verification;
    try {
      verification = this.webAuthnVerifier.verifyAssertion({
        challenge: this.challenges.get(challengeId) || { id: challengeId },
        credential,
        assertion
      });
    } catch (error) {
      this.#recordAudit({
        actorId: admin.id,
        action: "auth.challenge_failed",
        resourceId: challengeId,
        correlationId,
        policyDecision: "deny",
        result: "denied",
        newValue: {
          reason: error instanceof AppError ? error.code : "invalid_assertion",
          credentialId,
          verificationMode: assertion.mode || "local_simulator"
        }
      });
      this.#recordFailedAttempt({
        admin,
        email: admin.email,
        reason: "invalid_assertion",
        correlationId
      });
      throw error;
    }
    const nextCounter = Number(verification.signCounter || credential.signCounter + 1);
    const updated = {
      ...credential,
      signCounter: Math.max(nextCounter, credential.signCounter + 1),
      lastUsedAt: isoNow()
    };
    this.credentials.set(updated.id, updated);
    this.#indexCredential(updated);
    return updated;
  }

  #transitionCredentialStatus({
    actor,
    credentialId,
    status,
    reasonCode,
    auditAction,
    correlationId
  }) {
    const corr = requireCorrelationId(correlationId);
    const credential = this.credentials.get(credentialId);
    if (!credential) {
      throw new AppError("not_found", "Credential not found", 404, { credentialId });
    }
    const updated = {
      ...credential,
      status,
      statusReason: reasonCode,
      updatedAt: isoNow(),
      updatedBy: actor.id
    };
    this.credentials.set(updated.id, updated);
    this.#indexCredential(updated);
    this.#recordAudit({
      actorId: actor.id,
      action: auditAction,
      resourceId: updated.id,
      correlationId: corr,
      newValue: {
        credentialId: updated.id,
        adminId: updated.adminId,
        status: updated.status,
        reasonCode
      }
    });
    return this.#publicCredential(updated);
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
    const session = [...this.sessions.values()].find(
      (item) => item.id === actor.sessionId && item.adminId === actor.id
    );
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

  #indexCredential(credential) {
    let credentialIds = this.#credentialsByAdmin.get(credential.adminId);
    if (!credentialIds) {
      credentialIds = new Set();
      this.#credentialsByAdmin.set(credential.adminId, credentialIds);
    }
    credentialIds.add(credential.id);
  }

  #activeCredentialsForAdmin(adminId) {
    const credentialIds = this.#credentialsByAdmin.get(adminId);
    if (!credentialIds) {
      return [];
    }
    const active = [];
    for (const credentialId of credentialIds) {
      const credential = this.credentials.get(credentialId);
      if (credential && credential.adminId === adminId && credential.status === "active") {
        active.push(credential);
      }
    }
    return active;
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

  #assertNotLocked(admin, { correlationId } = {}) {
    if (!admin) return;
    const state = this.failedAttempts.get(admin.email);
    if (!state?.lockedUntil) return;
    if (Date.parse(state.lockedUntil) <= nowMs()) {
      this.#releaseLockout(admin, { correlationId });
      return;
    }
    throw new AppError("account_locked", "Admin account is temporarily locked", 423, {
      adminId: admin.id,
      email: admin.email,
      lockedUntil: state.lockedUntil,
      recoveryEndpoint: "/auth/recovery/request"
    });
  }

  #recordFailedAttempt({ admin, email, reason, correlationId }) {
    if (!email) return;
    const current = this.failedAttempts.get(email) || {
      email,
      adminId: admin?.id || null,
      count: 0,
      lockedUntil: null,
      lastReason: null,
      updatedAt: null
    };
    const next = {
      ...current,
      adminId: admin?.id || current.adminId,
      count: current.count + 1,
      lastReason: reason,
      updatedAt: isoNow()
    };
    if (next.count >= this.lockoutThreshold && !next.lockedUntil) {
      next.lockedUntil = futureIso(this.lockoutTtlMs);
      this.#recordAudit({
        actorId: admin?.id || "unknown",
        action: "auth.lockout_started",
        resourceId: email,
        correlationId,
        policyDecision: "deny",
        result: "denied",
        newValue: {
          email,
          adminId: admin?.id || null,
          count: next.count,
          lockedUntil: next.lockedUntil,
          reason
        }
      });
    }
    this.failedAttempts.set(email, next);
  }

  #releaseLockout(admin, { correlationId } = {}) {
    const current = this.failedAttempts.get(admin.email);
    if (!current) return;
    this.failedAttempts.delete(admin.email);
    if (current.lockedUntil) {
      this.#recordAudit({
        actorId: admin.id,
        action: "auth.lockout_released",
        resourceId: admin.email,
        correlationId,
        newValue: {
          email: admin.email,
          adminId: admin.id,
          previousLockedUntil: current.lockedUntil
        }
      });
    }
  }

  #publicRecoveryRequest(request) {
    return {
      id: request.id,
      status: request.status,
      reasonCode: request.reasonCode,
      affectedAdminId: request.affectedAdminId,
      affectedEmail: request.affectedEmail,
      requester: request.requester,
      note: request.note || null,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt || null,
      updatedBy: request.updatedBy || null,
      autoUnlock: false
    };
  }

  #publicBreakGlassRequest(request) {
    return {
      id: request.id,
      status: request.status,
      actionScope: request.actionScope,
      reasonCode: request.reasonCode,
      requester: request.requester,
      approvalRequired: request.approvalRequired,
      humanGateRequired: request.humanGateRequired,
      sideEffectExecuted: request.sideEffectExecuted,
      baselineBoundary: request.baselineBoundary,
      phantomBoundary: request.phantomBoundary,
      createdAt: request.createdAt
    };
  }

  #recordAudit({
    actorId,
    action,
    resourceId,
    correlationId,
    policyDecision = "allow",
    result = "success",
    newValue = {}
  }) {
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
