#!/usr/bin/env node
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const DEFAULT_ROUTER_IP = "192.168.8.1";
const DEFAULT_ROUTER_CIDR_PREFIX = "192.168.8.";
const DEFAULT_OUT = "docs/admin-panel-v2/test-artifacts/pixel-puli-ax-network-smoke/latest.json";
const DEFAULT_ADB = process.platform === "win32"
  ? "C:\\Users\\razor\\Android\\platform-tools\\adb.exe"
  : "adb";

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

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, {
      windowsHide: true,
      timeout: options.timeout || 15_000,
      maxBuffer: options.maxBuffer || 1024 * 1024
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code || 0,
        stdout: String(stdout || "").trim(),
        stderr: String(stderr || "").trim(),
        message: error?.message || null
      });
    });
  });
}

async function resolveAdbPath() {
  const configured = process.env.SYLION_ADB_PATH || argValue("adb", null);
  if (configured) {
    return configured;
  }
  if (process.platform === "win32" && await exists(DEFAULT_ADB)) {
    return DEFAULT_ADB;
  }
  const local = join(process.cwd(), ".deploy", "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
  if (await exists(local)) {
    return local;
  }
  return DEFAULT_ADB;
}

function parseDeviceList(output) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/);
      return { serial, state, detail: rest.join(" ") };
    });
}

async function adb(adbPath, args, options = {}) {
  return execFileAsync(adbPath, args, options);
}

async function adbShell(adbPath, serial, command, options = {}) {
  return adb(adbPath, ["-s", serial, "shell", command], options);
}

function parseWifiState(wifiDump) {
  const connected = /Wi-Fi is enabled|wifi is enabled|mNetworkInfo.*CONNECTED|state:\s*CONNECTED/i.test(wifiDump);
  const ssidMatch = /\bSSID:\s*"?([^",\r\n]+)"?/i.exec(wifiDump)
    || /\bmWifiInfo.*SSID:\s*"?([^",\r\n]+)"?/i.exec(wifiDump);
  const ssid = ssidMatch?.[1]?.trim();
  return {
    connected,
    ssidObserved: Boolean(ssid && ssid !== "<unknown ssid>"),
    ssidSha256: ssid && ssid !== "<unknown ssid>" ? hash(ssid) : null
  };
}

function parseNetworkFacts(routeOutput, addrOutput, connectivityOutput, routerIp, routerCidrPrefix) {
  const combined = `${routeOutput}\n${addrOutput}\n${connectivityOutput}`;
  const routerIpPattern = routerIp.replace(/\./g, "\\.");
  const wlanPrivateIpPresent = new RegExp(`\\b${routerCidrPrefix.replace(/\./g, "\\.")}\\d+\\b`).test(addrOutput);
  const puliGatewayPresent = new RegExp(`\\bvia\\s+${routerIpPattern}\\b`).test(routeOutput)
    || routeOutput.includes(routerIp);
  const defaultViaPuli = new RegExp(`\\bdefault\\s+via\\s+${routerIpPattern}\\b`).test(routeOutput);
  const sylionPrivateRoutePresent = /\b10\.(42|43|44)\.\d+\.\d+\b/.test(combined);
  const vpnInterfacePresent = /\b(tun\d+|ipsec\d+|vti\d+)\b/i.test(combined);
  const cellularDefaultPresent = /\brmnet|ccmni|wwan/i.test(routeOutput) && /\bdefault\b/i.test(routeOutput);
  return {
    wlanPrivateIpPresent,
    puliGatewayPresent,
    defaultViaPuli,
    sylionPrivateRoutePresent,
    vpnInterfacePresent,
    cellularDefaultPresent
  };
}

