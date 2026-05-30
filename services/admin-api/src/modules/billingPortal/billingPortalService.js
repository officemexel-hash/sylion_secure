import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError, validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

const PROVIDERS = new Set(["stripe", "coingate", "mollie"]);
const CHECKOUT_STATUSES = new Set(["created", "provider_redirect_ready", "paid", "failed", "expired", "chargeback_hold"]);
const TOKEN_STATUSES = new Set(["claimable", "claimed", "revoked", "manual_review"]);

export const PORTAL_TIERS = Object.freeze({
  pilot: {
    id: "pilot",
    name: "Pilot",
    monthlyPriceEur: 99,
    minimumMonths: 12,
    annualCommitmentEur: 1188,
    appEnvironments: 6,
    publicCheckout: true,
    reviewRequired: false,
    workloadTenancy: "shared_dedicated_pool_allowed"
  },
  standard: {
    id: "standard",
    name: "Standard",
    monthlyPriceEur: 199,
    minimumMonths: 12,
    annualCommitmentEur: 2388,
    appEnvironments: 10,
    publicCheckout: true,
    reviewRequired: false,
    workloadTenancy: "shared_dedicated_pool_allowed"
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPriceEur: 499,
    minimumMonths: 12,
    annualCommitmentEur: 5988,
    appEnvironments: 20,
    publicCheckout: true,
    reviewRequired: false,
    workloadTenancy: "shared_dedicated_pool_allowed"
  },
  phantom: {
    id: "phantom",
    name: "Phantom",
    monthlyPriceEur: 1000,
    minimumMonths: 12,
    annualCommitmentEur: 12000,
    appEnvironments: 40,
    publicCheckout: true,
    reviewRequired: true,
    workloadTenancy: "dedicated_or_strongly_isolated_workload_required"
  },
  sovereign: {
    id: "sovereign",
    name: "Sovereign",
    monthlyPriceEur: 2999,
    minimumMonths: 12,
    annualCommitmentEur: 35988,
    appEnvironments: 60,
    publicCheckout: true,
    reviewRequired: true,
    workloadTenancy: "dedicated_operator_only"
  }
});

export const PORTAL_TOKEN_TYPES = Object.freeze({
  OPERATOR_BOOTSTRAP: "operator_bootstrap_annual",
  SUBSCRIPTION_EXTEND: "subscription_extend_12m",
  TIER_UPGRADE: "tier_upgrade",
  JURISDICTION_CREDIT: "jurisdiction_credit",
  WORKLOAD_CAPACITY: "workload_capacity",
  MATRIX_SERVER: "matrix_server",
  PHANTOM_REVIEW: "phantom_review",
  PHANTOM_ACCESS: "phantom_access"
});

function isoNow() {
  return new Date().toISOString();
}

function requireText(value, field, min = 2) {
  if (!value || typeof value !== "string" || value.trim().length < min) {
    throw validationError(`${field} is required`, { field });
  }
  return value.trim();
}

function requireProvider(provider) {
  const value = String(provider || "").toLowerCase();
  if (!PROVIDERS.has(value)) {
    throw validationError("Unsupported payment provider", { provider, allowed: [...PROVIDERS] });
  }
  return value;
}

function requireTier(tierId) {
  const value = String(tierId || "").toLowerCase();
  const tier = PORTAL_TIERS[value];
  if (!tier) {
    throw validationError("Unknown portal tier", { tierId, allowed: Object.keys(PORTAL_TIERS) });
  }
  return tier;
}

function requireUrl(value, field) {
  const text = requireText(value, field, 8);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw validationError(`${field} must be a valid URL`, { field });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw validationError(`${field} must use http or https`, { field, protocol: url.protocol });
  }
  return url.toString();
}

