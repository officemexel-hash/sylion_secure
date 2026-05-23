import assert from "node:assert/strict";
import test from "node:test";
import { communicatorDefinition, communicatorEvaluatorPolicy, evaluateCommunicatorFactualState } from "../../../scripts/lib/communicator-factual-evaluator.mjs";

const readyStream = (appKey) => ({
  state: "stream_session_ready",
  launchUrl: `https://${appKey}.sylion.internal/stream/${appKey}`,
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
});

const routeProbe = {
  dnsThroughTunnel: true,
  terminalDefaultRoute: "g1",
  workloadEgress: "g2_policy_gateway"
};

test("Step 3.86 communicator evaluator passes Signal only with UI, bootstrap, send/receive and route", () => {
  const result = evaluateCommunicatorFactualState({
    appKey: "signal",
    matrixItem: {
      appKey: "signal",
      mandatoryChecks: ["uiVisible", "accountBootstrap", "sendReceive"]
    },
    streamSession: readyStream("signal"),
    visualProbe: {
      status: "passed",
      marker: "signal_desktop",
      evidenceRef: "screenshot:pixel/signal-ui",
      evidenceArtifactIds: ["artifact://pixel/signal/ui"]
    },
    accountProbe: {
      status: "passed",
      mode: "desktop_linked_account",
      nonSecretBootstrap: true,
      evidenceRef: "probe:signal-bootstrap-metadata",
      evidenceArtifactIds: ["artifact://pixel/signal/bootstrap"]
    },
    sendReceiveProbe: {
      status: "passed",
      metadataOnly: true,
      communicationDataStored: false,
      evidenceRef: "probe:signal-send-receive-metadata",
      evidenceArtifactIds: ["artifact://pixel/signal/send-receive"]
    },
    routeProbe
  });
  assert.equal(result.result, "passed");
  assert.equal(result.strictResult, "PASS");
  assert.equal(result.checks.uiVisible.status, "passed");
  assert.equal(result.checks.accountBootstrap.status, "passed");
  assert.equal(result.checks.sendReceive.status, "passed");
  assert.equal(result.blockers.length, 0);
});

test("Step 3.86 communicator evaluator blocks when Signal UI is visible but bootstrap/send-receive are missing", () => {
  const result = evaluateCommunicatorFactualState({
    appKey: "signal",
    matrixItem: {
      appKey: "signal",
      mandatoryChecks: ["uiVisible", "accountBootstrap", "sendReceive"]
    },
    streamSession: readyStream("signal"),
    visualProbe: {
      status: "passed",
      marker: "signal",
      evidenceRef: "screenshot:pixel/signal-ui"
    },
    routeProbe
  });
  assert.equal(result.result, "blocked");
  assert.equal(result.checks.uiVisible.status, "passed");
  assert.equal(result.checks.accountBootstrap.status, "blocked");
  assert.equal(result.checks.sendReceive.status, "blocked");
  assert.ok(result.blockers.includes("signal_account_bootstrap_not_factually_observed"));
  assert.ok(result.blockers.includes("signal_send_receive_not_factually_observed"));
});

test("Step 3.86 communicator evaluator fails web-link-only bootstrap and localhost stream", () => {
  const result = evaluateCommunicatorFactualState({
    appKey: "whatsapp",
    runtimeMode: "web",
    matrixItem: {
      appKey: "whatsapp",
      mandatoryChecks: ["uiVisible", "accountBootstrap", "sendReceive"]
    },
    streamSession: {
      ...readyStream("whatsapp"),
      launchUrl: "http://127.0.0.1:13013/vnc.html"
    },
    visualProbe: {
      status: "passed",
      marker: "web_whatsapp_login_only",
      evidenceRef: "screenshot:pixel/whatsapp-web-login"
    },
    accountProbe: {
      status: "passed",
      mode: "web_link_only",
      nonSecretBootstrap: true,
      evidenceRef: "probe:whatsapp-web-link"
    },
    sendReceiveProbe: {
      status: "passed",
      metadataOnly: true,
      communicationDataStored: false,
      evidenceRef: "probe:whatsapp-send-receive"
    },
    routeProbe
  });
  assert.equal(result.result, "failed");
  assert.equal(result.strictResult, "FAIL");
  assert.ok(result.blockers.includes("whatsapp_runtime_mode_not_allowed"));
  assert.ok(result.blockers.includes("stream_launch_url_not_internal_sylion"));
  assert.ok(result.blockers.includes("wrong_whatsapp_marker:web_whatsapp_login_only"));
  assert.ok(result.blockers.includes("whatsapp_web_link_only_bootstrap_forbidden"));
});

test("Step 3.86 communicator evaluator requires Zangi APK provenance", () => {
  const blocked = evaluateCommunicatorFactualState({
    appKey: "zangi",
    runtimeMode: "android_native",
    matrixItem: {
      appKey: "zangi",
      mandatoryChecks: ["uiVisible", "accountBootstrap", "sendReceive", "apkProvenance"]
    },
    streamSession: readyStream("zangi"),
    visualProbe: {
      status: "passed",
      marker: "zangi_android",
      evidenceRef: "screenshot:pixel/zangi-ui"
    },
    accountProbe: {
      status: "passed",
      mode: "android_native",
      nonSecretBootstrap: true,
      evidenceRef: "probe:zangi-bootstrap"
    },
    sendReceiveProbe: {
      status: "passed",
      metadataOnly: true,
      communicationDataStored: false,
      evidenceRef: "probe:zangi-send-receive"
    },
    routeProbe
  });
  assert.equal(blocked.result, "blocked");
  assert.ok(blocked.blockers.includes("zangi_apk_provenance_not_verified"));

  const passed = evaluateCommunicatorFactualState({
    appKey: "zangi",
    runtimeMode: "android_native",
    matrixItem: {
      appKey: "zangi",
      mandatoryChecks: ["uiVisible", "accountBootstrap", "sendReceive", "apkProvenance"]
    },
    streamSession: readyStream("zangi"),
    visualProbe: {
      status: "passed",
      marker: "zangi_android",
      evidenceRef: "screenshot:pixel/zangi-ui"
    },
    accountProbe: {
      status: "passed",
      mode: "android_native",
      nonSecretBootstrap: true,
      evidenceRef: "probe:zangi-bootstrap"
    },
    sendReceiveProbe: {
      status: "passed",
      metadataOnly: true,
      communicationDataStored: false,
      evidenceRef: "probe:zangi-send-receive"
    },
    apkProbe: {
      status: "passed",
      approvedSource: true,
      evidenceRef: "probe:zangi-apk-provenance"
    },
    routeProbe
  });
  assert.equal(passed.result, "passed");
  assert.equal(passed.checks.apkProvenance.status, "passed");
});

test("Step 3.86 communicator evaluator policy covers all current communicators", () => {
  assert.deepEqual(communicatorEvaluatorPolicy.supportedApps.sort(), ["signal", "telegram", "threema", "whatsapp", "zangi"]);
  assert.ok(communicatorEvaluatorPolicy.passRequires.includes("metadata-only send/receive check"));
  assert.ok(communicatorEvaluatorPolicy.failFast.includes("web-link-only bootstrap"));
  assert.equal(communicatorDefinition("telegram").label, "Telegram");
});
