const state = {
  token: sessionStorage.getItem("sylion.admin.token") || null,
  session: JSON.parse(sessionStorage.getItem("sylion.admin.session") || "null"),
  tenants: [],
  operators: [],
  operatorProvisioningTemplates: [],
  operatorProvisioningPipelines: [],
  operatorEnvironments: [],
  operatorConnectionPath: null,
  routerPackages: [],
  routerPostures: [],
  providers: [],
  devices: [],
  authorizedApps: [],
  jobs: [],
  audit: [],
  subscriptionPlans: [],
  tenantSubscriptions: [],
  workloadAllocations: [],
  quotaDecisions: [],
  provisioningApprovals: [],
  readinessResults: [],
  workloadLifecycle: [],
  systemStatus: null,
  providerDryRunPlans: [],
  lastAllocationId: null,
  credentials: [],
  authPolicy: null,
  adminFido2Policy: null,
  adminHsmProfile: null,
  operatorSecurityProfiles: [],
  recoveryRequests: [],
  breakGlassRequests: [],
  phantomBoundary: null,
  phantomCapabilities: [],
  phantomApprovals: [],
  phantomRisks: [],
  phantomPolicyTemplates: [],
  phantomPackages: [],
  phantomEvidenceBundles: [],
  phantomApprovalPacks: [],
  phantomReadiness: [],
  phantomSimulations: [],
  phantomAssignmentPlans: [],
  phantomReviewBoardItems: [],
  phantomPolicySimulations: [],
  phantomExceptions: [],
  phantomCoverage: [],
  phantomAuditCorrelation: null,
  releaseSummary: null,
  releaseBuildAssessment: null,
  releaseGates: [],
  releaseProblems: [],
  humanTests: [],
  humanTestRuns: [],
  evidenceArtifacts: [],
  liveExecutionSummary: null,
  liveCloudRequests: [],
  liveRollbackPlans: [],
  liveProviderRehearsals: [],
  dedicatedWorkloadOrders: [],
  blueTeamDashboard: null,
  monitoringEvents: [],
  incidents: [],
  secretBackendStatus: null,
  secretBackends: [],
  firecrackerQualifications: [],
  firecrackerLaunchRehearsals: [],
  cpuConfidentialQualifications: [],
  phantomExecutionRequests: [],
  lastPlanId: null,
  lastPlanOperatorId: null,
  credentialId: localStorage.getItem("sylion.admin.credentialId") || null,
  webAuthnMode: localStorage.getItem("sylion.admin.webauthnMode") || "local_simulator",
  webAuthnSupported: false,
  pendingStepUp: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function toast(message, tone = "info") {
  const target = $("#toast");
  if (target) {
    target.textContent = message;
    target.dataset.tone = tone;
  }
  const loginTarget = $("#login-toast");
  if (loginTarget) {
    loginTarget.textContent = message;
    loginTarget.dataset.tone = tone;
  }
}

function headers(extra = {}) {
  return {
    "content-type": "application/json",
    "x-correlation-id": `corr_web_${crypto.randomUUID()}`,
    ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
    ...extra
  };
}

async function api(path, { method = "GET", body, extraHeaders = {} } = {}) {
  const response = await fetch(path, {
    method,
    headers: headers(extraHeaders),
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "API request failed");
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRegionCatalog(value) {
  return splitCsv(value).map((item) => {
    const [region, country, ...cityParts] = item.split(":").map((part) => part.trim());
    return {
      region,
      country: String(country || "").toUpperCase(),
      city: cityParts.join(":") || null
    };
  }).filter((entry) => entry.region && entry.country);
}

function supportsBrowserWebAuthn() {
  return Boolean(window.PublicKeyCredential && navigator.credentials?.create && navigator.credentials?.get);
}

function base64UrlToBuffer(value) {
  const base64 = String(value).replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function bufferToBase64Url(value) {
  const bytes = new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function card(title, rows) {
  return `
    <article class="mini-card">
      <strong>${escapeHtml(title)}</strong>
      ${rows.map(([label, value]) => `<p><span>${escapeHtml(label)}</span>${escapeHtml(value ?? "-")}</p>`).join("")}
    </article>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function login(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const options = await api("/auth/webauthn/login/options", {
    method: "POST",
    body: {
      email: data.email,
      password: data.password
    }
  });
  const credentialId = options.challenge.publicKey.allowCredentials?.[0]?.id || state.credentialId;
  if (!credentialId) {
    throw new Error("Enroll a FIDO2 credential before signing in");
  }
  const assertion = state.webAuthnMode === "browser"
    ? await browserAssertion(options.challenge, credentialId)
    : simulatedAssertion(options.challenge.id, credentialId);
  const result = await api("/auth/webauthn/login/verify", {
    method: "POST",
    body: {
      challengeId: options.challenge.id,
      credentialId,
      assertion
    }
  });
  state.session = result.session;
  state.token = result.session.token;
  sessionStorage.setItem("sylion.admin.session", JSON.stringify(result.session));
  sessionStorage.setItem("sylion.admin.token", result.session.token);
  $("#login-panel").hidden = true;
  $("#app-shell").hidden = false;
  $("#session-label").textContent = `${result.session.role}`;
  toast("Signed in with WebAuthn-compatible challenge");
  await refreshAll();
}

async function refreshAll() {
  if (!state.token) return;
  const [
    health,
    session,
    tenants,
    operators,
    operatorProvisioningTemplates,
    operatorProvisioningPipelines,
    operatorEnvironments,
    providers,
    devices,
    authorizedApps,
    jobs,
    audit,
    credentials,
    policy,
    adminFido2Policy,
    adminHsmProfile,
    recovery,
    breakGlass,
    phantomBoundary,
    phantomCapabilities,
    phantomApprovals,
    phantomRisks,
    phantomPolicyTemplates,
    phantomPackages,
    phantomEvidenceBundles,
    phantomApprovalPacks,
    phantomReadiness,
    phantomSimulations,
    phantomAssignmentPlans,
    phantomReviewBoardItems,
    phantomPolicySimulations,
    phantomExceptions,
    phantomAuditCorrelation,
    releaseSummary,
    releaseBuildAssessment,
    releaseGates,
    releaseProblems,
    humanTests,
    humanTestRuns,
    evidenceArtifacts,
    liveExecutionSummary,
    liveCloudRequests,
    liveRollbackPlans,
    liveProviderRehearsals,
    dedicatedWorkloadOrders,
    blueTeamDashboard,
    monitoringEvents,
    incidents,
    secretBackendStatus,
    secretBackends,
    firecrackerQualifications,
    firecrackerLaunchRehearsals,
    cpuConfidentialQualifications,
    phantomExecutionRequests,
    subscriptionPlans,
    quotaDecisions,
    provisioningApprovals,
    workloadLifecycle,
    systemStatus,
    providerDryRunPlans,
    routerPackages,
    routerPostures
  ] = await Promise.all([
    api("/health"),
    api("/auth/session"),
    api("/tenants"),
    api("/operators"),
    api("/operator-provisioning/templates").catch(() => ({ templates: [] })),
    api("/operator-provisioning/pipelines").catch(() => ({ pipelines: [] })),
    api("/operator-environments").catch(() => ({ environments: [] })),
    api("/providers"),
    api("/devices"),
    api("/apps"),
    api("/orchestrator/jobs"),
    api("/audit/events"),
    api("/auth/credentials").catch(() => ({ credentials: [] })),
    api("/auth/policy-matrix").catch(() => ({ policy: null })),
    api("/security/admin/fido2-policy").catch(() => ({ policy: null })),
    api("/security/admin/hsm-profile").catch(() => ({ profile: null })),
    api("/auth/recovery/requests").catch(() => ({ requests: [] })),
    api("/auth/break-glass/requests").catch(() => ({ requests: [] })),
    api("/phantom/boundary").catch(() => ({ boundary: null })),
    api("/phantom/capabilities").catch(() => ({ capabilities: [] })),
    api("/phantom/approvals").catch(() => ({ approvals: [] })),
    api("/phantom/risks").catch(() => ({ risks: [] })),
    api("/phantom/policy-templates").catch(() => ({ templates: [] })),
    api("/phantom/packages").catch(() => ({ packages: [] })),
    api("/phantom/evidence-bundles").catch(() => ({ bundles: [] })),
    api("/phantom/approval-packs").catch(() => ({ packs: [] })),
    api("/phantom/readiness").catch(() => ({ evaluations: [] })),
    api("/phantom/simulations").catch(() => ({ runs: [] })),
    api("/phantom/assignment-plans").catch(() => ({ plans: [] })),
    api("/phantom/review-board").catch(() => ({ items: [] })),
    api("/phantom/policy-simulations").catch(() => ({ simulations: [] })),
    api("/phantom/exceptions").catch(() => ({ exceptions: [] })),
    api("/phantom/audit-correlation").catch(() => ({ summary: null })),
    api("/release/summary").catch(() => ({ summary: null })),
    api("/release/build-assessment").catch(() => ({ assessment: null })),
    api("/release/gates").catch(() => ({ gates: [] })),
    api("/release/problems").catch(() => ({ problems: [] })),
    api("/release/human-tests").catch(() => ({ scenarios: [] })),
    api("/release/human-test-runs").catch(() => ({ runs: [] })),
    api("/release/evidence-artifacts").catch(() => ({ artifacts: [] })),
    api("/live-execution/summary").catch(() => ({ summary: null })),
    api("/live-execution/cloud/requests").catch(() => ({ requests: [] })),
    api("/live-execution/cloud/rollback-plans").catch(() => ({ plans: [] })),
    api("/live-execution/cloud/rehearsals").catch(() => ({ rehearsals: [] })),
    api("/live-execution/dedicated-workload/orders").catch(() => ({ orders: [] })),
    api("/monitoring/blue-team-dashboard").catch(() => ({ dashboard: null })),
    api("/monitoring/events").catch(() => ({ events: [] })),
    api("/incidents").catch(() => ({ incidents: [] })),
    api("/secrets/backend-status").catch(() => ({ status: null })),
    api("/secrets/backends").catch(() => ({ backends: [] })),
    api("/live-execution/firecracker/host-qualifications").catch(() => ({ qualifications: [] })),
    api("/live-execution/firecracker/launch-rehearsals").catch(() => ({ rehearsals: [] })),
    api("/live-execution/cpu-confidential/qualifications").catch(() => ({ qualifications: [] })),
    api("/live-execution/phantom/requests").catch(() => ({ requests: [] })),
    api("/subscription/plans").catch(() => ({ plans: [] })),
    api("/subscription/quota-decisions").catch(() => ({ decisions: [] })),
    api("/provisioning/approvals").catch(() => ({ approvals: [] })),
    api("/workload/lifecycle").catch(() => ({ lifecycle: [] })),
    api("/system/status").catch(() => ({ status: null })),
    api("/providers/dry-run/vps-plans").catch(() => ({ plans: [] })),
    api("/router/packages").catch(() => ({ packages: [] })),
    api("/router/postures").catch(() => ({ postures: [] }))
  ]);
  $("#api-status").textContent = health.status === "ok" ? "API Healthy" : "API Degraded";
  state.session = session.session;
  state.tenants = tenants.tenants;
  state.operators = operators.operators;
  state.operatorProvisioningTemplates = operatorProvisioningTemplates.templates;
  state.operatorProvisioningPipelines = operatorProvisioningPipelines.pipelines;
  state.operatorEnvironments = operatorEnvironments.environments;
  state.providers = providers.providers;
  state.devices = devices.devices;
  state.authorizedApps = authorizedApps.apps;
  state.jobs = jobs.jobs;
  state.audit = audit.events;
  state.credentials = credentials.credentials;
  state.authPolicy = policy.policy;
  state.adminFido2Policy = adminFido2Policy.policy;
  state.adminHsmProfile = adminHsmProfile.profile;
  state.recoveryRequests = recovery.requests;
  state.breakGlassRequests = breakGlass.requests;
  state.phantomBoundary = phantomBoundary.boundary;
  state.phantomCapabilities = phantomCapabilities.capabilities;
  state.phantomApprovals = phantomApprovals.approvals;
  state.phantomRisks = phantomRisks.risks;
  state.phantomPolicyTemplates = phantomPolicyTemplates.templates;
  state.phantomPackages = phantomPackages.packages;
  state.phantomEvidenceBundles = phantomEvidenceBundles.bundles;
  state.phantomApprovalPacks = phantomApprovalPacks.packs;
  state.phantomReadiness = phantomReadiness.evaluations;
  state.phantomSimulations = phantomSimulations.runs;
  state.phantomAssignmentPlans = phantomAssignmentPlans.plans;
  state.phantomReviewBoardItems = phantomReviewBoardItems.items;
  state.phantomPolicySimulations = phantomPolicySimulations.simulations;
  state.phantomExceptions = phantomExceptions.exceptions;
  state.phantomAuditCorrelation = phantomAuditCorrelation.summary;
  state.releaseSummary = releaseSummary.summary;
  state.releaseBuildAssessment = releaseBuildAssessment.assessment;
  state.releaseGates = releaseGates.gates;
  state.releaseProblems = releaseProblems.problems;
  state.humanTests = humanTests.scenarios;
  state.humanTestRuns = humanTestRuns.runs;
  state.evidenceArtifacts = evidenceArtifacts.artifacts;
  state.liveExecutionSummary = liveExecutionSummary.summary;
  state.liveCloudRequests = liveCloudRequests.requests;
  state.liveRollbackPlans = liveRollbackPlans.plans;
  state.liveProviderRehearsals = liveProviderRehearsals.rehearsals;
  state.dedicatedWorkloadOrders = dedicatedWorkloadOrders.orders;
  state.blueTeamDashboard = blueTeamDashboard.dashboard;
  state.monitoringEvents = monitoringEvents.events;
  state.incidents = incidents.incidents;
  state.secretBackendStatus = secretBackendStatus.status;
  state.secretBackends = secretBackends.backends;
  state.firecrackerQualifications = firecrackerQualifications.qualifications;
  state.firecrackerLaunchRehearsals = firecrackerLaunchRehearsals.rehearsals;
  state.cpuConfidentialQualifications = cpuConfidentialQualifications.qualifications;
  state.phantomExecutionRequests = phantomExecutionRequests.requests;
  state.phantomCoverage = await Promise.all(
    state.phantomPackages.map((pkg) => api(`/phantom/packages/${pkg.id}/evidence-coverage`)
      .then((result) => result.coverage)
      .catch(() => null))
  ).then((rows) => rows.filter(Boolean));
  state.subscriptionPlans = subscriptionPlans.plans;
  state.quotaDecisions = quotaDecisions.decisions;
  state.provisioningApprovals = provisioningApprovals.approvals;
  state.workloadLifecycle = workloadLifecycle.lifecycle;
  state.systemStatus = systemStatus.status;
  state.providerDryRunPlans = providerDryRunPlans.plans;
  state.routerPackages = routerPackages.packages;
  state.routerPostures = routerPostures.postures;
  state.tenantSubscriptions = await Promise.all(
    state.tenants.map((tenant) => api(`/tenants/${tenant.id}/subscription`)
      .then((result) => result.subscription)
      .catch(() => null))
  ).then((rows) => rows.filter(Boolean));
  const allocationGroups = await Promise.all(
    state.operators.map((operator) => api(`/operators/${operator.id}/workload-allocations`)
      .then((result) => result.allocations)
      .catch(() => []))
  );
  state.workloadAllocations = allocationGroups.flat();
  state.operatorSecurityProfiles = await Promise.all(
    state.operators.map(async (operator) => {
      const [fido2, hsm] = await Promise.all([
        api(`/operators/${operator.id}/security/fido2-policy`).then((result) => result.policy).catch(() => null),
        api(`/operators/${operator.id}/security/hsm-profile`).then((result) => result.profile).catch(() => null)
      ]);
      return { operator, fido2, hsm };
    })
  );
  render();
}

function render() {
  $("#metric-tenants").textContent = state.tenants.length;
  $("#metric-operators").textContent = state.operators.length;
  $("#metric-jobs").textContent = state.jobs.length;
  $("#metric-audit").textContent = state.audit.length;
  $("#session-state").textContent = state.session?.authMethod || "Unknown";
  $("#phantom-boundary-state").textContent = state.phantomBoundary?.status || "Unavailable";
  $("#webauthn-capability").textContent = state.webAuthnSupported ? "Browser WebAuthn available" : "Dev/test simulator only";
  $("#webauthn-capability-security").textContent = state.webAuthnSupported
    ? "Browser WebAuthn capability available"
    : "Dev/test simulator boundary active";
  $("#webauthn-mode").value = state.webAuthnMode;

  renderSelect("#operator-tenant-select", state.tenants, "No tenants");
  renderSelect("#operator-live-provider-select", state.providers.filter((provider) => provider.providerKey === "hetzner"), "No Hetzner provider", "displayName");
  renderSelect("#pipeline-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#local-lab-pipeline-select", state.operatorProvisioningPipelines, "No pipelines", "operatorId");
  renderSelect("#local-environment-pipeline-select", state.operatorProvisioningPipelines, "No pipelines", "operatorId");
  renderSelect("#environment-start-select", state.operatorEnvironments, "No environments", "status");
  renderSelect("#environment-failure-select", state.operatorEnvironments, "No environments", "status");
  renderSelect("#environment-rollback-select", state.operatorEnvironments, "No environments", "status");
  renderSelect("#environment-secrets-select", state.operatorEnvironments, "No environments", "status");
  renderSelect("#operator-connection-path-select", state.operators, "No operators", "displayName");
  renderSelect("#router-package-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#router-package-device-select", state.devices.filter((device) => device.type === "puli_ax_router"), "No Puli AX routers", "serial");
  renderSelect("#router-posture-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#router-posture-package-select", state.routerPackages, "No router packages", "status");
  renderSelect("#router-posture-device-select", state.devices.filter((device) => device.type === "puli_ax_router"), "No Puli AX routers", "serial");
  renderSelect("#secrets-check-pipeline-select", state.operatorProvisioningPipelines, "No pipelines", "operatorId");
  renderSelect("#device-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#plan-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#job-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#readiness-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#approval-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#approval-status-select", state.provisioningApprovals, "No approvals", "reasonCode");
  renderSelect("#workload-lifecycle-allocation-select", state.workloadAllocations, "No allocations", "appName");
  renderSelect("#workload-lifecycle-approval-select", state.provisioningApprovals, "No approvals", "reasonCode");
  renderSelect("#provider-dry-run-provider-select", state.providers, "No providers", "displayName");
  renderSelect("#provider-dry-run-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#live-cloud-provider-select", state.providers, "No providers", "displayName");
  renderSelect("#live-cloud-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#live-cloud-approval-select", state.provisioningApprovals, "No approvals", "reasonCode");
  renderSelect("#baseline-promotion-provider-select", state.providers, "No providers", "displayName");
  renderSelect("#baseline-promotion-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#baseline-promotion-approval-select", state.provisioningApprovals, "No approvals", "reasonCode");
  renderSelect("#provider-rehearsal-provider-select", state.providers, "No providers", "displayName");
  renderSelect("#provider-rehearsal-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#provider-rehearsal-approval-select", state.provisioningApprovals, "No approvals", "reasonCode");
  renderSelect("#dedicated-order-provider-select", state.providers.filter((provider) => provider.providerKey === "hetzner_robot"), "No Hetzner Robot provider", "displayName");
  renderSelect("#dedicated-order-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#dedicated-order-approval-select", state.provisioningApprovals, "No approvals", "reasonCode");
  renderSelect("#blue-team-signal-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#firecracker-rehearsal-host-select", state.firecrackerQualifications, "No qualified hosts", "hostId");
  renderSelect("#firecracker-rehearsal-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#subscription-tenant-select", state.tenants, "No tenants");
  renderSelect("#subscription-plan-select", state.subscriptionPlans, "No plans", "name");
  renderSelect("#billing-tenant-select", state.tenants, "No tenants");
  renderSelect("#workload-quote-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#workload-quote-app-select", approvedApps(), "No approved apps", "name");
  renderSelect("#workload-allocation-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#workload-allocation-app-select", approvedApps(), "No approved apps", "name");
  renderSelect("#placement-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#placement-allocation-select", state.workloadAllocations, "No allocations", "appName");
  renderSelect("#operator-security-fido2-select", state.operators, "No operators", "displayName");
  renderSelect("#operator-security-hsm-select", state.operators, "No operators", "displayName");
  renderSelect("#phantom-package-template-select", state.phantomPolicyTemplates, "No templates", "name");
  renderSelect("#phantom-package-capability-select", state.phantomCapabilities, "No capabilities", "displayName");
  renderSelect("#phantom-evidence-package-select", state.phantomPackages, "No packages", "name");
  renderSelect("#phantom-approval-pack-package-select", state.phantomPackages, "No packages", "name");
  renderSelect("#phantom-readiness-package-select", state.phantomPackages, "No packages", "name");
  renderSelect("#phantom-readiness-approval-pack-select", state.phantomApprovalPacks, "No approval packs", "summary");
  renderSelect("#phantom-readiness-evidence-select", state.phantomEvidenceBundles, "No evidence bundles", "summary");
  renderSelect("#phantom-readiness-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#phantom-simulation-package-select", state.phantomPackages, "No packages", "name");
  renderSelect("#phantom-assignment-package-select", state.phantomPackages, "No packages", "name");
  renderSelect("#phantom-assignment-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#phantom-review-board-package-select", state.phantomPackages, "No packages", "name");
  renderSelect("#phantom-policy-simulation-package-select", state.phantomPackages, "No packages", "name");
  renderSelect("#phantom-exception-package-select", state.phantomPackages, "No packages", "name");
  renderSelect("#phantom-exception-review-select", state.phantomReviewBoardItems, "No review items", "title");
  renderSelect("#phantom-exception-evidence-select", state.phantomEvidenceBundles, "No evidence bundles", "summary");
  renderSelect("#phantom-review-ack-select", state.phantomReviewBoardItems, "No review items", "title");
  renderSelect("#phantom-coverage-package-select", state.phantomPackages, "No packages", "name");
  renderSelect("#phantom-execution-package-select", state.phantomPackages, "No packages", "name");
  renderSelect("#human-test-select", state.humanTests, "No test scenarios", "title");

  $("#ksiega-status-cards").innerHTML = (state.systemStatus?.ksiega34 || []).map((item) => card(item.label, [
    ["Status", item.status],
    ["Next", item.nextAction || "-"]
  ])).join("") || empty("Status matrix unavailable.");
  $("#phantom-status-cards").innerHTML = (state.systemStatus?.phantom || []).map((item) => card(item.label, [
    ["Status", item.status],
    ["Execution", String(item.executionAllowed)]
  ])).join("") || empty("PHANTOM status unavailable.");

  $("#operator-cards").innerHTML = state.operators.map((operator) => card(operator.displayName, [
    ["Tier", operator.tier],
    ["Status", operator.status],
    ["Tenant", operator.tenantId],
    ["Router", operator.baseline?.router]
  ])).join("") || empty("No operators yet.");

  $("#operator-connection-path-cards").innerHTML = state.operatorConnectionPath ? [
    card("Terminal path", [
      ["Operator", state.operatorConnectionPath.operatorId],
      ["State", state.operatorConnectionPath.state],
      ["Terminal", state.operatorConnectionPath.terminalMode],
      ["Router", state.operatorConnectionPath.router?.model],
      ["Transport", state.operatorConnectionPath.baseline?.transport],
      ["Prod exec", String(state.operatorConnectionPath.productionExecutionAllowed)]
    ]),
    ...state.operatorConnectionPath.segments.map((segment) => card(segment.id, [
      ["Route", `${segment.from} -> ${segment.to}`],
      ["Protocol", segment.protocol],
      ["State", segment.state],
      ["Kill switch", segment.killSwitch],
      ["Cert", segment.certRef]
    ])),
    ...state.operatorConnectionPath.microVmSlots.map((slot) => card(slot.appName, [
      ["Template", slot.templateKey],
      ["Status", slot.status],
      ["Isolation", slot.isolation],
      ["Namespace", slot.networkNamespace],
      ["CDR", String(slot.cdrRequired)],
      ["Secrets", String(slot.secretsReleaseAllowed)]
    ]))
  ].join("") : empty("Load an operator connection path to inspect Pixel/Laptop -> G1 -> G2 -> WORKLOAD -> microVM chain.");

  $("#router-package-cards").innerHTML = state.routerPackages.map((item) => card(item.model, [
    ["Operator", item.operatorId],
    ["Device", item.routerDeviceId || "-"],
    ["Status", item.status],
    ["Install", item.installState],
    ["IPsec", item.manifest?.ipsecProfiles?.map((profile) => profile.id).join(", ")],
    ["Kill switch", item.manifest?.controls?.killSwitch],
    ["DNS", item.manifest?.controls?.dnsPolicy],
    ["Secrets", String(item.manifest?.secretsIncluded)]
  ])).join("") || empty("No Puli AX router package generated yet.");

  $("#router-posture-cards").innerHTML = state.routerPostures.map((item) => card(item.status, [
    ["Operator", item.operatorId],
    ["Package", item.packageId || "-"],
    ["Router", item.routerDeviceId || "-"],
    ["Passed", `${item.checks?.filter((check) => check.status === "passed").length || 0}/${item.checks?.length || 0}`],
    ["Blockers", item.blockers?.join(", ") || "none"],
    ["Prod exec", String(item.productionExecutionAllowed)]
  ])).join("") || empty("No router posture validation recorded yet.");

  $("#pipeline-template-cards").innerHTML = state.operatorProvisioningTemplates.map((template) => card(template.name, [
    ["Key", template.key],
    ["Isolation", template.isolation],
    ["vCPU", String(template.defaults?.vcpu)],
    ["Memory", `${template.defaults?.memoryMiB} MiB`],
    ["CDR", String(template.cdrRequired)]
  ])).join("") || empty("No communicator templates available.");

  $("#operator-pipeline-cards").innerHTML = state.operatorProvisioningPipelines.map((pipeline) => card(pipeline.id, [
    ["Operator", pipeline.operatorId],
    ["Status", pipeline.status],
    ["Workloads", String(pipeline.workloads?.length || 0)],
    ["Lab VPS", String(pipeline.localLab?.vps?.length || 0)],
    ["Firecracker", String(pipeline.firecrackerPlan?.workloads?.length || 0)],
    ["Secrets", String(pipeline.secretsRelease?.allowed)]
  ])).join("") || empty("No operator provisioning pipelines yet.");

  $("#operator-environment-cards").innerHTML = state.operatorEnvironments.map((environment) => card(environment.id, [
    ["Operator", environment.operatorId],
    ["Status", environment.status],
    ["Mode", environment.mode],
    ["VPS", String(environment.localProvider?.resources?.length || 0)],
    ["Runtimes", String(environment.mockFirecracker?.runtimes?.length || 0)],
    ["Failure", environment.failure?.type || "-"],
    ["Secrets", String(environment.secretsReleaseAllowed)]
  ])).join("") || empty("No operator environments yet.");

  $("#provider-cards").innerHTML = state.providers.map((provider) => card(provider.displayName, [
    ["Provider", provider.providerKey],
    ["Countries", provider.countries?.join(", ") || "-"],
    ["Regions", provider.regions?.join(", ")],
    ["Region catalog", provider.regionCatalog?.map((item) => `${item.region}:${item.country}`).join(", ") || "-"],
    ["Containers", String(provider.runtimeCapabilities?.containers)],
    ["Firecracker", String(provider.runtimeCapabilities?.firecracker)],
    ["Android workloads", String(provider.runtimeCapabilities?.androidWorkloads)],
    ["TDX", String(provider.runtimeCapabilities?.intelTdx)],
    ["SEV-SNP", String(provider.runtimeCapabilities?.amdSevSnp)],
    ["Tier fit", provider.runtimeCapabilities?.recommendedTier || "-"],
    ["Secret", provider.apiSecretReference?.secretReference],
    ["Connection", provider.connection?.status]
  ])).join("") || empty("No providers yet.");

  $("#provider-dry-run-cards").innerHTML = state.providerDryRunPlans.map((plan) => card(plan.providerKey, [
    ["Operator", plan.operatorId],
    ["Region", plan.region],
    ["Actions", String(plan.plannedActions?.length || 0)],
    ["Side effect", String(plan.sideEffectAllowed)]
  ])).join("") || empty("No dry-run plans yet.");

  $("#live-cloud-status-cards").innerHTML = state.liveExecutionSummary ? card("Live execution gate", [
    ["Provider mode", state.liveExecutionSummary.providerMode],
    ["Live allowed", String(state.liveExecutionSummary.liveAllowed)],
    ["Token configured", String(state.liveExecutionSummary.tokenConfigured)],
    ["Secret source", state.liveExecutionSummary.secretProvider?.source || "-"],
    ["Unlock", state.liveExecutionSummary.baselineUnlockState],
    ["Adapters", state.liveExecutionSummary.providerAdapters?.map((adapter) => `${adapter.providerKey}:${adapter.status}`).join(", ") || "-"],
    ["Rollback plans", String(state.liveExecutionSummary.rollbackPlans || 0)],
    ["Prod exec", String(state.liveExecutionSummary.productionExecutionAllowed)]
  ]) : empty("Live execution gate unavailable.");

  $("#secret-backend-status-cards").innerHTML = state.secretBackendStatus ? card("Secret backend contract", [
    ["Default runtime", state.secretBackendStatus.defaultRuntimeSource],
    ["Backends", String(state.secretBackendStatus.backendCount)],
    ["External refs", String(state.secretBackendStatus.externalReferenceCount)],
    ["Plaintext retrieval", String(state.secretBackendStatus.plaintextRetrievalAllowed)],
    ["Prod release", String(state.secretBackendStatus.productionSecretReleaseAllowed)],
    ["Human gate", String(state.secretBackendStatus.humanGateRequired)]
  ]) : empty("Secret backend status unavailable.");

  $("#secret-backend-cards").innerHTML = state.secretBackends.map((backend) => card(backend.displayName, [
    ["Type", backend.backendType],
    ["Mode", backend.mode],
    ["Runtime", String(backend.runtimeResolutionAllowed)],
    ["Plaintext", String(backend.plaintextRetrievalAllowed)],
    ["Prod ready", String(backend.productionReady)],
    ["Gate", String(backend.humanGateRequired)]
  ])).join("") || empty("No secret backends configured.");

  $("#live-cloud-request-cards").innerHTML = state.liveCloudRequests.map((request) => card(request.id, [
    ["Status", request.status],
    ["Provider", request.providerKey],
    ["Operator", request.operatorId],
    ["Region", request.region],
    ["Gate", request.gate?.baselineUnlockState],
    ["Rollback", request.rollbackPlanId || "-"],
    ["Rollback ready", String(request.rollbackReady)],
    ["Side effect", String(request.sideEffectAllowed)],
    ["Blockers", request.gate?.blockers?.join(", ") || "-"]
  ])).join("") || empty("No live cloud requests recorded.");

  $("#provider-rehearsal-cards").innerHTML = state.liveProviderRehearsals.map((rehearsal) => card(rehearsal.id, [
    ["Status", rehearsal.status],
    ["Mode", rehearsal.rehearsalMode],
    ["Provider", rehearsal.providerKey],
    ["Operator", rehearsal.operatorId],
    ["Resources", String(rehearsal.resources?.length || 0)],
    ["Phases", rehearsal.phases?.map((phase) => `${phase.name}:${phase.status}`).join(", ") || "-"],
    ["Side effect", String(rehearsal.sideEffectAllowed)],
    ["Blockers", rehearsal.gate?.blockers?.join(", ") || "-"]
  ])).join("") || empty("No provider rehearsals recorded.");

  $("#dedicated-order-cards").innerHTML = state.dedicatedWorkloadOrders.map((order) => card(order.id, [
    ["Status", order.status],
    ["Provider", order.providerKey],
    ["Operator", order.operatorId],
    ["Product", order.productId],
    ["Region", order.region],
    ["Mode", order.orderMode],
    ["Side effect", String(order.sideEffectAllowed)],
    ["Resource", order.providerResource?.providerResourceId || "-"],
    ["Blockers", order.gate?.blockers?.join(", ") || "-"]
  ])).join("") || empty("No dedicated workload orders recorded.");

  $("#live-rollback-plan-cards").innerHTML = state.liveRollbackPlans.map((plan) => card(plan.id, [
    ["Provider", plan.providerKey],
    ["Request", plan.requestId],
    ["Operator", plan.operatorId],
    ["Status", plan.status],
    ["Actions", String(plan.actions?.length || 0)],
    ["Side effect", String(plan.sideEffectAllowed)]
  ])).join("") || empty("No live rollback plans recorded.");

  $("#firecracker-qualification-cards").innerHTML = state.firecrackerQualifications.map((item) => card(item.hostId, [
    ["Mode", item.mode],
    ["Ready", String(item.readyForFirecrackerLaunch)],
    ["Exec", String(item.executionAllowed)],
    ["Checks", item.checks?.map((check) => `${check.key}:${check.status}`).join(", ")]
  ])).join("") || empty("No Firecracker host qualifications recorded.");

  $("#firecracker-rehearsal-cards").innerHTML = state.firecrackerLaunchRehearsals.map((item) => card(item.id, [
    ["Status", item.status],
    ["Host", item.hostId],
    ["Operator", item.operatorId],
    ["Runtimes", String(item.runtimes?.length || 0)],
    ["Real kernel", String(item.realKernelExecuted)],
    ["Secrets", String(item.secretsReleaseAllowed)],
    ["Blockers", item.blockers?.join(", ") || "-"]
  ])).join("") || empty("No Firecracker launch rehearsals recorded.");

  $("#cpu-confidential-qualification-cards").innerHTML = state.cpuConfidentialQualifications.map((item) => card(item.hostId, [
    ["CPU", `${item.cpuVendor} ${item.cpuModel}`],
    ["Mode", item.confidentialMode],
    ["Firecracker host", String(item.firecrackerHostApproved)],
    ["Attestation", String(item.attestation?.verified)],
    ["Secrets", String(item.secretsReleaseAllowed)]
  ])).join("") || empty("No CPU confidential-computing qualifications recorded.");

  const blue = state.blueTeamDashboard;
  setText("#blue-team-status", blue ? `Status: ${blue.status}` : "Status unavailable");
  setText("#blue-team-cdr", blue ? `CDR mandatory: ${blue.cdrMandatoryForAllOperators}` : "CDR unavailable");
  setText("#blue-team-content", blue ? `Content stored: ${blue.communicationContentStored}` : "No communication content");
  $("#blue-team-metadata-cards").innerHTML = (blue?.metadataSignals || []).map((item) => card(item.key, [
    ["Value", String(item.value)]
  ])).join("") || empty("No blue-team metadata yet.");
  $("#blue-team-alert-cards").innerHTML = (blue?.alerts || []).map((alert) => card(alert.summary || alert.signal, [
    ["Signal", alert.signal],
    ["Severity", alert.severity],
    ["Operator", alert.operatorId || "-"],
    ["Resource", alert.resource?.id || "-"],
    ["Content stored", String(alert.contentStored)]
  ])).join("") || empty("No alerts or anomalies.");
  $("#blue-team-cdr-cards").innerHTML = (blue?.cdrCoverage || []).map((row) => card(row.displayName || row.operatorId, [
    ["Status", row.status],
    ["Mandatory", String(row.cdrMandatory)],
    ["Decisions", String(row.decisions)],
    ["Allowed", String(row.allowed)],
    ["Quarantined", String(row.quarantined)],
    ["Blocked", String(row.blocked)],
    ["Content stored", String(row.contentStored)]
  ])).join("") || empty("No operator CDR coverage.");
  $("#blue-team-incident-cards").innerHTML = state.incidents.map((incident) => card(incident.sourceSignal, [
    ["Severity", incident.severity],
    ["Status", incident.status],
    ["Operator", incident.operatorId || "-"],
    ["Runbook", String(incident.runbookTasks?.length || 0)]
  ])).join("") || empty("No incidents.");

  $("#phantom-execution-request-cards").innerHTML = state.phantomExecutionRequests.map((item) => card(item.packageId, [
    ["Status", item.status],
    ["Lab exec", String(item.labExecutionAllowed)],
    ["Prod exec", String(item.productionExecutionAllowed)],
    ["Baseline unlock", String(item.baselineUnlockAllowed)],
    ["Blockers", item.blockers?.join(", ") || "-"]
  ])).join("") || empty("No PHANTOM execution requests recorded.");

  $("#device-cards").innerHTML = state.devices.map((device) => card(`${device.model}`, [
    ["Type", device.type],
    ["Serial", device.serial],
    ["Status", device.status],
    ["Operator", device.assignedOperatorId]
  ])).join("") || empty("No devices yet.");

  $("#job-cards").innerHTML = state.jobs.map((job) => card(job.id, [
    ["Status", job.status],
    ["Operator", job.operatorId],
    ["Steps", String(job.steps?.length || 0)],
    ["Rollback", String(job.rollbackPlan?.length || 0)]
  ])).join("") || empty("No jobs yet.");

  $("#app-cards").innerHTML = state.authorizedApps.map((app) => card(app.name, [
    ["Status", app.status],
    ["Type", app.type],
    ["Risk", app.riskClass],
    ["CDR", String(app.cdrRequired)]
  ])).join("") || empty("No authorized apps yet.");

  $("#subscription-plan-cards").innerHTML = state.subscriptionPlans.map((plan) => card(plan.name, [
    ["Tier", plan.tier],
    ["Max envs", String(plan.maxWorkloadEnvironments)],
    ["Per app", String(plan.maxAppsPerOperator)],
    ["Jurisdiction", `${plan.jurisdictionRotationMode} / min ${plan.jurisdictionPolicy?.minFrequencyHours || "-"}h`],
    ["Countries", String(plan.jurisdictionPolicy?.maxCountries || plan.regionCount)],
    ["Runtime classes", plan.providerPolicy?.allowedRuntimeClasses?.join(", ") || "-"],
    ["Confidential req", String(plan.providerPolicy?.confidentialComputeRequired)],
    ["Max session", `${plan.sessionPolicy?.maxHours || "-"}h`],
    ["PHANTOM exec", String(plan.phantomExecutionAllowed)]
  ])).join("") || empty("No subscription plans visible.");

  $("#tenant-subscription-cards").innerHTML = state.tenantSubscriptions.map((subscription) => card(subscription.tenantId, [
    ["Tier", subscription.tier],
    ["Billing", subscription.billingStatus],
    ["Add-ons", subscription.addons?.join(", ") || "-"],
    ["Max envs", String(subscription.effectiveLimits?.maxWorkloadEnvironments)]
  ])).join("") || empty("No tenant subscriptions yet.");

  $("#workload-allocation-cards").innerHTML = state.workloadAllocations.map((allocation) => card(allocation.appName, [
    ["Count", String(allocation.count)],
    ["Operator", allocation.operatorId],
    ["Layer", allocation.targetLayer],
    ["Execution", String(allocation.executionPlanned)]
  ])).join("") || empty("No workload allocations yet.");

  $("#quota-decision-cards").innerHTML = state.quotaDecisions.slice(-8).reverse().map((decision) => card(decision.decision, [
    ["Operator", decision.operatorId],
    ["Requested", String(decision.requestedCount)],
    ["Total after", String(decision.totalAfterChange)],
    ["Blockers", decision.blockers?.join(", ") || "-"]
  ])).join("") || empty("No quota decisions yet.");

  $("#readiness-cards").innerHTML = state.readinessResults.slice(-8).reverse().map((item) => card(item.operatorId, [
    ["Ready", String(item.readyForApproval)],
    ["Blockers", item.blockers?.join(", ") || "-"],
    ["Warnings", item.warnings?.join(", ") || "-"],
    ["Side effect", String(item.sideEffectAllowed)]
  ])).join("") || empty("Run an operator readiness check.");

  $("#approval-cards").innerHTML = state.provisioningApprovals.map((approval) => card(approval.reasonCode, [
    ["Status", approval.status],
    ["Operator", approval.operatorId],
    ["Plan", approval.planId],
    ["Execution", String(approval.executionAllowed)]
  ])).join("") || empty("No provisioning approvals yet.");

  $("#workload-lifecycle-cards").innerHTML = state.workloadLifecycle.map((item) => card(item.status, [
    ["Allocation", item.allocationId],
    ["Previous", item.previousStatus],
    ["Human gate", String(item.humanGateRequired)],
    ["Side effect", String(item.sideEffectAllowed)]
  ])).join("") || empty("No workload lifecycle transitions yet.");

  $("#session-cards").innerHTML = state.session ? card(state.session.email, [
    ["Role", state.session.role],
    ["Auth", state.session.authMethod],
    ["Expires", state.session.expiresAt],
    ["Step-up", state.session.stepUpValidUntil]
  ]) : empty("No active session.");

  $("#credential-cards").innerHTML = state.credentials.map((credential) => credentialCard(credential)).join("")
    || empty("No credentials visible.");

  $("#auth-policy-cards").innerHTML = state.authPolicy ? card("Auth policy matrix", [
    ["States", String(state.authPolicy.states?.length || 0)],
    ["Actions", String(Object.keys(state.authPolicy.actions || {}).length)],
    ["Recovery auto unlock", String(state.authPolicy.invariants?.recoveryAutoUnlock)],
    ["Break-glass side effect", String(state.authPolicy.invariants?.breakGlassSideEffectAllowed)]
  ]) : empty("Policy matrix not loaded.");

  const profileCards = [];
  if (state.adminFido2Policy) {
    profileCards.push(card("Admin FIDO2", [
      ["Mode", state.adminFido2Policy.mode],
      ["Session", `${state.adminFido2Policy.defaultSessionHours}h`],
      ["Enrollment", String(state.adminFido2Policy.actualEnrollmentAllowed)]
    ]));
  }
  if (state.adminHsmProfile) {
    profileCards.push(card("Admin HSM", [
      ["Mode", state.adminHsmProfile.mode],
      ["Provider", state.adminHsmProfile.provider],
      ["Refs", String(state.adminHsmProfile.references?.length || 0)],
      ["Material", String(state.adminHsmProfile.materialStored)]
    ]));
  }
  state.operatorSecurityProfiles.forEach(({ operator, fido2, hsm }) => {
    profileCards.push(card(operator.displayName, [
      ["Operator", operator.id],
      ["FIDO2", fido2 ? `${fido2.mode} / ${fido2.defaultSessionHours}h` : "-"],
      ["HSM", hsm ? `${hsm.mode} / refs ${hsm.references?.length || 0}` : "-"],
      ["Material", String(hsm?.materialStored === true)]
    ]));
  });
  $("#security-profile-cards").innerHTML = profileCards.join("") || empty("No security profiles loaded.");

  $("#recovery-cards").innerHTML = state.recoveryRequests.map((request) => card(request.affectedEmail, [
    ["Status", request.status],
    ["Reason", request.reasonCode],
    ["Auto unlock", String(request.autoUnlock)],
    ["Updated by", request.updatedBy]
  ])).join("") || empty("No recovery requests.");

  $("#break-glass-cards").innerHTML = state.breakGlassRequests.map((request) => card(request.actionScope, [
    ["Status", request.status],
    ["Human gate", String(request.humanGateRequired)],
    ["Side effect", String(request.sideEffectExecuted)],
    ["PHANTOM", request.phantomBoundary]
  ])).join("") || empty("No break-glass requests.");

  $("#phantom-boundary-cards").innerHTML = state.phantomBoundary ? card("PHANTOM v3.0", [
    ["Status", state.phantomBoundary.status],
    ["Human gate", String(state.phantomBoundary.humanGateRequired)],
    ["Side effect", String(state.phantomBoundary.sideEffectAllowed)],
    ["Boundary", state.phantomBoundary.phantomBoundary]
  ]) : empty("PHANTOM boundary is not available for this role.");

  $("#phantom-capability-cards").innerHTML = state.phantomCapabilities.map((item) => card(item.displayName, [
    ["Risk", item.riskLevel],
    ["Legal", item.legalReviewStatus],
    ["CISO", item.cisoReviewStatus],
    ["Execution", String(item.executionEnabled)]
  ])).join("") || empty("No PHANTOM capabilities recorded.");

  $("#phantom-approval-cards").innerHTML = state.phantomApprovals.map((item) => card(item.reasonCode, [
    ["Status", item.status],
    ["Legal", item.legalOwner],
    ["CISO", item.cisoOwner],
    ["Side effect", String(item.sideEffectAllowed)]
  ])).join("") || empty("No PHANTOM approvals recorded.");

  $("#phantom-risk-cards").innerHTML = state.phantomRisks.map((item) => card(item.description, [
    ["Severity", item.severity],
    ["Status", item.status],
    ["Residual", item.residualRisk],
    ["Gate", String(item.humanGateRequired)]
  ])).join("") || empty("No PHANTOM risks recorded.");

  $("#phantom-template-cards").innerHTML = state.phantomPolicyTemplates.map((item) => card(item.name, [
    ["Tier", item.tierMinimum],
    ["Controls", String(item.controlObjectives?.length || 0)],
    ["Evidence", String(item.requiredEvidenceTypes?.length || 0)],
    ["Execution", String(item.executionAllowed)]
  ])).join("") || empty("No PHANTOM policy templates visible.");

  $("#phantom-package-cards").innerHTML = state.phantomPackages.map((item) => card(item.name, [
    ["Stage", item.stage],
    ["Tier", item.tierMinimum],
    ["Readiness", item.readinessState],
    ["Execution", String(item.executionAllowed)]
  ])).join("") || empty("No PHANTOM packages recorded.");

  $("#phantom-review-matrix-cards").innerHTML = state.phantomPackages.map((pkg) => {
    const coverage = state.phantomCoverage.find((item) => item.packageId === pkg.id);
    const reviews = state.phantomReviewBoardItems.filter((item) => item.packageId === pkg.id);
    const ownerKeys = ["legal", "ciso", "architect", "compliance"];
    const acknowledged = reviews.flatMap((item) => ownerKeys.filter((owner) => item.ownerAcknowledgements?.[owner]));
    const exceptions = state.phantomExceptions.filter((item) => item.packageId === pkg.id);
    const expiredCount = exceptions.filter((item) => item.expired).length;
    return card(pkg.name, [
      ["Coverage", coverage ? `${coverage.coveragePercent}% ${coverage.status}` : "not evaluated"],
      ["Owner ack", `${new Set(acknowledged).size}/4`],
      ["Exceptions", `${exceptions.length} total / ${expiredCount} expired`],
      ["Blockers", coverage?.blockers?.join(", ") || (expiredCount ? "expired_exception_requires_review" : "-")],
      ["Execution", "false"]
    ]);
  }).join("") || empty("No PHANTOM packages recorded.");

  $("#phantom-evidence-cards").innerHTML = state.phantomEvidenceBundles.map((item) => card(item.summary, [
    ["Package", item.packageId],
    ["Retention", item.retentionClass],
    ["Sealed", String(item.sealed)],
    ["Hash", String(item.sealedHash || "").slice(0, 14)]
  ])).join("") || empty("No PHANTOM evidence bundles recorded.");

  $("#phantom-approval-pack-cards").innerHTML = state.phantomApprovalPacks.map((item) => card(item.summary, [
    ["Status", item.status],
    ["Owners", item.requiredOwners?.join(", ")],
    ["Evidence", String(item.evidenceBundleIds?.length || 0)],
    ["Execution", String(item.executionAllowed)]
  ])).join("") || empty("No PHANTOM approval packs recorded.");

  $("#phantom-readiness-cards").innerHTML = state.phantomReadiness.map((item) => card(item.gateState, [
    ["Package", item.packageId],
    ["Score", String(item.readinessScore)],
    ["Blockers", String(item.blockers?.length || 0)],
    ["Execution", String(item.executionAllowed)]
  ])).join("") || empty("No PHANTOM readiness evaluations recorded.");

  $("#phantom-simulation-cards").innerHTML = state.phantomSimulations.map((item) => card(item.scenario, [
    ["Mode", item.mode],
    ["Result", item.result],
    ["Findings", String(item.findings?.length || 0)],
    ["Side effect", String(item.sideEffectAllowed)]
  ])).join("") || empty("No PHANTOM simulations recorded.");

  $("#phantom-assignment-cards").innerHTML = state.phantomAssignmentPlans.map((item) => card(item.status, [
    ["Package", item.packageId],
    ["Operators", String(item.operators?.length || 0)],
    ["Execution", String(item.executionAllowed)],
    ["Gate", String(item.humanGateRequired)]
  ])).join("") || empty("No PHANTOM assignment plans recorded.");

  $("#phantom-review-board-cards").innerHTML = state.phantomReviewBoardItems.map((item) => card(item.title, [
    ["Status", item.status],
    ["Legal", item.legalOwner],
    ["Compliance", item.complianceOwner],
    ["Owner ack", ["legal", "ciso", "architect", "compliance"].map((owner) => `${owner}:${item.ownerAcknowledgements?.[owner] ? "yes" : "no"}`).join(" ")],
    ["Execution", String(item.executionAllowed)]
  ])).join("") || empty("No PHANTOM review board items recorded.");

  $("#phantom-policy-simulation-cards").innerHTML = state.phantomPolicySimulations.map((item) => card(item.scenario, [
    ["Mode", item.mode],
    ["Findings", String(item.findings?.length || 0)],
    ["Side effect", String(item.sideEffectAllowed)],
    ["Execution", String(item.executionAllowed)]
  ])).join("") || empty("No PHANTOM policy simulations recorded.");

  $("#phantom-exception-cards").innerHTML = state.phantomExceptions.map((item) => card(item.scope, [
    ["Status", item.status],
    ["Legal", item.legalOwner],
    ["Expired", String(item.expired)],
    ["Revalidation", item.expired ? "required" : "scheduled"],
    ["Expires", item.expiresAt],
    ["Compliance", item.complianceOwner],
    ["Execution", String(item.executionAllowed)]
  ])).join("") || empty("No PHANTOM exceptions recorded.");

  $("#phantom-coverage-cards").innerHTML = state.phantomCoverage.map((item) => card(item.packageId, [
    ["Coverage", `${item.coveragePercent}%`],
    ["Status", item.status],
    ["Blockers", item.blockers?.join(", ") || "-"],
    ["Certification", String(item.certificationClaim)]
  ])).join("") || empty("No PHANTOM coverage evaluations recorded.");

  $("#phantom-audit-correlation-cards").innerHTML = state.phantomAuditCorrelation ? card("PHANTOM audit correlation", [
    ["Events", String(state.phantomAuditCorrelation.eventCount)],
    ["Actions", String(state.phantomAuditCorrelation.actions?.length || 0)],
    ["Latest hash", String(state.phantomAuditCorrelation.latestHash || "").slice(0, 14)],
    ["Execution", String(state.phantomAuditCorrelation.executionAllowed)]
  ]) : empty("PHANTOM audit correlation unavailable.");

  renderRelease();

  const recent = state.audit.slice(-8).reverse();
  $("#audit-table").innerHTML = recent.map((event) => `
    <tr>
      <td>${escapeHtml(event.action)}</td>
      <td>${escapeHtml(event.resourceType || "-")}</td>
      <td>${escapeHtml(event.result)}</td>
      <td>${escapeHtml(event.timestamp)}</td>
    </tr>
  `).join("") || tableEmpty(4, "No audit events yet.");

  $("#audit-full-table").innerHTML = state.audit.slice().reverse().map((event) => `
    <tr>
      <td>${escapeHtml(event.actorId)}</td>
      <td>${escapeHtml(event.action)}</td>
      <td>${escapeHtml(event.resourceType || "-")}</td>
      <td>${escapeHtml(event.policyDecision)}</td>
      <td><code>${escapeHtml(String(event.hash || "").slice(0, 14))}</code></td>
    </tr>
  `).join("") || tableEmpty(5, "No audit events yet.");
}

function renderRelease() {
  const summary = state.releaseSummary;
  $("#release-decision").textContent = summary?.decision || "not evaluated";
  $("#release-ksiega").textContent = summary?.księga34
    ? `${summary.księga34.implemented} implemented / ${summary.księga34.blocked} blocked`
    : "Księga 3.4 unknown";
  $("#release-phantom").textContent = summary?.phantom?.executionSafe
    ? "PHANTOM execution=false"
    : "PHANTOM needs review";

  $("#release-gate-cards").innerHTML = state.releaseGates.map((gate) => card(gate.title, [
    ["Status", gate.status],
    ["Module", gate.moduleKey],
    ["Owner", gate.owner],
    ["Human gate", String(gate.humanGateRequired)],
    ["Prod exec", String(gate.productionExecutionAllowed)],
    ["Blockers", gate.blockers?.join(", ") || "-"]
  ])).join("") || empty("No release gates recorded.");

  $("#human-test-cards").innerHTML = state.humanTests.map((scenario) => card(scenario.title, [
    ["View", scenario.view],
    ["Status", scenario.status],
    ["Evidence", String(scenario.evidenceArtifactIds?.length || 0)],
    ["Last run", scenario.lastRunAt || "-"]
  ])).join("") || empty("No human test scenarios recorded.");

  $("#human-test-run-cards").innerHTML = state.humanTestRuns.map((run) => card(run.title, [
    ["Status", run.status],
    ["Mode", run.mode],
    ["Results", String(run.results?.length || 0)],
    ["Evidence", String(run.evidenceArtifactIds?.length || 0)],
    ["Prod exec", String(run.productionExecutionAllowed)]
  ])).join("") || empty("No full human test runs recorded.");

  $("#release-problem-cards").innerHTML = state.releaseProblems.map((problem) => card(problem.title, [
    ["Severity", problem.severity],
    ["Category", problem.category],
    ["Module", problem.moduleKey],
    ["Status", problem.status],
    ["Owner", problem.owner],
    ["Evidence", String(problem.evidenceArtifactIds?.length || 0)]
  ])).join("") || empty("No release problems recorded.");

  $("#evidence-artifact-cards").innerHTML = state.evidenceArtifacts.map((artifact) => card(artifact.path, [
    ["Type", artifact.type],
    ["Source", artifact.source],
    ["Module", artifact.linkedModule],
    ["Hash", String(artifact.sha256 || "").slice(0, 14)]
  ])).join("") || empty("No evidence artifacts indexed.");

  $("#release-ksiega-cards").innerHTML = (summary?.księga34?.controls || state.systemStatus?.ksiega34 || []).map((item) => card(item.label, [
    ["Key", item.key],
    ["Status", item.status],
    ["Next", item.nextAction]
  ])).join("") || empty("Księga 3.4 status unavailable.");

  $("#release-phantom-cards").innerHTML = [
    card("PHANTOM release boundary", [
      ["Execution safe", String(summary?.phantom?.executionSafe ?? false)],
      ["Execution allowed", String(summary?.phantom?.executionAllowed ?? false)],
      ["Certification claim", String(summary?.phantom?.certificationClaim ?? false)]
    ]),
    ...(summary?.phantom?.controls || state.systemStatus?.phantom || []).map((item) => card(item.label, [
      ["Key", item.key],
      ["Status", item.status],
      ["Execution", String(item.executionAllowed)]
    ]))
  ].join("");

  $("#release-live-execution-cards").innerHTML = [
    state.liveExecutionSummary ? card("Live cloud unlock", [
      ["Mode", state.liveExecutionSummary.providerMode],
      ["Live flag", String(state.liveExecutionSummary.liveAllowed)],
      ["Token", String(state.liveExecutionSummary.tokenConfigured)],
      ["State", state.liveExecutionSummary.baselineUnlockState]
    ]) : empty("Live execution summary unavailable."),
    card("Firecracker qualifications", [
      ["Records", String(state.firecrackerQualifications.length)],
      ["Ready", String(state.firecrackerQualifications.filter((item) => item.readyForFirecrackerLaunch).length)],
      ["Execution", "false"]
    ]),
    card("CPU confidential gate", [
      ["Records", String(state.cpuConfidentialQualifications.length)],
      ["TDX/SNP", String(state.cpuConfidentialQualifications.filter((item) => item.confidentialComputingApproved).length)],
      ["Secrets", String(state.cpuConfidentialQualifications.filter((item) => item.secretsReleaseAllowed).length)]
    ]),
    card("PHANTOM execution requests", [
      ["Records", String(state.phantomExecutionRequests.length)],
      ["Production", "false"],
      ["Baseline unlock", "false"]
    ])
  ].join("");

  $("#release-build-assessment-cards").innerHTML = state.releaseBuildAssessment ? [
    card("Build assessment", [
      ["Status", state.releaseBuildAssessment.status],
      ["Prod exec", String(state.releaseBuildAssessment.productionExecutionAllowed)],
      ["Księga blocked", String(state.releaseBuildAssessment.księga34?.blocked || 0)],
      ["Open problems", String(state.releaseBuildAssessment.testing?.openProblems?.length || 0)]
    ]),
    card("PHANTOM assessment", [
      ["Execution", String(state.releaseBuildAssessment.phantom?.executionAllowed)],
      ["Certification", String(state.releaseBuildAssessment.phantom?.certificationClaim)],
      ["Review items", String(state.releaseBuildAssessment.phantom?.reviewRequired?.length || 0)]
    ])
  ].join("") : empty("Build assessment unavailable.");
}

function renderSelect(selector, rows, emptyLabel, labelKey = "name") {
  const select = $(selector);
  if (!select) return;
  select.innerHTML = rows.length
    ? rows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row[labelKey] || row.id)}</option>`).join("")
    : `<option value="">${escapeHtml(emptyLabel)}</option>`;
}

function approvedApps() {
  return state.authorizedApps.filter((app) => app.status === "approved");
}

function empty(message) {
  return `<p class="empty">${escapeHtml(message)}</p>`;
}

function credentialCard(credential) {
  const active = credential.status === "active";
  return `
    <article class="mini-card" data-credential-id="${escapeHtml(credential.id)}">
      <strong>${escapeHtml(credential.id)}</strong>
      <p><span>Admin</span>${escapeHtml(credential.adminId)}</p>
      <p><span>Status</span>${escapeHtml(credential.status)}</p>
      <p><span>Transports</span>${escapeHtml(credential.transports?.join(", ") || "-")}</p>
      <p><span>Last used</span>${escapeHtml(credential.lastUsedAt || "-")}</p>
      <div class="button-row">
        <button type="button" class="secondary" data-credential-action="suspend" ${active ? "" : "disabled"}>Suspend</button>
        <button type="button" data-credential-action="revoke" ${active ? "" : "disabled"}>Revoke</button>
      </div>
    </article>
  `;
}

function tableEmpty(colspan, message) {
  return `<tr><td colspan="${colspan}" class="empty">${escapeHtml(message)}</td></tr>`;
}

function isStepUpRequired(error) {
  return error?.payload?.error?.code === "step_up_required";
}

async function withStepUpRetry(operation, actionLabel) {
  try {
    return await operation();
  } catch (error) {
    if (!isStepUpRequired(error)) {
      throw error;
    }
    await requestStepUp(error.payload.error.details, actionLabel);
    return operation();
  }
}

function requestStepUp(details = {}, actionLabel = "Sensitive action") {
  const modal = $("#step-up-modal");
  $("#step-up-action").textContent = `${actionLabel} requires fresh FIDO2 verification.`;
  $("#step-up-status").textContent = "";
  modal.hidden = false;
  return new Promise((resolve, reject) => {
    state.pendingStepUp = { details, resolve, reject };
  });
}

async function completeStepUp() {
  const pending = state.pendingStepUp;
  if (!pending) return;
  const status = $("#step-up-status");
  try {
    if (!state.credentialId) {
      throw new Error("Enroll a FIDO2 credential before step-up");
    }
    status.textContent = "Verifying";
    status.dataset.tone = "info";
    const options = await api("/auth/step-up/options", { method: "POST" });
    const assertion = state.webAuthnMode === "browser"
      ? await browserAssertion(options.challenge, state.credentialId)
      : simulatedAssertion(options.challenge.id, state.credentialId);
    const result = await api("/auth/step-up/verify", {
      method: "POST",
      body: {
        challengeId: options.challenge.id,
        credentialId: state.credentialId,
        assertion
      }
    });
    state.session = result.session;
    sessionStorage.setItem("sylion.admin.session", JSON.stringify(result.session));
    $("#step-up-modal").hidden = true;
    state.pendingStepUp = null;
    pending.resolve(result.session);
  } catch (error) {
    status.textContent = error.payload?.error?.message || error.message;
    status.dataset.tone = "error";
    pending.reject(error);
    state.pendingStepUp = null;
  }
}

function cancelStepUp() {
  if (state.pendingStepUp) {
    state.pendingStepUp.reject(new Error("Step-up cancelled"));
    state.pendingStepUp = null;
  }
  $("#step-up-modal").hidden = true;
}

async function createTenant(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/tenants", { method: "POST", body: data });
  toast("Tenant created");
  await refreshAll();
}

function simulatedAssertion(challengeId, credentialId, signCounter = Date.now()) {
  return {
    mode: "local_simulator",
    signature: `simulated:${challengeId}:${credentialId}`,
    signCounter
  };
}

async function browserEnrollmentCredential(options, credentialId) {
  if (!state.webAuthnSupported) {
    throw new Error("Browser WebAuthn is not available in this browser");
  }
  const publicKey = options.challenge.publicKey;
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: base64UrlToBuffer(publicKey.challenge),
      rp: { name: "SYLION Admin", id: publicKey.rpId },
      user: {
        id: new TextEncoder().encode(options.user.id),
        name: options.user.email,
        displayName: options.user.email
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { userVerification: "required" },
      timeout: publicKey.timeout,
      attestation: "none"
    }
  });
  return {
    mode: "browser",
    id: credential.id || credentialId,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    transports: ["browser"],
    response: {
      clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
      attestationObject: bufferToBase64Url(credential.response.attestationObject),
      attestationFormat: "browser"
    }
  };
}

async function browserAssertion(challenge, credentialId) {
  if (!state.webAuthnSupported) {
    throw new Error("Browser WebAuthn is not available in this browser");
  }
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: base64UrlToBuffer(challenge.publicKey.challenge),
      timeout: challenge.publicKey.timeout,
      rpId: challenge.publicKey.rpId,
      userVerification: "required",
      allowCredentials: [{
        id: base64UrlToBuffer(credentialId),
        type: "public-key"
      }]
    }
  });
  return {
    mode: "browser",
    id: assertion.id,
    rawId: bufferToBase64Url(assertion.rawId),
    type: assertion.type,
    origin: window.location.origin,
    rpId: challenge.publicKey.rpId,
    response: {
      clientDataJSON: bufferToBase64Url(assertion.response.clientDataJSON),
      authenticatorData: bufferToBase64Url(assertion.response.authenticatorData),
      signature: bufferToBase64Url(assertion.response.signature),
      userHandle: assertion.response.userHandle ? bufferToBase64Url(assertion.response.userHandle) : null
    }
  };
}

