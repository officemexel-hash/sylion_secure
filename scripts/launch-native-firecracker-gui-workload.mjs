import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";

const defaultExodusVersion = process.env.SYLION_EXODUS_VERSION || "26.5.7";
const defaultExodusDebUrl = `https://downloads.exodus.com/releases/exodus-linux-x64-${defaultExodusVersion}.deb`;
const defaultExodusHashUrl = `https://downloads.exodus.com/releases/hashes-exodus-${defaultExodusVersion}.txt`;
const defaultExodusDebSha256 = defaultExodusVersion === "26.5.7"
  ? "59d94608c3eca0d8682c73de7ee2e18d212a09cff54699e084d7015aa0f9ba43"
  : "";
const exodusDebUrl = process.env.SYLION_EXODUS_DEB_URL || defaultExodusDebUrl;
const exodusHashUrl = process.env.SYLION_EXODUS_HASH_URL || defaultExodusHashUrl;
const exodusDebSha256 = process.env.SYLION_EXODUS_DEB_SHA256 || defaultExodusDebSha256;

const mozillaAptSetup = `
mkdir -p "$mount_dir/etc/apt/keyrings"
curl -fsSL https://packages.mozilla.org/apt/repo-signing-key.gpg \
  | gpg --dearmor -o "$mount_dir/etc/apt/keyrings/packages.mozilla.org.gpg"
chmod 0644 "$mount_dir/etc/apt/keyrings/packages.mozilla.org.gpg"
cat > "$mount_dir/etc/apt/sources.list.d/mozilla.list" <<'EOF'
deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.gpg] https://packages.mozilla.org/apt mozilla main
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

function firefoxWaylandApp(url) {
  return [
    "dbus-run-session -- env",
    "MOZ_ENABLE_WAYLAND=1",
    "XDG_SESSION_TYPE=wayland",
    "GDK_BACKEND=wayland",
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
    waylandLaunchCommand: firefoxWaylandApp("https://duckduckgo.com/"),
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
    waylandLaunchCommand: firefoxWaylandApp("https://web.whatsapp.com/"),
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
    waylandLaunchCommand: firefoxWaylandApp("https://web.telegram.org/"),
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
    waylandLaunchCommand: firefoxWaylandApp("https://web.threema.ch/"),
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
exodus_url=${shellQuote(exodusDebUrl)}
exodus_hash_url=${shellQuote(exodusHashUrl)}
exodus_sha256=${shellQuote(exodusDebSha256)}
if [ -z "$exodus_sha256" ]; then
  echo "exodus_sha256_required_for_wallet_artifact" >> "$run_dir/preflight.blockers"
fi
curl -fsSL "$exodus_hash_url" -o "$mount_dir/tmp/exodus.hashes.asc" || echo "exodus_hash_file_unavailable" >> "$run_dir/preflight.blockers"
if ! curl -fL "$exodus_url" -o "$mount_dir/tmp/exodus.deb"; then
  echo "exodus_official_download_blocked_or_unavailable" >> "$run_dir/preflight.blockers"
  rm -f "$mount_dir/tmp/exodus.deb"
fi
if [ -n "$exodus_sha256" ] && [ -s "$mount_dir/tmp/exodus.deb" ]; then
  printf '%s  %s\\n' "$exodus_sha256" "$mount_dir/tmp/exodus.deb" | sha256sum -c - >/dev/null \
    || echo "exodus_sha256_mismatch" >> "$run_dir/preflight.blockers"
fi
`,
    installPackages: "python3 iproute2 ca-certificates haveged xvfb openbox x11vnc x11-utils xdotool wmctrl fonts-dejavu-core dbus dbus-x11 libgtk-3-0 libnss3 libxss1 libasound2t64 libgbm1 libdrm2 libxkbcommon0 libatspi2.0-0 libatk-bridge2.0-0 libxdamage1 libxrandr2 libxcomposite1 libxext6 libxfixes3 libx11-xcb1 libxcb-dri3-0 libsecret-1-0 libnotify4 libgl1 libgl1-mesa-dri libglx-mesa0 libegl1 mesa-vulkan-drivers",
    postAptInstall: `
if [ -s "$mount_dir/tmp/exodus.deb" ]; then
  chroot "$mount_dir" apt-get install -y --no-install-recommends /tmp/exodus.deb >/dev/null
else
  echo "exodus_deb_artifact_missing" >> "$run_dir/preflight.blockers"
fi
`,
    launchCommand: [
      "dbus-run-session -- env",
      "LIBGL_ALWAYS_SOFTWARE=1",
      "MESA_LOADER_DRIVER_OVERRIDE=llvmpipe",
      "QT_XCB_GL_INTEGRATION=none",
      "ELECTRON_DISABLE_GPU=1",
      "ELECTRON_OZONE_PLATFORM_HINT=x11",
      "/usr/lib/exodus/Exodus"
    ].join(" "),
    visibleWindowPattern: "Exodus|exodus",
    processPattern: "exodus",
    hostPort: 3015,
    guestIp: "172.16.58.30",
    hostTapIp: "172.16.58.29",
    tap: "syliongui7",
    serverName: "exodus.sylion.internal",
    guestMac: "AA:FC:00:00:58:1E",
    displayWidth: 1440,
    displayHeight: 2400,
    windowWidth: 1440,
    windowHeight: 2200
  }
};

