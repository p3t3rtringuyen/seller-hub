// Real-browser measurement of the table rules (the Vitest run only checks the sizes the grid declares, jsdom has
// no layout). Needs a built Storybook and Playwright's chromium:
//   pnpm build-storybook && pnpm exec playwright install chromium && pnpm --filter @seller-hub/ui run measure
// For every entity tab it opens the "Skeleton = loaded" story, measures the loading and the loaded grid with
// getBoundingClientRect and compares them; it probes every cell for text clipped without an ellipsis; and it
// switches one grid from loading to loaded while a PerformanceObserver sums layout-shift scores (CLS).
/* global document, window, getComputedStyle */
import { createRequire } from "node:module";
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

// [label, story id, expected body rows]. The first six are the entity tabs; the rest are the configurations the
// review found outside them: compact density, wrapping columns, inline-edit cells, the last page, unknown total.
const entities = [
  ["campaigns", "shape-parity-campaigns", 25],
  ["ad groups", "shape-parity-ad-groups", 25],
  ["keywords", "shape-parity-keywords", 25],
  ["product targets", "shape-parity-product-targets", 25],
  ["auto targets", "shape-parity-auto-targets", 25],
  ["campaigns + compare", "shape-parity-compare", 25],
  ["compact + selection", "shape-parity-compact", 25],
  ["compact + inline edit", "shape-parity-compact-inline-edit", 25],
  ["compact + compare + inline edit", "shape-parity-compact-compare", 25],
  ["wrapping column", "shape-parity-wrap", 25],
  ["wrap + compact + compare", "shape-parity-wrap-compact-compare", 25],
  ["last page (12 rows)", "shape-parity-last-page", 12],
  ["last page + compact + wrap + inline edit", "shape-parity-last-page-compact-wrap", 12],
  ["total unknown", "shape-parity-unknown-total", 25],
];
const result = { tabs: [], cls: null, clippedCells: 0, focus: [], axe: [] };
let failed = false;

for (const [label, id, expectedRows] of entities) {
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
    rowCount:
      m.loading.rowHeights.length === expectedRows && m.ready.rowHeights.length === expectedRows,
    header: m.loading.headerHeight === m.ready.headerHeight,
    totals: m.loading.totalsHeight === m.ready.totalsHeight,
    toolbar: m.loading.toolbarHeight === m.ready.toolbarHeight,
    pagination:
      m.loading.paginationHeight === m.ready.paginationHeight &&
      m.loading.paginationTop === m.ready.paginationTop,
    tableHeight: m.loading.tableHeight === m.ready.tableHeight,
    totalHeight: m.loading.totalHeight === m.ready.totalHeight,
  };
  const ok = Object.values(checks).every(Boolean) && clipped.length === 0;
  if (!ok) failed = true;
  result.clippedCells += clipped.length;
  result.tabs.push({
    tab: label,
    columns: m.ready.columns.length,
    rows: { loading: m.loading.rowHeights.length, ready: m.ready.rowHeights.length },
    rowHeight: { loading: m.loading.rowHeights[0], ready: m.ready.rowHeights[0] },
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

// Keyboard focus is visible everywhere: tab to a control and read its computed outline.
const focusRing = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const visible =
    (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
    (cs.boxShadow && cs.boxShadow !== "none");
  return {
    tag: el.tagName,
    label: el.getAttribute("aria-label") ?? el.textContent?.slice(0, 30),
    visible,
  };
};
const tabTo = async (pg, pick, max = 25) => {
  for (let i = 0; i < max; i++) {
    await pg.keyboard.press("Tab");
    const hit = await pg.evaluate(pick);
    if (hit) return pg.evaluate(focusRing);
  }
  return null;
};
const focusCases = [
  [
    "shell: nav link",
    "shell-appshell--default",
    () => document.activeElement?.tagName === "A" && document.activeElement.closest("nav") !== null,
  ],
  [
    "grid: sortable header button",
    "data-grid-datagrid--campaigns",
    () =>
      document.activeElement?.closest("th") !== null &&
      document.activeElement?.tagName === "BUTTON",
  ],
  [
    "grid: pager button",
    "data-grid-datagrid--campaigns",
    () => document.activeElement?.getAttribute("aria-label") === "Next page",
  ],
];
for (const [label, id, pick] of focusCases) {
  await page.goto(`${base}/iframe.html?id=${id}&viewMode=story`);
  await page.waitForSelector('[data-testid="sidebar"], [data-testid="datagrid"]');
  const ring = await tabTo(page, pick, 40);
  const ok = Boolean(ring?.visible);
  if (!ok) failed = true;
  result.focus.push({ label, ring, ok });
}

// The menu toggle (the QA failure): reach it with the keyboard, then read its ring. The story's play function has
// already expanded the menu, so the first Tab lands on a link; Shift+Tab goes back to the toggle button.
{
  await page.goto(`${base}/iframe.html?id=shell-appshell--default&viewMode=story`);
  await page.waitForSelector('[data-testid="sidebar"]');
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const ring = await page.evaluate(focusRing);
  const ok = Boolean(ring?.visible) && /menu/.test(ring?.label ?? "");
  if (!ok) failed = true;
  result.focus.push({ label: "shell: menu toggle button", ring, ok });
}

// axe-core on the stories (iframe artefacts excluded: a story has no page landmarks) and, when APP_URL is set,
// on the real app page (all rules).
const axeSource = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const runAxe = async (pg, rules) => {
  await pg.addScriptTag({ path: axeSource });
  return pg.evaluate(async (disabled) => {
    const r = await window.axe.run(document, {
      rules: Object.fromEntries(disabled.map((id) => [id, { enabled: false }])),
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      sample: v.nodes[0]?.target,
    }));
  }, rules);
};
const storyArtefacts = ["region", "landmark-one-main", "page-has-heading-one"];
for (const id of [
  "data-grid-datagrid--campaigns",
  "data-grid-datagrid--shape-parity-campaigns",
  "shell-appshell--default",
]) {
  await page.goto(`${base}/iframe.html?id=${id}&viewMode=story`);
  await page.waitForSelector('[data-testid="sidebar"], [data-testid="datagrid"]');
  const violations = await runAxe(page, storyArtefacts);
  if (violations.length) failed = true;
  result.axe.push({ target: id, violations });
}
if (process.env.APP_URL) {
  await page.goto(`${process.env.APP_URL}/example`);
  await page.waitForSelector('[data-testid="sidebar"]');
  const violations = await runAxe(page, []);
  if (violations.length) failed = true;
  result.axe.push({ target: `${process.env.APP_URL}/example`, violations });
  const ring = await tabTo(page, () => document.activeElement?.tagName === "A", 12);
  const ok = Boolean(ring?.visible);
  if (!ok) failed = true;
  result.focus.push({ label: "app: first link", ring, ok });
}

await browser.close();
server.close();
const out = path.join(root, "storybook-static", "measure-grid.json");
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
console.log(failed ? "MEASURE FAILED" : "MEASURE OK: shapes equal, no clipped cell, CLS 0");
process.exit(failed ? 1 : 0);
