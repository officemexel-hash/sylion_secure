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
  const operatorToken = bootstrapOperatorToken();
  const frame = $("#workload-stream-frame");
  const blocker = $("#stream-blocker");
  const blockerReason = $("#stream-blocker-reason");
  const toast = $("#stream-toast");
  const label = $("#stream-app-label");
  const state = $("#stream-app-state");
  const inputPanel = $("#stream-input-panel");
  const inputText = $("#stream-input-text");
  let inputBusy = false;

  function normalizeApp(value) {
    const clean = String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    return ALIASES[clean] || clean;
  }

  function bootstrapOperatorToken() {
    const rawHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    const hashParams = new URLSearchParams(rawHash);
    const token = params.get("op_token") || hashParams.get("op_token");
    if (token && /^op_[A-Za-z0-9]+$/.test(token)) {
      sessionStorage.setItem("sylion.operator.token", token);
      sessionStorage.setItem("sylion.operator.streamToken", token);
      params.delete("op_token");
      hashParams.delete("op_token");
      const cleanQuery = params.toString();
      const cleanHash = hashParams.toString() ? `#${hashParams.toString()}` : "";
      const cleanUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}${cleanHash}`;
      window.history.replaceState(null, "", cleanUrl);
      return token;
    }
    return sessionStorage.getItem("sylion.operator.token") || sessionStorage.getItem("sylion.operator.streamToken");
  }

  function appUrl(app) {
    return `https://${app.host}${app.path}`;
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function waitForFrameLoad(timeoutMs = 5000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        frame.removeEventListener("load", finish);
        resolve();
      };
      frame.addEventListener("load", finish);
      window.setTimeout(finish, timeoutMs);
    });
  }

  function splitGuacamoleLaunchUrls(launchUrl) {
    const url = new URL(launchUrl);
    if (!url.hash.startsWith("#/client/")) {
      return { loginUrl: url.toString(), clientUrl: url.toString(), requiresBootstrap: false };
    }

    const [, hashQuery = ""] = url.hash.slice(1).split("?");
    if (new URLSearchParams(hashQuery).has("data")) {
      return { loginUrl: url.toString(), clientUrl: url.toString(), requiresBootstrap: false };
    }

    const loginUrl = new URL(url.toString());
    loginUrl.hash = "";

    const clientUrl = new URL(url.toString());
    clientUrl.search = "";
    clientUrl.hash = url.hash;

    return {
      loginUrl: loginUrl.toString(),
      clientUrl: clientUrl.toString(),
      requiresBootstrap: true
    };
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
        "x-sylion-operator-csrf": "same-origin-ui",
        ...(operatorToken ? { authorization: `Bearer ${operatorToken}` } : {})
      },
      body: JSON.stringify({ templateKey: appKey, width, height, dpr })
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload?.error?.message || `HTTP ${res.status}`);
    }
    return payload.handoff;
  }

  async function sendWorkloadInput({ text = "", submit = false, preKeys = [], postKeys = [] } = {}) {
    if (inputBusy) return null;
    inputBusy = true;
    state.textContent = "Sending keyboard events to workload...";
    try {
      const res = await fetch("/operator-api/workload-input", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": `corr_operator_input_${crypto.randomUUID()}`,
          "x-sylion-operator-csrf": "same-origin-ui",
          ...(operatorToken ? { authorization: `Bearer ${operatorToken}` } : {})
        },
        body: JSON.stringify({ templateKey: requestedApp, text, submit, preKeys, postKeys })
      });
      const payload = await res.json();
      if (!res.ok || payload?.input?.state !== "workload_input_sent") {
        const blockers = payload?.input?.blockers?.join(", ") || payload?.error?.message || `HTTP ${res.status}`;
        throw new Error(blockers);
      }
      state.textContent = "Keyboard events sent.";
      const keyCount = preKeys.length + postKeys.length + (submit ? 1 : 0);
      showToast(text ? (keyCount ? "Text and keys sent to workload." : "Text sent to workload.") : "Key sent to workload.");
      return payload.input;
    } finally {
      inputBusy = false;
    }
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

  function showInputPanel() {
    if (!inputPanel) return;
    inputPanel.hidden = false;
    window.setTimeout(() => inputText?.focus({ preventScroll: true }), 40);
  }

  function hideInputPanel() {
    if (!inputPanel) return;
    inputPanel.hidden = true;
    inputText?.blur();
  }

  function updateKeyboardOffset() {
    const viewport = window.visualViewport;
    if (!viewport) {
      document.documentElement.style.setProperty("--stream-keyboard-offset", "0px");
      return;
    }
    const offset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
    document.documentElement.style.setProperty("--stream-keyboard-offset", `${offset}px`);
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
        showInputPanel();
        showToast("Private input panel ready.");
      }
      if (action === "keyboard-tools") {
        showKeyboardTools("operator_toolbar_tools");
        showInputPanel();
        showToast("Private input panel ready.");
      }
      if (action === "input-enter") {
        sendWorkloadInput({ submit: true }).catch((error) => showToast(`Input blocked: ${error.message}`));
      }
      if (action === "input-backspace") {
        sendWorkloadInput({ postKeys: ["backspace"] }).catch((error) => showToast(`Input blocked: ${error.message}`));
      }
      if (action === "input-clear") {
        sendWorkloadInput({ preKeys: ["select_all", "backspace"] }).catch((error) => showToast(`Input blocked: ${error.message}`));
      }
      if (action === "input-close") {
        hideInputPanel();
      }
      if (action === "fit") {
        requestFit();
      }
    });

    inputPanel?.addEventListener("submit", (event) => {
      event.preventDefault();
      const submitter = event.submitter?.dataset?.streamSubmit || "text";
      const value = inputText?.value || "";
      const submit = submitter === "text-enter";
      sendWorkloadInput({ text: value, submit })
        .then((result) => {
          if (result && inputText) inputText.value = "";
        })
        .catch((error) => showToast(`Input blocked: ${error.message}`));
    });
    inputText?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const value = inputText.value || "";
        sendWorkloadInput({ text: value, submit: true })
          .then((result) => {
            if (result) inputText.value = "";
          })
          .catch((error) => showToast(`Input blocked: ${error.message}`));
      }
      if (event.key === "Backspace" && !inputText.value) {
        event.preventDefault();
        sendWorkloadInput({ postKeys: ["backspace"] }).catch((error) => showToast(`Input blocked: ${error.message}`));
      }
      if (event.key === "Escape") {
        event.preventDefault();
        hideInputPanel();
      }
    });
    updateKeyboardOffset();
    window.visualViewport?.addEventListener("resize", updateKeyboardOffset);
    window.visualViewport?.addEventListener("scroll", updateKeyboardOffset);
    window.addEventListener("resize", updateKeyboardOffset);

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

  async function openGuacamoleHandoff(handoff) {
    const launch = splitGuacamoleLaunchUrls(handoff.launchUrl);
    if (!launch.requiresBootstrap) {
      frame.src = launch.clientUrl;
      return;
    }

    state.textContent = `Authenticating ${handoff.broker.connectionName} through Guacamole.`;
    frame.src = launch.loginUrl;
    await waitForFrameLoad(5500);
    await delay(1800);

    state.textContent = `Opening ${handoff.broker.connectionName} through Guacamole.`;
    frame.src = launch.clientUrl;
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
    if (requestedBroker === "blind_e2ee") {
      frame.hidden = true;
      blocker.hidden = false;
      blockerReason.textContent = "PHANTOM blind E2EE streaming is the target backend, but the frame encryption/key-separation proof is not installed in this wrapper yet.";
      state.textContent = "Blind E2EE stream blocked until ADR and implementation proof.";
      return;
    }
    state.textContent = "Requesting encrypted Guacamole handoff from G2...";
    try {
      const handoff = await fetchGuacamoleHandoff(requestedApp);
      if (!handoff?.launchUrl || handoff.state !== "guacamole_handoff_ready") {
        throw new Error(`Handoff blocked: ${(handoff?.blockers || []).join(", ") || "unknown blocker"}`);
      }
      await openGuacamoleHandoff(handoff);
    } catch (error) {
      frame.hidden = true;
      blocker.hidden = false;
      blockerReason.textContent = String(error.message || error);
      state.textContent = "Guacamole handoff blocked";
    }
  }

  boot();
})();