async function main() {
  const startedAt = isoNow();
  const routerIp = argValue("router-ip", DEFAULT_ROUTER_IP);
  const routerCidrPrefix = argValue("router-cidr-prefix", DEFAULT_ROUTER_CIDR_PREFIX);
  const outPath = argValue("out", DEFAULT_OUT);
  const adbPath = await resolveAdbPath();
  const adbDevices = await adb(adbPath, ["devices", "-l"]);

  if (!adbDevices.ok) {
    const summary = {
      component: "pixel_puli_ax_network_smoke",
      startedAt,
      completedAt: isoNow(),
      status: "blocked_adb_unavailable",
      facts: {
        adbAvailable: false,
        adbPathConfigured: Boolean(process.env.SYLION_ADB_PATH || argValue("adb", null))
      },
      controls: {
        secretsStored: false,
        passwordPrinted: false,
        terminalOperationalDataStored: false,
        productionExecutionAllowed: false,
        sideEffectAllowed: false
      },
      blockers: ["adb_unavailable"],
      nextActions: ["Install Android platform-tools or set SYLION_ADB_PATH, then rerun the smoke."]
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = hasArg("require-puli") ? 1 : 0;
    return;
  }

  const devices = parseDeviceList(adbDevices.stdout);
  const unauthorized = devices.find((device) => device.state === "unauthorized");
  const pixel = devices.find((device) => device.state === "device");
  if (unauthorized || !pixel) {
    const summary = {
      component: "pixel_puli_ax_network_smoke",
      startedAt,
      completedAt: isoNow(),
      status: unauthorized ? "blocked_pixel_unauthorized" : "blocked_no_authorized_pixel",
      facts: {
        adbAvailable: true,
        authorizedDeviceCount: devices.filter((device) => device.state === "device").length,
        unauthorizedDevicePresent: Boolean(unauthorized)
      },
      controls: {
        secretsStored: false,
        passwordPrinted: false,
        terminalOperationalDataStored: false,
        productionExecutionAllowed: false,
        sideEffectAllowed: false
      },
      blockers: [unauthorized ? "pixel_adb_unauthorized" : "pixel_adb_device_missing"],
      nextActions: ["Connect and unlock the Pixel, approve the USB debugging prompt, then rerun the smoke."]
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = hasArg("require-puli") ? 1 : 0;
    return;
  }

  const [
    model,
    androidRelease,
    securityPatch,
    route,
    addr,
    wifi,
    connectivity,
    routerPing,
    internetPing
  ] = await Promise.all([
    adbShell(adbPath, pixel.serial, "getprop ro.product.model"),
    adbShell(adbPath, pixel.serial, "getprop ro.build.version.release"),
    adbShell(adbPath, pixel.serial, "getprop ro.build.version.security_patch"),
    adbShell(adbPath, pixel.serial, "ip route", { timeout: 10_000 }),
    adbShell(adbPath, pixel.serial, "ip -4 addr", { timeout: 10_000 }),
    adbShell(adbPath, pixel.serial, "dumpsys wifi", { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 }),
    adbShell(adbPath, pixel.serial, "dumpsys connectivity", { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 }),
    adbShell(adbPath, pixel.serial, `ping -c 1 -W 2 ${routerIp} >/dev/null 2>&1; echo $?`, { timeout: 8_000 }),
    adbShell(adbPath, pixel.serial, "ping -c 1 -W 3 1.1.1.1 >/dev/null 2>&1; echo $?", { timeout: 10_000 })
  ]);

  const wifiState = parseWifiState(wifi.stdout);
  const network = parseNetworkFacts(route.stdout, addr.stdout, connectivity.stdout, routerIp, routerCidrPrefix);
  const routerPingOk = routerPing.stdout.trim().endsWith("0");
  const internetPingOk = internetPing.stdout.trim().endsWith("0");
  const puliLanSeen = network.wlanPrivateIpPresent && routerPingOk;
  const sylionVpnSeen = puliLanSeen && network.vpnInterfacePresent && network.sylionPrivateRoutePresent;
  const status = sylionVpnSeen
    ? "puli_ax_with_sylion_vpn_path_seen"
    : puliLanSeen
      ? "puli_ax_lan_seen"
      : "not_on_puli_ax_network_yet";
  const blockers = [
    ...(puliLanSeen ? [] : ["pixel_not_confirmed_on_puli_ax_lan"]),
    ...(internetPingOk ? [] : ["pixel_internet_egress_not_confirmed"]),
    ...(sylionVpnSeen ? [] : ["sylion_vpn_path_not_confirmed_from_pixel"])
  ];
  const summary = {
    component: "pixel_puli_ax_network_smoke",
    routerIp,
    startedAt,
    completedAt: isoNow(),
    status,
    facts: {
      adbAvailable: true,
      pixel: {
        serialSha256: hash(pixel.serial),
        model: model.stdout || "unknown",
        androidRelease: androidRelease.stdout || "unknown",
        securityPatch: securityPatch.stdout || "unknown"
      },
      wifi: wifiState,
      network,
      probes: {
        routerPingOk,
        internetPingOk
      }
    },
    controls: {
      secretsStored: false,
      passwordPrinted: false,
      terminalOperationalDataStored: false,
      productionExecutionAllowed: false,
      sideEffectAllowed: false
    },
    blockers,
    nextActions: blockers.length ? [
      "Keep Pixel on the current network until Puli AX has the SYLION router package, kill switch and DNS policy installed.",
      "After the controlled Wi-Fi switch, rerun this smoke and require status puli_ax_lan_seen.",
      "After IPsec profile is installed, require status puli_ax_with_sylion_vpn_path_seen before production terminal use."
    ] : [
      "Run Pixel human regression through the operator panel and Guacamole stream.",
      "Capture G1/G2/workload path evidence with the existing native path verifier.",
      "Promote only after router kill-switch and DNS leak tests pass."
    ]
  };

  if (outPath && !hasArg("no-write")) {
    const absolute = resolve(outPath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (hasArg("require-puli") && !puliLanSeen) {
    process.exitCode = 1;
  }
  if (hasArg("require-sylion-vpn") && !sylionVpnSeen) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
