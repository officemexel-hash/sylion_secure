// SYLION Operator Portal - scoped local contract.
// Physical FIDO2/HSM and router package remain gated; this UI exercises the
// operator/admin configuration surface without production execution.

(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    operatorToken: sessionStorage.getItem("sylion.operator.token") || null,
    streamToken: sessionStorage.getItem("sylion.operator.streamToken") || null,
    session: JSON.parse(sessionStorage.getItem("sylion.operator.session") || "null"),
    cookieBound: false
  };

  function isOperatorSessionToken(token) {
    return /^op_[A-Za-z0-9]+$/.test(String(token || ""));
  }

  function rememberStreamLaunchToken(token) {
    if (!isOperatorSessionToken(token)) return;
    state.streamToken = token;
    sessionStorage.setItem("sylion.operator.streamToken", token);
  }

  function parseHashState() {
    const rawHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    if (!rawHash) return { viewId: "overview", params: new URLSearchParams() };
    const firstPart = rawHash.split("&", 1)[0];
    if (firstPart && !firstPart.includes("=")) {
      return {
        viewId: firstPart,
        params: new URLSearchParams(rawHash.slice(firstPart.length).replace(/^&/, ""))
      };
    }
    const params = new URLSearchParams(rawHash);
    return {
      viewId: params.get("view") || "overview",
      params
    };
  }

  function hashFromState(viewId, hashParams) {
    const params = new URLSearchParams(hashParams);
    params.delete("view");
    const query = params.toString();
    return `#${viewId || "overview"}${query ? `&${query}` : ""}`;
  }

  async function bootstrapOperatorToken() {
    const params = new URLSearchParams(window.location.search);
    const hashState = parseHashState();
    const token = params.get("op_token") || hashState.params.get("op_token");
    const localhost = ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
    const internalHost = window.location.protocol === "https:" && window.location.hostname.endsWith(".sylion.internal");
    if (token && (localhost || internalHost) && isOperatorSessionToken(token)) {
      state.operatorToken = token;
      rememberStreamLaunchToken(token);
      params.delete("op_token");
      hashState.params.delete("op_token");
      const cleanSearch = params.toString();
      const cleanHash = hashFromState(hashState.viewId, hashState.params);
      window.history.replaceState(null, "", `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ""}${cleanHash}`);
      const attached = await attachOperatorSessionCookie();
      if (!attached) {
        sessionStorage.setItem("sylion.operator.token", token);
        setText("#session-status", internalHost ? "Operator session received through internal VPN link." : "Operator session received through local lab link.");
      }
      return;
    }
    if (state.operatorToken) {
      await attachOperatorSessionCookie();
      return;
    }
    await recoverOperatorCookieSession();
  }

  function headers(extra = {}) {
    return {
      "content-type": "application/json",
      "x-correlation-id": `corr_operator_web_${crypto.randomUUID()}`,
      "x-sylion-operator-csrf": "same-origin-ui",
      ...(state.operatorToken ? { authorization: `Bearer ${state.operatorToken}` } : {}),
      ...extra
    };
  }

  async function fetchJson(url, options = {}) {
    try {
      const res = await fetch(url, {
        method: options.method || "GET",
        credentials: "same-origin",
        headers: headers(options.headers || {}),
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const payload = await res.json();
      if (!res.ok) {
        return { error: payload?.error?.message || `HTTP ${res.status}`, status: res.status };
      }
      return payload;
    } catch (err) {
      return { error: String(err) };
    }
  }

  async function attachOperatorSessionCookie() {
    if (!state.operatorToken) return false;
    const res = await fetch("/operator-api/sessions/attach", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": `corr_operator_web_attach_${crypto.randomUUID()}`,
        authorization: `Bearer ${state.operatorToken}`
      }
    });
    const payload = await res.json();
    if (!res.ok) return false;
    rememberStreamLaunchToken(state.operatorToken);
    state.session = payload.session;
    state.operatorToken = null;
    state.cookieBound = true;
    sessionStorage.setItem("sylion.operator.session", JSON.stringify(payload.session));
    sessionStorage.removeItem("sylion.operator.token");
    setText("#session-status", `Session bound to this operator browser context (${payload.session.terminalMode}).`);
    return true;
  }

  async function recoverOperatorCookieSession() {
    const payload = await fetchJson("/operator-api/sessions/current");
    if (payload.error || !payload.session) return false;
    state.session = payload.session;
    state.operatorToken = null;
    state.cookieBound = true;
    rememberStreamLaunchToken(payload.session.token || state.streamToken);
    sessionStorage.setItem("sylion.operator.session", JSON.stringify(payload.session));
    sessionStorage.removeItem("sylion.operator.token");
    setText("#session-status", `Session restored for ${payload.session.operatorId} (${payload.session.terminalMode}).`);
    return true;
  }

  function setActiveView(viewId) {
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
    $$(".sidebar a").forEach((link) => link.classList.toggle("active", link.dataset.view === viewId));
  }

  function handleNav(event) {
    const link = event.target.closest("a[data-view]");
    if (!link) return;
    event.preventDefault();
    const viewId = link.dataset.view;
    setActiveView(viewId);
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", "#" + viewId);
    }
    loadViewData(viewId);
  }

  function handleInternalSwitcher(event) {
    const link = event.target.closest("a[data-view]");
    if (!link || !link.closest("#app-switcher")) return;
    event.preventDefault();
    const viewId = link.dataset.view;
    setActiveView(viewId);
    window.history.replaceState(null, "", "#" + viewId);
    loadViewData(viewId);
  }

  function handleWorkloadLaunchClick(event) {
    const link = event.target.closest("a[href]");
    if (!link) return;

    let url;
    try {
      url = new URL(link.getAttribute("href"), window.location.origin);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin || url.pathname !== "/operator/stream.html") return;

    const appKey = url.searchParams.get("app");
    const launchUrl = workloadStreamWrapperUrl(appKey || "duckduckgo_browser");
    if (!currentOperatorLaunchToken() && !state.session) {
      event.preventDefault();
      setText("#session-status", "Workload stream blocked: missing active operator session. Reopen the operator package link.");
      return;
    }
    link.setAttribute("href", launchUrl);
  }

  function detectTerminalMode() {
    const ua = navigator.userAgent;
    if (/Android/.test(ua) && /GrapheneOS|Vanadium/.test(ua)) return "Pixel GrapheneOS - Mode M1";
    if (/Android/.test(ua)) return "Android terminal - GrapheneOS posture required";
    if (/Macintosh|Windows|Linux/.test(ua)) return "Laptop web terminal - Mode M2";
    return "Unknown terminal";
  }

  async function createLocalSession(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const res = await fetch("/operator-api/sessions/local-simulator", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": `corr_operator_web_session_${crypto.randomUUID()}`,
        authorization: `Bearer ${data.adminToken}`
      },
      body: JSON.stringify({
        operatorId: data.operatorId,
        terminalMode: data.terminalMode,
        deviceId: data.deviceId || null
      })
    });
    const payload = await res.json();
    if (!res.ok) {
      setText("#session-status", payload?.error?.message || `HTTP ${res.status}`);
      return;
    }
    state.session = payload.session;
    state.operatorToken = payload.session.token;
    rememberStreamLaunchToken(payload.session.token);
    sessionStorage.setItem("sylion.operator.session", JSON.stringify(payload.session));
    const attached = await attachOperatorSessionCookie();
    if (!attached) {
      sessionStorage.setItem("sylion.operator.token", payload.session.token);
      setText("#session-status", `Session active for ${payload.session.operatorId} (${payload.session.terminalMode})`);
    }
    await loadOverview();
  }

  async function loadOverview() {
    setText("#terminal-mode", detectTerminalMode());
    if (!state.operatorToken && !state.session) {
      setText("#operator-session", "Not connected");
      setText("#vpn-overview", "Configuration pending");
      return;
    }
    const me = await fetchJson("/operator-api/me");
    if (me.error) {
      setText("#operator-session", me.error);
      return;
    }
    setText("#operator-session", `${me.me.displayName} (${me.me.tier})`);
    updateSessionCountdown();
    const vpn = await fetchJson("/operator-api/vpn-status");
    if (!vpn.error) setText("#vpn-overview", vpn.vpn.state);
    await loadStreaming();
  }

  async function loadDevices() {
    const tbody = $("#devices-tbody");
    if (!tbody) return;
    const data = await fetchJson("/operator-api/devices");
    if (data.error) {
      tbody.innerHTML = `<tr><td colspan="4" class="placeholder">${escapeHtml(data.error)}</td></tr>`;
      return;
    }
    const rows = (data.devices || []).map((d) => `
      <tr>
        <td>${escapeHtml(d.type)}</td>
        <td>${escapeHtml(d.model || "-")}</td>
        <td>${escapeHtml(d.status || "-")}</td>
        <td>${escapeHtml(d.posture?.state || "unknown")}</td>
      </tr>
    `).join("");
    tbody.innerHTML = rows || `<tr><td colspan="4" class="placeholder">No scoped devices yet.</td></tr>`;
  }

  async function loadFido2() {
    const list = $("#fido2-list");
    if (!list) return;
    const data = await fetchJson("/operator-api/settings/fido2");
    if (data.error) {
      list.innerHTML = `<li class="placeholder">${escapeHtml(data.error)}</li>`;
      return;
    }
    const p = data.policy;
    list.innerHTML = `<li>Mode: ${escapeHtml(p.mode)} | session: ${escapeHtml(p.defaultSessionHours)}h | enrollment allowed: ${escapeHtml(p.actualEnrollmentAllowed)}</li>`;
  }

  async function saveFido2(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await fetchJson("/operator-api/settings/fido2", {
      method: "POST",
      body: {
        mode: "enrollment_deferred",
        defaultSessionHours: Number(data.defaultSessionHours),
        allowedTransports: splitCsv(data.allowedTransports)
      }
    });
    setText("#session-status", result.error || "FIDO2 policy saved");
    await loadFido2();
  }

  async function loadHsm() {
    const list = $("#hsm-list");
    if (!list) return;
    const data = await fetchJson("/operator-api/settings/hsm");
    if (data.error) {
      list.innerHTML = `<li class="placeholder">${escapeHtml(data.error)}</li>`;
      return;
    }
    const p = data.profile;
    list.innerHTML = `<li>Mode: ${escapeHtml(p.mode)} | refs: ${escapeHtml((p.references || []).join(", ") || "none")} | material stored: ${escapeHtml(p.materialStored)}</li>`;
  }

  async function saveHsm(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await fetchJson("/operator-api/settings/hsm", {
      method: "POST",
      body: {
        mode: "byo_hsm_deferred",
        references: splitCsv(data.references),
        attestationRefs: splitCsv(data.attestationRefs)
      }
    });
    setText("#session-status", result.error || "HSM references saved");
    await loadHsm();
  }

  async function loadUnlockPolicy() {
    const list = $("#unlock-list");
    if (!list) return;
    const data = await fetchJson("/operator-api/settings/unlock");
    if (data.error) {
      list.innerHTML = `<li class="placeholder">${escapeHtml(data.error)}</li>`;
      return;
    }
    const p = data.policy;
    const form = $("#unlock-form");
    if (form) {
      form.elements.sessionHours.value = p.sessionHours;
      form.elements.sessionHours.max = p.maxSessionHoursByTier;
      form.elements.fido2RequiredAtSessionEnd.checked = p.fido2?.requiredAtSessionEnd !== false;
    }
    list.innerHTML = Object.values(p.layers || {}).map((layer) => `
      <li>
        <strong>${escapeHtml(layer.layer.toUpperCase())}</strong>
        <span>password set: ${escapeHtml(layer.passwordSet)} | rotated: ${escapeHtml(layer.rotatedAt || "never")} | material stored: ${escapeHtml(layer.passwordMaterialStored)}</span>
      </li>
    `).join("") + `
      <li><strong>Session</strong><span>${escapeHtml(p.sessionHours)}h active window, max ${escapeHtml(p.maxSessionHoursByTier)}h for tier, FIDO2 deferred: ${escapeHtml(p.fido2?.deferred)}</span></li>
    `;
  }

  async function loadSafetyPolicy() {
    const list = $("#safety-list");
    if (!list) return;
    const data = await fetchJson("/operator-api/settings/safety");
    if (data.error) {
      list.innerHTML = `<li class="placeholder">${escapeHtml(data.error)}</li>`;
      return;
    }
    const p = data.policy;
    const form = $("#safety-form");
    if (form) {
      form.elements.backupEnabled.checked = p.backup?.enabled === true;
      form.elements.backupCadenceHours.value = p.backup?.cadenceHours || 24;
      form.elements.inactivityWipeEnabled.checked = p.inactivityWipe?.enabled !== false;
      form.elements.inactivityWipeDays.value = p.inactivityWipe?.afterDays || 14;
    }
    list.innerHTML = `
      <li><strong>Backup</strong><span>${escapeHtml(p.backup.enabled)} | ${escapeHtml(p.backup.scope)} every ${escapeHtml(p.backup.cadenceHours)}h | workload data included: ${escapeHtml(p.backup.workloadDataIncluded)}</span></li>
      <li><strong>Inactivity wipe</strong><span>${escapeHtml(p.inactivityWipe.enabled)} after ${escapeHtml(p.inactivityWipe.afterDays)} days | state ${escapeHtml(p.inactivityWipe.state)}</span></li>
      ${Object.values(p.panicCodes || {}).map((entry) => `<li><strong>${escapeHtml(entry.level)}</strong><span>code set: ${escapeHtml(entry.codeSet)} | rotated: ${escapeHtml(entry.rotatedAt || "never")} | material stored: ${escapeHtml(entry.codeMaterialStored)}</span></li>`).join("")}
    `;
  }

  async function saveSafetyPolicy(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await fetchJson("/operator-api/settings/safety", {
      method: "POST",
      body: {
        backupEnabled: data.backupEnabled === "on",
        backupCadenceHours: Number(data.backupCadenceHours),
        inactivityWipeEnabled: data.inactivityWipeEnabled === "on",
        inactivityWipeDays: Number(data.inactivityWipeDays),
        data_wipeCode: data.data_wipeCode,
        environment_destroyCode: data.environment_destroyCode,
        account_revokeCode: data.account_revokeCode
      }
    });
    setText("#session-status", result.error || "Safety policy saved");
    event.currentTarget.reset();
    await loadSafetyPolicy();
  }

  async function loadJurisdictionPolicy() {
    const list = $("#jurisdiction-list");
    if (!list) return;
    const [data, optionsData] = await Promise.all([
      fetchJson("/operator-api/settings/jurisdiction"),
      fetchJson("/operator-api/settings/jurisdiction/options")
    ]);
    if (data.error) {
      list.innerHTML = `<li class="placeholder">${escapeHtml(data.error)}</li>`;
      return;
    }
    renderJurisdictionOptions(optionsData.options, optionsData.error);
    const p = data.policy;
    const form = $("#jurisdiction-form");
    if (form) {
      form.elements.mode.value = p.mode;
      form.elements.regions.value = (p.regions || []).join(",");
      form.elements.countries.value = (p.countries || []).join(",");
      form.elements.providers.value = (p.providers || []).join(",");
      form.elements.frequencyHours.value = p.frequencyHours || "";
    }
    list.innerHTML = `<li><strong>${escapeHtml(p.mode)}</strong><span>tier mode: ${escapeHtml(p.subscriptionMode)} | countries: ${escapeHtml((p.countries || []).join(", ") || "none")} | providers: ${escapeHtml((p.providers || []).join(", ") || "none")} | every ${escapeHtml(p.frequencyHours || "-")}h | scopes: ${escapeHtml((p.rotationScopes || []).join(", ") || "none")} | state: ${escapeHtml(p.state)}</span></li>`;
  }

  function renderJurisdictionOptions(options, error) {
    const box = $("#jurisdiction-options");
    if (!box) return;
    if (error) {
      box.classList.remove("placeholder");
      box.textContent = error;
      return;
    }
    if (!options?.providerCatalogConfigured) {
      box.classList.remove("placeholder");
      box.textContent = "No provider catalog is configured yet. Admin must add VPS providers before operator can choose real rotation locations.";
      return;
    }
    const providers = options.providers || [];
    box.classList.remove("placeholder");
    box.innerHTML = `
      <strong>Available locations for ${escapeHtml(options.tier)} (${escapeHtml(options.requiredRuntime)})</strong>
      <span>Allowed modes: ${escapeHtml((options.allowedModes || []).join(", "))} | min frequency: ${escapeHtml(options.minFrequencyHours)}h | max countries: ${escapeHtml(options.maxCountries)}</span>
      <span>Countries: ${escapeHtml((options.countries || []).join(", ") || "none")}</span>
      <span>Providers: ${escapeHtml(providers.map((provider) => provider.providerKey).join(", ") || "none")}</span>
      <span>Regions: ${escapeHtml((options.regions || []).map((region) => `${region.providerKey}:${region.region}/${region.country}`).join(", ") || "none")}</span>
    `;
  }

  async function saveJurisdictionPolicy(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await fetchJson("/operator-api/settings/jurisdiction", {
      method: "POST",
      body: {
        mode: data.mode,
        regions: splitCsv(data.regions),
        countries: splitCsv(data.countries),
        providers: splitCsv(data.providers),
        frequencyHours: Number(data.frequencyHours)
      }
    });
    setText("#session-status", result.error || "Jurisdiction policy saved");
    await loadJurisdictionPolicy();
  }

  async function loadMatrixServer() {
    const list = $("#matrix-list");
    if (!list) return;
    const data = await fetchJson("/operator-api/matrix-server");
    if (data.error) {
      list.innerHTML = `<li class="placeholder">${escapeHtml(data.error)}</li>`;
      return;
    }
    const request = data.matrix.latestRequest;
    list.innerHTML = request
      ? `<li><strong>${escapeHtml(request.hostname)}</strong><span>${escapeHtml(request.state)} | federation: ${escapeHtml(request.federation)} | addon required: ${escapeHtml(request.addonRequired)}</span></li>`
      : `<li class="placeholder">No Matrix server request yet.</li>`;
  }

  async function requestMatrixServer(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await fetchJson("/operator-api/matrix-server/requests", {
      method: "POST",
      body: {
        hostname: data.hostname,
        federation: data.federation === "on"
      }
    });
    setText("#session-status", result.error || `Matrix request queued: ${result.request.state}`);
    await loadMatrixServer();
  }

  async function saveUnlockPolicy(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await fetchJson("/operator-api/settings/unlock", {
      method: "POST",
      body: {
        sessionHours: Number(data.sessionHours),
        g1Password: data.g1Password,
        g2Password: data.g2Password,
        workloadPassword: data.workloadPassword,
        fido2RequiredAtSessionEnd: data.fido2RequiredAtSessionEnd === "on"
      }
    });
    setText("#session-status", result.error || "Unlock policy saved");
    event.currentTarget.reset();
    await loadUnlockPolicy();
  }

  async function loadVpn() {
    const data = await fetchJson("/operator-api/vpn-status");
    if (data.error) {
      setText("#vpn-state", data.error);
      return;
    }
    setText("#vpn-state", data.vpn.state);
    setText("#vpn-router", data.vpn.router);
    setText("#vpn-g1", data.vpn.endpoints.g1 || "-");
    setText("#vpn-g2", data.vpn.endpoints.g2 || "-");
    setText("#vpn-workload", data.vpn.endpoints.workload || "-");
    setText("#vpn-handshake", data.vpn.lastHandshake || "-");
    if (data.vpn.liveEvidence) {
      setText("#vpn-evidence-status", data.vpn.liveEvidence.ready
        ? `Live evidence active: ${data.vpn.liveEvidence.observedAt}`
        : `Evidence incomplete: ${(data.vpn.liveEvidence.blockers || []).join(", ")}`);
    }
    const install = await fetchJson("/operator-api/vpn-install-package");
    if (!install.error) {
      setText("#vpn-install-state", install.package.installState);
      setText("#vpn-install-type", install.package.packageType);
      setText("#vpn-install-blockers", (install.package.requires || []).join(", "));
    }
    const ca = await fetchJson("/operator-api/pixel-ca-provisioning");
    if (!ca.error) {
      const recommended = (ca.package.installMethods || []).find((item) => item.status === "recommended") || ca.package.installMethods?.[0];
      setText("#ca-package-type", ca.package.packageType);
      setText("#ca-trust-scope", (ca.package.trustScope || []).join(", "));
      setText("#ca-install-method", recommended?.method || "-");
      setText("#ca-fingerprint", ca.package.caFingerprintSha256 || "pending profile fingerprint");
      const steps = $("#ca-install-steps");
      if (steps) {
        steps.innerHTML = (recommended?.steps || []).map((step) => `<li><strong>${escapeHtml(step)}</strong><span>GrapheneOS user-present install step.</span></li>`).join("") || `<li class="placeholder">No CA provisioning steps available.</li>`;
      }
    }
    const laptop = await fetchJson("/operator-api/laptop-access-package");
    if (!laptop.error) {
      setText("#laptop-package-type", laptop.package.packageType);
      setText("#laptop-package-transport", laptop.package.transport);
      setText("#laptop-package-entrypoints", (laptop.package.browserThinClient?.entrypoints || []).join(", "));
      setText("#laptop-package-validation", (laptop.package.validation?.requiredChecks || []).join(", "));
    }
  }

  async function prepareWorkloadBroker(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await fetchJson(`/operator-api/workload-session-broker/${encodeURIComponent(data.templateKey)}`);
    if (result.error) {
      setText("#workload-broker-status", result.error);
      return;
    }
    const broker = result.broker;
    setText("#workload-broker-status", `${broker.appName}: ${broker.state} | ${broker.authMode} | blockers: ${(broker.blockers || []).join(", ") || "none"} | ${broker.url}`);
  }

  function workloadControlKey(templateKey) {
    if (templateKey === "duckduckgo") return "duckduckgo_browser";
    return templateKey;
  }

  async function recreateWorkloadApp(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const templateKey = String(data.templateKey || "").trim();
    const rotateApp = workloadControlKey(templateKey);
    const confirmation = String(data.confirmation || "").trim();
    if (confirmation !== "RUN_LIVE_WORKLOAD_RECREATE") {
      setText("#workload-recreate-status", "Type RUN_LIVE_WORKLOAD_RECREATE to delete and recreate the selected environment.");
      return;
    }
    setText("#workload-recreate-status", `Queueing ${rotateApp} recreate request...`);
    const control = await fetchJson("/operator-api/workload-control");
    if (control.error) {
      setText("#workload-recreate-status", control.error);
      return;
    }
    const currentCounts = control.control?.latestDesiredCounts || control.control?.currentCounts || {};
    const appKeys = [
      "whatsapp",
      "signal",
      "telegram",
      "threema",
      "zangi",
      "simplex",
      "matrix_client",
      "matrix_server",
      "protonmail",
      "duckduckgo_browser",
      "libreoffice",
      "exodus"
    ];
    const desiredCounts = Object.fromEntries(appKeys.map((key) => [key, Number(currentCounts[key] || 0)]));
    if (desiredCounts[rotateApp] === 0 && Object.prototype.hasOwnProperty.call(desiredCounts, rotateApp)) {
      desiredCounts[rotateApp] = 1;
    }
    const queued = await fetchJson("/operator-api/workload-control/requests", {
      method: "POST",
      body: {
        action: "rotate_app",
        rotateApp,
        desiredCounts
      }
    });
    if (queued.error) {
      setText("#workload-recreate-status", queued.error);
      return;
    }
    setText("#workload-recreate-status", `Recreating ${rotateApp}; this can take a few minutes on AX102...`);
    const executed = await fetchJson(`/operator-api/workload-control/requests/${encodeURIComponent(queued.request.id)}/execute`, {
      method: "POST",
      body: {
        confirmation,
        wipeVolume: false,
        fourEyesApprovalRef: null
      }
    });
    if (executed.error) {
      setText("#workload-recreate-status", executed.error);
      return;
    }
    renderLiveRunnerJob(executed.job);
    const ok = executed.job?.state === "completed_live_workload_recreate";
    setText("#workload-recreate-status", ok
      ? `${rotateApp} recreated on AX102 and G2 stream forwards refreshed. Open it from Apps.`
      : `${rotateApp} recreate finished with state: ${executed.job?.state || "unknown"}`);
    form.elements.confirmation.value = "";
    await loadWorkloadControl();
    await loadLiveWorkloadStatus();
    await loadAudit();
  }

  async function loadAppSwitcher() {
    await loadOverview();
    await loadLiveWorkloadStatus();
  }

  async function loadLiveWorkloadStatus() {
    const launcher = $("#workload-launcher");
    const summary = $("#live-workload-status-summary");
    if (!launcher) return;
    const data = await fetchJson("/operator-api/live-workload-status");
    if (data.error) {
      if (summary) summary.textContent = `Live status unavailable: ${data.error}`;
      return;
    }
    const status = data.status || {};
    const s = status.summary || {};
    if (summary) {
      summary.textContent = `Live AX102/G2 evidence ${status.cached ? "cached" : "fresh"}: transport ${s.transportReady ?? 0}/${s.totalApps ?? 0}, workload UI ${s.workloadUiReady ?? 0}/${s.totalApps ?? 0}, functional ${s.functionalReady ?? 0}/${s.totalApps ?? 0}.`;
    }
    launcher.innerHTML = (status.apps || []).map((app) => {
      const tone = app.functionalState === "ui_ready"
        ? "status-ok"
        : app.workload?.state === "ready" && app.transport?.state !== "blocked"
          ? "status-warn"
          : "status-error";
      const launchUrl = workloadStreamWrapperUrl(app.key, app.launchUrl || `https://${app.host}/`);
      return `
        <a class="quick-tile workload-tile ${tone}" href="${escapeHtml(launchUrl)}" rel="noopener">
          <strong>${escapeHtml(app.name)}</strong>
          <span>${escapeHtml(statusLabel(app))}</span>
          <span class="tile-meta">G2 ${escapeHtml(app.transport?.state || "blocked")} | workload ${escapeHtml(app.workload?.state || "blocked")}</span>
          <span class="tile-meta">action: ${escapeHtml(app.operatorAction || "review")}</span>
        </a>
      `;
    }).join("") || `<div class="placeholder">No live workload evidence available.</div>`;
  }

  function statusLabel(app) {
    if (app.functionalState === "ui_ready") return "ready from real AX102/G2 evidence";
    if (app.functionalState === "ui_ready_account_test_required") return "UI ready, account/send-receive test required";
    if (app.functionalState === "ui_ready_pixel_fit_review_required") return "UI ready, Pixel fit/risk review required";
    if (app.functionalState === "blocked_android_native_provenance") return "blocked: Android-native image/APK provenance";
    return `blocked: ${(app.blockers || []).slice(0, 2).join(", ") || "evidence missing"}`;
  }

  function workloadStreamWrapperUrl(appKey, fallbackUrl = "") {
    const normalized = normalizeWorkloadAppKey(appKey);
    const wrapperApps = new Set([
      "duckduckgo_browser",
      "libreoffice",
      "whatsapp",
      "telegram",
      "threema",
      "signal",
      "zangi",
      "exodus"
    ]);
    if (wrapperApps.has(normalized)) {
      const url = new URL("/operator/stream.html", window.location.origin);
      url.searchParams.set("app", normalized);
      const token = currentOperatorLaunchToken();
      if (token) {
        const launchHash = new URLSearchParams();
        launchHash.set("op_token", token);
        url.hash = launchHash.toString();
      }
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return fallbackUrl || "#app-switcher";
  }

  function currentOperatorLaunchToken() {
    const candidates = [
      state.operatorToken,
      state.session?.token,
      state.streamToken,
      sessionStorage.getItem("sylion.operator.token"),
      sessionStorage.getItem("sylion.operator.streamToken")
    ];
    return candidates.find(isOperatorSessionToken) || "";
  }

  function normalizeWorkloadAppKey(appKey) {
    const clean = String(appKey || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (clean === "duckduckgo" || clean === "browser") return "duckduckgo_browser";
    return clean;
  }

  async function recordVpnEvidence(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await fetchJson("/operator-api/vpn-evidence", {
      method: "POST",
      body: {
        vpnConnected: data.vpnConnected === "on",
        vpnSession: "SYLION",
        vpnInterface: data.vpnInterface,
        dnsThroughTunnel: data.dnsThroughTunnel === "on",
        certificateTrusted: data.certificateTrusted === "on",
        reachableHosts: splitCsv(data.reachableHosts)
      }
    });
    setText("#vpn-evidence-status", result.error || (result.evidence.ready
      ? `Live VPN evidence accepted: ${result.evidence.observedAt}`
      : `Evidence incomplete: ${(result.evidence.blockers || []).join(", ")}`));
    await loadVpn();
    await loadAudit();
  }

  async function loadConnectionPath() {
    const data = await fetchJson("/operator-api/connection-path");
    if (data.error) {
      setText("#path-state", data.error);
      return;
    }
    const path = data.path;
    setText("#path-state", path.state);
    setText("#path-terminal", path.nodes?.find((node) => node.role === "TERMINAL")?.label || path.terminalMode);
    setText("#path-router", `${path.router?.model || "Puli AX"} - ${path.router?.packageStatus || "pending"}`);
    setText("#path-router-posture", path.router?.postureStatus || "not_validated");
    setText("#path-router-smoke", path.router?.readyForPhysicalSmoke ? "ready_for_physical_smoke" : "blocked");
    setText("#path-transport", path.baseline?.transport || "ipsec_ikev2");
    setText("#path-blockers", (path.blockers || []).join(", ") || "-");
    const segments = $("#path-segments");
    if (segments) {
      segments.innerHTML = (path.segments || []).map((segment) => `
        <li>
          <strong>${escapeHtml(segment.id)}: ${escapeHtml(segment.from)} -> ${escapeHtml(segment.to)}</strong>
          <span>${escapeHtml(segment.protocol)} | ${escapeHtml(segment.state)} | ${escapeHtml(segment.killSwitch)}</span>
        </li>
      `).join("") || `<li class="placeholder">No VPN segments yet.</li>`;
    }
    const microvms = $("#path-microvms");
    if (microvms) {
      microvms.innerHTML = (path.microVmSlots || []).map((slot) => `
        <li>
          <strong>${escapeHtml(slot.appName)}</strong>
          <span>${escapeHtml(slot.isolation)} | ${escapeHtml(slot.status)} | CDR ${escapeHtml(slot.cdrRequired)}</span>
        </li>
      `).join("") || `<li class="placeholder">No communicator microVM slots yet.</li>`;
    }
  }

  async function loadTrafficMonitoring() {
    const data = await fetchJson("/operator-api/traffic-monitoring");
    if (data.error) {
      setText("#traffic-state", data.error);
      return;
    }
    const monitoring = data.monitoring || {};
    const summary = monitoring.summary || {};
    setText("#traffic-state", summary.state || "-");
    setText("#traffic-healthy", String(summary.healthy ?? "-"));
    setText("#traffic-degraded", String(summary.degraded ?? "-"));
    setText("#traffic-blocked", String(summary.blocked ?? "-"));
    setText("#traffic-alert-count", String(summary.alerts ?? "-"));
    const segments = $("#traffic-segments");
    if (segments) {
      segments.innerHTML = (monitoring.segments || []).map((segment) => `
        <li>
          <strong>${escapeHtml(segment.from)} -> ${escapeHtml(segment.to)}: ${escapeHtml(segment.status)}</strong>
          <span>${escapeHtml(segment.observedTransport || segment.expectedTransport)} | encrypted ${escapeHtml(segment.encrypted)} | latency ${escapeHtml(segment.latencyMs ?? "-")} ms</span>
          <span>blockers: ${escapeHtml((segment.blockers || []).join(", ") || "-")}</span>
        </li>
      `).join("") || `<li class="placeholder">No traffic segments available.</li>`;
    }
    const alerts = $("#traffic-alerts");
    if (alerts) {
      alerts.innerHTML = (monitoring.alerts || []).map((alert) => `
        <li>
          <strong>${escapeHtml(alert.severity)}: ${escapeHtml(alert.code)}</strong>
          <span>${escapeHtml(alert.message)}</span>
        </li>
      `).join("") || `<li class="placeholder">No active traffic alerts.</li>`;
    }
    const guardrails = $("#traffic-guardrails");
    if (guardrails) {
      guardrails.innerHTML = Object.entries(monitoring.guardrails || {}).map(([key, value]) => `
        <li><strong>${escapeHtml(key)}</strong><span>${escapeHtml(value)}</span></li>
      `).join("") || `<li class="placeholder">No guardrails reported.</li>`;
    }
  }

  async function recordTrafficEvidence(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await fetchJson("/operator-api/traffic-monitoring/evidence", {
      method: "POST",
      body: {
        segmentId: data.segmentId,
        status: data.status,
        encrypted: data.encrypted === "on",
        transport: data.transport || undefined,
        latencyMs: data.latencyMs ? Number(data.latencyMs) : null,
        packetLossPct: data.packetLossPct ? Number(data.packetLossPct) : null,
        bytesIn: data.bytesIn ? Number(data.bytesIn) : null,
        bytesOut: data.bytesOut ? Number(data.bytesOut) : null,
        evidenceRefs: splitCsv(data.evidenceRefs)
      }
    });
    setText("#traffic-evidence-status", result.error || `Traffic metadata recorded: ${result.evidence.segmentId} ${result.evidence.status}`);
    await loadTrafficMonitoring();
    await loadAudit();
  }

  async function loadLiveAccess() {
    const data = await fetchJson("/operator-api/live-access-foundation");
    if (data.error) {
      setText("#live-access-state", data.error);
      return;
    }
    const foundation = data.foundation;
    setText("#live-access-state", foundation.state);
    setText("#live-access-phase", foundation.phase);
    setText("#live-access-vpn", `${foundation.vpn.state} | evidence ${foundation.vpn.evidenceReady}`);
    setText("#live-access-ca", foundation.ca.trustedOnPixel ? "trusted_on_pixel" : "not_trusted_on_pixel");
    setText("#live-access-blockers", (foundation.blockers || []).join(", ") || "-");
    const checks = $("#live-access-checks");
    if (checks) {
      checks.innerHTML = (foundation.checks || []).map((check) => `
        <li>
          <strong>${escapeHtml(check.key)}: ${escapeHtml(check.status)}</strong>
          <span>${escapeHtml(check.detail)}</span>
        </li>
      `).join("") || `<li class="placeholder">No live access checks.</li>`;
    }
    const apps = $("#live-access-apps");
    if (apps) {
      apps.innerHTML = (foundation.appGateways || []).map((app) => `
        <li>
          <strong>${escapeHtml(app.templateKey)}: ${escapeHtml(app.brokerState)}</strong>
          <span>${escapeHtml(app.host)} | ${escapeHtml(app.runtimeClass)} | CDR ${escapeHtml(app.cdrRequired)}</span>
        </li>
      `).join("") || `<li class="placeholder">No app gateways.</li>`;
    }
    const next = $("#live-access-next");
    if (next) {
      next.innerHTML = (foundation.nextActions || []).map((action) => `<li><strong>${escapeHtml(action)}</strong></li>`).join("") || `<li><strong>Live access foundation is ready for the workload broker.</strong></li>`;
    }
  }

  async function loadStreaming() {
    const width = Math.round(window.visualViewport?.width || window.innerWidth || 390);
    const height = Math.round(window.visualViewport?.height || window.innerHeight || 844);
    const dpr = Number(window.devicePixelRatio || 1).toFixed(2);
    const data = await fetchJson(`/operator-api/streaming-profile?width=${width}&height=${height}&dpr=${dpr}`);
    if (data.error) {
      setText("#stream-status", data.error);
      return;
    }
    const stream = data.profile.stream;
    setText("#stream-status", data.profile.viewport.orientation);
    setText("#stream-resolution", `${stream.targetWidth} x ${stream.targetHeight}`);
    setText("#stream-codec", stream.codec);
    setText("#stream-fps", `${stream.maxFps}`);
    setText("#stream-bitrate", `${stream.maxBitrateKbps} kbps`);
    setText("#stream-pointer-scale", `${stream.pointerScale}`);
    const frame = $(".stream-frame");
    if (frame) {
      frame.style.aspectRatio = `${stream.targetWidth} / ${stream.targetHeight}`;
    }
    const openLink = $("#stream-open-link");
    if (openLink && !openLink.dataset.ready) {
      openLink.hidden = true;
    }
  }

  async function requestStreamSession(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const width = Math.round(window.visualViewport?.width || window.innerWidth || 390);
    const height = Math.round(window.visualViewport?.height || window.innerHeight || 844);
    const dpr = Number(window.devicePixelRatio || 1).toFixed(2);
    const result = await fetchJson("/operator-api/streaming-sessions", {
      method: "POST",
      body: {
        templateKey: data.templateKey,
        protocol: data.protocol,
        width,
        height,
        dpr
      }
    });
    if (result.error) {
      setText("#stream-session-state", result.error);
      return;
    }
    const session = result.session;
    setText("#stream-session-state", session.state);
    setText("#stream-session-gateway", `${session.gateway.host} | ${session.gateway.protocol}`);
    const broker = session.gateway.broker || {};
    const brokerLabel = broker.interimOnly
      ? "interim"
      : broker.productionCandidate
        ? "target candidate"
        : broker.labOnly
          ? "lab only"
          : "not approved";
    setText("#stream-session-broker", `${broker.protocol || session.gateway.protocol} | ${brokerLabel} | ${broker.brokerVisibility || "visibility unknown"}`);
    setText("#stream-session-phantom", broker.phantomReadiness
      ? `${broker.phantomReadiness.state} | ${(broker.phantomReadiness.blockers || []).join(", ") || "ready"}`
      : "-");
    setText("#stream-session-url", session.launchUrl || "blocked_until_gate_passes");
    setText("#stream-session-blockers", (session.blockers || []).join(", ") || "-");
    setText("#stream-session-app", session.appName || data.templateKey);
    setText("#stream-session-message", session.state === "stream_session_ready"
      ? "Live workload stream is ready through G2. Open it in the secured stream wrapper."
      : `Stream blocked: ${(session.blockers || []).join(", ") || "gate not satisfied"}`);
    const openLink = $("#stream-open-link");
    if (openLink) {
      if (session.state === "stream_session_ready") {
        openLink.href = workloadStreamWrapperUrl(session.templateKey || data.templateKey, session.launchUrl || "");
        openLink.dataset.ready = "true";
        openLink.hidden = false;
      } else {
        openLink.removeAttribute("data-ready");
        openLink.hidden = true;
      }
    }
    await loadAudit();
  }

  async function recordStreamReadiness(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const sources = Object.fromEntries(splitCsv(data.sources).map((key) => [key, true]));
    const result = await fetchJson("/operator-api/streaming-readiness", {
      method: "POST",
      body: {
        g2StreamGatewayReady: data.g2StreamGatewayReady === "on",
        tlsInternalOnly: data.tlsInternalOnly === "on",
        guacdTls: data.guacdTls === "on",
        g2ToWorkloadEncrypted: data.g2ToWorkloadEncrypted === "on",
        e2eeStream: data.e2eeStream === "on",
        sframeValidated: data.sframeValidated === "on",
        keySeparationVerified: data.keySeparationVerified === "on",
        keysHeldByBroker: false,
        inputProxyReady: data.inputProxyReady === "on",
        publicInternetExposure: false,
        protocol: data.protocol,
        sources
      }
    });
    setText("#stream-readiness-status", result.error || (result.evidence.ready
      ? `Stream readiness accepted: ${result.evidence.observedAt}`
      : `Readiness incomplete: ${(result.evidence.blockers || []).join(", ")}`));
    await loadAudit();
  }

  function parseRuntimeSources(value) {
    const sources = {};
    for (const item of splitCsv(value)) {
      const [templateKey, bindAddress, port] = item.split(":").map((part) => part.trim());
      if (!templateKey || !bindAddress) continue;
      sources[templateKey] = {
        process: `${templateKey}-stream-source`,
        bindAddress,
        port: Number(port || 7900),
        healthPath: "/healthz",
        cdrRequired: true
      };
    }
    return sources;
  }

  async function recordStreamRuntimeManifest(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await fetchJson("/operator-api/streaming-runtime-manifest", {
      method: "POST",
      body: {
        gateway: {
          process: "sylion-g2-stream-gateway",
          bindAddress: data.gatewayBindAddress,
          port: Number(data.gatewayPort || 8443),
          protocol: data.protocol,
          tlsMode: "internal_tls_only",
          guacdTls: data.guacdTls === "on",
          g2ToWorkloadEncrypted: data.g2ToWorkloadEncrypted === "on",
          e2eeStream: data.e2eeStream === "on",
          sframeValidated: data.sframeValidated === "on",
          keySeparationVerified: data.keySeparationVerified === "on",
          keysHeldByBroker: false,
          workloadMicroVmLink: "host_local_tap_or_vsock",
          publicInternetExposure: false
        },
        sources: parseRuntimeSources(data.sources)
      }
    });
    setText("#stream-runtime-status", result.error || (result.manifest.ready
      ? `Runtime manifest accepted: ${result.manifest.id}`
      : `Runtime manifest blocked: ${(result.manifest.blockers || []).join(", ")}`));
    await loadAudit();
  }

  async function loadSignalPreview() {
    const [pathData, streamData, executionData] = await Promise.all([
      fetchJson("/operator-api/connection-path"),
      fetchJson(`/operator-api/streaming-profile?width=${Math.round(window.visualViewport?.width || window.innerWidth || 390)}&height=${Math.round(window.visualViewport?.height || window.innerHeight || 844)}&dpr=${Number(window.devicePixelRatio || 1).toFixed(2)}`),
      fetchJson("/operator-api/workload-execution/signal")
    ]);
    if (pathData.error) {
      setText("#signal-preview-state", pathData.error);
      return;
    }
    const path = pathData.path;
    const signalSlot = (path.microVmSlots || []).find((slot) => slot.templateKey === "signal")
      || (path.microVmSlots || []).find((slot) => /signal/i.test(slot.appName || ""));
    const routeLabels = [
      path.nodes?.find((node) => node.role === "TERMINAL")?.label || "Pixel",
      "G1",
      "G2",
      "WORKLOAD",
      signalSlot?.appName || "Signal microVM"
    ];
    const route = $("#signal-route");
    if (route) {
      route.innerHTML = routeLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("");
    }
    const execution = executionData.execution || {};
    setText("#signal-slot-state", signalSlot ? `${signalSlot.status} | ${execution.readinessState || signalSlot.targetVpsRole}` : "signal slot not found");
    setText("#signal-preview-state", signalSlot
      ? "Production Signal workload contract loaded. Launch stays blocked until every gate is green."
      : "Signal slot missing from workload plan.");
    setText("#signal-route-state", `${path.state} | ${path.segments?.map((segment) => segment.id).join(" -> ") || "-"}`);
    setText("#signal-isolation", execution.runtime?.isolation || signalSlot?.isolation || "-");
    setText("#signal-egress", execution.runtime?.egressPolicy || signalSlot?.egressPolicy || "-");
    setText("#signal-production", String(Boolean(execution.productionExecutionAllowed)));
    setText("#signal-vpn-substrate", execution.runtime?.substrate?.vpn?.ready ? "established" : "not established");
    setText("#signal-kvm-substrate", execution.runtime?.substrate?.firecrackerKvm?.ready ? "ready" : "blocked");
    setText("#signal-cdr-substrate", execution.runtime?.substrate?.cdr?.ready ? "real control-plane" : "blocked");
    setText("#signal-hsm-fido-substrate", execution.runtime?.substrate?.hsmFido2?.deferred ? "deferred/configurable" : "required");
    if (!streamData.error) {
      setText("#signal-stream-resolution", `${streamData.profile.stream.targetWidth} x ${streamData.profile.stream.targetHeight}`);
    }
    const gateList = $("#signal-gate-list");
    if (gateList) {
      const blockers = execution.blockers || [];
      const warnings = execution.warnings || [];
      gateList.innerHTML = [
        ...blockers.map((blocker) => `<li><strong>${escapeHtml(blocker)}</strong><span>Required before real Signal Firecracker launch.</span></li>`),
        ...warnings.map((warning) => `<li><strong>${escapeHtml(warning)}</strong><span>Tracked warning for this sprint.</span></li>`)
      ].join("") || `<li><strong>ready_for_firecracker_runner</strong><span>All gates passed.</span></li>`;
    }
    const startButton = $("#signal-start-button");
    if (startButton) {
      startButton.disabled = !execution.launchAllowed;
      startButton.textContent = execution.launchAllowed ? "Start Signal" : "Start blocked";
      startButton.onclick = async () => {
        const response = await fetchJson("/operator-api/workload-execution/signal/start", { method: "POST" });
        setText("#signal-preview-state", response.request?.state === "queued_for_firecracker_runner"
          ? "Signal workload queued for Firecracker runner."
          : `Launch blocked: ${(response.request?.blockers || []).slice(0, 2).join(", ")}`);
      };
    }
  }

  async function loadRuntimeGate(templateKey = $("#runtime-gate-form")?.elements.templateKey?.value || "zangi") {
    const data = await fetchJson(`/operator-api/workload-execution/${encodeURIComponent(templateKey)}`);
    if (data.error) {
      setText("#runtime-gate-state", data.error);
      return;
    }
    const execution = data.execution || {};
    const androidRuntime = execution.runtime?.substrate?.androidRuntime || {};
    setText("#runtime-gate-app", execution.appName || templateKey);
    setText("#runtime-gate-kind", execution.runtime?.kind || "-");
    setText("#runtime-gate-runner", execution.runtime?.runner || "-");
    setText("#runtime-gate-state", execution.readinessState || "-");
    setText("#runtime-gate-android-fit", androidRuntime.required ? androidRuntime.currentProviderFit : "not required");
    const list = $("#runtime-gate-list");
    if (list) {
      const blockers = execution.blockers || [];
      const checks = androidRuntime.checks || [];
      list.innerHTML = [
        ...checks.map((check) => `<li><strong>${escapeHtml(check.key)}: ${escapeHtml(check.status)}</strong><span>${escapeHtml(check.detail)}</span></li>`),
        ...blockers.map((blocker) => `<li><strong>${escapeHtml(blocker)}</strong><span>Blocks production launch for this workload.</span></li>`)
      ].join("") || `<li><strong>ready</strong><span>No runtime blockers detected.</span></li>`;
    }
  }

  async function handleRuntimeGate(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    await loadRuntimeGate(data.templateKey || "zangi");
  }

  async function loadAccountBootstrap() {
    const data = await fetchJson("/operator-api/account-bootstrap");
    if (data.error) {
      setText("#account-bootstrap-status", data.error);
      return;
    }
    const bootstrap = data.bootstrap || {};
    const catalog = $("#account-bootstrap-catalog");
    if (catalog) {
      catalog.innerHTML = (bootstrap.catalog || []).map((app) => `
        <article class="app-tile">
          <div>
            <strong>${escapeHtml(app.name)}</strong>
            <span>${escapeHtml(app.category)} | ${escapeHtml(app.defaultRuntimeMode)} | ${escapeHtml(app.defaultMode)}</span>
          </div>
          <div class="app-tile-meta">
            <span class="badge">checks ${escapeHtml((app.requiredChecks || []).join("+"))}</span>
            <span class="badge">CDR ${escapeHtml(app.cdrRequired)}</span>
            <span class="badge badge-warn">QA review</span>
          </div>
        </article>
      `).join("") || `<div class="placeholder">No bootstrap-capable apps.</div>`;
    }
    const list = $("#account-bootstrap-list");
    const latest = (bootstrap.latestSessions || [])[0] || null;
    renderAccountBootstrapHandoff(latest?.humanHandoff || null, latest);
    if (list) {
      list.innerHTML = (bootstrap.latestSessions || []).map((session) => `
        <li>
          <strong>${escapeHtml(session.appName)} - ${escapeHtml(session.state)}</strong>
          <span>${escapeHtml(session.id)} | ${escapeHtml(session.mode)} | ${escapeHtml(session.runtimeMode)} | factual candidate ${escapeHtml(session.factualCandidate)}</span>
          <span>blockers: ${escapeHtml((session.blockers || []).join(", ") || "-")}</span>
        </li>
      `).join("") || `<li class="placeholder">No bootstrap sessions yet.</li>`;
    }
  }

  function renderAccountBootstrapHandoff(handoff, session = null) {
    const panel = $("#account-bootstrap-handoff");
    if (!panel) return;
    if (!handoff) {
      panel.innerHTML = `<p class="placeholder">Create or select a bootstrap session to see the safe handoff steps.</p>`;
      return;
    }
    const steps = (handoff.orderedSteps || []).map((step, index) => `<li><strong>${index + 1}.</strong> ${escapeHtml(step)}</li>`).join("");
    const never = (handoff.neverCollect || []).map((item) => `<span class="badge badge-danger">${escapeHtml(item)}</span>`).join("");
    const allowed = (handoff.allowedRecord || []).map((item) => `<span class="badge">${escapeHtml(item)}</span>`).join("");
    const launchUrl = workloadStreamWrapperUrl(handoff.appKey || session?.appKey || session?.templateKey, handoff.currentLaunchUrl || session?.launchUrl || "");
    panel.innerHTML = `
      <div class="handoff-summary">
        <strong>${escapeHtml(session?.appName || handoff.appKey)} - ${escapeHtml(handoff.state)}</strong>
        <span>${escapeHtml(handoff.operatorInstruction)}</span>
      </div>
      <ol class="handoff-steps">${steps}</ol>
      <div class="app-tile-meta">${never}</div>
      <div class="app-tile-meta">${allowed}</div>
      <div class="quick-actions">
        ${launchUrl ? `<a class="button-link" href="${escapeHtml(launchUrl)}" rel="noopener">Open workload stream</a>` : ""}
        <a class="button-link" href="#app-switcher">Return to apps</a>
      </div>
    `;
  }

  async function requestAccountBootstrap(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await fetchJson("/operator-api/account-bootstrap/sessions", {
      method: "POST",
      body: {
        appKey: data.appKey,
        mode: data.mode,
        runtimeMode: data.runtimeMode,
        approvedPhoneProviderRef: data.approvedPhoneProviderRef || null
      }
    });
    if (result.error) {
      setText("#account-bootstrap-status", result.error);
      return;
    }
    setText("#account-bootstrap-status", `Bootstrap session created: ${result.session.id}`);
    renderAccountBootstrapHandoff(result.session.humanHandoff, result.session);
    const evidenceForm = $("#account-bootstrap-evidence-form");
    if (evidenceForm) evidenceForm.elements.sessionId.value = result.session.id;
    await loadAccountBootstrap();
    await loadAudit();
  }

  async function recordAccountBootstrapEvidence(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const sessionId = String(data.sessionId || "").trim();
    if (!sessionId) {
      setText("#account-bootstrap-status", "Select a bootstrap session first.");
      return;
    }
    const pass = (checked) => ({ status: checked === "on" ? "passed" : "not_run" });
    const result = await fetchJson(`/operator-api/account-bootstrap/sessions/${encodeURIComponent(sessionId)}/evidence`, {
      method: "POST",
      body: {
        result: data.result,
        checks: {
          uiVisible: pass(data.uiVisible),
          accountBootstrap: pass(data.accountBootstrap),
          sendReceive: pass(data.sendReceive),
          walletWorkflow: pass(data.walletWorkflow),
          riskAcceptance: pass(data.riskAcceptance)
        },
        evidenceArtifactIds: splitCsv(data.evidenceArtifactIds),
        latencyMs: data.latencyMs ? Number(data.latencyMs) : null,
        note: data.note || null
      }
    });
    setText("#account-bootstrap-status", result.error || `Evidence recorded: ${result.session.state}`);
    if (!result.error) await loadAccountBootstrap();
    await loadAudit();
  }

  async function loadAudit() {
    const list = $("#audit-list");
    if (!list) return;
    const data = await fetchJson("/operator-api/audit");
    if (data.error) {
      list.innerHTML = `<li class="placeholder">${escapeHtml(data.error)}</li>`;
      return;
    }
    list.innerHTML = (data.events || [])
      .map((e) => `<li>${escapeHtml(e.timestamp)} - ${escapeHtml(e.action)} - ${escapeHtml(e.result)}</li>`)
      .join("") || `<li class="placeholder">No scoped audit events yet.</li>`;
  }

  async function loadSubscription() {
    const data = await fetchJson("/operator-api/subscription");
    if (data.error) return;
    setText("#subscription-plan", data.subscription.plan || "-");
    setText("#subscription-quota", `max environments: ${data.subscription.quota?.maxWorkloadEnvironments ?? "-"}`);
  }

  async function requestSubscriptionChange(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await fetchJson("/operator-api/subscription/requests", {
      method: "POST",
      body: {
        action: data.action,
        targetTier: data.targetTier
      }
    });
    setText("#subscription-request-status", result.error || `${result.request.action} -> ${result.request.state} (${result.request.currentTier} to ${result.request.targetTier})`);
    setText("#session-status", result.error || "Subscription request queued");
  }

  async function loadWorkloads() {
    const list = $("#workloads-list");
    if (!list) return;
    const data = await fetchJson("/operator-api/workloads");
    if (data.error) {
      list.innerHTML = `<li class="placeholder">${escapeHtml(data.error)}</li>`;
      return;
    }
    list.innerHTML = (data.workloads || [])
      .map((w) => `<li>${escapeHtml(w.name)} - ${escapeHtml(w.state)} x${escapeHtml(w.count)}</li>`)
      .join("") || `<li class="placeholder">No workload allocations yet.</li>`;
  }

  async function loadWorkloadControl() {
    const data = await fetchJson("/operator-api/workload-control");
    if (data.error) {
      setText("#workload-control-quota", data.error);
      return;
    }
    const c = data.control;
    setText("#workload-control-quota", `${c.quota.tier}: ${c.quota.maxWorkloadEnvironments} environments, ${c.quota.maxAppsPerOperator} app families`);
    setText("#workload-control-current", countsToText(c.currentCounts));
    setText("#workload-control-last", c.latestRequest ? `${c.latestRequest.action} -> ${c.latestRequest.state} (${c.latestRequest.totalRequested}/${c.quota.maxWorkloadEnvironments})` : "none");
    const runnerForm = $("#workload-live-runner-form");
    if (runnerForm && c.latestRequest?.executionPlan?.liveRunner) {
      runnerForm.elements.requestId.value = c.latestRequest.id;
    }
    renderLiveRunnerJob(c.latestJob || c.latestRequest?.liveJob || null);
    renderWorkloadCatalog(c);
    const form = $("#workload-control-form");
    if (form) {
      const counts = c.latestDesiredCounts || c.currentCounts || {};
      Object.entries(counts).forEach(([key, value]) => {
        if (form.elements[key]) form.elements[key].value = value;
      });
    }
    renderWorkloadPreview(c.latestDesiredCounts || c.currentCounts || {}, c.latestRequest);
  }

  async function requestWorkloadControl(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const appKeys = [
      "whatsapp",
      "signal",
      "telegram",
      "threema",
      "zangi",
      "simplex",
      "matrix_client",
      "matrix_server",
      "protonmail",
      "duckduckgo_browser",
      "libreoffice",
      "exodus"
    ];
    const desiredCounts = Object.fromEntries(appKeys.map((key) => [key, Number(data[key] || 0)]));
    const result = await fetchJson("/operator-api/workload-control/requests", {
      method: "POST",
      body: {
        action: data.action,
        rotateApp: data.rotateApp,
        desiredCounts
      }
    });
    setText("#session-status", result.error || `Workload control queued: ${result.request.state}`);
    const preview = $("#workload-control-preview");
    if (preview && result.request?.executionPlan) {
      preview.classList.remove("placeholder");
      preview.textContent = `${result.request.executionPlan.mode}: ${result.request.executionPlan.stages.join(" -> ")} | CDR ${result.request.executionPlan.cdr.required}`;
    }
    const runnerForm = $("#workload-live-runner-form");
    if (runnerForm && result.request?.executionPlan?.liveRunner) {
      runnerForm.elements.requestId.value = result.request.id;
      runnerForm.elements.confirmation.value = "";
    }
    await loadWorkloadControl();
    await loadAudit();
  }

  async function executeLiveWorkloadRunner(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const requestId = String(data.requestId || "").trim();
    if (!requestId) {
      setText("#workload-live-runner-result", "Select or enter a destructive workload request ID first.");
      return;
    }
    const result = await fetchJson(`/operator-api/workload-control/requests/${encodeURIComponent(requestId)}/execute`, {
      method: "POST",
      body: {
        confirmation: data.confirmation,
        wipeVolume: data.wipeVolume === "on",
        fourEyesApprovalRef: data.fourEyesApprovalRef || null
      }
    });
    if (result.error) {
      setText("#workload-live-runner-result", result.error);
      return;
    }
    renderLiveRunnerJob(result.job);
    setText("#session-status", `Live runner job: ${result.job.state}`);
    await loadWorkloadControl();
    await loadAudit();
  }

  function renderWorkloadCatalog(control) {
    const catalog = $("#workload-app-catalog");
    if (!catalog) return;
    const counts = control.latestDesiredCounts || control.currentCounts || {};
    catalog.innerHTML = (control.catalog || []).map((app) => {
      const count = Number(counts[app.key] || 0);
      const risk = app.requiresOperatorRiskAcceptance ? `<span class="badge badge-warn">operator risk</span>` : "";
      const native = app.nativeRuntimeRequired ? `<span class="badge badge-warn">native ${escapeHtml(app.nativeRuntimeClass)}</span>` : "";
      const runtime = app.runtimeGate?.required
        ? `<span class="badge ${app.runtimeGate.ready ? "" : "badge-warn"}">${escapeHtml(app.runtimeGate.currentProviderFit)}</span>`
        : "";
      return `
        <article class="app-tile">
          <div>
            <strong>${escapeHtml(app.name)}</strong>
            <span>${escapeHtml(app.category)} | ${escapeHtml(app.isolation)}</span>
          </div>
          <div class="app-tile-meta">
            <span class="badge">${escapeHtml(count)} env</span>
            <span class="badge">CDR ${escapeHtml(app.cdrRequired)}</span>
            ${native}
            ${runtime}
            ${risk}
          </div>
        </article>
      `;
    }).join("") || `<div class="placeholder">No authorized workload apps.</div>`;
  }

  function renderWorkloadPreview(counts, latestRequest) {
    const preview = $("#workload-control-preview");
    if (!preview) return;
    const entries = Object.entries(counts || {}).filter(([, value]) => Number(value) > 0);
    const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);
    const action = latestRequest?.action || "scale_to_counts";
    const rotate = latestRequest?.rotateApp ? ` | rotate: ${latestRequest.rotateApp}` : "";
    preview.classList.remove("placeholder");
    preview.innerHTML = `
      <strong>Execution preview</strong>
      <span>${escapeHtml(action)}${escapeHtml(rotate)} | total requested: ${escapeHtml(total)}</span>
      <span>${escapeHtml(entries.map(([key, value]) => `${key} x${value}`).join(", ") || "no environments selected")}</span>
      <span>Runner status: control-plane queued, production side effects blocked until human gate.</span>
    `;
  }

  function renderLiveRunnerJob(job) {
    const preview = $("#workload-live-runner-result");
    if (!preview) return;
    if (!job) {
      preview.classList.add("placeholder");
      preview.textContent = "No live runner job executed from this browser session.";
      return;
    }
    preview.classList.remove("placeholder");
    const smoke = job.result?.smoke ? Object.entries(job.result.smoke).map(([key, value]) => `${key}:${value}`).join(", ") : "-";
    const blockers = (job.blockers || []).join(", ") || "-";
    preview.innerHTML = `
      <strong>${escapeHtml(job.state)}</strong>
      <span>job ${escapeHtml(job.id)} | request ${escapeHtml(job.requestId)} | runner ${escapeHtml(job.runnerApp)} | wipe ${escapeHtml(job.wipeVolume)}</span>
      <span>CDR ${escapeHtml(job.cdrRequired)} | terminal data stored ${escapeHtml(job.terminalDataStored)} | private bind required ${escapeHtml(job.privateBindOnlyRequired)}</span>
      <span>smoke: ${escapeHtml(smoke)} | blockers: ${escapeHtml(blockers)}</span>
    `;
  }

  function setText(sel, value) {
    const el = $(sel);
    if (el) el.textContent = value;
  }

  function splitCsv(value) {
    return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  }

  function countsToText(counts = {}) {
    const entries = Object.entries(counts).filter(([, value]) => Number(value) > 0);
    return entries.length ? entries.map(([key, value]) => `${key}:${value}`).join(", ") : "none";
  }

  function updateSessionCountdown() {
    const expiresAt = state.session?.expiresAt;
    if (!expiresAt) {
      setText("#session-countdown", "Session timer unavailable.");
      return;
    }
    const ms = Date.parse(expiresAt) - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) {
      setText("#session-countdown", "Session expired. Re-authentication required.");
      return;
    }
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    setText("#session-countdown", `Session expires in ${hours}h ${minutes}m. After that, layer passwords and FIDO2 re-auth are required.`);
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function loadViewData(viewId) {
    if (viewId === "overview") loadOverview();
    if (viewId === "app-switcher") loadAppSwitcher();
    if (viewId === "devices") loadDevices();
    if (viewId === "workloads") loadWorkloads();
    if (viewId === "workload-control") loadWorkloadControl();
    if (viewId === "connection-path") loadConnectionPath();
    if (viewId === "traffic-monitoring") loadTrafficMonitoring();
    if (viewId === "live-access") loadLiveAccess();
    if (viewId === "signal-preview") loadSignalPreview();
    if (viewId === "runtime-gate") loadRuntimeGate();
    if (viewId === "account-bootstrap") loadAccountBootstrap();
    if (viewId === "vpn") loadVpn();
    if (viewId === "streaming") loadStreaming();
    if (viewId === "audit") loadAudit();
    if (viewId === "settings-unlock") loadUnlockPolicy();
    if (viewId === "settings-safety") loadSafetyPolicy();
    if (viewId === "settings-jurisdiction") loadJurisdictionPolicy();
    if (viewId === "matrix-server") loadMatrixServer();
    if (viewId === "settings-fido2") loadFido2();
    if (viewId === "settings-hsm") loadHsm();
    if (viewId === "subscription") loadSubscription();
  }

  document.addEventListener("DOMContentLoaded", function () {
    void initOperatorPortal();
  });

  async function initOperatorPortal() {
    $(".sidebar").addEventListener("click", handleNav);
    $("#app-switcher").addEventListener("click", handleInternalSwitcher);
    document.addEventListener("click", handleWorkloadLaunchClick, true);
    $("#session-form").addEventListener("submit", createLocalSession);
    $("#workload-control-form").addEventListener("submit", requestWorkloadControl);
    $("#workload-live-runner-form").addEventListener("submit", executeLiveWorkloadRunner);
    $("#runtime-gate-form").addEventListener("submit", handleRuntimeGate);
    $("#account-bootstrap-form").addEventListener("submit", requestAccountBootstrap);
    $("#account-bootstrap-evidence-form").addEventListener("submit", recordAccountBootstrapEvidence);
    $("#vpn-evidence-form").addEventListener("submit", recordVpnEvidence);
    $("#traffic-evidence-form").addEventListener("submit", recordTrafficEvidence);
    $("#stream-session-form").addEventListener("submit", requestStreamSession);
    $("#stream-readiness-form").addEventListener("submit", recordStreamReadiness);
    $("#stream-runtime-form").addEventListener("submit", recordStreamRuntimeManifest);
    $("#unlock-form").addEventListener("submit", saveUnlockPolicy);
    $("#safety-form").addEventListener("submit", saveSafetyPolicy);
    $("#jurisdiction-form").addEventListener("submit", saveJurisdictionPolicy);
    $("#workload-broker-form").addEventListener("submit", prepareWorkloadBroker);
    $("#workload-recreate-form").addEventListener("submit", recreateWorkloadApp);
    $("#matrix-form").addEventListener("submit", requestMatrixServer);
    $("#subscription-form").addEventListener("submit", requestSubscriptionChange);
    $("#fido2-form").addEventListener("submit", saveFido2);
    $("#hsm-form").addEventListener("submit", saveHsm);
    await bootstrapOperatorToken();
    if (state.session) {
      const source = state.cookieBound ? "cookie-bound" : "active";
      setText("#session-status", `Session ${source} for ${state.session.operatorId} (${state.session.terminalMode})`);
    }
    const initialView = parseHashState().viewId;
    setActiveView(initialView);
    loadViewData(initialView);
    updateSessionCountdown();
    setInterval(updateSessionCountdown, 30000);
    window.addEventListener("resize", () => {
      if ($("#streaming")?.classList.contains("active")) loadStreaming();
    });
  }
})();
