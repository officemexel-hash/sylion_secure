import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeHumanEvidenceSummary } from "./lib/human-evidence.mjs";
import { AdminApiClient } from "../services/admin-api/src/sdk/adminApiClient.js";

const baseUrl = process.env.SYLION_BASE_URL || "http://127.0.0.1:18099";
const appFilter = process.env.SYLION_APP_UNDER_TEST || "all";
const terminalMode = process.env.SYLION_TERMINAL_MODE || "pixel_grapheneos";
const runtimeMode = process.env.SYLION_RUNTIME_MODE || "unknown";
const indexHumanEvidence = process.env.SYLION_INDEX_HUMAN_EVIDENCE === "true";
const outputDir = join(
  process.cwd(),
  "docs",
  "admin-panel-v2",
  "test-artifacts",
  "step3-86-workload-factual-human-runner"
);

function repoRelativePath(path) {
  return path.startsWith(process.cwd())
    ? path.slice(process.cwd().length + 1).replace(/\\/g, "/")
    : path.replace(/\\/g, "/");
}

async function loginClient() {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_step3_86_app_runner_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-86-app-runner-${crypto.randomUUID()}`;
  try {
    const enrollment = await anon.createEnrollmentOptions({
      email: "admin@sylion.local",
      password: "ChangeMe-LocalOnly-1!"
    });
    await anon.verifyEnrollment({
      challengeId: enrollment.challenge.id,
      credential: {
        id: credentialId,
        publicKey: `simulated-public-key:${credentialId}`,
        transports: ["usb"]
      }
    });
  } catch {
    // Existing admin enrollment is acceptable for repeatable local harness runs.
  }
  const loginOptions = await anon.createWebAuthnLoginOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  const loginCredentialId =
    loginOptions.challenge.publicKey.allowCredentials?.at(-1)?.id || credentialId;
  const session = await anon.verifyWebAuthnLogin({
    challengeId: loginOptions.challenge.id,
    credentialId: loginCredentialId,
    assertion: {
      signature: `simulated:${loginOptions.challenge.id}:${loginCredentialId}`,
      signCounter: 1
    }
  });
  return anon.withToken(session.token);
}

function selectedApps(matrix) {
  if (appFilter === "all") return matrix;
  const wanted = new Set(
    appFilter
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
  return matrix.filter((item) => wanted.has(item.appKey));
}

async function writeAppEvidence({ client, item }) {
  const appDir = join(outputDir, item.appKey);
  const evidence = await writeHumanEvidenceSummary(
    appDir,
    {
      testId: `step3-86-app-${item.appKey}-human-factual`,
      testVersion: "step3.86",
      tester: "Codex app factual runner scaffold",
      environment: {
        mode: "scaffold_pending_human_execution",
        adminApi: "local_or_configured_admin_api",
        appKey: item.appKey,
        appClass: item.appClass,
        runtimeMode,
        productionMutationAllowed: false
      },
      terminal: {
        type: terminalMode,
        operationalDataOnTerminal: false
      },
      pathTested: `${terminalMode} -> operator panel -> workload selector -> ${item.label} workload`,
      expectedBehavior: item.expectedBehavior,
      preconditions: [
        "Workload factual matrix is available.",
        "Operator path and terminal harness are selected.",
        "No app content, OTP, phone number, wallet data, file content or message content will be stored."
      ],
      actions: item.humanSteps,
      evidenceRefs: [
        "matrix:/release/workload-factual-matrix",
        `app:${item.appKey}`,
        `requiredChecks:${item.mandatoryChecks.join(",")}`
      ],
      result: "UNKNOWN",
      blockers: [
        "app_human_test_not_executed_yet",
        `required_checks_pending:${item.mandatoryChecks.join(",")}`,
        "strict_pass_requires_real_human_ui_and_metadata_evidence"
      ],
      residualRisk: [
        "This scaffold does not prove app usability.",
        "The exact app test must be executed through Pixel or laptop terminal harness before factual PASS."
      ],
      nextRequiredAction: item.repairPrompt,
      notes: [`passCriteria=${item.passCriteria.join(" | ")}`, `failIf=${item.failIf.join(" | ")}`]
    },
    { fileName: "human-evidence.json" }
  );
  const summary = {
    appKey: item.appKey,
    label: item.label,
    strictResult: evidence.summary.result,
    evidencePath: repoRelativePath(evidence.path),
    requiredChecks: item.mandatoryChecks,
    repairPrompt: item.repairPrompt,
    indexedRunId: null
  };
  if (indexHumanEvidence) {
    const indexed = await client.recordHumanEvidenceRepairLoop({
      summary: evidence.summary,
      evidenceArtifactPath: repoRelativePath(evidence.path),
      linkedModule: `workload_app:${item.appKey}`,
      ksiegaControlRefs: ["workload_factual_state", "metadata_only_monitoring", "cdr_mandatory"],
      phantomBoundaryImpact: "none"
    });
    summary.indexedRunId = indexed.run.id;
  }
  return summary;
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  const client = await loginClient();
  const matrixResponse = await client.listWorkloadFactualMatrix();
  const matrix = selectedApps(matrixResponse.matrix);
  if (!matrix.length) {
    throw new Error(`No workload factual matrix rows matched SYLION_APP_UNDER_TEST=${appFilter}`);
  }
  const apps = [];
  for (const item of matrix) {
    apps.push(await writeAppEvidence({ client, item }));
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    appFilter,
    terminalMode,
    runtimeMode,
    indexHumanEvidence,
    productionExecutionAllowed: false,
    apps
  };
  await writeFile(join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

await run();
