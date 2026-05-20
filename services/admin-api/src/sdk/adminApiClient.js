export class AdminApiClient {
  constructor({ baseUrl, token = null, correlationIdFactory = () => `corr_${crypto.randomUUID()}` }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.correlationIdFactory = correlationIdFactory;
  }

  withToken(token) {
    return new AdminApiClient({
      baseUrl: this.baseUrl,
      token,
      correlationIdFactory: this.correlationIdFactory
    });
  }

  async request(path, { method = "GET", body, headers = {} } = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-correlation-id": this.correlationIdFactory(),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload?.error?.message || "Admin API request failed");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async login({ email, password, fido2Verified }) {
    const payload = await this.request("/auth/login", {
      method: "POST",
      body: { email, password, fido2Verified }
    });
    return payload.session;
  }

  createEnrollmentOptions(body) {
    return this.request("/auth/webauthn/enrollment/options", { method: "POST", body });
  }

  verifyEnrollment(body) {
    return this.request("/auth/webauthn/enrollment/verify", { method: "POST", body });
  }

  createWebAuthnLoginOptions(body) {
    return this.request("/auth/webauthn/login/options", { method: "POST", body });
  }

  async verifyWebAuthnLogin(body) {
    const payload = await this.request("/auth/webauthn/login/verify", { method: "POST", body });
    return payload.session;
  }

  getSession() {
    return this.request("/auth/session");
  }

  logout() {
    return this.request("/auth/logout", { method: "POST" });
  }

  createStepUpOptions() {
    return this.request("/auth/step-up/options", { method: "POST" });
  }

  verifyStepUp(body) {
    return this.request("/auth/step-up/verify", { method: "POST", body });
  }

  createTenant(body) {
    return this.request("/tenants", { method: "POST", body });
  }

  createOperator(body) {
    return this.request("/operators", { method: "POST", body });
  }

  createProvider(body) {
    return this.request("/providers", { method: "POST", body });
  }

  registerDevice(body) {
    return this.request("/devices", { method: "POST", body });
  }

  createProvisioningPlan(operatorId, body) {
    return this.request(`/operators/${operatorId}/provisioning-plan`, { method: "POST", body });
  }

  executeJob(body, idempotencyKey) {
    return this.request("/orchestrator/jobs", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey || body.idempotencyKey },
      body
    });
  }

  listAuditEvents() {
    return this.request("/audit/events");
  }
}
