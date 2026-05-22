import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AuditService } from "./modules/audit/auditService.js";
import { AuthService } from "./modules/auth/authService.js";
import { RbacService } from "./modules/rbac/rbacService.js";
import { EntitlementService } from "./modules/entitlements/entitlementService.js";
import { SubscriptionService } from "./modules/subscriptions/subscriptionService.js";
import { TenantService } from "./modules/tenants/tenantService.js";
import { OperatorService } from "./modules/operators/operatorService.js";
import { ProvisioningPlanService } from "./modules/provisioning/provisioningPlanService.js";
import { OperatorProvisioningPipelineService } from "./modules/provisioning/operatorProvisioningPipelineService.js";
import { OperatorEnvironmentService } from "./modules/provisioning/operatorEnvironmentService.js";
import { AppCatalogService } from "./modules/apps/appCatalogService.js";
import { CdrService } from "./modules/cdr/cdrService.js";
import { MonitoringService } from "./modules/monitoring/monitoringService.js";
import { IncidentService } from "./modules/incidents/incidentService.js";
import { SecretManagerService } from "./modules/secrets/secretManagerService.js";
import { ProviderRegistryService } from "./modules/providers/providerRegistryService.js";
import { ProviderDryRunService } from "./modules/providers/dryRun/providerDryRunService.js";
import { InventoryService } from "./modules/inventory/inventoryService.js";
import { PkiService } from "./modules/pki/pkiService.js";
import { JurisdictionPolicyService } from "./modules/jurisdiction/jurisdictionPolicyService.js";
import { MatrixServerService } from "./modules/matrix/matrixServerService.js";
import { DeviceInventoryService } from "./modules/devices/deviceInventoryService.js";
import { ImageFactoryService } from "./modules/images/imageFactoryService.js";
import { OrchestratorService } from "./modules/orchestrator/orchestratorService.js";
import { PhantomGovernanceService } from "./modules/phantom/phantomGovernanceService.js";
import { ProvisioningApprovalService } from "./modules/approvals/provisioningApprovalService.js";
import { ReleaseControlService } from "./modules/release/releaseControlService.js";
import { LiveExecutionService } from "./modules/live/liveExecutionService.js";
import { buildLiveBaselineUserData, liveBaselineArtifactSummary } from "./modules/live/liveBaselineArtifacts.js";
import { SecurityProfileService } from "./modules/security/securityProfileService.js";
import { OperatorPortalService } from "./modules/operatorPortal/operatorPortalService.js";
import { RouterReadinessService } from "./modules/router/routerReadinessService.js";
import { AppError, validationError } from "./lib/errors.js";

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendRaw(res, status, contentType, payload) {
  res.writeHead(status, { "content-type": contentType });
  res.end(payload);
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

function operatorBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

function latestPromotableLocalBaseline(pipelines = []) {
  return pipelines.find((pipeline) => (
    pipeline.status === "local_lab_ready"
    && pipeline.localLab?.vps?.length === 3
    && pipeline.firecrackerPlan?.workloads?.length > 0
    && pipeline.productionExecutionAllowed === false
  ));
}

const PRODUCTION_READINESS_APPS = Object.freeze([
  { key: "duckduckgo_browser", label: "DuckDuckGo", host: "duckduckgo.sylion.internal", path: "/vnc.html", envAlias: "DUCKDUCKGO", expected: "firecracker_gui" },
  { key: "libreoffice", label: "LibreOffice", host: "libreoffice.sylion.internal", path: "/", envAlias: "LIBREOFFICE", expected: "firecracker_gui" },
  { key: "whatsapp", label: "WhatsApp", host: "whatsapp.sylion.internal", path: "/", envAlias: "WHATSAPP", expected: "firecracker_web" },
  { key: "telegram", label: "Telegram", host: "telegram.sylion.internal", path: "/", envAlias: "TELEGRAM", expected: "firecracker_web" },
  { key: "threema", label: "Threema", host: "threema.sylion.internal", path: "/", envAlias: "THREEMA", expected: "firecracker_web" },
  { key: "signal", label: "Signal", host: "signal.sylion.internal", path: "/", envAlias: "SIGNAL", expected: "firecracker_desktop" },
  { key: "zangi", label: "Zangi", host: "zangi.sylion.internal", path: "/", envAlias: "ZANGI", expected: "android_native" },
  { key: "exodus", label: "Exodus", host: "exodus.sylion.internal", path: "/", envAlias: "EXODUS", expected: "dedicated_wallet_workload" }
]);

function readinessHttpStatus(env, app) {
  const direct = env[`SYLION_${app.key.toUpperCase()}_LIVE_HTTP_STATUS`];
  const alias = env[`SYLION_${app.envAlias}_LIVE_HTTP_STATUS`];
  const value = direct || alias || null;
  return value ? Number(value) : null;
}

function readinessAppState(env, app, factualRecord = null) {
  const httpStatus = readinessHttpStatus(env, app);
  const evidenceReady = env[`SYLION_${app.key.toUpperCase()}_NATIVE_EVIDENCE_READY`] === "true"
    || env[`SYLION_${app.envAlias}_NATIVE_EVIDENCE_READY`] === "true";
  const envFactualStateVerified = env[`SYLION_${app.key.toUpperCase()}_FACTUAL_STATE_VERIFIED`] === "true"
    || env[`SYLION_${app.envAlias}_FACTUAL_STATE_VERIFIED`] === "true";
  const factualStateVerified = factualRecord
    ? factualRecord.factualStateVerified === true
    : envFactualStateVerified;
  const transportReady = httpStatus === 200 || evidenceReady;
  const ready = transportReady && factualStateVerified;
  const notBuilt = httpStatus === 502 || env[`SYLION_${app.key.toUpperCase()}_NATIVE_EVIDENCE_READY`] === "false";
  const factualBlockers = factualRecord && factualRecord.factualStateVerified !== true
    ? factualRecord.blockers || ["factual_state_not_verified"]
    : [];
  return {
    ...app,
    url: `https://${app.host}${app.path}`,
    httpStatus,
    evidenceReady,
    factualStateVerified,
    latestFactualTest: factualRecord ? {
      id: factualRecord.id,
      result: factualRecord.result,
      terminalMode: factualRecord.terminalMode,
      runtimeMode: factualRecord.runtimeMode,
      requiredChecks: factualRecord.requiredChecks,
      blockers: factualRecord.blockers,
      createdAt: factualRecord.createdAt,
      linkedProblemId: factualRecord.linkedProblemId || null
    } : null,
    state: ready ? "ready" : notBuilt ? "not_built" : "unknown_or_blocked",
    blockers: ready ? [] : [
      notBuilt ? `${app.key}_native_workload_not_built` : `${app.key}_live_route_not_verified`,
      ...(transportReady && !factualStateVerified ? ["factual_state_not_verified", ...factualBlockers] : []),
      ...(app.expected === "android_native" ? ["android_native_runtime_required"] : [])
    ],
    cdrRequired: true,
    terminalDataStored: false,
    privateRouteRequired: true,
    productionExecutionAllowed: false
  };
}

function tierCostModel(tier) {
  const models = {
    STANDARD: { minimumSubscriptionMonths: 6, monthlyInfraCostPln: 420, monthlyCustomerPricePln: 1200, workloadTenancy: "shared_dedicated_pool_allowed" },
    PRO: { minimumSubscriptionMonths: 6, monthlyInfraCostPln: 760, monthlyCustomerPricePln: 2500, workloadTenancy: "shared_dedicated_pool_allowed" },
    SOVEREIGN: { minimumSubscriptionMonths: 6, monthlyInfraCostPln: 1800, monthlyCustomerPricePln: 6500, workloadTenancy: "dedicated_operator_only" }
  };
  const model = models[tier] || models.PRO;
  return {
    ...model,
    grossMarginPln: model.monthlyCustomerPricePln - model.monthlyInfraCostPln
  };
}

function buildProductionReadiness({ actor, services, env, correlationId }) {
  const productionOperatorId = env.SYLION_PRODUCTION_OPERATOR_ID || null;
  const operatorsList = services.operators.list({ actor, correlationId })
    .filter((operator) => !productionOperatorId || operator.id === productionOperatorId);
  const hosts = services.liveExecution.listWorkloadNativeHosts({ actor, correlationId });
  const nativeHost = hosts[0] || null;
  const rows = operatorsList.map((operator) => {
    const subscription = services.subscriptions.getTenantSubscription({ actor, tenantId: operator.tenantId, correlationId });
    const cost = tierCostModel(operator.tier);
    const factualByApp = services.release.latestWorkloadFactualTestsByApp({ actor, operatorId: operator.id, correlationId });
    const apps = PRODUCTION_READINESS_APPS.map((app) => readinessAppState(env, app, factualByApp[app.key] || null));
    const criticalBlockers = [
      ...(env.SYLION_PIXEL_G1_READY === "true" ? [] : ["pixel_to_g1_evidence_missing_or_stale"]),
      ...(env.SYLION_G1_G2_READY === "true" ? [] : ["g1_to_g2_evidence_missing_or_stale"]),
      ...(env.SYLION_G2_AX102_READY === "true" || env.SYLION_G2_WORKLOAD_NATIVE_READY === "true" ? [] : ["g2_to_ax102_evidence_missing_or_stale"]),
      ...(nativeHost ? [] : ["workload_native_host_not_registered"]),
      ...apps.flatMap((app) => app.blockers.map((blocker) => `${app.key}:${blocker}`))
    ];
    return {
      operatorId: operator.id,
      displayName: operator.displayName,
      tenantId: operator.tenantId,
      tier: operator.tier,
      operatorStatus: operator.status,
      subscription: {
        tier: subscription.tier,
        planId: subscription.planId,
        billingStatus: subscription.billingStatus,
        minimumMonths: cost.minimumSubscriptionMonths,
        tokenState: env.SYLION_SUBSCRIPTION_TOKEN_FLOW_READY === "true" ? "ready" : "planned"
      },
      cost,
      infrastructure: {
        g1: env.SYLION_G1_PUBLIC_IP || "178.105.200.112",
        g2: env.SYLION_G2_PUBLIC_IP || "178.105.203.31",
        workloadNative: nativeHost ? {
          hostId: nativeHost.hostId,
          serverNumber: nativeHost.serverNumber,
          region: nativeHost.region,
          lifecycleState: nativeHost.lifecycleState,
          readyForLabWorkloads: nativeHost.readyForLabWorkloads === true
        } : null
      },
      path: {
        pixel: env.SYLION_PIXEL_G1_READY === "true" ? "ready" : "evidence_required",
        laptop: env.SYLION_LAPTOP_G1_READY === "true" ? "ready" : "not_configured",
        g1g2: env.SYLION_G1_G2_READY === "true" ? "ready" : "evidence_required",
        g2Workload: env.SYLION_G2_AX102_READY === "true" || env.SYLION_G2_WORKLOAD_NATIVE_READY === "true" ? "ready" : "evidence_required"
      },
      apps,
      blockers: criticalBlockers,
      status: criticalBlockers.length ? "blocked" : "ready_for_human_gate",
      productionExecutionAllowed: false
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    operators: rows,
    summary: {
      operators: rows.length,
      readyForHumanGate: rows.filter((row) => row.status === "ready_for_human_gate").length,
      blocked: rows.filter((row) => row.status === "blocked").length,
      productionExecutionAllowed: false
    }
  };
}

const WEB_ROOT = resolve(fileURLToPath(new URL("../../../apps/admin-web/", import.meta.url)));
const OPERATOR_WEB_ROOT = resolve(fileURLToPath(new URL("../../../apps/operator-web/", import.meta.url)));
const STATIC_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
});

async function serveAdminWeb(url, res) {
  const pathname = url.pathname === "/" || url.pathname === "/admin"
    ? "/index.html"
    : url.pathname.replace(/^\/admin/, "");
  const filePath = resolve(WEB_ROOT, `.${decodeURIComponent(pathname)}`);
  const relativePath = relative(WEB_ROOT, filePath);
  if (relativePath.startsWith("..") || relativePath.startsWith("/") || relativePath.startsWith("\\")) {
    return false;
  }
  const ext = extname(filePath);
  if (!STATIC_TYPES[ext]) {
    return false;
  }
  try {
    const file = await readFile(filePath);
    sendRaw(res, 200, STATIC_TYPES[ext], file);
    return true;
  } catch {
    return false;
  }
}

// Per ADR-terminal-modes-001: operator portal served under /operator/*.
// Separate static root from admin-web. API stubs live under /operator-api/*.
async function serveOperatorWeb(url, res) {
  const pathname = url.pathname === "/operator"
    ? "/index.html"
    : url.pathname.replace(/^\/operator/, "");
  const filePath = resolve(OPERATOR_WEB_ROOT, `.${decodeURIComponent(pathname)}`);
  const relativePath = relative(OPERATOR_WEB_ROOT, filePath);
  if (relativePath.startsWith("..") || relativePath.startsWith("/") || relativePath.startsWith("\\")) {
    return false;
  }
  const ext = extname(filePath);
  if (!STATIC_TYPES[ext]) {
    return false;
  }
  try {
    const file = await readFile(filePath);
    sendRaw(res, 200, STATIC_TYPES[ext], file);
    return true;
  } catch {
    return false;
  }
}

export function createApp({ store = null, authOptions = {}, liveExecutionOptions = {} } = {}) {
  const runtimeEnv = liveExecutionOptions.env || process.env;
  const audit = new AuditService({ store });
  const auth = new AuthService({ audit, store, ...authOptions });
  const rbac = new RbacService({ audit });
  const entitlements = new EntitlementService({ audit });
  const tenants = new TenantService({ audit, rbac, entitlements, store });
  const operators = new OperatorService({ audit, rbac, entitlements, tenants, store });
  const provisioningPlans = new ProvisioningPlanService({ audit, rbac, entitlements, operators, store });
  const appCatalog = new AppCatalogService({ audit, rbac, store });
  const subscriptions = new SubscriptionService({ audit, rbac, tenants, operators, appCatalog, store });
  const cdr = new CdrService({ audit, appCatalog, store });
  const monitoring = new MonitoringService({ audit, rbac, store });
  const incidents = new IncidentService({ audit, rbac, monitoring, store });
  const secrets = new SecretManagerService({ audit, rbac, store, env: runtimeEnv });
  const providers = new ProviderRegistryService({ audit, rbac, secrets, store });
  const providerDryRun = new ProviderDryRunService({ audit, rbac, providers, operators, store });
  const inventory = new InventoryService({ audit, rbac, operators, store });
  const pki = new PkiService({ audit, rbac, operators, inventory, store });
  const jurisdiction = new JurisdictionPolicyService({ audit, rbac, entitlements, store });
  const matrix = new MatrixServerService({ audit, rbac, entitlements, store });
  const devices = new DeviceInventoryService({ audit, rbac, operators, store });
  const imageFactory = new ImageFactoryService({ audit, rbac, devices, appCatalog, store });
  const phantom = new PhantomGovernanceService({ audit, rbac, entitlements, operators, monitoring, store });
  const approvals = new ProvisioningApprovalService({
    audit,
    rbac,
    tenants,
    operators,
    providers,
    providerDryRun,
    devices,
    subscriptions,
    store
  });
  const orchestrator = new OrchestratorService({
    audit,
    rbac,
    provisioningPlans,
    inventory,
    pki,
    imageFactory,
    devices,
    monitoring,
    store
  });
  const release = new ReleaseControlService({ audit, rbac, approvals, phantom, store });
  const liveExecution = new LiveExecutionService({
    audit,
    rbac,
    providers,
    operators,
    approvals,
    store,
    ...liveExecutionOptions
  });
  const operatorProvisioning = new OperatorProvisioningPipelineService({
    audit,
    rbac,
    operators,
    subscriptions,
    store
  });
  const operatorEnvironments = new OperatorEnvironmentService({
    audit,
    rbac,
    operatorProvisioning,
    monitoring,
    store
  });
  const securityProfiles = new SecurityProfileService({
    audit,
    rbac,
    operators,
    store
  });
  const routerReadiness = new RouterReadinessService({
    audit,
    rbac,
    operators,
    devices,
    store
  });
  const operatorPortal = new OperatorPortalService({
    audit,
    rbac,
    operators,
    devices,
    subscriptions,
    operatorEnvironments,
    securityProfiles,
    routerReadiness,
    env: runtimeEnv,
    store,
    liveWorkloadRunner: liveExecutionOptions.liveWorkloadRunner,
    workloadImageManifestResolver: (appKey) => liveExecution.latestReadyWorkloadImageManifestForApp(appKey)
  });

  const services = {
    audit,
    auth,
    rbac,
    entitlements,
    subscriptions,
    tenants,
    operators,
    provisioningPlans,
    appCatalog,
    cdr,
    monitoring,
    incidents,
    secrets,
    providers,
    inventory,
    pki,
    jurisdiction,
    matrix,
    devices,
    imageFactory,
    phantom,
    approvals,
    orchestrator,
    release,
    liveExecution,
    operatorProvisioning,
    operatorEnvironments,
    securityProfiles,
    routerReadiness,
    operatorPortal
  };

  function operatorActorFromRequest(req) {
    return operatorPortal.actorFromToken(operatorBearerToken(req));
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url, "http://localhost");
      const correlationId = req.headers["x-correlation-id"];

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/admin" || url.pathname.startsWith("/admin/"))) {
        if (await serveAdminWeb(url, res)) {
          return;
        }
      }

      // Per ADR-terminal-modes-001: operator portal static + stub API.
      if (req.method === "GET" && (url.pathname === "/operator" || url.pathname.startsWith("/operator/"))) {
        if (await serveOperatorWeb(url, res)) {
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/operator-api/about") {
        return send(res, 200, {
          portal: "SYLION Operator Portal",
          status: "scoped_contract_ready",
          adr: "ADR-terminal-modes-001",
          modes: ["pixel_grapheneos", "laptop_web_terminal"],
          transport: "ipsec_ikev2_planned",
          productionExecutionAllowed: false,
          physicalFido2Deferred: true,
          physicalHsmDeferred: true
        });
      }

      if (req.method === "POST" && url.pathname === "/operator-api/sessions/local-simulator") {
        const actor = auth.actorFromToken(bearerToken(req));
        const body = await readJson(req);
        const session = operatorPortal.createLocalSession({ actor, ...body, correlationId });
        return send(res, 201, { session });
      }

      if (req.method === "GET" && url.pathname === "/operator-api/me") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { me: operatorPortal.me({ operatorActor, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/devices") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { devices: operatorPortal.devicesForOperator({ operatorActor, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/workloads") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { workloads: operatorPortal.workloads({ operatorActor, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/workload-control") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { control: operatorPortal.workloadControl({ operatorActor, correlationId }) });
      }
      if (req.method === "POST" && url.pathname === "/operator-api/workload-control/requests") {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        return send(res, 201, { request: operatorPortal.requestWorkloadControl({ operatorActor, body, correlationId }) });
      }
      const workloadControlExecuteMatch = url.pathname.match(/^\/operator-api\/workload-control\/requests\/([^/]+)\/execute$/);
      if (req.method === "POST" && workloadControlExecuteMatch) {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        return send(res, 200, {
          job: await operatorPortal.executeWorkloadControlRequest({
            operatorActor,
            requestId: workloadControlExecuteMatch[1],
            body,
            correlationId
          })
        });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/vpn-status") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { vpn: operatorPortal.vpnStatus({ operatorActor, correlationId }) });
      }
      if (req.method === "POST" && url.pathname === "/operator-api/vpn-evidence") {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        return send(res, 201, { evidence: operatorPortal.recordVpnEvidence({ operatorActor, body, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/connection-path") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { path: operatorPortal.connectionPath({ operatorActor, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/workload-execution/signal") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { execution: operatorPortal.workloadExecution({ operatorActor, templateKey: "signal", correlationId }) });
      }
      if (req.method === "GET" && url.pathname.startsWith("/operator-api/workload-execution/") && !url.pathname.endsWith("/start")) {
        const operatorActor = operatorActorFromRequest(req);
        const templateKey = decodeURIComponent(url.pathname.split("/").at(-1) || "signal");
        return send(res, 200, { execution: operatorPortal.workloadExecution({ operatorActor, templateKey, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/account-bootstrap") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { bootstrap: operatorPortal.accountBootstrap({ operatorActor, correlationId }) });
      }
      if (req.method === "POST" && url.pathname === "/operator-api/account-bootstrap/sessions") {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        const session = operatorPortal.requestAccountBootstrap({ operatorActor, body, correlationId });
        return send(res, 201, { session });
      }
      const accountBootstrapEvidenceMatch = url.pathname.match(/^\/operator-api\/account-bootstrap\/sessions\/([^/]+)\/evidence$/);
      if (req.method === "POST" && accountBootstrapEvidenceMatch) {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        const session = operatorPortal.recordAccountBootstrapEvidence({
          operatorActor,
          sessionId: accountBootstrapEvidenceMatch[1],
          body,
          correlationId
        });
        return send(res, 200, { session });
      }
      if (req.method === "POST" && url.pathname === "/operator-api/workload-execution/signal/start") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { request: operatorPortal.startWorkloadExecution({ operatorActor, templateKey: "signal", correlationId }) });
      }
      if (req.method === "POST" && url.pathname.startsWith("/operator-api/workload-execution/") && url.pathname.endsWith("/start")) {
        const operatorActor = operatorActorFromRequest(req);
        const templateKey = decodeURIComponent(url.pathname.split("/").at(-2) || "signal");
        return send(res, 200, { request: operatorPortal.startWorkloadExecution({ operatorActor, templateKey, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/vpn-install-package") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { package: operatorPortal.vpnInstallPackage({ operatorActor, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/pixel-ca-provisioning") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { package: operatorPortal.pixelCaProvisioning({ operatorActor, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/laptop-access-package") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { package: operatorPortal.laptopAccessPackage({ operatorActor, correlationId }) });
      }
      if (req.method === "GET" && url.pathname.startsWith("/operator-api/workload-session-broker/")) {
        const operatorActor = operatorActorFromRequest(req);
        const templateKey = decodeURIComponent(url.pathname.split("/").at(-1) || "signal");
        return send(res, 200, { broker: operatorPortal.workloadSessionBroker({ operatorActor, templateKey, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/live-access-foundation") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { foundation: operatorPortal.liveAccessFoundation({ operatorActor, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/streaming-profile") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, {
          profile: operatorPortal.streamingProfile({
            operatorActor,
            width: url.searchParams.get("width"),
            height: url.searchParams.get("height"),
            dpr: url.searchParams.get("dpr"),
            correlationId
          })
        });
      }
      if (req.method === "POST" && url.pathname === "/operator-api/streaming-sessions") {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        return send(res, 201, { session: operatorPortal.requestStreamingSession({ operatorActor, body, correlationId }) });
      }
      if (req.method === "POST" && url.pathname === "/operator-api/streaming-readiness") {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        return send(res, 201, { evidence: operatorPortal.recordStreamingReadiness({ operatorActor, body, correlationId }) });
      }
      if (req.method === "POST" && url.pathname === "/operator-api/streaming-runtime-manifest") {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        return send(res, 201, { manifest: operatorPortal.recordStreamingRuntimeManifest({ operatorActor, body, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/audit") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { events: operatorPortal.auditEvents({ operatorActor, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/settings/fido2") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { policy: operatorPortal.fido2Policy({ operatorActor, correlationId }) });
      }
      if (req.method === "POST" && url.pathname === "/operator-api/settings/fido2") {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        return send(res, 200, { policy: operatorPortal.updateFido2Policy({ operatorActor, body, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/settings/hsm") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { profile: operatorPortal.hsmProfile({ operatorActor, correlationId }) });
      }
      if (req.method === "POST" && url.pathname === "/operator-api/settings/hsm") {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        return send(res, 200, { profile: operatorPortal.updateHsmProfile({ operatorActor, body, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/settings/unlock") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { policy: operatorPortal.unlockPolicy({ operatorActor, correlationId }) });
      }
      if (req.method === "POST" && url.pathname === "/operator-api/settings/unlock") {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        return send(res, 200, { policy: operatorPortal.updateUnlockPolicy({ operatorActor, body, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/settings/safety") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { policy: operatorPortal.safetyPolicy({ operatorActor, correlationId }) });
      }
      if (req.method === "POST" && url.pathname === "/operator-api/settings/safety") {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        return send(res, 200, { policy: operatorPortal.updateSafetyPolicy({ operatorActor, body, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/settings/jurisdiction") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { policy: operatorPortal.jurisdictionPolicy({ operatorActor, correlationId }) });
      }
      if (req.method === "POST" && url.pathname === "/operator-api/settings/jurisdiction") {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        return send(res, 200, { policy: operatorPortal.updateJurisdictionPolicy({ operatorActor, body, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/matrix-server") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { matrix: operatorPortal.matrixServer({ operatorActor, correlationId }) });
      }
      if (req.method === "POST" && url.pathname === "/operator-api/matrix-server/requests") {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        return send(res, 201, { request: operatorPortal.requestMatrixServer({ operatorActor, body, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/subscription") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { subscription: operatorPortal.subscription({ operatorActor, correlationId }) });
      }
      if (req.method === "POST" && url.pathname === "/operator-api/subscription/requests") {
        const operatorActor = operatorActorFromRequest(req);
        const body = await readJson(req);
        return send(res, 201, { request: operatorPortal.requestSubscriptionChange({ operatorActor, body, correlationId }) });
      }
      if (req.method === "GET" && url.pathname === "/operator-api/terminal-profiles") {
        const operatorActor = operatorActorFromRequest(req);
        return send(res, 200, { profiles: operatorPortal.terminalProfiles({ operatorActor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { status: "ok", service: "admin-api" });
      }

      if (req.method === "POST" && url.pathname === "/auth/login") {
        const body = await readJson(req);
        const session = auth.login({ ...body, correlationId });
        return send(res, 200, { session });
      }

      if (req.method === "POST" && url.pathname === "/auth/webauthn/enrollment/options") {
        const body = await readJson(req);
        const result = auth.createEnrollmentOptions({ ...body, correlationId });
        return send(res, 201, result);
      }

      if (req.method === "POST" && url.pathname === "/auth/webauthn/enrollment/verify") {
        const body = await readJson(req);
        const result = auth.verifyEnrollment({ ...body, correlationId });
        return send(res, 201, result);
      }

      if (req.method === "POST" && url.pathname === "/auth/webauthn/login/options") {
        const body = await readJson(req);
        const result = auth.createLoginOptions({ ...body, correlationId });
        return send(res, 201, result);
      }

      if (req.method === "POST" && url.pathname === "/auth/webauthn/login/verify") {
        const body = await readJson(req);
        const session = auth.verifyLogin({ ...body, correlationId });
        return send(res, 200, { session });
      }

      if (req.method === "POST" && url.pathname === "/auth/recovery/request") {
        const body = await readJson(req);
        const request = auth.createRecoveryRequest({ ...body, correlationId });
        return send(res, 201, { request });
      }

      const actor = auth.actorFromToken(bearerToken(req));

      if (req.method === "GET" && url.pathname === "/auth/session") {
        return send(res, 200, { session: auth.sessionFromActor(actor) });
      }

      if (req.method === "GET" && url.pathname === "/production-readiness/operators") {
        return send(res, 200, {
          readiness: buildProductionReadiness({ actor, services, env: runtimeEnv, correlationId })
        });
      }

      if (req.method === "GET" && url.pathname === "/release/summary") {
        return send(res, 200, { summary: release.summary({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/release/build-assessment") {
        return send(res, 200, { assessment: release.buildAssessment({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/release/gates") {
        return send(res, 200, { gates: release.listGates({ actor, correlationId }) });
      }

      const releaseGateStatusMatch = url.pathname.match(/^\/release\/gates\/([^/]+)\/status$/);
      if (req.method === "POST" && releaseGateStatusMatch) {
        const body = await readJson(req);
        const gate = release.updateGateStatus({
          actor,
          gateId: releaseGateStatusMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { gate });
      }

      if (req.method === "GET" && url.pathname === "/release/problems") {
        return send(res, 200, { problems: release.listProblems({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/release/problems") {
        const body = await readJson(req);
        const problem = release.createProblem({ actor, ...body, correlationId });
        return send(res, 201, { problem });
      }

      const releaseProblemStatusMatch = url.pathname.match(/^\/release\/problems\/([^/]+)\/status$/);
      if (req.method === "POST" && releaseProblemStatusMatch) {
        const body = await readJson(req);
        const problem = release.updateProblemStatus({
          actor,
          problemId: releaseProblemStatusMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { problem });
      }

      if (req.method === "GET" && url.pathname === "/release/human-tests") {
        return send(res, 200, { scenarios: release.listTests({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/release/human-test-runs") {
        return send(res, 200, { runs: release.listTestRuns({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/release/human-test-runs") {
        const body = await readJson(req);
        const run = release.recordHumanTestRun({ actor, ...body, correlationId });
        return send(res, 201, { run });
      }

      if (req.method === "GET" && url.pathname === "/release/workload-factual-tests") {
        return send(res, 200, {
          tests: release.listWorkloadFactualTests({
            actor,
            operatorId: url.searchParams.get("operatorId"),
            appKey: url.searchParams.get("appKey"),
            correlationId
          })
        });
      }

      if (req.method === "GET" && url.pathname === "/release/account-bootstrap-evidence") {
        return send(res, 200, {
          sessions: operatorPortal.listAccountBootstrapEvidenceForAdmin({
            actor,
            operatorId: url.searchParams.get("operatorId"),
            correlationId
          })
        });
      }

      const accountBootstrapPromoteMatch = url.pathname.match(/^\/release\/account-bootstrap-evidence\/([^/]+)\/promote$/);
      if (req.method === "POST" && accountBootstrapPromoteMatch) {
        const body = await readJson(req);
        const session = operatorPortal.getAccountBootstrapEvidenceForAdmin({
          actor,
          sessionId: accountBootstrapPromoteMatch[1],
          correlationId
        });
        if (session.factualCandidate !== true) {
          throw validationError("Only complete account bootstrap evidence can be promoted to factual test", {
            sessionId: session.id,
            blockers: session.blockers || []
          });
        }
        const test = release.recordWorkloadFactualTest({
          actor,
          operatorId: session.operatorId,
          appKey: session.appKey,
          terminalMode: session.terminalMode,
          runtimeMode: session.runtimeMode,
          result: body.result || "passed",
          checks: session.checks,
          evidenceArtifactIds: body.evidenceArtifactIds || session.evidenceArtifactIds || [],
          latencyMs: body.latencyMs ?? session.latencyMs,
          note: body.note || `Admin/QA promoted account bootstrap evidence ${session.id}`,
          correlationId
        });
        const reviewed = operatorPortal.markAccountBootstrapEvidenceReviewed({
          actor,
          sessionId: session.id,
          factualTestId: test.id,
          correlationId
        });
        return send(res, 201, { test, session: reviewed });
      }

      if (req.method === "POST" && url.pathname === "/release/workload-factual-tests") {
        const body = await readJson(req);
        const test = release.recordWorkloadFactualTest({ actor, ...body, correlationId });
        return send(res, 201, { test });
      }

      const releaseTestStatusMatch = url.pathname.match(/^\/release\/human-tests\/([^/]+)\/status$/);
      if (req.method === "POST" && releaseTestStatusMatch) {
        const body = await readJson(req);
        const scenario = release.updateTestStatus({
          actor,
          scenarioId: releaseTestStatusMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { scenario });
      }

      if (req.method === "GET" && url.pathname === "/release/evidence-artifacts") {
        return send(res, 200, { artifacts: release.listArtifacts({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/release/evidence-artifacts") {
        const body = await readJson(req);
        const artifact = release.createArtifact({ actor, ...body, correlationId });
        return send(res, 201, { artifact });
      }

      if (req.method === "GET" && url.pathname === "/live-execution/summary") {
        return send(res, 200, { summary: liveExecution.summary({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/live-execution/cloud/requests") {
        return send(res, 200, { requests: liveExecution.listRequests({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/live-execution/cloud/rollback-plans") {
        return send(res, 200, { plans: liveExecution.listRollbackPlans({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/live-execution/cloud/rehearsals") {
        return send(res, 200, { rehearsals: liveExecution.listProviderRehearsals({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/live-execution/dedicated-workload/orders") {
        return send(res, 200, { orders: liveExecution.listDedicatedWorkloadOrders({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/live-execution/workload-native/hosts") {
        return send(res, 200, { hosts: liveExecution.listWorkloadNativeHosts({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/live-execution/workload-images/manifests") {
        return send(res, 200, { manifests: liveExecution.listWorkloadImageManifests({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/live-execution/workload-native/hosts") {
        auth.requireFreshStepUp(actor, "workload_native.host.register", {
          correlationId,
          resourceType: "workload_native_host"
        });
        const body = await readJson(req);
        const host = liveExecution.registerWorkloadNativeHost({
          actor,
          ...body,
          correlationId
        });
        return send(res, 201, { host });
      }

      if (req.method === "POST" && url.pathname === "/live-execution/workload-images/manifests") {
        auth.requireFreshStepUp(actor, "workload_image_manifest.create", {
          correlationId,
          resourceType: "workload_image_manifest"
        });
        const body = await readJson(req);
        const manifest = liveExecution.createWorkloadImageManifest({
          actor,
          ...body,
          correlationId
        });
        return send(res, 201, { manifest });
      }

      if (req.method === "POST" && url.pathname === "/live-execution/dedicated-workload/hetzner-robot/order") {
        auth.requireFreshStepUp(actor, "dedicated_workload.hetzner_robot.order", {
          correlationId,
          resourceType: "dedicated_workload_order"
        });
        const body = await readJson(req);
        const order = await liveExecution.createDedicatedWorkloadOrder({
          actor,
          ...body,
          correlationId
        });
        return send(res, 201, { order });
      }

      const providerReconcileMatch = url.pathname.match(/^\/live-execution\/cloud\/([^/]+)\/reconcile$/);
      if (req.method === "POST" && providerReconcileMatch) {
        const body = await readJson(req);
        const reconciliation = await liveExecution.reconcileProviderVpsSet({
          actor,
          providerKey: providerReconcileMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { reconciliation });
      }

      const providerRehearsalMatch = url.pathname.match(/^\/live-execution\/cloud\/([^/]+)\/rehearsal$/);
      if (req.method === "POST" && providerRehearsalMatch) {
        auth.requireFreshStepUp(actor, `live_cloud.${providerRehearsalMatch[1]}.rehearsal`, {
          correlationId,
          resourceType: "live_provider_rehearsal"
        });
        const body = await readJson(req);
        const rehearsal = await liveExecution.runProviderRehearsal({
          actor,
          providerKey: providerRehearsalMatch[1],
          idempotencyKey: req.headers["idempotency-key"] || body.idempotencyKey,
          ...body,
          correlationId
        });
        return send(res, 201, { rehearsal });
      }

      const rollbackExecuteMatch = url.pathname.match(/^\/live-execution\/cloud\/rollback-plans\/([^/]+)\/execute$/);
      if (req.method === "POST" && rollbackExecuteMatch) {
        auth.requireFreshStepUp(actor, "live_cloud.rollback_execute", {
          correlationId,
          resourceType: "live_rollback_plan",
          resourceId: rollbackExecuteMatch[1]
        });
        const body = await readJson(req);
        const plan = await liveExecution.executeRollbackPlan({
          actor,
          planId: rollbackExecuteMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { plan });
      }

      const providerVpsSetMatch = url.pathname.match(/^\/live-execution\/cloud\/([^/]+)\/vps-set$/);
      if (req.method === "POST" && providerVpsSetMatch) {
        auth.requireFreshStepUp(actor, `live_cloud.${providerVpsSetMatch[1]}.vps_set`, {
          correlationId,
          resourceType: "live_execution_request"
        });
        const body = await readJson(req);
        const request = await liveExecution.createProviderVpsSet({
          actor,
          providerKey: providerVpsSetMatch[1],
          idempotencyKey: req.headers["idempotency-key"] || body.idempotencyKey,
          ...body,
          correlationId
        });
        return send(res, 201, { request });
      }

      if (req.method === "POST" && url.pathname === "/live-execution/cloud/hetzner/vps-set") {
        auth.requireFreshStepUp(actor, "live_cloud.hetzner.vps_set", {
          correlationId,
          resourceType: "live_execution_request"
        });
        const body = await readJson(req);
        const request = await liveExecution.createHetznerVpsSet({
          actor,
          idempotencyKey: req.headers["idempotency-key"] || body.idempotencyKey,
          ...body,
          correlationId
        });
        return send(res, 201, { request });
      }

      const operatorLivePromotionMatch = url.pathname.match(/^\/operators\/([^/]+)\/live-promotions\/([^/]+)$/);
      if (req.method === "POST" && operatorLivePromotionMatch) {
        const operatorId = operatorLivePromotionMatch[1];
        const providerKey = operatorLivePromotionMatch[2];
        auth.requireFreshStepUp(actor, `operator.${operatorId}.live_promote.${providerKey}`, {
          correlationId,
          resourceType: "live_execution_request",
          resourceId: operatorId
        });
        const pipelines = operatorProvisioning.listPipelines({ actor, operatorId, correlationId });
        const localBaseline = latestPromotableLocalBaseline(pipelines);
        if (!localBaseline) {
          throw validationError("Operator must have an automatic local G1/G2/WORKLOAD baseline before live promotion", {
            operatorId,
            requiredStatus: "local_lab_ready",
            requiredRoles: ["G1", "G2", "WORKLOAD"]
          });
        }
        const body = await readJson(req);
        const request = await liveExecution.createProviderVpsSet({
          actor,
          ...body,
          providerKey,
          operatorId,
          idempotencyKey: req.headers["idempotency-key"] || body.idempotencyKey,
          correlationId
        });
        return send(res, 201, {
          promotion: {
            mode: "operator_baseline_to_live",
            operatorId,
            providerKey,
            localBaselineId: localBaseline.id,
            localLabId: localBaseline.localLab.id,
            firecrackerPlanId: localBaseline.firecrackerPlan.id,
            requestedRoles: localBaseline.localLab.vps.map((vps) => vps.role),
            requestedWorkloads: localBaseline.firecrackerPlan.workloads.map((workload) => workload.templateKey),
            humanGateRequired: true,
            productionExecutionAllowed: false
          },
          request
        });
      }

      if (req.method === "GET" && url.pathname === "/live-execution/firecracker/host-qualifications") {
        return send(res, 200, { qualifications: liveExecution.listFirecrackerQualifications({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/live-execution/firecracker/launch-rehearsals") {
        return send(res, 200, {
          rehearsals: liveExecution.listFirecrackerLaunchRehearsals({ actor, correlationId })
        });
      }

      if (req.method === "POST" && url.pathname === "/live-execution/firecracker/host-qualification") {
        auth.requireFreshStepUp(actor, "firecracker.host_qualification", {
          correlationId,
          resourceType: "firecracker_host_qualification"
        });
        const body = await readJson(req);
        const qualification = liveExecution.qualifyFirecrackerHost({ actor, ...body, correlationId });
        return send(res, 201, { qualification });
      }

      if (req.method === "POST" && url.pathname === "/live-execution/firecracker/launch-rehearsal") {
        auth.requireFreshStepUp(actor, "firecracker.launch_rehearsal", {
          correlationId,
          resourceType: "firecracker_launch_rehearsal"
        });
        const body = await readJson(req);
        const rehearsal = liveExecution.runFirecrackerLaunchRehearsal({ actor, ...body, correlationId });
        return send(res, 201, { rehearsal });
      }

      if (req.method === "GET" && url.pathname === "/live-execution/cpu-confidential/qualifications") {
        return send(res, 200, {
          qualifications: liveExecution.listCpuConfidentialQualifications({ actor, correlationId })
        });
      }

      if (req.method === "POST" && url.pathname === "/live-execution/cpu-confidential/qualification") {
        auth.requireFreshStepUp(actor, "cpu_confidential.host_qualification", {
          correlationId,
          resourceType: "cpu_confidential_qualification"
        });
        const body = await readJson(req);
        const qualification = liveExecution.qualifyCpuConfidentialHost({ actor, ...body, correlationId });
        return send(res, 201, { qualification });
      }

      if (req.method === "GET" && url.pathname === "/live-execution/phantom/requests") {
        return send(res, 200, { requests: liveExecution.listPhantomExecutionRequests({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/live-execution/phantom/request") {
        auth.requireFreshStepUp(actor, "phantom.execution_request", {
          correlationId,
          resourceType: "phantom_execution_request"
        });
        const body = await readJson(req);
        const request = liveExecution.createPhantomExecutionRequest({ actor, ...body, correlationId });
        return send(res, 201, { request });
      }

      if (req.method === "POST" && url.pathname === "/auth/logout") {
        return send(res, 200, auth.logout({ actor, correlationId }));
      }

      if (req.method === "GET" && url.pathname === "/operator-provisioning/templates") {
        return send(res, 200, { templates: operatorProvisioning.listTemplates({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/operator-provisioning/pipelines") {
        return send(res, 200, {
          pipelines: operatorProvisioning.listPipelines({
            actor,
            operatorId: url.searchParams.get("operatorId"),
            correlationId
          })
        });
      }

      const operatorPipelineMatch = url.pathname.match(/^\/operators\/([^/]+)\/provisioning-pipeline$/);
      if (req.method === "POST" && operatorPipelineMatch) {
        const body = await readJson(req);
        const pipeline = operatorProvisioning.createDraft({
          actor,
          operatorId: operatorPipelineMatch[1],
          ...body,
          correlationId
        });
        return send(res, 201, { pipeline });
      }

      const localLabPipelineMatch = url.pathname.match(/^\/operator-provisioning\/pipelines\/([^/]+)\/local-lab-vps$/);
      if (req.method === "POST" && localLabPipelineMatch) {
        const pipeline = operatorProvisioning.createLocalLabVpsSet({
          actor,
          pipelineId: localLabPipelineMatch[1],
          correlationId
        });
        return send(res, 201, { pipeline });
      }

      const secretsCheckMatch = url.pathname.match(/^\/operator-provisioning\/pipelines\/([^/]+)\/secrets-release-check$/);
      if (req.method === "POST" && secretsCheckMatch) {
        const check = operatorProvisioning.checkSecretsRelease({
          actor,
          pipelineId: secretsCheckMatch[1],
          correlationId
        });
        return send(res, 201, { check });
      }

      if (req.method === "GET" && url.pathname === "/operator-environments") {
        return send(res, 200, {
          environments: operatorEnvironments.list({
            actor,
            operatorId: url.searchParams.get("operatorId"),
            correlationId
          })
        });
      }

      const environmentMatch = url.pathname.match(/^\/operator-environments\/([^/]+)$/);
      if (req.method === "GET" && environmentMatch) {
        const environment = operatorEnvironments.get({
          actor,
          environmentId: environmentMatch[1],
          correlationId
        });
        return send(res, 200, { environment });
      }

      const environmentEventsMatch = url.pathname.match(/^\/operator-environments\/([^/]+)\/events$/);
      if (req.method === "GET" && environmentEventsMatch) {
        const events = operatorEnvironments.listEvents({
          actor,
          environmentId: environmentEventsMatch[1],
          correlationId
        });
        return send(res, 200, { events });
      }

      const localEnvironmentMatch = url.pathname.match(/^\/operator-provisioning\/pipelines\/([^/]+)\/local-environment$/);
      if (req.method === "POST" && localEnvironmentMatch) {
        const environment = operatorEnvironments.createFromPipeline({
          actor,
          pipelineId: localEnvironmentMatch[1],
          correlationId
        });
        return send(res, 201, { environment });
      }

      const startEnvironmentMatch = url.pathname.match(/^\/operator-environments\/([^/]+)\/start-local$/);
      if (req.method === "POST" && startEnvironmentMatch) {
        const environment = operatorEnvironments.startLocal({
          actor,
          environmentId: startEnvironmentMatch[1],
          correlationId
        });
        return send(res, 200, { environment });
      }

      const environmentFailureMatch = url.pathname.match(/^\/operator-environments\/([^/]+)\/failures$/);
      if (req.method === "POST" && environmentFailureMatch) {
        const body = await readJson(req);
        const environment = operatorEnvironments.injectFailure({
          actor,
          environmentId: environmentFailureMatch[1],
          ...body,
          correlationId
        });
        return send(res, 201, { environment });
      }

      const rollbackEnvironmentMatch = url.pathname.match(/^\/operator-environments\/([^/]+)\/rollback$/);
      if (req.method === "POST" && rollbackEnvironmentMatch) {
        const body = await readJson(req);
        const environment = operatorEnvironments.rollback({
          actor,
          environmentId: rollbackEnvironmentMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { environment });
      }

      const environmentSecretsMatch = url.pathname.match(/^\/operator-environments\/([^/]+)\/secrets-release-check$/);
      if (req.method === "POST" && environmentSecretsMatch) {
        const check = operatorEnvironments.checkSecretsRelease({
          actor,
          environmentId: environmentSecretsMatch[1],
          correlationId
        });
        return send(res, 201, { check });
      }

      if (req.method === "POST" && url.pathname === "/auth/step-up/options") {
        const result = auth.createStepUpOptions({ actor, correlationId });
        return send(res, 201, result);
      }

      if (req.method === "POST" && url.pathname === "/auth/step-up/verify") {
        const body = await readJson(req);
        const session = auth.verifyStepUp({ actor, ...body, correlationId });
        return send(res, 200, { session });
      }

      if (req.method === "GET" && url.pathname === "/auth/policy-matrix") {
        return send(res, 200, { policy: auth.authPolicyMatrix() });
      }

      if (req.method === "GET" && url.pathname === "/auth/credentials") {
        rbac.assert(actor, "auth.credential.read", { correlationId });
        return send(res, 200, { credentials: auth.listCredentials({ actor }) });
      }

      if (req.method === "GET" && url.pathname === "/security/admin/fido2-policy") {
        return send(res, 200, {
          policy: securityProfiles.getFido2Policy({ actor, scope: "admin", correlationId })
        });
      }

      if (req.method === "POST" && url.pathname === "/security/admin/fido2-policy") {
        const body = await readJson(req);
        return send(res, 200, {
          policy: securityProfiles.updateFido2Policy({ actor, scope: "admin", ...body, correlationId })
        });
      }

      if (req.method === "GET" && url.pathname === "/security/admin/hsm-profile") {
        return send(res, 200, {
          profile: securityProfiles.getHsmProfile({ actor, scope: "admin", correlationId })
        });
      }

      if (req.method === "POST" && url.pathname === "/security/admin/hsm-profile") {
        const body = await readJson(req);
        return send(res, 200, {
          profile: securityProfiles.updateHsmProfile({ actor, scope: "admin", ...body, correlationId })
        });
      }

      const operatorFido2ProfileMatch = url.pathname.match(/^\/operators\/([^/]+)\/security\/fido2-policy$/);
      if (req.method === "GET" && operatorFido2ProfileMatch) {
        return send(res, 200, {
          policy: securityProfiles.getFido2Policy({
            actor,
            scope: "operator",
            operatorId: operatorFido2ProfileMatch[1],
            correlationId
          })
        });
      }

      if (req.method === "POST" && operatorFido2ProfileMatch) {
        const body = await readJson(req);
        return send(res, 200, {
          policy: securityProfiles.updateFido2Policy({
            actor,
            scope: "operator",
            operatorId: operatorFido2ProfileMatch[1],
            ...body,
            correlationId
          })
        });
      }

      const operatorHsmProfileMatch = url.pathname.match(/^\/operators\/([^/]+)\/security\/hsm-profile$/);
      if (req.method === "GET" && operatorHsmProfileMatch) {
        return send(res, 200, {
          profile: securityProfiles.getHsmProfile({
            actor,
            scope: "operator",
            operatorId: operatorHsmProfileMatch[1],
            correlationId
          })
        });
      }

      if (req.method === "POST" && operatorHsmProfileMatch) {
        const body = await readJson(req);
        return send(res, 200, {
          profile: securityProfiles.updateHsmProfile({
            actor,
            scope: "operator",
            operatorId: operatorHsmProfileMatch[1],
            ...body,
            correlationId
          })
        });
      }

      const credentialSuspendMatch = url.pathname.match(/^\/auth\/credentials\/([^/]+)\/suspend$/);
      if (req.method === "POST" && credentialSuspendMatch) {
        rbac.assert(actor, "auth.credential.suspend", {
          correlationId,
          resourceType: "auth_credential",
          resourceId: credentialSuspendMatch[1]
        });
        auth.requireFreshStepUp(actor, "credential.suspend", {
          correlationId,
          resourceType: "auth_credential",
          resourceId: credentialSuspendMatch[1]
        });
        const body = await readJson(req);
        const credential = auth.suspendCredential({
          actor,
          credentialId: credentialSuspendMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { credential });
      }

      const credentialRevokeMatch = url.pathname.match(/^\/auth\/credentials\/([^/]+)\/revoke$/);
      if (req.method === "POST" && credentialRevokeMatch) {
        rbac.assert(actor, "auth.credential.revoke", {
          correlationId,
          resourceType: "auth_credential",
          resourceId: credentialRevokeMatch[1]
        });
        auth.requireFreshStepUp(actor, "credential.revoke", {
          correlationId,
          resourceType: "auth_credential",
          resourceId: credentialRevokeMatch[1]
        });
        const body = await readJson(req);
        const credential = auth.revokeCredential({
          actor,
          credentialId: credentialRevokeMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { credential });
      }

      if (req.method === "GET" && url.pathname === "/auth/recovery/requests") {
        rbac.assert(actor, "auth.recovery.read", { correlationId });
        return send(res, 200, { requests: auth.listRecoveryRequests() });
      }

      const recoveryStatusMatch = url.pathname.match(/^\/auth\/recovery\/requests\/([^/]+)\/status$/);
      if (req.method === "POST" && recoveryStatusMatch) {
        rbac.assert(actor, "auth.recovery.manage_placeholder", {
          correlationId,
          resourceType: "auth_recovery_request",
          resourceId: recoveryStatusMatch[1]
        });
        const body = await readJson(req);
        const request = auth.updateRecoveryStatus({
          actor,
          requestId: recoveryStatusMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { request });
      }

      if (req.method === "POST" && url.pathname === "/auth/break-glass/requests") {
        rbac.assert(actor, "break_glass.request", { correlationId });
        const body = await readJson(req);
        const request = auth.createBreakGlassRequest({ actor, ...body, correlationId });
        return send(res, 201, { request });
      }

      if (req.method === "GET" && url.pathname === "/auth/break-glass/requests") {
        rbac.assert(actor, "break_glass.read", { correlationId });
        return send(res, 200, { requests: auth.listBreakGlassRequests() });
      }

      if (req.method === "GET" && url.pathname === "/phantom/boundary") {
        return send(res, 200, { boundary: phantom.getBoundary({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/subscription/plans") {
        return send(res, 200, { plans: subscriptions.listPlans({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/subscription/plans") {
        const body = await readJson(req);
        const plan = subscriptions.createPlan({ actor, ...body, correlationId });
        return send(res, 201, { plan });
      }

      if (req.method === "POST" && url.pathname === "/phantom/boundary/status") {
        const body = await readJson(req);
        const boundary = phantom.updateBoundaryStatus({ actor, ...body, correlationId });
        return send(res, 200, { boundary });
      }

      if (req.method === "GET" && url.pathname === "/phantom/capabilities") {
        return send(res, 200, { capabilities: phantom.listCapabilities({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/phantom/capabilities") {
        const body = await readJson(req);
        const capability = phantom.createCapability({ actor, ...body, correlationId });
        return send(res, 201, { capability });
      }

      const phantomCapabilityStatusMatch = url.pathname.match(/^\/phantom\/capabilities\/([^/]+)\/status$/);
      if (req.method === "POST" && phantomCapabilityStatusMatch) {
        const body = await readJson(req);
        const capability = phantom.updateCapabilityStatus({
          actor,
          capabilityId: phantomCapabilityStatusMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { capability });
      }

      if (req.method === "GET" && url.pathname === "/phantom/approvals") {
        return send(res, 200, { approvals: phantom.listApprovals({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/phantom/approvals") {
        const body = await readJson(req);
        const approval = phantom.createApproval({ actor, ...body, correlationId });
        return send(res, 201, { approval });
      }

      const phantomApprovalStatusMatch = url.pathname.match(/^\/phantom\/approvals\/([^/]+)\/status$/);
      if (req.method === "POST" && phantomApprovalStatusMatch) {
        const body = await readJson(req);
        const approval = phantom.updateApprovalStatus({
          actor,
          approvalId: phantomApprovalStatusMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { approval });
      }

      if (req.method === "GET" && url.pathname === "/phantom/risks") {
        return send(res, 200, { risks: phantom.listRisks({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/phantom/risks") {
        const body = await readJson(req);
        const risk = phantom.createRisk({ actor, ...body, correlationId });
        return send(res, 201, { risk });
      }

      const phantomRiskStatusMatch = url.pathname.match(/^\/phantom\/risks\/([^/]+)\/status$/);
      if (req.method === "POST" && phantomRiskStatusMatch) {
        const body = await readJson(req);
        const risk = phantom.updateRiskStatus({
          actor,
          riskId: phantomRiskStatusMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { risk });
      }

      if (req.method === "GET" && url.pathname === "/phantom/policy-templates") {
        return send(res, 200, { templates: phantom.listPolicyTemplates({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/phantom/policy-templates") {
        const body = await readJson(req);
        const template = phantom.createPolicyTemplate({ actor, ...body, correlationId });
        return send(res, 201, { template });
      }

      if (req.method === "GET" && url.pathname === "/phantom/packages") {
        return send(res, 200, { packages: phantom.listPackages({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/phantom/packages") {
        const body = await readJson(req);
        const packageRecord = phantom.createPackage({ actor, ...body, correlationId });
        return send(res, 201, { package: packageRecord });
      }

      const phantomPackageStageMatch = url.pathname.match(/^\/phantom\/packages\/([^/]+)\/stage$/);
      if (req.method === "POST" && phantomPackageStageMatch) {
        const body = await readJson(req);
        const packageRecord = phantom.updatePackageStage({
          actor,
          packageId: phantomPackageStageMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { package: packageRecord });
      }

      if (req.method === "GET" && url.pathname === "/phantom/evidence-bundles") {
        return send(res, 200, { bundles: phantom.listEvidenceBundles({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/phantom/evidence-bundles") {
        const body = await readJson(req);
        const bundle = phantom.createEvidenceBundle({ actor, ...body, correlationId });
        return send(res, 201, { bundle });
      }

      if (req.method === "GET" && url.pathname === "/phantom/approval-packs") {
        return send(res, 200, { packs: phantom.listApprovalPacks({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/phantom/approval-packs") {
        const body = await readJson(req);
        const pack = phantom.createApprovalPack({ actor, ...body, correlationId });
        return send(res, 201, { pack });
      }

      if (req.method === "GET" && url.pathname === "/phantom/readiness") {
        return send(res, 200, { evaluations: phantom.listReadinessEvaluations({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/phantom/readiness/evaluate") {
        const body = await readJson(req);
        const evaluation = phantom.evaluateReadiness({ actor, ...body, correlationId });
        return send(res, 201, { evaluation });
      }

      if (req.method === "GET" && url.pathname === "/phantom/simulations") {
        return send(res, 200, { runs: phantom.listSimulationRuns({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/phantom/simulations") {
        const body = await readJson(req);
        const run = phantom.runSimulation({ actor, ...body, correlationId });
        return send(res, 201, { run });
      }

      if (req.method === "GET" && url.pathname === "/phantom/assignment-plans") {
        return send(res, 200, { plans: phantom.listAssignmentPlans({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/phantom/assignment-plans") {
        const body = await readJson(req);
        const plan = phantom.createAssignmentPlan({ actor, ...body, correlationId });
        return send(res, 201, { plan });
      }

      if (req.method === "GET" && url.pathname === "/phantom/review-board") {
        return send(res, 200, { items: phantom.listReviewBoardItems({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/phantom/review-board") {
        const body = await readJson(req);
        const item = phantom.createReviewBoardItem({ actor, ...body, correlationId });
        return send(res, 201, { item });
      }

      const phantomReviewBoardStatusMatch = url.pathname.match(/^\/phantom\/review-board\/([^/]+)\/status$/);
      if (req.method === "POST" && phantomReviewBoardStatusMatch) {
        const body = await readJson(req);
        const item = phantom.updateReviewBoardStatus({
          actor,
          itemId: phantomReviewBoardStatusMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { item });
      }

      const phantomReviewBoardAckMatch = url.pathname.match(/^\/phantom\/review-board\/([^/]+)\/ack$/);
      if (req.method === "POST" && phantomReviewBoardAckMatch) {
        const body = await readJson(req);
        const item = phantom.acknowledgeReviewBoardOwner({
          actor,
          itemId: phantomReviewBoardAckMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { item });
      }

      const phantomCoverageMatch = url.pathname.match(/^\/phantom\/packages\/([^/]+)\/evidence-coverage$/);
      if (req.method === "GET" && phantomCoverageMatch) {
        const coverage = phantom.evidenceCoverage({
          actor,
          packageId: phantomCoverageMatch[1],
          correlationId
        });
        return send(res, 200, { coverage });
      }

      if (req.method === "GET" && url.pathname === "/phantom/policy-simulations") {
        return send(res, 200, { simulations: phantom.listPolicySimulations({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/phantom/policy-simulations") {
        const body = await readJson(req);
        const simulation = phantom.runPolicySimulation({ actor, ...body, correlationId });
        return send(res, 201, { simulation });
      }

      if (req.method === "GET" && url.pathname === "/phantom/exceptions") {
        return send(res, 200, { exceptions: phantom.listExceptions({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/phantom/exceptions") {
        const body = await readJson(req);
        const exception = phantom.createException({ actor, ...body, correlationId });
        return send(res, 201, { exception });
      }

      if (req.method === "GET" && url.pathname === "/phantom/audit-correlation") {
        const summary = phantom.auditCorrelation({
          actor,
          packageId: url.searchParams.get("packageId"),
          correlationId
        });
        return send(res, 200, { summary });
      }

      if (req.method === "GET" && url.pathname === "/audit/events") {
        rbac.assert(actor, "audit.read", { correlationId });
        return send(res, 200, { events: audit.list() });
      }

      if (req.method === "GET" && url.pathname === "/monitoring/events") {
        rbac.assert(actor, "audit.read", { correlationId });
        return send(res, 200, {
          events: monitoring.list({
            eventType: url.searchParams.get("eventType"),
            tenantId: url.searchParams.get("tenantId"),
            operatorId: url.searchParams.get("operatorId")
          })
        });
      }

      if (req.method === "GET" && url.pathname === "/monitoring/blue-team-dashboard") {
        return send(res, 200, {
          dashboard: monitoring.blueTeamDashboard({
            actor,
            auditEvents: audit.list(),
            cdrDecisions: cdr.listDecisions(),
            cdrEvents: cdr.listMonitoringEvents(),
            operators: operators.list({ actor, correlationId }),
            correlationId
          })
        });
      }

      if (req.method === "POST" && url.pathname === "/monitoring/health-status") {
        const body = await readJson(req);
        const event = monitoring.recordHealthStatus({ actor, ...body, correlationId });
        return send(res, 201, { event });
      }

      if (req.method === "POST" && url.pathname === "/monitoring/signals") {
        const body = await readJson(req);
        const event = monitoring.recordSignal({ actor, ...body, correlationId });
        return send(res, 201, { event });
      }

      if (req.method === "GET" && url.pathname === "/incidents") {
        rbac.assert(actor, "incident.manage", { correlationId });
        return send(res, 200, { incidents: incidents.list() });
      }

      if (req.method === "POST" && url.pathname === "/incidents/from-alert") {
        const body = await readJson(req);
        const incident = incidents.createFromAlert({ actor, ...body, correlationId });
        return send(res, 201, { incident });
      }

      const incidentTimelineMatch = url.pathname.match(/^\/incidents\/([^/]+)\/timeline$/);
      if (req.method === "POST" && incidentTimelineMatch) {
        const body = await readJson(req);
        const incident = incidents.addTimelineEntry({
          actor,
          incidentId: incidentTimelineMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { incident });
      }

      if (req.method === "POST" && url.pathname === "/tenants") {
        const body = await readJson(req);
        const tenant = tenants.create({ actor, ...body, correlationId });
        subscriptions.ensureForTenant({ actor, tenant, correlationId });
        return send(res, 201, { tenant });
      }

      if (req.method === "GET" && url.pathname === "/tenants") {
        return send(res, 200, { tenants: tenants.list({ actor, correlationId }) });
      }

      const tenantSubscriptionMatch = url.pathname.match(/^\/tenants\/([^/]+)\/subscription$/);
      if (req.method === "GET" && tenantSubscriptionMatch) {
        const subscription = subscriptions.getTenantSubscription({
          actor,
          tenantId: tenantSubscriptionMatch[1],
          correlationId
        });
        return send(res, 200, { subscription });
      }

      if (req.method === "POST" && tenantSubscriptionMatch) {
        const body = await readJson(req);
        const subscription = subscriptions.updateTenantSubscription({
          actor,
          tenantId: tenantSubscriptionMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { subscription });
      }

      const tenantAddonsMatch = url.pathname.match(/^\/tenants\/([^/]+)\/subscription\/addons$/);
      if (req.method === "POST" && tenantAddonsMatch) {
        const body = await readJson(req);
        const subscription = subscriptions.updateAddons({
          actor,
          tenantId: tenantAddonsMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { subscription });
      }

      const tenantBillingMatch = url.pathname.match(/^\/tenants\/([^/]+)\/billing-state$/);
      if (req.method === "POST" && tenantBillingMatch) {
        const body = await readJson(req);
        const subscription = subscriptions.updateBillingState({
          actor,
          tenantId: tenantBillingMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { subscription });
      }

      if (req.method === "POST" && url.pathname === "/operators") {
        const body = await readJson(req);
        if (body.liveBaseline?.enabled === true) {
          auth.requireFreshStepUp(actor, "operator.live_baseline.create", {
            correlationId,
            resourceType: "live_execution_request"
          });
        }
        const operator = operators.create({ actor, ...body, correlationId });
        let provisioningDraft = operatorProvisioning.createDraft({
          actor,
          operatorId: operator.id,
          requestedTemplates: body.requestedTemplates,
          autoCreated: true,
          correlationId
        });
        let baselineProvisioning = null;
        if (provisioningDraft.blockers.length === 0) {
          provisioningDraft = operatorProvisioning.createLocalLabVpsSet({
            actor,
            pipelineId: provisioningDraft.id,
            correlationId
          });
          baselineProvisioning = {
            status: "local_lab_ready",
            mode: "automatic_on_operator_create",
            vps: provisioningDraft.localLab.vps,
            firecrackerPlan: provisioningDraft.firecrackerPlan,
            liveCloudMutationAllowed: false,
            productionExecutionAllowed: false,
            humanGateRequiredForLive: true
          };
        }
        let liveBaseline = null;
        if (body.liveBaseline?.enabled === true) {
          const userDataByRole = buildLiveBaselineUserData({
            userDataByRole: body.liveBaseline.userDataByRole || {},
            gatewayOptions: body.liveBaseline.gatewayOptions || {}
          });
          const artifactSummary = liveBaselineArtifactSummary(body.liveBaseline.gatewayOptions || {});
          const approval = approvals.createApproval({
            actor,
            operatorId: operator.id,
            resourceType: "live_cloud_baseline",
            reasonCode: body.liveBaseline.reasonCode || "operator_create_live_baseline",
            reviewers: body.liveBaseline.reviewers || ["global_super_admin"],
            evidenceRefs: body.liveBaseline.evidenceRefs || ["operator-create://live-baseline"],
            blockers: [],
            correlationId
          });
          const approved = approvals.updateApprovalStatus({
            actor,
            approvalId: approval.id,
            status: "approved_for_execution",
            note: "Fresh admin step-up approved live G1/G2/WORKLOAD baseline during operator creation.",
            correlationId
          });
          const request = await liveExecution.createProviderVpsSet({
            actor,
            providerKey: body.liveBaseline.providerKey || "hetzner",
            providerId: body.liveBaseline.providerId,
            operatorId: operator.id,
            region: body.liveBaseline.region || "fsn1",
            approvalId: approved.id,
            idempotencyKey: req.headers["idempotency-key"] || body.liveBaseline.idempotencyKey || `operator-live-${operator.id}`,
            liveConfirmed: body.liveBaseline.liveConfirmed === true,
            serverType: body.liveBaseline.serverType || "cx22",
            serverTypesByRole: body.liveBaseline.serverTypesByRole || {},
            image: body.liveBaseline.image || "ubuntu-24.04",
            sshKeys: body.liveBaseline.sshKeys || [],
            userDataByRole,
            correlationId
          });
          liveBaseline = {
            mode: "operator_create_live_baseline",
            providerKey: body.liveBaseline.providerKey || "hetzner",
            providerId: body.liveBaseline.providerId,
            region: body.liveBaseline.region || "fsn1",
            approvalId: approved.id,
            request,
            artifacts: artifactSummary,
            productionExecutionAllowed: false,
            rollbackRequired: true
          };
        }
        return send(res, 201, { operator, provisioningDraft, baselineProvisioning, liveBaseline });
      }

      if (req.method === "GET" && url.pathname === "/operators") {
        return send(res, 200, {
          operators: operators.list({
            actor,
            tenantId: url.searchParams.get("tenantId"),
            correlationId
          })
        });
      }

      if (req.method === "GET" && url.pathname === "/operators/disposable-teardown-plans") {
        return send(res, 200, {
          plans: operators.listDisposableTeardownPlans({
            actor,
            operatorId: url.searchParams.get("operatorId"),
            correlationId
          })
        });
      }

      const disposableTeardownPlanMatch = url.pathname.match(/^\/operators\/([^/]+)\/disposable-teardown-plan$/);
      if (req.method === "POST" && disposableTeardownPlanMatch) {
        const body = await readJson(req);
        const plan = operators.createDisposableTeardownPlan({
          actor,
          operatorId: disposableTeardownPlanMatch[1],
          requestedAction: body.requestedAction,
          reason: body.reason,
          body,
          correlationId
        });
        return send(res, 201, { plan });
      }

      const disposableTeardownExecuteMatch = url.pathname.match(/^\/operators\/([^/]+)\/disposable-teardown-execute$/);
      if (req.method === "POST" && disposableTeardownExecuteMatch) {
        const body = await readJson(req);
        const job = operators.executeDisposableTeardown({
          actor,
          operatorId: disposableTeardownExecuteMatch[1],
          planId: body.planId,
          confirmation: body.confirmation,
          reason: body.reason,
          body,
          correlationId
        });
        return send(res, 200, { job });
      }

      const operatorConnectionPathMatch = url.pathname.match(/^\/operators\/([^/]+)\/connection-path$/);
      if (req.method === "GET" && operatorConnectionPathMatch) {
        return send(res, 200, {
          path: operatorPortal.adminConnectionPath({
            actor,
            operatorId: operatorConnectionPathMatch[1],
            terminalMode: url.searchParams.get("terminalMode") || "pixel_grapheneos",
            correlationId
          })
        });
      }

      if (req.method === "GET" && url.pathname === "/router/packages") {
        return send(res, 200, {
          packages: routerReadiness.listPackages({
            actor,
            operatorId: url.searchParams.get("operatorId"),
            correlationId
          })
        });
      }

      const routerPackageMatch = url.pathname.match(/^\/operators\/([^/]+)\/router-package$/);
      if (req.method === "POST" && routerPackageMatch) {
        const body = await readJson(req);
        const routerPackage = routerReadiness.generatePackage({
          actor,
          operatorId: routerPackageMatch[1],
          ...body,
          correlationId
        });
        return send(res, 201, { package: routerPackage });
      }

      if (req.method === "GET" && url.pathname === "/router/postures") {
        return send(res, 200, {
          postures: routerReadiness.listPostures({
            actor,
            operatorId: url.searchParams.get("operatorId"),
            correlationId
          })
        });
      }

      const routerPostureMatch = url.pathname.match(/^\/operators\/([^/]+)\/router-posture$/);
      if (req.method === "POST" && routerPostureMatch) {
        const body = await readJson(req);
        const posture = routerReadiness.validatePosture({
          actor,
          operatorId: routerPostureMatch[1],
          ...body,
          correlationId
        });
        return send(res, 201, { posture });
      }

      if (req.method === "POST" && url.pathname === "/devices") {
        const body = await readJson(req);
        const device = devices.register({ actor, ...body, correlationId });
        return send(res, 201, { device });
      }

      if (req.method === "GET" && url.pathname === "/devices") {
        const list = devices.list({
          actor,
          operatorId: url.searchParams.get("operatorId"),
          type: url.searchParams.get("type"),
          correlationId
        });
        return send(res, 200, { devices: list });
      }

      const deviceAssignMatch = url.pathname.match(/^\/devices\/([^/]+)\/assign$/);
      if (req.method === "POST" && deviceAssignMatch) {
        const body = await readJson(req);
        const device = devices.assign({
          actor,
          deviceId: deviceAssignMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { device });
      }

      const devicePostureMatch = url.pathname.match(/^\/devices\/([^/]+)\/posture$/);
      if (req.method === "POST" && devicePostureMatch) {
        const body = await readJson(req);
        const device = devices.updatePosture({
          actor,
          deviceId: devicePostureMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { device });
      }

      if (req.method === "POST" && url.pathname === "/providers") {
        auth.requireFreshStepUp(actor, "provider.create_with_secret", {
          correlationId,
          resourceType: "provider"
        });
        const body = await readJson(req);
        const provider = providers.create({ actor, ...body, correlationId });
        return send(res, 201, { provider });
      }

      if (req.method === "GET" && url.pathname === "/providers") {
        return send(res, 200, { providers: providers.list({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/providers/eligible") {
        return send(res, 200, {
          providers: providers.listEligible({
            actor,
            capability: url.searchParams.get("capability"),
            country: url.searchParams.get("country"),
            tier: url.searchParams.get("tier"),
            correlationId
          })
        });
      }

      if (req.method === "GET" && url.pathname === "/secrets/backend-status") {
        return send(res, 200, { status: secrets.status({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/secrets/backends") {
        return send(res, 200, { backends: secrets.listBackends({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/secrets/backends") {
        auth.requireFreshStepUp(actor, "secret.backend.configure", {
          correlationId,
          resourceType: "secret"
        });
        const body = await readJson(req);
        const backend = secrets.configureBackend({ actor, ...body, correlationId });
        return send(res, 201, { backend });
      }

      if (req.method === "GET" && url.pathname === "/providers/dry-run/vps-plans") {
        return send(res, 200, {
          plans: providerDryRun.list({
            actor,
            operatorId: url.searchParams.get("operatorId"),
            correlationId
          })
        });
      }

      if (req.method === "POST" && url.pathname === "/providers/dry-run/vps-plan") {
        const body = await readJson(req);
        const plan = providerDryRun.planVps({ actor, ...body, correlationId });
        return send(res, 201, { plan });
      }

      const providerSecretMatch = url.pathname.match(/^\/providers\/([^/]+)\/secret-rotation$/);
      if (req.method === "POST" && providerSecretMatch) {
        auth.requireFreshStepUp(actor, "provider.secret.rotate", {
          correlationId,
          resourceType: "provider",
          resourceId: providerSecretMatch[1]
        });
        const body = await readJson(req);
        const provider = body.externalSecretReference
          ? providers.rotateExternalSecretReference({
            actor,
            providerId: providerSecretMatch[1],
            ...body,
            correlationId
          })
          : providers.rotateSecret({
          actor,
          providerId: providerSecretMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { provider });
      }

      const operatorInventoryMatch = url.pathname.match(/^\/operators\/([^/]+)\/infrastructure-sets$/);
      if (req.method === "GET" && operatorInventoryMatch) {
        const sets = inventory.listForOperator({
          actor,
          operatorId: operatorInventoryMatch[1],
          correlationId
        });
        return send(res, 200, { infrastructureSets: sets });
      }

      if (req.method === "POST" && url.pathname === "/infrastructure/vps-sets") {
        const body = await readJson(req);
        const infrastructureSet = inventory.registerVpsSet({ actor, ...body, correlationId });
        return send(res, 201, { infrastructureSet });
      }

      const infraTransitionMatch = url.pathname.match(/^\/infrastructure\/vps-sets\/([^/]+)\/lifecycle$/);
      if (req.method === "POST" && infraTransitionMatch) {
        const body = await readJson(req);
        const infrastructureSet = inventory.transitionLifecycle({
          actor,
          infrastructureSetId: infraTransitionMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { infrastructureSet });
      }

      const operatorCertificatesMatch = url.pathname.match(/^\/operators\/([^/]+)\/certificates$/);
      if (req.method === "GET" && operatorCertificatesMatch) {
        const certificates = pki.listForOperator({
          actor,
          operatorId: operatorCertificatesMatch[1],
          correlationId
        });
        return send(res, 200, { certificates });
      }

      if (req.method === "POST" && url.pathname === "/certificates") {
        const body = await readJson(req);
        const certificate = pki.issue({ actor, ...body, correlationId });
        return send(res, 201, { certificate });
      }

      const certRotateMatch = url.pathname.match(/^\/certificates\/([^/]+)\/rotate$/);
      if (req.method === "POST" && certRotateMatch) {
        const body = await readJson(req);
        const result = pki.rotate({
          actor,
          certificateId: certRotateMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, result);
      }

      const certRevokeMatch = url.pathname.match(/^\/certificates\/([^/]+)\/revoke$/);
      if (req.method === "POST" && certRevokeMatch) {
        const body = await readJson(req);
        const certificate = pki.revoke({
          actor,
          certificateId: certRevokeMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { certificate });
      }

      if (req.method === "GET" && url.pathname === "/apps") {
        return send(res, 200, { apps: appCatalog.list() });
      }

      if (req.method === "POST" && url.pathname === "/apps") {
        const body = await readJson(req);
        const app = appCatalog.create({ actor, ...body, correlationId });
        return send(res, 201, { app });
      }

      const appApproveMatch = url.pathname.match(/^\/apps\/([^/]+)\/approve$/);
      if (req.method === "POST" && appApproveMatch) {
        const app = appCatalog.approve({ actor, appId: appApproveMatch[1], correlationId });
        return send(res, 200, { app });
      }

      const appBlockMatch = url.pathname.match(/^\/apps\/([^/]+)\/block$/);
      if (req.method === "POST" && appBlockMatch) {
        const body = await readJson(req);
        const app = appCatalog.block({ actor, appId: appBlockMatch[1], ...body, correlationId });
        return send(res, 200, { app });
      }

      if (req.method === "GET" && url.pathname === "/cdr/decisions") {
        return send(res, 200, { decisions: cdr.listDecisions() });
      }

      if (req.method === "POST" && url.pathname === "/cdr/decisions") {
        const body = await readJson(req);
        const decision = cdr.decide({ actor, ...body, correlationId });
        return send(res, 201, { decision });
      }

      if (req.method === "POST" && url.pathname === "/cdr/file-transfers") {
        const body = await readJson(req);
        const transfer = cdr.authorizeTransfer({ actor, ...body, correlationId });
        return send(res, 201, { transfer });
      }

      if (req.method === "GET" && url.pathname === "/cdr/monitoring-events") {
        return send(res, 200, { events: cdr.listMonitoringEvents() });
      }

      if (req.method === "POST" && url.pathname === "/jurisdiction/policies") {
        const body = await readJson(req);
        const policy = jurisdiction.create({ actor, ...body, correlationId });
        return send(res, 201, { policy });
      }

      const jurisdictionRotationMatch = url.pathname.match(/^\/jurisdiction\/policies\/([^/]+)\/rotation-plan$/);
      if (req.method === "POST" && jurisdictionRotationMatch) {
        const body = await readJson(req);
        const rotationPlan = jurisdiction.planRotation({
          actor,
          policyId: jurisdictionRotationMatch[1],
          ...body,
          correlationId
        });
        return send(res, 201, { rotationPlan });
      }

      if (req.method === "POST" && url.pathname === "/matrix/servers") {
        const body = await readJson(req);
        const addonEnabled = body.addonEnabled === true || subscriptions.canUseAddon({
          tenantId: body.tenantId,
          addon: "matrix_custom_server"
        });
        const server = matrix.create({ actor, ...body, addonEnabled, correlationId });
        return send(res, 201, { server });
      }

      if (req.method === "POST" && url.pathname === "/images/artifacts") {
        const body = await readJson(req);
        const artifact = imageFactory.build({ actor, ...body, correlationId });
        return send(res, 201, { artifact });
      }

      if (req.method === "GET" && url.pathname === "/images/artifacts") {
        const artifacts = imageFactory.list({
          actor,
          operatorId: url.searchParams.get("operatorId"),
          artifactType: url.searchParams.get("artifactType"),
          correlationId
        });
        return send(res, 200, { artifacts });
      }

      if (req.method === "GET" && url.pathname === "/provisioning/approvals") {
        return send(res, 200, {
          approvals: approvals.listApprovals({
            actor,
            operatorId: url.searchParams.get("operatorId"),
            correlationId
          })
        });
      }

      if (req.method === "POST" && url.pathname === "/provisioning/approvals") {
        const body = await readJson(req);
        const approval = approvals.createApproval({ actor, ...body, correlationId });
        return send(res, 201, { approval });
      }

      const approvalStatusMatch = url.pathname.match(/^\/provisioning\/approvals\/([^/]+)\/status$/);
      if (req.method === "POST" && approvalStatusMatch) {
        const body = await readJson(req);
        const approval = approvals.updateApprovalStatus({
          actor,
          approvalId: approvalStatusMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { approval });
      }

      const operatorReadinessMatch = url.pathname.match(/^\/operators\/([^/]+)\/readiness$/);
      if (req.method === "GET" && operatorReadinessMatch) {
        const readiness = approvals.evaluateOperatorReadiness({
          actor,
          operatorId: operatorReadinessMatch[1],
          correlationId
        });
        return send(res, 200, { readiness });
      }

      const operatorReadinessHistoryMatch = url.pathname.match(/^\/operators\/([^/]+)\/readiness\/history$/);
      if (req.method === "GET" && operatorReadinessHistoryMatch) {
        const readiness = approvals.listReadiness({
          actor,
          operatorId: operatorReadinessHistoryMatch[1],
          correlationId
        });
        return send(res, 200, { readiness });
      }

      const readinessRecordMatch = url.pathname.match(/^\/readiness\/([^/]+)$/);
      if (req.method === "GET" && readinessRecordMatch) {
        const readiness = approvals.getReadiness({
          actor,
          readinessId: readinessRecordMatch[1],
          correlationId
        });
        return send(res, 200, { readiness });
      }

      if (req.method === "GET" && url.pathname === "/system/status") {
        return send(res, 200, { status: approvals.systemStatus({ actor, correlationId }) });
      }

      if (req.method === "GET" && url.pathname === "/workload/lifecycle") {
        return send(res, 200, {
          lifecycle: approvals.listWorkloadLifecycle({
            actor,
            operatorId: url.searchParams.get("operatorId"),
            correlationId
          })
        });
      }

      const workloadLifecycleMatch = url.pathname.match(/^\/workload\/allocations\/([^/]+)\/lifecycle$/);
      if (req.method === "POST" && workloadLifecycleMatch) {
        const body = await readJson(req);
        const lifecycle = approvals.transitionWorkloadLifecycle({
          actor,
          allocationId: workloadLifecycleMatch[1],
          ...body,
          correlationId
        });
        return send(res, 200, { lifecycle });
      }

      if (req.method === "POST" && url.pathname === "/orchestrator/jobs") {
        auth.requireFreshStepUp(actor, "orchestrator.plan.execute", {
          correlationId,
          resourceType: "orchestrator_job"
        });
        const body = await readJson(req);
        approvals.assertExecutionApproved({
          actor,
          planId: body.planId,
          approvalId: body.approvalId,
          correlationId
        });
        const job = orchestrator.executePlan({
          actor,
          idempotencyKey: req.headers["idempotency-key"] || body.idempotencyKey,
          ...body,
          correlationId
        });
        return send(res, 201, { job });
      }

      if (req.method === "GET" && url.pathname === "/orchestrator/jobs") {
        const jobs = orchestrator.list({
          actor,
          operatorId: url.searchParams.get("operatorId"),
          correlationId
        });
        return send(res, 200, { jobs });
      }

      const planMatch = url.pathname.match(/^\/operators\/([^/]+)\/provisioning-plan$/);
      if (req.method === "POST" && planMatch) {
        const body = await readJson(req);
        const operator = operators.get(planMatch[1]);
        if (operator) {
          subscriptions.assertProvisioningAllowed({ tenantId: operator.tenantId });
        }
        const plan = provisioningPlans.generate({
          actor,
          operatorId: planMatch[1],
          ...body,
          correlationId
        });
        return send(res, 201, { plan });
      }

      const workloadAllocationsMatch = url.pathname.match(/^\/operators\/([^/]+)\/workload-allocations$/);
      if (req.method === "GET" && workloadAllocationsMatch) {
        const allocations = subscriptions.listAllocations({
          actor,
          operatorId: workloadAllocationsMatch[1],
          correlationId
        });
        return send(res, 200, { allocations });
      }

      if (req.method === "POST" && workloadAllocationsMatch) {
        const body = await readJson(req);
        const allocation = subscriptions.createAllocation({
          actor,
          operatorId: workloadAllocationsMatch[1],
          ...body,
          correlationId
        });
        return send(res, 201, { allocation });
      }

      const workloadQuoteMatch = url.pathname.match(/^\/operators\/([^/]+)\/workload-allocations\/quote$/);
      if (req.method === "POST" && workloadQuoteMatch) {
        const body = await readJson(req);
        const decision = subscriptions.quoteAllocation({
          actor,
          operatorId: workloadQuoteMatch[1],
          ...body,
          correlationId
        });
        return send(res, 201, { decision });
      }

      const placementPlanMatch = url.pathname.match(/^\/operators\/([^/]+)\/microvm-placement-plan$/);
      if (req.method === "POST" && placementPlanMatch) {
        const body = await readJson(req);
        const placementPlan = subscriptions.planPlacement({
          actor,
          operatorId: placementPlanMatch[1],
          ...body,
          correlationId
        });
        return send(res, 201, { placementPlan });
      }

      if (req.method === "GET" && url.pathname === "/subscription/quota-decisions") {
        return send(res, 200, { decisions: subscriptions.listQuotaDecisions({ actor, correlationId }) });
      }

      if (req.method === "GET" && planMatch) {
        const plans = provisioningPlans.list({
          actor,
          operatorId: planMatch[1],
          correlationId
        });
        return send(res, 200, { plans });
      }

      return send(res, 404, { error: { code: "not_found", message: "Route not found" } });
    } catch (error) {
      if (error instanceof AppError) {
        return send(res, error.status, {
          error: {
            code: error.code,
            message: error.message,
            details: error.details
          }
        });
      }
      return send(res, 500, {
        error: {
          code: "internal_error",
          message: error.message
        }
      });
    }
  }

  return {
    services,
    handle,
    listen(port = 0, host) {
      const server = createServer(handle);
      return new Promise((resolve) => {
        server.listen(port, host, () => resolve(server));
      });
    },
    close() {
      if (store?.close) {
        store.close();
      }
    }
  };
}
