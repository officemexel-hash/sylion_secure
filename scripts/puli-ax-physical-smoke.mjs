#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_ROUTER_IP = "192.168.8.1";
const DEFAULT_LOCAL_IP = null;
const DEFAULT_OUT = "docs/admin-panel-v2/test-artifacts/puli-ax-physical-smoke/latest.json";

function argValue(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasArg(name) {
  return process.argv.includes(`--${name}`);
}

function isoNow() {
  return new Date().toISOString();
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        windowsHide: true,
        timeout: options.timeout || 10_000,
        maxBuffer: options.maxBuffer || 1024 * 1024
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error?.code || 0,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          message: error?.message || null
        });
      }
    );
  });
}

async function tcpOpen(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function httpProbe(routerIp) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: routerIp,
        port: 80,
        method: "GET",
        path: "/",
        timeout: 5000
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 4096) req.destroy();
        });
        res.on("end", () => {
          const title = /<title>(.*?)<\/title>/i.exec(body)?.[1] || null;
          resolve({
            reachable: true,
            statusCode: res.statusCode,
            server: res.headers.server || null,
            title,
            glinetUiDetected: /gl-ui|Admin Panel|GL\.?iNet/i.test(body + " " + String(title || ""))
          });
        });
      }
    );
    req.once("timeout", () => {
      req.destroy();
      resolve({ reachable: false, reason: "timeout" });
    });
    req.once("error", (error) => resolve({ reachable: false, reason: error.code || "error" }));
    req.end();
  });
}

async function dnsProbe(routerIp, hostname = "openai.com") {
  const previous = dns.getServers();
  try {
    dns.setServers([routerIp]);
    const result = await Promise.race([
      dns.resolve4(hostname),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
    ]);
    return {
      reachable: true,
      query: hostname,
      answers: result.length,
      internalTargetObserved: result.includes("10.42.0.12")
    };
  } catch (error) {
    return {
      reachable: false,
      query: hostname,
      reason: error.code || error.message || "dns_failed"
    };
  } finally {
    dns.setServers(previous);
  }
}

async function internetViaLocalAddress(localAddress) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: "ifconfig.me",
        path: "/ip",
        method: "GET",
        timeout: 8000,
        localAddress,
        headers: { "user-agent": "sylion-puli-ax-smoke/1.0" }
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          resolve({
            reachable: res.statusCode >= 200 && res.statusCode < 400,
            statusCode: res.statusCode,
            egressIpRedacted: true
          })
        );
      }
    );
    req.once("timeout", () => {
      req.destroy();
      resolve({ reachable: false, reason: "timeout" });
    });
    req.once("error", (error) => resolve({ reachable: false, reason: error.code || "error" }));
    req.end();
  });
}

async function windowsNetFacts(routerIp) {
  if (process.platform !== "win32") return { platform: process.platform, supported: false };
  const ps = await execFileAsync("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    [
      "$cfg = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway.NextHop -eq '" +
        routerIp +
        "' } | Select-Object -First 1;",
      "$profile = if ($cfg) { Get-NetConnectionProfile -InterfaceIndex $cfg.InterfaceIndex -ErrorAction SilentlyContinue } else { $null };",
      "$neighbor = Get-NetNeighbor -AddressFamily IPv4 -IPAddress '" +
        routerIp +
        "' -ErrorAction SilentlyContinue | Select-Object -First 1;",
      "[pscustomobject]@{",
      "InterfaceAlias=$cfg.InterfaceAlias;",
      "InterfaceIndex=$cfg.InterfaceIndex;",
      "IPv4Address=($cfg.IPv4Address.IPAddress -join ',');",
      "Gateway=($cfg.IPv4DefaultGateway.NextHop -join ',');",
      "Dns=($cfg.DNSServer.ServerAddresses -join ',');",
      "IPv4Connectivity=$profile.IPv4Connectivity;",
      "NetworkCategory=$profile.NetworkCategory;",
      "RouterMacObserved=[bool]$neighbor.LinkLayerAddress",
      "} | ConvertTo-Json -Compress"
    ].join(" ")
  ]);
  try {
    return { supported: true, ...JSON.parse(ps.stdout.trim() || "{}") };
  } catch {
    return { supported: true, error: "windows_net_facts_parse_failed" };
  }
}

