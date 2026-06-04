// SYLION Pixel-friendly workload stream wrapper.
// It stores no operational input. It requests a short-lived Guacamole JSON
// auth handoff from the operator API, then launches only allowlisted internal
// workload streams through G2.

(function () {
  "use strict";

  const STREAM_PATH = "/vnc.html?autoconnect=true&resize=remote&path=websockify";
  const SELKIES_PATH = "/";
  const WORKLOADS = Object.freeze({
    duckduckgo_browser: { label: "DuckDuckGo", host: "duckduckgo.sylion.internal", path: SELKIES_PATH, directGateway: true },
    libreoffice: { label: "LibreOffice", host: "libreoffice.sylion.internal", path: SELKIES_PATH, directGateway: true },
    whatsapp: { label: "WhatsApp", host: "whatsapp.sylion.internal", path: SELKIES_PATH, directGateway: true },
    protonmail: { label: "Proton Mail", host: "protonmail.sylion.internal", path: SELKIES_PATH, directGateway: true },
    telegram: { label: "Telegram", host: "telegram.sylion.internal", path: SELKIES_PATH, directGateway: true },
    threema: { label: "Threema", host: "threema.sylion.internal", path: SELKIES_PATH, directGateway: true },
    signal: { label: "Signal", host: "signal.sylion.internal", path: STREAM_PATH },
    simplex: { label: "SimpleX Chat", host: "simplex.sylion.internal", path: SELKIES_PATH, directGateway: true },
    zangi: { label: "Zangi", host: "zangi.sylion.internal", path: SELKIES_PATH, directGateway: true },
    exodus: { label: "Exodus", host: "exodus.sylion.internal", path: SELKIES_PATH, directGateway: true }
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
  const blindCanvas = $("#blind-e2ee-canvas");
  const blocker = $("#stream-blocker");
  const blockerTitle = $("#stream-blocker-title");
  const blockerReason = $("#stream-blocker-reason");
  const toast = $("#stream-toast");
  const label = $("#stream-app-label");
  const state = $("#stream-app-state");
  const inputPanel = $("#stream-input-panel");
  const inputText = $("#stream-input-text");
  let inputBusy = false;
  let blindTerminalKeyPair = null;
  let blindLastFrameId = null;
  let blindCaptureBusy = false;
  let blindLastCaptureAt = 0;

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

  async function fetchBlindE2eeSession(appKey, terminalPublicKeyJwk) {
    const width = Math.round(window.visualViewport?.width || window.innerWidth || 390);
    const height = Math.round(window.visualViewport?.height || window.innerHeight || 844);
    const dpr = Number(window.devicePixelRatio || 1).toFixed(2);
    const res = await fetch("/operator-api/blind-e2ee/sessions", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": `corr_operator_blind_${crypto.randomUUID()}`,
        "x-sylion-operator-csrf": "same-origin-ui",
        ...(operatorToken ? { authorization: `Bearer ${operatorToken}` } : {})
      },
      body: JSON.stringify({
        templateKey: appKey,
        width,
        height,
        dpr,
        terminalPublicKeyJwk,
        terminalCryptoProfile: "ECDH_P384_AES_256_GCM_FRAME_V1"
      })
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload?.error?.message || `HTTP ${res.status}`);
    }
    return payload.session;
  }

  async function fetchBlindE2eeLatestFrame(endpoint) {
    const res = await fetch(endpoint, {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "x-correlation-id": `corr_operator_blind_frame_${crypto.randomUUID()}`,
        "x-sylion-operator-csrf": "same-origin-ui",
        ...(operatorToken ? { authorization: `Bearer ${operatorToken}` } : {})
      }
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload?.error?.message || `HTTP ${res.status}`);
    }
    return payload.relay;
  }

  async function requestBlindE2eeCapture(session) {
    if (blindCaptureBusy) return null;
    const now = Date.now();
    if (now - blindLastCaptureAt < 1200) return null;
    blindCaptureBusy = true;
    blindLastCaptureAt = now;
    try {
      const res = await fetch(`/operator-api/blind-e2ee/sessions/${encodeURIComponent(session.id)}/frames/capture-once`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": `corr_operator_blind_capture_${crypto.randomUUID()}`,
          "x-sylion-operator-csrf": "same-origin-ui",
          ...(operatorToken ? { authorization: `Bearer ${operatorToken}` } : {})
        },
        body: JSON.stringify({})
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error?.message || `HTTP ${res.status}`);
      }
      return payload.frame;
    } finally {
      blindCaptureBusy = false;
    }
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

  function showStreamMessage({ titleText, reasonText, stateText }) {
    frame.hidden = true;
    if (blindCanvas) blindCanvas.hidden = true;
    blocker.hidden = false;
    blockerTitle.textContent = titleText;
    blockerReason.textContent = reasonText;
    state.textContent = stateText || titleText;
  }

  function showBlindCanvas() {
    frame.hidden = true;
    blocker.hidden = true;
    if (blindCanvas) blindCanvas.hidden = false;
  }

  function base64ToBytes(value) {
    const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
    const raw = window.atob(normalized);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
      bytes[i] = raw.charCodeAt(i);
    }
    return bytes;
  }

  async function ensureBlindTerminalKeyPair() {
    if (!window.crypto?.subtle) {
      throw new Error("WebCrypto unavailable on this terminal");
    }
    if (!blindTerminalKeyPair) {
      blindTerminalKeyPair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-384" },
        true,
        ["deriveKey"]
      );
    }
    return blindTerminalKeyPair;
  }

  async function exportBlindTerminalPublicKey() {
    const pair = await ensureBlindTerminalKeyPair();
    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    return {
      kty: publicJwk.kty,
      crv: publicJwk.crv,
      x: publicJwk.x,
      y: publicJwk.y,
      ext: true,
      key_ops: []
    };
  }

  async function decryptBlindFrame(frameEnvelope) {
    if (frameEnvelope.algorithm !== "ECDH_P384_AES_256_GCM_FRAME_V1") {
      throw new Error(`Unsupported terminal decoder algorithm: ${frameEnvelope.algorithm}`);
    }
    if (!frameEnvelope.workloadPublicKeyJwk || !frameEnvelope.ivB64 || !frameEnvelope.ciphertextB64) {
      throw new Error("Encrypted frame is missing workload public key, IV, or ciphertext");
    }
    const pair = await ensureBlindTerminalKeyPair();
    const workloadPublicKey = await crypto.subtle.importKey(
      "jwk",
      frameEnvelope.workloadPublicKeyJwk,
      { name: "ECDH", namedCurve: "P-384" },
      false,
      []
    );
    const aesKey = await crypto.subtle.deriveKey(
      { name: "ECDH", public: workloadPublicKey },
      pair.privateKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const options = {
      name: "AES-GCM",
      iv: base64ToBytes(frameEnvelope.ivB64),
      tagLength: Number(frameEnvelope.authTagLength || 16) * 8
    };
    if (frameEnvelope.sframeHeaderB64) {
      options.additionalData = base64ToBytes(frameEnvelope.sframeHeaderB64);
    }
    const plaintext = await crypto.subtle.decrypt(options, aesKey, base64ToBytes(frameEnvelope.ciphertextB64));
    return new Uint8Array(plaintext);
  }

  function resizeBlindCanvas(width, height) {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    const cssWidth = Math.max(1, Math.round(blindCanvas?.clientWidth || window.innerWidth || width || 390));
    const cssHeight = Math.max(1, Math.round(blindCanvas?.clientHeight || window.innerHeight || height || 844));
    blindCanvas.width = Math.round(cssWidth * dpr);
    blindCanvas.height = Math.round(cssHeight * dpr);
    return { cssWidth, cssHeight, dpr };
  }

  function drawBlindStatus(message) {
    if (!blindCanvas) return;
    showBlindCanvas();
    const { dpr } = resizeBlindCanvas();
    const ctx = blindCanvas.getContext("2d");
    ctx.fillStyle = "#050608";
    ctx.fillRect(0, 0, blindCanvas.width, blindCanvas.height);
    ctx.fillStyle = "#d8dde8";
    ctx.font = `${Math.round(14 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(message, blindCanvas.width / 2, blindCanvas.height / 2);
  }

  async function renderBlindFrame(frameEnvelope) {
    if (!blindCanvas) return;
    showBlindCanvas();
    const bytes = await decryptBlindFrame(frameEnvelope);
    const contentType = frameEnvelope.contentType || "image/png";
    if (!contentType.startsWith("image/")) {
      throw new Error(`Decrypted frame content type is not renderable as image: ${contentType}`);
    }
    const bitmap = await createImageBitmap(new Blob([bytes], { type: contentType }));
    const { dpr } = resizeBlindCanvas(frameEnvelope.width, frameEnvelope.height);
    const ctx = blindCanvas.getContext("2d");
    ctx.fillStyle = "#050608";
    ctx.fillRect(0, 0, blindCanvas.width, blindCanvas.height);
    const canvasRatio = blindCanvas.width / blindCanvas.height;
    const imageRatio = bitmap.width / bitmap.height;
    let drawWidth = blindCanvas.width;
    let drawHeight = blindCanvas.height;
    if (imageRatio > canvasRatio) {
      drawHeight = blindCanvas.width / imageRatio;
    } else {
      drawWidth = blindCanvas.height * imageRatio;
    }
    const x = Math.round((blindCanvas.width - drawWidth) / 2);
    const y = Math.round((blindCanvas.height - drawHeight) / 2);
    ctx.drawImage(bitmap, x, y, drawWidth, drawHeight);
    ctx.fillStyle = "rgba(5, 6, 8, 0.72)";
    ctx.fillRect(8 * dpr, 8 * dpr, 174 * dpr, 28 * dpr);
    ctx.fillStyle = "#d8dde8";
    ctx.font = `${Math.round(11 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(`Blind E2EE frame ${frameEnvelope.sequence}`, 16 * dpr, 26 * dpr);
  }

  async function pollBlindE2eeRelay(session) {
    drawBlindStatus("Waiting for encrypted workload frames...");
    while (true) {
      try {
        await requestBlindE2eeCapture(session);
      } catch (error) {
        state.textContent = `Blind workload capture blocked: ${error.message}`;
      }
      const relay = await fetchBlindE2eeLatestFrame(session.frameEnvelope.latestFrameEndpoint);
      if (relay.latestFrameAvailable && relay.frame?.frameId !== blindLastFrameId) {
        blindLastFrameId = relay.frame.frameId;
        try {
          await renderBlindFrame(relay.frame);
          state.textContent = `Blind E2EE frame ${relay.frame.sequence} decrypted on terminal.`;
        } catch (error) {
          drawBlindStatus("Encrypted frame received; terminal decoder blocked.");
          state.textContent = `Blind decoder blocked: ${error.message}`;
        }
      } else if (!relay.latestFrameAvailable) {
        state.textContent = "Blind E2EE backend active; waiting for workload encoder frame.";
      }
      await delay(Math.max(250, Math.min(relay.pollAfterMs || 1000, 2000)));
    }
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
      showStreamMessage({
        titleText: "Stream blocked",
        reasonText: `Unsupported workload app: ${requestedApp || "empty"}`,
        stateText: "Unknown app"
      });
      label.textContent = "Blocked";
      return;
    }
    label.textContent = workload.label;
    bindControls();
    if (requestedBroker !== "blind_e2ee" && (requestedBroker === "direct_lab" || workload.directGateway)) {
      state.textContent = "Opening direct stream through internal G2 workload gateway...";
      frame.src = appUrl(workload);
      return;
    }
    if (requestedBroker === "blind_e2ee") {
      state.textContent = "Requesting PHANTOM Blind E2EE/SFrame backend session...";
      try {
        const terminalPublicKeyJwk = await exportBlindTerminalPublicKey();
        const blindSession = await fetchBlindE2eeSession(requestedApp, terminalPublicKeyJwk);
        if (blindSession?.state !== "blind_e2ee_session_ready") {
          throw new Error(`Blind E2EE blocked: ${(blindSession?.blockers || []).join(", ") || "unknown blocker"}`);
        }
        state.textContent = `Blind E2EE relay active for ${workload.label}.`;
        await pollBlindE2eeRelay(blindSession);
      } catch (error) {
        showStreamMessage({
          titleText: "Stream blocked",
          reasonText: String(error.message || error),
          stateText: "Blind E2EE backend blocked"
        });
      }
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
      showStreamMessage({
        titleText: "Stream blocked",
        reasonText: String(error.message || error),
        stateText: "Guacamole handoff blocked"
      });
    }
  }

  boot();
})();
