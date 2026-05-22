import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AdminApiClient } from "../services/admin-api/src/sdk/adminApiClient.js";

const baseUrl = process.env.SYLION_BASE_URL || "http://127.0.0.1:8099";
const outputDir = join(process.cwd(), "docs", "admin-panel-v2", "test-artifacts", "step3-17-operator-portal-smoke");

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error("Playwright is not installed. Run npm install first.", { cause: error });
  }
}

async function loginClient() {
  const anon = new AdminApiClient({
    baseUrl,
    correlationIdFactory: () => `corr_step3_17_operator_smoke_${crypto.randomUUID()}`
  });
  const credentialId = `cred-step3-17-smoke-${crypto.randomUUID()}`;
  const enrollment = await anon.createEnrollmentOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  await anon.verifyEnrollment({
    challengeId: enrollment.challenge.id,
    credential: { id: credentialId, publicKey: `simulated-public-key:${credentialId}` }
  });
  const loginOptions = await anon.createWebAuthnLoginOptions({
    email: "admin@sylion.local",
    password: "ChangeMe-LocalOnly-1!"
  });
  const session = await anon.verifyWebAuthnLogin({
    challengeId: loginOptions.challenge.id,
    credentialId,
    assertion: {
      signature: `simulated:${loginOptions.challenge.id}:${credentialId}`,
      signCounter: 1
    }
  });
  return anon.withToken(session.token);
}

