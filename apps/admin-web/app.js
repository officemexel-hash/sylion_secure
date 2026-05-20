const state = {
  token: sessionStorage.getItem("sylion.admin.token") || null,
  session: JSON.parse(sessionStorage.getItem("sylion.admin.session") || "null"),
  tenants: [],
  operators: [],
  providers: [],
  devices: [],
  jobs: [],
  audit: [],
  recoveryRequests: [],
  breakGlassRequests: [],
  lastPlanId: null,
  lastPlanOperatorId: null,
  credentialId: localStorage.getItem("sylion.admin.credentialId") || null,
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
  const result = await api("/auth/webauthn/login/verify", {
    method: "POST",
    body: {
      challengeId: options.challenge.id,
      credentialId,
      assertion: simulatedAssertion(options.challenge.id, credentialId)
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
  const [health, session, tenants, operators, providers, devices, jobs, audit, recovery, breakGlass] = await Promise.all([
    api("/health"),
    api("/auth/session"),
    api("/tenants"),
    api("/operators"),
    api("/providers"),
    api("/devices"),
    api("/orchestrator/jobs"),
    api("/audit/events"),
    api("/auth/recovery/requests").catch(() => ({ requests: [] })),
    api("/auth/break-glass/requests").catch(() => ({ requests: [] }))
  ]);
  $("#api-status").textContent = health.status === "ok" ? "API Healthy" : "API Degraded";
  state.session = session.session;
  state.tenants = tenants.tenants;
  state.operators = operators.operators;
  state.providers = providers.providers;
  state.devices = devices.devices;
  state.jobs = jobs.jobs;
  state.audit = audit.events;
  state.recoveryRequests = recovery.requests;
  state.breakGlassRequests = breakGlass.requests;
  render();
}

function render() {
  $("#metric-tenants").textContent = state.tenants.length;
  $("#metric-operators").textContent = state.operators.length;
  $("#metric-jobs").textContent = state.jobs.length;
  $("#metric-audit").textContent = state.audit.length;
  $("#session-state").textContent = state.session?.authMethod || "Unknown";

  renderSelect("#operator-tenant-select", state.tenants, "No tenants");
  renderSelect("#device-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#plan-operator-select", state.operators, "No operators", "displayName");
  renderSelect("#job-operator-select", state.operators, "No operators", "displayName");

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
    const result = await api("/auth/step-up/verify", {
      method: "POST",
      body: {
        challengeId: options.challenge.id,
        credentialId: state.credentialId,
        assertion: simulatedAssertion(options.challenge.id, state.credentialId)
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
    signature: `simulated:${challengeId}:${credentialId}`,
    signCounter
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
  const result = await api("/auth/webauthn/enrollment/verify", {
    method: "POST",
    body: {
      challengeId: options.challenge.id,
      credential: {
        id: credentialId,
        publicKey: `simulated-public-key:${credentialId}`,
        transports: ["usb", "nfc"]
      }
    }
  });
  state.credentialId = result.credential.id;
  localStorage.setItem("sylion.admin.credentialId", result.credential.id);
  toast("FIDO2 credential enrolled locally");
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
    dashboard: ["Dashboard", "Live Admin Shell connected to the SYLION Admin API."],
    operators: ["Operators", "Create tenants and operators."],
    provisioning: ["Provisioning", "Generate plans and execute orchestrator jobs."],
    devices: ["Devices", "Register Pixel, Puli AX and FIDO2 assets."],
    providers: ["Providers", "Add provider accounts without retaining plaintext secrets."],
    security: ["Security", "Review core V2 security boundaries."],
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
