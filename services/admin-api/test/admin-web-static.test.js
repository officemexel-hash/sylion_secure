import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

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

test("V2 admin web shell is served from Admin API under /admin", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const html = await getText(baseUrl, "/admin");
    assert.equal(html.status, 200);
    assert.match(html.contentType, /text\/html/);
    assert.match(html.body, /SYLION Admin/);
    assert.match(html.body, /id="login-form"/);
    assert.match(html.body, /id="webauthn-mode"/);
    assert.match(html.body, /id="credential-cards"/);
    assert.match(html.body, /id="auth-policy-cards"/);
    assert.match(html.body, /data-view="phantom"/);
    assert.match(html.body, /id="phantom-capability-form"/);
    assert.match(html.body, /id="phantom-package-form"/);
    assert.match(html.body, /id="phantom-readiness-form"/);
    assert.match(html.body, /id="phantom-simulation-form"/);
    assert.match(html.body, /class="help-tip"/);
    assert.match(html.body, /id="recovery-form"/);
    assert.match(html.body, /id="break-glass-form"/);

    const js = await getText(baseUrl, "/admin/app.js");
    assert.equal(js.status, 200);
    assert.match(js.contentType, /text\/javascript/);
    assert.match(js.body, /async function login/);
    assert.match(js.body, /browserAssertion/);
    assert.match(js.body, /handleCredentialAction/);
    assert.match(js.body, /createPhantomApproval/);
    assert.match(js.body, /createPhantomPackage/);
    assert.match(js.body, /evaluatePhantomReadiness/);
    assert.match(js.body, /runPhantomSimulation/);
    assert.match(js.body, /createRecoveryRequest/);
    assert.match(js.body, /createBreakGlassRequest/);

    const css = await getText(baseUrl, "/admin/styles.css");
    assert.equal(css.status, 200);
    assert.match(css.contentType, /text\/css/);
    assert.match(css.body, /\.sidebar/);
  } finally {
    await close();
  }
});
