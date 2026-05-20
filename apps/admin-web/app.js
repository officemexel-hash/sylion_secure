const state = {
  token: sessionStorage.getItem("sylion.admin.token") || null,
  session: JSON.parse(sessionStorage.getItem("sylion.admin.session") || "null"),
  tenants: [],
  operators: [],
  providers: [],
  devices: [],
  jobs: [],
  audit: [],
  credentials: [],
  authPolicy: null,
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
  phantomAuditCorrelation: null,
  lastPlanId: null,
  lastPlanOperatorId: null,
  credentialId: localStorage.getItem("sylion.admin.credentialId") || null,
  webAuthnMode: localStorage.getItem("sylion.admin.webauthnMode") || "local_simulator",
  webAuthnSupported: false,
  pendingStepUp: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

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
    providers,
    devices,
    jobs,
    audit,
    credentials,
    policy,
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
    phantomAuditCorrelation
  ] = await Promise.all([
    api("/health"),
    api("/auth/session"),
    api("/tenants"),
    api("/operators"),
    api("/providers"),
    api("/devices"),
    api("/orchestrator/jobs"),
    api("/audit/events"),
    api("/auth/credentials").catch(() => ({ credentials: [] })),
    api("/auth/policy-matrix").catch(() => ({ policy: null })),
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
    api("/phantom/audit-correlation").catch(() => ({ summary: null }))
  ]);
  $("#api-status").textContent = health.status === "ok" ? "API Healthy" : "API Degraded";
  state.session = session.session;
  state.tenants = tenants.tenants;
  state.operators = operators.operators;
  state.providers = providers.providers;
  state.devices = devices.devices;
  state.jobs = jobs.jobs;
  state.audit = audit.events;
  state.credentials = credentials.credentials;
  state.authPolicy = policy.policy;
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
  state.phantomAuditCorrelation = phantomAuditCorrelation.summary;
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
  renderSelect("#device-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#plan-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#job-operator-select", state.operators, "No operators", "displayName");
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

  $("#operator-cards").innerHTML = state.operators.map((operator) => card(operator.displayName, [
    ["Tier", operator.tier],
    ["Status", operator.status],
    ["Tenant", operator.tenantId],
    ["Router", operator.baseline?.router]
  ])).join("") || empty("No operators yet.");

  $("#provider-cards").innerHTML = state.providers.map((provider) => card(provider.displayName, [
    ["Provider", provider.providerKey],
    ["Regions", provider.regions?.join(", ")],
    ["Secret", provider.apiSecretReference?.secretReference],
    ["Connection", provider.connection?.status]
  ])).join("") || empty("No providers yet.");

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

  $("#phantom-audit-correlation-cards").innerHTML = state.phantomAuditCorrelation ? card("PHANTOM audit correlation", [
    ["Events", String(state.phantomAuditCorrelation.eventCount)],
    ["Actions", String(state.phantomAuditCorrelation.actions?.length || 0)],
    ["Latest hash", String(state.phantomAuditCorrelation.latestHash || "").slice(0, 14)],
    ["Execution", String(state.phantomAuditCorrelation.executionAllowed)]
  ]) : empty("PHANTOM audit correlation unavailable.");

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

function renderSelect(selector, rows, emptyLabel, labelKey = "name") {
  const select = $(selector);
  select.innerHTML = rows.length
    ? rows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row[labelKey] || row.id)}</option>`).join("")
    : `<option value="">${escapeHtml(emptyLabel)}</option>`;
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
  await api("/operators", { method: "POST", body: data });
  toast("Operator created");
  await refreshAll();
}

async function createProvider(event) {
  event.preventDefault();
  const data = formData(event.currentTarget);
  await withStepUpRetry(() => api("/providers", {
    method: "POST",
    body: {
      providerType: data.providerType,
      apiSecret: data.apiSecret,
      regions: splitCsv(data.regions),
      billingHealth: { status: "healthy" },
      testConnection: { mode: "mock", status: "passed" }
    }
  }), "Save Provider");
  event.currentTarget.apiSecret.value = "";
  toast("Provider saved; secret cleared from form");
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
  const plan = await api(`/operators/${operator.operator.id}/provisioning-plan`, {
    method: "POST",
    body: { requestedApps: ["Signal", "Telegram"] }
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
      idempotencyKey: `demo_${suffix}`
    }
  }), "Run Demo Flow job execution");
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
    devices: ["Devices", "Register Pixel, Puli AX and FIDO2 assets."],
    providers: ["Providers", "Add provider accounts without retaining plaintext secrets."],
    security: ["Security", "Review core V2 security boundaries."],
    phantom: ["PHANTOM", "Governance-only separate track with HUMAN GATE."],
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
  $("#provider-form").addEventListener("submit", (event) => createProvider(event).catch(showError));
  $("#device-form").addEventListener("submit", (event) => registerDevice(event).catch(showError));
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
