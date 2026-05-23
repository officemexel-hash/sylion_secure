import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExodusFactualState, exodusEvaluatorPolicy } from "../../../scripts/lib/exodus-factual-evaluator.mjs";

const matrixItem = {
  appKey: "exodus",
  mandatoryChecks: ["uiVisible", "walletWorkflow", "riskAcceptance"]
};

const readyStream = {
  state: "stream_session_ready",
  launchUrl: "https://exodus.sylion.internal/stream/exodus",
  gateway: {
    role: "G2",
    publicInternetExposure: false
  },
  stream: {
    operationalDataOnTerminal: false
  },
  security: {
    terminalDataStored: false,
    g1G2BypassAllowed: false
  }
};

test("Step 3.86 Exodus evaluator passes only with UI, test workflow and risk acceptance", () => {
  const result = evaluateExodusFactualState({
    matrixItem,
    streamSession: readyStream,
    visualProbe: {
      status: "passed",
      marker: "exodus_wallet",
      evidenceRef: "screenshot:pixel/exodus-visible",
      evidenceArtifactIds: ["artifact://pixel/exodus/ui"]
    },
    walletProbe: {
      status: "passed",
      testOnlyWorkflow: true,
      walletDataStored: false,
      evidenceRef: "probe:exodus-test-workflow",
      evidenceArtifactIds: ["artifact://pixel/exodus/test-workflow"]
    },
    riskProbe: {
      status: "passed",
      operatorRiskAccepted: true,
      evidenceRef: "operator-api:exodus-risk-accepted",
      evidenceArtifactIds: ["artifact://operator/exodus/risk"]
    }
  });
  assert.equal(result.result, "passed");
  assert.equal(result.strictResult, "PASS");
  assert.equal(result.checks.uiVisible.status, "passed");
  assert.equal(result.checks.walletWorkflow.status, "passed");
  assert.equal(result.checks.riskAcceptance.status, "passed");
  assert.equal(result.blockers.length, 0);
});

test("Step 3.86 Exodus evaluator blocks without risk acceptance", () => {
  const result = evaluateExodusFactualState({
    matrixItem,
    streamSession: readyStream,
    visualProbe: {
      status: "passed",
      marker: "exodus",
      evidenceRef: "screenshot:pixel/exodus-visible"
    },
    walletProbe: {
      status: "passed",
      testOnlyWorkflow: true,
      walletDataStored: false,
      evidenceRef: "probe:exodus-test-workflow"
    }
  });
  assert.equal(result.result, "blocked");
  assert.equal(result.checks.riskAcceptance.status, "blocked");
  assert.ok(result.blockers.includes("exodus_risk_acceptance_not_verified"));
});

test("Step 3.86 Exodus evaluator preserves exact stream blockers for repair", () => {
  const result = evaluateExodusFactualState({
    matrixItem,
    streamSession: {
      state: "stream_session_blocked",
      blockers: ["exodus_risk_ack_missing"],
      gateway: {
        role: "G2",
        publicInternetExposure: false
      },
      security: {
        terminalDataStored: false,
        g1G2BypassAllowed: false
      }
    }
  });
  assert.equal(result.result, "blocked");
  assert.ok(result.blockers.includes("stream_stream_session_blocked"));
  assert.ok(result.blockers.includes("stream_blocker:exodus_risk_ack_missing"));
  assert.ok(result.blockers.includes("stream_launch_url_missing_until_session_ready"));
});

test("Step 3.86 Exodus evaluator fails forbidden wallet fields and public stream", () => {
  const result = evaluateExodusFactualState({
    matrixItem,
    streamSession: {
      ...readyStream,
      launchUrl: "http://127.0.0.1:13020/vnc.html"
    },
    visualProbe: {
      status: "passed",
      marker: "generic_browser",
      evidenceRef: "screenshot:pixel/generic-browser"
    },
    walletProbe: {
      status: "passed",
      testOnlyWorkflow: true,
      walletDataStored: false,
      seed: "should-never-be-stored",
      evidenceRef: "probe:exodus-test-workflow"
    },
    riskProbe: {
      status: "passed",
      operatorRiskAccepted: true,
      evidenceRef: "operator-api:exodus-risk"
    }
  });
  assert.equal(result.result, "failed");
  assert.equal(result.strictResult, "FAIL");
  assert.ok(result.blockers.includes("stream_launch_url_not_internal_sylion"));
  assert.ok(result.blockers.includes("wrong_exodus_marker:generic_browser"));
  assert.ok(result.blockers.includes("forbidden_probe_field:walletProbe.seed"));
});

test("Step 3.86 Exodus evaluator policy documents wallet-data gates", () => {
  assert.equal(exodusEvaluatorPolicy.appKey, "exodus");
  assert.deepEqual(exodusEvaluatorPolicy.requiredChecks, ["uiVisible", "walletWorkflow", "riskAcceptance"]);
  assert.ok(exodusEvaluatorPolicy.passRequires.includes("walletDataStored=false"));
  assert.ok(exodusEvaluatorPolicy.failFast.includes("seed, mnemonic, recovery phrase or private-key fields"));
});
