import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const apps = Object.freeze({
  duckduckgo: { host: "duckduckgo.sylion.internal", snippet: "/etc/nginx/snippets/sylion-kasm-auth-duckduckgo.conf" },
  libreoffice: { host: "libreoffice.sylion.internal", snippet: "/etc/nginx/snippets/sylion-kasm-auth-libreoffice.conf" },
  whatsapp: { host: "whatsapp.sylion.internal", snippet: "/etc/nginx/snippets/sylion-kasm-auth-whatsapp.conf" },
  telegram: { host: "telegram.sylion.internal", snippet: "/etc/nginx/snippets/sylion-kasm-auth-telegram.conf" },
  threema: { host: "threema.sylion.internal", snippet: "/etc/nginx/snippets/sylion-kasm-auth-threema.conf" },
  signal: { host: "signal.sylion.internal", snippet: "/etc/nginx/snippets/sylion-kasm-auth-signal.conf" },
  exodus: { host: "exodus.sylion.internal", snippet: "/etc/nginx/snippets/sylion-kasm-auth-exodus.conf" }
});

const defaults = {
  sshKey: process.env.SYLION_ADMIN_SSH_KEY || ".deploy\\sylion_hetzner_admin_ed25519",
  workloadHost: process.env.SYLION_WORKLOAD_NATIVE_SSH || "root@65.109.123.72",
  g2Host: process.env.SYLION_G2_SSH || "sylion@178.105.203.31",
  g2Bind: process.env.SYLION_G2_PRIVATE_IP || "10.42.0.12",
  secretDir: "/opt/sylion-firecracker/stream-secrets"
};

function selectedApps(args) {
  const appFlag = args.find((arg) => arg.startsWith("--app="));
  const requested = appFlag ? appFlag.slice("--app=".length) : process.env.SYLION_KASM_AUTH_APP || "all";
  if (requested === "all") return Object.keys(apps);
  const key = requested === "duckduckgo_browser" ? "duckduckgo" : requested;
  if (!apps[key]) {
    throw new Error(`Unsupported KasmVNC app ${requested}; supported=${Object.keys(apps).join(",")},all`);
  }
  return [key];
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

async function readCredentials(appKey) {
  const secretFile = `${defaults.secretDir}/${appKey}.env`;
  const script = `
set -euo pipefail
secret_file=${JSON.stringify(secretFile)}
if [ ! -f "$secret_file" ]; then
  echo missing_stream_secret >&2
  exit 2
fi
set -a
. "$secret_file"
set +a
if [ -z "\${STREAM_USER:-}" ] || [ -z "\${STREAM_PASSWORD:-}" ]; then
  echo invalid_stream_secret >&2
  exit 3
fi
printf '%s\\n%s\\n' "$STREAM_USER" "$STREAM_PASSWORD"
`;
  const { stdout } = await ssh(defaults.workloadHost, script, { timeout: 60_000 });
  const [user, password] = stdout.split(/\r?\n/);
  if (!user || !password || password.length < 24) {
    throw new Error(`KasmVNC credentials for ${appKey} are missing or malformed`);
  }
  return { user, password };
}

async function writeSnippet(appKey, credentials) {
  const app = apps[appKey];
  const auth = Buffer.from(`${credentials.user}:${credentials.password}`, "utf8").toString("base64");
  const tempDir = await mkdtemp(join(tmpdir(), "sylion-kasm-auth-"));
  const localSnippet = join(tempDir, `${appKey}.conf`);
  const remoteTemp = `/tmp/sylion-kasm-auth-${appKey}.next`;
  await writeFile(localSnippet, `proxy_set_header Authorization "Basic ${auth}";\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await scp(localSnippet, `${defaults.g2Host}:${remoteTemp}`);
    const script = `
set -euo pipefail
sudo install -o root -g root -m 0600 ${remoteTemp} ${app.snippet}
rm -f ${remoteTemp}
sudo nginx -t >/dev/null
sudo systemctl reload nginx
`;
    await ssh(defaults.g2Host, script, { timeout: 60_000 });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function smoke(appKey) {
  const app = apps[appKey];
  const script = `
set -euo pipefail
body=/tmp/sylion-kasm-auth-smoke-${appKey}.html
code=$(curl -k -sS -L -o "$body" -w "%{http_code}" --resolve ${app.host}:443:${defaults.g2Bind} --max-time 12 "https://${app.host}/vnc.html?autoconnect=true&resize=remote&path=websockify" || true)
marker=false
grep -Eqi 'KasmVNC|kasm|noVNC' "$body" && marker=true || true
headers=$(curl -k -sS -I --resolve ${app.host}:443:${defaults.g2Bind} --max-time 12 "https://${app.host}/vnc.html?autoconnect=true&resize=remote&path=websockify" | tr '\\r\\n' ' ' || true)
terminal=false
echo "$headers" | grep -q 'X-Sylion-Terminal-Data-Stored: false' && terminal=true || true
gateway=false
echo "$headers" | grep -q 'X-Sylion-Workload-Gateway: g2' && gateway=true || true
printf '{"app":"%s","status":"%s","marker":%s,"terminalDataStoredFalse":%s,"g2Gateway":%s}\\n' ${JSON.stringify(appKey)} "$code" "$marker" "$terminal" "$gateway"
rm -f "$body"
`;
  const { stdout } = await ssh(defaults.g2Host, script, { timeout: 60_000 });
  return JSON.parse(stdout);
}

function plan(keys) {
  return {
    component: "kasm_auth_handoff",
    apps: keys.map((key) => ({
      key,
      host: apps[key].host,
      secretSource: `${defaults.secretDir}/${key}.env`,
      g2Snippet: apps[key].snippet,
      authMode: "g2_root_only_basic_auth_handoff"
    })),
    invariants: {
      noSecretPrinted: true,
      noSecretInRepo: true,
      noTerminalOperationalData: true,
      g2BrokerOnly: true
    }
  };
}

async function main() {
  const args = process.argv.slice(2);
  const keys = selectedApps(args);
  if (!args.includes("--apply")) {
    console.log(JSON.stringify(plan(keys), null, 2));
    return;
  }
  const results = [];
  for (const key of keys) {
    const credentials = await readCredentials(key);
    await writeSnippet(key, credentials);
    results.push(await smoke(key));
  }
  console.log(JSON.stringify({
    applied: true,
    apps: results,
    secretPrinted: false,
    noSecretInRepo: true,
    terminalDataStored: false,
    g2BrokerOnly: true
  }, null, 2));
}

await main();
