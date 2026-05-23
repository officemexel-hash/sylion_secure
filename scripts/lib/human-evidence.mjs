import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const HUMAN_EVIDENCE_SCHEMA_VERSION = "sylion-human-evidence/v1";

export const HUMAN_RESULT_STATUS = Object.freeze({
  PASS: "PASS",
  SIMULATION_PASS: "SIMULATION_PASS",
  LAB_PASS: "LAB_PASS",
  FAIL: "FAIL",
  FAIL_CRITICAL: "FAIL_CRITICAL",
  BLOCKED: "BLOCKED",
  UNKNOWN: "UNKNOWN",
  FLAKY: "FLAKY"
});

const RESULT_PRIORITY = Object.freeze({
  FAIL_CRITICAL: 70,
  FAIL: 60,
  FLAKY: 50,
  BLOCKED: 40,
  UNKNOWN: 30,
  LAB_PASS: 20,
  SIMULATION_PASS: 10,
  PASS: 0
});

const FORBIDDEN_KEY_PATTERN = /(^|[_-])(password|passphrase|secret|token|api[_-]?key|otp|sms|phone[_-]?number|seed|mnemonic|private[_-]?key|payload|message[_-]?content|chat[_-]?content|packet[_-]?capture|pcap|capture[_-]?file|file[_-]?content|wallet[_-]?seed|wallet[_-]?secret|cookie|raw[_-]?body)([_-]|$)/i;

const FORBIDDEN_VALUE_PATTERNS = [
  /op_[A-Za-z0-9_-]{24,}/,
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/
];

const ALLOWED_GUARDRAIL_KEYS = new Set([
  "contentInspected",
  "metadataOnly",
  "packetCaptureStored",
  "secretsStored",
  "terminalDataStored"
]);

function normalizeKey(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, "$1_$2");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertAllowedKey(key, path) {
  if (ALLOWED_GUARDRAIL_KEYS.has(String(key))) {
    return;
  }
  if (FORBIDDEN_KEY_PATTERN.test(normalizeKey(key))) {
    throw new Error(`Forbidden evidence key at ${path}: ${key}`);
  }
}

function assertAllowedString(value, path) {
  for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
    if (pattern.test(value)) {
      throw new Error(`Forbidden evidence value at ${path}`);
    }
  }
}

export function assertMetadataOnly(value, path = "evidence") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMetadataOnly(item, `${path}[${index}]`));
    return true;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertAllowedKey(key, `${path}.${key}`);
      assertMetadataOnly(child, `${path}.${key}`);
    }
    return true;
  }
  if (typeof value === "string") {
    assertAllowedString(value, path);
  }
  return true;
}

function redactString(value) {
  return value
    .replace(/op_[A-Za-z0-9_-]{24,}/g, "REDACTED_OPERATOR_TOKEN")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, "Bearer REDACTED")
    .replace(/(op_token=)[A-Za-z0-9._~+/=-]+/gi, "$1REDACTED_OPERATOR_TOKEN")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "REDACTED_PRIVATE_KEY");
}

export function sanitizeMetadata(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMetadata(item));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeMetadata(child)]));
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  return value;
}

export function normalizeResultStatus(status) {
  const normalized = String(status || HUMAN_RESULT_STATUS.UNKNOWN).trim().toUpperCase();
  if (!Object.hasOwn(RESULT_PRIORITY, normalized)) {
    throw new Error(`Unsupported human evidence result status: ${status}`);
  }
  return normalized;
}

export function deriveOverallResult(results) {
  const statuses = (results || []).map((item) => normalizeResultStatus(item?.result || item?.status || item));
  if (!statuses.length) return HUMAN_RESULT_STATUS.UNKNOWN;
  return statuses.sort((left, right) => RESULT_PRIORITY[right] - RESULT_PRIORITY[left])[0];
}

export function isProductionSatisfyingResult(status) {
  return normalizeResultStatus(status) === HUMAN_RESULT_STATUS.PASS;
}

async function currentGitCommit(cwd) {
  try {
    const result = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      timeout: 10_000,
      windowsHide: true
    });
    return result.stdout.trim();
  } catch {
    return "unknown";
  }
}

function requireNonEmptyString(summary, key) {
  if (!summary[key] || typeof summary[key] !== "string") {
    throw new Error(`Human evidence summary requires non-empty string field: ${key}`);
  }
}

function requireNonEmptyArray(summary, key) {
  if (!Array.isArray(summary[key]) || summary[key].length === 0) {
    throw new Error(`Human evidence summary requires non-empty array field: ${key}`);
  }
}

