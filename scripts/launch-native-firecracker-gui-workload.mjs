import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";

const mozillaAptSetup = `
mkdir -p "$mount_dir/etc/apt/keyrings"
curl -fsSL https://packages.mozilla.org/apt/repo-signing-key.gpg -o "$mount_dir/etc/apt/keyrings/packages.mozilla.org.asc"
cat > "$mount_dir/etc/apt/sources.list.d/mozilla.list" <<'EOF'
deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main
EOF
cat > "$mount_dir/etc/apt/preferences.d/mozilla" <<'EOF'
Package: *
Pin: origin packages.mozilla.org
Pin-Priority: 1000
EOF
`;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function firefoxApp(url) {
  return [
    "dbus-run-session -- env",
    "MOZ_ENABLE_WAYLAND=0",
    "MOZ_DISABLE_CONTENT_SANDBOX=1",
    "XDG_SESSION_TYPE=x11",
    "GDK_BACKEND=x11",
    "NO_AT_BRIDGE=1",
    "firefox",
    "--no-remote",
    "--new-instance",
    "--profile",
    "/home/sylion/.mozilla/firefox/sylion.default",
    "--new-window",
    shellQuote(url)
  ].join(" ");
}

const profiles = {
  duckduckgo: {
    title: "SYLION DuckDuckGo",
    url: "https://duckduckgo.com/",
    preAptSetup: mozillaAptSetup,
    installPackages: "python3 iproute2 ca-certificates haveged xvfb openbox x11vnc x11-utils xdotool wmctrl fonts-dejavu-core dbus dbus-x11 libdbus-glib-1-2 libgtk-3-0 firefox",
    launchCommand: firefoxApp("https://duckduckgo.com/"),
    targetContentPattern: "DuckDuckGo",
    visibleWindowPattern: "DuckDuckGo|Mozilla Firefox|Firefox",
    processPattern: "firefox",
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
    installPackages: "python3 iproute2 ca-certificates haveged xvfb openbox x11vnc x11-utils xdotool wmctrl libreoffice-writer libreoffice-calc fonts-dejavu-core",
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
    preAptSetup: mozillaAptSetup,
    installPackages: "python3 iproute2 ca-certificates haveged xvfb openbox x11vnc x11-utils xdotool wmctrl fonts-dejavu-core dbus dbus-x11 libdbus-glib-1-2 libgtk-3-0 firefox",
    launchCommand: firefoxApp("https://web.whatsapp.com/"),
    targetContentPattern: "WhatsApp",
    visibleWindowPattern: "WhatsApp|Mozilla Firefox|Firefox",
    processPattern: "firefox",
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
    preAptSetup: mozillaAptSetup,
    installPackages: "python3 iproute2 ca-certificates haveged xvfb openbox x11vnc x11-utils xdotool wmctrl fonts-dejavu-core dbus dbus-x11 libdbus-glib-1-2 libgtk-3-0 firefox",
    launchCommand: firefoxApp("https://web.telegram.org/"),
    targetContentPattern: "Telegram",
    visibleWindowPattern: "Telegram|Mozilla Firefox|Firefox",
    processPattern: "firefox",
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
    preAptSetup: mozillaAptSetup,
    installPackages: "python3 iproute2 ca-certificates haveged xvfb openbox x11vnc x11-utils xdotool wmctrl fonts-dejavu-core dbus dbus-x11 libdbus-glib-1-2 libgtk-3-0 firefox",
    launchCommand: firefoxApp("https://web.threema.ch/"),
    targetContentPattern: "Threema",
    visibleWindowPattern: "Threema|Mozilla Firefox|Firefox",
    processPattern: "firefox",
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
    installPackages: "python3 iproute2 ca-certificates haveged xvfb openbox x11vnc x11-utils xdotool wmctrl fonts-dejavu-core dbus dbus-x11 libasound2t64 libgtk-3-0 libnss3 libxss1 libgbm1 libdrm2 libxkbcommon0 libatspi2.0-0 libxdamage1 libxrandr2 libxcomposite1 libxext6 libxfixes3 libx11-xcb1 libxcb-dri3-0 signal-desktop",
    launchCommand: "dbus-run-session -- signal-desktop --no-sandbox --password-store=basic --ozone-platform=x11 --disable-features=UseOzonePlatform --disable-gpu --disable-gpu-compositing --disable-dev-shm-usage --enable-logging=stderr",
    visibleWindowPattern: "Signal|signal",
    processPattern: "signal-desktop|electron",
    hostPort: 3013,
    guestIp: "172.16.58.22",
    hostTapIp: "172.16.58.21",
    tap: "syliongui5",
    serverName: "signal.sylion.internal",
    guestMac: "AA:FC:00:00:58:16",
    vcpuCount: 4,
    memSizeMib: 6144
  },
  exodus: {
    title: "SYLION Exodus Desktop",
    url: "exodus://",
    preAptSetup: `
mkdir -p "$mount_dir/tmp"
exodus_url="$(curl -fsSL https://www.exodus.com/download/ | grep -Eo 'https://downloads.exodus.com/[^"]+linux[^"]+\\.deb' | head -1 || true)"
if [ -z "$exodus_url" ]; then
  exodus_url="https://downloads.exodus.com/releases/exodus-linux-x64-latest.deb"
fi
if ! curl -fL "$exodus_url" -o "$mount_dir/tmp/exodus.deb"; then
  echo "exodus_official_download_blocked_or_unavailable" >> "$run_dir/preflight.blockers"
  rm -f "$mount_dir/tmp/exodus.deb"
fi
`,
    installPackages: "python3 iproute2 ca-certificates haveged xvfb openbox x11vnc x11-utils xdotool wmctrl fonts-dejavu-core dbus dbus-x11 libgtk-3-0 libnss3 libxss1 libasound2t64",
    postAptInstall: `
if [ -s "$mount_dir/tmp/exodus.deb" ]; then
  chroot "$mount_dir" apt-get install -y --no-install-recommends /tmp/exodus.deb >/dev/null
else
  echo "exodus_deb_artifact_missing" >> "$run_dir/preflight.blockers"
fi
`,
    launchCommand: "dbus-run-session -- exodus --no-sandbox --disable-gpu --disable-dev-shm-usage",
    visibleWindowPattern: "Exodus|exodus",
    processPattern: "exodus",
    hostPort: 3015,
    guestIp: "172.16.58.30",
    hostTapIp: "172.16.58.29",
    tap: "syliongui7",
    serverName: "exodus.sylion.internal",
    guestMac: "AA:FC:00:00:58:1E"
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
apt-get install -y --no-install-recommends jq qemu-utils socat novnc websockify curl gnupg >/dev/null
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
truncate -s 12G "$rootfs"
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
cat > "$mount_dir/etc/resolv.conf" <<'EOF'
nameserver 1.1.1.1
nameserver 9.9.9.9
options timeout:2 attempts:2
EOF
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
chroot "$mount_dir" apt-get install -y --no-install-recommends ca-certificates curl >/dev/null
${profile.preAptSetup || ""}
chroot "$mount_dir" apt-get update >/dev/null
chroot "$mount_dir" apt-get install -y --no-install-recommends ${profile.installPackages} >/dev/null
${profile.postAptInstall || ""}
chroot "$mount_dir" dbus-uuidgen --ensure=/etc/machine-id 2>/dev/null || true
mkdir -p "$mount_dir/root/.config/openbox"
cat > "$mount_dir/root/.config/openbox/autostart" <<'EOF'
xsetroot -solid '#071014' &
EOF
chroot "$mount_dir" useradd -m -u 1000 -s /bin/sh sylion 2>/dev/null || true
cat > "$mount_dir/sbin/sylion-gui-init" <<'EOF'
#!/bin/sh
set -eu
mount -t proc proc /proc 2>/dev/null || true
mount -t sysfs sysfs /sys 2>/dev/null || true
mount -t devtmpfs devtmpfs /dev 2>/dev/null || true
mount -t devpts devpts /dev/pts 2>/dev/null || true
mount -t tmpfs tmpfs /run 2>/dev/null || true
mount -t tmpfs tmpfs /tmp 2>/dev/null || true
mkdir -p /dev/shm /run/user/1000
mount -t tmpfs tmpfs /dev/shm 2>/dev/null || true
chmod 1777 /tmp /dev/shm 2>/dev/null || true
[ -e /dev/fd ] || ln -s /proc/self/fd /dev/fd
chown 1000:1000 /run/user/1000
chmod 0700 /run/user/1000
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
if command -v haveged >/dev/null 2>&1; then
  haveged -F -w 1024 >/tmp/sylion-haveged.log 2>&1 &
fi
target_url=${shellQuote(profile.url?.startsWith("http") ? profile.url : "")}
target_pattern=${shellQuote(profile.targetContentPattern || "")}
target_required=${profile.targetContentPattern ? "true" : "false"}
target_http_code="skipped"
target_marker="false"
if [ -n "$target_url" ] && command -v curl >/dev/null 2>&1; then
  target_http_code="$(curl -k -L -sS -o /tmp/sylion-target-content.html -w "%{http_code}" --max-time 25 "$target_url" 2>/tmp/sylion-target-curl.err || true)"
  if [ -n "$target_pattern" ] && grep -Eiq "$target_pattern" /tmp/sylion-target-content.html 2>/dev/null; then
    target_marker="true"
  fi
fi
echo "sylion-target-required=$target_required"
echo "sylion-target-http-code=$target_http_code"
echo "sylion-target-marker=$target_marker"
if [ -n "$target_url" ]; then
  firefox_profile="/home/sylion/.mozilla/firefox/sylion.default"
  mkdir -p "$firefox_profile"
  cat > /home/sylion/.mozilla/firefox/profiles.ini <<'EOF_FF_PROFILES'
[Profile0]
Name=sylion
IsRelative=1
Path=sylion.default
Default=1

[General]
StartWithLastProfile=1
Version=2
EOF_FF_PROFILES
  cat > "$firefox_profile/user.js" <<EOF_FF_USER
user_pref("browser.startup.homepage", "$target_url");
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("permissions.default.persistent-storage", 1);
user_pref("privacy.purge_trackers.enabled", false);
user_pref("signon.rememberSignons", false);
user_pref("toolkit.telemetry.enabled", false);
EOF_FF_USER
  chown -R 1000:1000 /home/sylion/.mozilla
fi
export DISPLAY=:1
export HOME=/root
Xvfb :1 -screen 0 1080x2400x24 -ac -nolisten tcp &
sleep 1
openbox-session &
sleep 1
if [ "${profile.runAsRoot ? "true" : "false"}" = "true" ]; then
  mkdir -p /run/sylion-root
  chmod 0700 /run/sylion-root
  export DISPLAY=:1 HOME=/root XDG_RUNTIME_DIR=/run/sylion-root
  ${profile.launchCommand} >/tmp/sylion-app.log 2>&1 &
else
  su -s /bin/sh sylion -c 'export DISPLAY=:1 HOME=/home/sylion USER=sylion LOGNAME=sylion XDG_RUNTIME_DIR=/run/user/1000 XDG_SESSION_TYPE=x11 GDK_BACKEND=x11; ${profile.launchCommand} >/tmp/sylion-app.log 2>&1' &
fi
app_pid="$!"
echo "sylion-app-pid=$app_pid"
sleep 35
if command -v xdotool >/dev/null 2>&1; then
  DISPLAY=:1 xdotool search --name '.' windowmove %@ 0 0 windowsize %@ 1080 2200 2>/dev/null || true
  DISPLAY=:1 xdotool search --class 'firefox|navigator|chrome|signal|libreoffice|soffice|exodus' windowmove %@ 0 0 windowsize %@ 1080 2200 2>/dev/null || true
  DISPLAY=:1 xwininfo -root -children 2>/dev/null \
    | awk '/^     0x[0-9a-f]+/ && $1 != "0x20011f" { print $1 }' \
    | while read -r win; do
        DISPLAY=:1 xdotool windowmap "$win" windowmove "$win" 0 0 windowsize "$win" 1080 2200 2>/dev/null || true
      done
  if [ -n "$target_url" ]; then
    firefox_win="$(DISPLAY=:1 xdotool search --onlyvisible --class firefox 2>/dev/null | head -1 || true)"
    if [ -n "$firefox_win" ]; then
      DISPLAY=:1 xdotool windowactivate "$firefox_win" 2>/dev/null || true
      DISPLAY=:1 xdotool key --clearmodifiers ctrl+l 2>/dev/null || true
      DISPLAY=:1 xdotool type --delay 1 --clearmodifiers "$target_url" 2>/dev/null || true
      DISPLAY=:1 xdotool key --clearmodifiers Return 2>/dev/null || true
      sleep 18
      echo "sylion-forced-target-url=true"
    else
      echo "sylion-forced-target-url=false"
    fi
  fi
fi
if command -v wmctrl >/dev/null 2>&1; then
  DISPLAY=:1 wmctrl -r :ACTIVE: -e 0,0,0,1080,2200 2>/dev/null || true
  DISPLAY=:1 wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz 2>/dev/null || true
fi
sleep 5
if pgrep -af '${profile.processPattern || "signal-desktop|chrome|exodus|libreoffice|soffice|netsurf"}' >/dev/null 2>&1 || kill -0 "$app_pid" 2>/dev/null; then
  echo "sylion-app-running=true"
else
  echo "sylion-app-running=false"
fi
sed -n '1,160p' /tmp/sylion-app.log 2>/dev/null || true
ps -ef | grep -Ei '${profile.processPattern || "signal|electron|chrome|exodus|libreoffice|soffice|dbus|openbox|Xvfb"}|dbus|openbox|Xvfb' | grep -v grep || true
DISPLAY=:1 xwininfo -root -tree 2>/dev/null | sed -n '1,80p' || true
if DISPLAY=:1 xwininfo -root -tree 2>/dev/null | grep -Eiq '${profile.visibleWindowPattern || "Signal|WhatsApp|Telegram|Threema|LibreOffice|DuckDuckGo|Chrome|NetSurf"}'; then
  echo "sylion-visible-window=true"
else
  echo "sylion-visible-window=false"
fi
x11vnc -display :1 -forever -shared -nopw -rfbport 5900 -quiet -noxdamage -noxfixes -noxrecord -wait 20 -defer 20 -loop &
ss -ltnp || true
while true; do sleep 3600; done
EOF
chmod 0755 "$mount_dir/sbin/sylion-gui-init"
cleanup_mount
trap - EXIT
pkill -f "firecracker.*$run_dir/config.json" 2>/dev/null || true
for stale_config in /opt/sylion-firecracker/runs/gui-"$app_key"-*/config.json; do
  [ -e "$stale_config" ] || continue
  stale_dir="$(dirname "$stale_config")"
  [ "$stale_dir" = "$run_dir" ] && continue
  if [ -f "$stale_dir/firecracker.pid" ]; then
    kill "$(cat "$stale_dir/firecracker.pid")" 2>/dev/null || true
  fi
  pkill -f "firecracker --no-api --config-file $stale_config" 2>/dev/null || true
  pkill -f "websockify.*$workload_private:$host_port" 2>/dev/null || true
done
pkill -f "socat TCP-LISTEN:$host_port,bind=$workload_private" 2>/dev/null || true
pkill -f "websockify.*$workload_private:$host_port" 2>/dev/null || true
if [ "$app_key" = "signal" ]; then
  docker rm -f sylion-signal-desktop >/dev/null 2>&1 || true
fi
fuser -k "$workload_private:$host_port/tcp" >/dev/null 2>&1 || true
ip link show "$tap" >/dev/null 2>&1 && ip link del "$tap" || true
ip tuntap add dev "$tap" mode tap
ip addr add "$host_tap_ip/30" dev "$tap"
ip link set "$tap" up
sysctl -w net.ipv4.ip_forward=1 >/dev/null
iptables -C FORWARD -i "$tap" -j ACCEPT 2>/dev/null || iptables -A FORWARD -i "$tap" -j ACCEPT
iptables -C FORWARD -o "$tap" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -A FORWARD -o "$tap" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -t nat -C POSTROUTING -s "$guest_ip/32" -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s "$guest_ip/32" -j MASQUERADE
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
    "vcpu_count": ${profile.vcpuCount || 2},
    "mem_size_mib": ${profile.memSizeMib || 4096},
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
vnc_banner="$(GUEST_IP="$guest_ip" python3 - <<'PY'
import os
import socket

try:
    with socket.create_connection((os.environ["GUEST_IP"], 5900), 3) as sock:
        print(sock.recv(12).decode("ascii", "ignore").strip())
except Exception:
    pass
PY
)"
vnc_banner_ready=false
case "$vnc_banner" in
  RFB*) vnc_banner_ready=true ;;
