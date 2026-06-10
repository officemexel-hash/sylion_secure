// F-25 (ADR-vault-adapter-001, Phase A) — Vault secret provider SKELETON.
//
// This is a scaffolding-only contract that mirrors the EnvSecretProvider
// interface (status / hasProviderSecret / getProviderToken). It performs NO
// real Vault integration: every resolution path throws
// "vault_backend_not_integrated" and the provider advertises
// productionReady=false + humanGateRequired=true.
//
// Backend selection is flag-driven (SYLION_SECRET_BACKEND, default "env").
// With the flag OFF the runtime keeps using EnvSecretProvider exactly as today;
// nothing in this file is reachable unless an operator opts in to "vault", at
// which point it fails closed instead of leaking or fabricating secrets.
//
// DECISION PENDING — see ADR-vault-adapter-001 (§4 Phase A, §6 HUMAN GATE).

const NOT_INTEGRATED_REASON = "vault_backend_not_integrated";

export class VaultBackendNotIntegratedError extends Error {
  constructor(operation, detail = {}) {
    super(NOT_INTEGRATED_REASON);
    this.name = "VaultBackendNotIntegratedError";
    this.reason = NOT_INTEGRATED_REASON;
    this.operation = operation;
    this.productionReady = false;
    this.humanGateRequired = true;
    this.adr = "ADR-vault-adapter-001";
    this.detail = detail;
  }
}

export class VaultSecretProvider {
  constructor({ env = process.env, config = {} } = {}) {
    // Only reference-shaped configuration is retained. No token / credential
    // material is read or stored — the skeleton must never hold plaintext.
    this.env = env;
    this.backend = "vault";
    this.endpointReference = config.endpointReference || env.SYLION_VAULT_ADDR || null;
    this.namespaceReference = config.namespaceReference || env.SYLION_VAULT_NAMESPACE || null;
    this.productionReady = false;
    this.humanGateRequired = true;
    this.plaintextRetrievalAllowed = false;
  }

  // Mirrors EnvSecretProvider.status(): metadata only, never plaintext.
  status() {
    return {
      source: "vault",
      backend: "vault",
      integrated: false,
      reason: NOT_INTEGRATED_REASON,
      adr: "ADR-vault-adapter-001",
      productionReady: false,
      humanGateRequired: true,
      plaintextExposed: false,
      plaintextRetrievalAllowed: false,
      endpointReference: this.endpointReference || null,
      namespaceReference: this.namespaceReference || null,
      providers: {
        hetzner: { configured: false, resolvable: false },
        hetzner_robot: { configured: false, resolvable: false },
        ovh: { configured: false, resolvable: false }
      }
    };
  }

  // Mirrors EnvSecretProvider.hasProviderSecret(): without an integrated
  // backend nothing is resolvable, so report false rather than throwing — this
  // keeps gate evaluation (which only needs a boolean) fail-closed.
  hasProviderSecret() {
    return false;
  }

  // Mirrors EnvSecretProvider.getProviderToken(): MUST NOT return plaintext.
  // The skeleton fails closed instead of returning null so a misconfiguration
  // surfaces loudly rather than silently degrading to "no token".
  getProviderToken(providerKey) {
    throw new VaultBackendNotIntegratedError("getProviderToken", { providerKey });
  }
}
