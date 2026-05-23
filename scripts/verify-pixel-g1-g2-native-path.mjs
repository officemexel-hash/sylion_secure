import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";

const cfg = {
  sshKey: process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey,
  g1: process.env.SYLION_G1_SSH || "sylion@178.105.200.112",
  g2: process.env.SYLION_G2_SSH || "sylion@178.105.203.31",
  workload: process.env.SYLION_WORKLOAD_NATIVE_SSH || "root@65.109.123.72",
  g2Private: process.env.SYLION_G2_PRIVATE_IP || "10.42.0.12",
  workloadPrivate: process.env.SYLION_WORKLOAD_NATIVE_PRIVATE_IP || "10.44.0.13",
  connName: "sylion-g2-workload-native"
};

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
    cfg.sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    host,
    script
  ], options);
}

function parseBoolLine(output, key) {
  return new RegExp(`^${key}=true$`, "m").test(output);
}

async function verifyG1Pixel() {
  const script = `
set -euo pipefail
status="$(sudo -n swanctl --list-sas 2>/dev/null || sudo -n ipsec statusall 2>/dev/null || true)"
echo "$status" | grep -q 'pixel.OP-001@sylion.internal' && echo pixel_sa=true || echo pixel_sa=false
echo "$status" | grep -q '10.43.0.' && echo pixel_pool=true || echo pixel_pool=false
echo "$status" | grep -q '10.42.0.0/24' && echo g1_ts=true || echo g1_ts=false
`;
  const { stdout } = await ssh(cfg.g1, script);
  return {
    pixelSaEstablished: parseBoolLine(stdout, "pixel_sa"),
    pixelPoolPresent: parseBoolLine(stdout, "pixel_pool"),
    g1PrivateTrafficSelector: parseBoolLine(stdout, "g1_ts")
  };
}

async function verifyG2Workload() {
  const script = `
set -euo pipefail
status="$(sudo -n ipsec status ${cfg.connName} 2>/dev/null || true)"
ping -I ${cfg.g2Private} -c 2 -W 2 ${cfg.workloadPrivate} >/tmp/sylion-native-path-ping.log 2>&1 && ping_ok=true || ping_ok=false
grep -q '${cfg.workloadPrivate}' /etc/nginx/sites-available/sylion-g2-broker && broker_native=true || broker_native=false
ss -ltnH | awk '{print $4}' | grep -q '^${cfg.g2Private}:443$' && private_bind=true || private_bind=false
echo "$status" | grep -q 'ESTABLISHED' && echo ipsec_established=true || echo ipsec_established=false
echo "$status" | grep -q 'INSTALLED' && echo child_installed=true || echo child_installed=false
echo ping_ok=$ping_ok
echo broker_native=$broker_native
echo private_bind=$private_bind
`;
  const { stdout } = await ssh(cfg.g2, script);
  return {
    ipsecEstablished: parseBoolLine(stdout, "ipsec_established"),
    childInstalled: parseBoolLine(stdout, "child_installed"),
    pingOk: parseBoolLine(stdout, "ping_ok"),
    brokerTargetsNativeWorkload: parseBoolLine(stdout, "broker_native"),
    brokerPrivateBind: parseBoolLine(stdout, "private_bind")
  };
}

