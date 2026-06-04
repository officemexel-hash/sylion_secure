// Per ADR-terminal-modes-001: portal shell tests for /operator/* static serving
// and /operator-api/* scoped endpoint gates. Verifies that:
//   - /operator serves index.html
//   - /operator/styles.css and /operator/app.js serve their content
//   - /operator-api/* sensitive routes require an operator portal session
//   - PHANTOM separation: stub does not leak production exec readiness
//   - admin-web routing remains intact

import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { DEVICE_TYPES } from "../src/domain/constants.js";

async function startTestServer() {
  const app = createApp();
  const server = await app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function getText(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.text()
  };
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: response.status === 200 ? await response.json() : await response.text()
  };
}

test("DEVICE_TYPES includes LAPTOP_TERMINAL per ADR-terminal-modes-001", () => {
  assert.equal(DEVICE_TYPES.LAPTOP_TERMINAL, "laptop_web_terminal");
  assert.equal(DEVICE_TYPES.PIXEL, "pixel_grapheneos");
});

test("V2 operator portal shell is served from Admin API under /operator", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const html = await getText(baseUrl, "/operator");
    assert.equal(html.status, 200);
    assert.match(html.contentType, /text\/html/);
    assert.match(html.body, /SYLION Operator Portal/);
    assert.match(html.body, /Scoped local session required/);
    assert.match(html.body, /data-view="app-switcher"/);
    assert.match(html.body, /\/operator\/stream\.html\?app=signal/);
    assert.match(html.body, /\/operator\/stream\.html\?app=duckduckgo_browser/);
    assert.match(html.body, /\/operator\/stream\.html\?app=libreoffice/);
    assert.match(html.body, /\/operator\/stream\.html\?app=simplex/);
    assert.match(html.body, /\/operator\/stream\.html\?app=protonmail(?:&amp;|&)broker=blind_e2ee/);
    assert.match(html.body, /id="workload-broker-form"[\s\S]*<option value="simplex">SimpleX Chat<\/option>[\s\S]*<option value="protonmail">Proton Mail<\/option>/);
    assert.match(html.body, /id="runtime-gate-form"[\s\S]*<option value="simplex">SimpleX Chat<\/option>[\s\S]*<option value="protonmail">Proton Mail<\/option>/);
    assert.match(html.body, /id="stream-session-form"[\s\S]*<option value="simplex">SimpleX Chat<\/option>[\s\S]*<option value="protonmail">Proton Mail<\/option>/);
    assert.match(html.body, /signal,duckduckgo_browser,libreoffice,simplex,protonmail/);
    assert.match(html.body, /protonmail:10\.42\.0\.13:7917,simplex:10\.42\.0\.13:7918/);
    assert.match(html.body, /Backup & Panic/);
    assert.match(html.body, /Laptop terminal package/);
    assert.match(html.body, /Private input handoff/);
    assert.match(html.body, /id="account-bootstrap-handoff"/);
    assert.match(html.body, /id="workload-recreate-form"/);
    assert.match(html.body, /Delete and recreate selected app/);
    assert.match(html.body, /RUN_LIVE_WORKLOAD_RECREATE/);
    assert.match(html.body, /<script src="\/operator\/app\.js\?v=step3-115"><\/script>/);
  } finally {
    await close();
  }
});