async function main() {
  const routerIp = argValue("router-ip", DEFAULT_ROUTER_IP);
  const requestedLocalAddress = argValue(
    "local-address",
    process.env.SYLION_PULI_AX_LOCAL_ADDRESS || DEFAULT_LOCAL_IP
  );
  const expectKillSwitch =
    hasArg("expect-killswitch") || process.env.SYLION_PULI_AX_EXPECT_KILLSWITCH === "true";
  const outPath = argValue("out", DEFAULT_OUT);
  const ports = [22, 53, 80, 443, 500, 4500];
  const startedAt = isoNow();
  const tcp = {};
  for (const port of ports) {
    tcp[String(port)] = await tcpOpen(routerIp, port);
  }
  const windows = await windowsNetFacts(routerIp);
  const detectedLocalAddress =
    String(windows?.IPv4Address || "")
      .split(",")
      .map((item) => item.trim())
      .find(Boolean) || null;
  const localAddress = requestedLocalAddress || detectedLocalAddress || undefined;
  const [httpUi, dnsResult, wanResult] = await Promise.all([
    httpProbe(routerIp),
    dnsProbe(routerIp, expectKillSwitch ? "operator.sylion.internal" : "openai.com"),
    internetViaLocalAddress(localAddress)
  ]);
  const blockers = [
    ...(httpUi.glinetUiDetected ? [] : ["glinet_admin_ui_not_detected"]),
    ...(tcp["22"] ? [] : ["ssh_lan_not_open"]),
    ...(tcp["80"] || tcp["443"] ? [] : ["admin_panel_not_reachable"]),
    ...(expectKillSwitch
      ? dnsResult.reachable && dnsResult.internalTargetObserved
        ? []
        : ["router_internal_dns_not_answering"]
      : dnsResult.reachable
        ? []
        : ["router_dns_not_answering"]),
    ...(expectKillSwitch
      ? wanResult.reachable
        ? ["lan_to_wan_not_blocked_under_killswitch"]
        : []
      : wanResult.reachable
        ? []
        : ["wan_or_cellular_uplink_not_ready"]),
    ...(tcp["500"] || tcp["4500"] ? ["ipsec_ports_open_on_lan_review_required"] : [])
  ];
  const summary = {
    component: "puli_ax_physical_smoke",
    routerIp,
    localAddress,
    startedAt,
    completedAt: isoNow(),
    status: blockers.length ? "blocked" : "lan_smoke_passed",
    facts: {
      windows,
      tcp,
      httpUi,
      dns: dnsResult,
      wanViaRouter: wanResult
    },
    controls: {
      secretsStored: false,
      passwordPrinted: false,
      terminalOperationalDataStored: false,
      productionExecutionAllowed: false,
      sideEffectAllowed: false,
      expectKillSwitch
    },
    blockers,
    nextActions: blockers.length
      ? [
          "Verify Puli AX WAN/cellular uplink in the GL.iNet admin panel.",
          "Enable DNS service on LAN or confirm it is intentionally blocked before SYLION tunnel.",
          "Install a dedicated SSH key before any automated router mutation.",
          "Only after SSH key access: capture firmware/package inventory and run kill-switch/DNS tests."
        ]
      : [
          "Install a dedicated SSH key and run authenticated firmware/package inventory.",
          "Generate and apply SYLION router package for the disposable operator.",
          "Run T01-T10 kill-switch, DNS and IPsec tests."
        ]
  };
  if (outPath && !hasArg("no-write")) {
    const absolute = resolve(outPath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
