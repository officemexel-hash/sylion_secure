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
    providerErrorMessage:
      payload?.error?.message ||
      payload?.message ||
      (typeof payload === "string" ? payload.slice(0, 220) : null),
    robotCredentialsLogged: false
  };
}

function firstPrice(prices = [], location = null) {
  if (!Array.isArray(prices) || prices.length === 0) return null;
  const wanted = location ? String(location).toUpperCase() : null;
  return (
    prices.find((price) => String(price?.location || "").toUpperCase() === wanted) ||
    prices[0] ||
    null
  );
}

function normalizeProduct(product = {}) {
  const source = product.product && typeof product.product === "object" ? product.product : product;
  const locations = Array.isArray(source.locations)
    ? source.locations
    : Array.isArray(source.location)
      ? source.location
      : source.location
        ? [source.location]
        : [];
  const location = locations[0] || source.datacenter || null;
  const price = firstPrice(source.price || source.prices, location);
  const monthly =
    price?.price?.net || price?.price?.gross || source.price_monthly || source.price || null;
  const setup =
    price?.price_setup?.net ||
    price?.price_setup?.gross ||
    source.setup_fee ||
    source.price_setup ||
    null;
  return {
    productId: String(source.product_id || source.id || source.name || "unknown"),
    name: source.name || source.description?.[0] || null,
    locations,
    location,
    cpu:
      source.cpu ||
      source.cpu_type ||
      source.description?.find?.((item) => /CPU|Ryzen|EPYC|Xeon|Intel|AMD/i.test(item)) ||
      null,
    memoryGb: Number(source.memory || source.ram || 0) || null,
    hdd:
      source.hdd ||
      source.storage ||
      source.description?.find?.((item) => /NVMe|SSD|HDD|TB|GB/i.test(item)) ||
      null,
    priceMonthly: monthly,
    setupFee: setup,
    rawShapeLogged: false
  };
}

function normalizeOrder(payload = {}, fallback = {}) {
  const order = payload.order || payload.transaction || payload.server || payload;
  const product = order.product && typeof order.product === "object" ? order.product : {};
  const price = firstPrice(product.price || product.prices, order.location || fallback.location);
  return {
    providerResourceId: String(
      order.id ||
        order.transaction_id ||
        order.server_number ||
        fallback.productId ||
        "robot-order-pending"
    ),
    productId: String(order.product_id || product.id || fallback.productId || "unknown"),
    location: order.location || product.location || fallback.location || null,
    status: order.status || "order_requested",
    monthlyPrice: order.price_monthly || price?.price?.net || fallback.maxMonthlyPrice || null,
    setupFee: order.setup_fee || price?.price_setup?.net || null,
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
      throw validationError(
        "Hetzner Robot product list failed",
        await sanitizedRobotError(response)
      );
    }
    const payload = await response.json();
    const products = Array.isArray(payload) ? payload : payload.products || payload.product || [];
    return products.map(normalizeProduct);
  }

  async orderDedicatedServer({
    productId,
    location,
    dist = "Ubuntu 24.04 LTS base",
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
        location: location ? String(location).toUpperCase() : location,
        dist,
        "authorized_key[]": Array.isArray(authorizedKey)
          ? authorizedKey
          : authorizedKey
            ? [authorizedKey]
            : [],
        "addon[]": addons,
        test: test ? "true" : undefined
      })
    });
    if (!response.ok) {
      throw validationError(
        "Hetzner Robot dedicated server order failed",
        await sanitizedRobotError(response)
      );
    }
    const payload = await response.json();
    return normalizeOrder(payload, { productId, location, maxMonthlyPrice });
  }
}
