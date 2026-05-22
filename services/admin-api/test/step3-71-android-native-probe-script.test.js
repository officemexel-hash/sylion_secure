import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/android-native-workload-probe.mjs", "utf8");
const binderInstaller = readFileSync("scripts/install-android-binderfs-host-gate.mjs", "utf8");

test("Step 3.71 Android-native probe targets live hosts explicitly and does not hang on remote shell scripts", () => {
  assert.match(source, /function arg\(name, fallback = null\)/);
  assert.match(source, /const host = arg\("host"/);
  assert.match(source, /const user = arg\("user"/);
  assert.match(source, /"ConnectTimeout=10"/);
  assert.match(source, /"ServerAliveInterval=10"/);
  assert.match(source, /"bash -s"/);
  assert.match(source, /input: script/);
});

test("Step 3.71 Android-native probe separates host readiness from approved Zangi provenance", () => {
  assert.match(source, /const binderReady = facts\.binder_device \|\| facts\.binderfs_supported \|\| Number\(facts\.binderfs_mounts \|\| 0\) > 0/);
  assert.match(source, /const hostBlockers = \[/);
  assert.match(source, /const provenanceBlockers = \[/);
  assert.match(source, /hostReady: hostBlockers\.length === 0/);
  assert.match(source, /provenanceReady: provenanceBlockers\.length === 0/);
  assert.match(source, /approved_zangi_apk_ref_missing/);
  assert.match(source, /approved_android_workload_image_missing/);
});

test("Step 3.71 Android binderfs installer is apply-gated and persists host kernel gates", () => {
  assert.match(binderInstaller, /const apply = process\.argv\.includes\("--apply"\)/);
  assert.match(binderInstaller, /status: "plan_only"/);
  assert.match(binderInstaller, /modprobe binder_linux devices=binder,hwbinder,vndbinder/);
  assert.match(binderInstaller, /mount -t binder binder \/dev\/binderfs/);
  assert.match(binderInstaller, /\/etc\/modules-load\.d\/sylion-android-binder\.conf/);
  assert.match(binderInstaller, /\/etc\/modprobe\.d\/sylion-android-binder\.conf/);
  assert.match(binderInstaller, /\/etc\/systemd\/system\/dev-binderfs\.mount/);
  assert.match(binderInstaller, /terminalDataStored: false/);
  assert.match(binderInstaller, /productionExecutionAllowed: false/);
});
