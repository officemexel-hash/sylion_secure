import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLibreOfficeFactualState, libreOfficeEvaluatorPolicy } from "../../../scripts/lib/libreoffice-factual-evaluator.mjs";

const matrixItem = {
  appKey: "libreoffice",
  mandatoryChecks: ["uiVisible", "documentWorkflow"]
};

const readyStream = {
  state: "stream_session_ready",
  launchUrl: "https://libreoffice.sylion.internal/stream/libreoffice",
  gateway: {
    role: "G2",
    publicInternetExposure: false
  },
  stream: {
    operationalDataOnTerminal: false
  },
  security: {
    terminalDataStored: false,
    g1G2BypassAllowed: false,
    fileIngressEgress: "blocked_without_cdr_decision"
  }
};

test("Step 3.86 LibreOffice evaluator passes only with UI, document workflow and CDR boundary", () => {
  const result = evaluateLibreOfficeFactualState({
    matrixItem,
    streamSession: readyStream,
    visualProbe: {
      status: "passed",
      marker: "libreoffice_writer",
      evidenceRef: "screenshot:pixel/libreoffice-writer-visible",
      evidenceArtifactIds: ["artifact://pixel/libreoffice/ui"]
    },
    documentProbe: {
      status: "passed",
      nonSensitiveTestDocument: true,
      documentDataStored: false,
      evidenceRef: "probe:libreoffice-non-sensitive-workflow",
      evidenceArtifactIds: ["artifact://pixel/libreoffice/document-workflow"]
    },
    cdrProbe: {
      cdrRequired: true,
      ingressEgressBlockedWithoutDecision: true,
      evidenceArtifactIds: ["artifact://operator/libreoffice/cdr-boundary"]
    }
  });
  assert.equal(result.result, "passed");
  assert.equal(result.strictResult, "PASS");
  assert.equal(result.checks.uiVisible.status, "passed");
  assert.equal(result.checks.documentWorkflow.status, "passed");
  assert.equal(result.blockers.length, 0);
  assert.equal(result.terminalDataStored, false);
});

test("Step 3.86 LibreOffice evaluator blocks without document workflow proof", () => {
  const result = evaluateLibreOfficeFactualState({
    matrixItem,
    streamSession: readyStream,
    visualProbe: {
      status: "passed",
      marker: "libreoffice_start_center",
      evidenceRef: "screenshot:pixel/libreoffice-start-center"
    },
    cdrProbe: {
      cdrRequired: true,
      ingressEgressBlockedWithoutDecision: true
    }
  });
  assert.equal(result.result, "blocked");
  assert.equal(result.strictResult, "BLOCKED");
  assert.equal(result.checks.uiVisible.status, "passed");
  assert.equal(result.checks.documentWorkflow.status, "blocked");
  assert.ok(result.blockers.includes("libreoffice_document_workflow_not_factually_observed"));
});

test("Step 3.86 LibreOffice evaluator preserves exact stream blockers for repair", () => {
  const result = evaluateLibreOfficeFactualState({
    matrixItem,
    streamSession: {
      state: "stream_session_blocked",
      blockers: ["guacamole_connection_missing"],
      gateway: {
        role: "G2",
        publicInternetExposure: false
      },
      security: {
        terminalDataStored: false,
        g1G2BypassAllowed: false,
        fileIngressEgress: "blocked_without_cdr_decision"
      }
    },
    cdrProbe: {
      cdrRequired: true,
      ingressEgressBlockedWithoutDecision: true
    }
  });
  assert.equal(result.result, "blocked");
  assert.ok(result.blockers.includes("stream_stream_session_blocked"));
  assert.ok(result.blockers.includes("stream_blocker:guacamole_connection_missing"));
  assert.ok(result.blockers.includes("stream_launch_url_missing_until_session_ready"));
});

test("Step 3.86 LibreOffice evaluator fails when evidence is generic or CDR boundary is absent", () => {
  const result = evaluateLibreOfficeFactualState({
    matrixItem,
    streamSession: {
      ...readyStream,
      launchUrl: "http://127.0.0.1:13014/vnc.html",
      security: {
        ...readyStream.security,
        fileIngressEgress: "allowed"
      }
    },
    visualProbe: {
      status: "passed",
      marker: "generic_browser",
      evidenceRef: "screenshot:pixel/generic-browser"
    },
    documentProbe: {
      status: "passed",
      nonSensitiveTestDocument: true,
      documentDataStored: false,
      evidenceRef: "probe:generic-document-workflow"
    },
    cdrProbe: {
      cdrRequired: false,
      ingressEgressBlockedWithoutDecision: false
    }
  });
  assert.equal(result.result, "failed");
  assert.equal(result.strictResult, "FAIL");
  assert.ok(result.blockers.includes("stream_launch_url_not_internal_sylion"));
  assert.ok(result.blockers.includes("cdr_boundary_missing"));
  assert.ok(result.blockers.includes("wrong_office_marker:generic_browser"));
});

test("Step 3.86 LibreOffice evaluator policy documents CDR and metadata-only gates", () => {
  assert.equal(libreOfficeEvaluatorPolicy.appKey, "libreoffice");
  assert.deepEqual(libreOfficeEvaluatorPolicy.requiredChecks, ["uiVisible", "documentWorkflow"]);
  assert.ok(libreOfficeEvaluatorPolicy.passRequires.includes("CDR boundary present"));
  assert.ok(libreOfficeEvaluatorPolicy.failFast.includes("document data storage"));
});
