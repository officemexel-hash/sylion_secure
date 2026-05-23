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
  assert.equal(duck.vncBackend, "tigervnc");
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
  assert.equal(exodus.display.width, 960);
  assert.equal(exodus.display.height, 1800);
});

test("Step 3.61 GUI microVM runner requires entropy, VNC banner and visible windows before readiness", async () => {
  const source = await readFile("scripts/launch-native-firecracker-gui-workload.mjs", "utf8");

  assert.match(source, /haveged -F -w 1024/);
  assert.match(source, /sylion-visible-window=true/);
  assert.match(source, /Xtigervnc .* -AcceptKeyEvents -AcceptPointerEvents -RawKeyboard/);
  assert.match(source, /SYLION_GUI_VNC_BACKEND/);
  assert.match(source, /SYLION_GUI_VNC_DEBUG/);
  assert.match(source, /SYLION_GUI_SELF_TEST_TEXT/);
  assert.match(source, /Unsupported GUI VNC backend/);
  assert.doesNotMatch(source, /MOZ_DISABLE_CONTENT_SANDBOX/);
  assert.doesNotMatch(source, /signal-desktop --no-sandbox/);
  assert.match(source, /signal-desktop-keyring\.gpg/);
  assert.match(source, /kasmvncserver_noble_1\.4\.0_amd64\.deb/);
  assert.match(source, /vncBackend === "kasmvnc" \? 6901 : 5900/);
  assert.match(source, /KASMVNC_HTTP/);
  assert.match(source, /stream-secrets/);
  assert.match(source, /install -m 0600 "\$stream_secret_file" "\$stream_credential_ref"/);
  assert.match(source, /allow_client_to_override_kasm_server_settings: false/);
  assert.match(source, /xhost \+SI:localuser:root/);
  assert.match(source, /Signal\|signal\|LibreOffice\|libreoffice/);
  assert.doesNotMatch(source, /search --name '\\.'/);
  assert.doesNotMatch(source, /xwininfo -root -children/);
  assert.match(source, /stream-credentials\.env/);
  assert.match(source, /streamCredentialRef:\$streamCredentialRef/);
  assert.match(source, /weston --backend=vnc-backend\.so/);
  assert.match(source, /sylion-weston-vnc-plain-proxy\.py/);
  assert.match(source, /sylion-weston-seat-primer\.py/);
  assert.match(source, /seat_primer_connected=true/);
  assert.match(source, /xserver-xorg-video-dummy/);
  assert.match(source, /sylion-xtest-extension=true/);
  assert.match(source, /setxkbmap -model pc105 -layout us/);
  assert.match(source, /xinput test-xi2 --root/);
  assert.match(source, /x11vnc .* -input KMBCF -allinput -input_eagerly -noxwarppointer -xkb -nomodtweak/);
  assert.match(source, /x11vnc .* -noxdamage -noxfixes -noxrecord -wait 20 -defer 20 -loop/);
  assert.match(source, /vncBannerReady:\$vncBannerReady/);
  assert.match(source, /streamReady:\$streamReady/);
  assert.match(source, /streamAuthRequired:\(\$vncBackend=="kasmvnc" and \$hostCode=="401"\)/);
  assert.match(source, /ready:\(\$streamReady==true and \$novncMarker==true and \$appRunning==true and \$appCrashed==false and \$visibleWindow==true and \$vncBannerReady==true/);
  assert.match(source, /vcpu_count": \$\{profile\.vcpuCount \|\| 2\}/);
  assert.match(source, /mem_size_mib": \$\{profile\.memSizeMib \|\| 4096\}/);
  assert.match(source, /defaultExodusDebSha256/);
  assert.match(source, /exodus_sha256_required_for_wallet_artifact/);
  assert.match(source, /sha256sum -c/);
  assert.match(source, /exodus_official_download_blocked_or_unavailable/);
  assert.match(source, /ELECTRON_DISABLE_GPU=1/);
  assert.doesNotMatch(source, /ELECTRON_FORCE_DEVICE_SCALE_FACTOR/);
  assert.doesNotMatch(source, /--force-device-scale-factor/);
  assert.doesNotMatch(source, /ctrl\+minus/);
  assert.match(source, /MESA_LOADER_DRIVER_OVERRIDE=llvmpipe/);
  assert.match(source, /--enable-unsafe-swiftshader/);
  assert.match(source, /--use-gl=swiftshader/);
  assert.match(source, /--disable-features=UseOzonePlatform,VizDisplayCompositor/);
  assert.match(source, /blockers:\$blockers/);
});
