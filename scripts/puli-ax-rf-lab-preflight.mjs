#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertRfLabPreflightSafe,
  buildReadOnlyRfLabPreflightScript,
  parseKeyValueLines,
  summarizeRfLabRouterPreflight
} from "./lib/rf-lab-router-preflight.js";

const DEFAULT_ROUTER_IP = "192.168.8.1";
const DEFAULT_SSH_KEY =
  process.platform === "win32"
    ? ".deploy\\sylion_puli_ax_ed25519"
    : ".deploy/sylion_puli_ax_ed25519";
const DEFAULT_OUT = "docs/admin-panel-v2/test-artifacts/puli-ax-rf-lab-preflight/latest.json";

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasArg(name) {
  return process.argv.includes(`--${name}`);
}

function isoNow() {
  return new Date().toISOString();
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        windowsHide: true,
        timeout: options.timeout || 25_000,
        maxBuffer: options.maxBuffer || 1024 * 1024
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error?.code || 0,
          stdout: String(stdout || "").trim(),
          stderr: String(stderr || "").trim(),
          message: error?.message || null
        });
      }
    );
  });
}

async function ssh({ routerIp, user, keyPath, script, timeout = 25_000 }) {
  return execFileAsync(
    "ssh",
    [
      "-i",
      keyPath,
      "-o",
      "BatchMode=yes",
      "-o",
      "PasswordAuthentication=no",
      "-o",
      "StrictHostKeyChecking=accept-new",
      `${user}@${routerIp}`,
      script
    ],
    { timeout }
  );
}

async function writeSummary(outPath, summary) {
  if (!outPath || hasArg("no-write")) return;
  const absolute = resolve(outPath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

async function main() {
  const routerIp = argValue("router-ip", DEFAULT_ROUTER_IP);
  const user = argValue("user", "root");
  const keyPath = argValue("ssh-key", process.env.SYLION_PULI_AX_SSH_KEY || DEFAULT_SSH_KEY);
  const outPath = argValue("out", DEFAULT_OUT);
  const startedAt = isoNow();
  const probe = await ssh({
    routerIp,
    user,
    keyPath,
    script: buildReadOnlyRfLabPreflightScript()
  });
  if (!probe.ok) {
    const summary = {
      component: "puli_ax_rf_lab_router_preflight",
      routerIp,
      startedAt,
      completedAt: isoNow(),
      status: "blocked_ssh_key_auth_required",
      facts: {
        capabilities: {
          sshKeyAuth: false
        }
      },
      controls: {
        readOnly: true,
        rawCellularIdentifiersRead: false,
        simSecretMaterialRead: false,
        mutationCommandsExecuted: false,
        productRuntimeExecutorAvailable: false,
        sideEffectAllowed: false,
        productionExecutionAllowed: false,
        passwordPrinted: false,
        secretsStored: false
      },
      blockers: ["router_ssh_key_auth_not_validated"],
      nextActions: [
        "Install router SSH key auth using the existing interactive bootstrap flow.",
        "Rerun npm run test:puli-ax-rf-lab-preflight."
      ]
    };
    await writeSummary(outPath, summary);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (hasArg("require-pass")) process.exitCode = 1;
    return;
  }
  const summary = assertRfLabPreflightSafe(
    summarizeRfLabRouterPreflight(parseKeyValueLines(probe.stdout), {
      routerIp,
      startedAt,
      completedAt: isoNow()
    })
  );
  await writeSummary(outPath, summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (hasArg("require-pass") && summary.status !== "preflight_ready_for_human_gate") {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const summary = {
      component: "puli_ax_rf_lab_router_preflight",
      status: "failed",
      error: error.message,
      controls: {
        readOnly: true,
        rawCellularIdentifiersRead: false,
        simSecretMaterialRead: false,
        mutationCommandsExecuted: false,
        productRuntimeExecutorAvailable: false,
        sideEffectAllowed: false,
        productionExecutionAllowed: false,
        passwordPrinted: false,
        secretsStored: false
      }
    };
    process.stderr.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = 1;
  });
}
