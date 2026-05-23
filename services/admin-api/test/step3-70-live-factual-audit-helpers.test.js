import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { promisify } from "node:util";
import { pixelVisualVerdictFromStats, selectApps } from "../../../scripts/live-factual-workload-audit.mjs";

const execFileAsync = promisify(execFile);

test("Step 3.70 Pixel visual evidence accepts rendered noVNC canvas", () => {
  const verdict = pixelVisualVerdictFromStats({
    meanLuma: 214.04,
    lumaStdDev: 72.97,
    colorBuckets: 394,
    darkRatio: 0.0032,
    whiteRatio: 0.781
  });
  assert.equal(verdict.rendered, true);
  assert.equal(verdict.blocker, null);
});

test("Step 3.70 Pixel visual evidence rejects noVNC loading screen", () => {
  const verdict = pixelVisualVerdictFromStats({
    meanLuma: 21.4,
    lumaStdDev: 12.13,
    colorBuckets: 36,
    darkRatio: 0.978,
    whiteRatio: 0.0013
  });
  assert.equal(verdict.rendered, false);
  assert.equal(verdict.loadingLike, true);
  assert.equal(verdict.blocker, "pixel_stream_loading_or_disconnected");
});

test("Step 3.70 Pixel visual evidence rejects noVNC connection failure banner", () => {
  const verdict = pixelVisualVerdictFromStats({
    meanLuma: 60.57,
    lumaStdDev: 33.43,
    colorBuckets: 91,
    darkRatio: 0.0245,
    whiteRatio: 0.0042,
    redAlertRatio: 0.041
  });
  assert.equal(verdict.rendered, false);
  assert.equal(verdict.websockifyFailureLike, true);
  assert.equal(verdict.blocker, "pixel_stream_websockify_connection_failed");
});


test("Step 3.70 Pixel visual evidence rejects blank gateway error page", () => {
  const verdict = pixelVisualVerdictFromStats({
    meanLuma: 254.61,
    lumaStdDev: 9.24,
    colorBuckets: 16,
    darkRatio: 0.0011,
    whiteRatio: 0.9979
  });
  assert.equal(verdict.rendered, false);
  assert.equal(verdict.blankLike, true);
  assert.equal(verdict.blocker, "pixel_stream_blank_or_gateway_error");
});

test("Step 3.70 live factual audit can select a small app subset", () => {
  const selected = selectApps([
    { key: "duckduckgo" },
    { key: "signal" },
    { key: "libreoffice" }
  ], "duckduckgo_browser,signal,signal");
  assert.deepEqual(selected.map((app) => app.key), ["duckduckgo", "signal"]);
});

test("Step 3.70 live factual audit lists selected apps without remote side effects", async () => {
  const { stdout } = await execFileAsync("node", [
    "scripts/live-factual-workload-audit.mjs",
    "--list-apps",
    "--apps=signal,duckduckgo_browser"
  ], {
    cwd: process.cwd(),
    timeout: 15_000,
    windowsHide: true
  });
  const payload = JSON.parse(stdout);
  assert.deepEqual(payload.selectedApps, ["signal", "duckduckgo"]);
  assert.ok(payload.supportedApps.includes("whatsapp"));
});

test("Step 3.70 live factual audit treats Zangi Android stream as noVNC but keeps workflow gated", () => {
  const source = readFileSync("scripts/live-factual-workload-audit.mjs", "utf8");
  assert.match(source, /key: "zangi"[\s\S]+expectedRuntime: "android_native_required"[\s\S]+androidPackage: "com\.beint\.zangi"[\s\S]+noVnc: true/);
  assert.match(source, /android_native_websockify_noVNC/);
  assert.match(source, /androidPackageInstalled/);
  assert.match(source, /waydroid shell pidof "\$android_package"/);
  assert.match(source, /workloadAppUiVisible/);
  assert.match(source, /android_app_package_not_installed/);
  assert.match(source, /functional_workflow_not_verified/);
});

test("Step 3.70 workload evidence parsing does not require jq on AX102", () => {
  const source = readFileSync("scripts/live-factual-workload-audit.mjs", "utf8");
  assert.match(source, /json_field\(\) \{/);
  assert.match(source, /python3 - "\$file" "\$field" "\$default"/);
  assert.match(source, /guest_ip="\$\(json_field "\$evidence" guestIp ""\)"/);
  assert.match(source, /app_crashed="\$\(json_field "\$evidence" appCrashed true\)"/);
  assert.doesNotMatch(source, /jq -r '\.appCrashed/);
});

test("Step 3.70 live factual audit does not promote rendered noVNC pixels into app UI markers", () => {
  const source = readFileSync("scripts/live-factual-workload-audit.mjs", "utf8");
  assert.match(source, /factualStateVerified: appUiMarkerVisible/);
  assert.match(source, /passMarkerFound: verdict\.passMarkerFound/);
  assert.doesNotMatch(source, /passMarkerFound: verdict\.passMarkerFound \|\| visualEvidence\.rendered/);
  assert.match(source, /pixelStreamRendered && \(appUiMarkerVisible \|\| workloadAppUiVisible\)/);
});
