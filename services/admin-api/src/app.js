import { createServer } from "node:http";
import { AuditService } from "./modules/audit/auditService.js";
import { AuthService } from "./modules/auth/authService.js";
import { RbacService } from "./modules/rbac/rbacService.js";
import { EntitlementService } from "./modules/entitlements/entitlementService.js";
import { TenantService } from "./modules/tenants/tenantService.js";
import { OperatorService } from "./modules/operators/operatorService.js";
import { ProvisioningPlanService } from "./modules/provisioning/provisioningPlanService.js";
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

  const services = { audit, auth, rbac, entitlements, tenants, operators, provisioningPlans };

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

