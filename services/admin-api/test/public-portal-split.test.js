import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createPublicPortalApp } from "../../public-portal/src/app.js";

async function startServer(app) {
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function jsonRequest(baseUrl, path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": "corr_public_portal_split_test",
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

function checkoutBody() {
  return {
    provider: "stripe",
    tierId: "standard",
    vaultPublicId: "vault_public_portal_split",
    successUrl: "https://portal.example.test/success",
    cancelUrl: "https://portal.example.test/cancel",
    webhookBaseUrl: "https://portal.example.test/portal-api/webhooks",
    companyProfile: {
      companyName: "Public Portal Split LLC",
      billingEmail: "billing@example.test",
      country: "PL",
      businessOnlyAccepted: true,
      noRefundAfterProvisioningAccepted: true
    }
  };
}

test("public portal edge serves only portal assets and allowlisted portal API", async () => {
  const sharedSecret = "public-portal-edge-secret";
  const adminApp = createApp({
    liveExecutionOptions: {
      env: { SYLION_PUBLIC_PORTAL_SHARED_SECRET: sharedSecret }
    },
    billingOptions: {
      env: {
        SYLION_PUBLIC_PORTAL_SHARED_SECRET: sharedSecret,
        STRIPE_SECRET_KEY: "sk_test_redacted"
      },
      fetcher: async () => new Response(JSON.stringify({
        id: "cs_public_split",
        url: "https://checkout.stripe.test/public-split"
      }), { status: 200 })
    }
  });
  const admin = await startServer(adminApp);
  const publicPortal = await startServer(createPublicPortalApp({
    controlPlaneBaseUrl: admin.baseUrl,
    portalSecret: sharedSecret
  }));

  try {
    const directCheckout = await jsonRequest(admin.baseUrl, "/portal-api/checkouts", {
      method: "POST",
      body: checkoutBody()
    });
    assert.equal(directCheckout.status, 403);
    assert.equal(directCheckout.payload.error.code, "portal_proxy_required");

    const htmlResponse = await fetch(`${publicPortal.baseUrl}/`);
    const html = await htmlResponse.text();
    assert.equal(htmlResponse.status, 200);
    assert.match(html, /SYLION Secure Portal/);

    const blockedAdmin = await jsonRequest(publicPortal.baseUrl, "/admin");
    assert.equal(blockedAdmin.status, 404);
    const blockedOperatorApi = await jsonRequest(publicPortal.baseUrl, "/operator-api/about");
    assert.equal(blockedOperatorApi.status, 404);

    const pricing = await jsonRequest(publicPortal.baseUrl, "/portal-api/pricing");
    assert.equal(pricing.status, 200);
    assert.equal(pricing.payload.minimumMonths, 12);

    const checkout = await jsonRequest(publicPortal.baseUrl, "/portal-api/checkouts", {
      method: "POST",
      headers: {
        authorization: "Bearer must-not-forward",
        cookie: "sylion_admin_session=must-not-forward"
      },
      body: checkoutBody()
    });
    assert.equal(checkout.status, 201);
    assert.equal(checkout.payload.checkout.providerCheckoutUrl, "https://checkout.stripe.test/public-split");
    assert.equal(JSON.stringify(adminApp.services.audit.list()).includes("must-not-forward"), false);
  } finally {
    await publicPortal.close();
    await admin.close();
  }
});
