import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/install-android-native-runner.mjs", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("Step 3.75 Android native runner installer is gated before host mutation", () => {
  assert.match(source, /const apply = process\.argv\.includes\("--apply"\)/);
  assert.match(source, /SYLION_ANDROID_RUNNER_INSTALL_ALLOWED === "true"/);
  assert.match(source, /confirmation === "INSTALL_ANDROID_NATIVE_RUNNER"/);
  assert.match(source, /mode: "blocked_before_apply"/);
  assert.match(source, /productionExecutionAllowed: false/);
});

test("Step 3.75 Android native runner installer follows official Waydroid flow and separates APK provenance", () => {
  assert.match(source, /https:\/\/repo\.waydro\.id/);
  assert.match(source, /apt-get install -y waydroid/);
  assert.match(source, /waydroid init -s VANILLA/);
  assert.match(source, /systemctl enable --now waydroid-container/);
  assert.match(source, /leave app APK install and account bootstrap to separate approved artifact gate/);
  assert.equal(pkg.scripts["live:android-native-runner-install"], "node scripts/install-android-native-runner.mjs");
});