async function enrollSecurityKey() {
  const form = $("#login-form");
  const data = formData(form);
  const options = await api("/auth/webauthn/enrollment/options", {
    method: "POST",
    body: {
      email: data.email,
      password: data.password
    }
  });
  const credentialId = state.credentialId || `cred-ui-${crypto.randomUUID()}`;
  const credential = state.webAuthnMode === "browser"
    ? await browserEnrollmentCredential(options, credentialId)
    : {
        mode: "local_simulator",
        id: credentialId,
        publicKey: `simulated-public-key:${credentialId}`,
        transports: ["usb", "nfc"]
      };
  const result = await api("/auth/webauthn/enrollment/verify", {
    method: "POST",
    body: {
      challengeId: options.challenge.id,
      credential
    }
  });
  state.credentialId = result.credential.id;
  localStorage.setItem("sylion.admin.credentialId", result.credential.id);
  toast("FIDO2 credential enrolled locally");
}

function setWebAuthnMode(event) {
  state.webAuthnMode = event.currentTarget.value;
  localStorage.setItem("sylion.admin.webauthnMode", state.webAuthnMode);
  render();
}

async function createOperator(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const liveBaselineEnabled = event.currentTarget.liveBaselineEnabled.checked;
  const body = {
    tenantId: data.tenantId,
    displayName: data.displayName,
    tier: data.tier,
    requestedTemplates: ["whatsapp", "signal", "telegram"]
  };
  if (liveBaselineEnabled) {
    body.liveBaseline = {
      enabled: true,
      providerKey: "hetzner",
      providerId: data.liveProviderId,
      region: data.liveRegion || "fsn1",
      serverType: data.liveServerType || "cx22",
      image: data.liveImage || "ubuntu-24.04",
      idempotencyKey: data.liveIdempotencyKey || `operator-live-${crypto.randomUUID()}`,
      liveConfirmed: event.currentTarget.liveConfirmed.checked,
      evidenceRefs: ["admin-ui://operator-create-live-baseline"]
    };
  }
  await withStepUpRetry(() => api("/operators", {
    method: "POST",
    body
  }), liveBaselineEnabled ? "Create Operator Live Baseline" : "Create Operator");
  toast(liveBaselineEnabled
    ? "Operator created with live baseline gate decision"
    : "Operator created with automatic G1/G2/WORKLOAD baseline");
  await refreshAll();
}

