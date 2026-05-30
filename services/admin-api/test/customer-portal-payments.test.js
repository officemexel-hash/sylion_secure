import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createApp } from "../src/app.js";

async function startTestServer({ env = {}, fetcher = null } = {}) {
  const app = createApp({
    billingOptions: {
      env,
      fetcher: fetcher || (async () => new Response("{}", { status: 500 }))
    }
  });
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function request(baseUrl, path, { method = "GET", body, rawBody, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": rawBody ? "application/json" : "application/json",
      "x-correlation-id": "corr_customer_portal_test",
      ...headers
    },
    body: rawBody ?? (body ? JSON.stringify(body) : undefined)
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

function checkoutBody(overrides = {}) {
  return {
    provider: "stripe",
    tierId: "standard",
    vaultPublicId: "vault_test_public_id_0001",
    successUrl: "https://portal.example.test/success",
    cancelUrl: "https://portal.example.test/cancel",
    webhookBaseUrl: "https://admin.example.test/portal-api/webhooks",
    companyProfile: {
      companyName: "SYLION Test LLC",
      billingEmail: "billing@example.test",
      country: "PL",
      businessOnlyAccepted: true,
      noRefundAfterProvisioningAccepted: true
    },
    ...overrides
  };
}

test("customer portal exposes annual B2B pricing and provider status without secrets", async () => {
  const { app, baseUrl, close } = await startTestServer();
  try {
    const pricing = await request(baseUrl, "/portal-api/pricing");
    assert.equal(pricing.status, 200);
    assert.equal(pricing.payload.minimumMonths, 12);
    assert.equal(pricing.payload.businessOnly, true);
    assert.deepEqual(pricing.payload.tiers.map((tier) => tier.id), ["pilot", "standard", "pro", "phantom", "sovereign"]);
    assert.equal(pricing.payload.tiers.find((tier) => tier.id === "pilot").annualCommitmentEur, 1188);
    assert.equal(pricing.payload.tiers.find((tier) => tier.id === "sovereign").appEnvironments, 60);
    assert.equal(pricing.payload.tiers.find((tier) => tier.id === "phantom").operatorTier, "PHANTOM");

    const providers = await request(baseUrl, "/portal-api/payment-providers");
    assert.equal(providers.status, 200);
    assert.equal(providers.payload.providers.stripe.configured, false);
    assert.equal(JSON.stringify(providers.payload).includes("sk_"), false);
    assert.equal(JSON.stringify(app.services.audit.list()).includes("secret"), false);
  } finally {
    await close();
  }
});

test("customer portal static shell is served under /portal", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/portal`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /SYLION Secure Portal/);
    assert.match(html, /Payment gateways/);
    assert.match(html, /Generate service token/);
    assert.match(html, /Activate operator from token/);
  } finally {
    await close();
  }
});

test("Stripe checkout uses a real provider request shape and never issues token before paid webhook", async () => {
  const calls = [];
  const { app, baseUrl, close } = await startTestServer({
    env: {
      STRIPE_SECRET_KEY: "sk_test_redacted",
      STRIPE_WEBHOOK_SECRET: "whsec_test_redacted"
    },
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.test/session", mode: "payment" }), { status: 200 });
    }
  });
  try {
    const checkout = await request(baseUrl, "/portal-api/checkouts", {
      method: "POST",
      body: checkoutBody()
    });
    assert.equal(checkout.status, 201);
    assert.equal(checkout.payload.checkout.provider, "stripe");
    assert.equal(checkout.payload.checkout.amountEur, 2388);
    assert.equal(checkout.payload.checkout.minimumMonths, 12);
    assert.equal(checkout.payload.checkout.providerCheckoutUrl, "https://checkout.stripe.test/session");
    assert.equal(app.services.billingPortal.listTokens().length, 0);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.stripe.com/v1/checkout/sessions");
    const body = new URLSearchParams(String(calls[0].init.body));
    assert.equal(body.get("mode"), "payment");
    assert.equal(body.get("line_items[0][price_data][currency]"), "eur");
    assert.equal(body.get("line_items[0][price_data][unit_amount]"), "238800");
    assert.equal(body.get("metadata[checkout_id]"), checkout.payload.checkout.id);
    assert.equal(JSON.stringify(app.services.audit.list()).includes("sk_test_redacted"), false);
  } finally {
    await close();
  }
});

test("Stripe paid webhook makes token claimable and claim returns token material only once", async () => {
  const secret = "whsec_test_redacted";
  const { app, baseUrl, close } = await startTestServer({
    env: {
      STRIPE_SECRET_KEY: "sk_test_redacted",
      STRIPE_WEBHOOK_SECRET: secret
    },
    fetcher: async () => new Response(JSON.stringify({ id: "cs_test_456", url: "https://checkout.stripe.test/session" }), { status: 200 })
  });
  try {
    const checkout = await request(baseUrl, "/portal-api/checkouts", {
      method: "POST",
      body: checkoutBody()
    });
    assert.equal(checkout.status, 201);
    const event = {
      id: "evt_test_paid",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_456",
          payment_status: "paid",
          payment_intent: "pi_test_456",
          metadata: { checkout_id: checkout.payload.checkout.id }
        }
      }
    };
    const raw = JSON.stringify(event);
    const timestamp = "1760000000";
    const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
    const webhook = await request(baseUrl, "/portal-api/webhooks/stripe", {
      method: "POST",
      rawBody: raw,
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }
    });
    assert.equal(webhook.status, 200);
    assert.equal(webhook.payload.checkout.status, "paid");
    assert.equal(webhook.payload.token.status, "claimable");

    const claim = await request(baseUrl, `/portal-api/checkouts/${checkout.payload.checkout.id}/claim-token`, {
      method: "POST",
      body: { vaultPublicId: "vault_test_public_id_0001" }
    });
    assert.equal(claim.status, 201);
    assert.match(claim.payload.redemptionToken, /^sylion_operator_bootstrap_annual_/);
    assert.equal(claim.payload.token.tokenStoredPlaintext, false);

    const secondClaim = await request(baseUrl, `/portal-api/checkouts/${checkout.payload.checkout.id}/claim-token`, {
      method: "POST",
      body: { vaultPublicId: "vault_test_public_id_0001" }
    });
    assert.equal(secondClaim.status, 422);
    assert.equal(JSON.stringify(app.services.billingPortal.listTokens()).includes(claim.payload.redemptionToken), false);
  } finally {
    await close();
  }
});

test("Portal activation redeems paid token into operator, packages and first session without audit secret leakage", async () => {
  const secret = "whsec_test_redacted";
  const { app, baseUrl, close } = await startTestServer({
    env: {
      STRIPE_SECRET_KEY: "sk_test_redacted",
      STRIPE_WEBHOOK_SECRET: secret,
      SYLION_INTERNAL_CA_CERT_PEM: "-----BEGIN CERTIFICATE-----\nPUBLIC TEST CERT\n-----END CERTIFICATE-----",
      SYLION_INTERNAL_CA_SHA256: "sha256-test"
    },
    fetcher: async () => new Response(JSON.stringify({ id: "cs_activate", url: "https://checkout.stripe.test/activate" }), { status: 200 })
  });
  try {
    const checkout = await request(baseUrl, "/portal-api/checkouts", {
      method: "POST",
      body: checkoutBody({ tierId: "pro", vaultPublicId: "vault_activation_public_id" })
    });
    assert.equal(checkout.status, 201);
    const raw = JSON.stringify({
      id: "evt_activate_paid",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_activate",
          payment_status: "paid",
          metadata: { checkout_id: checkout.payload.checkout.id }
        }
      }
    });
    const timestamp = "1760000002";
    const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
    const webhook = await request(baseUrl, "/portal-api/webhooks/stripe", {
      method: "POST",
      rawBody: raw,
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }
    });
    assert.equal(webhook.status, 200);

    const claim = await request(baseUrl, `/portal-api/checkouts/${checkout.payload.checkout.id}/claim-token`, {
      method: "POST",
      body: { vaultPublicId: "vault_activation_public_id" }
    });
    assert.equal(claim.status, 201);

    const activation = await request(baseUrl, "/portal-api/operator-bootstrap", {
      method: "POST",
      body: {
        redemptionToken: claim.payload.redemptionToken,
        vaultPublicId: "vault_activation_public_id",
        activationProfile: {
          operatorDisplayName: "Portal Activated Operator",
          companyName: "Portal Activated LLC",
          fulfillmentMode: "reseller_preconfigured_hardware",
          terminalMode: "pixel_grapheneos",
          resellerReference: "reseller-order-123",
          hardwareBundleId: "kit-123"
        }
      }
    });
    assert.equal(activation.status, 201);
    assert.equal(activation.payload.operator.displayName, "Portal Activated Operator");
    assert.equal(activation.payload.operator.tier, "PRO");
    assert.equal(activation.payload.subscription.effectiveLimits.maxWorkloadEnvironments, 20);
    assert.equal(activation.payload.provisioningDraft.firecrackerPlan.workloads.length, 20);
    assert.equal(activation.payload.downloadPackages.pixel.secretMaterialIncluded, false);
    assert.equal(activation.payload.downloadPackages.puliAx.privateKeyMaterialIncluded, false);
    assert.match(activation.payload.firstSession.operatorPortalUrl, /^\/operator\?op_token=op_/);
    assert.equal(activation.payload.activation.token.status, "provisioned");

    const secondActivation = await request(baseUrl, "/portal-api/operator-bootstrap", {
      method: "POST",
      body: {
        redemptionToken: claim.payload.redemptionToken,
        vaultPublicId: "vault_activation_public_id",
        activationProfile: { operatorDisplayName: "Should Not Work" }
      }
    });
    assert.equal(secondActivation.status, 422);
    assert.equal(JSON.stringify(app.services.audit.list()).includes(claim.payload.redemptionToken), false);
    assert.ok(app.services.audit.list().some((event) => event.action === "portal.operator_bootstrap_completed"));
  } finally {
    await close();
  }
});

test("Portal activation rejects secret-like profile material before provisioning", async () => {
  const secret = "whsec_test_redacted";
  const { app, baseUrl, close } = await startTestServer({
    env: { STRIPE_SECRET_KEY: "sk_test_redacted", STRIPE_WEBHOOK_SECRET: secret },
    fetcher: async () => new Response(JSON.stringify({ id: "cs_secret", url: "https://checkout.stripe.test/secret" }), { status: 200 })
  });
  try {
    const checkout = await request(baseUrl, "/portal-api/checkouts", {
      method: "POST",
      body: checkoutBody({ vaultPublicId: "vault_secret_public_id_0001" })
    });
    const raw = JSON.stringify({
      id: "evt_secret_paid",
      type: "checkout.session.completed",
      data: { object: { payment_status: "paid", metadata: { checkout_id: checkout.payload.checkout.id } } }
    });
    const timestamp = "1760000003";
    const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
    await request(baseUrl, "/portal-api/webhooks/stripe", {
      method: "POST",
      rawBody: raw,
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }
    });
    const claim = await request(baseUrl, `/portal-api/checkouts/${checkout.payload.checkout.id}/claim-token`, {
      method: "POST",
      body: { vaultPublicId: "vault_secret_public_id_0001" }
    });
    const activation = await request(baseUrl, "/portal-api/operator-bootstrap", {
      method: "POST",
      body: {
        redemptionToken: claim.payload.redemptionToken,
        vaultPublicId: "vault_secret_public_id_0001",
        activationProfile: { operatorDisplayName: "Secret Test", routerPassword: "do-not-accept" }
      }
    });
    assert.equal(activation.status, 422);
    assert.equal(app.services.operators.list().length, 0);
  } finally {
    await close();
  }
});

test("CoinGate and Mollie checkout adapters use provider-specific endpoints", async () => {
  const calls = [];
  const { baseUrl, close } = await startTestServer({
    env: {
      COINGATE_API_TOKEN: "coingate_test_redacted",
      MOLLIE_API_KEY: "mollie_test_redacted"
    },
    fetcher: async (url, init) => {
      calls.push({ url, init });
      if (String(url).includes("coingate")) {
        return new Response(JSON.stringify({ id: 1234, payment_url: "https://coingate.test/pay/1234", status: "new" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "tr_test", status: "open", _links: { checkout: { href: "https://mollie.test/pay/tr_test" } } }), { status: 200 });
    }
  });
  try {
    const coingate = await request(baseUrl, "/portal-api/checkouts", {
      method: "POST",
      body: checkoutBody({ provider: "coingate", tierId: "pilot" })
    });
    assert.equal(coingate.status, 201);
    assert.equal(coingate.payload.checkout.providerCheckoutUrl, "https://coingate.test/pay/1234");

    const mollie = await request(baseUrl, "/portal-api/checkouts", {
      method: "POST",
      body: checkoutBody({ provider: "mollie", tierId: "pro" })
    });
    assert.equal(mollie.status, 201);
    assert.equal(mollie.payload.checkout.providerCheckoutUrl, "https://mollie.test/pay/tr_test");

    assert.ok(calls.some((call) => call.url === "https://api.coingate.com/api/v2/orders"));
    assert.ok(calls.some((call) => call.url === "https://api.mollie.com/v2/payments"));
  } finally {
    await close();
  }
});

test("Phantom paid token is visible but blocked behind manual review", async () => {
  const secret = "whsec_test_redacted";
  const { baseUrl, close } = await startTestServer({
    env: {
      STRIPE_SECRET_KEY: "sk_test_redacted",
      STRIPE_WEBHOOK_SECRET: secret
    },
    fetcher: async () => new Response(JSON.stringify({ id: "cs_phantom", url: "https://checkout.stripe.test/phantom" }), { status: 200 })
  });
  try {
    const checkout = await request(baseUrl, "/portal-api/checkouts", {
      method: "POST",
      body: checkoutBody({ tierId: "phantom" })
    });
    assert.equal(checkout.status, 201);
    assert.equal(checkout.payload.checkout.reviewRequired, true);

    const raw = JSON.stringify({
      id: "evt_phantom_paid",
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "paid",
          metadata: { checkout_id: checkout.payload.checkout.id }
        }
      }
    });
    const timestamp = "1760000001";
    const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
    const webhook = await request(baseUrl, "/portal-api/webhooks/stripe", {
      method: "POST",
      rawBody: raw,
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }
    });
    assert.equal(webhook.status, 200);
    assert.equal(webhook.payload.token.status, "manual_review");

    const claim = await request(baseUrl, `/portal-api/checkouts/${checkout.payload.checkout.id}/claim-token`, {
      method: "POST",
      body: { vaultPublicId: "vault_test_public_id_0001" }
    });
    assert.equal(claim.status, 422);
  } finally {
    await close();
  }
});