const commonGuiDiagnosticsPackages = "xinput x11-xkb-utils";

const requestedAppKey = process.env.SYLION_GUI_APP || "duckduckgo";
if (!profiles[requestedAppKey]) {
  throw new Error(`Unsupported GUI app ${requestedAppKey}; supported=${Object.keys(profiles).join(",")}`);
}

const appKey = profiles[requestedAppKey].aliasOf || requestedAppKey;
const profile = profiles[appKey];
const display = {
  width: Number(process.env.SYLION_GUI_DISPLAY_WIDTH || profile.displayWidth || 960),
  height: Number(process.env.SYLION_GUI_DISPLAY_HEIGHT || profile.displayHeight || 1800),
  windowWidth: Number(process.env.SYLION_GUI_WINDOW_WIDTH || profile.windowWidth || process.env.SYLION_GUI_DISPLAY_WIDTH || profile.displayWidth || 960),
  windowHeight: Number(process.env.SYLION_GUI_WINDOW_HEIGHT || profile.windowHeight || process.env.SYLION_GUI_DISPLAY_HEIGHT || profile.displayHeight || 1680)
};
const vncBackend = process.env.SYLION_GUI_VNC_BACKEND || profile.vncBackend || "tigervnc";
if (!["tigervnc", "x11vnc", "xorg-x11vnc", "weston-vnc", "kasmvnc"].includes(vncBackend)) {
  throw new Error(`Unsupported GUI VNC backend ${vncBackend}; supported=tigervnc,x11vnc,xorg-x11vnc,weston-vnc,kasmvnc`);
}
const vncDebug = process.env.SYLION_GUI_VNC_DEBUG === "true";
const selfTestText = process.env.SYLION_GUI_SELF_TEST_TEXT || "";
const launchCommand = vncBackend === "weston-vnc" && profile.waylandLaunchCommand
  ? profile.waylandLaunchCommand
  : profile.launchCommand;
const guestStreamPort = vncBackend === "kasmvnc" ? 6901 : 5900;
const streamProbePath = vncBackend === "kasmvnc" ? "/" : "/vnc.html";
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
  const remotePath = `/tmp/sylion-native-firecracker-gui-${Date.now()}-${Math.random().toString(16).slice(2)}.sh`;
  const localPath = join(tmpdir(), `sylion-native-firecracker-gui-${Date.now()}-${Math.random().toString(16).slice(2)}.sh`);
  await writeFile(localPath, script, { mode: 0o600 });
  try {
    await run("scp", [
      "-i",
      cfg.sshKey,
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      localPath,
      `${host}:${remotePath}`
    ], { timeout: options.timeout ?? 60_000 });
    return await run("ssh", [
      "-i",
      cfg.sshKey,
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      host,
      `bash ${remotePath}; rc=$?; rm -f ${remotePath}; exit $rc`
    ], options);
  } finally {
    await unlink(localPath).catch(() => {});
  }
}

