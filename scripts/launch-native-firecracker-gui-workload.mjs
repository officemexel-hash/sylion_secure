import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";

const profiles = {
  duckduckgo: {
    title: "SYLION DuckDuckGo",
    url: "https://duckduckgo.com/",
    installPackages: "python3 iproute2 ca-certificates xvfb openbox x11vnc netsurf-gtk fonts-dejavu-core",
    launchCommand: "netsurf-gtk https://duckduckgo.com/",
    hostPort: 3001,
    guestIp: "172.16.58.2",
    hostTapIp: "172.16.58.1",
    tap: "syliongui0",
    serverName: "duckduckgo.sylion.internal",
    guestMac: "AA:FC:00:00:58:02"
  },
  duckduckgo_browser: {
    aliasOf: "duckduckgo"
  },
  libreoffice: {
    title: "SYLION LibreOffice",
    url: "about:blank",
    installPackages: "python3 iproute2 ca-certificates xvfb openbox x11vnc libreoffice-writer libreoffice-calc fonts-dejavu-core",
    launchCommand: "libreoffice --writer --nologo --nofirststartwizard",
    hostPort: 3002,
    guestIp: "172.16.58.6",
    hostTapIp: "172.16.58.5",
    tap: "syliongui1",
    serverName: "libreoffice.sylion.internal",
    guestMac: "AA:FC:00:00:58:06"
  },
  whatsapp: {
    title: "SYLION WhatsApp Web",
    url: "https://web.whatsapp.com/",
    installPackages: "python3 iproute2 ca-certificates xvfb openbox x11vnc netsurf-gtk fonts-dejavu-core",
    launchCommand: "netsurf-gtk https://web.whatsapp.com/",
    hostPort: 3010,
    guestIp: "172.16.58.10",
    hostTapIp: "172.16.58.9",
    tap: "syliongui2",
    serverName: "whatsapp.sylion.internal",
    guestMac: "AA:FC:00:00:58:0A"
  },
  telegram: {
    title: "SYLION Telegram Web",
    url: "https://web.telegram.org/",
    installPackages: "python3 iproute2 ca-certificates xvfb openbox x11vnc netsurf-gtk fonts-dejavu-core",
    launchCommand: "netsurf-gtk https://web.telegram.org/",
    hostPort: 3011,
    guestIp: "172.16.58.14",
    hostTapIp: "172.16.58.13",
    tap: "syliongui3",
    serverName: "telegram.sylion.internal",
    guestMac: "AA:FC:00:00:58:0E"
  },
  threema: {
    title: "SYLION Threema Web",
    url: "https://web.threema.ch/",
    installPackages: "python3 iproute2 ca-certificates xvfb openbox x11vnc netsurf-gtk fonts-dejavu-core",
    launchCommand: "netsurf-gtk https://web.threema.ch/",
    hostPort: 3012,
    guestIp: "172.16.58.18",
    hostTapIp: "172.16.58.17",
    tap: "syliongui4",
    serverName: "threema.sylion.internal",
    guestMac: "AA:FC:00:00:58:12"
  },
  signal: {
    title: "SYLION Signal Desktop",
    url: "signal-desktop://",
    preAptSetup: `
mkdir -p "$mount_dir/etc/apt/keyrings"
curl -fsSL https://updates.signal.org/desktop/apt/keys.asc -o "$mount_dir/etc/apt/keyrings/signal-desktop-keyring.asc"
cat > "$mount_dir/etc/apt/sources.list.d/signal-xenial.list" <<'EOF'
deb [arch=amd64 signed-by=/etc/apt/keyrings/signal-desktop-keyring.asc] https://updates.signal.org/desktop/apt xenial main
EOF
`,
    installPackages: "python3 iproute2 ca-certificates xvfb openbox x11vnc fonts-dejavu-core signal-desktop",
    launchCommand: "signal-desktop --no-sandbox",
    hostPort: 3013,
    guestIp: "172.16.58.22",
    hostTapIp: "172.16.58.21",
    tap: "syliongui5",
    serverName: "signal.sylion.internal",
    guestMac: "AA:FC:00:00:58:16"
  }
};

const requestedAppKey = process.env.SYLION_GUI_APP || "duckduckgo";
if (!profiles[requestedAppKey]) {
  throw new Error(`Unsupported GUI app ${requestedAppKey}; supported=${Object.keys(profiles).join(",")}`);
}

