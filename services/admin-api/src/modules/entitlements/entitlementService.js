import { TIERS } from "../../domain/constants.js";
import { validationError } from "../../lib/errors.js";

export const TIER_LIMITS = Object.freeze({
  [TIERS.PILOT]: {
    maxWorkloadEnvironments: 6,
    maxAppsPerOperator: 3,
    regionCount: 1,
    jurisdictionRotation: "disabled",
    matrixAddonAvailable: true,
    phantomAdminLifecycleAvailable: false,
    cdrMandatory: true
  },
  [TIERS.STANDARD]: {
    maxWorkloadEnvironments: 10,
    maxAppsPerOperator: 5,
    regionCount: 2,
    jurisdictionRotation: "limited_manual",
    matrixAddonAvailable: true,
    phantomAdminLifecycleAvailable: false,
    cdrMandatory: true
  },
  [TIERS.PRO]: {
    maxWorkloadEnvironments: 20,
    maxAppsPerOperator: 10,
    regionCount: 5,
    jurisdictionRotation: "scheduled",
    matrixAddonAvailable: true,
    phantomAdminLifecycleAvailable: true,
    cdrMandatory: true
  },
  [TIERS.PHANTOM]: {
    maxWorkloadEnvironments: 40,
    maxAppsPerOperator: 20,
    regionCount: "custom",
    jurisdictionRotation: "full_policy",
    matrixAddonAvailable: true,
    phantomAdminLifecycleAvailable: true,
    cdrMandatory: true
  },
  [TIERS.SOVEREIGN]: {
    maxWorkloadEnvironments: 60,
    maxAppsPerOperator: 30,
    regionCount: "custom",
    jurisdictionRotation: "full_policy",
    matrixAddonAvailable: true,
    phantomAdminLifecycleAvailable: true,
    cdrMandatory: true
  }
});

export class EntitlementService {
  constructor({ audit }) {
    this.audit = audit;
  }

  getTier(tier) {
    const limits = TIER_LIMITS[tier];
    if (!limits) {
      throw validationError("Unknown subscription tier", { tier });
    }
    return { tier, ...limits };
  }

  assertWorkloadCount(tier, requestedCount) {
    const limits = this.getTier(tier);
    if (requestedCount > limits.maxWorkloadEnvironments) {
      throw validationError("Requested workload count exceeds tier limit", {
        tier,
        requestedCount,
        maxWorkloadEnvironments: limits.maxWorkloadEnvironments
      });
    }
    return true;
  }
}
