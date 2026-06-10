// KS-G2-2 / API-OPA-30 (Phase A) — Open Policy Agent (OPA) decision adapter.
//
// This is ADDITIVE Phase A scaffolding. The authoritative authorization path is
// still RbacService (custom role-permission map in modules/rbac/rbacService.js).
// Nothing here is wired into the default request path: enforcement is gated
// behind SYLION_AUTHZ_ENGINE (default "rbac"). With the flag at its default the
// runtime behaves exactly as today and the full existing suite passes unchanged.
//
// The adapter speaks the OPA Data API over the built-in global fetch (no new npm
// dependency). It mirrors the RbacService decision shape: the caller assembles
// an input of { actor:{id,role}, action, resource, context } — the same actor /
// action / resource that RbacService.assert() already receives — and OPA returns
// an allow boolean. The Rego skeleton lives in policies/sylion-authz.rego.
//
// Hard invariants enforced here:
//   * enforcing stays false and humanGateRequired stays true regardless of
//     configuration — turning OPA into an authoritative gate is a HUMAN GATE
//     decision (Architect + CISO). Wiring the client does NOT make it
//     authoritative; in Phase A the adapter is advisory only.
//   * FAIL-CLOSED: any OPA error, timeout, non-2xx response, or unconfigured
//     state resolves to allow:false. This only matters once someone flips
//     enforcing on; in Phase A a deny here changes nothing because RbacService
//     remains the decider.
//   * No secret material is read, logged, or serialized. OPA decision inputs are
//     non-secret actor/action/resource descriptors.

const DEFAULT_DECISION_PATH = "sylion/authz/allow";
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const NOT_CONFIGURED_REASON = "opa_not_configured";

export class OpaPolicyProvider {
  constructor({ env = process.env, config = {}, fetchImpl = null } = {}) {
    this.env = env;
    this.engine = "opa";

    this.addr = sanitizeAddr(config.addr || env.SYLION_OPA_ADDR || null);
    this.decisionPath = normalizeDecisionPath(
      config.decisionPath || env.SYLION_OPA_DECISION_PATH || DEFAULT_DECISION_PATH
    );
    this.timeoutMs =
      Number(config.timeoutMs || env.SYLION_OPA_TIMEOUT_MS || 0) || DEFAULT_REQUEST_TIMEOUT_MS;

    this.fetchImpl = fetchImpl || globalThis.fetch;

    // Phase A invariants — immutable regardless of configuration.
    this.enforcing = false;
    this.humanGateRequired = true;
  }

  get configured() {
    return Boolean(this.addr);
  }

  // Evaluate an authorization decision against OPA.
  //
  // `input` is { actor:{id,role}, action, resource, context } — the same shape
  // RbacService.assert() operates on. POSTs { input } to
  // {addr}/v1/data/{decisionPath} and reads OPA's `result`.
  //
  // OPA `result` may be a bare boolean (a rule that yields true/false) or an
  // object whose `allow` field carries the decision (and optional `reasons`).
  // Both are normalized to { allow, reasons?, raw }.
  //
  // FAIL-CLOSED: unconfigured, transport error, timeout, non-2xx, or an
  // unparseable / missing result all resolve to allow:false with a reason. This
  // never throws.
  async evaluate(input) {
    if (!this.configured) {
      return {
        allow: false,
        reasons: [NOT_CONFIGURED_REASON],
        raw: null
      };
    }

    const path = `/v1/data/${this.decisionPath}`;
    let response;
    try {
      response = await this.#request("POST", path, { body: { input: input ?? {} } });
    } catch (err) {
      return {
        allow: false,
        reasons: [err && err.reason ? err.reason : "opa_request_failed"],
        raw: null
      };
    }

    if (!response.ok) {
      return {
        allow: false,
        reasons: [`opa_http_${response.status}`],
        raw: null
      };
    }

    let body;
    try {
      body = await response.json();
    } catch {
      return {
        allow: false,
        reasons: ["opa_invalid_response"],
        raw: null
      };
    }

    return normalizeDecision(body);
  }

  // Metadata only — never throws, never carries decision inputs.
  //
  // Unconfigured: { configured:false, enforcing:false }. Configured: probes OPA
  // GET /health and reports { configured:true, enforcing:false (Phase A),
  // humanGateRequired:true } plus the health probe result. enforcing /
  // humanGateRequired are Phase A constants and do NOT change with config.
  async status() {
    if (!this.configured) {
      return {
        engine: "opa",
        configured: false,
        enforcing: false,
        reason: NOT_CONFIGURED_REASON
      };
    }

    const health = await this.#health();
    return {
      engine: "opa",
      configured: true,
      // Phase A: client wired, but RbacService stays authoritative. Promoting
      // OPA to enforcing is a HUMAN GATE decision (Architect + CISO).
      enforcing: false,
      humanGateRequired: true,
      addr: this.addr,
      decisionPath: this.decisionPath,
      health
    };
  }

  // ---- internal ----------------------------------------------------------

  async #health() {
    try {
      const response = await this.#request("GET", "/health", { allowNon2xx: true });
      return { reachable: true, httpStatus: response.status };
    } catch (err) {
      return {
        reachable: false,
        httpStatus: null,
        error: err && err.reason ? err.reason : "unreachable"
      };
    }
  }

  // Single HTTP entrypoint. Applies the AbortController timeout. Throws
  // OpaRequestError on transport/timeout failure; non-2xx is returned to the
  // caller (which decides whether to fail closed) unless allowNon2xx is set.
  async #request(method, path, { body = null, allowNon2xx = false } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== null) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.addr}${path}`, {
        method,
        headers,
        body: body !== null ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } catch (err) {
      throw new OpaRequestError(
        err && err.name === "AbortError" ? "opa_timeout" : "opa_unreachable"
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok && !allowNon2xx) {
      // Non-2xx is a valid signal for evaluate()/health(); let the caller see
      // the response and decide. We return rather than throw so evaluate() can
      // map the status into a fail-closed reason.
      return response;
    }
    return response;
  }
}

export class OpaRequestError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "OpaRequestError";
    this.reason = reason;
    this.enforcing = false;
    this.humanGateRequired = true;
  }
}

// Map OPA's `result` into the RbacService-compatible decision shape.
// FAIL-CLOSED on anything that is not an explicit allow.
function normalizeDecision(body) {
  const result = body ? body.result : undefined;

  // Bare boolean result (e.g. `data.sylion.authz.allow` is a boolean rule).
  if (typeof result === "boolean") {
    return { allow: result, reasons: [], raw: body ?? null };
  }

  // Object result carrying { allow, reasons? }.
  if (result && typeof result === "object" && typeof result.allow === "boolean") {
    const reasons = Array.isArray(result.reasons) ? result.reasons : [];
    return { allow: result.allow, reasons, raw: body };
  }

  // Undefined result = no matching rule = OPA's empty document = deny.
  return { allow: false, reasons: ["opa_no_decision"], raw: body ?? null };
}

function sanitizeAddr(addr) {
  if (!addr) return null;
  return String(addr).replace(/\/+$/, "");
}

// Accept "sylion/authz/allow", "/sylion/authz/allow", or a dotted form and
// normalize to a slash-separated path with no leading/trailing slashes.
function normalizeDecisionPath(path) {
  return String(path || DEFAULT_DECISION_PATH)
    .replace(/\./g, "/")
    .replace(/^\/+|\/+$/g, "");
}
