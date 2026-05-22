// SYLION Operator Portal - scoped local contract.
// Physical FIDO2/HSM and router package remain gated; this UI exercises the
// operator/admin configuration surface without production execution.

(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    operatorToken: sessionStorage.getItem("sylion.operator.token") || null,
    session: JSON.parse(sessionStorage.getItem("sylion.operator.session") || "null")
  };

  function bootstrapOperatorToken() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("op_token");
    const localhost = ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
    const internalHost = window.location.protocol === "https:" && window.location.hostname.endsWith(".sylion.internal");
    if (!token || (!localhost && !internalHost) || !token.startsWith("op_")) return;
    state.operatorToken = token;
    sessionStorage.setItem("sylion.operator.token", token);
    params.delete("op_token");
    const cleanSearch = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ""}${window.location.hash}`);
    setText("#session-status", internalHost ? "Operator session received through internal VPN link." : "Operator session received through local lab link.");
  }

  function headers(extra = {}) {
    return {
      "content-type": "application/json",
      "x-correlation-id": `corr_operator_web_${crypto.randomUUID()}`,
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
    sessionStorage.setItem("sylion.operator.session", JSON.stringify(payload.session));
    sessionStorage.setItem("sylion.operator.token", payload.session.token);
    setText("#session-status", `Session active for ${payload.session.operatorId} (${payload.session.terminalMode})`);
    await loadOverview();
  }

  async function loadOverview() {
    setText("#terminal-mode", detectTerminalMode());
    if (!state.operatorToken) {
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
    const data = await fetchJson("/operator-api/settings/jurisdiction");
    if (data.error) {
      list.innerHTML = `<li class="placeholder">${escapeHtml(data.error)}</li>`;
      return;
    }
    const p = data.policy;
    const form = $("#jurisdiction-form");
    if (form) {
      form.elements.mode.value = p.mode;
      form.elements.regions.value = (p.regions || []).join(",");
    }
    list.innerHTML = `<li><strong>${escapeHtml(p.mode)}</strong><span>tier mode: ${escapeHtml(p.subscriptionMode)} | regions: ${escapeHtml((p.regions || []).join(", ") || "none")} | state: ${escapeHtml(p.state)}</span></li>`;
  }

  async function saveJurisdictionPolicy(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await fetchJson("/operator-api/settings/jurisdiction", {
      method: "POST",
      body: {
        mode: data.mode,
        regions: splitCsv(data.regions)
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
    const install = await fetchJson("/operator-api/vpn-install-package");
    if (!install.error) {
      setText("#vpn-install-state", install.package.installState);
      setText("#vpn-install-type", install.package.packageType);
      setText("#vpn-install-blockers", (install.package.requires || []).join(", "));
    }
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
      "matrix_client",
      "matrix_server",
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
    if (viewId === "app-switcher") loadOverview();
    if (viewId === "devices") loadDevices();
    if (viewId === "workloads") loadWorkloads();
    if (viewId === "workload-control") loadWorkloadControl();
    if (viewId === "connection-path") loadConnectionPath();
    if (viewId === "signal-preview") loadSignalPreview();
    if (viewId === "runtime-gate") loadRuntimeGate();
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
    bootstrapOperatorToken();
    $(".sidebar").addEventListener("click", handleNav);
    $("#app-switcher").addEventListener("click", handleInternalSwitcher);
    $("#session-form").addEventListener("submit", createLocalSession);
    $("#workload-control-form").addEventListener("submit", requestWorkloadControl);
    $("#runtime-gate-form").addEventListener("submit", handleRuntimeGate);
    $("#unlock-form").addEventListener("submit", saveUnlockPolicy);
    $("#safety-form").addEventListener("submit", saveSafetyPolicy);
    $("#jurisdiction-form").addEventListener("submit", saveJurisdictionPolicy);
    $("#matrix-form").addEventListener("submit", requestMatrixServer);
    $("#subscription-form").addEventListener("submit", requestSubscriptionChange);
    $("#fido2-form").addEventListener("submit", saveFido2);
    $("#hsm-form").addEventListener("submit", saveHsm);
    if (state.session) {
      setText("#session-status", `Session active for ${state.session.operatorId} (${state.session.terminalMode})`);
    }
    const initialView = (location.hash || "#overview").replace("#", "");
    setActiveView(initialView);
    loadViewData(initialView);
    updateSessionCountdown();
    setInterval(updateSessionCountdown, 30000);
    window.addEventListener("resize", () => {
      if ($("#streaming")?.classList.contains("active")) loadStreaming();
    });
  });
})();