function remoteLaunchScript() {
  return `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get install -y --no-install-recommends jq qemu-utils socat novnc websockify curl gnupg >/dev/null
run_id="${cfg.runId}"
app_key="${appKey}"
vnc_backend="${vncBackend}"
vnc_debug="${vncDebug}"
self_test_text=${shellQuote(selfTestText)}
guest_stream_port="${guestStreamPort}"
stream_probe_path="${streamProbePath}"
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
stream_credential_ref=""
if [ "$vnc_backend" = "kasmvnc" ]; then
  stream_secret_dir="/opt/sylion-firecracker/stream-secrets"
  stream_secret_file="$stream_secret_dir/$app_key.env"
  install -d -m 0700 "$stream_secret_dir"
  if [ ! -f "$stream_secret_file" ]; then
    umask 077
    printf 'STREAM_USER=operator\nSTREAM_PASSWORD=%s\n' "$(openssl rand -hex 24 | tr -d '\\n')" > "$stream_secret_file"
  fi
  chmod 0600 "$stream_secret_file"
  stream_credential_ref="$run_dir/stream-credentials.env"
  install -m 0600 "$stream_secret_file" "$stream_credential_ref"
fi
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
chroot "$mount_dir" apt-get install -y --no-install-recommends ca-certificates curl gnupg gpgv >/dev/null
${profile.preAptSetup || ""}
chroot "$mount_dir" apt-get update >/dev/null
extra_vnc_packages="tigervnc-standalone-server"
if [ "$vnc_backend" = "xorg-x11vnc" ]; then
  extra_vnc_packages="$extra_vnc_packages xserver-xorg-core xserver-xorg-video-dummy x11-xserver-utils"
elif [ "$vnc_backend" = "weston-vnc" ]; then
  extra_vnc_packages="$extra_vnc_packages weston openssl"
elif [ "$vnc_backend" = "kasmvnc" ]; then
  extra_vnc_packages="$extra_vnc_packages openssl"
fi
chroot "$mount_dir" apt-get install -y --no-install-recommends ${profile.installPackages} $extra_vnc_packages ${commonGuiDiagnosticsPackages} >/dev/null
if [ "$vnc_backend" = "kasmvnc" ]; then
  kasm_deb="$mount_dir/tmp/kasmvncserver_noble_1.4.0_amd64.deb"
  curl -fsSL -o "$kasm_deb" "https://github.com/kasmtech/KasmVNC/releases/download/v1.4.0/kasmvncserver_noble_1.4.0_amd64.deb"
  chroot "$mount_dir" apt-get install -y --no-install-recommends /tmp/kasmvncserver_noble_1.4.0_amd64.deb >/dev/null
  rm -f "$kasm_deb"
fi
${profile.postAptInstall || ""}
chroot "$mount_dir" dbus-uuidgen --ensure=/etc/machine-id 2>/dev/null || true
mkdir -p "$mount_dir/root/.config/openbox"
cat > "$mount_dir/root/.config/openbox/autostart" <<'EOF'
xsetroot -solid '#071014' &
EOF
chroot "$mount_dir" useradd -m -u 1000 -s /bin/sh sylion 2>/dev/null || true
if [ "$vnc_backend" = "kasmvnc" ]; then
  install -d -m 0700 "$mount_dir/etc/sylion"
  cp "$stream_credential_ref" "$mount_dir/etc/sylion/stream-credentials.env"
  chmod 0600 "$mount_dir/etc/sylion/stream-credentials.env"
fi
cat > "$mount_dir/sbin/sylion-gui-init" <<'EOF'
#!/bin/sh
set -eu
vnc_backend=${vncBackend}
vnc_debug=${vncDebug}
self_test_text=${shellQuote(selfTestText)}
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
if [ "${appKey}" = "exodus" ]; then
  mkdir -p /home/sylion/.config
  cat > /home/sylion/.config/electron-flags.conf <<'EOF_ELECTRON_FLAGS'
--disable-gpu
--disable-gpu-compositing
--disable-dev-shm-usage
--ignore-gpu-blocklist
--enable-unsafe-swiftshader
--use-gl=swiftshader
--ozone-platform=x11
--disable-features=UseOzonePlatform,VizDisplayCompositor
EOF_ELECTRON_FLAGS
  chown -R 1000:1000 /home/sylion/.config
fi
export DISPLAY=:1
export HOME=/root
if [ "$vnc_backend" = "tigervnc" ] && command -v Xtigervnc >/dev/null 2>&1; then
  Xtigervnc :1 -geometry ${display.width}x${display.height} -depth 24 -rfbport 5900 -SecurityTypes None -localhost no -AlwaysShared -AcceptKeyEvents -AcceptPointerEvents -RawKeyboard > /tmp/sylion-vncserver.log 2>&1 &
elif [ "$vnc_backend" = "weston-vnc" ] && command -v weston >/dev/null 2>&1; then
  install -d -m 0700 /etc/sylion/weston-vnc /run/user/1000
  chown 1000:1000 /run/user/1000
  chmod 0700 /run/user/1000
  if [ ! -f /etc/sylion/weston-vnc/tls.key ]; then
    openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 7 \
      -subj '/CN=sylion-firecracker-weston-vnc' \
      -keyout /etc/sylion/weston-vnc/tls.key \
      -out /etc/sylion/weston-vnc/tls.crt >/dev/null 2>&1
    chmod 0600 /etc/sylion/weston-vnc/tls.key
    chmod 0644 /etc/sylion/weston-vnc/tls.crt
  fi
  chown -R sylion:sylion /etc/sylion/weston-vnc
  cat > /etc/pam.d/weston-remote-access <<'EOF_WESTON_PAM'
auth sufficient pam_permit.so
account sufficient pam_permit.so
EOF_WESTON_PAM
  weston_auth="/etc/sylion/weston-vnc/plain-auth.env"
  if [ ! -f "$weston_auth" ]; then
    umask 077
    printf 'WESTON_REMOTE_USER=sylion\\nWESTON_REMOTE_PASSWORD=%s\\n' "$(openssl rand -base64 36 | tr -d '\\n')" > "$weston_auth"
  fi
  cat > /usr/local/sbin/sylion-weston-vnc-plain-proxy.py <<'EOF_WESTON_PROXY'
#!/usr/bin/env python3
import argparse
import select
import socket
import ssl
import struct
import threading

RFB_VERSION = b"RFB 003.008\\n"
VENCRYPT = 19
X509_PLAIN = 262

def recvn(sock, count):
    data = b""
    while len(data) < count:
        chunk = sock.recv(count - len(data))
        if not chunk:
            raise ConnectionError("short_read")
        data += chunk
    return data

def read_auth(path):
    values = {}
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key] = value
    return values.get("WESTON_REMOTE_USER", "root"), values["WESTON_REMOTE_PASSWORD"]

def authenticate_plain(tls, auth_file):
    username, password = read_auth(auth_file)
    username_bytes = username.encode("utf-8")
    password_bytes = password.encode("utf-8")
    tls.sendall(struct.pack(">II", len(username_bytes), len(password_bytes)) + username_bytes + password_bytes)
    result = recvn(tls, 4)
    if result != b"\\x00\\x00\\x00\\x00":
        raise RuntimeError("weston_plain_auth_failed")

def connect_weston(target_host, target_port, auth_file):
    raw = socket.create_connection((target_host, target_port), timeout=8)
    raw.settimeout(8)
    banner = recvn(raw, 12)
    if not banner.startswith(b"RFB "):
        raise RuntimeError("weston_missing_rfb_banner")
    raw.sendall(RFB_VERSION)
    count = recvn(raw, 1)[0]
    security_types = recvn(raw, count)
    if VENCRYPT not in security_types:
        raise RuntimeError("weston_vencrypt_not_offered")
    raw.sendall(bytes([VENCRYPT]))
    version = recvn(raw, 2)
    raw.sendall(version)
    if recvn(raw, 1) != b"\\x00":
        raise RuntimeError("weston_vencrypt_version_rejected")
    subtype_count = recvn(raw, 1)[0]
    subtype_raw = recvn(raw, subtype_count * 4)
    subtypes = [struct.unpack(">I", subtype_raw[index:index + 4])[0] for index in range(0, len(subtype_raw), 4)]
    if X509_PLAIN not in subtypes:
        raise RuntimeError("weston_x509_plain_not_offered")
    raw.sendall(struct.pack(">I", X509_PLAIN))
    if recvn(raw, 1) != b"\\x01":
        raise RuntimeError("weston_x509_plain_rejected")
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    tls = context.wrap_socket(raw, server_hostname="weston-vnc")
    tls.settimeout(8)
    authenticate_plain(tls, auth_file)
    tls.settimeout(None)
    return tls

def bridge(left, right):
    sockets = [left, right]
    try:
        while True:
            readable, _, _ = select.select(sockets, [], [], 60)
            for sock in readable:
                peer = right if sock is left else left
                data = sock.recv(65536)
                if not data:
                    return
                peer.sendall(data)
    finally:
        for sock in sockets:
            try:
                sock.close()
            except OSError:
                pass

def handle_client(client, args):
    stage = "start"
    try:
        stage = "connect_weston"
        weston = connect_weston(args.target_host, args.target_port, args.auth_file)
        stage = "send_client_version"
        client.sendall(RFB_VERSION)
        stage = "read_client_version"
        _client_version = recvn(client, 12)
        stage = "send_security_types"
        client.sendall(b"\\x01\\x01")
        stage = "read_security_selection"
        selected = recvn(client, 1)
        if selected != b"\\x01":
            raise RuntimeError("client_rejected_none_security")
        stage = "send_security_result"
        client.sendall(b"\\x00\\x00\\x00\\x00")
        stage = "bridge"
        bridge(client, weston)
    except Exception as exc:
        print(f"proxy_client_error_stage={stage}", flush=True)
        print(f"proxy_client_error={exc}", flush=True)
        try:
            client.close()
        except OSError:
            pass

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen-host", default="0.0.0.0")
    parser.add_argument("--listen-port", type=int, required=True)
    parser.add_argument("--target-host", default="127.0.0.1")
    parser.add_argument("--target-port", type=int, required=True)
    parser.add_argument("--auth-file", required=True)
    args = parser.parse_args()
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((args.listen_host, args.listen_port))
    server.listen(32)
    print(f"proxy_listen={args.listen_host}:{args.listen_port}", flush=True)
    while True:
        client, _addr = server.accept()
        thread = threading.Thread(target=handle_client, args=(client, args), daemon=True)
        thread.start()

if __name__ == "__main__":
    main()
EOF_WESTON_PROXY
  chmod 0755 /usr/local/sbin/sylion-weston-vnc-plain-proxy.py
  su -s /bin/sh sylion -c 'export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=sylion-gui-wayland; weston --backend=vnc-backend.so --socket="$WAYLAND_DISPLAY" --port=5914 --width=${display.width} --height=${display.height} --vnc-tls-cert=/etc/sylion/weston-vnc/tls.crt --vnc-tls-key=/etc/sylion/weston-vnc/tls.key --no-config --idle-time=0 --renderer=pixman --log=/tmp/sylion-weston.log >/tmp/sylion-weston.out 2>&1' &
  for i in $(seq 1 30); do
    if timeout 2 bash -lc "</dev/tcp/127.0.0.1/5914" 2>/dev/null; then break; fi
    sleep 1
  done
  (while true; do
    python3 /usr/local/sbin/sylion-weston-vnc-plain-proxy.py --listen-host 0.0.0.0 --listen-port 5900 --target-host 127.0.0.1 --target-port 5914 --auth-file "$weston_auth"
    echo "sylion-weston-proxy-exited=$?"
    sleep 1
  done) >/tmp/sylion-vncserver.log 2>&1 &
  tail -n +1 -F /tmp/sylion-vncserver.log 2>/dev/null | grep --line-buffered -E 'proxy_|sylion-weston-proxy|Traceback|Error|error|failed|Failed|listen' >/dev/console &
  cat > /usr/local/sbin/sylion-weston-seat-primer.py <<'EOF_WESTON_PRIMER'
#!/usr/bin/env python3
import argparse
import importlib.util
import struct
import time

def load_proxy(path):
    spec = importlib.util.spec_from_file_location("sylion_weston_proxy", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--proxy-module", default="/usr/local/sbin/sylion-weston-vnc-plain-proxy.py")
    parser.add_argument("--target-host", default="127.0.0.1")
    parser.add_argument("--target-port", type=int, required=True)
    parser.add_argument("--auth-file", required=True)
    args = parser.parse_args()
    proxy = load_proxy(args.proxy_module)
    sock = proxy.connect_weston(args.target_host, args.target_port, args.auth_file)
    sock.sendall(b"\x01")
    server_init = proxy.recvn(sock, 24)
    width, height = struct.unpack(">HH", server_init[:4])
    name_length = struct.unpack(">I", server_init[20:24])[0]
    if name_length:
        proxy.recvn(sock, name_length)
    print(f"seat_primer_connected=true {width}x{height}", flush=True)
    while True:
        sock.sendall(struct.pack(">BBHHHH", 3, 1, 0, 0, width, height))
        time.sleep(10)

if __name__ == "__main__":
    main()
EOF_WESTON_PRIMER
  chmod 0755 /usr/local/sbin/sylion-weston-seat-primer.py
  python3 /usr/local/sbin/sylion-weston-seat-primer.py --target-host 127.0.0.1 --target-port 5914 --auth-file "$weston_auth" >/tmp/sylion-weston-seat-primer.log 2>&1 &
  for i in $(seq 1 30); do
    if grep -q 'seat_primer_connected=true' /tmp/sylion-weston-seat-primer.log 2>/dev/null; then break; fi
    sleep 1
  done
  sed -n '1,40p' /tmp/sylion-weston-seat-primer.log 2>/dev/null || true
elif [ "$vnc_backend" = "kasmvnc" ] && command -v kasmvncserver >/dev/null 2>&1; then
  hostname sylion-firecracker 2>/dev/null || true
  grep -q 'sylion-firecracker' /etc/hosts 2>/dev/null || echo '127.0.1.1 sylion-firecracker' >> /etc/hosts
  install -d -m 0755 /etc/sylion
  install -d -m 0755 /etc/ssl/certs
  install -d -m 0710 /etc/ssl/private
  if [ ! -f /etc/ssl/private/ssl-cert-snakeoil.key ] || [ ! -f /etc/ssl/certs/ssl-cert-snakeoil.pem ]; then
    openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 7 \
      -subj '/CN=sylion-firecracker-kasmvnc' \
      -keyout /etc/ssl/private/ssl-cert-snakeoil.key \
      -out /etc/ssl/certs/ssl-cert-snakeoil.pem >/dev/null 2>&1
    chmod 0640 /etc/ssl/private/ssl-cert-snakeoil.key
    chmod 0644 /etc/ssl/certs/ssl-cert-snakeoil.pem
  fi
  chgrp ssl-cert /etc/ssl/private/ssl-cert-snakeoil.key 2>/dev/null || true
  usermod -a -G ssl-cert sylion 2>/dev/null || true
  cat > /etc/sylion/kasm-xstartup <<'EOF_KASM_XSTARTUP'
#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
openbox-session >/tmp/sylion-openbox.log 2>&1 &
EOF_KASM_XSTARTUP
  chmod 0755 /etc/sylion/kasm-xstartup
  install -d -o sylion -g sylion -m 0700 /home/sylion/.vnc
  touch /home/sylion/.vnc/.de-was-selected
  cat > /home/sylion/.vnc/kasmvnc.yaml <<'EOF_KASM_YAML'
desktop:
  allow_resize: true
network:
  protocol: http
  interface: 0.0.0.0
  websocket_port: 6901
  use_ipv4: true
  use_ipv6: false
  ssl:
    require_ssl: false
keyboard:
  raw_keyboard: false
pointer:
  enabled: true
data_loss_prevention:
  clipboard:
    server_to_client:
      enabled: false
    client_to_server:
      enabled: false
  keyboard:
    enabled: true
  logging:
    level: off
logging:
  log_writer_name: all
  log_dest: logfile
  level: 30
EOF_KASM_YAML
  chown sylion:sylion /home/sylion/.vnc/kasmvnc.yaml
  chown sylion:sylion /home/sylion/.vnc/.de-was-selected
  . /etc/sylion/stream-credentials.env
  : "\${STREAM_USER:?missing_stream_user}"
  : "\${STREAM_PASSWORD:?missing_stream_password}"
  printf '%s\n%s\n' "$STREAM_PASSWORD" "$STREAM_PASSWORD" | su -s /bin/sh sylion -c "kasmvncpasswd -u '$STREAM_USER' -w -r /home/sylion/.kasmpasswd" >/tmp/sylion-kasmvnc-passwd.log 2>&1
  unset STREAM_PASSWORD
  su -s /bin/sh sylion -c 'kasmvncserver :1 -config /home/sylion/.vnc/kasmvnc.yaml -geometry ${display.width}x${display.height} -depth 24 -websocketPort 6901 -interface 0.0.0.0 -httpd /usr/share/kasmvnc/www -xstartup /etc/sylion/kasm-xstartup >/tmp/sylion-kasmvncserver.log 2>&1' &
  for i in $(seq 1 45); do
    if timeout 2 bash -lc "</dev/tcp/127.0.0.1/6901" 2>/dev/null; then break; fi
    sleep 1
  done
  sed -n '1,120p' /tmp/sylion-kasmvncserver.log 2>/dev/null || true
elif [ "$vnc_backend" = "xorg-x11vnc" ] && command -v Xorg >/dev/null 2>&1; then
  mkdir -p /etc/X11
  cat > /etc/X11/sylion-dummy-xorg.conf <<'EOF_XORG_DUMMY'
Section "ServerLayout"
  Identifier "SYLION"
  Screen 0 "Screen0" 0 0
EndSection
Section "Device"
  Identifier "DummyDevice"
  Driver "dummy"
  VideoRam 256000
EndSection
Section "Monitor"
  Identifier "DummyMonitor"
  HorizSync 5.0 - 1000.0
  VertRefresh 5.0 - 200.0
EndSection
Section "Screen"
  Identifier "Screen0"
  Device "DummyDevice"
  Monitor "DummyMonitor"
  DefaultDepth 24
  SubSection "Display"
    Depth 24
    Virtual ${display.width} ${display.height}
  EndSubSection
EndSection
EOF_XORG_DUMMY
  Xorg :1 -noreset -nolisten tcp -config /etc/X11/sylion-dummy-xorg.conf +extension XTEST +extension RANDR > /tmp/sylion-xorg.log 2>&1 &
else
  Xvfb :1 -screen 0 ${display.width}x${display.height}x24 -ac -nolisten tcp +extension XTEST +extension RANDR &
fi
if [ "$vnc_backend" = "weston-vnc" ]; then
  echo "sylion-xtest-extension=skipped_wayland"
elif [ "$vnc_backend" = "kasmvnc" ]; then
  echo "sylion-xtest-extension=kasmvnc"
else
  for i in $(seq 1 30); do
    if DISPLAY=:1 xdpyinfo >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if DISPLAY=:1 xdpyinfo -queryExtensions 2>/dev/null | grep -q XTEST; then
    echo "sylion-xtest-extension=true"
  else
    echo "sylion-xtest-extension=false"
  fi
  if command -v setxkbmap >/dev/null 2>&1; then
    DISPLAY=:1 setxkbmap -model pc105 -layout us 2>/tmp/sylion-setxkbmap.err || true
  fi
  if [ "$vnc_debug" = "true" ] && command -v xinput >/dev/null 2>&1; then
    DISPLAY=:1 xinput test-xi2 --root 2>/tmp/sylion-xinput.err \
      | grep --line-buffered -E 'RawKeyPress|RawButtonPress|RawButtonRelease|KeyPress|ButtonPress|ButtonRelease' >/dev/console &
  fi
  openbox-session &
fi
sleep 1
if [ "${profile.runAsRoot ? "true" : "false"}" = "true" ]; then
  mkdir -p /run/sylion-root
  chmod 0700 /run/sylion-root
  if [ "$vnc_backend" = "weston-vnc" ]; then
    export HOME=/root XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=sylion-gui-wayland XDG_SESSION_TYPE=wayland GDK_BACKEND=wayland
  else
    export DISPLAY=:1 HOME=/root XDG_RUNTIME_DIR=/run/sylion-root
  fi
  ${launchCommand} >/tmp/sylion-app.log 2>&1 &
else
  if [ "$vnc_backend" = "weston-vnc" ]; then
    su -s /bin/sh sylion -c 'export HOME=/home/sylion USER=sylion LOGNAME=sylion XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=sylion-gui-wayland XDG_SESSION_TYPE=wayland GDK_BACKEND=wayland MOZ_ENABLE_WAYLAND=1; ${launchCommand} >/tmp/sylion-app.log 2>&1' &
  else
    su -s /bin/sh sylion -c 'export DISPLAY=:1 HOME=/home/sylion USER=sylion LOGNAME=sylion XDG_RUNTIME_DIR=/run/user/1000 XDG_SESSION_TYPE=x11 GDK_BACKEND=x11; ${launchCommand} >/tmp/sylion-app.log 2>&1' &
  fi
fi
app_pid="$!"
echo "sylion-app-pid=$app_pid"
sleep 35
if [ "$vnc_backend" != "weston-vnc" ] && command -v xdotool >/dev/null 2>&1; then
  DISPLAY=:1 xdotool search --name '.' windowmove %@ 0 0 windowsize %@ ${display.windowWidth} ${display.windowHeight} 2>/dev/null || true
  DISPLAY=:1 xdotool search --class 'firefox|navigator|chrome|signal|libreoffice|soffice|exodus' windowmove %@ 0 0 windowsize %@ ${display.windowWidth} ${display.windowHeight} 2>/dev/null || true
  DISPLAY=:1 xwininfo -root -children 2>/dev/null \
    | awk '/^     0x[0-9a-f]+/ && $1 != "0x20011f" { print $1 }' \
    | while read -r win; do
        DISPLAY=:1 xdotool windowmap "$win" windowmove "$win" 0 0 windowsize "$win" ${display.windowWidth} ${display.windowHeight} 2>/dev/null || true
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
  if [ -n "$self_test_text" ]; then
    self_test_win="$(DISPLAY=:1 xdotool search --onlyvisible --class 'firefox|libreoffice|soffice|signal|exodus' 2>/dev/null | head -1 || true)"
    if [ -z "$self_test_win" ]; then
      self_test_win="$(DISPLAY=:1 xdotool getactivewindow 2>/dev/null || true)"
    fi
    if [ -n "$self_test_win" ]; then
      echo "sylion-self-input-window=$self_test_win"
      DISPLAY=:1 xdotool windowactivate --sync "$self_test_win" 2>/dev/null || true
      DISPLAY=:1 xdotool windowfocus --sync "$self_test_win" 2>/dev/null || true
    fi
    DISPLAY=:1 xdotool getwindowfocus getwindowname 2>/dev/null | sed 's/^/sylion-self-input-focus=/' || true
    DISPLAY=:1 xdotool key --clearmodifiers ctrl+l 2>/dev/null || true
    sleep 1
    DISPLAY=:1 xdotool type --delay 80 --clearmodifiers "$self_test_text" 2>/dev/null || true
    DISPLAY=:1 xdotool getwindowfocus getwindowname 2>/dev/null | sed 's/^/sylion-self-input-focus-after=/' || true
    echo "sylion-self-input-test=true"
  fi
fi
if [ "$vnc_backend" != "weston-vnc" ] && command -v wmctrl >/dev/null 2>&1; then
  DISPLAY=:1 wmctrl -r :ACTIVE: -e 0,0,0,${display.windowWidth},${display.windowHeight} 2>/dev/null || true
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
if [ "$vnc_backend" = "weston-vnc" ]; then
  sed -n '1,160p' /tmp/sylion-weston.log 2>/dev/null || true
  echo "sylion-visible-window=true"
elif DISPLAY=:1 xwininfo -root -tree 2>/dev/null | sed -n '1,80p' && DISPLAY=:1 xwininfo -root -tree 2>/dev/null | grep -Eiq '${profile.visibleWindowPattern || "Signal|WhatsApp|Telegram|Threema|LibreOffice|DuckDuckGo|Chrome|NetSurf"}'; then
  echo "sylion-visible-window=true"
else
  echo "sylion-visible-window=false"
fi
if [ "$vnc_backend" != "weston-vnc" ] && [ "$vnc_backend" != "kasmvnc" ] && ! pgrep -af "Xtigervnc :1" >/dev/null 2>&1; then
  x11vnc_log_flags="-quiet"
  if [ "$vnc_debug" = "true" ]; then
    x11vnc_log_flags="-debug_keyboard -debug_pointer -o /tmp/sylion-vncserver.log"
  fi
  x11vnc -display :1 -forever -shared -nopw -rfbport 5900 $x11vnc_log_flags -input KMBCF -allinput -input_eagerly -noxwarppointer -xkb -nomodtweak -noxdamage -noxfixes -noxrecord -wait 20 -defer 20 -loop &
  if [ "$vnc_debug" = "true" ]; then
    tail -n +1 -F /tmp/sylion-vncserver.log 2>/dev/null | grep --line-buffered -E 'client|Client|keyboard|pointer|Pointer|button|Button|XTEST|Key|key|error|Error|fail|Fail|viewonly|input' >/dev/console &
  fi
fi
sed -n '1,120p' /tmp/sylion-vncserver.log 2>/dev/null || true
sed -n '1,160p' /tmp/sylion-xorg.log 2>/dev/null || true
sed -n '1,160p' /tmp/sylion-weston.out 2>/dev/null || true
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
  if timeout 2 bash -lc "</dev/tcp/$guest_ip/$guest_stream_port" 2>/dev/null; then break; fi
  sleep 2
done
for i in $(seq 1 45); do
  if grep -q 'sylion-app-running=' "$run_dir/serial.log" && grep -q 'sylion-visible-window=' "$run_dir/serial.log"; then break; fi
  sleep 2
done
vnc_banner="$(GUEST_IP="$guest_ip" GUEST_STREAM_PORT="$guest_stream_port" python3 - <<'PY'
import os
import socket

try:
    with socket.create_connection((os.environ["GUEST_IP"], int(os.environ["GUEST_STREAM_PORT"])), 3) as sock:
        print(sock.recv(12).decode("ascii", "ignore").strip())
except Exception:
    pass
PY
)"
vnc_banner_ready=false
case "$vnc_banner" in
  RFB*) vnc_banner_ready=true ;;
esac
if [ "$vnc_backend" = "kasmvnc" ]; then
  vnc_banner="KASMVNC_HTTP"
  vnc_banner_ready=true
  setsid socat TCP-LISTEN:$host_port,bind=$workload_private,fork,reuseaddr TCP:$guest_ip:$guest_stream_port > "$run_dir/websockify.log" 2>&1 &
  echo $! > "$run_dir/websockify.pid"
else
  setsid websockify --web=/usr/share/novnc "$workload_private:$host_port" "$guest_ip:$guest_stream_port" > "$run_dir/websockify.log" 2>&1 &
  echo $! > "$run_dir/websockify.pid"
fi
sleep 1
host_code="$(curl -sS -o "$run_dir/host-body.html" -w "%{http_code}" --max-time 8 "http://$workload_private:$host_port$stream_probe_path" || true)"
novnc_marker=false
grep -Eqi 'noVNC|KasmVNC|kasm' "$run_dir/host-body.html" && novnc_marker=true || true
if [ "$vnc_backend" = "kasmvnc" ] && [ "$host_code" = "401" ]; then
  novnc_marker=true
fi
boot_markers="$(grep -Eic 'Linux version|Freeing unused kernel|sylion-gui-init|x11vnc|websockify|novnc|netsurf|sylion-app-running=true' "$run_dir/serial.log" || true)"
app_running=false
grep -q 'sylion-app-running=true' "$run_dir/serial.log" && app_running=true || true
app_crashed=false
grep -q 'sylion-app-running=false' "$run_dir/serial.log" && app_crashed=true || true
visible_window=false
grep -q 'sylion-visible-window=true' "$run_dir/serial.log" && visible_window=true || true
if [ "$vnc_backend" = "kasmvnc" ] && [ "$app_running" = "true" ]; then
  visible_window=true
fi
stream_ready=false
if [ "$host_code" = "200" ] || { [ "$vnc_backend" = "kasmvnc" ] && [ "$host_code" = "401" ]; }; then
  stream_ready=true
fi
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
  --arg vncBackend "$vnc_backend" \
  --arg streamCredentialRef "$stream_credential_ref" \
  --arg hostCode "$host_code" \
  --argjson bootMarkers "$boot_markers" \
  --argjson novncMarker "$novnc_marker" \
  --argjson appRunning "$app_running" \
  --argjson appCrashed "$app_crashed" \
  --argjson visibleWindow "$visible_window" \
  --argjson streamReady "$stream_ready" \
  --arg vncBanner "$vnc_banner" \
  --argjson vncBannerReady "$vnc_banner_ready" \
  --arg targetHttpCode "$target_http_code" \
  --argjson targetRequired "$target_required" \
  --argjson targetMarker "$target_marker" \
  --argjson blockers "$blockers_json" \
  '{component:"native_firecracker_gui_workload", checkedAt:$checkedAt, runId:$runId, runDir:$runDir, appKey:$appKey, workloadPrivate:$workloadPrivate, hostPort:$hostPort, guestIp:$guestIp, tap:$tap, vncBackend:$vncBackend, streamCredentialRef:$streamCredentialRef, hostHttpCode:$hostCode, streamReady:$streamReady, streamAuthRequired:($vncBackend=="kasmvnc" and $hostCode=="401"), bootMarkers:$bootMarkers, noVncMarker:$novncMarker, appRunning:$appRunning, appCrashed:$appCrashed, visibleWindow:$visibleWindow, vncBanner:$vncBanner, vncBannerReady:$vncBannerReady, targetHttpCode:$targetHttpCode, targetContentRequired:$targetRequired, targetContentVerified:$targetMarker, ready:($streamReady==true and $novncMarker==true and $appRunning==true and $appCrashed==false and $visibleWindow==true and $vncBannerReady==true and (($targetRequired==false) or ($targetMarker==true)) and ($blockers|length)==0), blockers:$blockers, terminalDataStored:false, secretsPrinted:false, productionExecutionAllowed:false}' | tee /opt/sylion-workloads/evidence/native-firecracker-gui-$app_key.json
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
code="$(curl -k -sS -L -o /tmp/sylion-native-gui.html -w "%{http_code}" --resolve ${profile.serverName}:443:${cfg.g2Private} --max-time 12 'https://${profile.serverName}${streamProbePath}' || true)"
headers="$(curl -k -sS -L -I --resolve ${profile.serverName}:443:${cfg.g2Private} --max-time 12 'https://${profile.serverName}${streamProbePath}' | tr '\\r\\n' ' ' || true)"
grep -Eqi 'noVNC|KasmVNC|kasm' /tmp/sylion-native-gui.html && marker=true || marker=false
if [ "${vncBackend}" = "kasmvnc" ] && [ "$code" = "401" ]; then marker=true; fi
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
      display,
      vncBackend,
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
    display,
    readyThroughG2: evidence.ready === true
      && (g2.code === "200" || (vncBackend === "kasmvnc" && g2.code === "401"))
      && g2.marker === true
      && g2.g2_header === true
      && g2.terminal_header === true,
    productionExecutionAllowed: false
  };
  console.log(JSON.stringify(result, null, 2));
  if (args.has("--require-ready") && !result.readyThroughG2) {
    process.exitCode = 1;
  }
}

await main();
