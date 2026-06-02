import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";

const forwardPlan = {
  step: "3.80",
  component: "workload_guacamole_tls_vnc_forwards",
  workload: {
    host: process.env.SYLION_WORKLOAD_NATIVE_SSH || "root@65.109.123.72",
    privateAddress: process.env.SYLION_WORKLOAD_NATIVE_PRIVATE_IP || "10.44.0.13",
    evidencePath: "/opt/sylion-workloads/evidence/guacamole-vnc-forwards.json"
  },
  verifier: {
    g2Host: process.env.SYLION_G2_SSH || "sylion@178.105.203.31",
    g2PrivateAddress: process.env.SYLION_G2_PRIVATE_IP || "10.42.0.12"
  },
  forwards: [
    {
      key: "duckduckgo_browser",
      label: "SYLION DuckDuckGo Browser",
      mode: "desktop",
      bindPort: 5901,
      targetHost: "172.16.58.2",
      targetPort: 5900,
      labWebPort: 3001,
      required: true
    },
    {
      key: "libreoffice",
      label: "SYLION LibreOffice",
      mode: "desktop",
      bindPort: 5902,
      targetHost: "172.16.58.6",
      targetPort: 5900,
      labWebPort: 3002,
      required: true
    },
    {
      key: "whatsapp",
      label: "SYLION WhatsApp",
      mode: "desktop_web",
      bindPort: 5910,
      targetHost: "172.16.58.10",
      targetPort: 5900,
      labWebPort: 3010,
      required: true
    },
    {
      key: "protonmail",
      label: "SYLION Proton Mail",
      mode: "desktop_web",
      bindPort: 5917,
      targetHost: "172.16.58.26",
      targetPort: 5900,
      labWebPort: 3016,
      required: true
    },
    {
      key: "simplex",
      label: "SYLION SimpleX Chat",
      mode: "desktop_or_android_gate",
      bindPort: 5918,
      targetHost: "172.16.58.34",
      targetPort: 5900,
      labWebPort: 3017,
      required: false,
      blockerIfMissing: "simplex_desktop_or_android_image_required"
    },
    {
      key: "telegram",
      label: "SYLION Telegram",
      mode: "desktop_web",
      bindPort: 5911,
      targetHost: "172.16.58.14",
      targetPort: 5900,
      labWebPort: 3011,
      required: true
    },
    {
      key: "threema",
      label: "SYLION Threema",
      mode: "desktop_web",
      bindPort: 5912,
      targetHost: "172.16.58.18",
      targetPort: 5900,
      labWebPort: 3012,
      required: true
    },
    {
      key: "signal",
      label: "SYLION Signal",
      mode: "desktop",
      bindPort: 5913,
      targetHost: "172.16.58.22",
      targetPort: 5900,
      labWebPort: 3013,
      required: true
    },
    {
      key: "zangi",
      label: "SYLION Zangi Android Native",
      mode: "android_native_lab",
      bindPort: 5916,
      targetHost: "127.0.0.1",
      targetPort: 5916,
      labWebPort: 3014,
      required: true
    },
    {
      key: "exodus",
      label: "SYLION Exodus",
      mode: "desktop",
      bindPort: 5915,
      targetHost: "172.16.58.30",
      targetPort: 5900,
      labWebPort: 3015,
      required: false,
      blockerIfMissing: "exodus_firecracker_vnc_target_not_live"
    }
  ],
  invariants: {
    privateBindOnly: true,
    publicInternetExposure: false,
    terminalDataStored: false,
    noVncProductionApproved: false,
    guacamoleUsesRawVnc: false,
    guacamoleUsesEncryptedVncEgress: true,
    g2ToWorkloadTransport: "tls_stunnel_private_bind",
    cdrRequiredForFileTransfer: true
  }
};

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function publicPlan(input = forwardPlan) {
  return {
    ...input,
    sshKeyPrinted: false,
    forwards: input.forwards.map((forward) => ({
      ...forward,
      bindAddress: input.workload.privateAddress,
      tlsBindPort: forward.bindPort + 20000,
      rawVncExposedToPublicInternet: false,
      g2ToWorkloadTransport: "tls_stunnel_private_bind"
    }))
  };
}

