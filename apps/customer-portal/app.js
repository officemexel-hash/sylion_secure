const state = {
  tiers: []
};

const $ = (selector) => document.querySelector(selector);

function show(value) {
  $("#output").textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-correlation-id": `corr_portal_${crypto.randomUUID()}` },
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

function renderTiers() {
  const target = $("#tiers");
  const select = $("#tier-select");
  target.innerHTML = "";
  select.innerHTML = "";
  for (const tier of state.tiers) {
    const article = document.createElement("article");
    article.className = "tier";
    article.innerHTML = `
      <strong>${tier.name}</strong>
      <div class="price">${tier.monthlyPriceEur} EUR<span>/mo</span></div>
      <ul>
        <li>${tier.minimumMonths} month minimum</li>
        <li>${tier.annualCommitmentEur} EUR annual</li>
        <li>${tier.appEnvironments} environments</li>
        <li>${tier.reviewRequired ? "Review required" : "Self-service token"}</li>
      </ul>
    `;
    target.appendChild(article);
    const option = document.createElement("option");
    option.value = tier.id;
    option.textContent = `${tier.name} - ${tier.annualCommitmentEur} EUR / year`;
    select.appendChild(option);
  }
}

async function load() {
  const [pricing, providers] = await Promise.all([
    api("/portal-api/pricing"),
    api("/portal-api/payment-providers")
  ]);
  state.tiers = pricing.tiers;
  renderTiers();
  $("#stripe-status").textContent = providers.providers.stripe.configured ? "configured" : "needs keys";
  $("#coingate-status").textContent = providers.providers.coingate.configured ? "configured" : "needs keys";
  $("#mollie-status").textContent = providers.providers.mollie.configured ? "configured" : "needs keys";
}

$("#checkout-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
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
    show(payload);
    if (payload.checkout?.providerCheckoutUrl) {
      location.href = payload.checkout.providerCheckoutUrl;
    }
  } catch (error) {
    show(error.payload || error.message);
  }
});

$("#redeem").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    const payload = await api(`/portal-api/checkouts/${encodeURIComponent(data.checkoutId)}/claim-token`, {
      method: "POST",
      body: { vaultPublicId: data.vaultPublicId }
    });
    show(payload);
  } catch (error) {
    show(error.payload || error.message);
  }
});

load().catch((error) => show(error.payload || error.message));