async function createPipelineDraft(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  if (!data.operatorId) {
    toast("Create an operator before pipeline draft", "warn");
    return;
  }
  await api(`/operators/${data.operatorId}/provisioning-pipeline`, {
    method: "POST",
    body: { requestedTemplates: splitCsv(data.requestedTemplates) }
  });
  toast("Operator provisioning draft created");
  await refreshAll();
}

async function createLocalLabVpsSet(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  if (!data.pipelineId) {
    toast("Create a pipeline before local VPS set", "warn");
    return;
  }
  await api(`/operator-provisioning/pipelines/${data.pipelineId}/local-lab-vps`, { method: "POST" });
  toast("Local virtual VPS set created");
  await refreshAll();
}

async function checkSecretsRelease(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  if (!data.pipelineId) {
    toast("Create a pipeline before secrets check", "warn");
    return;
  }
  await api(`/operator-provisioning/pipelines/${data.pipelineId}/secrets-release-check`, { method: "POST" });
  toast("Secrets release remains blocked for local lab");
  await refreshAll();
}

async function createLocalEnvironment(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  if (!data.pipelineId) {
    toast("Create a local-lab pipeline before environment", "warn");
    return;
  }
  await api(`/operator-provisioning/pipelines/${data.pipelineId}/local-environment`, { method: "POST" });
  toast("Local operator environment created");
  await refreshAll();
}

