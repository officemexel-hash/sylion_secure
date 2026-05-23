import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outputDir = join(process.cwd(), "docs", "admin-panel-v2", "test-artifacts", "step3-86-app-runner-chain");
const continueOnFailure = process.env.SYLION_CHAIN_STOP_ON_FIRST_FAILURE !== "true";

const APPS = Object.freeze([
  {
    appKey: "duckduckgo_browser",
    label: "DuckDuckGo",
    command: ["node", "scripts/workload-duckduckgo-human-runner.mjs"],
    summaryPath: ["docs", "admin-panel-v2", "test-artifacts", "step3-86-duckduckgo-human-runner", "summary.json"]
  },
  {
    appKey: "libreoffice",
    label: "LibreOffice",
    command: ["node", "scripts/workload-libreoffice-human-runner.mjs"],
    summaryPath: ["docs", "admin-panel-v2", "test-artifacts", "step3-86-libreoffice-human-runner", "summary.json"]
  },
  ...["signal", "whatsapp", "telegram", "threema", "zangi"].map((appKey) => ({
    appKey,
    label: appKey[0].toUpperCase() + appKey.slice(1),
    command: ["node", "scripts/workload-communicator-human-runner.mjs", `--app=${appKey}`],
    summaryPath: ["docs", "admin-panel-v2", "test-artifacts", `step3-86-${appKey}-human-runner`, "summary.json"]
  })),
  {
    appKey: "exodus",
    label: "Exodus",
    command: ["node", "scripts/workload-exodus-human-runner.mjs"],
    summaryPath: ["docs", "admin-panel-v2", "test-artifacts", "step3-86-exodus-human-runner", "summary.json"]
  }
]);

function repoRelativePath(path) {
  return path.startsWith(process.cwd())
    ? path.slice(process.cwd().length + 1).replace(/\\/g, "/")
    : path.replace(/\\/g, "/");
}

function runCommand(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  const results = [];
  for (const app of APPS) {
    const [command, ...args] = app.command;
    const startedAt = new Date().toISOString();
    const execution = await runCommand(command, args, {
      ...process.env,
      SYLION_INDEX_HUMAN_EVIDENCE: process.env.SYLION_INDEX_HUMAN_EVIDENCE || "false"
    });
    const summaryPath = join(process.cwd(), ...app.summaryPath);
    const summary = await readJson(summaryPath);
    const evaluation = summary?.evaluation || null;
    const result = {
      appKey: app.appKey,
      label: app.label,
      command: app.command.join(" "),
      exitCode: execution.code,
      strictResult: evaluation?.strictResult || (execution.code === 0 ? "UNKNOWN" : "FAIL"),
      factualResult: evaluation?.result || "unknown",
      blockers: evaluation?.blockers || ["runner_summary_missing_or_unreadable"],
      summaryPath: repoRelativePath(summaryPath),
      humanEvidencePath: summary?.humanEvidencePath || null,
      startedAt,
      endedAt: new Date().toISOString()
    };
    results.push(result);
    await writeFile(join(outputDir, "summary.json"), JSON.stringify({
      generatedAt: new Date().toISOString(),
      continueOnFailure,
      productionExecutionAllowed: false,
      terminalDataStored: false,
      apps: results
    }, null, 2), "utf8");
    if (execution.code !== 0 && !continueOnFailure) {
      break;
    }
  }
  const blocked = results.filter((item) => item.strictResult !== "PASS");
  const chainSummary = {
    generatedAt: new Date().toISOString(),
    appCount: APPS.length,
    executedCount: results.length,
    passedCount: results.filter((item) => item.strictResult === "PASS").length,
    blockedOrFailedCount: blocked.length,
    continueOnFailure,
    productionExecutionAllowed: false,
    terminalDataStored: false,
    nextRequiredAction: blocked.length
      ? "Repair blockers in app order, rerun the exact failed app runner, then rerun this chain."
      : "All app-specific strict factual runners returned PASS; review evidence index before any production claim.",
    apps: results
  };
  await writeFile(join(outputDir, "summary.json"), JSON.stringify(chainSummary, null, 2), "utf8");
  console.log(JSON.stringify(chainSummary, null, 2));
  if (blocked.length) {
    process.exitCode = 1;
  }
}

await run();
