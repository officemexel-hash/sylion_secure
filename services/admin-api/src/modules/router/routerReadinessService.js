import { DEVICE_TYPES, RESOURCE_TYPES } from "../../domain/constants.js";
import { notFound, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const PULI_AX_MODEL = "GL.iNet GL-XE3000 Puli AX";
const REQUIRED_POSTURE = Object.freeze([
  ["model", "Puli AX hardware model"],
  ["firmwareVersion", "OpenWrt 23.05+ firmware"],
  ["strongSwanInstalled", "strongSwan IKEv2 installed"],
  ["nftablesKillSwitch", "nftables default-drop kill switch"],
  ["dnsTunnelOnly", "DNS only through tunnel"],
  ["wanAdminDisabled", "WAN admin disabled"],
  ["sshKeyAuthOnly", "SSH key authentication only"],
  ["lanWanBypassBlocked", "LAN-to-WAN bypass blocked"],
  ["signedFirmwareVerified", "Signed firmware verified"],
  ["packageInstalled", "SYLION router package installed"]
]);
const PULI_AX_INTERNAL_DNS_HOSTS = Object.freeze([
  "operator.sylion.internal",
  "session.sylion.internal",
  "admin.sylion.internal",
  "duckduckgo.sylion.internal",
  "libreoffice.sylion.internal",
  "whatsapp.sylion.internal",
  "telegram.sylion.internal",
  "threema.sylion.internal",
  "signal.sylion.internal",
  "zangi.sylion.internal",
  "exodus.sylion.internal",
  "simplex.sylion.internal",
  "protonmail.sylion.internal"
]);

function isoNow() {
  return new Date().toISOString();
}

function rejectSecrets(value, path = "payload") {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (/-----BEGIN|private[_ -]?key|api[_ -]?key|password|secret|token|seed|mnemonic/i.test(value)) {
      throw validationError("Router package payload must not contain secrets", { field: path });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecrets(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const nestedPath = `${path}.${key}`;
      if (/private.*key|api.*key|password|secret|token|seed|mnemonic/i.test(key)) {
        throw validationError("Router package payload must not contain secrets", { field: nestedPath });
      }
      rejectSecrets(nested, nestedPath);
    }
  }
}

function publicPackage(record) {
  return {
    ...record,
    manifest: {
      ...record.manifest,
      secretsIncluded: false
    }
  };
}

function packageIpsecProfiles(operatorId) {
  return [
    {
      id: "T0",
      name: "terminal-or-puli-to-g1",
      from: "terminal_or_puli_ax",
      to: "g1",
      protocol: "ipsec_ikev2",
      authentication: "mutual_certificate",
      cryptoProfile: "aes256gcm16-prfsha384-ecp384_planned",
      certRef: `cert-ref://${operatorId}/terminal-or-router-to-g1`,
      privateKeyMaterialIncluded: false
    },
    {
      id: "T1",
      name: "g1-to-g2",
      from: "g1",
      to: "g2",
      protocol: "ipsec_ikev2",
      authentication: "mutual_certificate",
      cryptoProfile: "aes256gcm16-prfsha384-ecp384_planned",
      certRef: `cert-ref://${operatorId}/g1-to-g2`,
      privateKeyMaterialIncluded: false
    },
    {
      id: "T2",
      name: "g2-to-workload",
      from: "g2",
      to: "workload",
      protocol: "ipsec_ikev2",
      authentication: "mutual_certificate",
      cryptoProfile: "aes256gcm16-prfsha384-ecp384_planned",
      certRef: `cert-ref://${operatorId}/g2-to-workload`,
      privateKeyMaterialIncluded: false
    }
  ];
}

export class RouterReadinessService {
  constructor({ audit, rbac, operators, devices, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.operators = operators;
    this.devices = devices;
    this.packages = new PersistentMap({ store, collection: "router_packages" });
    this.postures = new PersistentMap({ store, collection: "router_postures" });
  }

  generatePackage({ actor, operatorId, routerDeviceId = null, firmwareTarget = "openwrt-23.05+", packageVersion = "step3.30-readiness", evidenceRefs = [], correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "router.package.manage", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.ROUTER_PACKAGE
    });
    const operator = this.#requireOperator(operatorId);
    rejectSecrets({ firmwareTarget, packageVersion, evidenceRefs });
    const router = routerDeviceId ? this.#requireRouterDevice(routerDeviceId, operatorId) : this.#latestRouter(operatorId);
    const record = {
      id: newId("router_pkg"),
      operatorId,
      tenantId: operator.tenantId,
      routerDeviceId: router?.id || null,
      model: PULI_AX_MODEL,
      status: router ? "ready_for_router_install" : "draft_router_device_pending",
      installState: "physical_install_pending",
      firmwareTarget,
      packageVersion,
      manifest: {
        targetHardware: PULI_AX_MODEL,
        firmwareBaseline: firmwareTarget,
        packages: ["strongswan-full", "strongswan-mod-openssl", "nftables", "dnsmasq-full", "ca-bundle"],
        removedOrDisabledServices: ["wan_admin", "upnp", "password_ssh", "lan_to_wan_bypass"],
        controls: {
          killSwitch: "nftables_default_drop_loaded_before_vpn",
          dnsPolicy: "dns_forwarding_through_tunnel_only",
          internalDns: {
            resolver: "10.42.0.11",
            staticHostTarget: "10.42.0.12",
            requiredHosts: PULI_AX_INTERNAL_DNS_HOSTS
          },
          wanAdmin: "disabled",
          ssh: "key_auth_only",
          ipForwarding: "only_policy_routes_to_g1",
          configDrift: "report_only_until_physical_router"
        },
        ipsecProfiles: packageIpsecProfiles(operatorId),
        secretsIncluded: false,
        privateKeyMaterialIncluded: false
      },
      blockers: [
        "physical_router_install_pending",
        "hsm_or_secure_element_certificate_required",
        "dns_leak_test_required",
        "kill_switch_failure_test_required",
        "signed_firmware_reproducibility_evidence_required"
      ],
      evidenceRefs,
      sideEffectAllowed: false,
      productionExecutionAllowed: false,
      createdAt: isoNow(),
      createdBy: actor.id
    };
    this.packages.set(record.id, record);
    this.audit.record({
      actorId: actor.id,
      action: "router.package_generated",
      resourceType: RESOURCE_TYPES.ROUTER_PACKAGE,
      resourceId: record.id,
      tenantId: operator.tenantId,
      operatorId,
      correlationId: corr,
      policyDecision: "allow",
      result: record.status,
      newValue: publicPackage(record)
    });
    return publicPackage(record);
  }

  listPackages({ actor, operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "router.package.read", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.ROUTER_PACKAGE
    });
    return [...this.packages.values()]
      .filter((record) => !operatorId || record.operatorId === operatorId)
      .map(publicPackage);
  }

  latestPackageForOperator(operatorId) {
    return [...this.packages.values()].filter((record) => record.operatorId === operatorId).at(-1) || null;
  }

  validatePosture({ actor, operatorId, packageId = null, routerDeviceId = null, evidence = {}, evidenceRefs = [], correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "router.package.manage", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.ROUTER_POSTURE
    });
    const operator = this.#requireOperator(operatorId);
    rejectSecrets({ evidence, evidenceRefs });
    const pkg = packageId ? this.#requirePackage(packageId, operatorId) : this.latestPackageForOperator(operatorId);
    const router = routerDeviceId ? this.#requireRouterDevice(routerDeviceId, operatorId) : this.#latestRouter(operatorId);
    const checks = REQUIRED_POSTURE.map(([key, label]) => {
      const passed = key === "model"
        ? String(evidence.model || router?.model || "").includes("GL-XE3000") || String(evidence.model || router?.model || "").includes("Puli AX")
        : key === "firmwareVersion"
          ? /openwrt|23\.05|24\./i.test(String(evidence.firmwareVersion || router?.firmwareVersion || ""))
          : evidence[key] === true;
      return { key, label, status: passed ? "passed" : "blocked" };
    });
    const blockers = checks.filter((check) => check.status !== "passed").map((check) => `${check.key}_required`);
    if (!pkg) blockers.push("router_package_required");
    if (!router) blockers.push("puli_ax_device_required");
    const posture = {
      id: newId("router_posture"),
      operatorId,
      tenantId: operator.tenantId,
      packageId: pkg?.id || null,
      routerDeviceId: router?.id || null,
      model: evidence.model || router?.model || PULI_AX_MODEL,
      status: blockers.length ? "blocked" : "validated_for_physical_smoke",
      checks,
      blockers,
      evidenceRefs,
      sideEffectAllowed: false,
      productionExecutionAllowed: false,
      validatedAt: isoNow(),
      validatedBy: actor.id
    };
    this.postures.set(posture.id, posture);
    this.audit.record({
      actorId: actor.id,
      action: "router.posture_validated",
      resourceType: RESOURCE_TYPES.ROUTER_POSTURE,
      resourceId: posture.id,
      tenantId: operator.tenantId,
      operatorId,
      correlationId: corr,
      policyDecision: blockers.length ? "deny" : "allow",
      result: posture.status,
      newValue: posture
    });
    return posture;
  }

  listPostures({ actor, operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "router.package.read", {
      operatorId,
      correlationId: corr,
      resourceType: RESOURCE_TYPES.ROUTER_POSTURE
    });
    return [...this.postures.values()].filter((record) => !operatorId || record.operatorId === operatorId);
  }

  latestPostureForOperator(operatorId) {
    return [...this.postures.values()].filter((record) => record.operatorId === operatorId).at(-1) || null;
  }

  readinessForOperator(operatorId) {
    const pkg = this.latestPackageForOperator(operatorId);
    const posture = this.latestPostureForOperator(operatorId);
    const router = this.#latestRouter(operatorId);
    return {
      packageStatus: pkg?.status || "not_generated",
      packageId: pkg?.id || null,
      routerDeviceId: router?.id || null,
      postureStatus: posture?.status || "not_validated",
      blockers: [
        ...(pkg?.blockers || ["router_package_required"]),
        ...(posture?.blockers || ["router_posture_validation_required"])
      ],
      readyForPhysicalSmoke: Boolean(pkg && posture?.status === "validated_for_physical_smoke"),
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    };
  }

  #requireOperator(operatorId) {
    const operator = this.operators.get(operatorId);
    if (!operator) throw notFound("operator", operatorId);
    return operator;
  }

  #requireRouterDevice(deviceId, operatorId) {
    const device = this.devices.get(deviceId);
    if (!device) throw notFound("device", deviceId);
    if (device.type !== DEVICE_TYPES.ROUTER) {
      throw validationError("Router package requires a Puli AX router device", { deviceId, type: device.type });
    }
    if (device.assignedOperatorId !== operatorId) {
      throw validationError("Router device is not assigned to this operator", { deviceId, operatorId });
    }
    return device;
  }

  #requirePackage(packageId, operatorId) {
    const pkg = this.packages.get(packageId);
    if (!pkg) throw notFound("router_package", packageId);
    if (pkg.operatorId !== operatorId) {
      throw validationError("Router package does not match requested operator", { packageId, operatorId });
    }
    return pkg;
  }

  #latestRouter(operatorId) {
    return this.devices.listForOperatorScoped(operatorId).filter((device) => device.type === DEVICE_TYPES.ROUTER).at(-1) || null;
  }
}
