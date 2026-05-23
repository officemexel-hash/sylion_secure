import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { forwardPlan } from "./install-workload-guacamole-vnc-forwards.mjs";

const execFileAsync = promisify(execFile);

const defaultSshKey = process.platform === "win32"
  ? ".deploy\\sylion_hetzner_admin_ed25519"
  : ".deploy/sylion_hetzner_admin_ed25519";

function configuredMaxConnectionsPerUser() {
  const value = Number(process.env.SYLION_GUACAMOLE_MAX_CONNECTIONS_PER_USER || "10");
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    return 10;
  }
  return value;
}

const connectionPlan = {
  step: "3.80",
  component: "g2_guacamole_workload_connection_seed",
  g2: {
    host: process.env.SYLION_G2_SSH || "sylion@178.105.203.31",
    dockerBridgeAddress: process.env.SYLION_G2_DOCKER_BRIDGE_IP || "172.18.0.1",
    baseDir: "/opt/sylion-guacamole",
    envPath: "/etc/sylion/guacamole.env",
    adminSecretPath: "/etc/sylion/guacamole-admin.env"
  },
  workload: {
    privateAddress: process.env.SYLION_WORKLOAD_NATIVE_PRIVATE_IP || "10.44.0.13"
  },
  limits: {
    maxConnectionsPerUser: configuredMaxConnectionsPerUser()
  },
  connections: forwardPlan.forwards
    .map((forward) => ({
      key: forward.key,
      name: forward.label,
      mode: forward.mode,
      protocol: "vnc",
      hostname: process.env.SYLION_G2_DOCKER_BRIDGE_IP || "172.18.0.1",
      port: forward.bindPort + 10000,
      maxConnectionsPerUser: configuredMaxConnectionsPerUser(),
      proxyTarget: {
        hostname: process.env.SYLION_WORKLOAD_NATIVE_PRIVATE_IP || "10.44.0.13",
        port: forward.bindPort
      },
      required: forward.required
    })),
  blockedConnections: [],
  invariants: {
    privateAddressOnly: true,
    publicInternetExposure: false,
    terminalDataStored: false,
    clipboardDisabledByDefault: true,
    fileTransferDisabledUntilCdrGate: true,
    defaultAdminPasswordRotated: true,
    guacdUsesG2DockerBridgeProxy: true,
    secretsPrinted: false
  }
};

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function publicPlan(input = connectionPlan) {
  return {
    ...input,
    g2: {
      ...input.g2,
      adminSecretPath: input.g2.adminSecretPath,
      adminPasswordPrinted: false
    }
  };
}

function renderConnectionSql(input = connectionPlan) {
  const connectionRows = input.connections
    .map((connection) => `  (${sqlString(connection.name)}, ${sqlString(connection.protocol)}, ${Number(connection.maxConnectionsPerUser)})`)
    .join(",\n");
  const parameterRows = input.connections
    .flatMap((connection) => [
      [connection.name, "hostname", connection.hostname],
      [connection.name, "port", String(connection.port)],
      [connection.name, "disable-copy", "true"],
      [connection.name, "disable-paste", "true"],
      [connection.name, "enable-sftp", "false"],
      [connection.name, "autoretry", "3"],
      [connection.name, "resize-method", "display-update"]
    ])
    .map(([connectionName, parameterName, parameterValue]) => `  ((SELECT connection_id FROM guacamole_connection WHERE connection_name = ${sqlString(connectionName)}), ${sqlString(parameterName)}, ${sqlString(parameterValue)})`)
    .join(",\n");

  return `
BEGIN;

DELETE FROM guacamole_connection_permission
WHERE connection_id IN (
  SELECT connection_id FROM guacamole_connection WHERE connection_name LIKE 'SYLION %'
);

DELETE FROM guacamole_connection_parameter
WHERE connection_id IN (
  SELECT connection_id FROM guacamole_connection WHERE connection_name LIKE 'SYLION %'
);

DELETE FROM guacamole_connection
WHERE connection_name LIKE 'SYLION %';

INSERT INTO guacamole_connection (connection_name, protocol, max_connections_per_user)
VALUES
${connectionRows};

INSERT INTO guacamole_connection_parameter (connection_id, parameter_name, parameter_value)
VALUES
${parameterRows};

INSERT INTO guacamole_connection_permission (entity_id, connection_id, permission)
SELECT e.entity_id, c.connection_id, 'READ'
FROM guacamole_entity e
JOIN guacamole_connection c ON c.connection_name LIKE 'SYLION %'
WHERE e.name = 'guacadmin' AND e.type = 'USER'
ON CONFLICT DO NOTHING;

COMMIT;
`.trim();
}