esac
setsid websockify --web=/usr/share/novnc "$workload_private:$host_port" "$guest_ip:5900" > "$run_dir/websockify.log" 2>&1 &
echo $! > "$run_dir/websockify.pid"
sleep 1
host_code="$(curl -sS -o "$run_dir/host-body.html" -w "%{http_code}" --max-time 8 "http://$workload_private:$host_port/vnc.html" || true)"
novnc_marker=false
grep -qi 'noVNC' "$run_dir/host-body.html" && novnc_marker=true || true
boot_markers="$(grep -Eic 'Linux version|Freeing unused kernel|sylion-gui-init|x11vnc|websockify|novnc|netsurf|sylion-app-running=true' "$run_dir/serial.log" || true)"
app_running=false
grep -q 'sylion-app-running=true' "$run_dir/serial.log" && app_running=true || true
app_crashed=false
grep -q 'sylion-app-running=false' "$run_dir/serial.log" && app_crashed=true || true
visible_window=false
grep -q 'sylion-visible-window=true' "$run_dir/serial.log" && visible_window=true || true
target_required=false
grep -q 'sylion-target-required=true' "$run_dir/serial.log" && target_required=true || true
target_marker=false
grep -q 'sylion-target-marker=true' "$run_dir/serial.log" && target_marker=true || true
target_http_code="$(grep -m1 '^sylion-target-http-code=' "$run_dir/serial.log" | cut -d= -f2- | tr -d '\\r' || true)"
blockers_json="[]"
if [ -s "$run_dir/preflight.blockers" ]; then
  blockers_json="$(jq -R -s 'split("\\n") | map(select(length > 0))' "$run_dir/preflight.blockers")"