function requiresEvidence(result) {
  return [
    HUMAN_RESULT_STATUS.PASS,
    HUMAN_RESULT_STATUS.LAB_PASS,
    HUMAN_RESULT_STATUS.SIMULATION_PASS,
    HUMAN_RESULT_STATUS.FAIL,
    HUMAN_RESULT_STATUS.FAIL_CRITICAL,
    HUMAN_RESULT_STATUS.FLAKY
  ].includes(result);
}

export function validateHumanEvidenceSummary(summary) {
  if (!isPlainObject(summary)) {
    throw new Error("Human evidence summary must be an object.");
  }
  if (summary.schemaVersion !== HUMAN_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(`Human evidence summary schemaVersion must be ${HUMAN_EVIDENCE_SCHEMA_VERSION}.`);
  }
  for (const key of ["testId", "testVersion", "gitCommit", "tester", "startedAt", "endedAt", "pathTested", "expectedBehavior", "result"]) {
    requireNonEmptyString(summary, key);
  }
  for (const key of ["preconditions", "actions", "blockers", "residualRisk"]) {
    if (!Array.isArray(summary[key])) {
      throw new Error(`Human evidence summary requires array field: ${key}`);
    }
  }
  if (!isPlainObject(summary.environment)) {
    throw new Error("Human evidence summary requires environment object.");
  }
  if (!isPlainObject(summary.terminal)) {
    throw new Error("Human evidence summary requires terminal object.");
  }
  if (!isPlainObject(summary.forbiddenDataPolicy)) {
    throw new Error("Human evidence summary requires forbiddenDataPolicy object.");
  }
  const result = normalizeResultStatus(summary.result);
  if (requiresEvidence(result)) {
    requireNonEmptyArray(summary, "evidenceRefs");
  }
  if (result === HUMAN_RESULT_STATUS.PASS) {
    requireNonEmptyArray(summary, "preconditions");
    requireNonEmptyArray(summary, "actions");
    if (summary.blockers.length !== 0) {
      throw new Error("PASS summaries cannot contain blockers.");
    }
  }
  if (summary.forbiddenDataPolicy.metadataOnly !== true) {
    throw new Error("Human evidence must declare metadataOnly=true.");
  }
  if (summary.forbiddenDataPolicy.terminalDataStored !== false) {
    throw new Error("Human evidence must declare terminalDataStored=false.");
  }
  if (summary.forbiddenDataPolicy.contentInspected !== false) {
    throw new Error("Human evidence must declare contentInspected=false.");
  }
  if (summary.forbiddenDataPolicy.packetCaptureStored !== false) {
    throw new Error("Human evidence must declare packetCaptureStored=false.");
  }
  assertMetadataOnly(summary);
  return true;
}

export async function buildHumanEvidenceSummary(input, options = {}) {
  const cwd = options.cwd || process.cwd();
  const now = new Date().toISOString();
  const summary = sanitizeMetadata({
    schemaVersion: HUMAN_EVIDENCE_SCHEMA_VERSION,
    testId: input.testId,
    testVersion: input.testVersion || "step3.86",
    gitCommit: input.gitCommit || await currentGitCommit(cwd),
    tester: input.tester || "Codex",
    startedAt: input.startedAt || now,
    endedAt: input.endedAt || now,
    environment: input.environment || {},
    terminal: input.terminal || {},
    pathTested: input.pathTested,
    expectedBehavior: input.expectedBehavior,
    preconditions: input.preconditions || [],
    actions: input.actions || [],
    evidenceRefs: input.evidenceRefs || [],
    result: normalizeResultStatus(input.result),
    blockers: input.blockers || [],
    residualRisk: input.residualRisk || [],
    nextRequiredAction: input.nextRequiredAction || "",
    productionSatisfyingResult: isProductionSatisfyingResult(input.result),
    forbiddenDataPolicy: {
      metadataOnly: true,
      terminalDataStored: false,
      contentInspected: false,
      packetCaptureStored: false,
      secretsStored: false,
      ...input.forbiddenDataPolicy
    },
    notes: input.notes || []
  });
  validateHumanEvidenceSummary(summary);
  return summary;
}

export async function writeHumanEvidenceSummary(outputDir, input, options = {}) {
  await mkdir(outputDir, { recursive: true });
  const summary = await buildHumanEvidenceSummary(input, options);
  const path = join(outputDir, options.fileName || "summary.json");
  await writeFile(path, JSON.stringify(summary, null, 2), "utf8");
  return { path, summary };
}
