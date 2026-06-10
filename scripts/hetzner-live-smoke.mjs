import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../services/admin-api/src/app.js";
import { AdminApiClient } from "../services/admin-api/src/sdk/adminApiClient.js";

const outputDir = join(
  process.cwd(),
  "docs",
  "admin-panel-v2",
  "test-artifacts",
  "step3-18-hetzner-live-smoke"
);
const HETZNER_API = "https://api.hetzner.cloud/v1";

function requireEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function loginClient(baseUrl) {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_hetzner_live_smoke_${crypto.randomUUID()}`
  });
  const credentialId = `cred-hetzner-live-smoke-${crypto.randomUUID()}`;
  const enrollment = await anon.createEnrollmentOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  await anon.verifyEnrollment({
    challengeId: enrollment.challenge.id,
    credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
  });
  const loginOptions = await anon.createWebAuthnLoginOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  const session = await anon.verifyWebAuthnLogin({
    challengeId: loginOptions.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${loginOptions.challenge.id}:${credentialId}`,
      signCounter: 1
    }
  });
  const client = anon.withToken(session.token);
  return { client, credentialId };
}

async function stepUp(client, credentialId) {
  const options = await client.createStepUpOptions();
  await client.verifyStepUp({
    challengeId: options.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${options.challenge.id}:${credentialId}`,
      signCounter: 2
    }
  });
}

async function createApprovedBaseline(client) {
  const tenant = await client.createTenant({
    name: "Step 3.18 Hetzner Live Smoke Tenant",
    tier: "PRO"
  });
  const operator = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Step 3.18 Hetzner Live Smoke Operator",
    tier: "PRO"
  });
  const provider = await client.createProvider({
    providerType: "hetzner",
    apiSecret: "runtime-env-token-reference-only",
    regions: [process.env.SYLION_LIVE_REGION || "fsn1"],
    billingHealth: { status: "healthy" },
    testConnection: { mode: "runtime_live_smoke", status: "not_logged" }
  });
  const approval = await client.createProvisioningApproval({
    operatorId: operator.operator.id,
    reasonCode: "hetzner_live_smoke_ephemeral_cost_limited",
    evidenceRefs: ["release://step3-18/hetzner-live-smoke"]
  });
  const approved = await client.updateProvisioningApprovalStatus(approval.approval.id, {
    status: "approved_for_execution",
    evidenceRefs: ["release://step3-18/hetzner-live-smoke"],
    note: "Approved for live smoke with mandatory cleanup"
  });
  return { operator: operator.operator, provider: provider.provider, approval: approved.approval };
}

function sanitizeEvidence(rehearsal) {
  return {
    id: rehearsal.id,
    providerKey: rehearsal.providerKey,
    operatorId: rehearsal.operatorId,
    region: rehearsal.region,
    rehearsalMode: rehearsal.rehearsalMode,
    status: rehearsal.status,
    sideEffectAllowed: rehearsal.sideEffectAllowed,
    productionExecutionAllowed: rehearsal.productionExecutionAllowed,
    phases: rehearsal.phases,
    resources: rehearsal.resources?.map((resource) => ({
      role: resource.role,
      providerResourceId: resource.providerResourceId,
      name: resource.name,
      location: resource.location,
      status: resource.status
    })),
    rollbackResults: rehearsal.rollbackResults?.map((result) => ({
      role: result.role,
      providerResourceId: result.providerResourceId,
      status: result.status
    })),
    checkedAt: new Date().toISOString()
  };
}

async function hetznerPreflight({ token, region, serverType, image }) {
  const headers = { authorization: `Bearer ${token}` };
  const checks = [];
  for (const [name, path] of [
    ["locations", "/locations?per_page=100"],
    ["server_types", "/server_types?per_page=100"],
    ["images", "/images?type=system&per_page=100"]
  ]) {
    const response = await fetch(`${HETZNER_API}${path}`, { headers });
    checks.push({ name, status: response.status, ok: response.ok });
    if (!response.ok) {
      return {
        ok: false,
        reason: response.status === 401 ? "hetzner_token_rejected" : "hetzner_preflight_failed",
        checks,
        tokenLogged: false
      };
    }
    const payload = await response.json();
    if (name === "locations") {
      checks[checks.length - 1].containsRequested = (payload.locations || []).some(
        (item) => item.name === region
      );
    }
    if (name === "server_types") {
      checks[checks.length - 1].containsRequested = (payload.server_types || []).some(
        (item) => item.name === serverType
      );
    }
    if (name === "images") {
      checks[checks.length - 1].containsRequested = (payload.images || []).some(
        (item) => item.name === image || item.description === image
      );
    }
  }
  const missing = checks
    .filter((check) => check.containsRequested === false)
    .map((check) => check.name);
  return {
    ok: missing.length === 0,
    reason: missing.length ? "hetzner_requested_catalog_item_missing" : "ok",
    checks,
    tokenLogged: false
  };
}

async function run() {
  requireEnv("HETZNER_API_TOKEN");
  if (process.env.SYLION_LIVE_SMOKE_CONFIRM !== "I_UNDERSTAND_COST_AND_CLEANUP") {
    throw new Error(
      "Set SYLION_LIVE_SMOKE_CONFIRM=I_UNDERSTAND_COST_AND_CLEANUP to run real Hetzner smoke"
    );
  }
  await mkdir(outputDir, { recursive: true });
  const region = process.env.SYLION_LIVE_REGION || "fsn1";
  const serverType = process.env.SYLION_HETZNER_SERVER_TYPE || "cpx11";
  const image = process.env.SYLION_HETZNER_IMAGE || "ubuntu-24.04";
  const preflight = await hetznerPreflight({
    token: process.env.HETZNER_API_TOKEN,
    region,
    serverType,
    image
  });
  if (!preflight.ok) {
    await writeFile(
      join(outputDir, "preflight-failed.json"),
      JSON.stringify(
        {
          provider: "hetzner",
          status: "preflight_failed",
          reason: preflight.reason,
          checks: preflight.checks,
          tokenLogged: false,
          checkedAt: new Date().toISOString()
        },
        null,
        2
      )
    );
    throw new Error(`Hetzner live smoke preflight failed: ${preflight.reason}`);
  }
  const env = {
    ...process.env,
    SYLION_PROVIDER_MODE: "live",
    SYLION_LIVE_ALLOWED: "true",
    SYLION_LIVE_SMOKE_ALLOWED: "true",
    SYLION_LIVE_ALLOWLIST_OPERATORS: "*",
    SYLION_LIVE_ALLOWED_REGIONS: region,
    SYLION_LIVE_MAX_SERVERS: "3"
  };
  const app = createApp({ liveExecutionOptions: { env } });
  const server = await app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const { client, credentialId } = await loginClient(baseUrl);
    await stepUp(client, credentialId);
    const { operator, provider, approval } = await createApprovedBaseline(client);
    let rehearsal;
    try {
      rehearsal = await client.runProviderLiveRehearsal("hetzner", {
        providerId: provider.id,
        operatorId: operator.id,
        approvalId: approval.id,
        region,
        idempotencyKey: `hetzner-live-${Date.now()}`,
        rehearsalMode: "live_provider",
        liveConfirmed: true,
        cleanupConfirmed: true,
        serverType,
        image
      });
    } catch (error) {
      const details = error.payload?.error?.details || {};
      await writeFile(
        join(outputDir, "mutation-failed.json"),
        JSON.stringify(
          {
            provider: "hetzner",
            status: "mutation_failed_before_baseline",
            reason: error.payload?.error?.message || error.message,
            providerStatus: details.providerStatus || null,
            providerErrorCode: details.providerErrorCode || null,
            providerErrorMessage: details.providerErrorMessage || null,
            partialResourceCount: details.partialResourceCount || 0,
            cleanupResults: details.cleanupResults || [],
            tokenLogged: false,
            checkedAt: new Date().toISOString()
          },
          null,
          2
        )
      );
      throw error;
    }
    if (rehearsal.rehearsal.status !== "smoke_passed") {
      throw new Error(`Hetzner live smoke did not pass: ${rehearsal.rehearsal.status}`);
    }
    const evidence = sanitizeEvidence(rehearsal.rehearsal);
    await writeFile(join(outputDir, "summary.json"), JSON.stringify(evidence, null, 2));
    console.log(`Hetzner live smoke passed; evidence=${join(outputDir, "summary.json")}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app.close();
  }
}

await run();