fi
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
  --argjson appRunning "$app_running" \
  --argjson appCrashed "$app_crashed" \
  --argjson visibleWindow "$visible_window" \
  --arg vncBanner "$vnc_banner" \
  --argjson vncBannerReady "$vnc_banner_ready" \
  --arg targetHttpCode "$target_http_code" \
  --argjson targetRequired "$target_required" \
  --argjson targetMarker "$target_marker" \
  --argjson blockers "$blockers_json" \
  '{component:"native_firecracker_gui_workload", checkedAt:$checkedAt, runId:$runId, runDir:$runDir, appKey:$appKey, workloadPrivate:$workloadPrivate, hostPort:$hostPort, guestIp:$guestIp, tap:$tap, hostHttpCode:$hostCode, bootMarkers:$bootMarkers, noVncMarker:$novncMarker, appRunning:$appRunning, appCrashed:$appCrashed, visibleWindow:$visibleWindow, vncBanner:$vncBanner, vncBannerReady:$vncBannerReady, targetHttpCode:$targetHttpCode, targetContentRequired:$targetRequired, targetContentVerified:$targetMarker, ready:($hostCode=="200" and $novncMarker==true and $appRunning==true and $appCrashed==false and $visibleWindow==true and $vncBannerReady==true and (($targetRequired==false) or ($targetMarker==true)) and ($blockers|length)==0), blockers:$blockers, terminalDataStored:false, secretsPrinted:false, productionExecutionAllowed:false}' | tee /opt/sylion-workloads/evidence/native-firecracker-gui-$app_key.json
if [ "$app_running" != "true" ] || [ "$app_crashed" = "true" ] || [ "$visible_window" != "true" ] || [ "$vnc_banner_ready" != "true" ] || { [ "$target_required" = "true" ] && [ "$target_marker" != "true" ]; } || [ -s "$run_dir/preflight.blockers" ]; then
  kill "$(cat "$run_dir/firecracker.pid")" 2>/dev/null || true
  kill "$(cat "$run_dir/websockify.pid")" 2>/dev/null || true
  ip link show "$tap" >/dev/null 2>&1 && ip link del "$tap" || true
fi
`;
}

async function verifyFromG2() {
  const script = `
set -euo pipefail
code="$(curl -k -sS -o /tmp/sylion-native-gui.html -w "%{http_code}" --resolve ${profile.serverName}:443:${cfg.g2Private} --max-time 12 'https://${profile.serverName}/vnc.html?autoconnect=true&resize=scale&path=websockify' || true)"
headers="$(curl -k -sS -I --resolve ${profile.serverName}:443:${cfg.g2Private} --max-time 12 'https://${profile.serverName}/vnc.html?autoconnect=true&resize=scale&path=websockify' | tr '\\r\\n' ' ' || true)"
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
