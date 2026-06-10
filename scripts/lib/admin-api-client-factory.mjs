import { AdminApiClient } from "../../services/admin-api/src/sdk/adminApiClient.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:18099";

/**
 * Build an anonymous AdminApiClient using the exact initialization pattern shared
 * by the live runner scripts in scripts/.
 *
 * - baseUrl falls back to process.env.SYLION_BASE_URL, then to the local harness
 *   default (http://127.0.0.1:18099) used by the workload runners.
 * - correlationPrefix is prepended to a fresh crypto.randomUUID() per request,
 *   matching the `() => \`${prefix}${crypto.randomUUID()}\`` factory each script
 *   declares inline. Pass the script's own prefix to keep correlation ids 1:1.
 *
 * @param {string} [baseUrl] explicit base URL; resolved from env/default when omitted
 * @param {string} [correlationPrefix] correlation-id prefix (e.g. "corr_step3_86_duck_")
 * @returns {AdminApiClient}
 */
export function createAdminApiClient(baseUrl, correlationPrefix = "corr_") {
  const resolvedBaseUrl = baseUrl ?? process.env.SYLION_BASE_URL ?? DEFAULT_BASE_URL;
  return new AdminApiClient({
    baseUrl: resolvedBaseUrl,
    correlationIdFactory: () => `${correlationPrefix}${crypto.randomUUID()}`
  });
}