async function startLocalEnvironment(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  if (!data.environmentId) {
    toast("Create an environment before start", "warn");
    return;
  }
  await api(`/operator-environments/${data.environmentId}/start-local`, { method: "POST" });
  toast("Local harness started");
  await refreshAll();
}

async function injectEnvironmentFailure(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  if (!data.environmentId) {
    toast("Create an environment before failure injection", "warn");
    return;
  }
  await api(`/operator-environments/${data.environmentId}/failures`, {
    method: "POST",
    body: {
      failureType: data.failureType,
      reason: data.reason
    }
  });
  toast("Local harness failure injected");
  await refreshAll();
}

async function rollbackEnvironment(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  if (!data.environmentId) {
    toast("Create an environment before rollback", "warn");
    return;
  }
  await api(`/operator-environments/${data.environmentId}/rollback`, {
    method: "POST",
    body: { reason: data.reason }
  });
  toast("Local harness rolled back");
  await refreshAll();
}

async function checkEnvironmentSecrets(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  if (!data.environmentId) {
    toast("Create an environment before secrets check", "warn");
    return;
  }
  await api(`/operator-environments/${data.environmentId}/secrets-release-check`, { method: "POST" });
  toast("Environment secrets remain blocked");
  await refreshAll();
}

async function loadOperatorConnectionPath(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  if (!data.operatorId) {
    toast("Create an operator before loading connection path", "warn");
    return;
  }
  const result = await api(`/operators/${data.operatorId}/connection-path?terminalMode=${encodeURIComponent(data.terminalMode)}`);
  state.operatorConnectionPath = result.path;
  toast("Operator connection path loaded");
  render();
}

