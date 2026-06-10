import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { AdminApiClient } from "../services/admin-api/src/sdk/adminApiClient.js";

const execFileAsync = promisify(execFile);

const defaultSshKey =
  process.platform === "win32"
    ? ".deploy\\sylion_hetzner_admin_ed25519"
    : ".deploy/sylion_hetzner_admin_ed25519";

const config = {
  adminBaseUrl: process.env.SYLION_ADMIN_BASE_URL || "http://127.0.0.1:18111",
  adminEmail: process.env.SYLION_ADMIN_EMAIL || "admin@sylion.local",
  adminPassword: process.env.SYLION_ADMIN_PASSWORD || "ChangeMe-LocalOnly-1!",
  hostId: process.env.SYLION_WORKLOAD_NATIVE_HOST_ID || "WORKLOAD_NATIVE_LAB_01",
  nativeSsh: process.env.SYLION_WORKLOAD_NATIVE_SSH || "root@65.109.123.72",
  sshKey: process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey
};

function args() {
  const input = new Set(process.argv.slice(2));
  return {
    apply: input.has("--apply"),
    requireReady: input.has("--require-ready")
  };
}

async function run(command, argv, options = {}) {
  const result = await execFileAsync(command, argv, {
    timeout: options.timeout ?? 60_000,
    windowsHide: true,
    input: options.input
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function ssh(script, options = {}) {
  return run(
    "ssh",
    [
      "-i",
      config.sshKey,
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      config.nativeSsh,
      script
    ],
    options
  );
}

async function scp(localPath, remoteTarget) {
  return run("scp", [
    "-i",
    config.sshKey,
    "-o",
    "StrictHostKeyChecking=accept-new",
    localPath,
    `${config.nativeSsh}:${remoteTarget}`
  ]);
}

async function login() {
  const anon = new AdminApiClient({
    baseUrl: config.adminBaseUrl,
    correlationIdFactory: () => `corr_native_manifest_preflight_${crypto.randomUUID()}`
  });
  const credentialId = `cred-native-manifest-preflight-${crypto.randomUUID()}`;
  const enrollment = await anon.createEnrollmentOptions({
    email: config.adminEmail,
    password: config.adminPassword
  });
  await anon.verifyEnrollment({
    challengeId: enrollment.challenge.id,
    credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
  });
  const loginOptions = await anon.createWebAuthnLoginOptions({
    email: config.adminEmail,
    password: config.adminPassword
  });
  const session = await anon.verifyWebAuthnLogin({
    challengeId: loginOptions.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${loginOptions.challenge.id}:${credentialId}`,
      signCounter: 1
    }
  });
  return anon.withToken(session.token);
}

function sanitizeManifest(manifest) {
  return {
    id: manifest.id,
    hostId: manifest.hostId,
    appKey: manifest.appKey,
    appName: manifest.appName,
    runtimeKind: manifest.runtimeKind,
    imageRef: manifest.imageRef,
    kernelRef: manifest.kernelRef,
    rootfsRef: manifest.rootfsRef,
    packageRef: manifest.packageRef,
    cdrPolicyRef: manifest.cdrPolicyRef,
    streamGateway: manifest.streamGateway,
    checks: manifest.checks,
    readyForLabLaunch: manifest.readyForLabLaunch,
    readyForProduction: manifest.readyForProduction,
    productionExecutionAllowed: manifest.productionExecutionAllowed,
    terminalDataStored: manifest.terminalDataStored,
    secretsReleaseAllowed: manifest.secretsReleaseAllowed,
    productionBlockers: manifest.productionBlockers,
    nextActions: manifest.nextActions
  };
}

function remotePreflightScript({ apply, manifestCount, ports }) {
  const portList = ports.map((port) => String(port)).join(" ");
  return `
set -euo pipefail
apply="${apply ? "true" : "false"}"
manifest_count="${manifestCount}"
ports="${portList}"
mkdir -p /opt/sylion-workloads/manifests /opt/sylion-workloads/evidence
kvm="$(test -e /dev/kvm && echo true || echo false)"
firecracker="$(command -v firecracker >/dev/null 2>&1 && firecracker --version 2>/dev/null | head -1 || echo missing)"
jailer="$(command -v jailer >/dev/null 2>&1 && jailer --version 2>/dev/null | head -1 || echo missing)"
auditd="$(systemctl is-active auditd 2>/dev/null || true)"
apparmor="$(systemctl is-active apparmor 2>/dev/null || true)"
public_listens=""
for port in $ports; do
  if ss -ltnH "( sport = :$port )" | awk '{print $4}' | grep -Ev '^(127\\.0\\.0\\.1|\\[::1\\]|10\\.|172\\.16\\.|192\\.168\\.)' >/dev/null; then
    public_listens="\${public_listens}\${port} "
  fi
done
ready=true
blockers=""
if [ "$kvm" != "true" ]; then ready=false; blockers="\${blockers}missing_kvm "; fi
if [ "$firecracker" = "missing" ]; then ready=false; blockers="\${blockers}missing_firecracker "; fi
if [ "$jailer" = "missing" ]; then ready=false; blockers="\${blockers}missing_jailer "; fi
if [ "$manifest_count" = "0" ]; then ready=false; blockers="\${blockers}missing_manifests "; fi
if [ -n "$public_listens" ]; then ready=false; blockers="\${blockers}public_stream_port_listening "; fi
evidence="/opt/sylion-workloads/evidence/native-manifest-preflight.json"
jq -n \
  --arg checkedAt "$(date -Is)" \
  --argjson apply "$apply" \
  --argjson manifestCount "$manifest_count" \
  --argjson kvm "$kvm" \
  --arg firecracker "$firecracker" \
  --arg jailer "$jailer" \
  --arg auditd "$auditd" \
  --arg apparmor "$apparmor" \
  --arg publicListens "$public_listens" \
  --arg blockers "$blockers" \
  --argjson ready "$ready" \
  '{component:"workload_native_manifest_preflight", checkedAt:$checkedAt, applied:$apply, manifestCount:$manifestCount, host:{kvm:$kvm, firecracker:$firecracker, jailer:$jailer, auditd:$auditd, apparmor:$apparmor}, publicStreamPorts:$publicListens, readyForLabImageBuild:$ready, blockers:($blockers | split(" ") | map(select(length>0))), terminalDataStored:false, secretsPrinted:false, productionExecutionAllowed:false}' | tee "$evidence"
`;
}

async function writeManifestBundle(manifests) {
  const dir = await mkdtemp(join(tmpdir(), "sylion-native-manifests-"));
  const bundlePath = join(dir, "workload-image-manifests.json");
  await writeFile(
    bundlePath,
    JSON.stringify(
      {
        hostId: config.hostId,
        generatedAt: new Date().toISOString(),
        manifests: manifests.map(sanitizeManifest)
      },
      null,
      2
    )
  );
  return bundlePath;
}

async function main() {
  const options = args();
  const client = await login();
  const payload = await client.listWorkloadImageManifests();
  const manifests = (payload.manifests || []).filter(
    (manifest) => manifest.hostId === config.hostId
  );
  const ports = manifests
    .map((manifest) => manifest.streamGateway?.sourcePort)
    .filter((port) => Number.isInteger(Number(port)));
  const bundlePath = await writeManifestBundle(manifests);
  if (options.apply) {
    await ssh("mkdir -p /opt/sylion-workloads/manifests /opt/sylion-workloads/evidence");
    await scp(bundlePath, "/opt/sylion-workloads/manifests/workload-image-manifests.json");
  }
  const remote = await ssh(
    remotePreflightScript({
      apply: options.apply,
      manifestCount: manifests.length,
      ports
    }),
    { timeout: 60_000 }
  );
  const evidence = JSON.parse(
    remote.stdout.slice(remote.stdout.indexOf("{"), remote.stdout.lastIndexOf("}") + 1)
  );
  console.log(
    JSON.stringify(
      {
        hostId: config.hostId,
        manifestCount: manifests.length,
        applied: options.apply,
        evidence,
        productionExecutionAllowed: false
      },
      null,
      2
    )
  );
  if (options.requireReady && !evidence.readyForLabImageBuild) {
    process.exitCode = 1;
  }
}

await main();
