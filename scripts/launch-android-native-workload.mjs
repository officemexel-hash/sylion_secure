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
    "vnc_listener",
    "vnc_proxy_listener",
    "vnc_proxy_handshake",
    "web_listener",
    "public_drop_rule",
    "package_installed",
    "session",
    "container",
    "wayland_display"
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
printf 'waydroid_container=%s\\n' "$(systemctl is-active waydroid-container 2>/dev/null || true)"
printf 'package_installed=%s\\n' "$(waydroid app list 2>/dev/null | grep -q '^${packageName}[[:space:]]' && echo true || echo false)"
printf 'public_drop_rule=%s\\n' "$(nft list chain inet filter input 2>/dev/null | grep -q 'tcp dport ${port} drop' && echo true || echo false)"
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
X509_NONE = 262

def recvn(sock, count):
    data = b""
    while len(data) < count:
        chunk = sock.recv(count - len(data))
        if not chunk:
            raise ConnectionError("short_read")
        data += chunk
    return data

def connect_weston(target_host, target_port):
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
    if X509_NONE not in subtypes:
        raise RuntimeError("weston_x509_none_not_offered")
    raw.sendall(struct.pack(">I", X509_NONE))
    subtype_status = recvn(raw, 1)
    if subtype_status != b"\\x01":
        raise RuntimeError("weston_x509_none_rejected")
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    tls = context.wrap_socket(raw, server_hostname="weston-vnc")
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
        weston = connect_weston(args.target_host, args.target_port)
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
nohup python3 /usr/local/sbin/sylion-vencrypt-plain-proxy.py --listen-host 127.0.0.1 --listen-port ${localVncProxyPort} --target-host 127.0.0.1 --target-port ${port} >/var/log/sylion-${app}-vencrypt-proxy.log 2>&1 &
sleep 2
nohup waydroid session start >/var/log/sylion-${app}-waydroid-session.log 2>&1 &
sleep 20
if waydroid app list 2>/dev/null | grep -q '^${packageName}[[:space:]]'; then
  nohup waydroid app launch ${packageName} >/var/log/sylion-${app}-waydroid-ui.log 2>&1 &
else
  nohup waydroid show-full-ui >/var/log/sylion-${app}-waydroid-ui.log 2>&1 &
fi
sleep 5
nohup websockify --web=/usr/share/novnc ${workloadBind}:${webPort} 127.0.0.1:${localVncProxyPort} >/var/log/sylion-${app}-websockify.log 2>&1 &
sleep 2
printf 'session=%s\\n' "$(waydroid status | awk -F: '/Session:/{gsub(/[[:space:]]/,"",$2); print $2}')"
printf 'container=%s\\n' "$(waydroid status | awk -F: '/Container:/{gsub(/[[:space:]]/,"",$2); print $2}')"
printf 'wayland_display=%s\\n' "$(waydroid status | awk -F: '/Wayland display:/{gsub(/^[[:space:]]+/,"",$2); print $2}')"
printf 'package_installed=%s\\n' "$(waydroid app list 2>/dev/null | grep -q '^${packageName}[[:space:]]' && echo true || echo false)"
printf 'vnc_listener=%s\\n' "$(ss -ltn 2>/dev/null | grep -q ':${port} ' && echo true || echo false)"
printf 'vnc_proxy_listener=%s\\n' "$(ss -ltn 2>/dev/null | grep -q '127.0.0.1:${localVncProxyPort}' && echo true || echo false)"
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
    streamReady: facts.session === "RUNNING" && facts.container === "RUNNING" && facts.vnc_listener === true && facts.vnc_proxy_listener === true && facts.vnc_proxy_handshake === true && facts.web_listener === true,
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