async function generateRouterPackage(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  if (!data.operatorId) {
    toast("Create an operator before router package generation", "warn");
    return;
  }
  await api(`/operators/${data.operatorId}/router-package`, {
    method: "POST",
    body: {
      routerDeviceId: data.routerDeviceId || null,
      firmwareTarget: data.firmwareTarget,
      evidenceRefs: splitCsv(data.evidenceRefs)
    }
  });
  toast("Puli AX router package generated");
  await refreshAll();
}

async function validateRouterPosture(event) {
  event.preventDefault();
  const form = event.currentTarget.elements;
  const data = formData(event.currentTarget);
  if (!data.operatorId) {
    toast("Create an operator before router posture validation", "warn");
    return;
  }
  await api(`/operators/${data.operatorId}/router-posture`, {
    method: "POST",
    body: {
      packageId: data.packageId || null,
      routerDeviceId: data.routerDeviceId || null,
      evidence: {
        model: data.model,
        firmwareVersion: data.firmwareVersion,
        strongSwanInstalled: form.namedItem("strongSwanInstalled").checked,
        nftablesKillSwitch: form.namedItem("nftablesKillSwitch").checked,
        dnsTunnelOnly: form.namedItem("dnsTunnelOnly").checked,
        wanAdminDisabled: form.namedItem("wanAdminDisabled").checked,
        sshKeyAuthOnly: form.namedItem("sshKeyAuthOnly").checked,
        lanWanBypassBlocked: form.namedItem("lanWanBypassBlocked").checked,
        signedFirmwareVerified: form.namedItem("signedFirmwareVerified").checked,
        packageInstalled: form.namedItem("packageInstalled").checked
      },
      evidenceRefs: splitCsv(data.evidenceRefs)
    }
  });
  toast("Puli AX router posture validation recorded");
  await refreshAll();
}

