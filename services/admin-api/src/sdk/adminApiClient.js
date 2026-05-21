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

  listOperatorProvisioningTemplates() {
    return this.request("/operator-provisioning/templates");
  }

  listOperatorProvisioningPipelines(operatorId = null) {
    return this.request(`/operator-provisioning/pipelines${operatorId ? `?operatorId=${encodeURIComponent(operatorId)}` : ""}`);
  }

  createOperatorProvisioningDraft(operatorId, body = {}) {
    return this.request(`/operators/${operatorId}/provisioning-pipeline`, { method: "POST", body });
  }

  createLocalLabVpsSet(pipelineId) {
    return this.request(`/operator-provisioning/pipelines/${pipelineId}/local-lab-vps`, { method: "POST" });
  }

  checkPipelineSecretsRelease(pipelineId) {
    return this.request(`/operator-provisioning/pipelines/${pipelineId}/secrets-release-check`, { method: "POST" });
  }

  getReleaseSummary() {
    return this.request("/release/summary");
  }

  listReleaseGates() {
    return this.request("/release/gates");
  }

  updateReleaseGateStatus(gateId, body) {
    return this.request(`/release/gates/${gateId}/status`, { method: "POST", body });
  }

  listReleaseProblems() {
    return this.request("/release/problems");
  }

  createReleaseProblem(body) {
    return this.request("/release/problems", { method: "POST", body });
  }

  updateReleaseProblemStatus(problemId, body) {
    return this.request(`/release/problems/${problemId}/status`, { method: "POST", body });
  }

  listHumanTestScenarios() {
    return this.request("/release/human-tests");
  }

  updateHumanTestScenarioStatus(scenarioId, body) {
    return this.request(`/release/human-tests/${scenarioId}/status`, { method: "POST", body });
  }

  listEvidenceArtifacts() {
    return this.request("/release/evidence-artifacts");
  }

  createEvidenceArtifact(body) {
    return this.request("/release/evidence-artifacts", { method: "POST", body });
  }

  getLiveExecutionSummary() {
    return this.request("/live-execution/summary");
  }

  listLiveCloudRequests() {
    return this.request("/live-execution/cloud/requests");
  }

  requestHetznerLiveVpsSet(body, idempotencyKey = body.idempotencyKey) {
    return this.request("/live-execution/cloud/hetzner/vps-set", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body
    });
  }

  listFirecrackerHostQualifications() {
    return this.request("/live-execution/firecracker/host-qualifications");
  }

  qualifyFirecrackerHost(body) {
    return this.request("/live-execution/firecracker/host-qualification", { method: "POST", body });
  }

  listCpuConfidentialQualifications() {
    return this.request("/live-execution/cpu-confidential/qualifications");
  }

  qualifyCpuConfidentialHost(body) {
    return this.request("/live-execution/cpu-confidential/qualification", { method: "POST", body });
  }

  listPhantomExecutionRequests() {
    return this.request("/live-execution/phantom/requests");
  }

  createPhantomExecutionRequest(body) {
    return this.request("/live-execution/phantom/request", { method: "POST", body });
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

  listPhantomPolicyTemplates() {
    return this.request("/phantom/policy-templates");
  }

  createPhantomPolicyTemplate(body) {
    return this.request("/phantom/policy-templates", { method: "POST", body });
  }

  listPhantomPackages() {
    return this.request("/phantom/packages");
  }

  createPhantomPackage(body) {
    return this.request("/phantom/packages", { method: "POST", body });
  }

  updatePhantomPackageStage(packageId, body) {
    return this.request(`/phantom/packages/${packageId}/stage`, { method: "POST", body });
  }

  listPhantomEvidenceBundles() {
    return this.request("/phantom/evidence-bundles");
  }

  createPhantomEvidenceBundle(body) {
    return this.request("/phantom/evidence-bundles", { method: "POST", body });
  }

  listPhantomApprovalPacks() {
    return this.request("/phantom/approval-packs");
  }

  createPhantomApprovalPack(body) {
    return this.request("/phantom/approval-packs", { method: "POST", body });
  }

  listPhantomReadinessEvaluations() {
    return this.request("/phantom/readiness");
  }

  evaluatePhantomReadiness(body) {
    return this.request("/phantom/readiness/evaluate", { method: "POST", body });
  }

  listPhantomSimulationRuns() {
    return this.request("/phantom/simulations");
  }

  runPhantomSimulation(body) {
    return this.request("/phantom/simulations", { method: "POST", body });
  }

  listPhantomAssignmentPlans() {
    return this.request("/phantom/assignment-plans");
  }

  createPhantomAssignmentPlan(body) {
    return this.request("/phantom/assignment-plans", { method: "POST", body });
  }

  listPhantomReviewBoardItems() {
    return this.request("/phantom/review-board");
  }

  createPhantomReviewBoardItem(body) {
    return this.request("/phantom/review-board", { method: "POST", body });
  }

  acknowledgePhantomReviewBoardOwner(itemId, body) {
    return this.request(`/phantom/review-board/${itemId}/ack`, { method: "POST", body });
  }

  updatePhantomReviewBoardStatus(itemId, body) {
    return this.request(`/phantom/review-board/${itemId}/status`, { method: "POST", body });
  }

  listPhantomPolicySimulations() {
    return this.request("/phantom/policy-simulations");
  }

  runPhantomPolicySimulation(body) {
    return this.request("/phantom/policy-simulations", { method: "POST", body });
  }

  listPhantomExceptions() {
    return this.request("/phantom/exceptions");
  }

  createPhantomException(body) {
    return this.request("/phantom/exceptions", { method: "POST", body });
  }

  getPhantomEvidenceCoverage(packageId) {
    return this.request(`/phantom/packages/${packageId}/evidence-coverage`);
  }

  getPhantomAuditCorrelation(packageId = null) {
    return this.request(`/phantom/audit-correlation${packageId ? `?packageId=${encodeURIComponent(packageId)}` : ""}`);
  }

  listSubscriptionPlans() {
    return this.request("/subscription/plans");
  }

  createSubscriptionPlan(body) {
    return this.request("/subscription/plans", { method: "POST", body });
  }

  getTenantSubscription(tenantId) {
    return this.request(`/tenants/${tenantId}/subscription`);
  }

  updateTenantSubscription(tenantId, body) {
    return this.request(`/tenants/${tenantId}/subscription`, { method: "POST", body });
  }

  updateTenantAddons(tenantId, body) {
    return this.request(`/tenants/${tenantId}/subscription/addons`, { method: "POST", body });
  }

  updateTenantBillingState(tenantId, body) {
    return this.request(`/tenants/${tenantId}/billing-state`, { method: "POST", body });
  }

  quoteWorkloadAllocation(operatorId, body) {
    return this.request(`/operators/${operatorId}/workload-allocations/quote`, { method: "POST", body });
  }

  createWorkloadAllocation(operatorId, body) {
    return this.request(`/operators/${operatorId}/workload-allocations`, { method: "POST", body });
  }

  listWorkloadAllocations(operatorId) {
    return this.request(`/operators/${operatorId}/workload-allocations`);
  }

  createMicroVmPlacementPlan(operatorId, body) {
    return this.request(`/operators/${operatorId}/microvm-placement-plan`, { method: "POST", body });
  }

  listQuotaDecisions() {
    return this.request("/subscription/quota-decisions");
  }

  listProvisioningApprovals(operatorId = null) {
    return this.request(`/provisioning/approvals${operatorId ? `?operatorId=${encodeURIComponent(operatorId)}` : ""}`);
  }

  createProvisioningApproval(body) {
    return this.request("/provisioning/approvals", { method: "POST", body });
  }

  updateProvisioningApprovalStatus(approvalId, body) {
    return this.request(`/provisioning/approvals/${approvalId}/status`, { method: "POST", body });
  }

  evaluateOperatorReadiness(operatorId) {
    return this.request(`/operators/${operatorId}/readiness`);
  }

  listOperatorReadinessHistory(operatorId) {
    return this.request(`/operators/${operatorId}/readiness/history`);
  }

  getReadiness(readinessId) {
    return this.request(`/readiness/${readinessId}`);
  }

  getSystemStatus() {
    return this.request("/system/status");
  }

  listWorkloadLifecycle(operatorId = null) {
    return this.request(`/workload/lifecycle${operatorId ? `?operatorId=${encodeURIComponent(operatorId)}` : ""}`);
  }

  transitionWorkloadLifecycle(allocationId, body) {
    return this.request(`/workload/allocations/${allocationId}/lifecycle`, { method: "POST", body });
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

  listProviderDryRunPlans(operatorId = null) {
    return this.request(`/providers/dry-run/vps-plans${operatorId ? `?operatorId=${encodeURIComponent(operatorId)}` : ""}`);
  }

  createProviderDryRunVpsPlan(body) {
    return this.request("/providers/dry-run/vps-plan", { method: "POST", body });
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
