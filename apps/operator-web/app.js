// SYLION Operator Portal — skeleton client
// Per ADR-terminal-modes-001. Skeleton: minimal interactions, no real auth,
// no real device posture, no real VPN attach. Placeholder data from
// /operator-api/* stub endpoints.

(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- routing (hash-based, skeleton) ----------

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

  // ---------- API stubs ----------

  async function fetchJson(url) {
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) {
        return { error: `HTTP ${res.status}`, status: res.status };
      }
      return await res.json();
    } catch (err) {
      return { error: String(err) };
    }
  }

  // ---------- terminal mode detection ----------

  function detectTerminalMode() {
    // Skeleton heuristic — real detection happens server-side (posture API).
    // Pixel + GrapheneOS → user-agent contains "Android" + Vanadium; this is
    // not reliable but good enough for skeleton UI hint.
    const ua = navigator.userAgent;
    if (/Android/.test(ua) && /GrapheneOS|Vanadium/.test(ua)) {
      return "Pixel (GrapheneOS) — Mode M1";
    }
    if (/Android/.test(ua)) {
      return "Android (non-GrapheneOS) — posture validation needed";
    }
    if (/Macintosh|Windows|Linux/.test(ua)) {
      return "Laptop web — Mode M2";
    }
    return "Unknown terminal";
  }

  // ---------- view loaders ----------

  async function loadOverview() {
    const modeText = detectTerminalMode();
    const modeEl = $("#terminal-mode");
    if (modeEl) modeEl.textContent = modeText;

    const sessionEl = $("#operator-session");
    if (sessionEl) {
      const me = await fetchJson("/operator-api/me");
      if (me.error) {
        sessionEl.textContent = "Not authenticated (skeleton, FIDO2 login deferred)";
      } else {
        sessionEl.textContent = me.operatorId
          ? `Operator: ${me.operatorId} (${me.placeholder ? "placeholder" : "active"})`
          : "Loading...";
      }
    }
  }

  async function loadDevices() {
    const tbody = $("#devices-tbody");
    if (!tbody) return;
    const data = await fetchJson("/operator-api/devices");
    if (data.error) {
      tbody.innerHTML = `<tr><td colspan="4" class="placeholder">Failed to load: ${data.error}</td></tr>`;
      return;
    }
    const rows = (data.devices || []).map((d) => `
      <tr>
        <td>${escapeHtml(d.type)}</td>
        <td>${escapeHtml(d.model || "—")}</td>
        <td>${escapeHtml(d.status || "—")}</td>
        <td>${escapeHtml(d.posture || "skeleton")}</td>
      </tr>
    `).join("");
    tbody.innerHTML = rows || `<tr><td colspan="4" class="placeholder">No devices yet — enroll Pixel or laptop terminal.</td></tr>`;
  }

  async function loadFido2() {
    const list = $("#fido2-list");
    if (!list) return;
    const data = await fetchJson("/operator-api/settings/fido2");
    if (data.error) {
      list.innerHTML = `<li class="placeholder">Failed to load: ${data.error}</li>`;
      return;
    }
    const items = (data.keys || []).map((k) => `<li>${escapeHtml(k.alias)} (placeholder)</li>`).join("");
    list.innerHTML = items || `<li class="placeholder">No FIDO2 keys yet (placeholder).</li>`;
  }

  async function loadHsm() {
    const list = $("#hsm-list");
    if (!list) return;
    const data = await fetchJson("/operator-api/settings/hsm");
    if (data.error) {
      list.innerHTML = `<li class="placeholder">Failed to load: ${data.error}</li>`;
      return;
    }
    const items = (data.references || []).map((r) => `<li>${escapeHtml(r.alias)} (placeholder)</li>`).join("");
    list.innerHTML = items || `<li class="placeholder">No HSM references yet (placeholder).</li>`;
  }

  async function loadVpn() {
    const data = await fetchJson("/operator-api/vpn-status");
    if (data.error) return;
    setText("#vpn-state", data.state || "disconnected");
    setText("#vpn-router", data.router || "no router enrolled");
    setText("#vpn-g1", data.g1Endpoint || "—");
    setText("#vpn-handshake", data.lastHandshake || "—");
  }

  async function loadAudit() {
    const list = $("#audit-list");
    if (!list) return;
    const data = await fetchJson("/operator-api/audit");
    if (data.error) {
      list.innerHTML = `<li class="placeholder">Failed to load: ${data.error}</li>`;
      return;
    }
    const items = (data.events || []).map((e) => `<li>${escapeHtml(e.timestamp)} — ${escapeHtml(e.action)}</li>`).join("");
    list.innerHTML = items || `<li class="placeholder">No audit events yet.</li>`;
  }

  async function loadSubscription() {
    const data = await fetchJson("/operator-api/subscription");
    if (data.error) return;
    setText("#subscription-plan", data.plan || "—");
    setText("#subscription-quota", data.quota || "—");
  }

  async function loadWorkloads() {
    const list = $("#workloads-list");
    if (!list) return;
    const data = await fetchJson("/operator-api/workloads");
    if (data.error) {
      list.innerHTML = `<li class="placeholder">Failed to load: ${data.error}</li>`;
      return;
    }
    const items = (data.workloads || []).map((w) => `<li>${escapeHtml(w.name)} — ${escapeHtml(w.state)}</li>`).join("");
    list.innerHTML = items || `<li class="placeholder">No workloads yet.</li>`;
  }

  // ---------- utilities ----------

  function setText(sel, value) {
    const el = $(sel);
    if (el) el.textContent = value;
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
    if (viewId === "vpn") loadVpn();
    if (viewId === "audit") loadAudit();
    if (viewId === "settings-fido2") loadFido2();
    if (viewId === "settings-hsm") loadHsm();
    if (viewId === "subscription") loadSubscription();
  }

  // ---------- init ----------

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelector(".sidebar").addEventListener("click", handleNav);
    const initialView = (location.hash || "#overview").replace("#", "");
    setActiveView(initialView);
    loadViewData(initialView);
  });

})();
