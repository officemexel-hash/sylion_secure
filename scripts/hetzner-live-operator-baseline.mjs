import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AdminApiClient } from "../services/admin-api/src/sdk/adminApiClient.js";

const HETZNER_API = "https://api.hetzner.cloud/v1";
const baseUrl = process.env.SYLION_ADMIN_API_URL || "http://127.0.0.1:8099";
const outputDir = process.env.SYLION_LIVE_BASELINE_OUTPUT_DIR
  || join(process.cwd(), "docs", "admin-panel-v2", "test-artifacts", "step3-33-hetzner-live-operator-baseline");

function requireEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function hetznerPreflight({ token, region, serverType, image }) {
  const headers = { authorization: `Bearer ${token}` };
  const checks = [];
  for (const [name, path, predicate] of [
    ["locations", "/locations?per_page=100", (payload) => (payload.locations || []).some((item) => item.name === region)],
    ["server_types", "/server_types?per_page=100", (payload) => (payload.server_types || []).some((item) => item.name === serverType)],
    ["images", "/images?type=system&per_page=100", (payload) => (payload.images || []).some((item) => item.name === image || item.description === image)]
  ]) {
    const response = await fetch(`${HETZNER_API}${path}`, { headers });
    if (!response.ok) {
      checks.push({ name, status: response.status, ok: false, containsRequested: false });
      return { ok: false, reason: "hetzner_preflight_failed", checks, tokenLogged: false };
    }
    const payload = await response.json();
    checks.push({ name, status: response.status, ok: true, containsRequested: predicate(payload) });
  }
  const missing = checks.filter((check) => check.containsRequested === false).map((check) => check.name);
  return {
    ok: missing.length === 0,
    reason: missing.length ? "hetzner_requested_catalog_item_missing" : "ok",
    checks,
    tokenLogged: false
  };
}

async function loginClient() {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_hetzner_live_operator_baseline_${crypto.randomUUID()}`
  });
  const credentialId = `cred-hetzner-live-operator-${crypto.randomUUID()}`;
  const email = process.env.SYLION_ADMIN_EMAIL || "admin@sylion.local";
  const password = process.env.SYLION_ADMIN_PASSWORD || "ChangeMe-LocalOnly-1!";
  const enrollment = await anon.createEnrollmentOptions({ email, password });
  await anon.verifyEnrollment({
    challengeId: enrollment.challenge.id,
    credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
  });
  const loginOptions = await anon.createWebAuthnLoginOptions({ email, password });
  const session = await anon.verifyWebAuthnLogin({
    challengeId: loginOptions.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${loginOptions.challenge.id}:${credentialId}`,
      signCounter: 1
    }
  });
  return { client: anon.withToken(session.token), credentialId };
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

function sanitizeCreated(payload) {
  const request = payload.liveBaseline?.request || {};
  return {
    operatorId: payload.operator?.id,
    tenantId: payload.operator?.tenantId,
    liveBaselineMode: payload.liveBaseline?.mode,
    providerKey: payload.liveBaseline?.providerKey,
    region: payload.liveBaseline?.region,
    requestId: request.id,
    status: request.status,
    rollbackPlanId: request.rollbackPlanId,
    rollbackReady: request.rollbackReady,
    gate: request.gate,
    resources: (request.resources || []).map((resource) => ({
      role: resource.role,
      providerResourceId: resource.providerResourceId,
      name: resource.name,
      location: resource.location,
      status: resource.status
    })),
    tokenLogged: false,
    checkedAt: new Date().toISOString()
  };
}

async function run() {
  const token = requireEnv("HETZNER_API_TOKEN");
  if (process.env.SYLION_LIVE_BASELINE_CONFIRM !== "I_UNDERSTAND_COST_AND_ROLLBACK") {
    throw new Error("Set SYLION_LIVE_BASELINE_CONFIRM=I_UNDERSTAND_COST_AND_ROLLBACK before creating real Hetzner VPS");
  }
  const region = process.env.SYLION_LIVE_REGION || "fsn1";
  const serverType = process.env.SYLION_HETZNER_SERVER_TYPE || "cx22";
  const image = process.env.SYLION_HETZNER_IMAGE || "ubuntu-24.04";
  await mkdir(outputDir, { recursive: true });
  const preflight = await hetznerPreflight({ token, region, serverType, image });
  if (!preflight.ok) {
    await writeFile(join(outputDir, "preflight-failed.json"), JSON.stringify({
      provider: "hetzner",
      status: "preflight_failed",
      reason: preflight.reason,
      checks: preflight.checks,
      tokenLogged: false,
      checkedAt: new Date().toISOString()
    }, null, 2));
    throw new Error(`Hetzner live baseline preflight failed: ${preflight.reason}`);
  }
  const { client, credentialId } = await loginClient();
  await stepUp(client, credentialId);
  const tenant = await client.createTenant({
    name: process.env.SYLION_LIVE_TENANT_NAME || `SYLION Live Tenant ${Date.now()}`,
    tier: process.env.SYLION_LIVE_TIER || "PRO"
  });
  const provider = await client.createProvider({
    providerType: "hetzner",
    apiSecret: token,
    regions: [region],
    billingHealth: { status: "healthy" },
    runtimeCapabilities: {
      containers: true,
      firecracker: false,
      confidentialComputing: false,
      notes: ["Hetzner Cloud baseline VPS; Firecracker requires KVM-capable host or dedicated provider tier."]
    },
    testConnection: { mode: "live_operator_baseline", status: "preflight_passed" }
  });
  await stepUp(client, credentialId);
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: process.env.SYLION_LIVE_OPERATOR_NAME || `SYLION Live Operator ${Date.now()}`,
    tier: process.env.SYLION_LIVE_TIER || "PRO",
    requestedTemplates: (process.env.SYLION_LIVE_TEMPLATES || "whatsapp,signal,telegram").split(",").map((item) => item.trim()).filter(Boolean),
    liveBaseline: {
      enabled: true,
      providerKey: "hetzner",
      providerId: provider.provider.id,
      region,
      serverType,
      image,
      idempotencyKey: process.env.SYLION_LIVE_IDEMPOTENCY_KEY || `live-operator-${Date.now()}`,
      liveConfirmed: true,
      evidenceRefs: ["script://hetzner-live-operator-baseline"]
    }
  });
  const summary = sanitizeCreated(created);
  await writeFile(join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  if (summary.status !== "executed_provider_mutation") {
    throw new Error(`Live operator baseline did not execute: ${summary.status}`);
  }
  console.log(`Hetzner live operator baseline created; evidence=${join(outputDir, "summary.json")}`);
}

await run();
