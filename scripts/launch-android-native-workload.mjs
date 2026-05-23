#!/usr/bin/env node
import { spawn } from "node:child_process";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";
const sshKey = arg("key", process.env.SYLION_ADMIN_SSH_KEY || process.env.SYLION_WORKLOAD_SSH_KEY || defaultSshKey);
const host = arg("host", process.env.SYLION_WORKLOAD_SSH_HOST);
const user = arg("user", process.env.SYLION_WORKLOAD_SSH_USER || "root");
const target = arg("target", process.env.SYLION_WORKLOAD_SSH || (host ? `${user}@${host}` : null));
const app = arg("app", "zangi");
const packageName = arg("package", "com.beint.zangi");
const width = Number(arg("width", "412"));
const height = Number(arg("height", "915"));
const port = Number(arg("port", "5914"));
const workloadBind = arg("workload-bind", process.env.SYLION_WORKLOAD_BIND || "10.44.0.13");
const webPort = Number(arg("web-port", "3014"));
const localVncProxyPort = Number(arg("local-vnc-proxy-port", "5916"));
const apply = process.argv.includes("--apply");
const confirmation = arg("confirm", "");

if (!/^[a-z0-9_-]+$/i.test(app)) {
  throw new Error("--app must contain only letters, numbers, underscore or dash");
}
if (!/^[a-zA-Z0-9_.]+$/.test(packageName)) {
  throw new Error("--package must be an Android package identifier");
}
if (!Number.isInteger(width) || width < 320 || width > 3840) throw new Error("--width is outside allowed range");
if (!Number.isInteger(height) || height < 320 || height > 3840) throw new Error("--height is outside allowed range");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port is outside allowed range");
if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65535) throw new Error("--web-port is outside allowed range");
if (!Number.isInteger(localVncProxyPort) || localVncProxyPort < 1024 || localVncProxyPort > 65535) throw new Error("--local-vnc-proxy-port is outside allowed range");
if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(workloadBind)) throw new Error("--workload-bind must be an IPv4 address");
if (workloadBind.split(".").some((part) => Number(part) > 255)) throw new Error("--workload-bind octets must be 0-255");

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

async function ssh(script, timeout = 120_000) {
  if (!target) throw new Error("Missing target. Provide --target=user@host or --host=host");
  return run("ssh", [
    "-i",
    sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=10",
    "-o",
    "ServerAliveCountMax=2",
    "-o",
    "StrictHostKeyChecking=accept-new",
    target,
    "bash -s"
  ], { input: script, timeout });
}

function parseFacts(stdout) {
  const allowed = new Set([
    "waydroid",
    "waydroid_container",
    "weston",
    "websockify",
    "novnc",
    "python3",
    "dbus_run_session",
    "vnc_listener",
    "vnc_proxy_listener",
    "vnc_proxy_handshake",
    "web_listener",
    "public_drop_rule",
    "pam_auth_configured",
    "package_installed",
    "session",
    "container",
    "wayland_display",
    "weston_service",
    "vnc_proxy_service",
    "websockify_service",
    "waydroid_session_service"
  ]);
  return Object.fromEntries(stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [key, ...rest] = line.split("=");
    if (!allowed.has(key)) return [];
    const value = rest.join("=");
    if (value === "true") return [[key, true]];
    if (value === "false") return [[key, false]];
    return [[key, value]];
  }));
}

