import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function planFor(appKey) {
  const { stdout } = await execFileAsync("node", ["scripts/launch-native-firecracker-gui-workload.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SYLION_GUI_APP: appKey,
      SYLION_GUI_RUN_ID: `test-${appKey}`
    },
    timeout: 15_000,
    windowsHide: true
  });
  return JSON.parse(stdout);
}

test("Step 3.61 AX102 Firecracker GUI runner exposes separate app profiles without applying changes", async () => {
  const duck = await planFor("duckduckgo_browser");
  assert.equal(duck.action, "plan_only");
  assert.equal(duck.appKey, "duckduckgo");
  assert.equal(duck.hostEndpoint, "10.44.0.13:3001");
  assert.equal(duck.serverName, "duckduckgo.sylion.internal");
  assert.deepEqual(duck.display, {
    width: 960,
    height: 1800,
    windowWidth: 960,
    windowHeight: 1680
  });
  assert.equal(duck.productionExecutionAllowed, false);

  const libreOffice = await planFor("libreoffice");
  assert.equal(libreOffice.action, "plan_only");
  assert.equal(libreOffice.appKey, "libreoffice");
  assert.equal(libreOffice.hostEndpoint, "10.44.0.13:3002");
  assert.equal(libreOffice.serverName, "libreoffice.sylion.internal");

  const whatsapp = await planFor("whatsapp");
  assert.equal(whatsapp.hostEndpoint, "10.44.0.13:3010");
  assert.equal(whatsapp.serverName, "whatsapp.sylion.internal");

  const signal = await planFor("signal");
  assert.equal(signal.hostEndpoint, "10.44.0.13:3013");
  assert.equal(signal.serverName, "signal.sylion.internal");

  const exodus = await planFor("exodus");
  assert.equal(exodus.hostEndpoint, "10.44.0.13:3015");
  assert.equal(exodus.serverName, "exodus.sylion.internal");
  assert.equal(exodus.display.width, 1440);
  assert.equal(exodus.display.height, 2400);
});

test("Step 3.61 GUI microVM runner requires entropy, VNC banner and visible windows before readiness", async () => {
  const source = await readFile("scripts/launch-native-firecracker-gui-workload.mjs", "utf8");

  assert.match(source, /haveged -F -w 1024/);
  assert.match(source, /sylion-visible-window=true/);
  assert.match(source, /x11vnc .* -noxdamage -noxfixes -noxrecord -wait 20 -defer 20 -loop/);
  assert.match(source, /vncBannerReady:\$vncBannerReady/);
  assert.match(source, /ready:\(\$hostCode=="200" and \$novncMarker==true and \$appRunning==true and \$appCrashed==false and \$visibleWindow==true and \$vncBannerReady==true/);
  assert.match(source, /vcpu_count": \$\{profile\.vcpuCount \|\| 2\}/);
  assert.match(source, /mem_size_mib": \$\{profile\.memSizeMib \|\| 4096\}/);
  assert.match(source, /defaultExodusDebSha256/);
  assert.match(source, /exodus_sha256_required_for_wallet_artifact/);
  assert.match(source, /sha256sum -c/);
  assert.match(source, /exodus_official_download_blocked_or_unavailable/);
  assert.match(source, /ELECTRON_DISABLE_GPU=1/);
  assert.match(source, /MESA_LOADER_DRIVER_OVERRIDE=llvmpipe/);
  assert.match(source, /--enable-unsafe-swiftshader/);
  assert.match(source, /--use-gl=swiftshader/);
  assert.match(source, /--disable-features=UseOzonePlatform,VizDisplayCompositor/);
  assert.match(source, /blockers:\$blockers/);
});