function tokenHash(token) {
  return createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function tokenPreview(token) {
  const value = String(token || "");
  return value.length > 12 ? `${value.slice(0, 10)}...${value.slice(-4)}` : "[redacted]";
}

function cents(amount) {
  return Math.round(Number(amount) * 100);
}

function money(amount) {
  return Number(amount).toFixed(2);
}

function authorizationBearer(value) {
  return `Bearer ${value}`;
}

function authorizationToken(value) {
  return `Token ${value}`;
}

function safeCompanyProfile(input = {}) {
  return {
    companyName: requireText(input.companyName, "companyProfile.companyName"),
    billingEmail: requireText(input.billingEmail, "companyProfile.billingEmail", 5),
    country: requireText(input.country, "companyProfile.country", 2).toUpperCase(),
    vatId: input.vatId ? String(input.vatId).trim() : null,
    businessOnlyAccepted: input.businessOnlyAccepted === true,
    noRefundAfterProvisioningAccepted: input.noRefundAfterProvisioningAccepted === true
  };
}

function publicTier(tier) {
  return {
    id: tier.id,
    name: tier.name,
    monthlyPriceEur: tier.monthlyPriceEur,
    minimumMonths: tier.minimumMonths,
    annualCommitmentEur: tier.annualCommitmentEur,
    appEnvironments: tier.appEnvironments,
    publicCheckout: tier.publicCheckout,
    reviewRequired: tier.reviewRequired,
    workloadTenancy: tier.workloadTenancy,
    currency: "EUR",
    cdrMandatory: true,
    terminalDataStored: false
  };
}

function configured(value) {
  return Boolean(String(value || "").trim());
}

function decodeStripeSignature(header = "") {
  return Object.fromEntries(String(header).split(",").map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }).filter(([key, value]) => key && value));
}

