import { validationError } from "../../lib/errors.js";
import { newId, requireCorrelationId } from "../../lib/id.js";
import { PersistentMap } from "../../storage/persistentMap.js";

export class OrchestratorService {
  constructor({ audit, rbac, provisioningPlans, inventory, pki, imageFactory, devices, monitoring, store = null }) {
    this.audit = audit;
    this.rbac = rbac;
    this.provisioningPlans = provisioningPlans;
    this.inventory = inventory;
    this.pki = pki;
    this.imageFactory = imageFactory;
    this.devices = devices;
    this.monitoring = monitoring;
    this.jobs = new PersistentMap({ store, collection: "orchestrator_jobs" });
    this.idempotency = new Map();
    for (const job of this.jobs.values()) {
      if (job.idempotencyKey) {
        this.idempotency.set(job.idempotencyKey, job.id);
      }
    }
  }

  executePlan({ actor, planId, provider, region, imageRef = "image://sylion/base/dev", pixelDeviceId = null, routerDeviceId = null, idempotencyKey, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "orchestrator.plan.execute", { correlationId: corr });
    if (!idempotencyKey) {
      throw validationError("idempotencyKey is required for plan execution");
    }
    if (this.idempotency.has(idempotencyKey)) {
      return this.jobs.get(this.idempotency.get(idempotencyKey));
    }
    const plan = this.provisioningPlans.get(planId);
    if (!plan) {
      throw validationError("Provisioning plan not found", { planId });
    }

    const job = {
      id: newId("job"),
      planId,
      tenantId: plan.tenantId,
      operatorId: plan.operatorId,
      idempotencyKey,
      status: "running",
      steps: [],
      rollbackPlan: [],
      createdAt: new Date().toISOString()
    };
    this.jobs.set(job.id, job);
    this.idempotency.set(idempotencyKey, job.id);

    try {
      this.#step(job, "create_vps_set", "running");
      const infrastructureSet = this.inventory.registerVpsSet({
        actor,
        operatorId: plan.operatorId,
        provider,
        region,
        imageRef,
        certRefs: {
          G1: `cert://pending/${plan.operatorId}/g1`,
          G2: `cert://pending/${plan.operatorId}/g2`,
          WORKLOAD: `cert://pending/${plan.operatorId}/workload`
        },
        vps: [
          { role: "G1", providerResourceId: `${plan.operatorId}-g1-${job.id}` },
          { role: "G2", providerResourceId: `${plan.operatorId}-g2-${job.id}` },
          { role: "WORKLOAD", providerResourceId: `${plan.operatorId}-workload-${job.id}` }
        ],
        lifecycleState: "provisioning",
        correlationId: corr
      });
      this.#step(job, "create_vps_set", "completed", { infrastructureSetId: infrastructureSet.id });
      job.rollbackPlan.push({ action: "retire_vps_set", infrastructureSetId: infrastructureSet.id, approvalRequired: true });

      this.#step(job, "issue_certificates", "running");
      const certificates = ["G1", "G2", "WORKLOAD"].map((role, index) => this.pki.issue({
        actor,
        operatorId: plan.operatorId,
        subjectType: role,
        subjectRef: infrastructureSet.vps[index].providerResourceId,
        serial: `${job.id}-${role}-001`,
        certificateRef: `cert://${plan.operatorId}/${role.toLowerCase()}/${job.id}`,
        caRef: "ca://sylion/dev",
        infrastructureSetId: infrastructureSet.id,
        vpsRole: role,
        correlationId: corr
      }));
      this.#step(job, "issue_certificates", "completed", { certificateIds: certificates.map((cert) => cert.id) });
      job.rollbackPlan.push(...certificates.map((cert) => ({ action: "revoke_certificate", certificateId: cert.id, approvalRequired: true })));

      this.#step(job, "build_artifacts", "running");
      const artifacts = [];
      if (pixelDeviceId) {
        artifacts.push(this.imageFactory.build({
          actor,
          artifactType: "pixel_grapheneos_profile",
          operatorId: plan.operatorId,
          tenantId: plan.tenantId,
          sourceRef: "source://grapheneos/operator-profile",
          policy: { storesOperationalData: false, thinClientOnly: true },
          deviceId: pixelDeviceId,
          version: "0.1.0",
          correlationId: corr
        }));
      }
      if (routerDeviceId) {
        artifacts.push(this.imageFactory.build({
          actor,
          artifactType: "puli_ax_router_config",
          operatorId: plan.operatorId,
          tenantId: plan.tenantId,
          sourceRef: "source://openwrt/puli-ax-config",
          policy: { ipsec: "ikev2", killSwitch: "nftables_pre_vpn", dnsThroughTunnelOnly: true },
          deviceId: routerDeviceId,
          certificateRef: certificates[0].certificateRef,
          version: "0.1.0",
          correlationId: corr
        }));
      }
      for (const workload of plan.workloads) {
        artifacts.push(this.imageFactory.build({
          actor,
          artifactType: "microvm_template",
          operatorId: plan.operatorId,
          tenantId: plan.tenantId,
          sourceRef: `source://workloads/${workload.appName}`,
          policy: { isolation: "firecracker_microvm", cdrRequired: true },
          version: "0.1.0",
          correlationId: corr
        }));
      }
      this.#step(job, "build_artifacts", "completed", { artifactIds: artifacts.map((artifact) => artifact.id) });

      this.#step(job, "activate_monitoring", "running");
      this.monitoring.recordHealthStatus({
        actor,
        tenantId: plan.tenantId,
        operatorId: plan.operatorId,
        resource: { id: infrastructureSet.id, kind: "infrastructure_set" },
        status: "healthy",
        details: { detector: "orchestrator", evidenceRef: `job://${job.id}` },
        correlationId: corr
      });
      this.#step(job, "activate_monitoring", "completed");

      const completedInfrastructure = this.inventory.transitionLifecycle({
        actor,
        infrastructureSetId: infrastructureSet.id,
        lifecycleState: "active",
        correlationId: corr
      });

      job.status = "completed";
      job.result = {
        infrastructureSetId: completedInfrastructure.id,
        certificateIds: certificates.map((cert) => cert.id),
        artifactIds: artifacts.map((artifact) => artifact.id)
      };
      job.completedAt = new Date().toISOString();
      this.jobs.set(job.id, job);
      this.audit.record({
        actorId: actor.id,
        action: "orchestrator.job.completed",
        resourceType: "orchestrator_job",
        resourceId: job.id,
        tenantId: plan.tenantId,
        operatorId: plan.operatorId,
        idempotencyKey,
        correlationId: corr,
        newValue: job
      });
      return job;
    } catch (error) {
      job.status = "failed";
      job.error = { message: error.message, code: error.code || "unknown" };
      job.failedAt = new Date().toISOString();
      this.jobs.set(job.id, job);
      this.audit.record({
        actorId: actor.id,
        action: "orchestrator.job.failed",
        resourceType: "orchestrator_job",
        resourceId: job.id,
        tenantId: plan.tenantId,
        operatorId: plan.operatorId,
        idempotencyKey,
        correlationId: corr,
        result: "failed",
        newValue: job
      });
      throw error;
    }
  }

  get(jobId) {
    return this.jobs.get(jobId);
  }

  list({ actor, operatorId = null, correlationId }) {
    const corr = requireCorrelationId(correlationId);
    this.rbac.assert(actor, "orchestrator.job.read", { operatorId, correlationId: corr });
    return [...this.jobs.values()].filter((job) => !operatorId || job.operatorId === operatorId);
  }

  #step(job, name, status, output = null) {
    const existing = job.steps.find((step) => step.name === name && step.status === "running");
    if (existing && status !== "running") {
      existing.status = status;
      existing.output = output;
      existing.completedAt = new Date().toISOString();
      return existing;
    }
    const step = {
      id: newId("job_step"),
      name,
      status,
      output,
      createdAt: new Date().toISOString()
    };
    job.steps.push(step);
    return step;
  }
}