async function seedOperator(client) {
  const tenant = await client.createTenant({ name: "Step 3.17 Browser Tenant", tier: "PRO" });
  const created = await client.createOperator({
    tenantId: tenant.tenant.id,
    displayName: "Step 3.17 Browser Operator",
    tier: "PRO"
  });
  const operatorId = created.operator.id;
  const pixel = await client.registerDevice({
    type: "pixel_grapheneos",
    serial: `pixel-browser-${crypto.randomUUID()}`,
    model: "Pixel GrapheneOS ADB lab",
    assignedOperatorId: operatorId,
    posture: { state: "adb_lab_ready", os: "GrapheneOS" }
  });
  await client.registerDevice({
    type: "laptop_web_terminal",
    serial: `laptop-browser-${crypto.randomUUID()}`,
    model: "Laptop web thin client",
    assignedOperatorId: operatorId,
    posture: { state: "browser_lab_ready" }
  });
  const session = await client.request("/operator-api/sessions/local-simulator", {
    method: "POST",
    body: {
      operatorId,
      terminalMode: "pixel_grapheneos",
      deviceId: pixel.device.id
    }
  });
  return { operatorId, operatorName: created.operator.displayName, operatorSession: session.session };
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  const { chromium } = await loadPlaywright();
  const client = await loginClient();
  const seeded = await seedOperator(client);
  const browser = await chromium.launch({ headless: true });
  const actions = [];
  const issues = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    await page.goto(`${baseUrl}/operator`, { waitUntil: "domcontentloaded" });
    await page.evaluate((payload) => {
      sessionStorage.setItem("sylion.operator.token", payload.token);
      sessionStorage.setItem("sylion.operator.session", JSON.stringify(payload.session));
    }, {
      token: seeded.operatorSession.token,
      session: seeded.operatorSession
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText(seeded.operatorName, { exact: false }).waitFor({ timeout: 10000 });
    actions.push("operator_session_loaded");

    for (const label of ["Devices", "Workload Control", "Connection Path", "Signal Preview", "VPN status", "Security Unlock", "Backup & Panic", "Jurisdiction", "Matrix Server", "FIDO2 policy", "HSM refs", "Subscription", "My audit"]) {
      await page.getByRole("link", { name: label }).click();
      await page.waitForTimeout(250);
      actions.push(`view_${label.toLowerCase().replaceAll(" ", "_")}`);
    }

    await page.getByRole("link", { name: "Workload Control" }).click();
    await page.locator('input[name="whatsapp"]').fill("2");
    await page.locator('input[name="signal"]').fill("1");
    await page.locator('input[name="zangi"]').fill("1");
    await page.locator('input[name="exodus"]').fill("1");
    await page.getByRole("button", { name: "Queue workload change" }).click();
    await page.waitForFunction(() => document.querySelector("#session-status")?.textContent?.includes("Workload control queued"));
    actions.push("operator_workload_control_queued");

    await page.getByRole("link", { name: "Security Unlock" }).click();
    await page.locator('input[name="sessionHours"]').fill("12");
    await page.locator('input[name="g1Password"]').fill("Layer passphrase local only 12345");
    await page.locator('input[name="g2Password"]').fill("Layer passphrase local only 23456");
    await page.locator('input[name="workloadPassword"]').fill("Layer passphrase local only 34567");
    await page.getByRole("button", { name: "Save unlock policy" }).click();
    await page.waitForFunction(() => document.querySelector("#session-status")?.textContent?.includes("Unlock policy saved"));
    actions.push("operator_unlock_policy_saved");

    await page.getByRole("link", { name: "Backup & Panic" }).click();
    await page.locator('input[name="backupEnabled"]').check();
    await page.locator('input[name="inactivityWipeDays"]').fill("10");
    await page.locator('input[name="data_wipeCode"]').fill("Panic level one local 12345");
    await page.getByRole("button", { name: "Save safety policy" }).click();
    await page.waitForFunction(() => document.querySelector("#session-status")?.textContent?.includes("Safety policy saved"));
    actions.push("operator_safety_policy_saved");

    await page.getByRole("link", { name: "Jurisdiction" }).click();
    await page.locator('select[name="mode"]').selectOption("scheduled");
    await page.locator('input[name="regions"]').fill("de,fi,nl");
    await page.locator('input[name="countries"]').fill("DE,FI,NL");
    await page.getByRole("button", { name: "Save jurisdiction policy" }).click();
    await page.waitForFunction(() => document.querySelector("#session-status")?.textContent?.includes("Jurisdiction policy saved"));
    actions.push("operator_jurisdiction_policy_saved");

    await page.getByRole("link", { name: "Matrix Server" }).click();
    await page.getByPlaceholder("matrix.operator.example").fill("matrix.step317.local");
    await page.getByRole("button", { name: "Request Matrix server" }).click();
    await page.waitForFunction(() => document.querySelector("#session-status")?.textContent?.includes("Matrix request queued"));
    actions.push("operator_matrix_request_queued");

    await page.getByRole("link", { name: "FIDO2 policy" }).click();
    await page.getByRole("button", { name: "Save FIDO2 policy" }).click();
    await page.waitForFunction(() => document.querySelector("#session-status")?.textContent?.includes("FIDO2 policy saved"));
    actions.push("operator_fido2_policy_saved");

    await page.getByRole("link", { name: "HSM refs" }).click();
    await page.getByPlaceholder("hsm-ref://operator/key").fill("hsm-ref://operator/browser-smoke");
    await page.getByPlaceholder("evidence://operator/hsm").fill("evidence://operator/browser-smoke");
    await page.getByRole("button", { name: "Save HSM references" }).click();
    await page.waitForFunction(() => document.querySelector("#session-status")?.textContent?.includes("HSM references saved"));
    actions.push("operator_hsm_refs_saved");

    await page.getByRole("link", { name: "Connection Path" }).click();
    await page.getByText("Communicator microVMs", { exact: true }).waitFor({ timeout: 10000 });
    await page.locator("#path-router-posture").waitFor({ state: "visible", timeout: 10000 });
    const postureText = await page.locator("#path-router-posture").innerText();
    if (!postureText.trim()) issues.push("Missing operator portal router posture value");
    const mainText = await page.locator("main").innerText();
    for (const expected of ["Connection Path", "VPN segments", "Communicator microVMs", "ipsec_ikev2"]) {
      if (!mainText.includes(expected)) issues.push(`Missing operator portal text: ${expected}`);
    }

    await page.getByRole("link", { name: "Signal Preview" }).click();
    await page.getByText("Production gates", { exact: true }).waitFor({ timeout: 10000 });
    const signalText = await page.locator("#signal-preview").innerText();
    for (const expected of ["Signal Preview", "WORKLOAD microVM preview", "CDR required for files", "real_firecracker_binary_not_configured"]) {
      if (!signalText.includes(expected)) issues.push(`Missing Signal preview text: ${expected}`);
    }

    await page.screenshot({ path: join(outputDir, "operator-portal-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(outputDir, "operator-portal-mobile.png"), fullPage: true });
  } finally {
    await browser.close();
  }

  if (issues.length) {
    throw new Error(`Operator portal smoke issues:\n${issues.join("\n")}`);
  }
  await writeFile(join(outputDir, "summary.json"), JSON.stringify({
    baseUrl,
    operatorId: seeded.operatorId,
    status: "passed",
    actions,
    issues,
    checkedAt: new Date().toISOString()
  }, null, 2));
  console.log(`Operator portal smoke completed against ${baseUrl}/operator`);
}

await run();
