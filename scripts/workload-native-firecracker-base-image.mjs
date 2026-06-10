import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSshKey =
  process.platform === "win32"
    ? ".deploy\\sylion_hetzner_admin_ed25519"
    : ".deploy/sylion_hetzner_admin_ed25519";

const config = {
  nativeSsh: process.env.SYLION_WORKLOAD_NATIVE_SSH || "root@65.109.123.72",
  sshKey: process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey,
  imageSizeGiB: Number(process.env.SYLION_FIRECRACKER_BASE_IMAGE_GIB || 4),
  suite: process.env.SYLION_FIRECRACKER_BASE_SUITE || "noble",
  mirror: process.env.SYLION_FIRECRACKER_BASE_MIRROR || "http://archive.ubuntu.com/ubuntu"
};

function parseArgs() {
  const input = new Set(process.argv.slice(2));
  return {
    apply: input.has("--apply"),
    force: input.has("--force")
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

function remotePlanScript({ apply, force }) {
  return `
set -euo pipefail
apply="${apply ? "true" : "false"}"
force="${force ? "true" : "false"}"
suite="${config.suite}"
mirror="${config.mirror}"
image_size_gib="${config.imageSizeGiB}"
image_dir="/opt/sylion-firecracker/images/base"
image_path="$image_dir/${config.suite}-base.ext4"
mount_dir="/mnt/sylion-fc-base"
evidence_dir="/opt/sylion-workloads/evidence"
mkdir -p "$image_dir" "$evidence_dir"
if [ "$apply" != "true" ]; then
  jq -n --arg imagePath "$image_path" --arg suite "$suite" --arg mirror "$mirror" --argjson imageSizeGiB "$image_size_gib" '{component:"workload_native_firecracker_base_image", planned:true, applied:false, imagePath:$imagePath, suite:$suite, mirror:$mirror, imageSizeGiB:$imageSizeGiB, productionExecutionAllowed:false, terminalDataStored:false}'
  exit 0
fi
if [ -f "$image_path" ] && [ "$force" != "true" ]; then
  status="already_exists"
else
  export DEBIAN_FRONTEND=noninteractive
  if ! command -v debootstrap >/dev/null 2>&1; then
    apt-get update
    apt-get install -y --no-install-recommends debootstrap ca-certificates
  fi
  if ! command -v jq >/dev/null 2>&1; then
    apt-get update
    apt-get install -y --no-install-recommends jq
  fi
  rm -f "$image_path"
  truncate -s "${config.imageSizeGiB}G" "$image_path"
  mkfs.ext4 -F "$image_path" >/dev/null
  mkdir -p "$mount_dir"
  cleanup() {
    if mountpoint -q "$mount_dir"; then
      umount "$mount_dir"
    fi
  }
  trap cleanup EXIT
  mount -o loop "$image_path" "$mount_dir"
  debootstrap --variant=minbase "$suite" "$mount_dir" "$mirror"
  cat > "$mount_dir/etc/hostname" <<'EOF'
sylion-firecracker-base
EOF
  cat > "$mount_dir/etc/fstab" <<'EOF'
/dev/vda / ext4 defaults 0 1
EOF
  mkdir -p "$mount_dir/etc/systemd/system"
  cleanup
  status="built"
fi
sha256="$(sha256sum "$image_path" | awk '{print $1}')"
size_bytes="$(stat -c '%s' "$image_path")"
evidence="$evidence_dir/firecracker-base-image.json"
jq -n \
  --arg checkedAt "$(date -Is)" \
  --arg status "$status" \
  --arg imagePath "$image_path" \
  --arg suite "$suite" \
  --arg mirror "$mirror" \
  --arg sha256 "$sha256" \
  --argjson sizeBytes "$size_bytes" \
  '{component:"workload_native_firecracker_base_image", checkedAt:$checkedAt, applied:true, status:$status, imagePath:$imagePath, suite:$suite, mirror:$mirror, sha256:$sha256, sizeBytes:$sizeBytes, terminalDataStored:false, secretsPrinted:false, productionExecutionAllowed:false}' | tee "$evidence"
`;
}

async function main() {
  const options = parseArgs();
  if (!options.apply) {
    const plan = await ssh(remotePlanScript(options));
    console.log(plan.stdout);
    return;
  }
  const result = await ssh(remotePlanScript(options), { timeout: 900_000 });
  const evidence = JSON.parse(
    result.stdout.slice(result.stdout.indexOf("{"), result.stdout.lastIndexOf("}") + 1)
  );
  console.log(JSON.stringify(evidence, null, 2));
}

await main();
