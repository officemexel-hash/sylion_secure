import { createServer } from "node:http";
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

function bearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

export function createApp() {
  const audit = new AuditService();
  const auth = new AuthService({ audit });
  const rbac = new RbacService({ audit });
  const entitlements = new EntitlementService({ audit });
  const tenants = new TenantService({ audit, rbac, entitlements });
  const operators = new OperatorService({ audit, rbac, entitlements, tenants });
  const provisioningPlans = new ProvisioningPlanService({ audit, rbac, entitlements, operators });
  const appCatalog = new AppCatalogService({ audit, rbac });
  const cdr = new CdrService({ audit, appCatalog });
  const monitoring = new MonitoringService({ audit, rbac });
  const incidents = new IncidentService({ audit, rbac, monitoring });
  const secrets = new SecretManagerService({ audit, rbac });
  const providers = new ProviderRegistryService({ audit, rbac, secrets });
  const inventory = new InventoryService({ audit, rbac, operators });
  const pki = new PkiService({ audit, rbac, operators, inventory });
  const jurisdiction = new JurisdictionPolicyService({ audit, rbac, entitlements });
  const matrix = new MatrixServerService({ audit, rbac, entitlements });
  const devices = new DeviceInventoryService({ audit, rbac, operators });
  const imageFactory = new ImageFactoryService({ audit, rbac, devices, appCatalog });
  const orchestrator = new OrchestratorService({
    audit,
    rbac,
    provisioningPlans,
    inventory,
    pki,
    imageFactory,
    devices,
    monitoring
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

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { status: "ok", service: "admin-api" });
      }

      if (req.method === "POST" && url.pathname === "/auth/login") {
        const body = await readJson(req);
        const session = auth.login({ ...body, correlationId });
        return send(res, 200, { session });
      }

      const actor = auth.actorFromToken(bearerToken(req));

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

      if (req.method === "POST" && url.pathname === "/operators") {
        const body = await readJson(req);
        const operator = operators.create({ actor, ...body, correlationId });
        return send(res, 201, { operator });
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
        const body = await readJson(req);
        const provider = providers.create({ actor, ...body, correlationId });
        return send(res, 201, { provider });
      }

      if (req.method === "GET" && url.pathname === "/providers") {
        return send(res, 200, { providers: providers.list({ actor, correlationId }) });
      }

      const providerSecretMatch = url.pathname.match(/^\/providers\/([^/]+)\/secret-rotation$/);
      if (req.method === "POST" && providerSecretMatch) {
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
    }
  };
}