function timingSafeHexEqual(left, right) {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export class BillingPortalService {
  constructor({ audit, store = null, env = process.env, fetcher = globalThis.fetch }) {
    this.audit = audit;
    this.env = env;
    this.fetcher = fetcher;
    this.checkouts = new PersistentMap({ store, collection: "portal_checkouts" });
    this.tokens = new PersistentMap({ store, collection: "portal_service_tokens" });
    this.webhookEvents = new PersistentMap({ store, collection: "portal_payment_webhook_events" });
  }

  pricingCatalog() {
    return {
      currency: "EUR",
      minimumMonths: 12,
      businessOnly: true,
      refundPolicyCode: "non_refundable_after_provisioning_except_mandatory_law",
      tiers: Object.values(PORTAL_TIERS).map(publicTier),
      tokenTypes: PORTAL_TOKEN_TYPES
    };
  }

  providerStatus() {
    return {
      stripe: {
        configured: configured(this.env.STRIPE_SECRET_KEY),
        webhookConfigured: configured(this.env.STRIPE_WEBHOOK_SECRET),
        role: "primary_fiat"
      },
      coingate: {
        configured: configured(this.env.COINGATE_API_TOKEN),
        webhookVerification: "provider_reconciliation_required",
        role: "primary_crypto"
      },
      mollie: {
        configured: configured(this.env.MOLLIE_API_KEY),
        webhookVerification: "provider_reconciliation_required",
        role: "backup_fiat"
      }
    };
  }

  listCheckouts() {
    return [...this.checkouts.values()].map((record) => this.#publicCheckout(record));
  }

  listTokens() {
    return [...this.tokens.values()].map((record) => this.#publicToken(record));
  }

  async createCheckout({
    provider,
    tierId,
    tokenType = PORTAL_TOKEN_TYPES.OPERATOR_BOOTSTRAP,
    companyProfile = {},
    vaultPublicId,
    successUrl,
    cancelUrl,
    webhookBaseUrl,
    correlationId,
    idempotencyKey = null
  }) {
    const corr = requireCorrelationId(correlationId);
    const selectedProvider = requireProvider(provider);
    const tier = requireTier(tierId);
    const profile = safeCompanyProfile(companyProfile);
    if (!profile.businessOnlyAccepted) {
      throw validationError("Business-only checkout terms must be accepted", { businessOnlyAccepted: false });
    }
    if (!profile.noRefundAfterProvisioningAccepted) {
      throw validationError("Provisioning no-refund acknowledgement is required", { noRefundAfterProvisioningAccepted: false });
    }
    const vaultId = requireText(vaultPublicId, "vaultPublicId", 16);
    const checkedSuccessUrl = requireUrl(successUrl || this.env.SYLION_PORTAL_SUCCESS_URL || "https://portal.sylion.example/checkout/success", "successUrl");
    const checkedCancelUrl = requireUrl(cancelUrl || this.env.SYLION_PORTAL_CANCEL_URL || "https://portal.sylion.example/checkout/cancel", "cancelUrl");
    const baseWebhookUrl = requireUrl(webhookBaseUrl || this.env.SYLION_PORTAL_WEBHOOK_BASE_URL || "https://admin.sylion.internal/portal-api/webhooks", "webhookBaseUrl");

    if (!Object.values(PORTAL_TOKEN_TYPES).includes(tokenType)) {
      throw validationError("Unsupported portal token type", { tokenType });
    }

    this.#assertProviderConfigured(selectedProvider);
    const now = isoNow();
    const checkout = {
      id: newId("portal_checkout"),
      provider: selectedProvider,
      tierId: tier.id,
      tierName: tier.name,
      tokenType,
      amountEur: tier.annualCommitmentEur,
      monthlyPriceEur: tier.monthlyPriceEur,
      minimumMonths: tier.minimumMonths,
      appEnvironments: tier.appEnvironments,
      reviewRequired: tier.reviewRequired,
      companyProfile: profile,
      vaultPublicId: vaultId,
      successUrl: checkedSuccessUrl,
      cancelUrl: checkedCancelUrl,
      webhookBaseUrl: baseWebhookUrl,
      status: "created",
      providerSessionId: null,
      providerPaymentId: null,
      providerCheckoutUrl: null,
      createdAt: now,
      paidAt: null,
      tokenId: null,
      idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
      terminalDataStored: false,
      productionExecutionAllowed: false
    };
    this.checkouts.set(checkout.id, checkout);
    const providerResult = await this.#createProviderCheckout(checkout);
    const updated = {
      ...checkout,
      status: "provider_redirect_ready",
      providerSessionId: providerResult.providerSessionId || null,
      providerPaymentId: providerResult.providerPaymentId || null,
      providerCheckoutUrl: providerResult.redirectUrl,
      providerResponseMetadata: providerResult.metadata || {}
    };
    this.checkouts.set(checkout.id, updated);
    this.audit.record({
      actorId: "portal_public",
      action: "portal.checkout_created",
      resourceType: "portal_checkout",
      resourceId: checkout.id,
      correlationId: corr,
      idempotencyKey,
      newValue: this.#publicCheckout(updated)
    });
    return this.#publicCheckout(updated);
  }

  async handleWebhook({ provider, rawBody, headers = {}, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const selectedProvider = requireProvider(provider);
    const raw = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
    const event = selectedProvider === "stripe"
      ? this.#parseAndVerifyStripeWebhook({ rawBody: raw, headers })
      : await this.#reconcileProviderWebhook({ provider: selectedProvider, rawBody: raw });
    const eventRecord = {
      id: newId("portal_webhook"),
      provider: selectedProvider,
      providerEventId: event.providerEventId,
      checkoutId: event.checkoutId,
      paymentStatus: event.paymentStatus,
      accepted: event.paymentStatus === "paid",
      receivedAt: isoNow(),
      rawStored: false,
      secretsPrinted: false
    };
    this.webhookEvents.set(eventRecord.id, eventRecord);
    let checkout = this.checkouts.get(event.checkoutId);
    if (!checkout) {
      this.audit.record({
        actorId: "payment_webhook",
        action: "portal.payment_webhook_unknown_checkout",
        resourceType: "portal_payment_webhook",
        resourceId: eventRecord.id,
        correlationId: corr,
        policyDecision: "deny",
        result: "unknown_checkout",
        newValue: eventRecord
      });
      throw validationError("Payment webhook references unknown checkout", { checkoutId: event.checkoutId, provider: selectedProvider });
    }
    if (checkout.provider !== selectedProvider) {
      throw validationError("Payment webhook provider mismatch", { checkoutId: checkout.id, expected: checkout.provider, actual: selectedProvider });
    }
    const status = event.paymentStatus === "paid" ? "paid" : event.paymentStatus === "failed" ? "failed" : checkout.status;
    if (!CHECKOUT_STATUSES.has(status)) {
      throw validationError("Unsupported checkout status transition", { status });
    }
    checkout = {
      ...checkout,
      status,
      paidAt: status === "paid" ? (checkout.paidAt || isoNow()) : checkout.paidAt,
      providerPaymentId: event.providerPaymentId || checkout.providerPaymentId
    };
    this.checkouts.set(checkout.id, checkout);
    const token = status === "paid" ? this.#ensureClaimableToken(checkout) : null;
    this.audit.record({
      actorId: "payment_webhook",
      action: "portal.payment_webhook_accepted",
      resourceType: "portal_payment_webhook",
      resourceId: eventRecord.id,
      correlationId: corr,
      policyDecision: status === "paid" ? "allow" : "deny",
      result: status,
      newValue: {
        event: eventRecord,
        checkout: this.#publicCheckout(checkout),
        token: token ? this.#publicToken(token) : null
      }
    });
    return {
      event: eventRecord,
      checkout: this.#publicCheckout(checkout),
      token: token ? this.#publicToken(token) : null
    };
  }

  claimToken({ checkoutId, vaultPublicId, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    const checkout = this.checkouts.get(requireText(checkoutId, "checkoutId", 10));
    if (!checkout) throw validationError("Checkout was not found", { checkoutId });
    const vaultId = requireText(vaultPublicId, "vaultPublicId", 16);
    if (checkout.vaultPublicId !== vaultId) {
      throw validationError("Vault identity does not match checkout", { checkoutId, vaultPublicIdMatched: false });
    }
    if (checkout.status !== "paid") {
      throw validationError("Checkout is not paid yet", { checkoutId, status: checkout.status });
    }
    const existing = [...this.tokens.values()].find((item) => item.checkoutId === checkout.id);
    if (!existing) throw validationError("Checkout has no claimable token", { checkoutId });
    if (existing.status !== "claimable" && existing.status !== "manual_review") {
      throw validationError("Token was already claimed or is not claimable", { tokenId: existing.id, status: existing.status });
    }
    if (existing.status === "manual_review") {
      throw validationError("Token requires manual review before claim", { tokenId: existing.id, tierId: existing.tierId });
    }
    const rawToken = `sylion_${existing.tokenType}_${randomBytes(24).toString("base64url")}`;
    const updated = {
      ...existing,
      tokenHash: tokenHash(rawToken),
      tokenPreview: tokenPreview(rawToken),
      status: "claimed",
      claimedAt: isoNow(),
      claimMaterialReturnedOnce: true
    };
    this.tokens.set(updated.id, updated);
    this.audit.record({
      actorId: "portal_vault",
      action: "portal.service_token_claimed",
      resourceType: "portal_service_token",
      resourceId: updated.id,
      correlationId: corr,
      result: "claimed",
      newValue: this.#publicToken(updated)
    });
    return {
      token: this.#publicToken(updated),
      redemptionToken: rawToken,
      tokenMaterialReturnedOnce: true
    };
  }

  #ensureClaimableToken(checkout) {
    const existing = [...this.tokens.values()].find((item) => item.checkoutId === checkout.id);
    if (existing) return existing;
    const token = {
      id: newId("portal_token"),
      checkoutId: checkout.id,
      provider: checkout.provider,
      providerPaymentId: checkout.providerPaymentId || checkout.providerSessionId,
      tierId: checkout.tierId,
      tierName: checkout.tierName,
      tokenType: checkout.tokenType,
      amountEur: checkout.amountEur,
      minimumMonths: checkout.minimumMonths,
      appEnvironments: checkout.appEnvironments,
      vaultPublicId: checkout.vaultPublicId,
      status: checkout.reviewRequired ? "manual_review" : "claimable",
      tokenHash: null,
      tokenPreview: "[unclaimed]",
      issuedAt: isoNow(),
      claimedAt: null,
      claimMaterialReturnedOnce: false,
      terminalDataStored: false,
      productionExecutionAllowed: false
    };
    if (!TOKEN_STATUSES.has(token.status)) {
      throw validationError("Unsupported token status", { status: token.status });
    }
    this.tokens.set(token.id, token);
    const updatedCheckout = { ...checkout, tokenId: token.id };
    this.checkouts.set(checkout.id, updatedCheckout);
    return token;
  }

  async #createProviderCheckout(checkout) {
    if (checkout.provider === "stripe") return this.#createStripeCheckout(checkout);
    if (checkout.provider === "coingate") return this.#createCoinGateOrder(checkout);
    return this.#createMolliePayment(checkout);
  }

  async #createStripeCheckout(checkout) {
    const params = new URLSearchParams({
      mode: "payment",
      success_url: `${checkout.successUrl}${checkout.successUrl.includes("?") ? "&" : "?"}checkout_id=${encodeURIComponent(checkout.id)}`,
      cancel_url: checkout.cancelUrl,
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": String(cents(checkout.amountEur)),
      "line_items[0][price_data][product_data][name]": `SYLION ${checkout.tierName} annual access token`,
      "line_items[0][price_data][product_data][description]": `${checkout.minimumMonths}-month B2B commitment; ${checkout.appEnvironments} workload environments`,
      "line_items[0][quantity]": "1",
      "metadata[checkout_id]": checkout.id,
      "metadata[tier_id]": checkout.tierId,
      "metadata[token_type]": checkout.tokenType,
      "metadata[vault_public_id]": checkout.vaultPublicId,
      "payment_intent_data[metadata][checkout_id]": checkout.id
    });
    const response = await this.fetcher("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: authorizationBearer(this.env.STRIPE_SECRET_KEY),
        "content-type": "application/x-www-form-urlencoded"
      },
      body: params
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new AppError("payment_provider_error", "Stripe checkout creation failed", 502, { provider: "stripe", status: response.status, code: payload?.error?.code });
    }
    return {
      providerSessionId: payload.id,
      redirectUrl: payload.url,
      metadata: { mode: payload.mode || "payment" }
    };
  }

  async #createCoinGateOrder(checkout) {
    const response = await this.fetcher("https://api.coingate.com/api/v2/orders", {
      method: "POST",
      headers: {
        authorization: authorizationToken(this.env.COINGATE_API_TOKEN),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        order_id: checkout.id,
        price_amount: money(checkout.amountEur),
        price_currency: "EUR",
        receive_currency: this.env.COINGATE_RECEIVE_CURRENCY || "EUR",
        title: `SYLION ${checkout.tierName} annual access token`,
        description: `${checkout.minimumMonths}-month B2B commitment`,
        callback_url: `${checkout.webhookBaseUrl.replace(/\/$/, "")}/coingate`,
        cancel_url: checkout.cancelUrl,
        success_url: `${checkout.successUrl}${checkout.successUrl.includes("?") ? "&" : "?"}checkout_id=${encodeURIComponent(checkout.id)}`
      })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new AppError("payment_provider_error", "CoinGate order creation failed", 502, { provider: "coingate", status: response.status, code: payload?.code });
    }
    return {
      providerSessionId: payload.id ? String(payload.id) : null,
      providerPaymentId: payload.id ? String(payload.id) : null,
      redirectUrl: payload.payment_url || payload.checkout_url || payload.url,
      metadata: { status: payload.status || "new" }
    };
  }

  async #createMolliePayment(checkout) {
    const response = await this.fetcher("https://api.mollie.com/v2/payments", {
      method: "POST",
      headers: {
        authorization: authorizationBearer(this.env.MOLLIE_API_KEY),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        amount: { currency: "EUR", value: money(checkout.amountEur) },
        description: `SYLION ${checkout.tierName} annual access token`,
        redirectUrl: `${checkout.successUrl}${checkout.successUrl.includes("?") ? "&" : "?"}checkout_id=${encodeURIComponent(checkout.id)}`,
        cancelUrl: checkout.cancelUrl,
        webhookUrl: `${checkout.webhookBaseUrl.replace(/\/$/, "")}/mollie`,
        metadata: {
          checkout_id: checkout.id,
          tier_id: checkout.tierId,
          token_type: checkout.tokenType,
          vault_public_id: checkout.vaultPublicId
        }
      })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new AppError("payment_provider_error", "Mollie payment creation failed", 502, { provider: "mollie", status: response.status });
    }
    return {
      providerSessionId: payload.id,
      providerPaymentId: payload.id,
      redirectUrl: payload?._links?.checkout?.href,
      metadata: { status: payload.status || "open" }
    };
  }

  #assertProviderConfigured(provider) {
    const status = this.providerStatus()[provider];
    if (!status?.configured) {
      throw new AppError("provider_not_configured", `${provider} payment provider is not configured`, 503, {
        provider,
        requiredEnv: provider === "stripe" ? ["STRIPE_SECRET_KEY"] : provider === "coingate" ? ["COINGATE_API_TOKEN"] : ["MOLLIE_API_KEY"]
      });
    }
    if (!this.fetcher) {
      throw new AppError("provider_not_configured", "Payment provider fetcher is not available", 503, { provider });
    }
  }

  #parseAndVerifyStripeWebhook({ rawBody, headers }) {
    const secret = this.env.STRIPE_WEBHOOK_SECRET;
    if (!configured(secret)) {
      throw new AppError("provider_not_configured", "Stripe webhook secret is not configured", 503, { provider: "stripe", requiredEnv: ["STRIPE_WEBHOOK_SECRET"] });
    }
    const signatureHeader = headers["stripe-signature"] || headers["Stripe-Signature"];
    const parsed = decodeStripeSignature(signatureHeader);
    const signedPayload = `${parsed.t}.${rawBody}`;
    const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
    if (!parsed.t || !parsed.v1 || !timingSafeHexEqual(expected, parsed.v1)) {
      throw validationError("Stripe webhook signature verification failed", { provider: "stripe" });
    }
    const payload = JSON.parse(rawBody);
    const session = payload.data?.object || {};
    return {
      providerEventId: payload.id || newId("stripe_evt"),
      checkoutId: session.metadata?.checkout_id,
      providerPaymentId: session.payment_intent || session.id,
      paymentStatus: session.payment_status === "paid" || payload.type === "checkout.session.completed" ? "paid" : "pending"
    };
  }

  async #reconcileProviderWebhook({ provider, rawBody }) {
    if (provider === "coingate") return this.#reconcileCoinGateWebhook(rawBody);
    return this.#reconcileMollieWebhook(rawBody);
  }

  async #reconcileCoinGateWebhook(rawBody) {
    const payload = rawBody ? JSON.parse(rawBody) : {};
    let order = payload;
    if (payload.id && configured(this.env.COINGATE_API_TOKEN)) {
      const response = await this.fetcher(`https://api.coingate.com/api/v2/orders/${encodeURIComponent(payload.id)}`, {
        headers: { authorization: authorizationToken(this.env.COINGATE_API_TOKEN) }
      });
      if (response.ok) order = await parseJsonResponse(response);
    }
    return {
      providerEventId: order.id ? String(order.id) : newId("coingate_evt"),
      checkoutId: order.order_id || order.custom_order_id || payload.order_id,
      providerPaymentId: order.id ? String(order.id) : null,
      paymentStatus: ["paid", "confirmed"].includes(String(order.status || "").toLowerCase()) ? "paid" : "pending"
    };
  }

  async #reconcileMollieWebhook(rawBody) {
    const params = new URLSearchParams(rawBody);
    const paymentId = params.get("id") || (() => {
      try {
        return JSON.parse(rawBody || "{}").id;
      } catch {
        return null;
      }
    })();
    if (!paymentId) {
      throw validationError("Mollie webhook did not include payment id", { provider: "mollie" });
    }
    if (!configured(this.env.MOLLIE_API_KEY)) {
      throw new AppError("provider_not_configured", "Mollie API key is required to reconcile webhook", 503, { provider: "mollie", requiredEnv: ["MOLLIE_API_KEY"] });
    }
    const response = await this.fetcher(`https://api.mollie.com/v2/payments/${encodeURIComponent(paymentId)}`, {
      headers: { authorization: authorizationBearer(this.env.MOLLIE_API_KEY) }
    });
    const payment = await parseJsonResponse(response);
    if (!response.ok) {
      throw new AppError("payment_provider_error", "Mollie payment reconciliation failed", 502, { provider: "mollie", status: response.status });
    }
    return {
      providerEventId: payment.id,
      checkoutId: payment.metadata?.checkout_id,
      providerPaymentId: payment.id,
      paymentStatus: payment.status === "paid" ? "paid" : "pending"
    };
  }

  #publicCheckout(record) {
    return {
      id: record.id,
      provider: record.provider,
      tierId: record.tierId,
      tierName: record.tierName,
      tokenType: record.tokenType,
      amountEur: record.amountEur,
      monthlyPriceEur: record.monthlyPriceEur,
      minimumMonths: record.minimumMonths,
      appEnvironments: record.appEnvironments,
      reviewRequired: record.reviewRequired,
      companyProfile: {
        companyName: record.companyProfile.companyName,
        billingEmail: record.companyProfile.billingEmail,
        country: record.companyProfile.country,
        vatIdPresent: Boolean(record.companyProfile.vatId)
      },
      status: record.status,
      providerSessionId: record.providerSessionId,
      providerPaymentId: record.providerPaymentId,
      providerCheckoutUrl: record.providerCheckoutUrl,
      createdAt: record.createdAt,
      paidAt: record.paidAt,
      tokenId: record.tokenId,
      terminalDataStored: false,
      productionExecutionAllowed: false
    };
  }

  #publicToken(record) {
    return {
      id: record.id,
      checkoutId: record.checkoutId,
      provider: record.provider,
      providerPaymentId: record.providerPaymentId,
      tierId: record.tierId,
      tierName: record.tierName,
      tokenType: record.tokenType,
      amountEur: record.amountEur,
      minimumMonths: record.minimumMonths,
      appEnvironments: record.appEnvironments,
      status: record.status,
      tokenPreview: record.tokenPreview,
      issuedAt: record.issuedAt,
      claimedAt: record.claimedAt,
      tokenStoredPlaintext: false,
      terminalDataStored: false,
      productionExecutionAllowed: false
    };
  }
}
