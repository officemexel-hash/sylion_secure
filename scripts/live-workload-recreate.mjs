import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";
const sshKey = process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey;
const workloadHost = process.env.SYLION_WORKLOAD_SSH || "sylion@178.105.197.37";
const g2Host = process.env.SYLION_G2_SSH || "sylion@178.105.203.31";

const apps = {
  duckduckgo: {
    container: "sylion-duckduckgo",
    volume: "sylion_duckduckgo_config",
    port: "3001:3000",
    image: "lscr.io/linuxserver/firefox:latest",
    env: ["PUID=1000", "PGID=1000", "TZ=UTC", "TITLE=SYLION DuckDuckGo", "FIREFOX_CLI=https://duckduckgo.com/"],
    extra: []
  },
  libreoffice: {
    container: "sylion-libreoffice",
    volume: "sylion_libreoffice_config",
    port: "3002:3000",
    image: "lscr.io/linuxserver/libreoffice:latest",
    env: ["PUID=1000", "PGID=1000", "TZ=UTC"],
    extra: []
  },
  whatsapp: {
    container: "sylion-whatsapp-web",
    volume: "sylion_whatsapp_config",
    port: "3010:3000",
    image: "lscr.io/linuxserver/chromium:latest",
    env: ["PUID=1000", "PGID=1000", "TZ=UTC", "TITLE=SYLION WhatsApp Web", "CHROME_CLI=--disable-session-crashed-bubble --no-first-run https://web.whatsapp.com/"],
    extra: []
  },
  telegram: {
    container: "sylion-telegram-web",
    volume: "sylion_telegram_config",
    port: "3011:3000",
    image: "lscr.io/linuxserver/chromium:latest",
    env: ["PUID=1000", "PGID=1000", "TZ=UTC", "TITLE=SYLION Telegram Web", "CHROME_CLI=--disable-session-crashed-bubble --no-first-run https://web.telegram.org/k/"],
    extra: []
  },
  threema: {
    container: "sylion-threema-web",
    volume: "sylion_threema_config",
    port: "3012:3000",
    image: "lscr.io/linuxserver/chromium:latest",
    env: ["PUID=1000", "PGID=1000", "TZ=UTC", "TITLE=SYLION Threema Web", "CHROME_CLI=--disable-session-crashed-bubble --no-first-run https://web.threema.ch/"],
    extra: []
  },
  signal: {
    container: "sylion-signal-desktop",
    volume: "sylion_signal_profile",
    port: "3013:6901",
    image: "sylion/signal-workload:prod-candidate",
    envFile: "/etc/sylion/workload-secrets/signal.env",
    extra: []
  },
  zangi: {
    container: "sylion-zangi-web",
    volume: "sylion_zangi_config",
    port: "3014:3000",
    image: "lscr.io/linuxserver/chromium:latest",
    env: ["PUID=1000", "PGID=1000", "TZ=UTC", "TITLE=SYLION Zangi Gate", "CHROME_CLI=--disable-session-crashed-bubble --no-first-run https://zangi.com/en-us/download"],
    extra: [],
    productionGate: "android_native_runner_required"
  },
  exodus: {
    container: "sylion-exodus",
    volume: "sylion_exodus_config",
    port: "3015:3000",
    image: "lscr.io/linuxserver/chromium:latest",
    env: ["PUID=1000", "PGID=1000", "TZ=UTC", "TITLE=SYLION Exodus Gate", "CHROME_CLI=--disable-session-crashed-bubble --no-first-run https://www.exodus.com/download/"],
    extra: [],
    productionGate: "isolated_wallet_runtime_required"
  }
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name, fallback = null) => {
    const prefix = `${name}=`;
    const found = args.find((arg) => arg.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
  };
  return {
    app: get("--app", "signal"),
    apply: args.includes("--apply"),
    wipeVolume: args.includes("--wipe-volume"),
    printPlan: args.includes("--print-plan")
  };
}

function selectedApps(app) {
  if (app === "all") return Object.keys(apps);
  if (!apps[app]) throw new Error(`Unsupported app ${app}; supported=${Object.keys(apps).join(",")},all`);
  return [app];
}

