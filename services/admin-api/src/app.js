import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AuditService } from "./modules/audit/auditService.js";
import { AuthService } from "./modules/auth/authService.js";
import { RbacService } from "./modules/rbac/rbacService.js";
import { EntitlementService } from "./modules/entitlements/entitlementService.js";
import { TenantService } from "./modules/tenants/tenantService.js";
import { OperatorService } from "./modules/operators/operatorService.js";
import { ProvisioningPlanService } from "./modules/provisioning/provisioningPlanService.js";
import { AppCatalogService } from "./modules/apps/appCatalogService.js";
import { CdrService } from "./modules/cdr/cdrService.js";
import { MonitoringService } from "./modules/monitoring/monitoringService.js";
import { IncidentService } from "./modules/incidents/incidentService.js";
import { SecretManagerService } from "./modules/secrets/secretManagerService.js";
import { ProviderRegistryService } from "./modules/providers/providerRegistryService.js";
import { InventoryService } from "./modules/inventory/inventoryService.js";
import { PkiService } from "./modules/pki/pkiService.js";
import { JurisdictionPolicyService } from "./modules/jurisdiction/jurisdictionPolicyService.js";
import { MatrixServerService } from "./modules/matrix/matrixServerService.js";
import { DeviceInventoryService } from "./modules/devices/deviceInventoryService.js";
import { ImageFactoryService } from "./modules/images/imageFactoryService.js";
import { OrchestratorService } from "./modules/orchestrator/orchestratorService.js";
import { AppError } from "./lib/errors.js";

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

const WEB_ROOT = resolve(fileURLToPath(new URL("../../../apps/admin-web/", import.meta.url)));
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

export function createApp({ store = null, authOptions = {} } = {}) {
  const audit = new AuditService({ store });
  const auth = new AuthService({ audit, store, ...authOptions });
  const rbac = new RbacService({ audit });
  const entitlements = new EntitlementService({ audit });
  const tenants = new TenantService({ audit, rbac, entitlements, store });
  const operators = new OperatorService({ audit, rbac, entitlements, tenants, store });
  const provisioningPlans = new ProvisioningPlanService({ audit, rbac, entitlements, operators, store });
  const appCatalog = new AppCatalogService({ audit, rbac, store });
  const cdr = new CdrService({ audit, appCatalog, store });
  const monitoring = new MonitoringService({ audit, rbac, store });
  const incidents = new IncidentService({ audit, rbac, monitoring, store });
  const secrets = new SecretManagerService({ audit, rbac, store });
  const providers = new ProviderRegistryService({ audit, rbac, secrets, store });
  const inventory = new InventoryService({ audit, rbac, operators, store });
  const pki = new PkiService({ audit, rbac, operators, inventory, store });
  const jurisdiction = new JurisdictionPolicyService({ audit, rbac, entitlements, store });
  const matrix = new MatrixServerService({ audit, rbac, entitlements, store });
  const devices = new DeviceInventoryService({ audit, rbac, operators, store });
  const imageFactory = new ImageFactoryService({ audit, rbac, devices, appCatalog, store });
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

  const services = {
    audit,
    auth,
    rbac,
    entitlements,
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
    orchestrator
  };

  async function handle(req, res) {
    try {
      const url = new URL(req.url, "http://localhost");
      const correlationId = req.headers["x-correlation-id"];

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/admin" || url.pathname.startsWith("/admin/"))) {
        if (await serveAdminWeb(url, res)) {
          return;
        }
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

      if (req.method === "POST" && url.pathname === "/auth/logout") {
        return send(res, 200, auth.logout({ actor, correlationId }));
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
        return send(res, 201, { tenant });
      }

      if (req.method === "GET" && url.pathname === "/tenants") {
        return send(res, 200, { tenants: tenants.list({ actor, correlationId }) });
      }

      if (req.method === "POST" && url.pathname === "/operators") {
        const body = await readJson(req);
        const operator = operators.create({ actor, ...body, correlationId });
        return send(res, 201, { operator });
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

      const providerSecretMatch = url.pathname.match(/^\/providers\/([^/]+)\/secret-rotation$/);
      if (req.method === "POST" && providerSecretMatch) {
        auth.requireFreshStepUp(actor, "provider.secret.rotate", {
          correlationId,
          resourceType: "provider",
          resourceId: providerSecretMatch[1]
        });
        const body = await readJson(req);
        const provider = providers.rotateSecret({
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
        const server = matrix.create({ actor, ...body, correlationId });
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

      if (req.method === "POST" && url.pathname === "/orchestrator/jobs") {
        auth.requireFreshStepUp(actor, "orchestrator.plan.execute", {
          correlationId,
          resourceType: "orchestrator_job"
        });
        const body = await readJson(req);
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
        const plan = provisioningPlans.generate({
          actor,
          operatorId: planMatch[1],
          ...body,
          correlationId
        });
        return send(res, 201, { plan });
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
    listen(port = 0) {
      const server = createServer(handle);
      return new Promise((resolve) => {
        server.listen(port, () => resolve(server));
      });
    },
    close() {
      if (store?.close) {
        store.close();
      }
    }
  };
}
