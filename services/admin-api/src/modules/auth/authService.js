import { createHash, randomBytes } from "node:crypto";
import { ROLES, RESOURCE_TYPES } from "../../domain/constants.js";
import { AppError } from "../../lib/errors.js";
import { newId } from "../../lib/id.js";

function hashSecret(value) {
  return createHash("sha256").update(value).digest("hex");
}

export class AuthService {
  constructor({ audit }) {
    this.audit = audit;
    this.admins = new Map();
    this.sessions = new Map();
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

  actorFromToken(token) {
    const session = this.sessions.get(token);
    if (!session) {
      throw new AppError("unauthenticated", "Missing or invalid session", 401);
    }
    return {
      id: session.adminId,
      email: session.email,
      role: session.role,
      sessionId: session.id
    };
  }
}