function plan({ app, wipeVolume }) {
  return {
    component: "live_workload_recreate",
    app,
    selectedApps: selectedApps(app),
    wipeVolume,
    workloadHost,
    g2Host,
    invariants: {
      cdrRequired: true,
      noTerminalOperationalData: true,
      privateBindOnly: true,
      signalAuthHandoffAfterSignalRecreate: app === "signal" || app === "all",
      productionGates: Object.fromEntries(Object.entries(apps).filter(([, cfg]) => cfg.productionGate).map(([key, cfg]) => [key, cfg.productionGate]))
    }
  };
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout ?? 120_000,
    windowsHide: true,
    input: options.input
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function ssh(host, script, options = {}) {
  return run("ssh", [
    "-i",
    sshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    host,
    script
  ], options);
}

function shellSingle(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function remoteRecreateScript({ app, wipeVolume }) {
  const keys = selectedApps(app);
  const blocks = keys.map((key) => {
    const cfg = apps[key];
    const volumeMount = key === "signal" ? `${cfg.volume}:/home/kasm-user/.config/Signal` : `${cfg.volume}:/config`;
    const env = (cfg.env || []).map((item) => `-e ${shellSingle(item)}`).join(" ");
    const envFile = cfg.envFile ? `--env-file ${shellSingle(cfg.envFile)}` : "";
    const extra = (cfg.extra || []).map(shellSingle).join(" ");
    const signalSecret = key === "signal"
      ? `
sudo install -d -m 0700 /etc/sylion/workload-secrets
if [ ! -f /etc/sylion/workload-secrets/signal.env ] || [ "$WIPE_VOLUME" = "true" ]; then
  signal_vnc_pw="$(openssl rand -base64 24 | tr -d '\\n')"
  printf 'VNC_PW=%s\\nKASM_RESOLUTION=1080x2400\\n' "$signal_vnc_pw" | sudo tee /etc/sylion/workload-secrets/signal.env >/dev/null
  sudo chmod 0600 /etc/sylion/workload-secrets/signal.env
fi`
      : "";
    return `
${signalSecret}
sudo docker rm -f ${shellSingle(cfg.container)} >/dev/null 2>&1 || true
if [ "$WIPE_VOLUME" = "true" ]; then sudo docker volume rm -f ${shellSingle(cfg.volume)} >/dev/null 2>&1 || true; fi
sudo docker volume create ${shellSingle(cfg.volume)} >/dev/null
sudo docker run -d --name ${shellSingle(cfg.container)} --restart unless-stopped --shm-size 1g ${env} ${envFile} ${extra} -p "$private_ip:${cfg.port}" -v ${shellSingle(volumeMount)} ${shellSingle(cfg.image)} >/dev/null
`;
  }).join("\n");
  return `
set -euo pipefail
WIPE_VOLUME="${wipeVolume ? "true" : "false"}"
private_ip="$(ip -4 -o addr show | awk '$4 ~ /^10\\.42\\./ { split($4, a, "/"); print a[1]; exit }')"
if [ -z "$private_ip" ]; then echo "missing_private_10_42_address" >&2; exit 2; fi
install -d -m 0755 /opt/sylion-workloads
${blocks}
sudo docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' | sudo tee /opt/sylion-workloads/container-status.txt >/dev/null
jq -n --arg app ${shellSingle(app)} --arg checkedAt "$(date -Is)" --arg wipe "$WIPE_VOLUME" '{component:"live_workload_recreate", app:$app, wipeVolume:($wipe=="true"), cdrRequired:true, terminalDataStored:false, privateBindOnly:true, checkedAt:$checkedAt}' | sudo tee /opt/sylion-workloads/recreate-evidence.json >/dev/null
cat /opt/sylion-workloads/recreate-evidence.json
`;
}

async function runSignalHandoffIfNeeded(app) {
  if (!(app === "signal" || app === "all")) return null;
  const result = await run("node", ["scripts/sync-signal-auth-handoff.mjs", "--apply"], { timeout: 120_000 });
  return JSON.parse(result.stdout);
}

async function smoke(app) {
  const keys = selectedApps(app);
  const script = `
set -euo pipefail
for h in ${keys.map(shellSingle).join(" ")}; do
  host="$h.sylion.internal"
  if [ "$h" = "duckduckgo" ]; then host="duckduckgo.sylion.internal"; fi
  if [ "$h" = "libreoffice" ]; then host="libreoffice.sylion.internal"; fi
  code=$(curl -k -sS -o /tmp/sylion-recreate-$h -w "%{http_code}" --resolve "$host:443:10.42.0.12" --max-time 12 "https://$host/" || true)
  echo "$h=$code"
done
`;
  const { stdout } = await ssh(g2Host, script, { timeout: 60_000 });
  return Object.fromEntries(stdout.split(/\r?\n/).filter(Boolean).map((line) => line.split("=")));
}

async function main() {
  const args = parseArgs();
  if (args.printPlan) {
    console.log(JSON.stringify(plan(args), null, 2));
    return;
  }
  if (!args.apply) {
    console.error("Usage: node scripts/live-workload-recreate.mjs --print-plan --app=signal|all OR --apply --app=signal|all [--wipe-volume]");
    process.exitCode = 2;
    return;
  }
  const evidence = await ssh(workloadHost, remoteRecreateScript(args), { timeout: 180_000 });
  const handoff = await runSignalHandoffIfNeeded(args.app);
  const smokeResult = await smoke(args.app);
  const evidenceJson = evidence.stdout.slice(evidence.stdout.indexOf("{"), evidence.stdout.lastIndexOf("}") + 1);
  console.log(JSON.stringify({
    applied: true,
    secretPrinted: false,
    workloadEvidence: JSON.parse(evidenceJson),
    signalHandoff: handoff,
    smoke: smokeResult,
    productionExecutionAllowed: false
  }, null, 2));
}

await main();
