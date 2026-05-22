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
  assert.match(source, /vnc_tls_private_g2_required/);
  assert.match(source, /nft add rule inet filter input iifname "eno1" tcp dport/);
  assert.match(source, /--vnc-tls-cert=\/etc\/sylion\/waydroid-vnc\/tls\.crt/);
  assert.match(source, /--vnc-tls-key=\/etc\/sylion\/waydroid-vnc\/tls\.key/);
  assert.match(source, /waydroid app launch/);
  assert.match(source, /android_full_ui_no_app_installed/);
  assert.equal(pkg.scripts["live:android-native-launch"], "node scripts/launch-android-native-workload.mjs");
});
