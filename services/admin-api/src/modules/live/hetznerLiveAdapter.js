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

export class HetznerLiveAdapter {
  constructor({ token = process.env.HETZNER_API_TOKEN, transport = fetch } = {}) {
    this.token = token;
    this.transport = transport;
  }

  async createVpsSet({ operatorId, region, serverType = "cx22", image = "ubuntu-24.04", labels = {}, idempotencyKey }) {
    const token = requireToken(this.token);
    const created = [];
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
        throw validationError("Hetzner live server creation failed", {
          status: response.status,
          role,
          tokenLogged: false
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
  }
}
