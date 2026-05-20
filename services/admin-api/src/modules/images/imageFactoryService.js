import { createHash } from "node:crypto";
import { DEVICE_TYPES } from "../../domain/constants.js";
import { validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";

const ARTIFACT_TYPES = new Set([
  "pixel_grapheneos_profile",
  "puli_ax_router_config",
  "workload_image",
  "microvm_template"
]);

function requireText(value, field) {
  if (!value || typeof value !== "string" || value.trim().length < 2) {
    throw validationError(`${field} is required`, { field });
  }
  return value.trim();
}

function assertNoSecrets(value, path = "input") {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const currentPath = `${path}.${key}`;
    if (/secret|password|seed|private.*key|plaintext|token/i.test(key)) {
      throw validationError("Image artifacts must not contain plaintext secrets", { field: currentPath });
    }
    assertNoSecrets(nested, currentPath);
  }
}

function artifactHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class ImageFactoryService {
  constructor({ audit, rbac, devices = null, appCatalog = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.devices = devices;
    this.appCatalog = appCatalog;
    this.artifacts = new Map();
  }

  build({ actor, artifactType, operatorId, tenantId = null, sourceRef, policy = {}, certificateRef = null, deviceId = null, appId = null, version = "0.1.0", correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "image.artifact.build", { tenantId, operatorId, correlationId: corr });
    if (!ARTIFACT_TYPES.has(artifactType)) {
      throw validationError("Unsupported artifact type", { artifactType, supported: [...ARTIFACT_TYPES] });
    }
    assertNoSecrets({ policy, sourceRef, certificateRef });

    if (deviceId && this.devices) {
      const device = this.devices.get(deviceId);
      if (!device) {
        throw validationError("Device for artifact was not found", { deviceId });
      }
      if (artifactType === "pixel_grapheneos_profile" && device.type !== DEVICE_TYPES.PIXEL) {
        throw validationError("Pixel profile artifact requires a Pixel/GrapheneOS device", { deviceId });
      }
      if (artifactType === "puli_ax_router_config" && device.type !== DEVICE_TYPES.ROUTER) {
        throw validationError("Router config artifact requires a Puli AX router device", { deviceId });
      }
    }
    if (appId && this.appCatalog && !this.appCatalog.get(appId)) {
      throw validationError("Authorized app for artifact was not found", { appId });
    }

    const unsigned = {
      artifactType,
      operatorId,
      tenantId,
      sourceRef: requireText(sourceRef, "sourceRef"),
      policy,
      certificateRef,
      deviceId,
      appId,
      version
    };
    const digest = artifactHash(unsigned);
    const artifact = {
      id: newId("artifact"),
      ...unsigned,
      digest,
      signatureRef: `signature://admin-api/${digest}`,
      status: "published",
      containsPlaintextSecrets: false,
      createdAt: new Date().toISOString()
    };
    this.artifacts.set(artifact.id, artifact);
    this.audit.record({
      actorId: actor.id,
      action: "image_artifact.built",
      resourceType: "image_artifact",
      resourceId: artifact.id,
      tenantId,
      operatorId,
      correlationId: corr,
      newValue: artifact
    });
    return artifact;
  }

  list({ actor, operatorId = null, artifactType = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "image.artifact.read", { operatorId, correlationId: corr });
    return [...this.artifacts.values()].filter((artifact) => {
      return (!operatorId || artifact.operatorId === operatorId)
        && (!artifactType || artifact.artifactType === artifactType);
    });
  }

  get(id) {
    return this.artifacts.get(id);
  }
}

