import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";

const cfg = {
  sshKey: process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey,
  workload: process.env.SYLION_WORKLOAD_NATIVE_SSH || "root@65.109.123.72",
  g2: process.env.SYLION_G2_SSH || "sylion@178.105.203.31",
  workloadPrivate: process.env.SYLION_WORKLOAD_NATIVE_PRIVATE_IP || "10.44.0.13",
  g2Private: process.env.SYLION_G2_PRIVATE_IP || "10.42.0.12",
  appKey: process.env.SYLION_STREAM_SMOKE_APP || "duckduckgo",
  hostPort: Number(process.env.SYLION_STREAM_SMOKE_PORT || 3001),
  guestIp: process.env.SYLION_STREAM_SMOKE_GUEST_IP || "172.16.56.2",
  hostTapIp: process.env.SYLION_STREAM_SMOKE_TAP_IP || "172.16.56.1",
  tap: process.env.SYLION_STREAM_SMOKE_TAP || "sylionfc0",
  runId: process.env.SYLION_STREAM_SMOKE_RUN_ID || `stream-smoke-${Date.now()}`
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

function remoteLaunchScript() {
  return `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get install -y --no-install-recommends jq qemu-utils socat >/dev/null
run_id="${cfg.runId}"
app_key="${cfg.appKey}"
base="/opt/sylion-firecracker/images/base/noble-base.ext4"
kernel="/opt/sylion/firecracker/smoke/vmlinux.bin"
run_dir="/opt/sylion-firecracker/runs/$run_id"
rootfs="$run_dir/rootfs.ext4"
tap="${cfg.tap}"
guest_ip="${cfg.guestIp}"
host_tap_ip="${cfg.hostTapIp}"
workload_private="${cfg.workloadPrivate}"
host_port="${cfg.hostPort}"
mkdir -p "$run_dir" /opt/sylion-workloads/evidence
if [ ! -f "$base" ]; then echo "missing_base_rootfs" >&2; exit 2; fi
if [ ! -f "$kernel" ]; then echo "missing_firecracker_kernel" >&2; exit 2; fi
cp --reflink=auto "$base" "$rootfs"
mount_dir="$(mktemp -d /mnt/sylion-stream-rootfs.XXXXXX)"
cleanup_mount() {
  if mountpoint -q "$mount_dir/sys"; then umount "$mount_dir/sys"; fi
  if mountpoint -q "$mount_dir/proc"; then umount "$mount_dir/proc"; fi
  if mountpoint -q "$mount_dir/dev"; then umount "$mount_dir/dev"; fi
  if mountpoint -q "$mount_dir"; then umount "$mount_dir"; fi
  rmdir "$mount_dir" 2>/dev/null || true
}
trap cleanup_mount EXIT
mount -o loop "$rootfs" "$mount_dir"
mount --bind /dev "$mount_dir/dev"
mount -t proc proc "$mount_dir/proc"
mount -t sysfs sysfs "$mount_dir/sys"
cp /etc/resolv.conf "$mount_dir/etc/resolv.conf"
chroot "$mount_dir" apt-get update >/dev/null
chroot "$mount_dir" apt-get install -y --no-install-recommends systemd-sysv python3 iproute2 ca-certificates >/dev/null
mkdir -p "$mount_dir/etc/systemd/network" "$mount_dir/opt/sylion-stream"
cat > "$mount_dir/etc/systemd/network/10-eth0.network" <<EOF
[Match]
Name=eth0

[Network]
Address=$guest_ip/30
Gateway=$host_tap_ip
DNS=$host_tap_ip
EOF
cat > "$mount_dir/opt/sylion-stream/index.html" <<EOF
<!doctype html>
<html>
  <head><meta charset="utf-8"><title>SYLION ${cfg.appKey} Firecracker Stream Smoke</title></head>
  <body style="font-family: system-ui; background:#071014; color:#e8fff7; margin:40px">
    <h1>SYLION ${cfg.appKey} Firecracker Stream Smoke</h1>
    <p>Rendered from a Firecracker microVM on WORKLOAD_NATIVE AX102.</p>
    <p>Path: Pixel -> G1 -> G2 -> IPsec -> AX102 -> Firecracker microVM.</p>
    <p>Terminal data stored: false. Production execution allowed: false.</p>
  </body>
</html>
EOF
cat > "$mount_dir/sbin/sylion-init" <<'EOF'
#!/bin/sh
set -eu
mount -t proc proc /proc 2>/dev/null || true
mount -t sysfs sysfs /sys 2>/dev/null || true
mount -t devtmpfs devtmpfs /dev 2>/dev/null || true
ip link set lo up
iface=""
for candidate in /sys/class/net/*; do
  name="$(basename "$candidate")"
  if [ "$name" != "lo" ]; then iface="$name"; break; fi
done
if [ -z "$iface" ]; then
  echo "sylion-init: no workload interface found" >&2
  exec sh
fi
ip addr add ${cfg.guestIp}/30 dev "$iface" 2>/dev/null || true
ip link set "$iface" up
ip route replace default via ${cfg.hostTapIp} dev "$iface" 2>/dev/null || true
cd /opt/sylion-stream
exec /usr/bin/python3 -m http.server 6080 --bind 0.0.0.0
EOF
chmod 0755 "$mount_dir/sbin/sylion-init"
chroot "$mount_dir" systemctl enable systemd-networkd >/dev/null
chroot "$mount_dir" systemctl disable systemd-networkd-wait-online.service >/dev/null 2>&1 || true
cleanup_mount
trap - EXIT
pkill -f "firecracker.*$run_dir/config.json" 2>/dev/null || true
pkill -f "socat TCP-LISTEN:$host_port,bind=$workload_private" 2>/dev/null || true
ip link show "$tap" >/dev/null 2>&1 && ip link del "$tap" || true
ip tuntap add dev "$tap" mode tap
ip addr add "$host_tap_ip/30" dev "$tap"
ip link set "$tap" up
cat > "$run_dir/config.json" <<EOF
{
  "boot-source": {
    "kernel_image_path": "$kernel",
    "boot_args": "console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw init=/sbin/sylion-init"
  },
  "drives": [
    {
      "drive_id": "rootfs",
      "path_on_host": "$rootfs",
      "is_root_device": true,
      "is_read_only": false
    }
  ],
  "network-interfaces": [
    {
      "iface_id": "eth0",
      "guest_mac": "AA:FC:00:00:56:02",
      "host_dev_name": "$tap"
    }
  ],
  "machine-config": {
    "vcpu_count": 1,
    "mem_size_mib": 512,
    "smt": false,
    "track_dirty_pages": false
  }
}
EOF
setsid firecracker --no-api --config-file "$run_dir/config.json" > "$run_dir/serial.log" 2>&1 &
echo $! > "$run_dir/firecracker.pid"
for i in $(seq 1 30); do
  if timeout 2 bash -lc "</dev/tcp/$guest_ip/6080" 2>/dev/null; then break; fi
  sleep 1
done
setsid socat TCP-LISTEN:$host_port,bind=$workload_private,reuseaddr,fork TCP:$guest_ip:6080 > "$run_dir/socat.log" 2>&1 &
echo $! > "$run_dir/socat.pid"
sleep 1
host_code="$(curl -sS -o "$run_dir/host-body.html" -w "%{http_code}" --max-time 5 "http://$workload_private:$host_port/" || true)"
boot_markers="$(grep -Eic 'Linux version|Freeing unused kernel|systemd|Reached target|Started' "$run_dir/serial.log" || true)"
jq -n \
  --arg checkedAt "$(date -Is)" \
  --arg runId "$run_id" \
  --arg runDir "$run_dir" \
  --arg appKey "$app_key" \
  --arg workloadPrivate "$workload_private" \
  --argjson hostPort "$host_port" \
  --arg guestIp "$guest_ip" \
  --arg tap "$tap" \
  --arg hostCode "$host_code" \
  --argjson bootMarkers "$boot_markers" \
  '{component:"native_firecracker_stream_smoke", checkedAt:$checkedAt, runId:$runId, runDir:$runDir, appKey:$appKey, workloadPrivate:$workloadPrivate, hostPort:$hostPort, guestIp:$guestIp, tap:$tap, hostHttpCode:$hostCode, bootMarkers:$bootMarkers, ready:($hostCode=="200" and $bootMarkers>0), terminalDataStored:false, secretsPrinted:false, productionExecutionAllowed:false}' | tee /opt/sylion-workloads/evidence/native-firecracker-stream-smoke.json
`;
}

async function verifyFromG2() {
  const script = `
set -euo pipefail
code="$(curl -k -sS -o /tmp/sylion-native-stream-smoke.html -w "%{http_code}" --resolve ${cfg.appKey}.sylion.internal:443:${cfg.g2Private} --max-time 8 https://${cfg.appKey}.sylion.internal/ || true)"
headers="$(curl -k -sS -I --resolve ${cfg.appKey}.sylion.internal:443:${cfg.g2Private} --max-time 8 https://${cfg.appKey}.sylion.internal/ | tr '\\r\\n' ' ' || true)"
grep -q 'Firecracker Stream Smoke' /tmp/sylion-native-stream-smoke.html && marker=true || marker=false
echo "code=$code"
echo "marker=$marker"
echo "$headers" | grep -q 'X-Sylion-Workload-Gateway: g2' && echo g2_header=true || echo g2_header=false
echo "$headers" | grep -q 'X-Sylion-Terminal-Data-Stored: false' && echo terminal_header=true || echo terminal_header=false
`;
  const { stdout } = await ssh(cfg.g2, script, { timeout: 30_000 });
  return Object.fromEntries(stdout.split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const [key, ...rest] = line.split("=");
    const value = rest.join("=");
    if (value === "true") return [key, true];
    if (value === "false") return [key, false];
    return [key, value];
  }));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--apply")) {
    console.log(JSON.stringify({
      component: "native_firecracker_stream_smoke",
      action: "plan_only",
      appKey: cfg.appKey,
      workload: cfg.workload,
      g2: cfg.g2,
      hostEndpoint: `${cfg.workloadPrivate}:${cfg.hostPort}`,
      productionExecutionAllowed: false
    }, null, 2));
    return;
  }
  const launched = await ssh(cfg.workload, remoteLaunchScript(), { timeout: 900_000 });
  const evidence = JSON.parse(launched.stdout.slice(launched.stdout.indexOf("{"), launched.stdout.lastIndexOf("}") + 1));
  const g2 = await verifyFromG2();
  const result = {
    evidence,
    g2,
    readyThroughG2: evidence.ready === true && g2.code === "200" && g2.marker === true && g2.g2_header === true && g2.terminal_header === true,
    productionExecutionAllowed: false
  };
  console.log(JSON.stringify(result, null, 2));
  if (args.has("--require-ready") && !result.readyThroughG2) {
    process.exitCode = 1;
  }
}

await main();