async function plan() {
  const { stdout } = await ssh(`
set -euo pipefail
printf 'waydroid=%s\\n' "$(command -v waydroid >/dev/null 2>&1 && echo true || echo false)"
printf 'weston=%s\\n' "$(command -v weston >/dev/null 2>&1 && echo true || echo false)"
printf 'websockify=%s\\n' "$(command -v websockify >/dev/null 2>&1 && echo true || echo false)"
printf 'novnc=%s\\n' "$([ -d /usr/share/novnc ] && echo true || echo false)"
printf 'python3=%s\\n' "$(command -v python3 >/dev/null 2>&1 && echo true || echo false)"
printf 'dbus_run_session=%s\\n' "$(command -v dbus-run-session >/dev/null 2>&1 && echo true || echo false)"
printf 'waydroid_container=%s\\n' "$(systemctl is-active waydroid-container 2>/dev/null || true)"
printf 'package_installed=%s\\n' "$(waydroid app list 2>/dev/null | grep -q '^${packageName}[[:space:]]' && echo true || echo false)"
printf 'public_drop_rule=%s\\n' "$(nft list chain inet filter input 2>/dev/null | grep -q 'tcp dport ${port} drop' && echo true || echo false)"
printf 'pam_auth_configured=%s\\n' "$([ -f /etc/pam.d/weston-remote-access ] && [ -f /usr/local/lib/sylion-weston-vnc-pam-auth.py ] && [ -f /etc/sylion/waydroid-vnc/plain-auth.env ] && echo true || echo false)"
printf 'vnc_listener=%s\\n' "$(ss -ltn 2>/dev/null | grep -q ':${port} ' && echo true || echo false)"
printf 'vnc_proxy_listener=%s\\n' "$(ss -ltn 2>/dev/null | grep -q '127.0.0.1:${localVncProxyPort}' && echo true || echo false)"
printf 'vnc_proxy_handshake=false\\n'
printf 'web_listener=%s\\n' "$(ss -ltn 2>/dev/null | grep -q '${workloadBind}:${webPort}' && echo true || echo false)"
`);
  const facts = parseFacts(stdout);
  const blockers = [
    ...(facts.waydroid ? [] : ["waydroid_not_installed"]),
    ...(facts.weston ? [] : ["weston_not_installed"]),
    ...(facts.websockify ? [] : ["websockify_not_installed"]),
    ...(facts.novnc ? [] : ["novnc_web_assets_missing"]),
    ...(facts.python3 ? [] : ["python3_not_installed"]),
    ...(facts.dbus_run_session ? [] : ["dbus_run_session_not_installed"]),
    ...(facts.waydroid_container === "active" ? [] : ["waydroid_container_not_active"])
  ];
  return {
    mode: "plan_only",
    targetHost: target,
    app,
    packageName,
    stream: {
      protocol: "novnc_over_g2_private_websockify_vnc_vencrypt_adapter",
      port,
      localVncProxyPort,
      noVncWebPort: webPort,
      noVncBind: workloadBind,
      width,
      height,
      publicInterfaceDropRequired: true
    },
    facts,
    readyForApply: blockers.length === 0,
    blockers,
    terminalDataStored: false,
    cdrRequired: true,
    productionExecutionAllowed: false
  };
}

