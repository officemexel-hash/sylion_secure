import assert from "node:assert/strict";
import test from "node:test";
import {
  HUMAN_EVIDENCE_SCHEMA_VERSION,
  assertMetadataOnly,
  buildHumanEvidenceSummary,
  deriveOverallResult,
  isProductionSatisfyingResult,
  validateHumanEvidenceSummary
} from "../../../scripts/lib/human-evidence.mjs";

function validSummary(overrides = {}) {
  return {
    schemaVersion: HUMAN_EVIDENCE_SCHEMA_VERSION,
    testId: "T86-01-human-evidence-contract",
    testVersion: "step3.86",
    gitCommit: "test",
    tester: "node:test",
    startedAt: "2026-05-23T00:00:00.000Z",
    endedAt: "2026-05-23T00:01:00.000Z",
    environment: {
      adminApi: "local",
      workload: "metadata-only"
    },
    terminal: {
      type: "pixel_grapheneos",
      adb: "dry-run",
      screen: "1080x2400"
    },
    pathTested: "Pixel -> VPN -> G1 -> VPN -> G2 -> VPN -> WORKLOAD -> microVM",
    expectedBehavior:
      "The operator can open the operator panel and app stream without terminal data landing on the terminal.",
    preconditions: [
      "Pixel authorized over ADB",
      "Operator session created",
      "G1/G2 route policy present"
    ],
    actions: [
      "Open operator panel",
      "Open app switcher",
      "Open Signal workload",
      "Record metadata-only evidence"
    ],
    evidenceRefs: ["screenshot://pixel/operator-panel", "probe://g1-g2/ipsec-status"],
    result: "PASS",
    blockers: [],
    residualRisk: ["Physical Puli AX, HSM, and FIDO2 remain gated for later production tests."],
    forbiddenDataPolicy: {
      metadataOnly: true,
      terminalDataStored: false,
      contentInspected: false,
      packetCaptureStored: false,
      secretsStored: false
    },
    ...overrides
  };
}

test("Step 3.86 evidence summary validates strict PASS metadata-only contract", () => {
  const summary = validSummary();
  assert.equal(validateHumanEvidenceSummary(summary), true);
  assert.equal(isProductionSatisfyingResult(summary.result), true);
});

test("Step 3.86 evidence schema rejects forbidden operational keys and raw secret-like values", () => {
  assert.throws(
    () => validateHumanEvidenceSummary(validSummary({ evidence: { messageContent: "forbidden" } })),
    /Forbidden evidence key/
  );
  assert.throws(
    () =>
      validateHumanEvidenceSummary(
        validSummary({ environment: { operatorToken: "REDACTED_OPERATOR_TOKEN" } })
      ),
    /Forbidden evidence key/
  );
  assert.throws(
    () =>
      assertMetadataOnly({
        url: "https://operator.sylion.internal/operator?op_token=op_123456789012345678901234567890"
      }),
    /Forbidden evidence value/
  );
});

test("Step 3.86 PASS cannot hide blockers or missing evidence", () => {
  assert.throws(
    () => validateHumanEvidenceSummary(validSummary({ evidenceRefs: [] })),
    /non-empty array field: evidenceRefs/
  );
  assert.throws(
    () => validateHumanEvidenceSummary(validSummary({ blockers: ["Signal did not render"] })),
    /PASS summaries cannot contain blockers/
  );
});

test("Step 3.86 derived result preserves critical failure and blocks simulation from production readiness", async () => {
  assert.equal(deriveOverallResult(["PASS", "BLOCKED", "FAIL_CRITICAL"]), "FAIL_CRITICAL");
  assert.equal(deriveOverallResult(["PASS", "LAB_PASS"]), "LAB_PASS");
  assert.equal(isProductionSatisfyingResult("LAB_PASS"), false);
  assert.equal(isProductionSatisfyingResult("SIMULATION_PASS"), false);

  const built = await buildHumanEvidenceSummary(
    validSummary({
      result: "LAB_PASS",
      blockers: [],
      notes: ["Dry-run evidence can support repair planning, not production sign-off."]
    })
  );
  assert.equal(built.productionSatisfyingResult, false);
  assert.equal(validateHumanEvidenceSummary(built), true);
});
