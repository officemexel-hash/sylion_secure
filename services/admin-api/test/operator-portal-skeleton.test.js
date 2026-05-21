// Per ADR-terminal-modes-001: skeleton tests for /operator/* static serving
// and /operator-api/* stub endpoints. Verifies that:
//   - /operator serves index.html
//   - /operator/styles.css and /operator/app.js serve their content
//   - /operator-api/* stubs return placeholder payloads
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
    assert.match(html.body, /not yet operational/);
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
  } finally {
    await close();
  }
});

test("/operator-api/me returns placeholder operator session with terminal modes", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/me");
    assert.equal(res.status, 200);
    assert.equal(res.body.placeholder, true);
    assert.deepEqual(res.body.terminalModes, ["pixel_grapheneos", "laptop_web_terminal"]);
    assert.equal(res.body.operatorId, null);
  } finally {
    await close();
  }
});

test("/operator-api/devices returns placeholder empty list", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/devices");
    assert.equal(res.status, 200);
    assert.equal(res.body.placeholder, true);
    assert.ok(Array.isArray(res.body.devices));
  } finally {
    await close();
  }
});

test("/operator-api/vpn-status returns disconnected placeholder", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/vpn-status");
    assert.equal(res.status, 200);
    assert.equal(res.body.state, "disconnected");
    assert.equal(res.body.router, null);
    assert.equal(res.body.placeholder, true);
  } finally {
    await close();
  }
});

test("/operator-api/settings/fido2 explicitly marks phaseDeferred=true", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/settings/fido2");
    assert.equal(res.status, 200);
    assert.equal(res.body.phaseDeferred, true);
    assert.ok(Array.isArray(res.body.keys));
    assert.equal(res.body.keys.length, 0);
  } finally {
    await close();
  }
});

test("/operator-api/settings/hsm explicitly marks phaseDeferred=true", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/settings/hsm");
    assert.equal(res.status, 200);
    assert.equal(res.body.phaseDeferred, true);
    assert.ok(Array.isArray(res.body.references));
    assert.equal(res.body.references.length, 0);
  } finally {
    await close();
  }
});

test("/operator-api/about declares skeleton status, ADR ref, productionExecutionAllowed=false", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await getJson(baseUrl, "/operator-api/about");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "skeleton");
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
