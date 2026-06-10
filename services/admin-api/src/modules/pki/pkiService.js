import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const CERTIFICATE_STATUSES = Object.freeze(["issued", "rotated", "revoked"]);
const CERTIFICATE_SUBJECT_TYPES = Object.freeze([
  "router",
  "G1",
  "G2",
  "WORKLOAD",
  "IPSEC",
  "SERVICE_IDENTITY"
]);

function requireNonEmpty(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validationError(`${field} is required`, { field });
  }
  return value.trim();
}

function assertNoPrivateKeyMaterial(value, path = "payload") {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const currentPath = `${path}.${key}`;
    if (/private.*key|key.*private|pem|secret|keyMaterial/i.test(key)) {
      throw validationError(
        "PKI module stores certificate references only; private keys are out of scope",
        {
          field: currentPath
        }
      );
    }
    assertNoPrivateKeyMaterial(nested, currentPath);
  }
}

export class PkiService {
  constructor({ audit, rbac, operators, inventory = null, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.operators = operators;
    this.inventory = inventory;
    this.certificates = new PersistentMap({ store, collection: "certificates" });
    this.serials = new Map();
    for (const cert of this.certificates.values()) {
      this.serials.set(cert.serial, cert.id);
    }
  }

  issue({
    actor,
    operatorId,
    subjectType,
    subjectRef,
    serial,
    certificateRef,
    caRef,
    notBefore,
    notAfter,
    infrastructureSetId = null,
    vpsRole = null,
    correlationId,
    ...rest
  }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "pki.certificate.issue", { operatorId, correlationId: corr });
    assertNoPrivateKeyMaterial(rest);
    const operator = this.#requireOperator(operatorId);
    this.#assertSubjectType(subjectType);

    const normalizedSerial = requireNonEmpty(serial, "serial");
    if (this.serials.has(normalizedSerial)) {
      throw validationError("Certificate serial is already tracked", { serial: normalizedSerial });
    }

    const cert = {
      id: newId("cert"),
      operatorId,
      tenantId: operator.tenantId,
      subjectType,
      subjectRef: requireNonEmpty(subjectRef, "subjectRef"),
      serial: normalizedSerial,
      certificateRef: requireNonEmpty(certificateRef, "certificateRef"),
      caRef: requireNonEmpty(caRef, "caRef"),
      status: "issued",
      lifecycleState: "issued",
      privateKeyStored: false,
      keyCustody: "external_hsm_or_secret_manager_reference",
      notBefore: notBefore || null,
      notAfter: notAfter || null,
      previousCertificateId: null,
      replacementCertificateId: null,
      revokedAt: null,
      revocationReason: null,
      createdAt: new Date().toISOString()
    };

    this.certificates.set(cert.id, cert);
    this.serials.set(cert.serial, cert.id);
    this.audit.record({
      actorId: actor.id,
      action: "pki.certificate.issued",
      resourceType: "certificate_ref",
      resourceId: cert.id,
      tenantId: cert.tenantId,
      operatorId,
      correlationId: corr,
      newValue: cert
    });

    if (this.inventory && infrastructureSetId && vpsRole) {
      this.inventory.attachCertificateReference({
        actor,
        infrastructureSetId,
        role: vpsRole,
        certRef: cert.certificateRef,
        correlationId: corr
      });
    }

    return cert;
  }

  rotate({
    actor,
    certificateId,
    serial,
    certificateRef,
    caRef,
    notBefore,
    notAfter,
    correlationId,
    ...rest
  }) {
    const corr = requireCorrelationId(correlationId);
    assertNoPrivateKeyMaterial(rest);
    const current = this.#requireCertificate(certificateId);
    this.rbac.assert(actor, "pki.certificate.rotate", {
      operatorId: current.operatorId,
      correlationId: corr
    });
    if (current.status === "revoked") {
      throw validationError("Revoked certificates cannot be rotated", { certificateId });
    }

    const nextSerial = requireNonEmpty(serial, "serial");
    if (this.serials.has(nextSerial)) {
      throw validationError("Certificate serial is already tracked", { serial: nextSerial });
    }

    const replacement = {
      ...current,
      id: newId("cert"),
      serial: nextSerial,
      certificateRef: requireNonEmpty(certificateRef, "certificateRef"),
      caRef: requireNonEmpty(caRef, "caRef"),
      status: "issued",
      lifecycleState: "issued",
      notBefore: notBefore || null,
      notAfter: notAfter || null,
      previousCertificateId: current.id,
      replacementCertificateId: null,
      revokedAt: null,
      revocationReason: null,
      createdAt: new Date().toISOString()
    };
    const rotated = {
      ...current,
      status: "rotated",
      lifecycleState: "rotated",
      replacementCertificateId: replacement.id,
      updatedAt: new Date().toISOString()
    };

    this.certificates.set(rotated.id, rotated);
    this.certificates.set(replacement.id, replacement);
    this.serials.set(replacement.serial, replacement.id);
    this.audit.record({
      actorId: actor.id,
      action: "pki.certificate.rotated",
      resourceType: "certificate_ref",
      resourceId: current.id,
      tenantId: current.tenantId,
      operatorId: current.operatorId,
      correlationId: corr,
      previousValue: current,
      newValue: { rotated, replacement }
    });

    return { rotated, replacement };
  }

  revoke({ actor, certificateId, reason, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const current = this.#requireCertificate(certificateId);
    this.rbac.assert(actor, "pki.certificate.revoke", {
      operatorId: current.operatorId,
      correlationId: corr
    });
    if (current.status === "revoked") {
      throw validationError("Certificate is already revoked", { certificateId });
    }

    const revoked = {
      ...current,
      status: "revoked",
      lifecycleState: "revoked",
      revokedAt: new Date().toISOString(),
      revocationReason: requireNonEmpty(reason, "reason"),
      updatedAt: new Date().toISOString()
    };
    this.certificates.set(certificateId, revoked);
    this.audit.record({
      actorId: actor.id,
      action: "pki.certificate.revoked",
      resourceType: "certificate_ref",
      resourceId: certificateId,
      tenantId: revoked.tenantId,
      operatorId: revoked.operatorId,
      correlationId: corr,
      previousValue: current,
      newValue: revoked
    });
    return revoked;
  }

  get(certificateId) {
    return this.certificates.get(certificateId);
  }

  listForOperator({ actor, operatorId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "pki.certificate.read", { operatorId, correlationId: corr });
    this.#requireOperator(operatorId);
    return [...this.certificates.values()].filter((cert) => cert.operatorId === operatorId);
  }

  #requireOperator(operatorId) {
    const operator = this.operators.get(operatorId);
    if (!operator) {
      throw notFound("operator", operatorId);
    }
    return operator;
  }

  #requireCertificate(certificateId) {
    const cert = this.certificates.get(certificateId);
    if (!cert) {
      throw notFound("certificate_ref", certificateId);
    }
    return cert;
  }

  #assertSubjectType(subjectType) {
    if (!CERTIFICATE_SUBJECT_TYPES.includes(subjectType)) {
      throw validationError("Invalid certificate subject type", {
        subjectType,
        allowed: CERTIFICATE_SUBJECT_TYPES
      });
    }
  }
}

export { CERTIFICATE_STATUSES, CERTIFICATE_SUBJECT_TYPES };
