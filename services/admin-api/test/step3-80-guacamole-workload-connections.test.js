import assert from "node:assert/strict";
import test from "node:test";
import {
  publicPlan as publicForwardPlan,
  renderG2VerificationScript,
  renderRemoteScript as renderForwardRemoteScript
} from "../../../scripts/install-workload-guacamole-vnc-forwards.mjs";
import {
  publicPlan as publicConnectionPlan,
  renderConnectionSql,
  renderRemoteScript as renderConnectionRemoteScript
} from "../../../scripts/seed-g2-guacamole-workload-connections.mjs";

test("Step 3.80 workload raw VNC forward plan is private and app-scoped", () => {
  const plan = publicForwardPlan();
  const keys = plan.forwards.map((forward) => forward.key);

  assert.equal(plan.workload.privateAddress, "10.44.0.13");
  assert.equal(plan.invariants.privateBindOnly, true);
  assert.equal(plan.invariants.publicInternetExposure, false);
  assert.equal(plan.invariants.terminalDataStored, false);
  assert.equal(plan.invariants.guacamoleUsesRawVnc, true);
  assert.deepEqual(
    keys,
    ["duckduckgo_browser", "libreoffice", "whatsapp", "telegram", "threema", "signal", "zangi", "exodus"]
  );
  assert.equal(plan.forwards.find((forward) => forward.key === "signal").bindPort, 5913);
  assert.equal(plan.forwards.find((forward) => forward.key === "zangi").mode, "android_native_lab");
  assert.equal(plan.forwards.find((forward) => forward.key === "exodus").required, false);
  assert.equal(plan.forwards.find((forward) => forward.key === "exodus").blockerIfMissing, "exodus_firecracker_vnc_target_not_live");
  assert.ok(plan.forwards.every((forward) => forward.bindAddress === "10.44.0.13"));
  assert.ok(plan.forwards.every((forward) => forward.rawVncExposedToPublicInternet === false));
});

test("Step 3.80 workload forward installer records evidence and verifies RFB from G2", () => {
  const remoteScript = renderForwardRemoteScript();
  const verificationScript = renderG2VerificationScript();

  assert.match(remoteScript, /apt-get install -y --no-install-recommends socat jq/);
  assert.match(remoteScript, /TCP-LISTEN:\$\{bind_port\},bind=\$\{bind_address\}/);
  assert.match(remoteScript, /\/opt\/sylion-workloads\/evidence\/guacamole-vnc-forwards\.json/);
  assert.match(remoteScript, /publicInternetExposure: false/);
  assert.match(remoteScript, /productionExecutionAllowed: false/);
  assert.match(remoteScript, /blockerIfMissing/);
  assert.doesNotMatch(remoteScript, /0\.0\.0\.0/);

  assert.match(verificationScript, /g2_to_workload_raw_vnc_verification/);
  assert.match(verificationScript, /\/dev\/tcp\/\$target_host\/\$bind_port/);
  assert.match(verificationScript, /\^RFB/);
  assert.match(verificationScript, /terminalDataStored: false/);
});

test("Step 3.80 Guacamole connection seed uses raw VNC ports and rotates default admin secret", () => {
  const plan = publicConnectionPlan();
  const sql = renderConnectionSql();
  const remoteScript = renderConnectionRemoteScript();

  assert.equal(plan.invariants.privateAddressOnly, true);
  assert.equal(plan.invariants.clipboardDisabledByDefault, true);
  assert.equal(plan.invariants.fileTransferDisabledUntilCdrGate, true);
  assert.equal(plan.invariants.defaultAdminPasswordRotated, true);
  assert.equal(plan.invariants.guacdUsesG2DockerBridgeProxy, true);
  assert.equal(plan.limits.maxConnectionsPerUser, 10);
  assert.equal(plan.g2.adminPasswordPrinted, false);
  assert.equal(plan.g2.dockerBridgeAddress, "172.18.0.1");
  assert.equal(plan.connections.length, 8);
  assert.deepEqual(plan.blockedConnections, []);

  assert.match(sql, /INSERT INTO guacamole_connection \(connection_name, protocol, max_connections_per_user\)/);
  assert.match(sql, /'SYLION Signal', 'vnc', 10/);
  assert.match(sql, /'SYLION Zangi Android Native', 'vnc', 10/);
  assert.match(sql, /'SYLION Exodus', 'vnc', 10/);
  assert.match(sql, /'hostname', '172\.18\.0\.1'/);
  assert.match(sql, /'port', '15913'/);
  assert.match(sql, /'port', '15916'/);
  assert.match(sql, /'port', '15915'/);
  assert.match(sql, /'disable-copy', 'true'/);
  assert.match(sql, /'disable-paste', 'true'/);
  assert.match(sql, /'enable-sftp', 'false'/);
  assert.doesNotMatch(sql, /0\.0\.0\.0/);
  assert.match(remoteScript, /openssl rand -hex 24/);
  assert.match(remoteScript, /sudo bash -c 'nohup socat "\$1" "\$2"/);
  assert.match(remoteScript, /TCP-LISTEN:\$listen_port,bind=\$listen_host,fork,reuseaddr/);
  assert.match(remoteScript, /g2DockerBridgeProxy/);
  assert.match(remoteScript, /password_hash = decode\('\$hash_hex', 'hex'\)/);
  assert.match(remoteScript, /adminPasswordPrinted":false/);
  assert.doesNotMatch(remoteScript, /GUACAMOLE_ADMIN_PASSWORD=guacadmin/);
});
