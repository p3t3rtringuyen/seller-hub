// Real-browser measurement of the table rules (the Vitest run only checks the sizes the grid declares, jsdom has
// no layout). Needs a built Storybook and Playwright's chromium:
//   pnpm build-storybook && pnpm exec playwright install chromium && pnpm --filter @seller-hub/ui run measure
// For every entity tab it opens the "Skeleton = loaded" story, measures the loading and the loaded grid with
// getBoundingClientRect and compares them; it probes every cell for text clipped without an ellipsis; and it
// switches one grid from loading to loaded while a PerformanceObserver sums layout-shift scores (CLS).
/* global document, window, getComputedStyle */
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dist = path.join(root, "storybook-static");
if (!existsSync(path.join(dist, "index.json"))) {
  console.error("storybook-static/ not found: run `pnpm build-storybook` first.");
  process.exit(2);
}

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let file = path.join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

const measure = () => {
  const box = (el) => el?.getBoundingClientRect();
  const one = (which) => {
    const g = document.querySelector(`[data-which="${which}"] [data-testid="datagrid"]`);
    const origin = box(g).top;
    const rows = [
      ...g.querySelectorAll('tbody > tr[data-part="row"], tbody > tr[data-part="skeleton-row"]'),
    ];
    return {
      columns: [...g.querySelectorAll("thead th")].map((th) => +box(th).width.toFixed(2)),
      rowHeights: rows.map((r) => +box(r).height.toFixed(2)),
      headerHeight: +box(g.querySelector("thead")).height.toFixed(2),
      totalsHeight: +box(g.querySelector('[data-part="totals"]')).height.toFixed(2),
      toolbarHeight: +box(g.querySelector('[data-part="toolbar"]')).height.toFixed(2),
      paginationHeight: +box(g.querySelector('[data-part="pagination"]')).height.toFixed(2),
      paginationTop: +(box(g.querySelector('[data-part="pagination"]')).top - origin).toFixed(2),
      tableHeight: +box(g.querySelector("table")).height.toFixed(2),
      totalHeight: +box(g).height.toFixed(2),
    };
  };
  return { loading: one("loading"), ready: one("ready") };
};

const clipProbe = () => {
  const bad = [];
  for (const el of document.querySelectorAll('[data-which="ready"] [data-testid="datagrid"] *')) {
    const cs = getComputedStyle(el);
    if (cs.overflowX !== "hidden") continue;
    if (cs.textOverflow === "ellipsis" || cs.whiteSpace === "normal") continue;
    if (el.closest("[data-visually-hidden]")) continue;
    if (el.scrollWidth > el.clientWidth) bad.push(el.outerHTML.slice(0, 120));
  }
  return bad;
};

const entities = [
  ["campaigns", "shape-parity-campaigns"],
  ["ad groups", "shape-parity-ad-groups"],
  ["keywords", "shape-parity-keywords"],
  ["product targets", "shape-parity-product-targets"],
  ["auto targets", "shape-parity-auto-targets"],
  ["campaigns + compare", "shape-parity-compare"],
];
const result = { tabs: [], cls: null, clippedCells: 0 };
let failed = false;

for (const [label, id] of entities) {
  await page.goto(`${base}/iframe.html?id=data-grid-datagrid--${id}&viewMode=story`);
  await page.waitForSelector(
    '[data-which="ready"] [data-testid="datagrid"] tbody tr[data-part="row"]',
  );
  const m = await page.evaluate(measure);
  const clipped = await page.evaluate(clipProbe);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const checks = {
    columnWidths: same(m.loading.columns, m.ready.columns),
    rowHeights: same(m.loading.rowHeights, m.ready.rowHeights),
    rowCount: m.loading.rowHeights.length === 25 && m.ready.rowHeights.length === 25,
    header: m.loading.headerHeight === m.ready.headerHeight,
    totals: m.loading.totalsHeight === m.ready.totalsHeight,
    toolbar: m.loading.toolbarHeight === m.ready.toolbarHeight,
    pagination:
      m.loading.paginationHeight === m.ready.paginationHeight &&
      m.loading.paginationTop === m.ready.paginationTop,
    totalHeight: m.loading.totalHeight === m.ready.totalHeight,
  };
  const ok = Object.values(checks).every(Boolean) && clipped.length === 0;
  if (!ok) failed = true;
  result.clippedCells += clipped.length;
  result.tabs.push({
    tab: label,
    columns: m.ready.columns.length,
    rows: m.ready.rowHeights.length,
    rowHeight: m.ready.rowHeights[0],
    headerHeight: m.ready.headerHeight,
    totalsHeight: m.ready.totalsHeight,
    tableHeight: { loading: m.loading.tableHeight, ready: m.ready.tableHeight },
    paginationTop: { loading: m.loading.paginationTop, ready: m.ready.paginationTop },
    checks,
    clipped,
    ok,
  });
}

// Layout shift when data arrives.
await page.goto(`${base}/iframe.html?id=data-grid-datagrid--loading-to-loaded&viewMode=story`);
await page.waitForSelector('[data-testid="datagrid"][data-state="loading"]');
await page.evaluate(() => {
  window.__cls = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
  }).observe({ type: "layout-shift", buffered: false });
});
await page.getByRole("button", { name: "Data arrives" }).click();
await page.waitForSelector('[data-testid="datagrid"][data-state="ready"]');
await page.waitForTimeout(500);
result.cls = await page.evaluate(() => window.__cls);
if (result.cls !== 0) failed = true;

await browser.close();
server.close();
const out = path.join(root, "storybook-static", "measure-grid.json");
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
console.log(failed ? "MEASURE FAILED" : "MEASURE OK: shapes equal, no clipped cell, CLS 0");
process.exit(failed ? 1 : 0);
