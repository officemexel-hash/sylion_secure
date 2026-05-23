import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDuckDuckGoFactualState, duckDuckGoEvaluatorPolicy } from "../../../scripts/lib/duckduckgo-factual-evaluator.mjs";

const matrixItem = {
  appKey: "duckduckgo_browser",
  mandatoryChecks: ["uiVisible", "browsing"]
};

const readyStream = {
  state: "stream_session_ready",
  launchUrl: "https://duckduckgo.sylion.internal/stream/duckduckgo_browser",
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

test("Step 3.86 DuckDuckGo evaluator passes only with stream, UI and browsing evidence", () => {
  const result = evaluateDuckDuckGoFactualState({
    matrixItem,
    streamSession: readyStream,
    visualProbe: {
      status: "passed",
      marker: "duckduckgo_search",
      evidenceRef: "screenshot:pixel/duckduckgo-search-visible",
      evidenceArtifactIds: ["artifact://pixel/duckduckgo/ui"]
    },
    browsingProbe: {
      status: "passed",
      throughWorkloadRoute: true,
      targetHost: "example.org",
      evidenceRef: "probe:duckduckgo-workload-example-org",
      evidenceArtifactIds: ["artifact://pixel/duckduckgo/browse"],
      terminalDataStored: false
    },
    routeProbe: {
      dnsThroughTunnel: true,
      terminalDefaultRoute: "g1",
      workloadEgress: "g2_policy_gateway"
    },
    latencyMs: 410
  });
  assert.equal(result.result, "passed");
  assert.equal(result.strictResult, "PASS");
  assert.equal(result.factualStateVerified, true);
  assert.equal(result.checks.uiVisible.status, "passed");
  assert.equal(result.checks.browsing.status, "passed");
  assert.equal(result.blockers.length, 0);
  assert.equal(result.terminalDataStored, false);
});

test("Step 3.86 DuckDuckGo evaluator blocks when stream is ready but browsing is not proven", () => {
  const result = evaluateDuckDuckGoFactualState({
    matrixItem,
    streamSession: readyStream,
    visualProbe: {
      status: "passed",
      marker: "duckduckgo",
      evidenceRef: "screenshot:pixel/duckduckgo-home-visible"
    }
  });
  assert.equal(result.result, "blocked");
  assert.equal(result.strictResult, "BLOCKED");
  assert.equal(result.checks.uiVisible.status, "passed");
  assert.equal(result.checks.browsing.status, "blocked");
  assert.ok(result.blockers.includes("duckduckgo_browsing_not_factually_observed"));
});

test("Step 3.86 DuckDuckGo evaluator fails wrong-browser and public-route evidence", () => {
  const result = evaluateDuckDuckGoFactualState({
    matrixItem,
    streamSession: {
      ...readyStream,
      launchUrl: "http://127.0.0.1:13013/vnc.html"
    },
    visualProbe: {
      status: "passed",
      marker: "google",
      evidenceRef: "screenshot:pixel/generic-browser"
    },
    browsingProbe: {
      status: "passed",
      throughWorkloadRoute: true,
      targetHost: "example.org",
      evidenceRef: "probe:generic-browser-example-org",
      terminalDataStored: false
    }
  });
  assert.equal(result.result, "failed");
  assert.equal(result.strictResult, "FAIL");
  assert.ok(result.blockers.includes("stream_launch_url_not_internal_sylion"));
  assert.ok(result.blockers.includes("wrong_browser_marker:google"));
  assert.equal(result.checks.uiVisible.status, "failed");
});

test("Step 3.86 DuckDuckGo evaluator policy documents strict pass conditions", () => {
  assert.equal(duckDuckGoEvaluatorPolicy.appKey, "duckduckgo_browser");
  assert.deepEqual(duckDuckGoEvaluatorPolicy.requiredChecks, ["uiVisible", "browsing"]);
  assert.ok(duckDuckGoEvaluatorPolicy.passRequires.includes("browsing metadata probe through workload route"));
  assert.ok(duckDuckGoEvaluatorPolicy.failFast.includes("localhost or public launch URL"));
});