const appKey = profiles[requestedAppKey].aliasOf || requestedAppKey;
const profile = profiles[appKey];
const cfg = {
  sshKey: process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey,
  workload: process.env.SYLION_WORKLOAD_NATIVE_SSH || "root@65.109.123.72",
  g2: process.env.SYLION_G2_SSH || "sylion@178.105.203.31",
  workloadPrivate: process.env.SYLION_WORKLOAD_NATIVE_PRIVATE_IP || "10.44.0.13",
  g2Private: process.env.SYLION_G2_PRIVATE_IP || "10.42.0.12",
  runId: process.env.SYLION_GUI_RUN_ID || `gui-${appKey}-${Date.now()}`
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
apt-get install -y --no-install-recommends jq qemu-utils socat novnc websockify >/dev/null
run_id="${cfg.runId}"
app_key="${appKey}"
base="/opt/sylion-firecracker/images/base/noble-base.ext4"
kernel="/opt/sylion/firecracker/smoke/vmlinux.bin"
run_dir="/opt/sylion-firecracker/runs/$run_id"
rootfs="$run_dir/rootfs.ext4"
tap="${profile.tap}"
guest_ip="${profile.guestIp}"
host_tap_ip="${profile.hostTapIp}"
workload_private="${cfg.workloadPrivate}"
host_port="${profile.hostPort}"
mkdir -p "$run_dir" /opt/sylion-workloads/evidence
if [ ! -f "$base" ]; then echo "missing_base_rootfs" >&2; exit 2; fi
if [ ! -f "$kernel" ]; then echo "missing_firecracker_kernel" >&2; exit 2; fi
cp --reflink=auto "$base" "$rootfs"
truncate -s 8G "$rootfs"
resize2fs -f "$rootfs" >/dev/null
mount_dir="$(mktemp -d /mnt/sylion-gui-rootfs.XXXXXX)"
cleanup_mount() {
  if mountpoint -q "$mount_dir/dev/pts"; then umount "$mount_dir/dev/pts"; fi
  if mountpoint -q "$mount_dir/sys"; then umount "$mount_dir/sys"; fi
  if mountpoint -q "$mount_dir/proc"; then umount "$mount_dir/proc"; fi
  if mountpoint -q "$mount_dir/dev"; then umount "$mount_dir/dev"; fi
  if mountpoint -q "$mount_dir"; then umount "$mount_dir"; fi
  rmdir "$mount_dir" 2>/dev/null || true
}
trap cleanup_mount EXIT
mount -o loop "$rootfs" "$mount_dir"
mount --bind /dev "$mount_dir/dev"
mount -t devpts devpts "$mount_dir/dev/pts"
mount -t proc proc "$mount_dir/proc"
mount -t sysfs sysfs "$mount_dir/sys"
cp /etc/resolv.conf "$mount_dir/etc/resolv.conf"
if [ -f "$mount_dir/etc/apt/sources.list.d/ubuntu.sources" ]; then
  sed -i 's/Components: main restricted/Components: main restricted universe multiverse/g; s/Components: main/Components: main universe multiverse/g' "$mount_dir/etc/apt/sources.list.d/ubuntu.sources"
else
  cat > "$mount_dir/etc/apt/sources.list" <<'EOF'
deb http://archive.ubuntu.com/ubuntu noble main universe multiverse
deb http://archive.ubuntu.com/ubuntu noble-updates main universe multiverse
deb http://security.ubuntu.com/ubuntu noble-security main universe multiverse
EOF
fi
chroot "$mount_dir" apt-get update >/dev/null
chroot "$mount_dir" apt-get install -y --no-install-recommends ca-certificates >/dev/null
${profile.preAptSetup || ""}
chroot "$mount_dir" apt-get update >/dev/null
chroot "$mount_dir" apt-get install -y --no-install-recommends ${profile.installPackages} >/dev/null
mkdir -p "$mount_dir/root/.config/openbox"
cat > "$mount_dir/root/.config/openbox/autostart" <<'EOF'
xsetroot -solid '#071014' &
EOF
cat > "$mount_dir/sbin/sylion-gui-init" <<'EOF'
#!/bin/sh
set -eu
mount -t proc proc /proc 2>/dev/null || true
mount -t sysfs sysfs /sys 2>/dev/null || true
mount -t devtmpfs devtmpfs /dev 2>/dev/null || true
mount -t devpts devpts /dev/pts 2>/dev/null || true
mount -t tmpfs tmpfs /run 2>/dev/null || true
mount -t tmpfs tmpfs /tmp 2>/dev/null || true
ip link set lo up
iface=""
for candidate in /sys/class/net/*; do
  name="$(basename "$candidate")"
  if [ "$name" != "lo" ]; then iface="$name"; break; fi
done
if [ -z "$iface" ]; then
  echo "sylion-gui-init: no workload interface found" >&2
  exec sh
fi
ip addr add ${profile.guestIp}/30 dev "$iface" 2>/dev/null || true
ip link set "$iface" up
ip route replace default via ${profile.hostTapIp} dev "$iface" 2>/dev/null || true
export DISPLAY=:1
export HOME=/root
Xvfb :1 -screen 0 1080x2400x24 -nolisten tcp &
sleep 1
openbox-session &
sleep 1
${profile.launchCommand} &
x11vnc -display :1 -forever -shared -nopw -rfbport 5900 -quiet &
ss -ltnp || true
while true; do sleep 3600; done
EOF
chmod 0755 "$mount_dir/sbin/sylion-gui-init"
cleanup_mount
trap - EXIT
pkill -f "firecracker.*$run_dir/config.json" 2>/dev/null || true
pkill -f "socat TCP-LISTEN:$host_port,bind=$workload_private" 2>/dev/null || true
pkill -f "websockify.*$workload_private:$host_port" 2>/dev/null || true
fuser -k "$workload_private:$host_port/tcp" >/dev/null 2>&1 || true
ip link show "$tap" >/dev/null 2>&1 && ip link del "$tap" || true
ip tuntap add dev "$tap" mode tap
ip addr add "$host_tap_ip/30" dev "$tap"
ip link set "$tap" up
cat > "$run_dir/config.json" <<EOF
{
  "boot-source": {
    "kernel_image_path": "$kernel",
    "boot_args": "console=ttyS0 reboot=k panic=1 pci=off random.trust_cpu=on root=/dev/vda rw init=/sbin/sylion-gui-init"
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
      "guest_mac": "${profile.guestMac}",
      "host_dev_name": "$tap"
    }
  ],
  "machine-config": {
    "vcpu_count": 2,
    "mem_size_mib": 2048,
    "smt": false,
    "track_dirty_pages": false
  }
}
EOF
setsid firecracker --no-api --config-file "$run_dir/config.json" > "$run_dir/serial.log" 2>&1 &
echo $! > "$run_dir/firecracker.pid"
for i in $(seq 1 60); do
  if timeout 2 bash -lc "</dev/tcp/$guest_ip/5900" 2>/dev/null; then break; fi
  sleep 2
done
setsid websockify --web=/usr/share/novnc "$workload_private:$host_port" "$guest_ip:5900" > "$run_dir/websockify.log" 2>&1 &
echo $! > "$run_dir/websockify.pid"
sleep 1
host_code="$(curl -sS -o "$run_dir/host-body.html" -w "%{http_code}" --max-time 8 "http://$workload_private:$host_port/vnc.html" || true)"
novnc_marker=false
grep -qi 'noVNC' "$run_dir/host-body.html" && novnc_marker=true || true
boot_markers="$(grep -Eic 'Linux version|Freeing unused kernel|sylion-gui-init|x11vnc|websockify|novnc|netsurf' "$run_dir/serial.log" || true)"
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
  --argjson novncMarker "$novnc_marker" \
  '{component:"native_firecracker_gui_workload", checkedAt:$checkedAt, runId:$runId, runDir:$runDir, appKey:$appKey, workloadPrivate:$workloadPrivate, hostPort:$hostPort, guestIp:$guestIp, tap:$tap, hostHttpCode:$hostCode, bootMarkers:$bootMarkers, noVncMarker:$novncMarker, ready:($hostCode=="200" and $novncMarker==true), terminalDataStored:false, secretsPrinted:false, productionExecutionAllowed:false}' | tee /opt/sylion-workloads/evidence/native-firecracker-gui-$app_key.json
`;
}

async function verifyFromG2() {
  const script = `
set -euo pipefail
code="$(curl -k -sS -o /tmp/sylion-native-gui.html -w "%{http_code}" --resolve ${profile.serverName}:443:${cfg.g2Private} --max-time 12 https://${profile.serverName}/vnc.html || true)"
headers="$(curl -k -sS -I --resolve ${profile.serverName}:443:${cfg.g2Private} --max-time 12 https://${profile.serverName}/vnc.html | tr '\\r\\n' ' ' || true)"
grep -qi 'noVNC' /tmp/sylion-native-gui.html && marker=true || marker=false
echo "code=$code"
echo "marker=$marker"
echo "$headers" | grep -q 'X-Sylion-Workload-Gateway: g2' && echo g2_header=true || echo g2_header=false
echo "$headers" | grep -q 'X-Sylion-Terminal-Data-Stored: false' && echo terminal_header=true || echo terminal_header=false
`;
  const { stdout } = await ssh(cfg.g2, script, { timeout: 45_000 });
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
      component: "native_firecracker_gui_workload",
      action: "plan_only",
      appKey,
      workload: cfg.workload,
      g2: cfg.g2,
      hostEndpoint: `${cfg.workloadPrivate}:${profile.hostPort}`,
      serverName: profile.serverName,
      productionExecutionAllowed: false
    }, null, 2));
    return;
  }
  const launched = await ssh(cfg.workload, remoteLaunchScript(), { timeout: 1_800_000 });
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
