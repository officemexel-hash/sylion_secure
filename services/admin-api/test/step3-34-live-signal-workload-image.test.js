import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const baselineScript = new URL("../../../scripts/hetzner-live-operator-baseline.mjs", import.meta.url);

test("Step 3.34 live Hetzner workload builds a current SYLION Signal image", async () => {
  const source = await readFile(baselineScript, "utf8");

  assert.match(source, /signal-workload\.Dockerfile/);
  assert.match(source, /https:\/\/updates\.signal\.org\/desktop\/apt/);
  assert.match(source, /apt-get install -y --no-install-recommends signal-desktop/);
  assert.match(source, /sylion\/signal-workload:prod-candidate/);
  assert.doesNotMatch(source, /docker run[\s\S]*sylion-signal-desktop[\s\S]*kasmweb\/signal:1\.18\.0/);
});

test("Step 3.34 live Hetzner workload binds UI services to the private operator network", async () => {
  const source = await readFile(baselineScript, "utf8");
  const startScript = source.slice(source.indexOf("path: /usr/local/sbin/sylion-start-workloads.sh"));

  assert.match(startScript, /private_ip=.*10\\\\\.42/);
  assert.match(startScript, /-p "\$private_ip:3013:6901"/);
  assert.match(startScript, /-p "\$private_ip:3014:3000"/);
  assert.match(startScript, /-p "\$private_ip:3015:3000"/);
  assert.match(startScript, /-p "\$private_ip:3001:3000"/);
  assert.match(startScript, /docker rm -f[\s\S]*sylion-signal-desktop/);
  assert.match(startScript, /sylion-zangi-web/);
  assert.match(startScript, /sylion-exodus/);
  assert.match(startScript, /FIREFOX_CLI='https:\/\/duckduckgo\.com\/'/);
  assert.match(startScript, /CHROME_CLI='--disable-session-crashed-bubble --no-first-run https:\/\/web\.whatsapp\.com\/'/);
  assert.match(startScript, /CHROME_CLI='--disable-session-crashed-bubble --no-first-run https:\/\/web\.telegram\.org\/k\/'/);
  assert.match(startScript, /CHROME_CLI='--disable-session-crashed-bubble --no-first-run https:\/\/web\.threema\.ch\/'/);
  assert.match(startScript, /CHROME_CLI='--disable-session-crashed-bubble --no-first-run https:\/\/zangi\.com\/en-us\/download'/);
  assert.doesNotMatch(startScript, /-p 127\.0\.0\.1:3013:6901/);
});
