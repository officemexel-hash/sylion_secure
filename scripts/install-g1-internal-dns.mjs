#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";

export const g1DnsPlan = Object.freeze({
  component: "g1_internal_dns",
  g1Host: process.env.SYLION_G1_SSH || "sylion@178.105.200.112",
  dnsListenAddress: process.env.SYLION_G1_DNS_IP || "10.42.0.11",
  brokerAddress: process.env.SYLION_G2_PRIVATE_IP || "10.42.0.12",
  configPath: "/etc/dnsmasq.d/sylion-internal.conf",
  hostnames: Object.freeze([
    "admin.sylion.internal",
    "operator.sylion.internal",
    "session.sylion.internal",
    "signal.sylion.internal",
    "libreoffice.sylion.internal",
    "duckduckgo.sylion.internal",
    "whatsapp.sylion.internal",
    "telegram.sylion.internal",
    "threema.sylion.internal",
    "zangi.sylion.internal",
    "exodus.sylion.internal",
    "protonmail.sylion.internal",
    "simplex.sylion.internal"
  ]),
  invariants: Object.freeze({
    privateDnsOnly: true,
    terminalDataStored: false,
    secretsPrinted: false,
    g1G2BypassAllowed: false
  })
});

const sshKey = arg("key", process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey);
const target = arg("target", g1DnsPlan.g1Host);
const apply = process.argv.includes("--apply");
const confirmation = arg("confirm", "");

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function renderDnsmasqConfig(plan = g1DnsPlan) {
  return [
    "# Managed by SYLION G1 internal DNS installer.",
    "no-resolv",
    "interface=lo",
    `listen-address=${plan.dnsListenAddress}`,
    "bind-interfaces",
    ...plan.hostnames.map((host) => `address=/${host}/${plan.brokerAddress}`),
    ""
  ].join("\n");
}

export function renderRemoteScript(plan = g1DnsPlan) {
  const config = renderDnsmasqConfig(plan);
  const firstHost = plan.hostnames[0];
  const sessionHost = "session.sylion.internal";
  return `set -euo pipefail
conf=${shellQuote(plan.configPath)}
tmp="$(mktemp)"
cat > "$tmp" <<'SYLION_DNSMASQ'
${config}SYLION_DNSMASQ
sudo install -d -m 0755 "$(dirname "$conf")"
sudo install -m 0644 "$tmp" "$conf"
rm -f "$tmp"
sudo dnsmasq --test >/tmp/sylion-g1-dnsmasq-test 2>&1
sudo systemctl restart dnsmasq
sleep 1
printf 'dnsmasq=%s\\n' "$(systemctl is-active dnsmasq 2>/dev/null || true)"
printf 'first_lookup=%s\\n' "$(dig +short @${plan.dnsListenAddress} ${firstHost} 2>/dev/null | tr '\\n' ',' | sed 's/,$//' || true)"
printf 'session_lookup=%s\\n' "$(dig +short @${plan.dnsListenAddress} ${sessionHost} 2>/dev/null | tr '\\n' ',' | sed 's/,$//' || true)"
printf 'record_count=%s\\n' "$(grep -c '^address=/' "$conf" || true)"
`;
}

async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out after ${options.timeout ?? 60_000}ms: ${command}`));
    }, options.timeout ?? 60_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        const error = new Error(`Command failed with code ${code ?? signal}: ${command}`);
        error.code = code;
        error.signal = signal;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
    child.stdin.end(options.input || "");
  });
}

async function main() {
  if (process.argv.includes("--print-plan")) {
    console.log(JSON.stringify(g1DnsPlan, null, 2));
    return;
  }
  if (process.argv.includes("--render-config")) {
    console.log(renderDnsmasqConfig());
    return;
  }
  if (process.argv.includes("--render-remote-script")) {
    console.log(renderRemoteScript());
    return;
  }
  if (!apply || confirmation !== "INSTALL_G1_DNS") {
    console.log(JSON.stringify({
      ...g1DnsPlan,
      mode: "blocked_before_apply",
      applied: false,
      blockers: [
        ...(apply ? [] : ["apply_flag_missing"]),
        ...(confirmation === "INSTALL_G1_DNS" ? [] : ["confirmation_phrase_missing"])
      ]
    }, null, 2));
    return;
  }
  const { stdout } = await run("ssh", [
    "-i",
    sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=accept-new",
    target,
    "bash -s"
  ], {
    input: renderRemoteScript(),
    timeout: 120_000
  });
  console.log(JSON.stringify({
    ...g1DnsPlan,
    mode: "applied",
    applied: true,
    evidence: Object.fromEntries(stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [key, ...rest] = line.split("=");
      return [key, rest.join("=")];
    }))
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
