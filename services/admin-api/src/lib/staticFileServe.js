import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { sendRaw } from "./httpHelpers.js";

// Creates an async static file server bound to a single web root.
//
// - baseRoot: absolute filesystem root to serve from.
// - resolvePathname: maps the request URL to a request pathname (handles the
//   per-portal index rewrite and route-prefix stripping).
// - allowedTypes: extension -> content-type allowlist (also acts as the
//   served-extension allowlist; unknown extensions return false).
//
// Returns async (url, res) => boolean, preserving the original behaviour:
// path-traversal protection, MIME allowlist, and 404 fallback (false) when the
// file is missing or disallowed.
export function createStaticFileServer(baseRoot, resolvePathname, allowedTypes) {
  return async function serveStaticFile(url, res) {
    const pathname = resolvePathname(url);
    const filePath = resolve(baseRoot, `.${decodeURIComponent(pathname)}`);
    const relativePath = relative(baseRoot, filePath);
    if (
      relativePath.startsWith("..") ||
      relativePath.startsWith("/") ||
      relativePath.startsWith("\\")
    ) {
      return false;
    }
    const ext = extname(filePath);
    if (!allowedTypes[ext]) {
      return false;
    }
    try {
      const file = await readFile(filePath);
      sendRaw(res, 200, allowedTypes[ext], file);
      return true;
    } catch {
      return false;
    }
  };
}
