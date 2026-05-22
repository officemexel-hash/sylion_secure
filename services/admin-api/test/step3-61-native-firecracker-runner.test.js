import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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
  assert.equal(duck.productionExecutionAllowed, false);

  const libreOffice = await planFor("libreoffice");
  assert.equal(libreOffice.action, "plan_only");
  assert.equal(libreOffice.appKey, "libreoffice");
  assert.equal(libreOffice.hostEndpoint, "10.44.0.13:3002");
  assert.equal(libreOffice.serverName, "libreoffice.sylion.internal");

  const whatsapp = await planFor("whatsapp");
  assert.equal(whatsapp.hostEndpoint, "10.44.0.13:3010");
  assert.equal(whatsapp.serverName, "whatsapp.sylion.internal");
});
