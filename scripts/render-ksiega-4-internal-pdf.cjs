const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const repo = path.resolve(__dirname, "..");
const htmlPath = path.join(repo, "docs", "ksiega-4-0-internal", "KSIEGA_4_0_INTERNAL_FULL_TECHNICAL_BASELINE.html");
const pdfPath = path.join(repo, "docs", "ksiega-4-0-internal", "KSIEGA_4_0_INTERNAL_FULL_TECHNICAL_BASELINE.pdf");
const previewPath = path.join(repo, "docs", "ksiega-4-0-internal", "KSIEGA_4_0_INTERNAL_FULL_TECHNICAL_BASELINE_preview.png");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1800 }, deviceScaleFactor: 1 });
  await page.goto(`file://${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "load" });
  await page.screenshot({ path: previewPath, fullPage: false });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:7px;color:#7a1010;width:100%;padding:0 13mm;">STRICTLY INTERNAL - Księga 4.0 SYLION + PHANTOM</div>`,
    footerTemplate: `<div style="font-size:7px;color:#667085;width:100%;padding:0 13mm;display:flex;justify-content:space-between;"><span>restricted internal baseline</span><span>strona <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: "14mm", right: "13mm", bottom: "16mm", left: "13mm" },
  });
  await browser.close();
  const stat = fs.statSync(pdfPath);
  console.log(JSON.stringify({ pdfPath, previewPath, bytes: stat.size }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
