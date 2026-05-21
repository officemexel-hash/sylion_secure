export class EnvSecretProvider {
  constructor({ env = process.env } = {}) {
    this.env = env;
  }

  status() {
    return {
      source: "environment",
      providers: {
        hetzner: { configured: this.hasProviderSecret("hetzner") },
        ovh: { configured: this.hasProviderSecret("ovh") }
      },
      plaintextExposed: false
    };
  }

  hasProviderSecret(providerKey) {
    return Boolean(this.#envName(providerKey) && this.env[this.#envName(providerKey)]);
  }

  getProviderToken(providerKey) {
    const envName = this.#envName(providerKey);
    return envName ? this.env[envName] : null;
  }

  #envName(providerKey) {
    const key = String(providerKey || "").toLowerCase();
    if (key === "hetzner") return "HETZNER_API_TOKEN";
    if (key === "ovh") return "OVH_API_SECRET";
    return null;
  }
}