function renderRemoteScript(input = connectionPlan) {
  const sqlB64 = Buffer.from(renderConnectionSql(input), "utf8").toString("base64");
  const proxies = input.connections.map((connection) => ({
    key: connection.key,
    listenHost: input.g2.dockerBridgeAddress,
    listenPort: connection.port,
    targetHost: connection.proxyTarget.hostname,
    targetPort: connection.proxyTarget.port
  }));
  const proxiesB64 = Buffer.from(JSON.stringify(proxies), "utf8").toString("base64");
  return `
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update >/dev/null
sudo apt-get install -y --no-install-recommends openssl coreutils socat jq >/dev/null
cd ${shellQuote(input.g2.baseDir)}
if sudo docker compose version >/dev/null 2>&1; then
  compose_cmd="sudo docker compose"
else
  compose_cmd="sudo docker-compose"
fi

sudo install -d -o root -g root -m 0700 /etc/sylion
if ! sudo test -f ${shellQuote(input.g2.adminSecretPath)}; then
  admin_password="$(openssl rand -hex 24)"
  umask 077
  printf 'GUACAMOLE_ADMIN_USER=guacadmin\\nGUACAMOLE_ADMIN_PASSWORD=%s\\n' "$admin_password" | sudo tee ${shellQuote(input.g2.adminSecretPath)} >/dev/null
  sudo chmod 0600 ${shellQuote(input.g2.adminSecretPath)}
fi

proxies_json="$(mktemp)"
printf %s ${shellQuote(proxiesB64)} | base64 -d > "$proxies_json"
jq -c '.[]' "$proxies_json" | while IFS= read -r proxy; do
  key="$(printf %s "$proxy" | jq -r '.key')"
  listen_host="$(printf %s "$proxy" | jq -r '.listenHost')"
  listen_port="$(printf %s "$proxy" | jq -r '.listenPort')"
  target_host="$(printf %s "$proxy" | jq -r '.targetHost')"
  target_port="$(printf %s "$proxy" | jq -r '.targetPort')"
  pid_file="/run/sylion-guacamole-egress-$key.pid"
  log_file="/var/log/sylion-guacamole-egress-$key.log"
  if [ -s "$pid_file" ]; then
    old_pid="$(cat "$pid_file" || true)"
    if [ -n "$old_pid" ]; then sudo kill "$old_pid" 2>/dev/null || true; fi
    sudo rm -f "$pid_file"
  fi
  sudo pkill -f "socat.*TCP-LISTEN:$listen_port,bind=$listen_host" 2>/dev/null || true
  sudo bash -c 'nohup socat "$1" "$2" > "$3" 2>&1 & echo $! > "$4"' _ \
    "TCP-LISTEN:$listen_port,bind=$listen_host,fork,reuseaddr" \
    "TCP:$target_host:$target_port" \
    "$log_file" \
    "$pid_file"
done

admin_password="$(sudo awk -F= '/^GUACAMOLE_ADMIN_PASSWORD=/{print substr($0, index($0,$2))}' ${shellQuote(input.g2.adminSecretPath)})"
salt_hex="$(openssl rand -hex 32)"
salt_upper="$(printf %s "$salt_hex" | tr '[:lower:]' '[:upper:]')"
hash_hex="$(printf '%s%s' "$admin_password" "$salt_upper" | sha256sum | awk '{print $1}')"

sql_path="$(mktemp)"
printf %s ${shellQuote(sqlB64)} | base64 -d > "$sql_path"
$compose_cmd --env-file ${shellQuote(input.g2.envPath)} exec -T postgres psql -v ON_ERROR_STOP=1 -U guacamole_user -d guacamole_db < "$sql_path" >/dev/null

$compose_cmd --env-file ${shellQuote(input.g2.envPath)} exec -T postgres psql -v ON_ERROR_STOP=1 -U guacamole_user -d guacamole_db <<SQL >/dev/null
UPDATE guacamole_user
SET password_hash = decode('$hash_hex', 'hex'),
    password_salt = decode('$salt_hex', 'hex'),
    password_date = CURRENT_TIMESTAMP,
    disabled = false,
    expired = false
WHERE entity_id = (
  SELECT entity_id FROM guacamole_entity
  WHERE name = 'guacadmin' AND type = 'USER'
);
SQL

connection_count="$($compose_cmd --env-file ${shellQuote(input.g2.envPath)} exec -T postgres psql -tA -U guacamole_user -d guacamole_db -c "SELECT count(*) FROM guacamole_connection WHERE connection_name LIKE 'SYLION %';" | tr -d '[:space:]')"
parameter_count="$($compose_cmd --env-file ${shellQuote(input.g2.envPath)} exec -T postgres psql -tA -U guacamole_user -d guacamole_db -c "SELECT count(*) FROM guacamole_connection_parameter WHERE connection_id IN (SELECT connection_id FROM guacamole_connection WHERE connection_name LIKE 'SYLION %');" | tr -d '[:space:]')"
printf '{"component":"g2_guacamole_workload_connection_seed","applied":true,"connectionCount":%s,"parameterCount":%s,"g2DockerBridgeProxy":"%s","adminPasswordPrinted":false,"adminSecretPath":"%s","terminalDataStored":false,"publicInternetExposure":false}\\n' "$connection_count" "$parameter_count" ${shellQuote(input.g2.dockerBridgeAddress)} ${shellQuote(input.g2.adminSecretPath)}
`;
}

export {
  connectionPlan,
  publicPlan,
  renderConnectionSql,
  renderRemoteScript
};

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout ?? 60_000,
    windowsHide: true,
    input: options.input
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function apply(input = connectionPlan) {
  const encoded = Buffer.from(renderRemoteScript(input), "utf8").toString("base64");
  const result = await run("ssh", [
    "-i",
    process.env.SYLION_ADMIN_SSH_KEY || defaultSshKey,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    input.g2.host,
    `printf %s ${shellQuote(encoded)} | base64 -d | bash`
  ], { timeout: 300_000 });
  if (result.stdout) {
    console.log(result.stdout);
    return;
  }
  console.log(JSON.stringify({
    component: input.component,
    applied: true,
    connectionCount: input.connections.length,
    maxConnectionsPerUser: input.limits.maxConnectionsPerUser,
    remoteStdoutEmpty: true,
    secretsPrinted: false
  }));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--print-plan")) {
    console.log(JSON.stringify(publicPlan(), null, 2));
    return;
  }
  if (args.has("--render-sql")) {
    console.log(renderConnectionSql());
    return;
  }
  if (args.has("--render-remote-script")) {
    console.log(renderRemoteScript());
    return;
  }
  if (args.has("--apply")) {
    await apply();
    return;
  }
  console.error("Usage: node scripts/seed-g2-guacamole-workload-connections.mjs --print-plan|--render-sql|--render-remote-script|--apply");
  process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