async function applyLaunch(planResult) {
  const envGate = process.env.SYLION_ANDROID_UI_LAUNCH_ALLOWED === "true";
  const confirmGate = confirmation === "LAUNCH_ANDROID_UI";
  if (!apply) return planResult;
  if (!envGate || !confirmGate || !planResult.readyForApply) {
    return {
      ...planResult,
      mode: "blocked_before_apply",
      applied: false,
      blockers: [
        ...planResult.blockers,
        ...(envGate ? [] : ["SYLION_ANDROID_UI_LAUNCH_ALLOWED_not_true"]),
        ...(confirmGate ? [] : ["confirmation_phrase_missing"])
      ]
    };
  }
  const { stdout } = await ssh(`
set -euo pipefail
nft list chain inet filter input >/dev/null 2>&1 || nft add table inet filter || true
nft list chain inet filter input >/dev/null 2>&1 || nft 'add chain inet filter input { type filter hook input priority filter; policy accept; }'
nft list chain inet filter input | grep -q 'tcp dport ${port} drop' || nft add rule inet filter input iifname "eno1" tcp dport ${port} drop
install -d -m 0700 /etc/sylion/waydroid-vnc
if [ ! -f /etc/sylion/waydroid-vnc/tls.key ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 30 \\
    -subj '/CN=${app}-android.sylion.internal' \\
    -keyout /etc/sylion/waydroid-vnc/tls.key \\
    -out /etc/sylion/waydroid-vnc/tls.crt >/dev/null 2>&1
  chmod 0600 /etc/sylion/waydroid-vnc/tls.key
  chmod 0644 /etc/sylion/waydroid-vnc/tls.crt
fi
if [ ! -f /etc/sylion/waydroid-vnc/plain-auth.env ]; then
  auth_password="$(openssl rand -base64 36 | tr -d '\\n')"
  umask 077
  printf 'WESTON_REMOTE_USER=root\\nWESTON_REMOTE_PASSWORD=%s\\n' "$auth_password" > /etc/sylion/waydroid-vnc/plain-auth.env
  chmod 0600 /etc/sylion/waydroid-vnc/plain-auth.env
fi
cat > /usr/local/lib/sylion-weston-vnc-pam-auth.py <<'SYLION_PAM_AUTH'
#!/usr/bin/env python3
import hmac
import os
import sys

def read_env(path):
    values = {}
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key] = value
    return values

try:
    env = read_env("/etc/sylion/waydroid-vnc/plain-auth.env")
    expected_user = env.get("WESTON_REMOTE_USER", "root")
    expected_password = env["WESTON_REMOTE_PASSWORD"]
    pam_user = os.environ.get("PAM_USER", "")
    provided = sys.stdin.buffer.read().decode("utf-8", errors="ignore").rstrip("\\x00\\r\\n")
    if pam_user != expected_user:
        sys.exit(1)
    if not hmac.compare_digest(provided, expected_password):
        sys.exit(1)
    sys.exit(0)
except Exception:
    sys.exit(1)
SYLION_PAM_AUTH
chmod 0755 /usr/local/lib/sylion-weston-vnc-pam-auth.py
cat > /etc/pam.d/weston-remote-access <<'SYLION_WESTON_PAM'
auth requisite pam_exec.so expose_authtok quiet /usr/local/lib/sylion-weston-vnc-pam-auth.py
account required pam_permit.so
SYLION_WESTON_PAM
chmod 0644 /etc/pam.d/weston-remote-access
waydroid session stop >/dev/null 2>&1 || true
pkill -f 'sylion-${app}-wayland|weston.*${port}|websockify.*${workloadBind}:${webPort}|sylion-vencrypt-plain-proxy.*${localVncProxyPort}|stunnel.*sylion-waydroid-${app}' 2>/dev/null || true
install -d -m 0700 /run/sylion-waydroid-${app}
install -d -m 0700 /run/sylion-waydroid-${app}/pulse
: > /run/sylion-waydroid-${app}/pulse/native
export XDG_RUNTIME_DIR=/run/sylion-waydroid-${app}
export WAYLAND_DISPLAY=sylion-${app}-wayland
export XDG_SESSION_TYPE=wayland
nohup weston --backend=vnc-backend.so --socket="$WAYLAND_DISPLAY" --port=${port} --width=${width} --height=${height} \\
  --vnc-tls-cert=/etc/sylion/waydroid-vnc/tls.crt --vnc-tls-key=/etc/sylion/waydroid-vnc/tls.key \\
  --no-config --idle-time=0 --renderer=pixman --log=/var/log/sylion-${app}-weston-vnc.log >/var/log/sylion-${app}-weston-vnc.out 2>&1 &
sleep 4
cat > /usr/local/sbin/sylion-vencrypt-plain-proxy.py <<'SYLION_PROXY'
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
        reason = b""
        try:
            reason_len = struct.unpack(">I", recvn(tls, 4))[0]
            if 0 < reason_len < 4096:
                reason = recvn(tls, reason_len)
        except Exception:
            pass
        raise RuntimeError("weston_plain_auth_failed" + (":" + reason.decode("utf-8", "ignore") if reason else ""))

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
    status = recvn(raw, 1)
    if status != b"\\x00":
        raise RuntimeError("weston_vencrypt_version_rejected")
    subtype_count = recvn(raw, 1)[0]
    subtype_raw = recvn(raw, subtype_count * 4)
    subtypes = [
        struct.unpack(">I", subtype_raw[index:index + 4])[0]
        for index in range(0, len(subtype_raw), 4)
    ]
    if X509_PLAIN not in subtypes:
        raise RuntimeError("weston_x509_plain_not_offered")
    raw.sendall(struct.pack(">I", X509_PLAIN))
    subtype_status = recvn(raw, 1)
    if subtype_status != b"\\x01":
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
            if not readable:
                continue
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
    try:
        weston = connect_weston(args.target_host, args.target_port, args.auth_file)
        client.sendall(RFB_VERSION)
        _client_version = recvn(client, 12)
        client.sendall(b"\\x01\\x01")
        selected = recvn(client, 1)
        if selected != b"\\x01":
            raise RuntimeError("client_rejected_none_security")
        client.sendall(b"\\x00\\x00\\x00\\x00")
        bridge(client, weston)
    except Exception as exc:
        print(f"proxy_client_error={exc}", flush=True)
        try:
            client.close()
        except OSError:
            pass

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen-host", default="127.0.0.1")
    parser.add_argument("--listen-port", type=int, required=True)
    parser.add_argument("--target-host", default="127.0.0.1")
    parser.add_argument("--target-port", type=int, required=True)
    parser.add_argument("--auth-file", default="/etc/sylion/waydroid-vnc/plain-auth.env")
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
SYLION_PROXY
chmod 0755 /usr/local/sbin/sylion-vencrypt-plain-proxy.py
cat > /usr/local/sbin/sylion-${app}-android-session-keepalive.sh <<'SYLION_SESSION_KEEPALIVE'
#!/usr/bin/env bash
set -uo pipefail

APP="${app}"
PACKAGE_NAME="${packageName}"
RUNTIME_DIR="/run/sylion-waydroid-${app}"
WAYLAND_NAME="sylion-${app}-wayland"
SESSION_LOG="/var/log/sylion-${app}-waydroid-session.log"
UI_LOG="/var/log/sylion-${app}-waydroid-ui.log"

export XDG_RUNTIME_DIR="$RUNTIME_DIR"
export WAYLAND_DISPLAY="$WAYLAND_NAME"
export XDG_SESSION_TYPE=wayland
export HOME=/root

launch_ui() {
  if waydroid app list 2>/dev/null | grep -q "^$PACKAGE_NAME[[:space:]]"; then
    nohup waydroid app launch "$PACKAGE_NAME" >>"$UI_LOG" 2>&1 &
  else
    nohup waydroid show-full-ui >>"$UI_LOG" 2>&1 &
  fi
}

install -d -m 0700 "$RUNTIME_DIR" "$RUNTIME_DIR/pulse"
: > "$RUNTIME_DIR/pulse/native"
last_launch=0

while true; do
  systemctl is-active --quiet waydroid-container || systemctl start waydroid-container || true
  status="$(waydroid status 2>/dev/null | awk -F: '/Session:/{gsub(/[[:space:]]/,"",$2); print $2}' || true)"
  if [ "$status" != "RUNNING" ]; then
    nohup waydroid session start >>"$SESSION_LOG" 2>&1 &
    sleep 20
    last_launch=0
  fi
  now="$(date +%s)"
  if [ "$last_launch" -eq 0 ] || [ $((now - last_launch)) -ge 120 ]; then
    launch_ui
    last_launch="$now"
  fi
  sleep 15
done
SYLION_SESSION_KEEPALIVE
chmod 0755 /usr/local/sbin/sylion-${app}-android-session-keepalive.sh

pkill -f 'sylion-${app}-wayland|weston.*${port}|websockify.*${workloadBind}:${webPort}|sylion-vencrypt-plain-proxy.*${localVncProxyPort}|stunnel.*sylion-waydroid-${app}' 2>/dev/null || true
cat > /etc/systemd/system/sylion-${app}-weston-vnc.service <<'SYLION_WESTON_UNIT'
[Unit]
Description=SYLION ${app} Android Weston VNC stream
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
RuntimeDirectory=sylion-waydroid-${app}
RuntimeDirectoryMode=0700
Environment=XDG_RUNTIME_DIR=/run/sylion-waydroid-${app}
Environment=WAYLAND_DISPLAY=sylion-${app}-wayland
Environment=XDG_SESSION_TYPE=wayland
ExecStartPre=/usr/bin/install -d -m 0700 /run/sylion-waydroid-${app}/pulse
ExecStartPre=/usr/bin/touch /run/sylion-waydroid-${app}/pulse/native
ExecStart=/usr/bin/weston --backend=vnc-backend.so --socket=sylion-${app}-wayland --port=${port} --width=${width} --height=${height} --vnc-tls-cert=/etc/sylion/waydroid-vnc/tls.crt --vnc-tls-key=/etc/sylion/waydroid-vnc/tls.key --no-config --idle-time=0 --renderer=pixman --log=/var/log/sylion-${app}-weston-vnc.log
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SYLION_WESTON_UNIT

cat > /etc/systemd/system/sylion-${app}-vnc-proxy.service <<'SYLION_PROXY_UNIT'
[Unit]
Description=SYLION ${app} VNC VeNCrypt to RFB adapter
After=sylion-${app}-weston-vnc.service
Requires=sylion-${app}-weston-vnc.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/local/sbin/sylion-vencrypt-plain-proxy.py --listen-host 127.0.0.1 --listen-port ${localVncProxyPort} --target-host 127.0.0.1 --target-port ${port} --auth-file /etc/sylion/waydroid-vnc/plain-auth.env
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SYLION_PROXY_UNIT

cat > /etc/systemd/system/sylion-${app}-websockify.service <<'SYLION_WEBSOCKIFY_UNIT'
[Unit]
Description=SYLION ${app} private noVNC bridge
After=sylion-${app}-vnc-proxy.service
Requires=sylion-${app}-vnc-proxy.service

[Service]
Type=simple
ExecStart=/usr/bin/websockify --web=/usr/share/novnc ${workloadBind}:${webPort} 127.0.0.1:${localVncProxyPort}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SYLION_WEBSOCKIFY_UNIT

cat > /etc/systemd/system/sylion-${app}-android-session.service <<'SYLION_SESSION_UNIT'
[Unit]
Description=SYLION ${app} Android Waydroid session keepalive
After=waydroid-container.service sylion-${app}-weston-vnc.service
Requires=waydroid-container.service sylion-${app}-weston-vnc.service

[Service]
Type=simple
Environment=XDG_RUNTIME_DIR=/run/sylion-waydroid-${app}
Environment=WAYLAND_DISPLAY=sylion-${app}-wayland
Environment=XDG_SESSION_TYPE=wayland
ExecStart=/usr/bin/dbus-run-session -- /usr/local/sbin/sylion-${app}-android-session-keepalive.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SYLION_SESSION_UNIT

systemctl daemon-reload
systemctl enable sylion-${app}-weston-vnc.service sylion-${app}-vnc-proxy.service sylion-${app}-websockify.service sylion-${app}-android-session.service >/dev/null
systemctl restart sylion-${app}-weston-vnc.service
sleep 4
systemctl restart sylion-${app}-vnc-proxy.service
sleep 2
systemctl restart sylion-${app}-websockify.service
systemctl restart sylion-${app}-android-session.service
sleep 35
printf 'session=%s\\n' "$(waydroid status | awk -F: '/Session:/{gsub(/[[:space:]]/,"",$2); print $2}')"
printf 'container=%s\\n' "$(waydroid status | awk -F: '/Container:/{gsub(/[[:space:]]/,"",$2); print $2}')"
printf 'wayland_display=%s\\n' "$(waydroid status | awk -F: '/Wayland display:/{gsub(/^[[:space:]]+/,"",$2); print $2}')"
printf 'package_installed=%s\\n' "$(waydroid app list 2>/dev/null | grep -q '^${packageName}[[:space:]]' && echo true || echo false)"
printf 'weston_service=%s\\n' "$(systemctl is-active sylion-${app}-weston-vnc.service 2>/dev/null || true)"
printf 'vnc_proxy_service=%s\\n' "$(systemctl is-active sylion-${app}-vnc-proxy.service 2>/dev/null || true)"
printf 'websockify_service=%s\\n' "$(systemctl is-active sylion-${app}-websockify.service 2>/dev/null || true)"
printf 'waydroid_session_service=%s\\n' "$(systemctl is-active sylion-${app}-android-session.service 2>/dev/null || true)"
printf 'vnc_listener=%s\\n' "$(ss -ltn 2>/dev/null | grep -q ':${port} ' && echo true || echo false)"
printf 'vnc_proxy_listener=%s\\n' "$(ss -ltn 2>/dev/null | grep -q '127.0.0.1:${localVncProxyPort}' && echo true || echo false)"
printf 'pam_auth_configured=%s\\n' "$([ -f /etc/pam.d/weston-remote-access ] && [ -f /usr/local/lib/sylion-weston-vnc-pam-auth.py ] && [ -f /etc/sylion/waydroid-vnc/plain-auth.env ] && echo true || echo false)"
printf 'vnc_proxy_handshake=%s\\n' "$(python3 - <<'PY' >/dev/null 2>&1 && echo true || echo false
import socket

def recvn(sock, count):
    data = b""
    while len(data) < count:
        chunk = sock.recv(count - len(data))
        if not chunk:
            raise RuntimeError("short_read")
        data += chunk
    return data

sock = socket.create_connection(("127.0.0.1", ${localVncProxyPort}), timeout=5)
sock.settimeout(5)
banner = recvn(sock, 12)
if not banner.startswith(b"RFB "):
    raise RuntimeError("missing_rfb")
sock.sendall(b"RFB 003.008\\n")
security = recvn(sock, 2)
if security != b"\\x01\\x01":
    raise RuntimeError("unexpected_security")
sock.sendall(b"\\x01")
result = recvn(sock, 4)
if result != b"\\x00\\x00\\x00\\x00":
    raise RuntimeError("security_result_failed")
sock.sendall(b"\\x01")
server_init = recvn(sock, 4)
if len(server_init) != 4:
    raise RuntimeError("missing_server_init")
PY
)"
printf 'web_listener=%s\\n' "$(ss -ltn 2>/dev/null | grep -q '${workloadBind}:${webPort}' && echo true || echo false)"
printf 'public_drop_rule=%s\\n' "$(nft list chain inet filter input 2>/dev/null | grep -q 'tcp dport ${port} drop' && echo true || echo false)"
`, 180_000);
  const facts = parseFacts(stdout);
  return {
    ...planResult,
    mode: "applied",
    applied: true,
    applyFacts: facts,
    streamReady: facts.session === "RUNNING" && facts.container === "RUNNING" && facts.weston_service === "active" && facts.vnc_proxy_service === "active" && facts.websockify_service === "active" && facts.waydroid_session_service === "active" && facts.pam_auth_configured === true && facts.vnc_listener === true && facts.vnc_proxy_listener === true && facts.vnc_proxy_handshake === true && facts.web_listener === true,
    appLaunchMode: facts.package_installed === true ? "package_launch" : "android_full_ui_no_app_installed",
    productionExecutionAllowed: false
  };
}

const planResult = await plan();
const result = await applyLaunch(planResult);
console.log(JSON.stringify({
  component: "android_native_workload_launcher",
  ...result,
  checkedAt: new Date().toISOString()
}, null, 2));

if ((apply && result.applied !== true) || (!result.readyForApply && process.argv.includes("--require-ready"))) {
  process.exitCode = 1;
}