async function createProvider(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = formData(event.currentTarget);
  await withStepUpRetry(() => api("/providers", {
    method: "POST",
    body: {
      providerType: data.providerType,
      apiSecret: data.apiSecret,
      regions: splitCsv(data.regions),
      countries: splitCsv(data.countries).map((country) => country.toUpperCase()),
      regionCatalog: parseRegionCatalog(data.regionCatalog),
      runtimeCapabilities: runtimeCapabilitiesForClass(data.runtimeClass),
      metadata: { providerRole: data.providerRole },
      billingHealth: { status: "healthy" },
      testConnection: { mode: "mock", status: "passed" }
    }
  }), "Save Provider");
  form.elements.namedItem("apiSecret").value = "";
  toast("Provider saved; secret cleared from form");
  await refreshAll();
}

function runtimeCapabilitiesForClass(runtimeClass) {
  if (runtimeClass === "firecracker") {
    return { containers: true, nestedKvm: true, bareMetalKvm: true, firecracker: true, androidWorkloads: "kvm_binderfs_review_required", intelTdx: false, amdSevSnp: false, recommendedTier: "PRO" };
  }
  if (runtimeClass === "confidential") {
    return { containers: true, nestedKvm: true, bareMetalKvm: true, firecracker: true, androidWorkloads: "kvm_binderfs_review_required", intelTdx: true, amdSevSnp: true, recommendedTier: "SOVEREIGN" };
  }
  return { containers: true, nestedKvm: false, bareMetalKvm: false, firecracker: false, androidWorkloads: false, intelTdx: false, amdSevSnp: false, recommendedTier: "STANDARD" };
}

async function createProviderDryRunPlan(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/providers/dry-run/vps-plan", {
    method: "POST",
    body: {
      providerId: data.providerId,
      operatorId: data.operatorId,
      region: data.region,
      vpsPerOperator: 3,
      mutationMode: "dry_run"
    }
  });
  toast("Provider dry-run plan recorded; no cloud mutation performed");
  await refreshAll();
}

async function configureSecretBackend(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await withStepUpRetry(() => api("/secrets/backends", {
    method: "POST",
    body: {
      backendType: data.backendType,
      displayName: data.displayName,
      endpointReference: data.endpointReference || null,
      keyRingReference: data.keyRingReference || null,
      hsmPartitionReference: data.hsmPartitionReference || null,
      mode: data.mode,
      evidenceRefs: splitCsv(data.evidenceRefs)
    }
  }), "Secret Backend Configure");
  toast("Secret backend contract recorded");
  await refreshAll();
}

async function requestLiveCloudVpsSet(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await withStepUpRetry(() => api("/live-execution/cloud/hetzner/vps-set", {
    method: "POST",
    extraHeaders: { "idempotency-key": data.idempotencyKey },
    body: {
      providerId: data.providerId,
      operatorId: data.operatorId,
      approvalId: data.approvalId,
      region: data.region,
      idempotencyKey: data.idempotencyKey,
      liveConfirmed: event.currentTarget.liveConfirmed.checked
    }
  }), "Live Cloud VPS Set");
  toast("Live cloud request recorded with gate decision");
  await refreshAll();
}

async function promoteOperatorBaselineToLive(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const provider = state.providers.find((item) => item.id === data.providerId);
  if (!provider) throw new Error("Select a provider before baseline promotion");
  if (!data.operatorId) throw new Error("Select an operator before baseline promotion");
  await withStepUpRetry(() => api(`/operators/${data.operatorId}/live-promotions/${provider.providerKey}`, {
    method: "POST",
    extraHeaders: { "idempotency-key": data.idempotencyKey },
    body: {
      providerId: data.providerId,
      approvalId: data.approvalId,
      region: data.region,
      idempotencyKey: data.idempotencyKey,
      liveConfirmed: event.currentTarget.liveConfirmed.checked,
      serverType: data.serverType,
      image: data.image
    }
  }), "Promote Operator Baseline");
  toast("Operator baseline promotion recorded with gate decision");
  await refreshAll();
}

async function runProviderRehearsal(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const provider = state.providers.find((item) => item.id === data.providerId);
  if (!provider) throw new Error("Select a provider before running rehearsal");
  await withStepUpRetry(() => api(`/live-execution/cloud/${provider.providerKey}/rehearsal`, {
    method: "POST",
    extraHeaders: { "idempotency-key": data.idempotencyKey },
    body: {
      providerId: data.providerId,
      operatorId: data.operatorId,
      approvalId: data.approvalId,
      region: data.region,
      idempotencyKey: data.idempotencyKey,
      rehearsalMode: data.rehearsalMode,
      liveConfirmed: event.currentTarget.liveConfirmed.checked,
      cleanupConfirmed: event.currentTarget.cleanupConfirmed.checked
    }
  }), "Provider Rehearsal");
  toast("Provider rehearsal completed");
  await refreshAll();
}

async function createDedicatedWorkloadOrder(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await withStepUpRetry(() => api("/live-execution/dedicated-workload/hetzner-robot/order", {
    method: "POST",
    body: {
      providerId: data.providerId,
      operatorId: data.operatorId,
      approvalId: data.approvalId,
      productId: data.productId,
      region: data.region,
      dist: data.dist,
      authorizedKeyRef: data.authorizedKeyRef,
      addons: splitCsv(data.addons),
      maxMonthlyPrice: data.maxMonthlyPrice ? Number(data.maxMonthlyPrice) : null,
      orderMode: data.orderMode,
      liveConfirmed: event.currentTarget.liveConfirmed.checked,
      costConfirmed: event.currentTarget.costConfirmed.checked,
      hardwareGateConfirmed: event.currentTarget.hardwareGateConfirmed.checked
    }
  }), "Dedicated Workload Order");
  toast("Dedicated workload order gate recorded");
  await refreshAll();
}

async function qualifyFirecrackerHost(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await withStepUpRetry(() => api("/live-execution/firecracker/host-qualification", {
    method: "POST",
    body: {
      hostId: data.hostId,
      approvalId: data.approvalId || null
    }
  }), "Firecracker Host Qualification");
  toast("Firecracker host qualification recorded");
  await refreshAll();
}

async function runFirecrackerLaunchRehearsal(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await withStepUpRetry(() => api("/live-execution/firecracker/launch-rehearsal", {
    method: "POST",
    body: {
      hostQualificationId: data.hostQualificationId,
      operatorId: data.operatorId,
      workloadNames: splitCsv(data.workloadNames),
      imageRef: data.imageRef,
      kernelRef: data.kernelRef,
      rootfsRef: data.rootfsRef,
      networkMode: data.networkMode,
      rehearsalConfirmed: event.currentTarget.rehearsalConfirmed.checked
    }
  }), "Firecracker Launch Rehearsal");
  toast("Firecracker launch rehearsal recorded");
  await refreshAll();
}

async function qualifyCpuConfidentialHost(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const form = event.currentTarget.elements;
  await withStepUpRetry(() => api("/live-execution/cpu-confidential/qualification", {
    method: "POST",
    body: {
      hostId: data.hostId,
      cpuVendor: data.cpuVendor,
      cpuModel: data.cpuModel,
      confidentialMode: data.confidentialMode,
      tierTarget: data.tierTarget,
      featureFlags: {
        virtualization: form.namedItem("virtualization").checked,
        iommu: form.namedItem("iommu").checked,
        tpm2: form.namedItem("tpm2").checked,
        secureBoot: form.namedItem("secureBoot").checked,
        kernelLockdown: form.namedItem("kernelLockdown").checked,
        microcodeCurrent: form.namedItem("microcodeCurrent").checked
      },
      attestation: {
        verified: form.namedItem("attestationVerified").checked,
        measurementRef: data.measurementRef,
        verifier: data.verifier
      },
      evidenceRefs: splitCsv(data.evidenceRefs)
    }
  }), "CPU Confidential Qualification");
  toast("CPU confidential-computing qualification recorded");
  await refreshAll();
}

async function createApprovedWorkloadApp(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const created = await api("/apps", {
    method: "POST",
    body: {
      name: data.name,
      type: data.type,
      riskClass: data.riskClass,
      allowedTiers: splitCsv(data.allowedTiers),
      microVmDefaults: {
        vcpu: Number(data.vcpu),
        memoryMiB: Number(data.memoryMiB),
        diskMiB: Number(data.diskMiB)
      },
      networkPolicy: { outbound: ["tcp/443"], inbound: [] },
      storagePolicy: { persistent: false, maxEphemeralMiB: 1024 },
      clipboardPolicy: { mode: "metadata_only", pasteIntoWorkload: false },
      cdrRequired: true,
      operatorResponsibility: "Operator must route all file exchange through CDR."
    }
  });
  await api(`/apps/${created.app.id}/approve`, { method: "POST" });
  toast("Authorized app created and approved");
  await refreshAll();
}

async function updateTenantSubscription(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const addons = [];
  if (data.matrixAddon === "on") addons.push("matrix_custom_server");
  if (data.phantomAddon === "on") addons.push("phantom_admin_lifecycle");
  await api(`/tenants/${data.tenantId}/subscription`, {
    method: "POST",
    body: {
      planId: data.planId,
      addons
    }
  });
  toast("Subscription updated");
  await refreshAll();
}

async function updateBillingState(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api(`/tenants/${data.tenantId}/billing-state`, {
    method: "POST",
    body: { billingStatus: data.billingStatus }
  });
  toast("Billing state updated");
  await refreshAll();
}

async function quoteWorkloadAllocation(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api(`/operators/${data.operatorId}/workload-allocations/quote`, {
    method: "POST",
    body: {
      appId: data.appId,
      requestedCount: Number(data.requestedCount)
    }
  });
  toast("Quota quote recorded");
  await refreshAll();
}

async function createWorkloadAllocation(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const result = await api(`/operators/${data.operatorId}/workload-allocations`, {
    method: "POST",
    body: {
      appId: data.appId,
      requestedCount: Number(data.requestedCount)
    }
  });
  state.lastAllocationId = result.allocation.id;
  toast("Workload allocation created");
  await refreshAll();
}

async function createPlacementPlan(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api(`/operators/${data.operatorId}/microvm-placement-plan`, {
    method: "POST",
    body: { allocationId: data.allocationId }
  });
  toast("MicroVM placement plan created; no execution performed");
  await refreshAll();
}

async function evaluateOperatorReadiness(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const result = await api(`/operators/${data.operatorId}/readiness`);
  state.readinessResults.push(result.readiness);
  toast(result.readiness.readyForApproval ? "Operator readiness passed" : "Operator readiness has blockers", result.readiness.readyForApproval ? "info" : "error");
  render();
  await refreshAll();
}

async function createProvisioningApproval(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const result = await api("/provisioning/approvals", {
    method: "POST",
    body: {
      operatorId: data.operatorId,
      planId: data.planId || state.lastPlanId,
      reasonCode: data.reasonCode,
      evidenceRefs: splitCsv(data.evidenceRefs)
    }
  });
  $("#job-approval-id").value = result.approval.id;
  toast("Provisioning approval created");
  await refreshAll();
}

async function updateProvisioningApprovalStatus(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api(`/provisioning/approvals/${data.approvalId}/status`, {
    method: "POST",
    body: {
      status: data.status,
      note: data.note
    }
  });
  $("#job-approval-id").value = data.approvalId;
  toast("Provisioning approval status updated");
  await refreshAll();
}

async function transitionWorkloadLifecycle(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  if (!data.allocationId) {
    toast("Create a workload allocation before lifecycle transition");
    return;
  }
  await api(`/workload/allocations/${data.allocationId}/lifecycle`, {
    method: "POST",
    body: {
      status: data.status,
      approvalId: data.approvalId || undefined,
      reasonCode: data.reasonCode
    }
  });
  toast("Workload lifecycle transition recorded");
  await refreshAll();
}

async function registerDevice(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/devices", {
    method: "POST",
    body: {
      ...data,
      posture: { state: "registered_from_ui" },
      qualificationStatus: data.type === "puli_ax_router" ? "needs_evidence" : "not_applicable"
    }
  });
  toast("Device registered");
  await refreshAll();
}

async function updateAdminFido2Policy(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/security/admin/fido2-policy", {
    method: "POST",
    body: {
      mode: "enrollment_deferred",
      defaultSessionHours: Number(data.defaultSessionHours),
      allowedTransports: splitCsv(data.allowedTransports)
    }
  });
  toast("Admin FIDO2 policy saved; physical enrollment remains gated");
  await refreshAll();
}

async function updateAdminHsmProfile(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/security/admin/hsm-profile", {
    method: "POST",
    body: {
      mode: "reference_only",
      references: splitCsv(data.references),
      attestationRefs: splitCsv(data.attestationRefs)
    }
  });
  toast("Admin HSM references saved");
  await refreshAll();
}

async function updateOperatorFido2Policy(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api(`/operators/${data.operatorId}/security/fido2-policy`, {
    method: "POST",
    body: {
      mode: "enrollment_deferred",
      defaultSessionHours: Number(data.defaultSessionHours),
      allowedTransports: splitCsv(data.allowedTransports)
    }
  });
  toast("Operator FIDO2 policy saved");
  await refreshAll();
}

async function updateOperatorHsmProfile(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api(`/operators/${data.operatorId}/security/hsm-profile`, {
    method: "POST",
    body: {
      mode: "byo_hsm_deferred",
      references: splitCsv(data.references),
      attestationRefs: splitCsv(data.attestationRefs)
    }
  });
  toast("Operator HSM references saved");
  await refreshAll();
}

async function createRecoveryRequest(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/auth/recovery/request", {
    method: "POST",
    body: {
      email: data.email,
      reasonCode: data.reasonCode,
      requester: {
        actorId: state.session?.adminId || "admin_ui",
        sessionId: state.session?.id || null,
        note: data.note
      }
    }
  });
  toast("Recovery request recorded; no automatic unlock executed");
  event.currentTarget.reset();
  await refreshAll();
}

async function createBreakGlassRequest(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/auth/break-glass/requests", {
    method: "POST",
    body: {
      actionScope: data.actionScope,
      reasonCode: data.reasonCode
    }
  });
  toast("Break-glass placeholder recorded; HUMAN GATE required");
  await refreshAll();
}

async function createPhantomCapability(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/phantom/capabilities", {
    method: "POST",
    body: {
      displayName: data.displayName,
      riskLevel: data.riskLevel,
      controlsRequired: splitCsv(data.controlsRequired)
    }
  });
  toast("PHANTOM capability metadata recorded");
  await refreshAll();
}

