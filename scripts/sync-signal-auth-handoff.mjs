import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaults = {
  sshKey: process.env.SYLION_ADMIN_SSH_KEY || ".deploy\\sylion_hetzner_admin_ed25519",
  workloadHost: process.env.SYLION_WORKLOAD_NATIVE_SSH || process.env.SYLION_WORKLOAD_SSH || "root@65.109.123.72",
  g2Host: process.env.SYLION_G2_SSH || "sylion@178.105.203.31",
  g2Snippet: "/etc/nginx/snippets/sylion-signal-auth.conf",
  workloadSecretFile: "/etc/sylion/workload-secrets/signal.env"
};

function plan() {
  return {
    component: "signal_auth_handoff",
    source: {
      host: defaults.workloadHost,
      preferredPath: defaults.workloadSecretFile,
      fallback: "docker inspect sylion-signal-desktop VNC_PW"
    },
    destination: {
      host: defaults.g2Host,
      snippet: defaults.g2Snippet,
      mode: "root_only_0600"
    },
    invariants: {
      noSecretPrinted: true,
      noSecretInRepo: true,
      noTerminalOperationalData: true,
      g2BrokerOnly: true
    }
  };
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout ?? 60_000,
    windowsHide: true,
    input: options.input
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function ssh(host, script, options = {}) {
  return run("ssh", [
    "-i",
    defaults.sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    host,
    script
  ], options);
}

async function readSignalPassword() {
  const script = `
set -euo pipefail
if [ -f ${defaults.workloadSecretFile} ]; then
  sudo awk -F= '/^VNC_PW=/ {print $2; exit}' ${defaults.workloadSecretFile}
else
  docker inspect sylion-signal-desktop --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '/^VNC_PW=/ {print $2; exit}'
fi
`;
  const { stdout } = await ssh(defaults.workloadHost, script, { timeout: 60_000 });
  if (!stdout || stdout.length < 12) {
    throw new Error("Signal workload password was not found on WORKLOAD host");
  }
  return stdout;
}

async function scp(localPath, remoteTarget) {
  return run("scp", [
    "-i",
    defaults.sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    localPath,
    remoteTarget
  ], { timeout: 60_000 });
}

async function writeG2Snippet(password) {
  const header = `proxy_set_header Authorization "Basic ${Buffer.from(`kasm_user:${password}`, "utf8").toString("base64")}";\n`;
  const tempDir = await mkdtemp(join(tmpdir(), "sylion-signal-auth-"));
  const localSnippet = join(tempDir, "sylion-signal-auth.conf");
  await writeFile(localSnippet, header, { encoding: "utf8", mode: 0o600 });
  const remoteTemp = "/tmp/sylion-signal-auth.next";
  await scp(localSnippet, `${defaults.g2Host}:${remoteTemp}`);
  const script = `
set -euo pipefail
sudo install -o root -g root -m 0600 ${remoteTemp} ${defaults.g2Snippet}
rm -f ${remoteTemp}
sudo nginx -t >/dev/null
sudo systemctl reload nginx
`;
  try {
    await ssh(defaults.g2Host, script, { timeout: 60_000 });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function smoke() {
  const script = `
set -euo pipefail
code=$(curl -k -sS -o /tmp/sylion-signal-smoke -w "%{http_code}" --resolve signal.sylion.internal:443:10.42.0.12 --max-time 12 https://signal.sylion.internal/ || true)
headers=$(curl -k -sS -I --resolve signal.sylion.internal:443:10.42.0.12 --max-time 12 https://signal.sylion.internal/ | tr '\\r\\n' ' ' | sed 's/[[:space:]]\\+/ /g' || true)
printf '{"signalStatus":"%s","terminalDataStored":%s,"g1G2BypassAllowed":%s,"cdrRequired":%s}\\n' "$code" "$(echo "$headers" | grep -q 'X-Sylion-Terminal-Data-Stored: false' && echo false || echo true)" "$(echo "$headers" | grep -q 'X-Sylion-G1-G2-Bypass: false' && echo false || echo true)" "$(echo "$headers" | grep -q 'X-Sylion-CDR-Required: true' && echo true || echo false)"
`;
  const { stdout } = await ssh(defaults.g2Host, script, { timeout: 60_000 });
  return JSON.parse(stdout);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--print-plan")) {
    console.log(JSON.stringify(plan(), null, 2));
    return;
  }
  if (!args.has("--apply")) {
    console.error("Usage: node scripts/sync-signal-auth-handoff.mjs --print-plan|--apply");
    process.exitCode = 2;
    return;
  }
  const password = await readSignalPassword();
  await writeG2Snippet(password);
  const result = await smoke();
  console.log(JSON.stringify({
    applied: true,
    secretPrinted: false,
    ...result
  }, null, 2));
}

await main();
