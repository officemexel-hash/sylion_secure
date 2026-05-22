import { validationError } from "../../lib/errors.js";

const ROBOT_API = "https://robot-ws.your-server.de";

function requireCredential(value, field) {
  if (!value || String(value).trim().length < 3) {
    throw validationError(`Hetzner Robot adapter requires ${field} from runtime secret storage`, {
      secretSource: "environment",
      secretLogged: false
    });
  }
  return String(value);
}

function basicAuth(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

function formBody(input = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}

async function sanitizedRobotError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    try {
      payload = await response.text();
    } catch {
      payload = null;
    }
  }
  return {
    status: response.status,
    providerErrorCode: payload?.error?.code || payload?.code || null,
    providerErrorMessage: payload?.error?.message || payload?.message || (typeof payload === "string" ? payload.slice(0, 220) : null),
    robotCredentialsLogged: false
  };
}

function normalizeProduct(product = {}) {
  return {
    productId: String(product.product_id || product.id || product.name || "unknown"),
    name: product.name || product.product || product.description || null,
    location: product.location || product.datacenter || null,
    cpu: product.cpu || product.cpu_type || null,
    memoryGb: Number(product.memory || product.ram || 0) || null,
    hdd: product.hdd || product.storage || null,
    priceMonthly: product.price_monthly || product.price || null,
    setupFee: product.setup_fee || product.price_setup || null,
    rawShapeLogged: false
  };
}

function normalizeOrder(payload = {}, fallback = {}) {
  const order = payload.order || payload.transaction || payload.server || payload;
  return {
    providerResourceId: String(order.id || order.transaction_id || order.server_number || fallback.productId || "robot-order-pending"),
    productId: String(order.product_id || fallback.productId || "unknown"),
    location: order.location || fallback.location || null,
    status: order.status || "order_requested",
    monthlyPrice: order.price_monthly || fallback.maxMonthlyPrice || null,
    setupFee: order.setup_fee || null,
    terminalDataStored: false,
    robotCredentialsLogged: false
  };
}

export class HetznerRobotAdapter {
  constructor({
    user = process.env.SYLION_HETZNER_ROBOT_USER,
    password = process.env.SYLION_HETZNER_ROBOT_PASSWORD,
    transport = fetch,
    baseUrl = ROBOT_API
  } = {}) {
    this.user = user;
    this.password = password;
    this.transport = transport;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async listDedicatedProducts() {
    const user = requireCredential(this.user, "SYLION_HETZNER_ROBOT_USER");
    const password = requireCredential(this.password, "SYLION_HETZNER_ROBOT_PASSWORD");
    const response = await this.transport(`${this.baseUrl}/order/server/product`, {
      method: "GET",
      headers: { authorization: basicAuth(user, password) }
    });
    if (!response.ok) {
      throw validationError("Hetzner Robot product list failed", await sanitizedRobotError(response));
    }
    const payload = await response.json();
    const products = Array.isArray(payload) ? payload : payload.products || payload.product || [];
    return products.map(normalizeProduct);
  }

  async orderDedicatedServer({
    productId,
    location,
    dist = "Ubuntu 24.04 minimal",
    authorizedKey,
    addons = ["primary_ipv4"],
    test = false,
    maxMonthlyPrice = null
  }) {
    const user = requireCredential(this.user, "SYLION_HETZNER_ROBOT_USER");
    const password = requireCredential(this.password, "SYLION_HETZNER_ROBOT_PASSWORD");
    const response = await this.transport(`${this.baseUrl}/order/server/transaction`, {
      method: "POST",
      headers: {
        authorization: basicAuth(user, password),
        "content-type": "application/x-www-form-urlencoded"
      },
      body: formBody({
        product_id: productId,
        location,
        dist,
        authorized_key: authorizedKey,
        addon: addons,
        test: test ? "true" : undefined
      })
    });
    if (!response.ok) {
      throw validationError("Hetzner Robot dedicated server order failed", await sanitizedRobotError(response));
    }
    const payload = await response.json();
    return normalizeOrder(payload, { productId, location, maxMonthlyPrice });
  }
}
