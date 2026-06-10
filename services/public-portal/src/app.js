import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CUSTOMER_PORTAL_ROOT = resolve(
  fileURLToPath(new URL("../../../apps/customer-portal/", import.meta.url))
);
const STATIC_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
});

const PUBLIC_API_ROUTES = Object.freeze([
  { method: "GET", pattern: /^\/portal-api\/pricing$/ },
  { method: "GET", pattern: /^\/portal-api\/payment-providers$/ },
  { method: "POST", pattern: /^\/portal-api\/checkouts$/ },
  { method: "POST", pattern: /^\/portal-api\/checkouts\/[^/]+\/claim-token$/ },
  { method: "POST", pattern: /^\/portal-api\/operator-bootstrap$/ },
  { method: "POST", pattern: /^\/portal-api\/webhooks\/[^/]+$/ }
]);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "cookie",
  "authorization"
]);

function securityHeaders(extra = {}) {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(self)",
    "cross-origin-resource-policy": "same-origin",
    ...extra
  };
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, securityHeaders({ "content-type": "application/json", ...headers }));
  res.end(JSON.stringify(payload));
}

function sendRaw(res, status, contentType, payload) {
  res.writeHead(status, securityHeaders({ "content-type": contentType }));
  res.end(payload);
}

function isAllowedPublicApi(method, pathname) {
  return PUBLIC_API_ROUTES.some((route) => route.method === method && route.pattern.test(pathname));
}

function publicRequestHeaders(req, { portalSecret }) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower.startsWith("x-sylion-")) continue;
    headers[key] = value;
  }
  headers["x-sylion-public-portal"] = "edge-v1";
  if (portalSecret) headers["x-sylion-public-portal-secret"] = portalSecret;
  if (!headers["x-correlation-id"]) {
    headers["x-correlation-id"] = `corr_public_portal_${randomUUID()}`;
  }
  return headers;
}

async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function servePortalStatic(url, res) {
  const pathname =
    url.pathname === "/" || url.pathname === "/portal"
      ? "/index.html"
      : url.pathname.replace(/^\/portal/, "");
  const filePath = resolve(CUSTOMER_PORTAL_ROOT, `.${decodeURIComponent(pathname)}`);
  const relativePath = relative(CUSTOMER_PORTAL_ROOT, filePath);
  if (
    relativePath.startsWith("..") ||
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\")
  ) {
    return false;
  }
  const ext = extname(filePath);
  if (!STATIC_TYPES[ext]) return false;
  try {
    const file = await readFile(filePath);
    sendRaw(res, 200, STATIC_TYPES[ext], file);
    return true;
  } catch {
    return false;
  }
}

async function proxyPublicApi(req, res, url, { controlPlaneBaseUrl, portalSecret, fetcher }) {
  if (!controlPlaneBaseUrl) {
    return sendJson(res, 503, {
      error: {
        code: "control_plane_not_configured",
        message: "Public portal control-plane route is not configured"
      }
    });
  }
  if (!isAllowedPublicApi(req.method, url.pathname)) {
    return sendJson(res, 404, { error: { code: "not_found", message: "Not found" } });
  }
  const target = new URL(url.pathname + url.search, controlPlaneBaseUrl);
  const rawBody = ["GET", "HEAD"].includes(req.method) ? null : await readRaw(req);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let upstream;
  try {
    upstream = await fetcher(target, {
      method: req.method,
      headers: publicRequestHeaders(req, { portalSecret }),
      body: rawBody,
      signal: controller.signal
    });
  } catch {
    return sendJson(res, 502, {
      error: {
        code: "control_plane_unreachable",
        message: "Public portal could not reach the private control plane"
      }
    });
  } finally {
    clearTimeout(timer);
  }
  const contentType = upstream.headers.get("content-type") || "application/json";
  const text = await upstream.text();
  res.writeHead(upstream.status, securityHeaders({ "content-type": contentType }));
  res.end(text);
}

export function createPublicPortalApp({
  controlPlaneBaseUrl = process.env.SYLION_CONTROL_PLANE_BASE_URL,
  portalSecret = process.env.SYLION_PUBLIC_PORTAL_SHARED_SECRET,
  fetcher = globalThis.fetch
} = {}) {
  const handle = async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, { status: "ok", service: "public-portal" });
      }
      if (
        url.pathname === "/admin" ||
        url.pathname.startsWith("/admin/") ||
        url.pathname === "/operator" ||
        url.pathname.startsWith("/operator/") ||
        url.pathname.startsWith("/operator-api/") ||
        url.pathname.startsWith("/auth/")
      ) {
        return sendJson(res, 404, { error: { code: "not_found", message: "Not found" } });
      }
      if (url.pathname.startsWith("/portal-api/")) {
        return await proxyPublicApi(req, res, url, { controlPlaneBaseUrl, portalSecret, fetcher });
      }
      if (
        req.method === "GET" &&
        (url.pathname === "/" || url.pathname === "/portal" || url.pathname.startsWith("/portal/"))
      ) {
        if (await servePortalStatic(url, res)) return;
      }
      return sendJson(res, 404, { error: { code: "not_found", message: "Not found" } });
    } catch (error) {
      return sendJson(res, 500, {
        error: {
          code: "public_portal_error",
          message: error.message
        }
      });
    }
  };
  return {
    listen(port = 8088, host = "127.0.0.1") {
      const server = createServer(handle);
      return new Promise((resolve) => {
        server.listen(port, host, () => resolve(server));
      });
    },
    handle
  };
}