test("Operator portal serves styles.css, app.js and stream.js", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const css = await getText(baseUrl, "/operator/styles.css");
    assert.equal(css.status, 200);
    assert.match(css.contentType, /text\/css/);
    assert.match(css.body, /SYLION Operator Portal/);

    const js = await getText(baseUrl, "/operator/app.js");
    assert.equal(js.status, 200);
    assert.match(js.contentType, /text\/javascript|application\/javascript/);
    assert.match(js.body, /detectTerminalMode/);
    assert.match(js.body, /streaming-profile/);
    assert.match(js.body, /live-workload-status/);
    assert.match(js.body, /laptop-access-package/);
    assert.match(js.body, /renderAccountBootstrapHandoff/);
    assert.match(js.body, /bootstrapOperatorToken/);
    assert.match(js.body, /parseHashState/);
    assert.match(js.body, /hashParams?\.get\("op_token"\)|hashState\.params\.get\("op_token"\)/);
    assert.match(js.body, /hashState\.params\.delete\("op_token"\)/);
    assert.match(js.body, /hashFromState/);
    assert.match(js.body, /\.sylion\.internal/);
    assert.match(js.body, /workloadStreamWrapperUrl/);
    assert.match(js.body, /const broker = url\.searchParams\.get\("broker"\)/);
    assert.match(js.body, /blindDefaultApps = new Set\(\["protonmail"\]\)/);
    assert.match(js.body, /sylion\.operator\.streamToken/);
    assert.match(js.body, /rememberStreamLaunchToken/);
    assert.match(js.body, /currentOperatorLaunchToken/);
    assert.match(js.body, /handleWorkloadLaunchClick/);
    assert.match(js.body, /!currentOperatorLaunchToken\(\) && !state\.session/);
    assert.match(js.body, /recreateWorkloadApp/);
    assert.match(js.body, /workloadControlKey/);
    assert.match(js.body, /install-workload-guacamole-vnc-forwards|G2 stream forwards refreshed/);
    assert.match(js.body, /Workload stream blocked: missing active operator session/);
    assert.match(js.body, /launchHash\.set\("op_token", token\)/);
    assert.match(js.body, /url\.hash = launchHash\.toString\(\)/);
    assert.match(js.body, /const wrapperApps = new Set\([\s\S]*"simplex"[\s\S]*"protonmail"[\s\S]*\)/);
    assert.doesNotMatch(js.body, /url\.searchParams\.set\("op_token"/);

    assert.match(css.body, /quick-grid/);
    assert.match(css.body, /position: fixed/);
    assert.match(css.body, /stream-control-bar/);

    const streamJs = await getText(baseUrl, "/operator/stream.js");
    assert.equal(streamJs.status, 200);
    assert.match(streamJs.contentType, /text\/javascript|application\/javascript/);
    assert.match(streamJs.body, /show_keyboard_controls/);
    assert.match(streamJs.body, /workload-input/);
    assert.match(streamJs.body, /sendWorkloadInput/);
    assert.match(streamJs.body, /showInputPanel/);
    assert.match(streamJs.body, /preKeys/);
    assert.match(streamJs.body, /postKeys/);
    assert.match(streamJs.body, /input-backspace/);
    assert.match(streamJs.body, /select_all/);
    assert.match(streamJs.body, /event\.key === "Enter"/);
    assert.match(streamJs.body, /event\.key === "Backspace"/);
    assert.match(streamJs.body, /inputText\.value = ""/);
    assert.match(streamJs.body, /guacamole-handoff/);
    assert.match(streamJs.body, /blind-e2ee\/sessions/);
    assert.match(streamJs.body, /capture-once/);
    assert.match(streamJs.body, /defaultBrokerForApp/);
    assert.match(streamJs.body, /appKey === "protonmail" \? "blind_e2ee" : "guacamole"/);
    assert.match(streamJs.body, /bootstrapOperatorToken/);
    assert.match(streamJs.body, /params\.get\("op_token"\)/);
    assert.match(streamJs.body, /hashParams\.get\("op_token"\)/);
    assert.match(streamJs.body, /hashParams\.delete\("op_token"\)/);
    assert.match(streamJs.body, /history\.replaceState/);
    assert.match(streamJs.body, /sessionStorage\.getItem\("sylion\.operator\.token"\)/);
    assert.match(streamJs.body, /sessionStorage\.setItem\("sylion\.operator\.streamToken", token\)/);
    assert.match(streamJs.body, /sessionStorage\.getItem\("sylion\.operator\.streamToken"\)/);
    assert.match(streamJs.body, /authorization: `Bearer \$\{operatorToken\}`/);
    assert.match(streamJs.body, /splitGuacamoleLaunchUrls/);
    assert.match(streamJs.body, /waitForFrameLoad/);
    assert.match(streamJs.body, /Authenticating \$\{handoff\.broker\.connectionName\} through Guacamole/);
    assert.match(streamJs.body, /duckduckgo\.sylion\.internal/);
    assert.match(streamJs.body, /simplex\.sylion\.internal/);
    assert.match(streamJs.body, /protonmail\.sylion\.internal/);
    assert.match(streamJs.body, /duckduckgo_browser:[\s\S]+directGateway: true/);
    assert.match(streamJs.body, /libreoffice:[\s\S]+directGateway: true/);
    assert.match(streamJs.body, /protonmail:[\s\S]+directGateway: true/);
    assert.match(streamJs.body, /simplex:[\s\S]+directGateway: true/);
    assert.doesNotMatch(streamJs.body, /params\.get\("url"\)/);
  } finally {
    await close();
  }
});