async function createPhantomApproval(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/phantom/approvals", {
    method: "POST",
    body: {
      reasonCode: data.reasonCode,
      legalOwner: data.legalOwner,
      cisoOwner: data.cisoOwner,
      architectOwner: data.architectOwner
    }
  });
  toast("PHANTOM approval request recorded");
  await refreshAll();
}

async function createPhantomRisk(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/phantom/risks", {
    method: "POST",
    body: {
      description: data.description,
      severity: data.severity,
      legalOwner: "legal@sylion.local",
      cisoOwner: "ciso@sylion.local",
      residualRisk: data.residualRisk,
      mitigationPlan: data.mitigationPlan
    }
  });
  toast("PHANTOM risk recorded");
  await refreshAll();
}

async function createPhantomPackage(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/phantom/packages", {
    method: "POST",
    body: {
      name: data.name,
      description: data.description,
      policyTemplateId: data.policyTemplateId,
      capabilityIds: data.capabilityId ? [data.capabilityId] : [],
      tierMinimum: data.tierMinimum
    }
  });
  toast("PHANTOM package recorded; execution remains blocked");
  await refreshAll();
}

async function createPhantomEvidenceBundle(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/phantom/evidence-bundles", {
    method: "POST",
    body: {
      packageId: data.packageId,
      summary: data.summary,
      evidenceRefs: splitCsv(data.evidenceRefs),
      controlsSatisfied: splitCsv(data.controlsSatisfied),
      retentionClass: data.retentionClass
    }
  });
  toast("PHANTOM evidence bundle sealed");
  await refreshAll();
}

async function createPhantomApprovalPack(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/phantom/approval-packs", {
    method: "POST",
    body: {
      packageId: data.packageId,
      approvalIds: state.phantomApprovals.map((item) => item.id),
      evidenceBundleIds: state.phantomEvidenceBundles.map((item) => item.id),
      summary: data.summary
    }
  });
  toast("PHANTOM approval pack recorded for HUMAN GATE");
  await refreshAll();
}

async function evaluatePhantomReadiness(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/phantom/readiness/evaluate", {
    method: "POST",
    body: {
      packageId: data.packageId,
      approvalPackId: data.approvalPackId,
      evidenceBundleId: data.evidenceBundleId,
      operatorId: data.operatorId
    }
  });
  toast("PHANTOM readiness evaluated; execution still blocked");
  await refreshAll();
}

async function runPhantomSimulation(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/phantom/simulations", {
    method: "POST",
    body: {
      packageId: data.packageId,
      scenario: data.scenario,
      assumptions: splitCsv(data.assumptions)
    }
  });
  toast("PHANTOM simulation-only run recorded");
  await refreshAll();
}

async function createPhantomAssignmentPlan(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/phantom/assignment-plans", {
    method: "POST",
    body: {
      packageId: data.packageId,
      operatorIds: data.operatorId ? [data.operatorId] : []
    }
  });
  toast("PHANTOM assignment plan recorded");
  await refreshAll();
}

async function createPhantomReviewBoardItem(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/phantom/review-board", {
    method: "POST",
    body: {
      title: data.title,
      summary: data.summary,
      packageId: data.packageId,
      legalOwner: data.legalOwner,
      cisoOwner: data.cisoOwner,
      architectOwner: data.architectOwner,
      complianceOwner: data.complianceOwner
    }
  });
  toast("PHANTOM review board item recorded");
  await refreshAll();
}

async function runPhantomPolicySimulation(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/phantom/policy-simulations", {
    method: "POST",
    body: {
      packageId: data.packageId,
      scenario: data.scenario,
      expectedControls: splitCsv(data.expectedControls)
    }
  });
  toast("PHANTOM policy simulation recorded");
  await refreshAll();
}

async function createPhantomException(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/phantom/exceptions", {
    method: "POST",
    body: {
      packageId: data.packageId,
      reviewBoardItemId: data.reviewBoardItemId,
      evidenceBundleId: data.evidenceBundleId,
      scope: data.scope,
      justification: data.justification,
      expiresAt: data.expiresAt,
      legalOwner: data.legalOwner,
      cisoOwner: data.cisoOwner,
      complianceOwner: data.complianceOwner
    }
  });
  toast("PHANTOM exception recorded without execution");
  await refreshAll();
}

async function acknowledgePhantomReviewOwner(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api(`/phantom/review-board/${data.itemId}/ack`, {
    method: "POST",
    body: { owner: data.owner }
  });
  toast("PHANTOM review owner acknowledgement recorded");
  await refreshAll();
}

async function evaluatePhantomCoverage(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const result = await api(`/phantom/packages/${data.packageId}/evidence-coverage`);
  state.phantomCoverage = [result.coverage, ...state.phantomCoverage.filter((item) => item.packageId !== result.coverage.packageId)];
  toast("PHANTOM evidence coverage evaluated without execution");
  render();
}

async function createPhantomExecutionRequest(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await withStepUpRetry(() => api("/live-execution/phantom/request", {
    method: "POST",
    body: {
      packageId: data.packageId,
      purpose: data.purpose,
      owners: splitCsv(data.owners),
      evidenceRefs: splitCsv(data.evidenceRefs),
      expiresAt: data.expiresAt,
      labConfirmed: event.currentTarget.labConfirmed.checked
    }
  }), "PHANTOM Execution Request");
  toast("PHANTOM execution request gated; baseline remains locked");
  await refreshAll();
}

async function createEvidenceArtifact(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/release/evidence-artifacts", {
    method: "POST",
    body: {
      type: data.type,
      path: data.path,
      source: data.source,
      linkedModule: data.linkedModule
    }
  });
  toast("Evidence artifact indexed for release gate review");
  await refreshAll();
}

async function createReleaseProblem(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api("/release/problems", {
    method: "POST",
    body: {
      title: data.title,
      severity: data.severity,
      category: data.category,
      moduleKey: data.moduleKey,
      owner: data.owner,
      evidenceArtifactIds: splitCsv(data.evidenceArtifactIds)
    }
  });
  toast("Release problem recorded");
  await refreshAll();
}

async function updateHumanTestStatus(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await api(`/release/human-tests/${data.scenarioId}/status`, {
    method: "POST",
    body: {
      status: data.status,
      evidenceArtifactIds: splitCsv(data.evidenceArtifactIds),
      note: data.note
    }
  });
  toast("Human test scenario status updated");
  await refreshAll();
}

async function recordHumanTestRun(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const results = state.humanTests.map((scenario) => ({
    scenarioId: scenario.id,
    view: scenario.view,
    status: data.status,
    note: data.note
  }));
  await api("/release/human-test-runs", {
    method: "POST",
    body: {
      mode: data.mode,
      title: data.title,
      evidenceArtifactIds: splitCsv(data.evidenceArtifactIds),
      environment: data.environment,
      results
    }
  });
  toast("Full human test run recorded");
  await refreshAll();
}

async function recordBlueTeamSignal(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const operator = state.operators.find((item) => item.id === data.operatorId);
  await api("/monitoring/signals", {
    method: "POST",
    body: {
      signal: data.signal,
      tenantId: operator?.tenantId || null,
      operatorId: data.operatorId || null,
      resource: {
        id: data.resourceId,
        kind: "blue_team_signal"
      },
      details: {
        detector: "admin_blue_team_panel",
        evidenceRef: data.evidenceRef
      }
    }
  });
  toast("Blue-team signal recorded");
  await refreshAll();
}

async function handleCredentialAction(event) {
  const action = event.target.dataset.credentialAction;
  if (!action) return;
  const card = event.target.closest("[data-credential-id]");
  const credentialId = card?.dataset.credentialId;
  if (!credentialId) return;
  await withStepUpRetry(() => api(`/auth/credentials/${credentialId}/${action}`, {
    method: "POST",
    body: { reasonCode: `ui_${action}` }
  }), `Credential ${action}`);
  toast(`Credential ${action} recorded`);
  await refreshAll();
}

async function generatePlan(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const result = await api(`/operators/${data.operatorId}/provisioning-plan`, {
    method: "POST",
    body: { requestedApps: splitCsv(data.requestedApps) }
  });
  state.lastPlanId = result.plan.id;
  state.lastPlanOperatorId = data.operatorId;
  $("#job-plan-id").value = result.plan.id;
  $("#job-operator-select").value = data.operatorId;
  $("#approval-plan-id").value = result.plan.id;
  $("#approval-operator-select").value = data.operatorId;
  toast("Provisioning plan generated");
  await refreshAll();
}

async function executeJob(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  const operator = state.operators.find((item) => item.id === data.operatorId);
  if (!operator) {
    throw new Error("Select an operator before executing a plan");
  }
  const operatorDevices = state.devices.filter((device) => device.assignedOperatorId === operator?.id);
  const pixel = operatorDevices.find((device) => device.type === "pixel_grapheneos");
  const router = operatorDevices.find((device) => device.type === "puli_ax_router");
  await withStepUpRetry(() => api("/orchestrator/jobs", {
    method: "POST",
    extraHeaders: { "idempotency-key": `ui_${data.planId}` },
    body: {
      planId: data.planId,
      provider: data.provider,
      region: data.region,
      imageRef: "image://sylion/base/dev",
      pixelDeviceId: pixel?.id,
      routerDeviceId: router?.id,
      approvalId: data.approvalId || undefined,
      approvalRequired: data.approvalRequired === "on",
      idempotencyKey: `ui_${data.planId}`
    }
  }), "Execute Plan");
  toast("Orchestrator job completed");
  await refreshAll();
}

async function runDemoFlow() {
  $("#flow-state").textContent = "Running";
  const suffix = Date.now();
  const tenant = await api("/tenants", {
    method: "POST",
    body: { name: `Demo Tenant ${suffix}`, tier: "PRO" }
  });
  const operator = await api("/operators", {
    method: "POST",
    body: {
      tenantId: tenant.tenant.id,
      displayName: `Demo Operator ${suffix}`,
      tier: "PRO"
    }
  });
  await withStepUpRetry(() => api("/providers", {
    method: "POST",
    body: {
      providerType: "hetzner",
      apiSecret: `demo-secret-${suffix}`,
      regions: ["fsn1"],
      billingHealth: { status: "healthy" },
      testConnection: { mode: "mock", status: "passed" }
    }
  }), "Run Demo Flow provider setup");
  const pixel = await api("/devices", {
    method: "POST",
    body: {
      type: "pixel_grapheneos",
      serial: `pixel-demo-${suffix}`,
      model: "Google Pixel",
      assignedOperatorId: operator.operator.id
    }
  });
  const router = await api("/devices", {
    method: "POST",
    body: {
      type: "puli_ax_router",
      serial: `puli-demo-${suffix}`,
      model: "GL.iNet GL-XE3000 Puli AX",
      assignedOperatorId: operator.operator.id,
      qualificationStatus: "needs_evidence"
    }
  });
  await api("/devices", {
    method: "POST",
    body: {
      type: "fido2_key",
      serial: `fido-demo-${suffix}`,
      model: "YubiKey",
      assignedOperatorId: operator.operator.id
    }
  });
  const app = await api("/apps", {
    method: "POST",
    body: {
      name: `Signal Demo ${suffix}`,
      type: "messaging",
      riskClass: "medium",
      allowedTiers: ["STANDARD", "PRO", "SOVEREIGN"],
      microVmDefaults: { vcpu: 2, memoryMiB: 2048, diskMiB: 8192 },
      networkPolicy: { outbound: ["tcp/443"], inbound: [] },
      storagePolicy: { persistent: false, maxEphemeralMiB: 1024 },
      clipboardPolicy: { mode: "metadata_only", pasteIntoWorkload: false },
      cdrRequired: true,
      operatorResponsibility: "Operator must route all file exchange through CDR."
    }
  });
  const approvedApp = await api(`/apps/${app.app.id}/approve`, { method: "POST" });
  const allocation = await api(`/operators/${operator.operator.id}/workload-allocations`, {
    method: "POST",
    body: { appId: approvedApp.app.id, requestedCount: 1 }
  });
  const plan = await api(`/operators/${operator.operator.id}/provisioning-plan`, {
    method: "POST",
    body: { requestedApps: ["Signal", "Telegram"] }
  });
  const approval = await api("/provisioning/approvals", {
    method: "POST",
    body: {
      operatorId: operator.operator.id,
      planId: plan.plan.id,
      allocationId: allocation.allocation.id,
      reasonCode: "demo_flow_execution_review",
      evidenceRefs: ["demo-readiness", "demo-security-review"]
    }
  });
  await api(`/provisioning/approvals/${approval.approval.id}/status`, {
    method: "POST",
    body: { status: "approved_for_execution", note: "Demo flow human gate simulation" }
  });
  state.lastPlanId = plan.plan.id;
  state.lastPlanOperatorId = operator.operator.id;
  await withStepUpRetry(() => api("/orchestrator/jobs", {
    method: "POST",
    extraHeaders: { "idempotency-key": `demo_${suffix}` },
    body: {
      planId: plan.plan.id,
      provider: "hetzner",
      region: "fsn1",
      imageRef: "image://sylion/base/dev",
      pixelDeviceId: pixel.device.id,
      routerDeviceId: router.device.id,
      approvalId: approval.approval.id,
      idempotencyKey: `demo_${suffix}`
    }
  }), "Run Demo Flow job execution");
  const phantomCapability = await api("/phantom/capabilities", {
    method: "POST",
    body: {
      displayName: `Demo PHANTOM Capability ${suffix}`,
      riskLevel: "restricted",
      controlsRequired: ["Legal review", "CISO review", "Architect review", "Compliance review"]
    }
  });
  const phantomApproval = await api("/phantom/approvals", {
    method: "POST",
    body: {
      reasonCode: "demo_governance_review",
      legalOwner: "legal@sylion.local",
      cisoOwner: "ciso@sylion.local",
      architectOwner: "architect@sylion.local",
      evidenceRefs: ["demo-phantom-governance-ref"]
    }
  });
  await api(`/phantom/approvals/${phantomApproval.approval.id}/status`, {
    method: "POST",
    body: { status: "approved_placeholder", note: "Demo placeholder only; execution remains false" }
  });
  await api("/phantom/risks", {
    method: "POST",
    body: {
      description: `Demo PHANTOM risk ${suffix}`,
      severity: "high",
      legalOwner: "legal@sylion.local",
      cisoOwner: "ciso@sylion.local",
      residualRisk: "Requires human gate and no baseline execution approval.",
      mitigationPlan: "Keep PHANTOM as separate governance track with evidence-only review.",
      evidenceRefs: ["demo-risk-ref"]
    }
  });
  const templates = await api("/phantom/policy-templates");
  const phantomPackage = await api("/phantom/packages", {
    method: "POST",
    body: {
      name: `Demo PHANTOM Package ${suffix}`,
      description: "Administrative readiness and evidence lifecycle only.",
      policyTemplateId: templates.templates[0].id,
      capabilityIds: [phantomCapability.capability.id],
      tierMinimum: "PRO"
    }
  });
  const phantomEvidence = await api("/phantom/evidence-bundles", {
    method: "POST",
    body: {
      packageId: phantomPackage.package.id,
      summary: "Demo PHANTOM evidence bundle",
      evidenceRefs: ["legal memo", "CISO risk note", "architect boundary note"],
      controlsSatisfied: ["Human gate ownership", "No baseline execution"]
    }
  });
  const phantomPack = await api("/phantom/approval-packs", {
    method: "POST",
    body: {
      packageId: phantomPackage.package.id,
      approvalIds: [phantomApproval.approval.id],
      evidenceBundleIds: [phantomEvidence.bundle.id],
      summary: "Demo PHANTOM approval pack"
    }
  });
  await api("/phantom/readiness/evaluate", {
    method: "POST",
    body: {
      packageId: phantomPackage.package.id,
      approvalPackId: phantomPack.pack.id,
      evidenceBundleId: phantomEvidence.bundle.id,
      operatorId: operator.operator.id
    }
  });
  await api("/phantom/simulations", {
    method: "POST",
    body: {
      packageId: phantomPackage.package.id,
      scenario: "readiness_review",
      assumptions: ["No live connector", "Panel review only"],
      operatorId: operator.operator.id
    }
  });
  await api("/phantom/assignment-plans", {
    method: "POST",
    body: {
      packageId: phantomPackage.package.id,
      operators: [operator.operator.id]
    }
  });
  const phantomReview = await api("/phantom/review-board", {
    method: "POST",
    body: {
      packageId: phantomPackage.package.id,
      title: "Demo PHANTOM governance board review",
      summary: "Control-plane readiness review only",
      legalOwner: "legal@sylion.local",
      cisoOwner: "ciso@sylion.local",
      architectOwner: "architect@sylion.local",
      complianceOwner: "compliance@sylion.local",
      evidenceRefs: ["demo-review-board-ref"]
    }
  });
  for (const owner of ["legal", "ciso", "architect", "compliance"]) {
    await api(`/phantom/review-board/${phantomReview.item.id}/ack`, {
      method: "POST",
      body: { owner, note: `Demo acknowledgement: ${owner}` }
    });
  }
  await api("/phantom/policy-simulations", {
    method: "POST",
    body: {
      packageId: phantomPackage.package.id,
      scenario: "control_gap",
      assumptions: ["Metadata only", "No baseline execution"],
      expectedControls: ["Human gate", "No baseline execution", "Legal sign-off"]
    }
  });
  await api("/phantom/exceptions", {
    method: "POST",
    body: {
      packageId: phantomPackage.package.id,
      reviewBoardItemId: phantomReview.item.id,
      evidenceBundleId: phantomEvidence.bundle.id,
      scope: "Demo review timing exception",
      justification: "Administrative review sequencing exception only",
      expiresAt: "2026-12-31T23:00:00.000Z",
      legalOwner: "legal@sylion.local",
      cisoOwner: "ciso@sylion.local",
      complianceOwner: "compliance@sylion.local"
    }
  });
  await api(`/phantom/packages/${phantomPackage.package.id}/evidence-coverage`);
  $("#flow-state").textContent = "Completed";
  toast("Demo flow completed");
  await refreshAll();
}