function renderRemoteScript(input = forwardPlan) {
  const forwardsB64 = encodeJson(input.forwards);
  const evidencePath = input.workload.evidencePath;
  const privateAddress = input.workload.privateAddress;
  return `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update >/dev/null
apt-get install -y --no-install-recommends jq openssl stunnel4 >/dev/null
mkdir -p "$(dirname ${shellQuote(evidencePath)})"
install -d -m 0700 /etc/sylion/guacamole-egress
if [ ! -s /etc/sylion/guacamole-egress/workload-stunnel.key ] || [ ! -s /etc/sylion/guacamole-egress/workload-stunnel.crt ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -sha384 -days 90 \
    -subj '/CN=sylion-workload-guacamole-vnc.internal' \
    -keyout /etc/sylion/guacamole-egress/workload-stunnel.key \
    -out /etc/sylion/guacamole-egress/workload-stunnel.crt >/dev/null 2>&1
  chmod 0600 /etc/sylion/guacamole-egress/workload-stunnel.key
  chmod 0644 /etc/sylion/guacamole-egress/workload-stunnel.crt
fi
forwards_json="$(mktemp)"
entries_jsonl="$(mktemp)"
printf %s ${shellQuote(forwardsB64)} | base64 -d > "$forwards_json"
bind_address=${shellQuote(privateAddress)}

jq -c '.[]' "$forwards_json" | while IFS= read -r forward; do
  key="$(printf %s "$forward" | jq -r '.key')"
  label="$(printf %s "$forward" | jq -r '.label')"
  mode="$(printf %s "$forward" | jq -r '.mode')"
  bind_port="$(printf %s "$forward" | jq -r '.bindPort')"
  tls_bind_port="$((bind_port + 20000))"
  target_host="$(printf %s "$forward" | jq -r '.targetHost')"
  target_port="$(printf %s "$forward" | jq -r '.targetPort')"
  lab_web_port="$(printf %s "$forward" | jq -r '.labWebPort')"
  required="$(printf %s "$forward" | jq -r '.required')"
  blocker_if_missing="$(printf %s "$forward" | jq -r '.blockerIfMissing // empty')"
  pid_file="/run/sylion-guacamole-tls-vnc-$key.pid"
  log_file="/var/log/sylion-guacamole-tls-vnc-$key.log"
  conf_file="/etc/sylion/guacamole-egress/$key-stunnel.conf"

  if [ -s "$pid_file" ]; then
    old_pid="$(cat "$pid_file" || true)"
    if [ -n "$old_pid" ]; then kill "$old_pid" 2>/dev/null || true; fi
    rm -f "$pid_file"
  fi
  pkill -f "stunnel.*$key-stunnel.conf" 2>/dev/null || true

  target_reachable=false
  if timeout 3 bash -lc "cat < /dev/null > /dev/tcp/$target_host/$target_port" 2>/dev/null; then
    target_reachable=true
  fi

  started=false
  bind_ready=false
  blocker=""
  if [ "$target_reachable" = true ]; then
    cat > "$conf_file" <<EOF_STUNNEL
foreground = yes
debug = notice
output = $log_file
pid =

[sylion-$key-vnc]
accept = $bind_address:$tls_bind_port
connect = $target_host:$target_port
cert = /etc/sylion/guacamole-egress/workload-stunnel.crt
key = /etc/sylion/guacamole-egress/workload-stunnel.key
TIMEOUTclose = 0
EOF_STUNNEL
    chmod 0600 "$conf_file"
    nohup stunnel "$conf_file" >/dev/null 2>&1 &
    pid="$!"
    printf '%s\\n' "$pid" > "$pid_file"
    sleep 0.5
    if kill -0 "$pid" 2>/dev/null; then started=true; fi
    if ss -ltn | grep -q "\${bind_address}:\${tls_bind_port}"; then bind_ready=true; fi
  else
    if [ -n "$blocker_if_missing" ]; then
      blocker="$blocker_if_missing"
    elif [ "$required" = true ]; then
      blocker="\${key}_vnc_target_unreachable"
    else
      blocker="\${key}_optional_vnc_target_unreachable"
    fi
  fi

  jq -nc \
    --arg key "$key" \
    --arg label "$label" \
    --arg mode "$mode" \
    --arg bindAddress "$bind_address" \
    --argjson bindPort "$bind_port" \
    --argjson tlsBindPort "$tls_bind_port" \
    --arg targetHost "$target_host" \
    --argjson targetPort "$target_port" \
    --argjson labWebPort "$lab_web_port" \
    --argjson required "$required" \
    --argjson targetReachable "$target_reachable" \
    --argjson started "$started" \
    --argjson bindReady "$bind_ready" \
    --arg blocker "$blocker" \
    '{
      key: $key,
      label: $label,
      mode: $mode,
      bindAddress: $bindAddress,
      bindPort: $bindPort,
      tlsBindPort: $tlsBindPort,
      target: { host: $targetHost, port: $targetPort },
      labWebPort: $labWebPort,
      required: $required,
      targetReachable: $targetReachable,
      started: $started,
      bindReady: $bindReady,
      publicInternetExposure: false,
      rawVncPrivateBind: false,
      g2ToWorkloadTransport: "tls_stunnel_private_bind",
      serverCertificateVerification: "fingerprint_pinning_required_before_human_gate",
      blocker: (if $blocker == "" then null else $blocker end)
    }' >> "$entries_jsonl"
done

jq -s \
  --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg component "workload_guacamole_tls_vnc_forwards" \
  '{
    component: $component,
    generatedAt: $generatedAt,
    privateBindOnly: true,
    publicInternetExposure: false,
    terminalDataStored: false,
    noVncProductionApproved: false,
    guacamoleUsesRawVnc: false,
    guacamoleUsesEncryptedVncEgress: true,
    g2ToWorkloadTransport: "tls_stunnel_private_bind",
    productionExecutionAllowed: false,
    forwards: .,
    blockers: ([.[].blocker] | map(select(. != null)))
  }' "$entries_jsonl" > ${shellQuote(evidencePath)}
chmod 0640 ${shellQuote(evidencePath)}
cat ${shellQuote(evidencePath)}
`;
}

