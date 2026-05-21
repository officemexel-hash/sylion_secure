import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const baseUrl = (process.env.SYLION_ADMIN_URL || "http://127.0.0.1:8099/admin").replace(/\/$/, "");
const outputDir = join(process.cwd(), "docs", "admin-panel-v2", "test-artifacts", "step3-28-human-live-promotion");
const runId = `step3-28-${Date.now()}`;
const providerSecret = `step3-28-secret-never-leak-${crypto.randomUUID()}`;

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error("Playwright is not installed. Run npm install first.", { cause: error });
  }
}

async function clickButton(page, label) {
  await page.getByRole("button", { name: label, exact: true }).click();
}

async function waitForToast(page, text, timeout = 30000) {
  await page.waitForFunction((expected) => document.querySelector("#toast")?.textContent?.includes(expected), text, { timeout });
}

async function maybeCompleteStepUp(page, actionLabel) {
  const modal = page.locator("#step-up-modal");
  if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.getByRole("button", { name: "Verify FIDO2", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#step-up-modal")?.hidden === true, null, { timeout: 10000 });
    return `${actionLabel}_step_up_completed`;
  }
  return `${actionLabel}_step_up_not_required`;
}

async function clickSensitiveButton(page, label, toastText, actionLabel) {
  await clickButton(page, label);
  const stepUpAction = await maybeCompleteStepUp(page, actionLabel);
  try {
    await waitForToast(page, toastText);
  } catch (error) {
    const toast = await page.locator("#toast").innerText().catch(() => "");
    throw new Error(`Timed out waiting for toast "${toastText}" after ${label}. Current toast: "${toast}"`, { cause: error });
  }
  return stepUpAction;
}

async function fill(page, selector, value) {
  await page.locator(selector).fill(value);
}

async function setChecked(page, selector, checked) {
  await page.locator(selector).setChecked(checked);
}

async function selectValue(page, selector, value) {
  await page.locator(selector).selectOption(value);
}

async function apiInPage(page, path) {
  return page.evaluate(async (requestPath) => {
    const token = sessionStorage.getItem("sylion.admin.token");
    const response = await fetch(requestPath, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-correlation-id": `corr_step3_28_${crypto.randomUUID()}`
      }
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || `API request failed for ${requestPath}`);
    }
    return payload;
  }, path);
}

async function capture(page, fileName, options = {}) {
  const path = join(outputDir, fileName);
  try {
    await page.screenshot({ path, fullPage: options.fullPage ?? true });
  } catch (error) {
    if (!String(error?.message || "").includes("Unable to capture screenshot")) throw error;
    await page.screenshot({ path, fullPage: false });
  }
  return path;
}

async function latestByName(page, path, collectionKey, predicate) {
  const payload = await apiInPage(page, path);
  return [...(payload[collectionKey] || [])].reverse().find(predicate);
}

