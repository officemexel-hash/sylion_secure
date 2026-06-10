import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../src/modules/audit/auditService.js";
import { RbacService } from "../src/modules/rbac/rbacService.js";
import { EntitlementService } from "../src/modules/entitlements/entitlementService.js";
import { JurisdictionPolicyService } from "../src/modules/jurisdiction/jurisdictionPolicyService.js";
import { MatrixServerService } from "../src/modules/matrix/matrixServerService.js";
import { ROLES, TIERS } from "../src/domain/constants.js";

function buildServices() {
  const audit = new AuditService();
  const rbac = new RbacService({ audit });
  const entitlements = new EntitlementService({ audit });
  return {
    audit,
    rbac,
    entitlements,
    jurisdiction: new JurisdictionPolicyService({ audit, rbac, entitlements }),
    matrix: new MatrixServerService({ audit, rbac, entitlements }),
    actor: { id: "admin_global", role: ROLES.GLOBAL_SUPER_ADMIN }
  };
}

test("jurisdiction policy blocks rotation scopes above STANDARD tier", () => {
  const { jurisdiction, actor } = buildServices();

  assert.throws(
    () =>
      jurisdiction.create({
        actor,
        tenantId: "tenant_1",
        operatorId: "op_1",
        tier: TIERS.STANDARD,
        name: "Standard EU rotation",
        allowedProviders: ["hetzner"],
        allowedRegions: ["fsn1"],
        rotationFrequency: "manual",
        rotationScopes: ["session", "all_3_vps"]
      }),
    /Rotation scope exceeds tier entitlement/
  );
});

test("jurisdiction rotation plan marks all_3_vps as approval required", () => {
  const { jurisdiction, actor } = buildServices();
  const policy = jurisdiction.create({
    actor,
    tenantId: "tenant_1",
    operatorId: "op_1",
    tier: TIERS.SOVEREIGN,
    name: "Sovereign full rotation",
    allowedProviders: ["hetzner", "ovh"],
    allowedRegions: ["fsn1", "waw"],
    rotationFrequency: "scheduled",
    rotationScopes: ["all_3_vps", "provider", "region", "certificates"]
  });

  const plan = jurisdiction.planRotation({
    actor,
    policyId: policy.id,
    requestedScopes: ["all_3_vps", "certificates"]
  });

  assert.equal(plan.approvalRequired, true);
  assert.deepEqual(
    plan.steps.map((step) => step.scope),
    ["all_3_vps", "certificates"]
  );
});

test("matrix server requires paid add-on", () => {
  const { matrix, actor } = buildServices();

  assert.throws(
    () =>
      matrix.create({
        actor,
        tenantId: "tenant_1",
        tier: TIERS.PRO,
        addonEnabled: false,
        mode: "dedicated_tenant",
        provider: "hetzner",
        region: "fsn1"
      }),
    /Matrix add-on is not enabled/
  );
});

test("matrix dedicated operator server can be created when add-on is enabled", () => {
  const { matrix, actor } = buildServices();
  const server = matrix.create({
    actor,
    tenantId: "tenant_1",
    operatorId: "op_1",
    tier: TIERS.SOVEREIGN,
    addonEnabled: true,
    mode: "dedicated_operator",
    provider: "ovh",
    region: "waw",
    federationEnabled: false
  });

  assert.equal(server.mode, "dedicated_operator");
  assert.equal(server.health, "provisioning");
  assert.equal(server.certificateStatus, "pending_issue");
});
