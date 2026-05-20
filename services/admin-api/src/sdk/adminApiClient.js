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

  getAuthPolicyMatrix() {
    return this.request("/auth/policy-matrix");
  }

  listCredentials() {
    return this.request("/auth/credentials");
  }

  suspendCredential(credentialId, body = {}) {
    return this.request(`/auth/credentials/${credentialId}/suspend`, { method: "POST", body });
  }

  revokeCredential(credentialId, body = {}) {
    return this.request(`/auth/credentials/${credentialId}/revoke`, { method: "POST", body });
  }

  createRecoveryRequest(body) {
    return this.request("/auth/recovery/request", { method: "POST", body });
  }

  listRecoveryRequests() {
    return this.request("/auth/recovery/requests");
  }

  updateRecoveryStatus(requestId, body) {
    return this.request(`/auth/recovery/requests/${requestId}/status`, { method: "POST", body });
  }

  createBreakGlassRequest(body) {
    return this.request("/auth/break-glass/requests", { method: "POST", body });
  }

  listBreakGlassRequests() {
    return this.request("/auth/break-glass/requests");
  }

  getPhantomBoundary() {
    return this.request("/phantom/boundary");
  }

  updatePhantomBoundaryStatus(body) {
    return this.request("/phantom/boundary/status", { method: "POST", body });
  }

  listPhantomCapabilities() {
    return this.request("/phantom/capabilities");
  }

  createPhantomCapability(body) {
    return this.request("/phantom/capabilities", { method: "POST", body });
  }

  updatePhantomCapabilityStatus(capabilityId, body) {
    return this.request(`/phantom/capabilities/${capabilityId}/status`, { method: "POST", body });
  }

  listPhantomApprovals() {
    return this.request("/phantom/approvals");
  }

  createPhantomApproval(body) {
    return this.request("/phantom/approvals", { method: "POST", body });
  }

  updatePhantomApprovalStatus(approvalId, body) {
    return this.request(`/phantom/approvals/${approvalId}/status`, { method: "POST", body });
  }

  listPhantomRisks() {
    return this.request("/phantom/risks");
  }

  createPhantomRisk(body) {
    return this.request("/phantom/risks", { method: "POST", body });
  }

  updatePhantomRiskStatus(riskId, body) {
    return this.request(`/phantom/risks/${riskId}/status`, { method: "POST", body });
  }

  isStepUpRequired(error) {
    return error?.payload?.error?.code === "step_up_required";
  }

  async withStepUpRetry(operation, stepUpHandler) {
    try {
      return await operation();
    } catch (error) {
      if (!this.isStepUpRequired(error)) {
        throw error;
      }
      await stepUpHandler(error.payload.error.details);
      return operation();
    }
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
