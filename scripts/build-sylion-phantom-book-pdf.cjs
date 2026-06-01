const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const repo = path.resolve(__dirname, "..");
const input = path.join(repo, "docs", "sylion-phantom-technical-book", "KSIEGA_4_0_SYLION_PHANTOM.md");
const outDir = path.dirname(input);
const htmlPath = path.join(outDir, "KSIEGA_4_0_SYLION_PHANTOM.html");
const pdfPath = path.join(outDir, "KSIEGA_4_0_SYLION_PHANTOM.pdf");
const screenshotPath = path.join(outDir, "KSIEGA_4_0_SYLION_PHANTOM_preview.png");

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderTable(block) {
  const rows = block
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.trim());
  const header = rows[0].split("|").slice(1, -1).map((c) => inlineFormat(c.trim()));
  const bodyRows = rows.slice(2).map((row) => row.split("|").slice(1, -1).map((c) => inlineFormat(c.trim())));
  return [
    "<table>",
    "<thead><tr>" + header.map((h) => `<th>${h}</th>`).join("") + "</tr></thead>",
    "<tbody>",
    ...bodyRows.map((row) => "<tr>" + row.map((c) => `<td>${c}</td>`).join("") + "</tr>"),
    "</tbody></table>",
  ].join("\n");
}

function renderMermaid(block) {
  const lines = block.trim().split(/\r?\n/);
  const nodes = [];
  const edges = [];
  const nodeLabels = new Map();

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)(?:\["([^"]+)"\])?\s*-->\s*([A-Za-z0-9_]+)(?:\["([^"]+)"\])?/);
    if (!match) continue;
    const [, from, fromLabel, to, toLabel] = match;
    if (!nodeLabels.has(from)) nodeLabels.set(from, fromLabel || from);
    if (!nodeLabels.has(to)) nodeLabels.set(to, toLabel || to);
    edges.push([from, to]);
  }

  for (const [id, label] of nodeLabels.entries()) {
    nodes.push(`<div class="diagram-node" data-node="${escapeHtml(id)}">${inlineFormat(label)}</div>`);
  }

  if (nodes.length === 0) {
    return `<pre class="mermaid-fallback">${escapeHtml(block)}</pre>`;
  }

  const edgeText = edges.map(([from, to]) => `${from} -> ${to}`).join(" · ");
  return `<div class="diagram">${nodes.join("")}<div class="diagram-edges">${escapeHtml(edgeText)}</div></div>`;
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      closeList();
      const lang = line.slice(3).trim();
      const block = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        block.push(lines[i]);
        i += 1;
      }
      if (lang === "mermaid") {
        out.push(renderMermaid(block.join("\n")));
      } else {
        out.push(`<pre><code>${escapeHtml(block.join("\n"))}</code></pre>`);
      }
      i += 1;
      continue;
    }

    if (/^\|.+\|$/.test(line) && i + 1 < lines.length && /^\|[\s:\-|]+\|$/.test(lines[i + 1])) {
      closeList();
      const block = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && /^\|.+\|$/.test(lines[i])) {
        block.push(lines[i]);
        i += 1;
      }
      out.push(renderTable(block.join("\n")));
      continue;
    }

    if (/^# /.test(line)) {
      closeList();
      out.push(`<h1>${inlineFormat(line.slice(2).trim())}</h1>`);
    } else if (/^## /.test(line)) {
      closeList();
      out.push(`<h2>${inlineFormat(line.slice(3).trim())}</h2>`);
    } else if (/^### /.test(line)) {
      closeList();
      out.push(`<h3>${inlineFormat(line.slice(4).trim())}</h3>`);
    } else if (/^---\s*$/.test(line)) {
      closeList();
      out.push("<hr>");
    } else if (/^- /.test(line)) {
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${inlineFormat(line.slice(2).trim())}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inlineFormat(line.trim())}</p>`);
    }
    i += 1;
  }
  closeList();
  return out.join("\n");
}

const markdown = fs.readFileSync(input, "utf8");
const body = markdownToHtml(markdown);
const html = `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <title>Księga 4.0 - SYLION + PHANTOM</title>
  <style>
    @page { size: A4; margin: 14mm 14mm 16mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, "Segoe UI", Arial, sans-serif;
      color: #172033;
      background: #ffffff;
      font-size: 10.5pt;
      line-height: 1.45;
    }
    h1, h2, h3 { color: #0a2342; page-break-after: avoid; }
    h1 {
      margin: 0 0 12px;
      padding-top: 10px;
      font-size: 24pt;
      line-height: 1.05;
      letter-spacing: 0;
    }
    h2 {
      margin: 24px 0 8px;
      font-size: 15pt;
      border-bottom: 1px solid #d7dee8;
      padding-bottom: 5px;
    }
    h3 { margin: 16px 0 6px; font-size: 12pt; }
    p { margin: 7px 0; }
    ul { margin: 6px 0 9px 18px; padding: 0; }
    li { margin: 3px 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0 14px;
      page-break-inside: avoid;
      font-size: 8.8pt;
    }
    th, td {
      border: 1px solid #c9d3df;
      padding: 6px 7px;
      vertical-align: top;
    }
    th {
      background: #edf3f8;
      color: #0a2342;
      text-align: left;
      font-weight: 700;
    }
    code {
      font-family: "Cascadia Mono", Consolas, monospace;
      background: #eef2f6;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 0.92em;
    }
    pre {
      white-space: pre-wrap;
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      overflow: hidden;
      page-break-inside: avoid;
    }
    hr {
      border: 0;
      height: 2px;
      background: linear-gradient(90deg, #0a2342, #2f80ed, #25a18e);
      margin: 18px 0;
    }
    .diagram {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin: 12px 0;
      padding: 12px;
      border: 1px solid #c9d3df;
      border-radius: 10px;
      background: #f7fafc;
      page-break-inside: avoid;
    }
    .diagram-node {
      min-height: 38px;
      border: 1px solid #b7c7d6;
      border-left: 4px solid #2f80ed;
      border-radius: 7px;
      background: #ffffff;
      padding: 8px;
      font-weight: 650;
      color: #102a43;
    }
    .diagram-edges {
      grid-column: 1 / -1;
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 8pt;
      color: #52616f;
      border-top: 1px dashed #c9d3df;
      padding-top: 8px;
    }
    .mermaid-fallback {
      background: #f3f6fa;
      color: #172033;
      border: 1px solid #d7dee8;
    }
    strong { color: #081f3a; }
  </style>
</head>
<body>
${body}
</body>
</html>`;

fs.writeFileSync(htmlPath, html, "utf8");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1800 }, deviceScaleFactor: 1 });
  await page.goto(`file://${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "load" });
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: "14mm", right: "14mm", bottom: "16mm", left: "14mm" },
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:7px;color:#667085;width:100%;padding:0 14mm;">Księga 4.0 - SYLION + PHANTOM baseline techniczny</div>`,
    footerTemplate: `<div style="font-size:7px;color:#667085;width:100%;padding:0 14mm;display:flex;justify-content:space-between;"><span>2026-06-01</span><span>strona <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  await browser.close();
  const size = fs.statSync(pdfPath).size;
  console.log(JSON.stringify({ htmlPath, pdfPath, screenshotPath, pdfBytes: size }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
