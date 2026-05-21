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

  function bootstrapLocalLabToken() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("op_token");
    const localhost = ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
    if (!token || !localhost || !token.startsWith("op_")) return;
    state.operatorToken = token;
    sessionStorage.setItem("sylion.operator.token", token);
    params.delete("op_token");
    const cleanSearch = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ""}${window.location.hash}`);
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

  function setText(sel, value) {
    const el = $(sel);
    if (el) el.textContent = value;
  }

  function splitCsv(value) {
    return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
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
    if (viewId === "devices") loadDevices();
    if (viewId === "workloads") loadWorkloads();
    if (viewId === "connection-path") loadConnectionPath();
    if (viewId === "signal-preview") loadSignalPreview();
    if (viewId === "vpn") loadVpn();
    if (viewId === "streaming") loadStreaming();
    if (viewId === "audit") loadAudit();
    if (viewId === "settings-fido2") loadFido2();
    if (viewId === "settings-hsm") loadHsm();
    if (viewId === "subscription") loadSubscription();
  }

  document.addEventListener("DOMContentLoaded", function () {
    bootstrapLocalLabToken();
    $(".sidebar").addEventListener("click", handleNav);
    $("#session-form").addEventListener("submit", createLocalSession);
    $("#fido2-form").addEventListener("submit", saveFido2);
    $("#hsm-form").addEventListener("submit", saveHsm);
    if (state.session) {
      setText("#session-status", `Session active for ${state.session.operatorId} (${state.session.terminalMode})`);
    }
    const initialView = (location.hash || "#overview").replace("#", "");
    setActiveView(initialView);
    loadViewData(initialView);
    window.addEventListener("resize", () => {
      if ($("#streaming")?.classList.contains("active")) loadStreaming();
    });
  });
})();
