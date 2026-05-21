import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outputDir = join(process.cwd(), "docs", "admin-panel-v2", "test-artifacts", "step3-12-live-execution-regression");
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
  const actions = [];
  try {
    await page.goto(`${baseUrl}?smoke=${Date.now()}`, { waitUntil: "networkidle" });
    await page.getByLabel("Password").fill("ChangeMe-LocalOnly-1!");
    await clickButton(page, "Enroll FIDO2");
    await clickButton(page, "Sign In");
    await page.getByText("Dashboard", { exact: true }).waitFor({ timeout: 10000 });

    await clickButton(page, "Approvals");
    await page.locator("#workload-lifecycle-allocation-select").waitFor({ state: "visible", timeout: 10000 });
    actions.push("approvals_view_loaded");

    await clickButton(page, "Overview");
    await clickButton(page, "Run Demo Flow");
    await clickButton(page, "PHANTOM");
    await page.getByText("Package Review Matrix").waitFor({ timeout: 10000 });
    actions.push("login_demo_phantom");

    await clickButton(page, "Release");
    await page.getByText("Release Gate Control").waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Index Artifact" }).click();
    await page.locator("#toast").getByText("Evidence artifact indexed", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Create Problem" }).click();
    await page.locator("#toast").getByText("Release problem recorded", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Update Test Status" }).click();
    await page.locator("#toast").getByText("Human test scenario status updated", { exact: false }).waitFor({ timeout: 10000 });
    actions.push("release_artifact_problem_human_test");

    await clickButton(page, "Providers");
    await page.getByText("Live Cloud Gate").waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Request Live VPS Set" }).click();
    await page.locator("#toast").getByText("Live cloud request recorded", { exact: false }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Qualify Host" }).click();
    await page.locator("#toast").getByText("Firecracker host qualification recorded", { exact: false }).waitFor({ timeout: 10000 });
    await page.screenshot({ path: join(outputDir, "live-execution-desktop.png"), fullPage: true });
    actions.push("live_cloud_firecracker_gates");

    await clickButton(page, "PHANTOM");
    await page.getByRole("heading", { name: "Execution Requests" }).waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Create Execution Request" }).click();
    await page.locator("#toast").getByText("PHANTOM execution request gated", { exact: false }).waitFor({ timeout: 10000 });
    actions.push("phantom_execution_request_gate");

    const views = ["Overview", "Operators", "Provisioning", "Approvals", "Subscriptions", "Devices", "Providers", "Security", "PHANTOM", "Release", "Audit"];
    for (const view of views) {
      await clickButton(page, view);
      await page.screenshot({ path: join(outputDir, `${view.toLowerCase()}-desktop.png`), fullPage: true });
    }

    await clickButton(page, "PHANTOM");
    const phantomText = await page.locator("main").innerText();
    for (const expected of ["Package Review Matrix", "Owner ack", "Evidence Coverage", "Execution Requests", "Production false"]) {
      if (!phantomText.includes(expected)) issues.push(`Missing PHANTOM dashboard text: ${expected}`);
    }

    await clickButton(page, "Release");
    const releaseText = await page.locator("main").innerText();
    for (const expected of ["Release Gate Control", "not_ready_for_production_execution", "PHANTOM execution=false", "Problem Registry", "Evidence Artifact Index", "Live Execution Proof", "Baseline locked"]) {
      if (!releaseText.includes(expected)) issues.push(`Missing release dashboard text: ${expected}`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(outputDir, "phantom-mobile.png"), fullPage: true });
    await clickButton(page, "Release");
    await page.screenshot({ path: join(outputDir, "release-mobile.png"), fullPage: true });

    await browser.close();
  } catch (error) {
    await browser.close();
    throw error;
  }
  if (issues.length) {
    throw new Error(`Dashboard smoke issues:\n${issues.join("\n")}`);
  }
  await writeFile(join(outputDir, "summary.json"), JSON.stringify({
    baseUrl,
    status: "passed",
    actions,
    issues,
    checkedAt: new Date().toISOString()
  }, null, 2));
  console.log(`Dashboard smoke completed against ${baseUrl}`);
}

await run();
