import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { OpaPolicyProvider } from "../src/modules/policy/opaPolicyProvider.js";

// KS-G2-2 / API-OPA-30 (Phase A) — OPA Data API client, exercised against a
// local mock that speaks just enough of the OPA HTTP API (GET /health, POST
// /v1/data/{decisionPath}). The mock NEVER carries secrets; decision inputs are
// non-secret actor/action/resource descriptors.
//
// Assertions confirm: evaluate() returns allow matching the mock; configured
// status() reports enforcing:false (HUMAN GATE); unconfigured status reports
// configured:false and evaluate() fails closed; timeout and non-2xx both fail
// closed (allow:false) without throwing.

const DECISION_PATH = "sylion/authz/allow";

// Spin up an in-process OPA mock on an ephemeral port (listen(0)).
// `mode` controls the data endpoint behavior so different tests can drive
// allow/deny/object-result/non-2xx/slow paths from the same harness.
function startMockOpa({ mode = "boolean", allow = true, delayMs = 0 } = {}) {
  const state = { lastInput: null, dataCalls: 0, healthCalls: 0 };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://mock.local");
    const path = url.pathname;

    const readBody = () =>
      new Promise((resolve) => {
        let raw = "";
        req.on("data", (chunk) => {
          raw += chunk;
        });
        req.on("end", () => {
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            resolve({});
          }
        });
      });

    const sendJson = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    // GET /health — OPA health probe.
    if (path === "/health" && req.method === "GET") {
      state.healthCalls += 1;
      return sendJson(200, {});
    }

    // POST /v1/data/{decisionPath} — decision evaluation.
    if (path === `/v1/data/${DECISION_PATH}` && req.method === "POST") {
      return readBody().then((body) => {
        state.dataCalls += 1;
        state.lastInput = body && body.input ? body.input : null;

        if (mode === "non2xx") {
          return sendJson(500, { code: "internal_error" });
        }

        const respond = () => {
          if (mode === "object") {
            return sendJson(200, {
              result: { allow, reasons: allow ? [] : ["default_deny"] }
            });
          }
          if (mode === "empty") {
            // OPA returns {} (no `result`) when the document is undefined.
            return sendJson(200, {});
          }
          // Default: bare boolean result.
          return sendJson(200, { result: allow });
        };

        if (delayMs > 0) {
          setTimeout(respond, delayMs);
          return undefined;
        }
        return respond();
      });
    }

    return sendJson(404, { code: "unknown mock path" });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, state, addr: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

const sampleInput = {
  actor: { id: "admin-1", role: "Global Super Admin" },
  action: "release.read",
  resource: { resourceType: "release_gate", resourceId: "rg-1" },
  context: { correlationId: "corr-1" }
};

// (a) evaluate() returns allow:true when the mock allows (bare boolean result).
test("(a) evaluate returns allow:true for an allowing OPA decision", async (t) => {
  const mock = await startMockOpa({ mode: "boolean", allow: true });
  t.after(() => closeServer(mock.server));

  const provider = new OpaPolicyProvider({ env: { SYLION_OPA_ADDR: mock.addr } });
  const decision = await provider.evaluate(sampleInput);

  assert.equal(decision.allow, true);
  assert.equal(mock.state.dataCalls, 1);
  // The adapter forwards the full actor/action/resource input to OPA.
  assert.equal(mock.state.lastInput.action, "release.read");
  assert.equal(mock.state.lastInput.actor.role, "Global Super Admin");
});

// (b) evaluate() returns allow:false when the mock denies.
test("(b) evaluate returns allow:false for a denying OPA decision", async (t) => {
  const mock = await startMockOpa({ mode: "boolean", allow: false });
  t.after(() => closeServer(mock.server));

  const provider = new OpaPolicyProvider({ env: { SYLION_OPA_ADDR: mock.addr } });
  const decision = await provider.evaluate(sampleInput);

  assert.equal(decision.allow, false);
});

// (c) evaluate() understands the object result form { allow, reasons }.
test("(c) evaluate parses object result with reasons", async (t) => {
  const mock = await startMockOpa({ mode: "object", allow: false });
  t.after(() => closeServer(mock.server));

  const provider = new OpaPolicyProvider({ env: { SYLION_OPA_ADDR: mock.addr } });
  const decision = await provider.evaluate(sampleInput);

  assert.equal(decision.allow, false);
  assert.deepEqual(decision.reasons, ["default_deny"]);
});

// (d) configured status() => configured:true but enforcing stays false.
test("(d) status() is configured against a running OPA but enforcing=false", async (t) => {
  const mock = await startMockOpa();
  t.after(() => closeServer(mock.server));

  const provider = new OpaPolicyProvider({ env: { SYLION_OPA_ADDR: mock.addr } });
  const status = await provider.status();

  assert.equal(status.configured, true);
  assert.equal(status.enforcing, false, "Phase A — promoting OPA is a HUMAN GATE");
  assert.equal(status.humanGateRequired, true);
  assert.equal(status.decisionPath, DECISION_PATH);
  assert.equal(status.health.reachable, true);
  assert.equal(status.health.httpStatus, 200);
  assert.equal(mock.state.healthCalls, 1);
});

// (e) unconfigured: status configured:false (no throw); evaluate fails closed.
test("(e) unconfigured provider: status configured:false, evaluate fails closed", async () => {
  const provider = new OpaPolicyProvider({ env: {} });

  const status = await provider.status();
  assert.equal(status.configured, false);
  assert.equal(status.enforcing, false);
  assert.equal(status.reason, "opa_not_configured");

  const decision = await provider.evaluate(sampleInput);
  assert.equal(decision.allow, false);
  assert.deepEqual(decision.reasons, ["opa_not_configured"]);
  assert.equal(decision.raw, null);
});

// (f) non-2xx from OPA => allow:false (fail closed), no throw.
test("(f) non-2xx OPA response fails closed", async (t) => {
  const mock = await startMockOpa({ mode: "non2xx" });
  t.after(() => closeServer(mock.server));

  const provider = new OpaPolicyProvider({ env: { SYLION_OPA_ADDR: mock.addr } });
  const decision = await provider.evaluate(sampleInput);

  assert.equal(decision.allow, false);
  assert.deepEqual(decision.reasons, ["opa_http_500"]);
});

// (g) timeout => allow:false (fail closed), no throw.
test("(g) OPA timeout fails closed", async (t) => {
  // Mock delays the response past the configured timeout.
  const mock = await startMockOpa({ mode: "boolean", allow: true, delayMs: 200 });
  t.after(() => closeServer(mock.server));

  const provider = new OpaPolicyProvider({
    env: { SYLION_OPA_ADDR: mock.addr, SYLION_OPA_TIMEOUT_MS: "40" }
  });
  const decision = await provider.evaluate(sampleInput);

  assert.equal(decision.allow, false);
  assert.deepEqual(decision.reasons, ["opa_timeout"]);
});

// (h) empty OPA document (no result) => allow:false with opa_no_decision.
test("(h) empty OPA result document fails closed", async (t) => {
  const mock = await startMockOpa({ mode: "empty" });
  t.after(() => closeServer(mock.server));

  const provider = new OpaPolicyProvider({ env: { SYLION_OPA_ADDR: mock.addr } });
  const decision = await provider.evaluate(sampleInput);

  assert.equal(decision.allow, false);
  assert.deepEqual(decision.reasons, ["opa_no_decision"]);
});
