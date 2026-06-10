#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash, randomBytes, webcrypto } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

const execFileAsync = promisify(execFile);
const DEFAULT_WIDTH = 390;
const DEFAULT_HEIGHT = 844;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const ALGORITHM = "ECDH_P384_AES_256_GCM_FRAME_V1";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const eq = item.indexOf("=");
    if (eq > 0) {
      args[item.slice(2, eq)] = item.slice(eq + 1);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function fromB64(value) {
  return Buffer.from(
    String(value || "")
      .replaceAll("-", "+")
      .replaceAll("_", "/"),
    "base64"
  );
}

function safeInteger(value, fallback, min, max) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(number) && number >= min && number <= max) return number;
  return fallback;
}

function safePublicJwk(value, field = "terminalPublicKeyJwk") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field}_must_be_public_jwk`);
  }
  if (Object.hasOwn(value, "d")) {
    throw new Error(`${field}_must_not_include_private_material`);
  }
  const publicJwk = {
    kty: String(value.kty || "").trim(),
    crv: String(value.crv || "").trim(),
    x: String(value.x || "").trim(),
    y: String(value.y || "").trim(),
    ext: value.ext === true,
    key_ops: Array.isArray(value.key_ops)
      ? value.key_ops.filter((op) => typeof op === "string").slice(0, 4)
      : []
  };
  if (publicJwk.kty !== "EC" || publicJwk.crv !== "P-384") {
    throw new Error(`${field}_must_use_ec_p384`);
  }
  if (!/^[A-Za-z0-9_-]{60,96}$/.test(publicJwk.x) || !/^[A-Za-z0-9_-]{60,96}$/.test(publicJwk.y)) {
    throw new Error(`${field}_coordinates_invalid`);
  }
  return publicJwk;
}

async function loadTerminalPublicKeyJwk(args) {
  if (args["terminal-public-key-jwk-json"]) {
    return safePublicJwk(JSON.parse(args["terminal-public-key-jwk-json"]));
  }
  if (args["terminal-public-key-jwk-b64"]) {
    return safePublicJwk(JSON.parse(fromB64(args["terminal-public-key-jwk-b64"]).toString("utf8")));
  }
  if (args["terminal-public-key-jwk-file"]) {
    return safePublicJwk(JSON.parse(await readFile(args["terminal-public-key-jwk-file"], "utf8")));
  }
  throw new Error("terminal_public_key_jwk_required");
}

async function captureWithPlaywright({ sourceUrl, width, height, timeoutMs }) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("playwright_not_available_for_source_url_capture");
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true
    });
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(Math.min(2500, Math.max(250, Math.floor(timeoutMs / 8))));
    return Buffer.from(await page.screenshot({ type: "png", fullPage: false }));
  } finally {
    await browser.close();
  }
}

async function captureWithCommand({ commandJson, timeoutMs }) {
  const parsed = JSON.parse(commandJson);
  if (
    !Array.isArray(parsed) ||
    !parsed.length ||
    parsed.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("capture_command_json_must_be_string_array");
  }
  const outputPath = join(tmpdir(), `sylion-blind-frame-${randomBytes(8).toString("hex")}.png`);
  const args = parsed.slice(1).map((entry) => entry.replaceAll("{output}", outputPath));
  try {
    await execFileAsync(parsed[0], args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 512 * 1024
    });
    return await readFile(outputPath);
  } finally {
    await rm(outputPath, { force: true });
  }
}

async function captureFrame(args) {
  const timeoutMs = safeInteger(args["capture-timeout-ms"], 20_000, 1000, 120_000);
  if (args["source-png"]) {
    return await readFile(args["source-png"]);
  }
  if (args["rfb-host"] && args["rfb-port"]) {
    return await captureRfbPng({
      host: String(args["rfb-host"]),
      port: safeInteger(args["rfb-port"], 5900, 1, 65535),
      timeoutMs
    });
  }
  if (args["capture-command-json"]) {
    return await captureWithCommand({ commandJson: args["capture-command-json"], timeoutMs });
  }
  if (args["source-url"]) {
    return await captureWithPlaywright({
      sourceUrl: args["source-url"],
      width: safeInteger(args.width, DEFAULT_WIDTH, 1, 8192),
      height: safeInteger(args.height, DEFAULT_HEIGHT, 1, 8192),
      timeoutMs
    });
  }
  throw new Error("frame_source_required");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePngRgba({ width, height, rgba }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("png_dimensions_invalid");
  }
  if (!Buffer.isBuffer(rgba)) rgba = Buffer.from(rgba);
  if (rgba.length !== width * height * 4) {
    throw new Error("png_rgba_length_invalid");
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    scanlines[rowStart] = 0;
    rgba.copy(scanlines, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND")
  ]);
}

function socketReader(sock) {
  let buffer = Buffer.alloc(0);
  const waiters = [];
  let ended = false;
  let error = null;
  function pump() {
    while (waiters.length && buffer.length >= waiters[0].size) {
      const waiter = waiters.shift();
      const out = buffer.subarray(0, waiter.size);
      buffer = buffer.subarray(waiter.size);
      waiter.resolve(out);
    }
    if ((ended || error) && waiters.length) {
      const waiter = waiters.shift();
      waiter.reject(error || new Error("rfb_socket_closed"));
      pump();
    }
  }
  sock.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    pump();
  });
  sock.on("end", () => {
    ended = true;
    pump();
  });
  sock.on("close", () => {
    ended = true;
    pump();
  });
  sock.on("error", (err) => {
    error = err;
    pump();
  });
  return {
    read(size) {
      if (buffer.length >= size) {
        const out = buffer.subarray(0, size);
        buffer = buffer.subarray(size);
        return Promise.resolve(out);
      }
      if (ended || error) return Promise.reject(error || new Error("rfb_socket_closed"));
      return new Promise((resolve, reject) => waiters.push({ size, resolve, reject }));
    }
  };
}

function connectSocket(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("rfb_connect_timeout"));
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.setNoDelay(true);
      resolve(sock);
    });
    sock.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function captureRfbPng({ host, port, timeoutMs }) {
  const sock = await connectSocket(host, port, timeoutMs);
  const reader = socketReader(sock);
  const deadline = setTimeout(() => sock.destroy(new Error("rfb_capture_timeout")), timeoutMs);
  try {
    const serverVersion = await reader.read(12);
    if (!serverVersion.toString("ascii").startsWith("RFB ")) throw new Error("rfb_banner_missing");
    sock.write(serverVersion);
    const versionText = serverVersion.toString("ascii");
    if (/003\.003/.test(versionText)) {
      const securityType = (await reader.read(4)).readUInt32BE(0);
      if (securityType !== 1) throw new Error("rfb_none_security_unavailable");
    } else {
      const securityTypeCount = (await reader.read(1))[0];
      if (securityTypeCount === 0) {
        const reasonLength = (await reader.read(4)).readUInt32BE(0);
        const reason = (await reader.read(reasonLength)).toString("utf8").slice(0, 120);
        throw new Error(`rfb_security_rejected:${reason}`);
      }
      const securityTypes = await reader.read(securityTypeCount);
      if (![...securityTypes].includes(1)) throw new Error("rfb_none_security_unavailable");
      sock.write(Buffer.from([1]));
      const securityResult = (await reader.read(4)).readUInt32BE(0);
      if (securityResult !== 0) throw new Error("rfb_security_result_failed");
    }
    sock.write(Buffer.from([1]));
    const init = await reader.read(24);
    const width = init.readUInt16BE(0);
    const height = init.readUInt16BE(2);
    const nameLength = init.readUInt32BE(20);
    if (nameLength) await reader.read(nameLength);
    if (width < 1 || height < 1 || width > 8192 || height > 8192)
      throw new Error("rfb_framebuffer_dimensions_invalid");

    const pixelFormat = Buffer.alloc(20);
    pixelFormat[0] = 0;
    pixelFormat.writeUInt8(32, 4);
    pixelFormat.writeUInt8(24, 5);
    pixelFormat.writeUInt8(0, 6);
    pixelFormat.writeUInt8(1, 7);
    pixelFormat.writeUInt16BE(255, 8);
    pixelFormat.writeUInt16BE(255, 10);
    pixelFormat.writeUInt16BE(255, 12);
    pixelFormat.writeUInt8(16, 14);
    pixelFormat.writeUInt8(8, 15);
    pixelFormat.writeUInt8(0, 16);
    sock.write(pixelFormat);

    const encodings = Buffer.alloc(8);
    encodings[0] = 2;
    encodings.writeUInt16BE(1, 2);
    encodings.writeInt32BE(0, 4);
    sock.write(encodings);

    const request = Buffer.alloc(10);
    request[0] = 3;
    request[1] = 0;
    request.writeUInt16BE(0, 2);
    request.writeUInt16BE(0, 4);
    request.writeUInt16BE(width, 6);
    request.writeUInt16BE(height, 8);
    sock.write(request);

    let messageType = (await reader.read(1))[0];
    while (messageType !== 0) {
      if (messageType === 2) {
        await reader.read(1);
      }
      messageType = (await reader.read(1))[0];
    }
    await reader.read(1);
    const rectCount = (await reader.read(2)).readUInt16BE(0);
    const rgba = Buffer.alloc(width * height * 4, 0);
    for (let rectIndex = 0; rectIndex < rectCount; rectIndex += 1) {
      const rect = await reader.read(12);
      const x = rect.readUInt16BE(0);
      const y = rect.readUInt16BE(2);
      const w = rect.readUInt16BE(4);
      const h = rect.readUInt16BE(6);
      const encoding = rect.readInt32BE(8);
      if (encoding !== 0) throw new Error(`rfb_unsupported_encoding:${encoding}`);
      const raw = await reader.read(w * h * 4);
      for (let row = 0; row < h; row += 1) {
        for (let col = 0; col < w; col += 1) {
          const src = (row * w + col) * 4;
          const dst = ((y + row) * width + (x + col)) * 4;
          rgba[dst] = raw[src + 2];
          rgba[dst + 1] = raw[src + 1];
          rgba[dst + 2] = raw[src];
          rgba[dst + 3] = 255;
        }
      }
    }
    return encodePngRgba({ width, height, rgba });
  } finally {
    clearTimeout(deadline);
    sock.destroy();
  }
}

async function encryptFrame({
  plaintext,
  terminalPublicKeyJwk,
  sessionId,
  keyId,
  templateKey,
  sequence = 1,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  contentType = "image/png",
  timestampMs = Date.now()
}) {
  if (!Buffer.isBuffer(plaintext)) plaintext = Buffer.from(plaintext);
  if (!plaintext.length || plaintext.length > MAX_FRAME_BYTES) {
    throw new Error("frame_plaintext_length_outside_bounds");
  }
  const terminalPublicKey = await webcrypto.subtle.importKey(
    "jwk",
    safePublicJwk(terminalPublicKeyJwk),
    { name: "ECDH", namedCurve: "P-384" },
    false,
    []
  );
  const workloadKeyPair = await webcrypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-384" },
    true,
    ["deriveKey"]
  );
  const workloadPublicKeyJwk = await webcrypto.subtle.exportKey("jwk", workloadKeyPair.publicKey);
  const aesKey = await webcrypto.subtle.deriveKey(
    { name: "ECDH", public: terminalPublicKey },
    workloadKeyPair.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const sframeHeader = Buffer.from(
    stableJson({
      alg: ALGORITHM,
      contentType,
      height,
      keyId,
      sequence,
      sessionId,
      templateKey,
      timestampMs,
      width
    }),
    "utf8"
  );
  const iv = randomBytes(12);
  const ciphertext = Buffer.from(
    await webcrypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: sframeHeader, tagLength: 128 },
      aesKey,
      plaintext
    )
  );
  return {
    frameId: `frame_${randomBytes(12).toString("hex")}`,
    keyId,
    algorithm: ALGORITHM,
    profile: "workload_local_encrypt_terminal_ecdh_p384_aes256gcm_v1",
    contentType,
    ivB64: b64(iv),
    ciphertextB64: b64(ciphertext),
    ciphertextSha256: sha256Hex(ciphertext),
    ciphertextLength: ciphertext.length,
    authTagLength: 16,
    sframeHeaderB64: b64(sframeHeader),
    sframeHeaderSha256: sha256Hex(sframeHeader),
    sframeHeaderLength: sframeHeader.length,
    workloadPublicKeyJwk: safePublicJwk(workloadPublicKeyJwk, "workloadPublicKeyJwk"),
    sequence,
    timestampMs,
    width,
    height
  };
}

async function decryptFrameForTest({ frame, terminalPrivateKey }) {
  const workloadPublicKey = await webcrypto.subtle.importKey(
    "jwk",
    safePublicJwk(frame.workloadPublicKeyJwk, "workloadPublicKeyJwk"),
    { name: "ECDH", namedCurve: "P-384" },
    false,
    []
  );
  const aesKey = await webcrypto.subtle.deriveKey(
    { name: "ECDH", public: workloadPublicKey },
    terminalPrivateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  return Buffer.from(
    await webcrypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromB64(frame.ivB64),
        additionalData: fromB64(frame.sframeHeaderB64),
        tagLength: frame.authTagLength * 8
      },
      aesKey,
      fromB64(frame.ciphertextB64)
    )
  );
}

async function postFrame({ apiBase, operatorToken, sessionId, frame, correlationId }) {
  const response = await fetch(
    `${apiBase.replace(/\/$/, "")}/operator-api/blind-e2ee/sessions/${encodeURIComponent(sessionId)}/frames`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": correlationId || `corr_blind_encoder_${randomBytes(8).toString("hex")}`,
        authorization: `Bearer ${operatorToken}`,
        "x-sylion-operator-csrf": "same-origin-ui"
      },
      body: JSON.stringify(frame)
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `frame_post_failed_http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload.frame;
}

