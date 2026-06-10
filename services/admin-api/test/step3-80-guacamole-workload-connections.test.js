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

test("Step 3.80 workload Guacamole VNC forward plan is private, encrypted and app-scoped", () => {
  const plan = publicForwardPlan();
  const keys = plan.forwards.map((forward) => forward.key);

  assert.equal(plan.workload.privateAddress, "10.44.0.13");
  assert.equal(plan.invariants.privateBindOnly, true);
  assert.equal(plan.invariants.publicInternetExposure, false);
  assert.equal(plan.invariants.terminalDataStored, false);
  assert.equal(plan.invariants.guacamoleUsesRawVnc, false);
  assert.equal(plan.invariants.guacamoleUsesEncryptedVncEgress, true);
  assert.equal(plan.invariants.g2ToWorkloadTransport, "tls_stunnel_private_bind");
  assert.deepEqual(keys, [
    "duckduckgo_browser",
    "libreoffice",
    "whatsapp",
    "protonmail",
    "simplex",
    "telegram",
    "threema",
    "signal",
    "zangi",
    "exodus"
  ]);
  assert.equal(plan.forwards.find((forward) => forward.key === "signal").bindPort, 5913);
  assert.equal(plan.forwards.find((forward) => forward.key === "zangi").mode, "android_native_lab");
  assert.equal(plan.forwards.find((forward) => forward.key === "exodus").required, false);
  assert.equal(
    plan.forwards.find((forward) => forward.key === "exodus").blockerIfMissing,
    "exodus_firecracker_vnc_target_not_live"
  );
  assert.equal(plan.forwards.find((forward) => forward.key === "protonmail").bindPort, 5917);
  assert.equal(plan.forwards.find((forward) => forward.key === "simplex").bindPort, 5918);
  assert.equal(
    plan.forwards.find((forward) => forward.key === "simplex").blockerIfMissing,
    "simplex_desktop_or_android_image_required"
  );
  assert.ok(plan.forwards.every((forward) => forward.bindAddress === "10.44.0.13"));
  assert.ok(plan.forwards.every((forward) => forward.tlsBindPort === forward.bindPort + 20000));
  assert.ok(plan.forwards.every((forward) => forward.rawVncExposedToPublicInternet === false));
});

test("Step 3.80 workload forward installer records TLS egress evidence and verifies RFB from G2", () => {
  const remoteScript = renderForwardRemoteScript();
  const verificationScript = renderG2VerificationScript();

  assert.match(remoteScript, /apt-get install -y --no-install-recommends jq openssl stunnel4/);
  assert.match(remoteScript, /workload-stunnel\.crt/);
  assert.match(remoteScript, /accept = \$bind_address:\$tls_bind_port/);
  assert.match(remoteScript, /connect = \$target_host:\$target_port/);
  assert.match(remoteScript, /\/opt\/sylion-workloads\/evidence\/guacamole-vnc-forwards\.json/);
  assert.match(remoteScript, /publicInternetExposure: false/);
  assert.match(remoteScript, /guacamoleUsesEncryptedVncEgress: true/);
  assert.match(remoteScript, /g2ToWorkloadTransport: "tls_stunnel_private_bind"/);
  assert.match(remoteScript, /productionExecutionAllowed: false/);
  assert.match(remoteScript, /blockerIfMissing/);
  assert.doesNotMatch(remoteScript, /0\.0\.0\.0/);

  assert.match(verificationScript, /g2_to_workload_tls_vnc_verification/);
  assert.match(verificationScript, /openssl s_client -connect \$target_host:\$tls_bind_port/);
  assert.match(verificationScript, /\^RFB/);
  assert.match(verificationScript, /terminalDataStored: false/);
});

test("Step 3.80 Guacamole connection seed uses local stunnel ports and rotates default admin secret", () => {
  const plan = publicConnectionPlan();
  const sql = renderConnectionSql();
  const remoteScript = renderConnectionRemoteScript();

  assert.equal(plan.invariants.privateAddressOnly, true);
  assert.equal(plan.invariants.clipboardDisabledByDefault, true);
  assert.equal(plan.invariants.fileTransferDisabledUntilCdrGate, true);
  assert.equal(plan.invariants.defaultAdminPasswordRotated, true);
  assert.equal(plan.invariants.guacdUsesG2DockerBridgeProxy, true);
  assert.equal(plan.invariants.g2ToWorkloadTransport, "tls_stunnel_private_bind");
  assert.equal(plan.invariants.rawVncAcrossServerLinkForbidden, true);
  assert.equal(plan.limits.maxConnectionsPerUser, 10);
  assert.equal(plan.g2.adminPasswordPrinted, false);
  assert.equal(plan.g2.dockerBridgeAddress, "172.18.0.1");
  assert.equal(plan.connections.length, 10);
  assert.deepEqual(plan.blockedConnections, []);

  assert.match(
    sql,
    /INSERT INTO guacamole_connection \(connection_name, protocol, max_connections_per_user\)/
  );
  assert.match(sql, /'SYLION Signal', 'vnc', 10/);
  assert.match(sql, /'SYLION Zangi Android Native', 'vnc', 10/);
  assert.match(sql, /'SYLION Exodus', 'vnc', 10/);
  assert.match(sql, /'SYLION Proton Mail', 'vnc', 10/);
  assert.match(sql, /'SYLION SimpleX Chat', 'vnc', 10/);
  assert.match(sql, /'hostname', '172\.18\.0\.1'/);
  assert.match(sql, /'port', '15913'/);
  assert.match(sql, /'port', '15916'/);
  assert.match(sql, /'port', '15915'/);
  assert.match(sql, /'port', '15917'/);
  assert.match(sql, /'port', '15918'/);
  assert.match(sql, /'disable-copy', 'true'/);
  assert.match(sql, /'disable-paste', 'true'/);
  assert.match(sql, /'enable-sftp', 'false'/);
  assert.doesNotMatch(sql, /0\.0\.0\.0/);
  assert.match(remoteScript, /openssl rand -hex 24/);
  assert.match(
    remoteScript,
    /apt-get install -y --no-install-recommends openssl coreutils stunnel4 jq/
  );
  assert.match(remoteScript, /client = yes/);
  assert.match(remoteScript, /accept = \$listen_host:\$listen_port/);
  assert.match(remoteScript, /connect = \$target_host:\$target_port/);
  assert.match(remoteScript, /g2DockerBridgeProxy/);
  assert.match(remoteScript, /rawVncAcrossServerLinkForbidden":true/);
  assert.match(remoteScript, /password_hash = decode\('\$hash_hex', 'hex'\)/);
  assert.match(remoteScript, /adminPasswordPrinted":false/);
  assert.doesNotMatch(remoteScript, /GUACAMOLE_ADMIN_PASSWORD=guacadmin/);
});
