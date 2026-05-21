import { validationError } from "../../lib/errors.js";

const HETZNER_API = "https://api.hetzner.cloud/v1";

function requireToken(token) {
  if (!token || String(token).trim().length < 12) {
    throw validationError("Hetzner live adapter requires HETZNER_API_TOKEN from runtime secret storage", {
      secretSource: "environment",
      secretLogged: false
    });
  }
  return String(token);
}

function serverName({ operatorId, role, idempotencyKey }) {
  return `sylion-${operatorId}-${role.toLowerCase()}-${String(idempotencyKey).slice(0, 10)}`;
}

async function sanitizedProviderError(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  return {
    status: response.status,
    providerErrorCode: payload.error?.code || null,
    providerErrorMessage: payload.error?.message || null,
    tokenLogged: false
  };
}

export class HetznerLiveAdapter {
  constructor({ token = process.env.HETZNER_API_TOKEN, transport = fetch } = {}) {
    this.token = token;
    this.transport = transport;
  }

  async createVpsSet({ operatorId, region, serverType = "cx22", image = "ubuntu-24.04", labels = {}, idempotencyKey }) {
    const token = requireToken(this.token);
    const created = [];
    try {
      for (const role of ["G1", "G2", "WORKLOAD"]) {
        const body = {
          name: serverName({ operatorId, role, idempotencyKey }),
          server_type: serverType,
          image,
          location: region,
          labels: {
            ...labels,
            sylion_operator: operatorId,
            sylion_role: role.toLowerCase(),
            sylion_baseline: "three_vps_per_operator"
          }
        };
        const response = await this.transport(`${HETZNER_API}/servers`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(body)
        });
        if (!response.ok) {
          const providerError = await sanitizedProviderError(response);
          throw validationError("Hetzner live server creation failed", {
            role,
            ...providerError
          });
        }
        const payload = await response.json();
        created.push({
          role,
          providerResourceId: String(payload.server?.id || payload.server?.name || body.name),
          name: payload.server?.name || body.name,
          location: payload.server?.datacenter?.location?.name || region,
          rollback: {
            action: "delete_server",
            providerResourceId: String(payload.server?.id || payload.server?.name || body.name),
            idempotencyKey
          }
        });
      }
      return created;
    } catch (error) {
      const cleanupResults = await this.deleteVpsSet({
        actions: created.map((resource) => ({
          action: "delete_server",
          role: resource.role,
          providerResourceId: resource.providerResourceId,
          idempotencyKey
        }))
      });
      throw validationError("Hetzner live server creation failed and partial cleanup was attempted", {
        partialResourceCount: created.length,
        cleanupResults,
        tokenLogged: false,
        cause: error.code || error.message,
        providerStatus: error.details?.status || null,
        providerErrorCode: error.details?.providerErrorCode || null,
        providerErrorMessage: error.details?.providerErrorMessage || null
      });
    }
  }

  async listVpsSet({ operatorId }) {
    const token = requireToken(this.token);
    const selector = encodeURIComponent(`sylion_operator=${operatorId},sylion_baseline=three_vps_per_operator`);
    const response = await this.transport(`${HETZNER_API}/servers?label_selector=${selector}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      const providerError = await sanitizedProviderError(response);
      throw validationError("Hetzner live server list failed", {
        ...providerError
      });
    }
    const payload = await response.json();
    return (payload.servers || []).map((server) => ({
      role: String(server.labels?.sylion_role || "unknown").toUpperCase(),
      providerResourceId: String(server.id || server.name),
      name: server.name || null,
      location: server.datacenter?.location?.name || null,
      status: server.status || "unknown"
    }));
  }

  async deleteVpsSet({ actions = [] }) {
    const token = requireToken(this.token);
    const results = [];
    for (const action of actions) {
      if (!action.providerResourceId || action.action === "no_op_not_created") {
        results.push({ ...action, status: "skipped" });
        continue;
      }
      const response = await this.transport(`${HETZNER_API}/servers/${encodeURIComponent(action.providerResourceId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` }
      });
      if (!response.ok && response.status !== 404) {
        const providerError = await sanitizedProviderError(response);
        throw validationError("Hetzner live server deletion failed", {
          role: action.role,
          ...providerError
        });
      }
      results.push({ ...action, status: response.status === 404 ? "already_absent" : "delete_requested" });
    }
    return results;
  }
}
