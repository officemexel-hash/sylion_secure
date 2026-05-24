const baseUrl = (process.env.SYLION_ADMIN_API_BASE_URL || "http://127.0.0.1:8099").replace(/\/$/, "");
const operatorId = process.env.SYLION_OPERATOR_ID || process.env.SYLION_PRODUCTION_OPERATOR_ID || "";
const adminEmail = process.env.SYLION_ADMIN_EMAIL || "admin@sylion.local";
const adminPassword = process.env.SYLION_ADMIN_PASSWORD || "ChangeMe-LocalOnly-1!";

async function request(path, { method = "GET", token = null, body = null } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": `corr_live_workload_status_smoke_${crypto.randomUUID()}`,
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${path} HTTP ${response.status}: ${payload?.error?.message || "request_failed"}`);
  }
  return payload;
}

if (!operatorId) {
  throw new Error("SYLION_OPERATOR_ID or SYLION_PRODUCTION_OPERATOR_ID is required");
}

const login = await request("/auth/login", {
  method: "POST",
  body: {
    email: adminEmail,
    password: adminPassword,
    fido2Verified: true
  }
});
const operatorSession = await request("/operator-api/sessions/local-simulator", {
  method: "POST",
  token: login.session.token,
  body: {
    operatorId,
    terminalMode: process.env.SYLION_TERMINAL_MODE || "pixel_grapheneos"
  }
});
const result = await request("/operator-api/live-workload-status", {
  token: operatorSession.session.token
});

console.log(JSON.stringify({
  state: result.status.state,
  cached: result.status.cached,
  generatedAt: result.status.generatedAt,
  summary: result.status.summary,
  apps: result.status.apps.map((app) => ({
    key: app.key,
    transport: app.transport.state,
    workload: app.workload.state,
    functionalState: app.functionalState,
    blockers: app.blockers.slice(0, 4)
  })),
  safety: result.status.safety
}, null, 2));
