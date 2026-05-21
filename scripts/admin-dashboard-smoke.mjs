import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const outputDir = join(process.cwd(), "docs", "admin-panel-v2", "test-artifacts", "step3-10-dashboard-smoke");
const baseUrl = process.env.SYLION_ADMIN_URL || "http://127.0.0.1:8099/admin";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error("Playwright is not installed. Use the Codex browser skill for in-app testing, or install Playwright before running npm run test:dashboard.", { cause: error });
  }
}

async function clickButton(page, label) {
  await page.getByRole("button", { name: label }).click();
}

async function run() {
  const { chromium } = await loadPlaywright();
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const issues = [];
  try {
    await page.goto(`${baseUrl}?smoke=${Date.now()}`, { waitUntil: "networkidle" });
    await page.getByLabel("Password").fill("ChangeMe-LocalOnly-1!");
    await clickButton(page, "Enroll FIDO2");
    await clickButton(page, "Sign In");
    await page.getByText("Dashboard", { exact: true }).waitFor({ timeout: 10000 });

    await clickButton(page, "Approvals");
    const emptyLifecycle = await page.locator("#workload-lifecycle-allocation-select").inputValue();
    if (emptyLifecycle) issues.push(`Lifecycle allocation select should be empty before demo flow, got: ${emptyLifecycle}`);

    await clickButton(page, "Overview");
    await clickButton(page, "Run Demo Flow");
    await clickButton(page, "PHANTOM");
    await page.getByText("Package Review Matrix").waitFor({ timeout: 10000 });

    const views = ["Overview", "Operators", "Provisioning", "Approvals", "Subscriptions", "Devices", "Providers", "Security", "PHANTOM", "Audit"];
    for (const view of views) {
      await clickButton(page, view);
      await page.screenshot({ path: join(outputDir, `${view.toLowerCase()}-desktop.png`), fullPage: true });
    }

    await clickButton(page, "PHANTOM");
    const phantomText = await page.locator("main").innerText();
    for (const expected of ["Package Review Matrix", "Owner ack", "Evidence Coverage", "Execution", "false"]) {
      if (!phantomText.includes(expected)) issues.push(`Missing PHANTOM dashboard text: ${expected}`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(outputDir, "phantom-mobile.png"), fullPage: true });

    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
  if (issues.length) {
    throw new Error(`Dashboard smoke issues:\n${issues.join("\n")}`);
  }
  console.log(`Dashboard smoke completed against ${baseUrl}`);
}

await run();
