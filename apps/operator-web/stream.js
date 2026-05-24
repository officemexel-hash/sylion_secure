// SYLION Pixel-friendly workload stream wrapper.
// It stores no operational input. It requests a short-lived Guacamole JSON
// auth handoff from the operator API, then launches only allowlisted internal
// workload streams through G2.

(function () {
  "use strict";

  const STREAM_PATH = "/vnc.html?autoconnect=true&resize=remote&path=websockify";
  const WORKLOADS = Object.freeze({
    duckduckgo_browser: { label: "DuckDuckGo", host: "duckduckgo.sylion.internal", path: STREAM_PATH },
    libreoffice: { label: "LibreOffice", host: "libreoffice.sylion.internal", path: STREAM_PATH },
    whatsapp: { label: "WhatsApp", host: "whatsapp.sylion.internal", path: STREAM_PATH },
    telegram: { label: "Telegram", host: "telegram.sylion.internal", path: STREAM_PATH },
    threema: { label: "Threema", host: "threema.sylion.internal", path: STREAM_PATH },
    signal: { label: "Signal", host: "signal.sylion.internal", path: STREAM_PATH },
    zangi: { label: "Zangi", host: "zangi.sylion.internal", path: STREAM_PATH },
    exodus: { label: "Exodus", host: "exodus.sylion.internal", path: STREAM_PATH }
  });

  const ALIASES = Object.freeze({
    duckduckgo: "duckduckgo_browser",
    browser: "duckduckgo_browser"
  });

  const $ = (sel) => document.querySelector(sel);
  const params = new URLSearchParams(window.location.search);
  const requestedApp = normalizeApp(params.get("app") || "duckduckgo_browser");
  const requestedBroker = String(params.get("broker") || "guacamole").toLowerCase();
  const frame = $("#workload-stream-frame");
  const blocker = $("#stream-blocker");
  const blockerReason = $("#stream-blocker-reason");
  const toast = $("#stream-toast");
  const label = $("#stream-app-label");
  const state = $("#stream-app-state");

  function normalizeApp(value) {
    const clean = String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    return ALIASES[clean] || clean;
  }

  function appUrl(app) {
    return `https://${app.host}${app.path}`;
  }

  async function fetchGuacamoleHandoff(appKey) {
    const width = Math.round(window.visualViewport?.width || window.innerWidth || 390);
    const height = Math.round(window.visualViewport?.height || window.innerHeight || 844);
    const dpr = Number(window.devicePixelRatio || 1).toFixed(2);
    const res = await fetch("/operator-api/guacamole-handoff", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": `corr_operator_stream_${crypto.randomUUID()}`,
        "x-sylion-operator-csrf": "same-origin-ui"
      },
      body: JSON.stringify({ templateKey: appKey, width, height, dpr })
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload?.error?.message || `HTTP ${res.status}`);
    }
    return payload.handoff;
  }

  function showToast(message) {
    toast.textContent = message;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      toast.textContent = "";
    }, 2400);
  }

  function postToStream(action, extra = {}) {
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage({ action, ...extra }, "*");
  }

  function showKeyboardTools(reason = "manual") {
    postToStream("show_keyboard_controls", {
      reason,
      virtual_keyboard_visible: true,
      enable_ime_mode: false
    });
  }

  function requestFit() {
    postToStream("update_quality", { scaleViewport: true });
    postToStream("set_scale", { scale: "remote" });
    showToast("Fit request sent to stream.");
  }

  function bindControls() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-stream-action]");
      if (!button) return;
      const action = button.dataset.streamAction;
      if (action === "keyboard") {
        showKeyboardTools("operator_toolbar");
        showToast("Keyboard tools requested. Tap the small keyboard control inside the stream.");
      }
      if (action === "keyboard-tools") {
        showKeyboardTools("operator_toolbar_tools");
        showToast("Input tools requested without opening the side menu.");
      }
      if (action === "fit") {
        requestFit();
      }
    });

    window.addEventListener("message", (event) => {
      if (event?.data?.action === "noVNC_initialized") {
        showKeyboardTools("stream_initialized");
        state.textContent = "Connected. Keyboard controls ready.";
      }
    });

    frame.addEventListener("load", () => {
      state.textContent = "Stream loaded. Keyboard controls requested.";
      window.setTimeout(() => showKeyboardTools("frame_load"), 700);
      window.setTimeout(() => showKeyboardTools("frame_load_retry"), 1800);
    });
  }

  async function boot() {
    const workload = WORKLOADS[requestedApp];
    if (!workload) {
      frame.hidden = true;
      blocker.hidden = false;
      blockerReason.textContent = `Unsupported workload app: ${requestedApp || "empty"}`;
      label.textContent = "Blocked";
      state.textContent = "Unknown app";
      return;
    }
    label.textContent = workload.label;
    bindControls();
    if (requestedBroker === "direct_lab") {
      state.textContent = "Opening direct lab stream through internal G2 workload gateway...";
      frame.src = appUrl(workload);
      return;
    }
    state.textContent = "Requesting encrypted Guacamole handoff from G2...";
    try {
      const handoff = await fetchGuacamoleHandoff(requestedApp);
      if (!handoff?.launchUrl || handoff.state !== "guacamole_handoff_ready") {
        throw new Error(`Handoff blocked: ${(handoff?.blockers || []).join(", ") || "unknown blocker"}`);
      }
      state.textContent = `Opening ${handoff.broker.connectionName} through Guacamole.`;
      frame.src = handoff.launchUrl;
    } catch (error) {
      frame.hidden = true;
      blocker.hidden = false;
      blockerReason.textContent = String(error.message || error);
      state.textContent = "Guacamole handoff blocked";
    }
  }

  boot();
})();
