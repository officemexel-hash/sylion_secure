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
    assert.match(html.body, /https:\/\/signal\.sylion\.internal\//);
    assert.match(html.body, /https:\/\/duckduckgo\.sylion\.internal\//);
    assert.match(html.body, /https:\/\/libreoffice\.sylion\.internal\//);
    assert.match(html.body, /Backup & Panic/);
  } finally {
    await close();
  }
});

test("Operator portal serves styles.css and app.js", async () => {
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
    assert.match(js.body, /bootstrapOperatorToken/);
    assert.match(js.body, /\.sylion\.internal/);

    assert.match(css.body, /quick-grid/);
    assert.match(css.body, /position: fixed/);
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