function setView(name) {
  $$(".view").forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== name;
  });
  $$("nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  const titles = {
    dashboard: ["Overview", "Live operations cockpit connected to the SYLION Admin API."],
    operators: ["Operators", "Create tenants and operators."],
    provisioning: ["Provisioning", "Generate plans and execute orchestrator jobs."],
    approvals: ["Approvals", "Review readiness, execution gates and workload lifecycle."],
    subscriptions: ["Subscriptions", "Manage tiers, add-ons, workload quotas and billing state."],
    devices: ["Devices", "Register Pixel, Puli AX and FIDO2 assets."],
    providers: ["Providers", "Add provider accounts without retaining plaintext secrets."],
    "blue-team": ["Blue Team", "Metadata-only defensive monitoring, CDR coverage, alerts and anomalies."],
    security: ["Security", "Review core V2 security boundaries."],
    phantom: ["PHANTOM", "Governance-only separate track with HUMAN GATE."],
    release: ["Release", "Production readiness gates, human tests, problem registry and evidence."],
    audit: ["Audit", "Inspect hash-chained audit events."]
  };
  $("#view-title").textContent = titles[name]?.[0] || "Dashboard";
  $("#view-subtitle").textContent = titles[name]?.[1] || "";
}

function bind() {
  $("#login-form").addEventListener("submit", (event) => login(event).catch(showError));
  $("#enroll-button").addEventListener("click", () => enrollSecurityKey().catch(showError));
  $("#tenant-form").addEventListener("submit", (event) => createTenant(event).catch(showError));
  $("#operator-form").addEventListener("submit", (event) => createOperator(event).catch(showError));
  $("#pipeline-draft-form").addEventListener("submit", (event) => createPipelineDraft(event).catch(showError));
  $("#local-lab-vps-form").addEventListener("submit", (event) => createLocalLabVpsSet(event).catch(showError));
  $("#secrets-release-check-form").addEventListener("submit", (event) => checkSecretsRelease(event).catch(showError));
  $("#local-environment-form").addEventListener("submit", (event) => createLocalEnvironment(event).catch(showError));
  $("#environment-start-form").addEventListener("submit", (event) => startLocalEnvironment(event).catch(showError));
  $("#environment-failure-form").addEventListener("submit", (event) => injectEnvironmentFailure(event).catch(showError));
  $("#environment-rollback-form").addEventListener("submit", (event) => rollbackEnvironment(event).catch(showError));
  $("#environment-secrets-form").addEventListener("submit", (event) => checkEnvironmentSecrets(event).catch(showError));
  $("#operator-connection-path-form").addEventListener("submit", (event) => loadOperatorConnectionPath(event).catch(showError));
  $("#router-package-form").addEventListener("submit", (event) => generateRouterPackage(event).catch(showError));
  $("#router-posture-form").addEventListener("submit", (event) => validateRouterPosture(event).catch(showError));
  $("#provider-form").addEventListener("submit", (event) => createProvider(event).catch(showError));
  $("#secret-backend-form").addEventListener("submit", (event) => configureSecretBackend(event).catch(showError));
  $("#provider-dry-run-form").addEventListener("submit", (event) => createProviderDryRunPlan(event).catch(showError));
  $("#live-cloud-form").addEventListener("submit", (event) => requestLiveCloudVpsSet(event).catch(showError));
  $("#baseline-promotion-form").addEventListener("submit", (event) => promoteOperatorBaselineToLive(event).catch(showError));
  $("#provider-rehearsal-form").addEventListener("submit", (event) => runProviderRehearsal(event).catch(showError));
  $("#dedicated-order-form").addEventListener("submit", (event) => createDedicatedWorkloadOrder(event).catch(showError));
  $("#firecracker-qualification-form").addEventListener("submit", (event) => qualifyFirecrackerHost(event).catch(showError));
  $("#firecracker-rehearsal-form").addEventListener("submit", (event) => runFirecrackerLaunchRehearsal(event).catch(showError));
  $("#cpu-confidential-qualification-form").addEventListener("submit", (event) => qualifyCpuConfidentialHost(event).catch(showError));
  $("#approved-app-form").addEventListener("submit", (event) => createApprovedWorkloadApp(event).catch(showError));
  $("#subscription-form").addEventListener("submit", (event) => updateTenantSubscription(event).catch(showError));
  $("#billing-form").addEventListener("submit", (event) => updateBillingState(event).catch(showError));
  $("#workload-quote-form").addEventListener("submit", (event) => quoteWorkloadAllocation(event).catch(showError));
  $("#workload-allocation-form").addEventListener("submit", (event) => createWorkloadAllocation(event).catch(showError));
  $("#placement-form").addEventListener("submit", (event) => createPlacementPlan(event).catch(showError));
  $("#readiness-form").addEventListener("submit", (event) => evaluateOperatorReadiness(event).catch(showError));
  $("#approval-form").addEventListener("submit", (event) => createProvisioningApproval(event).catch(showError));
  $("#approval-status-form").addEventListener("submit", (event) => updateProvisioningApprovalStatus(event).catch(showError));
  $("#workload-lifecycle-form").addEventListener("submit", (event) => transitionWorkloadLifecycle(event).catch(showError));
  $("#device-form").addEventListener("submit", (event) => registerDevice(event).catch(showError));
  $("#admin-fido2-policy-form").addEventListener("submit", (event) => updateAdminFido2Policy(event).catch(showError));
  $("#admin-hsm-profile-form").addEventListener("submit", (event) => updateAdminHsmProfile(event).catch(showError));
  $("#operator-fido2-policy-form").addEventListener("submit", (event) => updateOperatorFido2Policy(event).catch(showError));
  $("#operator-hsm-profile-form").addEventListener("submit", (event) => updateOperatorHsmProfile(event).catch(showError));
  $("#recovery-form").addEventListener("submit", (event) => createRecoveryRequest(event).catch(showError));
  $("#break-glass-form").addEventListener("submit", (event) => createBreakGlassRequest(event).catch(showError));
  $("#phantom-capability-form").addEventListener("submit", (event) => createPhantomCapability(event).catch(showError));
  $("#phantom-approval-form").addEventListener("submit", (event) => createPhantomApproval(event).catch(showError));
  $("#phantom-risk-form").addEventListener("submit", (event) => createPhantomRisk(event).catch(showError));
  $("#phantom-package-form").addEventListener("submit", (event) => createPhantomPackage(event).catch(showError));
  $("#phantom-evidence-form").addEventListener("submit", (event) => createPhantomEvidenceBundle(event).catch(showError));
  $("#phantom-approval-pack-form").addEventListener("submit", (event) => createPhantomApprovalPack(event).catch(showError));
  $("#phantom-readiness-form").addEventListener("submit", (event) => evaluatePhantomReadiness(event).catch(showError));
  $("#phantom-simulation-form").addEventListener("submit", (event) => runPhantomSimulation(event).catch(showError));
  $("#phantom-assignment-form").addEventListener("submit", (event) => createPhantomAssignmentPlan(event).catch(showError));
  $("#phantom-review-board-form").addEventListener("submit", (event) => createPhantomReviewBoardItem(event).catch(showError));
  $("#phantom-policy-simulation-form").addEventListener("submit", (event) => runPhantomPolicySimulation(event).catch(showError));
  $("#phantom-exception-form").addEventListener("submit", (event) => createPhantomException(event).catch(showError));
  $("#phantom-review-ack-form").addEventListener("submit", (event) => acknowledgePhantomReviewOwner(event).catch(showError));
  $("#phantom-coverage-form").addEventListener("submit", (event) => evaluatePhantomCoverage(event).catch(showError));
  $("#phantom-execution-request-form").addEventListener("submit", (event) => createPhantomExecutionRequest(event).catch(showError));
  $("#evidence-artifact-form").addEventListener("submit", (event) => createEvidenceArtifact(event).catch(showError));
  $("#release-problem-form").addEventListener("submit", (event) => createReleaseProblem(event).catch(showError));
  $("#human-test-status-form").addEventListener("submit", (event) => updateHumanTestStatus(event).catch(showError));
  $("#human-test-run-form").addEventListener("submit", (event) => recordHumanTestRun(event).catch(showError));
  $("#blue-team-signal-form").addEventListener("submit", (event) => recordBlueTeamSignal(event).catch(showError));
  $("#webauthn-mode").addEventListener("change", setWebAuthnMode);
  $("#credential-cards").addEventListener("click", (event) => handleCredentialAction(event).catch(showError));
  $("#plan-form").addEventListener("submit", (event) => generatePlan(event).catch(showError));
  $("#job-form").addEventListener("submit", (event) => executeJob(event).catch(showError));
  $("#refresh-button").addEventListener("click", () => refreshAll().catch(showError));
  $("#demo-flow-button").addEventListener("click", () => runDemoFlow().catch(showError));
  $("#step-up-confirm").addEventListener("click", () => completeStepUp().catch(showError));
  $("#step-up-cancel").addEventListener("click", cancelStepUp);
  $$("nav button").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
}

function showError(error) {
  console.error(error);
  toast(error.payload?.error?.message || error.message, "error");
}

async function boot() {
  bind();
  state.webAuthnSupported = supportsBrowserWebAuthn();
  $("#webauthn-capability").textContent = state.webAuthnSupported ? "Browser WebAuthn available" : "Dev/test simulator only";
  $("#webauthn-capability-security").textContent = state.webAuthnSupported
    ? "Browser WebAuthn capability available"
    : "Dev/test simulator boundary active";
  try {
    const health = await api("/health");
    $("#api-status").textContent = health.status === "ok" ? "API Healthy" : "API Degraded";
  } catch {
    $("#api-status").textContent = "API Offline";
  }
  if (state.token && state.session) {
    $("#login-panel").hidden = true;
    $("#app-shell").hidden = false;
    $("#session-label").textContent = state.session.role;
    try {
      await refreshAll();
    } catch (error) {
      sessionStorage.removeItem("sylion.admin.session");
      sessionStorage.removeItem("sylion.admin.token");
      state.session = null;
      state.token = null;
      $("#login-panel").hidden = false;
      $("#app-shell").hidden = true;
      $("#session-label").textContent = "Not signed in";
      showError(error);
    }
  }
}

boot();