test("Operator Pixel stream wrapper is served with allowlisted internal frames", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const html = await getText(baseUrl, "/operator/stream.html?app=duckduckgo_browser");
    assert.equal(html.status, 200);
    assert.match(html.contentType, /text\/html/);
    assert.match(html.body, /SYLION Workload Stream/);
    assert.match(html.body, /id="workload-stream-frame"/);
    assert.match(html.body, /id="blind-e2ee-canvas"/);
    assert.match(html.body, /id="stream-input-panel"/);
    assert.match(html.body, /id="stream-input-text"/);
    assert.match(html.body, /enterkeyhint="go"/);
    assert.match(html.body, /data-stream-action="keyboard"/);
    assert.match(html.body, /data-stream-action="input-enter"/);
    assert.match(html.body, /data-stream-action="input-backspace"/);
    assert.match(html.body, /data-stream-action="input-clear"/);
    assert.match(html.body, /frame-src https:\/\/session\.sylion\.internal/);
    assert.match(html.body, /https:\/\/duckduckgo\.sylion\.internal/);
    assert.match(html.body, /https:\/\/protonmail\.sylion\.internal/);
    assert.match(html.body, /https:\/\/simplex\.sylion\.internal/);
    assert.match(html.body, /<script src="\/operator\/stream\.js\?v=step3-115"><\/script>/);
    assert.doesNotMatch(html.body, /unsafe-inline/);
  } finally {
    await close();
  }
});

test("/operator-api/workload-input requires an operator portal session", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/operator-api/workload-input`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-correlation-id": `corr_input_${crypto.randomUUID()}` },
      body: JSON.stringify({ templateKey: "duckduckgo_browser", text: "test" })
    });
    assert.equal(response.status, 401);
  } finally {
    await close();
  }
});

test("/operator-api/guacamole-handoff requires an operator portal session", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/operator-api/guacamole-handoff`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-correlation-id": `corr_guac_${crypto.randomUUID()}` },
      body: JSON.stringify({ templateKey: "signal" })
    });
    assert.equal(response.status, 401);
  } finally {
    await close();
  }
});

test("/operator-api/me requires an operator portal session", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/me");
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("/operator-api/devices requires an operator portal session", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/devices");
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("/operator-api/vpn-status requires an operator portal session", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/vpn-status");
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("/operator-api/connection-path requires an operator portal session", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/connection-path");
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("/operator-api/vpn-install-package requires an operator portal session", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/vpn-install-package");
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("/operator-api/laptop-access-package requires an operator portal session", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/laptop-access-package");
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("/operator-api/streaming-profile requires an operator portal session", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/streaming-profile?width=390&height=844&dpr=3");
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("/operator-api/settings/fido2 requires an operator portal session", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/settings/fido2");
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("/operator-api/settings/hsm requires an operator portal session", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/settings/hsm");
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test("/operator-api/about declares scoped status, ADR ref, productionExecutionAllowed=false", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/about");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "scoped_contract_ready");
    assert.equal(res.body.adr, "ADR-terminal-modes-001");
    assert.equal(res.body.productionExecutionAllowed, false);
    assert.ok(res.body.modes.includes("pixel_grapheneos"));
    assert.ok(res.body.modes.includes("laptop_web_terminal"));
  } finally {
    await close();
  }
});

test("Operator portal does not break admin-web routing", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getText(baseUrl, "/admin");
    assert.equal(res.status, 200);
    assert.match(res.contentType, /text\/html/);
  } finally {
    await close();
  }
});

test("Operator portal stays read-only via GET; no successful POST endpoints registered yet", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const response = await fetch(`${baseUrl}/operator-api/me`, { method: "POST", body: "{}" });
    // Skeleton has no POST routes wired yet — must not return 200.
    // Either 401 (auth gate) or 404 (no route match) is acceptable.
    assert.notEqual(response.status, 200);
    assert.ok([401, 404].includes(response.status), `Expected 401 or 404, got ${response.status}`);
  } finally {
    await close();
  }
});
