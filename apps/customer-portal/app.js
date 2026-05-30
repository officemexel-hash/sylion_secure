const state = {
  tiers: [],
  tokenCatalog: [],
  legalNotice: {},
  providers: {},
  selectedTierId: "",
  selectedProvider: "stripe",
  lastActivation: null
};

const PROVIDER_META = {
  stripe: {
    name: "Stripe",
    rail: "Card, SEPA and business fiat",
    role: "primary_fiat"
  },
  coingate: {
    name: "CoinGate",
    rail: "Crypto payment",
    role: "primary_crypto"
  },
  mollie: {
    name: "Mollie",
    rail: "Backup card and bank payment",
    role: "backup_fiat"
  }
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function show(value) {
  $("#output").textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function correlationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const buffer = new Uint32Array(4);
    globalThis.crypto.getRandomValues(buffer);
    return [...buffer].map((part) => part.toString(16).padStart(8, "0")).join("");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("en-US")} EUR`;
}

function selectedTier() {
  return state.tiers.find((tier) => tier.id === state.selectedTierId) || state.tiers[0] || null;
}

function tenancyLabel(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-correlation-id": `corr_portal_${correlationId()}` },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Request failed");
    error.payload = payload;
    throw error;
  }
  return payload;
}

function selectTier(tierId) {
  state.selectedTierId = tierId;
  $("#tier-select").value = tierId;
  renderTiers();
  renderSelectedTier();
}

function renderTiers() {
  const target = $("#tiers");
  const select = $("#tier-select");
  target.innerHTML = "";
  select.innerHTML = "";
  for (const tier of state.tiers) {
    const isSelected = tier.id === state.selectedTierId;
    const card = document.createElement("button");
    card.type = "button";
    card.className = `tier-card ${isSelected ? "selected" : ""}`;
    card.dataset.tier = tier.id;
    card.setAttribute("aria-pressed", isSelected ? "true" : "false");
    card.innerHTML = `
      <span class="tier-head">
        <span class="tier-title">
          <strong>${escapeHtml(tier.name)}</strong>
          <span>${escapeHtml(tier.tagline || tier.operatorTier)}</span>
        </span>
        <span class="pill ${tier.reviewRequired ? "blocked" : "ok"}">${escapeHtml(tier.badge || (tier.reviewRequired ? "Review" : "Token"))}</span>
      </span>
      <span class="price">${escapeHtml(tier.monthlyPriceEur)} EUR<span>/mo</span></span>
      <ul>
        <li>${escapeHtml(tier.minimumMonths)} month minimum</li>
        <li>${escapeHtml(formatMoney(tier.annualCommitmentEur))} annual commitment</li>
        <li>${escapeHtml(tier.appEnvironments)} isolated app environments</li>
        <li>${tier.reviewRequired ? "Manual eligibility review" : "Self-service token"}</li>
      </ul>
      <span class="tier-cta">${isSelected ? "Selected" : "Select tier"}</span>
    `;
    card.addEventListener("click", () => selectTier(tier.id));
    target.appendChild(card);
    const option = document.createElement("option");
    option.value = tier.id;
    option.textContent = `${tier.name} - ${tier.annualCommitmentEur} EUR / year`;
    select.appendChild(option);
  }
  select.value = state.selectedTierId;
}

function renderSelectedTier() {
  const tier = selectedTier();
  if (!tier) return;
  $("#selected-tier-name").textContent = tier.name;
  $("#selected-tier-summary").textContent = tier.summary || "";
  $("#selected-tier-annual").textContent = formatMoney(tier.annualCommitmentEur);
  $("#selected-tier-envs").textContent = String(tier.appEnvironments);
  $("#selected-tier-tenancy").textContent = tenancyLabel(tier.workloadTenancy);
  $("#selected-tier-review").textContent = tier.reviewRequired ? "Manual review required" : "Self-service token";
  $("#checkout-tier-summary").textContent = `${tier.name}: ${formatMoney(tier.annualCommitmentEur)} annual B2B commitment, ${tier.appEnvironments} app environments, ${tier.reviewRequired ? "manual review before token claim" : "self-service claim after paid webhook"}.`;
  $("#selected-tier-included").innerHTML = (tier.included || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  $("#selected-tier-limits").innerHTML = (tier.limits || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

function renderTokenCatalog() {
  const target = $("#token-catalog");
  target.innerHTML = "";
  for (const item of state.tokenCatalog) {
    const article = document.createElement("article");
    article.className = "token-card";
    article.innerHTML = `
      <strong>${escapeHtml(item.name)}</strong>
      <p>${escapeHtml(item.purpose)}</p>
    `;
    target.appendChild(article);
  }
}

function renderProviders() {
  const target = $("#provider-cards");
  target.innerHTML = "";
  for (const [key, meta] of Object.entries(PROVIDER_META)) {
    const status = state.providers[key] || {};
    const configured = status.configured === true;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `provider-card ${state.selectedProvider === key ? "selected" : ""}`;
    button.dataset.provider = key;
    button.innerHTML = `
      <span class="provider-topline">
        <strong>${escapeHtml(meta.name)}</strong>
        <span class="pill ${configured ? "ok" : "blocked"}">${configured ? "configured" : "needs keys"}</span>
      </span>
      <span>${escapeHtml(meta.rail)}</span>
      <small>${escapeHtml(status.role || meta.role)}${status.webhookConfigured === false ? " / webhook missing" : ""}</small>
    `;
    button.addEventListener("click", () => {
      state.selectedProvider = key;
      $("#provider-select").value = key;
      renderProviders();
    });
    target.appendChild(button);
  }
}

function renderProviderStatus() {
  $("#stripe-status").textContent = state.providers.stripe?.configured ? "configured" : "needs keys";
  $("#coingate-status").textContent = state.providers.coingate?.configured ? "configured" : "needs keys";
  $("#mollie-status").textContent = state.providers.mollie?.configured ? "configured" : "needs keys";
}

function renderLegalNotice() {
  const notice = state.legalNotice || {};
  $("#legal-copy").textContent = [
    notice.customerSegment || "Business customers only",
    notice.refundPolicy || "Dedicated provisioning costs are non-refundable after provisioning except where mandatory law requires otherwise.",
    notice.securityClaim || "The portal sells scoped provisioning tokens and package handoff."
  ].map((item) => String(item).replace(/\.$/, "")).join(". ");
}

function collectForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function downloadJson(fileName, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function renderActivationResult(payload) {
  state.lastActivation = payload;
  const target = $("#download-actions");
  const packages = payload.downloadPackages || {};
  target.innerHTML = `
    <div class="activation-summary">
      <p><span>Operator</span><strong>${escapeHtml(payload.operator?.displayName || payload.operator?.id)}</strong></p>
      <p><span>Tier</span><strong>${escapeHtml(payload.operator?.tier)}</strong></p>
      <p><span>Pipeline</span><strong>${escapeHtml(payload.provisioningDraft?.status)}</strong></p>
    </div>
    <a class="primary full" href="${escapeHtml(payload.firstSession?.operatorPortalUrl || "/operator")}" target="_blank" rel="noopener">Open operator panel</a>
    <button type="button" data-download="pixel">Download Pixel package</button>
    <button type="button" data-download="puliAx">Download Puli AX package</button>
    <button type="button" data-download="laptop">Download laptop package</button>
  `;
  target.querySelector('[data-download="pixel"]').addEventListener("click", () => downloadJson(packages.pixel.fileName, packages.pixel));
  target.querySelector('[data-download="puliAx"]').addEventListener("click", () => downloadJson(packages.puliAx.fileName, packages.puliAx));
  target.querySelector('[data-download="laptop"]').addEventListener("click", () => downloadJson(packages.laptop.fileName, packages.laptop));
}

function autofillFromUrl() {
  const params = new URLSearchParams(location.search);
  const checkoutId = params.get("checkout_id");
  if (checkoutId) $("#claim-checkout-id").value = checkoutId;
}

async function load() {
  const [pricing, providers] = await Promise.all([
    api("/portal-api/pricing"),
    api("/portal-api/payment-providers")
  ]);
  state.tiers = pricing.tiers;
  state.tokenCatalog = pricing.tokenCatalog || [];
  state.legalNotice = pricing.legalNotice || {};
  state.selectedTierId = state.tiers[0]?.id || "";
  state.providers = providers.providers;
  renderTiers();
  renderSelectedTier();
  renderTokenCatalog();
  renderProviders();
  renderProviderStatus();
  renderLegalNotice();
  autofillFromUrl();
}

$("#tier-select").addEventListener("change", (event) => {
  selectTier(event.currentTarget.value);
});

$("#provider-select").addEventListener("change", (event) => {
  state.selectedProvider = event.currentTarget.value;
  renderProviders();
});

$("#checkout-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = collectForm(event.currentTarget);
  try {
    const payload = await api("/portal-api/checkouts", {
      method: "POST",
      body: {
        provider: data.provider,
        tierId: data.tierId,
        vaultPublicId: data.vaultPublicId,
        successUrl: `${location.origin}/portal#success`,
        cancelUrl: `${location.origin}/portal#cancel`,
        webhookBaseUrl: `${location.origin}/portal-api/webhooks`,
        companyProfile: {
          companyName: data.companyName,
          billingEmail: data.billingEmail,
          country: data.country,
          businessOnlyAccepted: data.businessOnlyAccepted === "on",
          noRefundAfterProvisioningAccepted: data.noRefundAfterProvisioningAccepted === "on"
        }
      }
    });
    $("#claim-checkout-id").value = payload.checkout.id;
    show(payload);
    if (payload.checkout?.providerCheckoutUrl) {
      location.href = payload.checkout.providerCheckoutUrl;
    }
  } catch (error) {
    show(error.payload || error.message);
  }
});

$("#token-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = collectForm(event.currentTarget);
  try {
    const payload = await api(`/portal-api/checkouts/${encodeURIComponent(data.checkoutId)}/claim-token`, {
      method: "POST",
      body: { vaultPublicId: data.vaultPublicId }
    });
    $("#activation-token").value = payload.redemptionToken || "";
    show(payload);
  } catch (error) {
    show(error.payload || error.message);
  }
});

$("#activation-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = collectForm(event.currentTarget);
  try {
    const payload = await api("/portal-api/operator-bootstrap", {
      method: "POST",
      body: {
        redemptionToken: data.redemptionToken,
        vaultPublicId: data.vaultPublicId,
        activationProfile: {
          operatorDisplayName: data.operatorDisplayName,
          companyName: data.companyName,
          fulfillmentMode: data.fulfillmentMode,
          terminalMode: data.terminalMode,
          resellerReference: data.resellerReference,
          hardwareBundleId: data.hardwareBundleId
        }
      }
    });
    renderActivationResult(payload);
    show(payload);
  } catch (error) {
    show(error.payload || error.message);
  }
});

load().catch((error) => show(error.payload || error.message));