async function encodeOnce(args) {
  const terminalPublicKeyJwk = await loadTerminalPublicKeyJwk(args);
  const plaintext = await captureFrame(args);
  const frame = await encryptFrame({
    plaintext,
    terminalPublicKeyJwk,
    sessionId: String(args["session-id"] || ""),
    keyId: String(args["key-id"] || ""),
    templateKey: String(args["template-key"] || "duckduckgo_browser"),
    sequence: safeInteger(args.sequence, 1, 0, Number.MAX_SAFE_INTEGER),
    width: safeInteger(args.width, DEFAULT_WIDTH, 1, 8192),
    height: safeInteger(args.height, DEFAULT_HEIGHT, 1, 8192),
    contentType: String(args["content-type"] || "image/png").toLowerCase()
  });
  if (args["emit-frame-only"]) return { frame };
  let posted = null;
  if (args["api-base"]) {
    const operatorToken = args["operator-token"] || process.env.SYLION_OPERATOR_TOKEN;
    if (!operatorToken) throw new Error("operator_token_required_for_frame_post");
    posted = await postFrame({
      apiBase: args["api-base"],
      operatorToken,
      sessionId: args["session-id"],
      frame,
      correlationId: args["correlation-id"]
    });
  }
  return {
    ok: true,
    mode: args["api-base"] ? "posted_to_blind_relay" : "encoded_only",
    sessionId: args["session-id"] || null,
    templateKey: args["template-key"] || "duckduckgo_browser",
    frameId: frame.frameId,
    sequence: frame.sequence,
    keyId: frame.keyId,
    ciphertextSha256: frame.ciphertextSha256,
    ciphertextLength: frame.ciphertextLength,
    sframeHeaderSha256: frame.sframeHeaderSha256,
    workloadPublicKeyThumbprintSha256: sha256Hex(
      Buffer.from(stableJson(frame.workloadPublicKeyJwk), "utf8")
    ),
    postedFrameId: posted?.frameId || null,
    plaintextPrinted: false,
    contentPrinted: false,
    secretsPrinted: false
  };
}

async function main() {
  const args = parseArgs();
  const result = await encodeOnce(args);
  process.stdout.write(JSON.stringify(result, null, 2));
}

if (
  import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}` ||
  process.argv[1]?.endsWith("blind-e2ee-workload-frame-encoder.mjs")
) {
  main().catch((error) => {
    process.stderr.write(
      JSON.stringify(
        {
          ok: false,
          error: error.message,
          secretsPrinted: false,
          contentPrinted: false
        },
        null,
        2
      )
    );
    process.exit(1);
  });
}

export {
  ALGORITHM,
  captureFrame,
  captureRfbPng,
  decryptFrameForTest,
  encodePngRgba,
  encodeOnce,
  encryptFrame,
  parseArgs,
  safePublicJwk,
  stableJson
};
