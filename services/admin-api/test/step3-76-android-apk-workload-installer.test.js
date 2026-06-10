import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/install-android-apk-workload.mjs", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("Step 3.76 Android APK installer requires approved file, checksum and apply gates", () => {
  assert.match(source, /approved_apk_file_missing/);
  assert.match(source, /approved_apk_sha256_missing/);
  assert.match(source, /approved_apk_sha256_mismatch/);
  assert.match(source, /SYLION_ANDROID_APK_INSTALL_ALLOWED === "true"/);
  assert.match(source, /confirmation === "INSTALL_ANDROID_APK"/);
  assert.match(source, /mode: "blocked_before_apply"/);
  assert.match(source, /productionExecutionAllowed: false/);
});

test("Step 3.76 Android APK installer uses Waydroid app install without storing terminal data", () => {
  assert.match(source, /waydroid app install/);
  assert.match(source, /waydroid app list/);
  assert.match(source, /terminalDataStored: false/);
  assert.match(source, /cdrRequired: true/);
  assert.match(source, /--package must be an Android package identifier/);
  assert.equal(
    pkg.scripts["live:android-apk-install"],
    "node scripts/install-android-apk-workload.mjs"
  );
});