function renderG2VerificationScript(input = forwardPlan) {
  const forwardsB64 = encodeJson(input.forwards);
  return `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update >/dev/null
sudo apt-get install -y --no-install-recommends jq openssl >/dev/null
forwards_json="$(mktemp)"
entries_jsonl="$(mktemp)"
printf %s ${shellQuote(forwardsB64)} | base64 -d > "$forwards_json"
  target_host=${shellQuote(input.workload.privateAddress)}
jq -c '.[]' "$forwards_json" | while IFS= read -r forward; do
  key="$(printf %s "$forward" | jq -r '.key')"
  bind_port="$(printf %s "$forward" | jq -r '.bindPort')"
  tls_bind_port="$((bind_port + 20000))"
  banner=""
  reachable=false
  if banner="$(timeout 6 bash -lc "openssl s_client -connect $target_host:$tls_bind_port -servername sylion-workload-guacamole-vnc.internal -quiet </dev/null 2>/dev/null | dd bs=1 count=12 2>/dev/null" | tr -d '\\r\\n' || true)"; then
    if printf %s "$banner" | grep -q '^RFB'; then reachable=true; fi
  fi
  jq -nc \
    --arg key "$key" \
    --arg host "$target_host" \
    --argjson port "$tls_bind_port" \
    --arg banner "$banner" \
    --argjson reachable "$reachable" \
    '{key:$key, host:$host, port:$port, transport:"tls_stunnel_private_bind", rfbBanner:$banner, reachable:$reachable}' >> "$entries_jsonl"
done
jq -s --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{
  component: "g2_to_workload_tls_vnc_verification",
  generatedAt: $generatedAt,
  g2ToWorkloadTransport: "tls_stunnel_private_bind",
  terminalDataStored: false,
  results: .,
  blockers: ([.[] | select(.reachable != true) | .key + "_tls_vnc_unreachable_from_g2"])
}' "$entries_jsonl"
`;
}

export {
  forwardPlan,
  publicPlan,
  renderRemoteScript,
  renderG2VerificationScript
};

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout ?? 60_000,
    windowsHide: true,
    input: options.input
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function ssh(host, script, input = forwardPlan, options = {}) {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  return run("ssh", [
    "-i",
    process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    host,
    `printf %s ${shellQuote(encoded)} | base64 -d | bash`
  ], { timeout: options.timeout ?? 300_000, input });
}

async function apply(input = forwardPlan) {
  const workloadResult = await ssh(input.workload.host, renderRemoteScript(input), input, { timeout: 420_000 });
  const verificationResult = await ssh(input.verifier.g2Host, renderG2VerificationScript(input), input, { timeout: 120_000 });
  console.log(JSON.stringify({
    component: input.component,
    workloadEvidence: JSON.parse(workloadResult.stdout),
    g2Verification: JSON.parse(verificationResult.stdout),
    secretsPrinted: false
  }, null, 2));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--print-plan")) {
    console.log(JSON.stringify(publicPlan(), null, 2));
    return;
  }
  if (args.has("--render-remote-script")) {
    console.log(renderRemoteScript());
    return;
  }
  if (args.has("--render-g2-verification-script")) {
    console.log(renderG2VerificationScript());
    return;
  }
  if (args.has("--apply")) {
    await apply();
    return;
  }
  console.error("Usage: node scripts/install-workload-guacamole-vnc-forwards.mjs --print-plan|--render-remote-script|--render-g2-verification-script|--apply");
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
