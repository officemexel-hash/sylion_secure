import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/launch-android-native-workload.mjs", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("Step 3.77 Android native launcher is apply-gated and production-blocked", () => {
  assert.match(source, /SYLION_ANDROID_UI_LAUNCH_ALLOWED === "true"/);
  assert.match(source, /confirmation === "LAUNCH_ANDROID_UI"/);
  assert.match(source, /mode: "blocked_before_apply"/);
  assert.match(source, /productionExecutionAllowed: false/);
  assert.match(source, /terminalDataStored: false/);
  assert.match(source, /cdrRequired: true/);
});

test("Step 3.77 Android native launcher enforces private TLS stream and public-interface drop", () => {
  assert.match(source, /novnc_over_g2_private_websockify_vnc_vencrypt_adapter/);
  assert.match(source, /const workloadBind = arg\("workload-bind"/);
  assert.match(source, /const webPort = Number\(arg\("web-port", "3014"\)\)/);
  assert.match(source, /const localVncProxyPort = Number\(arg\("local-vnc-proxy-port", "5916"\)\)/);
  assert.match(source, /websockify_not_installed/);
  assert.match(source, /novnc_web_assets_missing/);
  assert.match(source, /python3_not_installed/);
  assert.match(source, /dbus_run_session_not_installed/);
  assert.match(source, /nft add rule inet filter input iifname "eno1" tcp dport/);
  assert.match(source, /--vnc-tls-cert=\/etc\/sylion\/waydroid-vnc\/tls\.crt/);
  assert.doesNotMatch(source, /--ssl-target/);
  assert.match(source, /sylion-vencrypt-plain-proxy\.py/);
  assert.match(source, /X509_PLAIN = 262/);
  assert.match(
    source,
    /pam_exec\.so expose_authtok quiet \/usr\/local\/lib\/sylion-weston-vnc-pam-auth\.py/
  );
  assert.match(source, /plain-auth\.env/);
  assert.match(source, /pam_auth_configured/);
  assert.match(source, /authenticate_plain\(tls, auth_file\)/);
  assert.match(source, /vnc_proxy_handshake/);
  assert.match(source, /missing_server_init/);
  assert.match(source, /websockify --web=\/usr\/share\/novnc/);
  assert.match(source, /noVncWebPort: webPort/);
  assert.match(source, /vnc_proxy_listener/);
  assert.match(source, /web_listener/);
  assert.match(source, /sylion-\$\{app\}-weston-vnc\.service/);
  assert.match(source, /sylion-\$\{app\}-vnc-proxy\.service/);
  assert.match(source, /sylion-\$\{app\}-websockify\.service/);
  assert.match(source, /sylion-\$\{app\}-android-session\.service/);
  assert.match(source, /Restart=always/);
  assert.match(
    source,
    /dbus-run-session -- \/usr\/local\/sbin\/sylion-\$\{app\}-android-session-keepalive\.sh/
  );
  assert.match(source, /waydroid_session_service/);
  assert.match(source, /android-session-keepalive/);
  assert.match(source, /waydroid app launch/);
  assert.match(source, /android_full_ui_no_app_installed/);
  assert.equal(
    pkg.scripts["live:android-native-launch"],
    "node scripts/launch-android-native-workload.mjs"
  );
});
