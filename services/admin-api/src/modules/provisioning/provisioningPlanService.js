import { RESOURCE_TYPES } from "../../domain/constants.js";
import { notFound } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";

export class ProvisioningPlanService {
  constructor({ audit, rbac, entitlements, operators }) {
    this.audit = audit;
    this.rbac = rbac;
    this.entitlements = entitlements;
    this.operators = operators;
    this.plans = new Map();
  }

  generate({ actor, operatorId, requestedApps = [], jurisdictionPolicy = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "provisioning.plan.generate", { operatorId, correlationId: corr });

    const operator = this.operators.get(operatorId);
    if (!operator) {
      throw notFound("operator", operatorId);
    }

    this.entitlements.assertWorkloadCount(operator.tier, requestedApps.length);
    const tier = this.entitlements.getTier(operator.tier);

    const plan = {
      id: newId("plan"),
      operatorId,
      tenantId: operator.tenantId,
      tier: operator.tier,
      status: "draft",
      baseline: {
        isolatedPerOperator: true,
        vps: [
          { role: "G1", name: `${operator.id}-g1`, shared: false },
          { role: "G2", name: `${operator.id}-g2`, shared: false },
          { role: "WORKLOAD", name: `${operator.id}-workload`, shared: false }
        ],
        router: {
          model: "GL.iNet GL-XE3000 Puli AX",
          qualificationRequired: true
        },
        pixel: {
          profile: "GrapheneOS operator profile",
          storesOperationalData: false
        },
        cdr: {
          mandatory: true,
          rule: "No file ingress/egress without CDR decision."
        }
      },
      workloads: requestedApps.map((app, index) => ({
        id: newId("workload"),
        appName: app,
        environmentNumber: index + 1,
        isolation: "firecracker_microvm",
        cdrRequired: true
      })),
      entitlements: {
        maxWorkloadEnvironments: tier.maxWorkloadEnvironments,
        jurisdictionRotation: tier.jurisdictionRotation,
        matrixAddonAvailable: tier.matrixAddonAvailable
      },
      jurisdictionPolicy,
      humanGates: [
        {
          code: "puli_ax_production_qualification",
          required: true,
          owner: "Infra/Security",
          reason: "Puli AX is selected product router but production baseline requires firmware and failure-mode qualification."
        }
      ],
      approvalsRequired: ["provisioning.approve"],
      createdAt: new Date().toISOString()
    };

    this.plans.set(plan.id, plan);
    this.audit.record({
      actorId: actor.id,
      action: "provisioning_plan.generated",
      resourceType: RESOURCE_TYPES.PROVISIONING_PLAN,
      resourceId: plan.id,
      tenantId: operator.tenantId,
      operatorId,
      correlationId: corr,
      newValue: plan
    });
    return plan;
  }
}