function assertNoSecret(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.includes(providerSecret)) {
    throw new Error(`Provider secret leaked through ${label}`);
  }
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const actions = [];
  const issues = [];
  const screenshots = [];
  let summary = {};

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    page.on("console", (message) => {
      if (message.type() === "error") issues.push(`console_error:${message.text()}`);
    });

    await page.goto(`${baseUrl}?human_step3_28=${Date.now()}`, { waitUntil: "networkidle" });
    await fill(page, "#login-form input[name='password']", "ChangeMe-LocalOnly-1!");
    await clickButton(page, "Enroll FIDO2");
    await waitForToast(page, "FIDO2 credential enrolled locally");
    await clickButton(page, "Sign In");
    await page.locator("#app-shell").waitFor({ state: "visible", timeout: 10000 });
    actions.push("admin_logged_in_with_fido2_simulator");
    screenshots.push(await capture(page, "01-overview-login.png"));

    await clickButton(page, "Operators");
    await page.locator("#tenant-form").waitFor({ state: "visible", timeout: 10000 });
    await fill(page, "#tenant-form input[name='name']", `Step 3.28 Tenant ${runId}`);
    await selectValue(page, "#tenant-form select[name='tier']", "PRO");
    await clickButton(page, "Create Tenant");
    await waitForToast(page, "Tenant created");
    const tenant = await latestByName(page, "/tenants", "tenants", (item) => item.name === `Step 3.28 Tenant ${runId}`);
    if (!tenant) throw new Error("Created tenant not found after dashboard click");
    actions.push("tenant_created_via_dashboard");

    await selectValue(page, "#operator-tenant-select", tenant.id);
    await fill(page, "#operator-form input[name='displayName']", `Step 3.28 Operator ${runId}`);
    await selectValue(page, "#operator-form select[name='tier']", "PRO");
    await clickButton(page, "Create Operator");
    await waitForToast(page, "Operator created with automatic G1/G2/WORKLOAD baseline");
    const operator = await latestByName(page, "/operators", "operators", (item) => item.displayName === `Step 3.28 Operator ${runId}`);
    if (!operator) throw new Error("Created operator not found after dashboard click");
    const pipelinesAfterOperator = await apiInPage(page, `/operator-provisioning/pipelines?operatorId=${encodeURIComponent(operator.id)}`);
    const localBaseline = [...pipelinesAfterOperator.pipelines].reverse().find((item) => item.status === "local_lab_ready");
    if (!localBaseline || localBaseline.localLab?.vps?.length !== 3) {
      throw new Error("Operator creation did not produce local G1/G2/WORKLOAD baseline");
    }
    actions.push("operator_created_with_automatic_local_baseline");
    screenshots.push(await capture(page, "02-operator-baseline.png"));

    await clickButton(page, "Providers");
    await page.locator("#provider-form").waitFor({ state: "visible", timeout: 10000 });
    await selectValue(page, "#provider-form select[name='providerType']", "hetzner");
    await fill(page, "#provider-form input[name='apiSecret']", providerSecret);
    await fill(page, "#provider-form input[name='regions']", "fsn1");
    actions.push(await clickSensitiveButton(page, "Save Provider", "Provider saved; secret cleared from form", "provider_save"));
    const provider = await latestByName(page, "/providers", "providers", (item) => item.providerKey === "hetzner");
    if (!provider) throw new Error("Created provider not found after dashboard click");
    actions.push("provider_reference_created_via_dashboard");
    screenshots.push(await capture(page, "03-provider-reference.png"));

    await clickButton(page, "Approvals");
    await page.locator("#approval-form").waitFor({ state: "visible", timeout: 10000 });
    await selectValue(page, "#approval-operator-select", operator.id);
    await fill(page, "#approval-form input[name='planId']", "");
    await fill(page, "#approval-form input[name='reasonCode']", `step3_28_live_promotion_${runId}`);
    await fill(page, "#approval-form input[name='evidenceRefs']", "release://step3-28/human-live-promotion");
    await clickButton(page, "Create Approval");
    await waitForToast(page, "Provisioning approval created");
    const approval = await latestByName(page, "/provisioning/approvals", "approvals", (item) => item.reasonCode === `step3_28_live_promotion_${runId}`);
    if (!approval) throw new Error("Created approval not found after dashboard click");
    await selectValue(page, "#approval-status-select", approval.id);
    await selectValue(page, "#approval-status-form select[name='status']", "approved_for_execution");
    await fill(page, "#approval-status-form input[name='note']", "Step 3.28 human dashboard promotion approval");
    await clickButton(page, "Update Status");
    await waitForToast(page, "Provisioning approval status updated");
    const approvalsAfterUpdate = await apiInPage(page, "/provisioning/approvals");
    const approved = approvalsAfterUpdate.approvals.find((item) => item.id === approval.id);
    if (approved?.status !== "approved_for_execution") throw new Error("Approval was not updated to approved_for_execution");
    actions.push("approval_created_and_approved_via_dashboard");
    screenshots.push(await capture(page, "04-approval-approved.png"));

    await clickButton(page, "Providers");
    await page.locator("#baseline-promotion-form").waitFor({ state: "visible", timeout: 10000 });
    await selectValue(page, "#baseline-promotion-provider-select", provider.id);
    await selectValue(page, "#baseline-promotion-operator-select", operator.id);
    await selectValue(page, "#baseline-promotion-approval-select", approval.id);
    await fill(page, "#baseline-promotion-form input[name='region']", "fsn1");
    await fill(page, "#baseline-promotion-form input[name='serverType']", "cx22");
    await fill(page, "#baseline-promotion-form input[name='image']", "ubuntu-24.04");
    await fill(page, "#baseline-promotion-form input[name='idempotencyKey']", `step3-28-promote-${runId}`);
    await setChecked(page, "#baseline-promotion-form input[name='liveConfirmed']", true);
    screenshots.push(await capture(page, "05-promote-baseline-ready.png"));
    actions.push(await clickSensitiveButton(page, "Promote Operator Baseline", "Operator baseline promotion recorded with gate decision", "baseline_promotion"));
    actions.push("baseline_promotion_submitted_via_dashboard");
    await page.waitForTimeout(750);
    screenshots.push(await capture(page, "06-promote-baseline-result.png"));

    const [requestsPayload, rollbackPayload, auditPayload] = await Promise.all([
      apiInPage(page, "/live-execution/cloud/requests"),
      apiInPage(page, "/live-execution/cloud/rollback-plans"),
      apiInPage(page, "/audit/events")
    ]);
    const request = [...requestsPayload.requests].reverse().find((item) => item.idempotencyKey === `step3-28-promote-${runId}`);
    if (!request) throw new Error("Live promotion request not found after dashboard submit");
    const rollbackPlan = rollbackPayload.plans.find((item) => item.id === request.rollbackPlanId);
    if (!rollbackPlan) throw new Error("Rollback plan not found for live promotion request");
    const relatedAudit = auditPayload.events.filter((item) => item.idempotencyKey === request.idempotencyKey || item.resourceId === request.id || item.resourceId === request.rollbackPlanId);

    if (request.operatorId !== operator.id) issues.push("promotion_request_operator_mismatch");
    if (request.providerId !== provider.id) issues.push("promotion_request_provider_mismatch");
    if (request.approvalId !== approval.id) issues.push("promotion_request_approval_mismatch");
    if (request.productionExecutionAllowed !== false) issues.push("promotion_request_production_execution_not_false");
    if (request.requestedResources?.join(",") !== "G1,G2,WORKLOAD") issues.push("promotion_request_wrong_resource_shape");
    if (rollbackPlan.actions?.length !== 3) issues.push("rollback_plan_does_not_cover_three_roles");
    if (!relatedAudit.some((item) => ["live_cloud.vps_set_blocked", "live_cloud.vps_set_created"].includes(item.action))) {
      issues.push("live_cloud_audit_event_missing");
    }
    if (!relatedAudit.some((item) => item.action === "live_cloud.rollback_plan_created")) {
      issues.push("rollback_audit_event_missing");
    }
    if (request.status === "blocked_human_gate" && request.sideEffectAllowed !== false) {
      issues.push("blocked_request_side_effect_allowed");
    }
    if (request.status === "executed_provider_mutation" && request.rollbackReady !== true) {
      issues.push("executed_request_not_rollback_ready");
    }

    await clickButton(page, "Audit");
    await page.locator("#audit-full-table").waitFor({ state: "visible", timeout: 10000 });
    screenshots.push(await capture(page, "07-audit-evidence.png"));

    const domText = await page.locator("body").innerText();
    assertNoSecret(domText, "dashboard DOM");
    assertNoSecret(requestsPayload, "live requests API");
    assertNoSecret(rollbackPayload, "rollback plans API");
    assertNoSecret(auditPayload, "audit API");

    await page.setViewportSize({ width: 390, height: 844 });
    await clickButton(page, "Providers");
    screenshots.push(await capture(page, "08-mobile-providers.png"));

    summary = {
      baseUrl,
      status: issues.length ? "failed" : "passed",
      runId,
      tenantId: tenant.id,
      operatorId: operator.id,
      providerId: provider.id,
      approvalId: approval.id,
      localBaselineId: localBaseline.id,
      liveRequestId: request.id,
      liveRequestStatus: request.status,
      liveRequestSideEffectAllowed: request.sideEffectAllowed,
      liveRequestProductionExecutionAllowed: request.productionExecutionAllowed,
      liveRequestBlockers: request.gate?.blockers || [],
      rollbackPlanId: rollbackPlan.id,
      rollbackPlanStatus: rollbackPlan.status,
      auditEvents: relatedAudit.map((item) => item.action),
      screenshots: screenshots.map((item) => item.replace(process.cwd(), ".").replaceAll("\\", "/")),
      actions,
      issues,
      secretLeakDetected: false,
      checkedAt: new Date().toISOString()
    };

    await writeFile(join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
  }

  if (issues.length) {
    await writeFile(join(outputDir, "summary.json"), JSON.stringify({ ...summary, status: "failed", issues }, null, 2));
    throw new Error(`Step 3.28 human live promotion issues:\n${issues.join("\n")}`);
  }
  console.log(`Step 3.28 human live promotion completed against ${baseUrl}`);
}

await run();