async function verifyWorkloadHost() {
  const script = `
set -euo pipefail
ip -4 addr show lo | grep -q '${cfg.workloadPrivate}/32' && echo private_ip=true || echo private_ip=false
test -e /dev/kvm && echo kvm=true || echo kvm=false
test -x /usr/local/bin/firecracker -o -x /opt/sylion/bin/firecracker && echo firecracker=true || echo firecracker=false
test -x /usr/local/bin/jailer -o -x /opt/sylion/bin/jailer && echo jailer=true || echo jailer=false
test -f /opt/sylion-workloads/evidence/firecracker-base-boot-smoke.json && echo boot_smoke=true || echo boot_smoke=false
test -f /opt/sylion-workloads/evidence/native-firecracker-stream-smoke.json && grep -q '"ready": true' /opt/sylion-workloads/evidence/native-firecracker-stream-smoke.json && echo stream_smoke=true || echo stream_smoke=false
test -f /opt/sylion-workloads/evidence/native-firecracker-gui-duckduckgo.json && grep -q '"ready": true' /opt/sylion-workloads/evidence/native-firecracker-gui-duckduckgo.json && echo duckduckgo_gui=true || echo duckduckgo_gui=false
for app in libreoffice whatsapp telegram threema signal; do
  test -f "/opt/sylion-workloads/evidence/native-firecracker-gui-$app.json" && grep -q '"ready": true' "/opt/sylion-workloads/evidence/native-firecracker-gui-$app.json" && echo "$app=true" || echo "$app=false"
done
`;
  const { stdout } = await ssh(cfg.workload, script);
  return {
    privateIpPresent: parseBoolLine(stdout, "private_ip"),
    kvmPresent: parseBoolLine(stdout, "kvm"),
    firecrackerPresent: parseBoolLine(stdout, "firecracker"),
    jailerPresent: parseBoolLine(stdout, "jailer"),
    baseBootSmokeEvidence: parseBoolLine(stdout, "boot_smoke"),
    nativeStreamSmokeEvidence: parseBoolLine(stdout, "stream_smoke"),
    nativeDuckDuckGoGuiEvidence: parseBoolLine(stdout, "duckduckgo_gui"),
    nativeLibreOfficeGuiEvidence: parseBoolLine(stdout, "libreoffice"),
    nativeWhatsAppGuiEvidence: parseBoolLine(stdout, "whatsapp"),
    nativeTelegramGuiEvidence: parseBoolLine(stdout, "telegram"),
    nativeThreemaGuiEvidence: parseBoolLine(stdout, "threema"),
    nativeSignalGuiEvidence: parseBoolLine(stdout, "signal")
  };
}

function allTrue(object) {
  return Object.values(object).every((value) => value === true);
}

async function verifyPixelHumanRegression() {
  try {
    const content = await readFile("docs/admin-panel-v2/test-artifacts/step3-40-pixel-live-human-regression/summary.json", "utf8");
    const summary = JSON.parse(content);
    return {
      ready: ["passed", "passed_with_known_gates"].includes(summary.status),
      status: summary.status ?? "unknown"
    };
  } catch {
    return {
      ready: false,
      status: "missing"
    };
  }
}

async function main() {
  const [g1Pixel, g2Workload, workloadHost, pixelHumanRegression] = await Promise.all([
    verifyG1Pixel(),
    verifyG2Workload(),
    verifyWorkloadHost(),
    verifyPixelHumanRegression()
  ]);
  const remainingBlockers = [
    "zangi_android_native_runner_not_built",
    "exodus_official_download_artifact_required",
    "hsm_backed_ca_pending"
  ];
  if (!pixelHumanRegression.ready) {
    remainingBlockers.splice(2, 0, "pixel_human_stream_click_regression_pending");
  }
  const result = {
    component: "pixel_g1_g2_native_workload_path",
    checkedAt: new Date().toISOString(),
    path: [
      "Pixel GrapheneOS terminal",
      "IKEv2/IPsec to G1",
      "G1 private selector 10.42.0.0/24",
      "G2 broker 10.42.0.12:443",
      "IKEv2/IPsec to WORKLOAD_NATIVE",
      "AX102 WORKLOAD_NATIVE 10.44.0.13",
      "Firecracker microVM layer"
    ],
    g1Pixel,
    g2Workload,
    workloadHost,
    pixelHumanRegression,
    readyForPrivateWorkloadStream: allTrue(g1Pixel) && allTrue(g2Workload) && allTrue(workloadHost),
    remainingBlockers,
    terminalDataStored: false,
    productionExecutionAllowed: false
  };
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes("--require-ready") && !result.readyForPrivateWorkloadStream) {
    process.exitCode = 1;
  }
}

await main();
