import assert from "node:assert/strict";
import test from "node:test";
import { startTestServer, request } from "./helpers.js";

// Contract-level invariants for the billingPortal module (plan catalog /
// billing controls). The end-to-end payment + claim + activation happy paths
// are covered by customer-portal-payments.test.js and the proxy-edge split is
// covered by public-portal-split.test.js. This file pins the load-bearing
// invariants that those flows assume but do not assert directly:
//   - productionExecutionAllowed = false never leaks true on portal output,
//   - public-portal mutations are gated behind the approved edge (RBAC denial),
//   - input validation rejects unsupported provider / unknown tier and missing
//     business-only + no-refund acknowledgements.

function stripeStubFetcher() {
  return async () =>
    new Response(
      JSON.stringify({ id: "cs_contract_stub", url: "https://checkout.stripe.test/contract" }),
      { status: 200 }
    );
}

function checkoutBody(overrides = {}) {
  return {
    provider: "stripe",
    tierId: "standard",
    vaultPublicId: "vault_contract_public_id_0001",
    successUrl: "https://portal.example.test/success",
    cancelUrl: "https://portal.example.test/cancel",
    webhookBaseUrl: "https://admin.example.test/portal-api/webhooks",
    companyProfile: {
      companyName: "SYLION Contract LLC",
      billingEmail: "billing@example.test",
      country: "PL",
      businessOnlyAccepted: true,
      noRefundAfterProvisioningAccepted: true,
      ...(overrides.companyProfile || {})
    },
    ...overrides
  };
}

test("pricing catalog lists the five public tiers and never claims PHANTOM execution", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const pricing = await request(baseUrl, "GET", "/portal-api/pricing");
    assert.equal(pricing.status, 200);
    assert.equal(pricing.json.businessOnly, true);
    assert.equal(pricing.json.minimumMonths, 12);
    assert.deepEqual(
      pricing.json.tiers.map((tier) => tier.id),
      ["pilot", "standard", "pro", "phantom", "sovereign"]
    );

    // PHANTOM tier stays public-but-review-gated and must not imply execution.
    const phantom = pricing.json.tiers.find((tier) => tier.id === "phantom");
    assert.equal(phantom.reviewRequired, true);
    assert.ok(phantom.limits.includes("No automatic PHANTOM execution claim"));

    // Catalog body must never carry a truthy productionExecutionAllowed flag.
    assert.equal(JSON.stringify(pricing.json).includes('"productionExecutionAllowed":true'), false);
  } finally {
    await close();
  }
});

test("created checkout output keeps productionExecutionAllowed=false and stores no terminal data", async () => {
  const { baseUrl, close } = await startTestServer({
    billingOptions: {
      env: { STRIPE_SECRET_KEY: "sk_test_redacted" },
      fetcher: stripeStubFetcher()
    }
  });
  try {
    const created = await request(baseUrl, "POST", "/portal-api/checkouts", {
      body: checkoutBody()
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.checkout.productionExecutionAllowed, false);
    assert.equal(created.json.checkout.terminalDataStored, false);
    assert.equal(created.json.checkout.status, "provider_redirect_ready");
  } finally {
    await close();
  }
});

test("public-portal checkout mutation is denied when the approved edge secret is missing", async () => {
  const { baseUrl, close } = await startTestServer({
    liveExecutionOptions: {
      env: { SYLION_PUBLIC_PORTAL_SHARED_SECRET: "edge-secret-contract" }
    },
    billingOptions: {
      env: {
        SYLION_PUBLIC_PORTAL_SHARED_SECRET: "edge-secret-contract",
        STRIPE_SECRET_KEY: "sk_test_redacted"
      },
      fetcher: stripeStubFetcher()
    }
  });
  try {
    const denied = await request(baseUrl, "POST", "/portal-api/checkouts", {
      body: checkoutBody()
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error.code, "portal_proxy_required");
  } finally {
    await close();
  }
});

test("checkout input validation rejects bad provider, unknown tier and missing acknowledgements", async () => {
  const { baseUrl, close } = await startTestServer({
    billingOptions: {
      env: { STRIPE_SECRET_KEY: "sk_test_redacted" },
      fetcher: stripeStubFetcher()
    }
  });
  try {
    const badProvider = await request(baseUrl, "POST", "/portal-api/checkouts", {
      body: checkoutBody({ provider: "paypal" })
    });
    assert.equal(badProvider.status, 422);
    assert.equal(badProvider.json.error.code, "validation_error");

    const unknownTier = await request(baseUrl, "POST", "/portal-api/checkouts", {
      body: checkoutBody({ tierId: "diamond" })
    });
    assert.equal(unknownTier.status, 422);

    const noBusinessOnly = await request(baseUrl, "POST", "/portal-api/checkouts", {
      body: checkoutBody({ companyProfile: { businessOnlyAccepted: false } })
    });
    assert.equal(noBusinessOnly.status, 422);

    const noRefundAck = await request(baseUrl, "POST", "/portal-api/checkouts", {
      body: checkoutBody({ companyProfile: { noRefundAfterProvisioningAccepted: false } })
    });
    assert.equal(noRefundAck.status, 422);
  } finally {
    await close();
  }
});
