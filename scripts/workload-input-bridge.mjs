#!/usr/bin/env node
import { spawn } from "node:child_process";

const APP_PORTS = Object.freeze({
  duckduckgo_browser: 15901,
  libreoffice: 15902,
  whatsapp: 15910,
  telegram: 15911,
  threema: 15912,
  signal: 15913,
  zangi: 15916,
  exodus: 15915
});

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));

const app = normalizeApp(args.get("app") || process.env.SYLION_WORKLOAD_INPUT_APP || "duckduckgo_browser");
const port = APP_PORTS[app];
if (!port) fail("unsupported_app", { app, supported: Object.keys(APP_PORTS) });

const cfg = {
  g2Host: process.env.SYLION_G2_SSH || "sylion@178.105.203.31",
  sshKey: process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey,
  bridgeHost: process.env.SYLION_G2_DOCKER_BRIDGE_IP || "172.18.0.1",
  connectTimeoutSeconds: Number(process.env.SYLION_WORKLOAD_INPUT_CONNECT_TIMEOUT_SECONDS || 8)
};

const input = await readStdinJson();
const text = sanitizeInputText(input.text);
const submit = input.submit === true;
if (!text && !submit) fail("empty_input", { app });

const remotePayload = JSON.stringify({
  app,
  host: cfg.bridgeHost,
  port,
  text,
  submit,
  connectTimeoutSeconds: cfg.connectTimeoutSeconds
});

const remotePython = String.raw`
import json
import socket
import struct
import sys
import time

payload = json.load(sys.stdin)
text = payload.get("text", "")
submit = bool(payload.get("submit", False))
host = payload.get("host", "172.18.0.1")
port = int(payload["port"])
timeout = float(payload.get("connectTimeoutSeconds", 8))

def recv_exact(sock, size):
    chunks = []
    remaining = size
    while remaining > 0:
        chunk = sock.recv(remaining)
        if not chunk:
            raise RuntimeError("rfb_unexpected_eof")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)

def key_event(sock, down, keysym):
    sock.sendall(struct.pack(">BBHI", 4, 1 if down else 0, 0, keysym))

def keysym(char):
    if char == "\n":
        return 0xff0d
    if char == "\t":
        return 0xff09
    return ord(char)

with socket.create_connection((host, port), timeout) as sock:
    sock.settimeout(timeout)
    version = recv_exact(sock, 12)
    if not version.startswith(b"RFB "):
        raise RuntimeError("rfb_banner_missing")
    sock.sendall(version)
    security_types_count = recv_exact(sock, 1)[0]
    if security_types_count == 0:
        reason_len = struct.unpack(">I", recv_exact(sock, 4))[0]
        reason = recv_exact(sock, reason_len).decode("utf-8", "replace")
        raise RuntimeError("rfb_security_rejected:" + reason[:80])
    security_types = recv_exact(sock, security_types_count)
    if 1 not in security_types:
        raise RuntimeError("rfb_none_security_unavailable")
    sock.sendall(b"\x01")
    security_result = struct.unpack(">I", recv_exact(sock, 4))[0]
    if security_result != 0:
        raise RuntimeError("rfb_security_result_failed")
    sock.sendall(b"\x01")
    server_init = recv_exact(sock, 24)
    width, height = struct.unpack(">HH", server_init[:4])
    name_len = struct.unpack(">I", server_init[20:24])[0]
    if name_len:
        recv_exact(sock, name_len)
    keys_sent = 0
    for char in text:
        ks = keysym(char)
        key_event(sock, True, ks)
        time.sleep(0.006)
        key_event(sock, False, ks)
        keys_sent += 1
    if submit:
        key_event(sock, True, 0xff0d)
        time.sleep(0.006)
        key_event(sock, False, 0xff0d)
        keys_sent += 1
    print(json.dumps({
        "component": "g2_vnc_input_bridge",
        "app": payload.get("app"),
        "port": port,
        "keysSent": keys_sent,
        "charsSent": len(text),
        "submitSent": submit,
        "framebuffer": {"width": width, "height": height},
        "securityType": "none",
        "inputContentPrinted": False,
        "terminalDataStored": False
    }))
`;
const remoteCommand = `python3 -c 'import base64; exec(base64.b64decode("${Buffer.from(remotePython, "utf8").toString("base64")}"))'`;

const result = await spawnWithStdin("ssh", [
  "-i", cfg.sshKey,
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=accept-new",
  "-o", `ConnectTimeout=${cfg.connectTimeoutSeconds}`,
  cfg.g2Host,
  remoteCommand
], remotePayload, Number(process.env.SYLION_WORKLOAD_INPUT_TIMEOUT_MS || 30_000));

const start = result.stdout.indexOf("{");
const end = result.stdout.lastIndexOf("}");
if (start < 0 || end < start) fail("remote_json_not_found", { app });
process.stdout.write(`${result.stdout.slice(start, end + 1)}\n`);

function normalizeApp(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "duckduckgo" || key === "browser") return "duckduckgo_browser";
  return key.replace(/[^a-z0-9_-]/g, "");
}

function sanitizeInputText(value) {
  const text = String(value ?? "");
  if (text.length > 512) fail("input_too_long", { maxLength: 512 });
  for (const char of text) {
    const code = char.codePointAt(0);
    if ((code >= 0x20 && code <= 0x7e) || char === "\n" || char === "\t") continue;
    fail("unsupported_character", { allowed: "printable_ascii_tab_newline" });
  }
  return text;
}

function readStdinJson() {
  return new Promise((resolve, reject) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2048) reject(new Error("stdin_too_large"));
    });
    process.stdin.on("end", () => {
      try {
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    process.stdin.on("error", reject);
  });
}

function spawnWithStdin(command, commandArgs, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("ssh_timeout"));
        return;
      }
      if (code !== 0) {
        const error = new Error("ssh_remote_bridge_failed");
        error.code = code;
        error.stderr = stderr.trim().slice(0, 400);
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function fail(code, extra = {}) {
  process.stdout.write(JSON.stringify({
    component: "g2_vnc_input_bridge",
    state: "failed",
    errorCode: code,
    ...extra,
    inputContentPrinted: false,
    terminalDataStored: false
  }));
  process.exit(1);
}
