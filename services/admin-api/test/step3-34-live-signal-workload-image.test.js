import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderWorkloadCloudInit } from "../src/modules/live/liveBaselineArtifacts.js";

const baselineScript = new URL(
  "../../../scripts/hetzner-live-operator-baseline.mjs",
  import.meta.url
);

test("Step 3.34 live Hetzner workload builds a current SYLION Signal image", async () => {
  const source = renderWorkloadCloudInit();
  const baselineSource = await readFile(baselineScript, "utf8");

  assert.match(baselineSource, /buildLiveBaselineUserData/);
  assert.match(source, /signal-workload\.Dockerfile/);
  assert.match(source, /https:\/\/updates\.signal\.org\/desktop\/apt/);
  assert.match(source, /apt-get install -y --no-install-recommends[\s\S]+signal-desktop/);
  assert.match(source, /xfce4-session/);
  assert.match(source, /VNC_RESOLUTION=800x900/);
  assert.match(source, /kasmvnc_defaults\.yaml/);
  assert.match(source, /sylion\/signal-workload:prod-candidate/);
  assert.doesNotMatch(
    source,
    /docker run[\s\S]*sylion-signal-desktop[\s\S]*kasmweb\/signal:1\.18\.0/
  );
  assert.doesNotMatch(source, /sylion-signal-local/);
});

test("Step 3.34 live Hetzner workload binds UI services to the private operator network", async () => {
  const source = renderWorkloadCloudInit();
  const startScript = source.slice(
    source.indexOf("path: /usr/local/sbin/sylion-start-workloads.sh")
  );

  assert.match(startScript, /10\\\.\(42\|44\)\\\./);
  assert.match(startScript, /openssl rand -base64 24/);
  assert.match(startScript, /chown -R 1000:1000 \/target/);
  assert.match(startScript, /--env-file \/etc\/sylion\/workload-secrets\/signal\.env/);
  assert.match(startScript, /-p "\$private_ip:3013:6901"/);
  assert.match(startScript, /-p "\$private_ip:3014:3000"/);
  assert.match(startScript, /-p "\$private_ip:3015:3000"/);
  assert.match(startScript, /-p "\$private_ip:3016:3000"/);
  assert.match(startScript, /-p "\$private_ip:3017:3000"/);
  assert.match(startScript, /-p "\$private_ip:3001:3000"/);
  assert.match(startScript, /docker rm -f[\s\S]*sylion-signal-desktop/);
  assert.match(startScript, /sylion-zangi-web/);
  assert.match(startScript, /sylion-exodus/);
  assert.match(startScript, /sylion-protonmail-web/);
  assert.match(startScript, /sylion-simplex-gate/);
  assert.match(startScript, /FIREFOX_CLI='https:\/\/duckduckgo\.com\/'/);
  assert.match(
    startScript,
    /CHROME_CLI='--disable-session-crashed-bubble --no-first-run https:\/\/web\.whatsapp\.com\/'/
  );
  assert.match(
    startScript,
    /CHROME_CLI='--disable-session-crashed-bubble --no-first-run https:\/\/web\.telegram\.org\/k\/'/
  );
  assert.match(
    startScript,
    /CHROME_CLI='--disable-session-crashed-bubble --no-first-run https:\/\/web\.threema\.ch\/'/
  );
  assert.match(
    startScript,
    /CHROME_CLI='--disable-session-crashed-bubble --no-first-run https:\/\/zangi\.com\/en-us\/download'/
  );
  assert.match(
    startScript,
    /CHROME_CLI='--disable-session-crashed-bubble --no-first-run https:\/\/mail\.proton\.me\/'/
  );
  assert.match(
    startScript,
    /CHROME_CLI='--disable-session-crashed-bubble --no-first-run https:\/\/simplex\.chat\/downloads\/'/
  );
  assert.doesNotMatch(startScript, /-p 127\.0\.0\.1:3013:6901/);
});
