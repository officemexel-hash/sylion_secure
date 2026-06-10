import assert from "node:assert/strict";
import test from "node:test";
import { LiveExecutionService } from "../src/modules/live/liveExecutionService.js";

class MemoryStore {
  constructor() {
    this.collections = new Map();
  }

  #collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    return this.collections.get(name);
  }

  listEntries(name) {
    return [...this.#collection(name)].map(([key, value]) => ({ key, value }));
  }

  save(name, key, value) {
    this.#collection(name).set(key, value);
  }

  delete(name, key) {
    this.#collection(name).delete(key);
  }
}

const actor = { id: "admin_perf_live_summary" };
const correlationId = "corr_perf_live_execution_summary";

function createService({ store = null } = {}) {
  return new LiveExecutionService({
    audit: { record() {} },
    rbac: { assert() {} },
    providers: new Map(),
    operators: new Map(),
    approvals: {},
    env: {},
    store
  });
}

// Reference implementation: the exact full-scan filter summary() used before caching.
function fullRecount(service) {
  return [...service.cpuQualifications.values()].filter((item) => item.secretsReleaseAllowed)
    .length;
}

function summaryCount(service) {
  return service.summary({ actor, correlationId }).confidentialReadyHosts;
}

function assertCounterConsistent(service, expected) {
  assert.equal(fullRecount(service), expected);
  assert.equal(summaryCount(service), expected);
}

function qualifyHost(service, { hostId, verified = true, evidenceRefs = ["artifact://cpu/r1"] }) {
  return service.qualifyCpuConfidentialHost({
    actor,
    hostId,
    cpuVendor: "amd",
    cpuModel: "EPYC SEV-SNP-capable",
    confidentialMode: "amd_sev_snp",
    featureFlags: {
      virtualization: true,
      iommu: true,
      tpm2: true,
      secureBoot: true,
      kernelLockdown: true,
      microcodeCurrent: true
    },
    attestation: verified
      ? { verified: true, measurementRef: "attestation://snp/m-001", verifier: "sylion" }
      : { verified: false },
    tierTarget: "SOVEREIGN",
    evidenceRefs,
    correlationId
  });
}

test("cached confidentialReadyHosts matches full recount across qualification mutations", () => {
  const service = createService();
  assertCounterConsistent(service, 0);

  const ready1 = qualifyHost(service, { hostId: "amd-snp-host-01" });
  assert.equal(ready1.secretsReleaseAllowed, true);
  assertCounterConsistent(service, 1);

  const blocked = qualifyHost(service, { hostId: "amd-snp-host-02", verified: false });
  assert.equal(blocked.secretsReleaseAllowed, false);
  assertCounterConsistent(service, 1);

  const noEvidence = qualifyHost(service, { hostId: "amd-snp-host-03", evidenceRefs: [] });
  assert.equal(noEvidence.secretsReleaseAllowed, false);
  assertCounterConsistent(service, 1);

  const ready2 = qualifyHost(service, { hostId: "amd-snp-host-04" });
  assert.equal(ready2.secretsReleaseAllowed, true);
  assertCounterConsistent(service, 2);

  // Update transitions on the same key must keep the cached metric in sync.
  service.cpuQualifications.set(ready1.id, { ...ready1, secretsReleaseAllowed: false });
  assertCounterConsistent(service, 1);

  service.cpuQualifications.set(ready1.id, ready1);
  assertCounterConsistent(service, 2);

  // No-op overwrite (true -> true) must not drift the counter.
  service.cpuQualifications.set(ready2.id, ready2);
  assertCounterConsistent(service, 2);

  // Blocked -> ready transition via overwrite.
  service.cpuQualifications.set(blocked.id, { ...blocked, secretsReleaseAllowed: true });
  assertCounterConsistent(service, 3);

  // Delete paths: ready entry, blocked entry, missing key.
  assert.equal(service.cpuQualifications.delete(ready1.id), true);
  assertCounterConsistent(service, 2);

  assert.equal(service.cpuQualifications.delete(noEvidence.id), true);
  assertCounterConsistent(service, 2);

  assert.equal(service.cpuQualifications.delete("missing-key"), false);
  assertCounterConsistent(service, 2);

  // Hard invariant stays untouched by the cached metric.
  assert.equal(service.summary({ actor, correlationId }).productionExecutionAllowed, false);
});

test("cached confidentialReadyHosts initializes from store hydration in the constructor", () => {
  const store = new MemoryStore();
  const first = createService({ store });

  const ready1 = qualifyHost(first, { hostId: "amd-snp-host-10" });
  qualifyHost(first, { hostId: "amd-snp-host-11" });
  qualifyHost(first, { hostId: "amd-snp-host-12", verified: false });
  assertCounterConsistent(first, 2);

  // Persisted true -> false transition before rehydration.
  first.cpuQualifications.set(ready1.id, { ...ready1, secretsReleaseAllowed: false });
  assertCounterConsistent(first, 1);

  const rehydrated = createService({ store });
  assert.equal(rehydrated.cpuQualifications.size, first.cpuQualifications.size);
  assertCounterConsistent(rehydrated, 1);
  assert.equal(summaryCount(rehydrated), fullRecount(first));
});
