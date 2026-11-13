# P3-DS — Review (P5-REVIEW-P3-DS)

- Branch: `claude/p3-ds-306d32`, 1 commit `d7578c0` (73 files, +7994 / −31), base `52ab652`.
- Reviewer: P5-REVIEW (Opus), read-only. Inputs: `prompts/p3-design-system.md`, PLAN row P3-DS, BACKLOG §1,
  ADR-0003 (+ Gate 2 amendment), D51, D54 a, D55, conventions §9/§11, `catalog/legacy/web-ux-rules.json`, the
  branch report `docs/reports/P3-DS.md`.

## Verdict: **MERGE-AFTER-FIXES** (= `CHANGES_REQUIRED`, 3 must-fix)

The kit is well built and the default path is sound: at the comfortable density with the shipped entity
definitions, my own browser probe reproduces the author's numbers exactly (25 rows × 40 px, table 1080 px, pager at
1133 px, loading = loaded, CLS 0). But the user's explicit rule — **skeleton = loaded shape** — fails, measured, in
two configurations the kit offers to every slice (compact density with selection, wrapping columns). It also fails
on the last page. The gate cannot catch any of this: in jsdom it compares the sizes the grid *declares*, and those
come from the same token for both states. Fix those three, add the cases to the browser measurement, then merge.

## How the skeleton rule was measured (not read)

Independent probe, outside the branch: a scratch React entry bundled with esbuild from the branch sources
(`DataGrid`, `InlineEditCell`, `entities.campaigns`, `ThemeProvider`). It renders a loading grid and a loaded grid
side by side (selection on, totals on, page size 25, 1280 px wide) and measures with `getBoundingClientRect` in
Playwright chromium 1228 (viewport 1400×1000). A second mode switches one grid loading → loaded in place under a
`layout-shift` `PerformanceObserver`. Files (for the fixer): side-session notes folder
`…/side-session-notes/local_7f074d3e-…/p5-review-p3-ds-probe/` (`entry.tsx`, `run.mjs`, `diag.mjs`, `index.html`).

| Scenario | Column widths L = R | Row height loading → loaded | Table height loading → loaded | Pager top loading → loaded | Verdict |
|---|---|---|---|---|---|
| baseline (comfortable) | yes | 40 → 40 | 1080 → 1080 | 1133 → 1133 | OK |
| compare | yes | 56 → 56 | 1496 → 1496 | 1549 → 1549 | OK |
| compact + compare | yes | 48 → 48 | 1288 → 1288 | 1341 → 1341 | OK |
| narrow container 800 px | yes | 40 → 40 | 1080 → 1080 | 1133 → 1133 | OK |
| real `InlineEditCell` in Budget (comfortable) | yes | 40 → 40 | 1080 → 1080 | 1133 → 1133 | OK (content 39 px, 1 px margin) |
| **compact** (+ selection) | yes | **32 → 37.56** | **880 → 1019** | **933 → 1072** | **FAIL** (+139 px; CLS 0.008 in place) |
| **compact + InlineEditCell** | yes | **32 → 37.56** | **880 → 1019** | **933 → 1072** | **FAIL** |
| **`wrap: true` on Campaign name** | yes | **40 → 67.84** | **1080 → 1776** | **1133 → 1829** | **FAIL** (+696 px) |
| **last page, 7 of 25 rows (total known)** | yes | 40 → 40 | **1080 → 360** | **1133 → 413** | **FAIL** (pager jumps 720 px) |

Column count, ids, widths, header, toolbar, totals row and pager: equal loading vs loaded in every scenario.

Note on CLS: the in-place transition reported CLS 0 for the `wrap` case although the table grew 696 px. Skeleton
rows and data rows have different React keys (`skeleton-i` vs row id), so every row is a new node and the
layout-shift API does not count it; only the pager (when in the viewport) can register. **CLS 0 is not evidence of
parity here — compare measured heights.**

## Must fix (before merge)

### M1 — Compact density: loaded rows are 37.56 px, skeleton rows 32 px (UX-04)
- Where: `packages/ui/src/datagrid/DataGrid.tsx:108` (row height from `grid.rowHeight.compact` = 32,
  `packages/ui/src/tokens.ts`), selection checkbox `DataGrid.tsx:521-526` (`<Checkbox size="small">`).
- Failure: `density="compact"` + `selection` (the Campaign Manager configuration) → loaded row content is 36.6 px
  (MUI small checkbox: 20 px icon + 2×9 px padding), so each row grows to 37.56 px; 25 rows → table +139 px, pager
  moves 139 px when data arrives. Same with an inline-edit cell. Measured above.
- Fix: make the compact row fit its tallest control (checkbox `sx={{ p: 0.5 }}` / `padding: 4` in the grid, the
  inline-edit icon button likewise) or derive the compact token from it (≥ 38). Add compact + selection +
  InlineEditCell to the parity stories and the browser `measure` script.

### M2 — `wrap: true` columns grow rows past the skeleton (UX-02 + UX-04)
- Where: `packages/ui/src/datagrid/TruncatedText.tsx:12-17` (`wrapStyle`: no line clamp),
  `DataGrid.tsx:305` (skeleton draws `skeletonLines ?? 2` bars in a fixed 40 px row).
- Failure: any slice that declares `wrap: true` (the documented way a column "must wrap", `types.ts:23`) with text
  longer than two lines → loaded row 67.84 px vs skeleton 40 px; table +696 px on 25 rows. The skeleton promises
  2 lines but nothing caps the loaded text at 2 lines, and the row height does not budget for 2 lines either.
- Fix: clamp wrapped text to `skeletonLines` (`display: -webkit-box; -webkit-line-clamp: n; overflow: hidden`, with
  the tooltip for the full text), and compute the row height for a grid that has wrap columns from the line count
  (or forbid `wrap` without a declared line count). Add a wrap case with long text to the parity stories and
  `measure`.

### M3 — Skeleton row count ignores the known count: last page jumps (UX-04 "or the known count")
- Where: `DataGrid.tsx:195` (`dataRowCount = loading ? page.pageSize : rows.length`).
- Failure: page 13 of 312 rows (12 rows on it), or any filter returning fewer rows than `pageSize` → skeleton
  draws 25 rows, data draws 12; table shrinks and the pager jumps (measured with 7 rows: 1080 → 360 px). UX-04 says
  "Skeleton count equals page size (or the known count)". `totalRows` is in props and known on every page change
  after the first.
- Fix: while loading, draw `min(pageSize, totalRows − pageIndex·pageSize)` when `totalRows` is known (and ≥ 1);
  `pageSize` only before the first answer. Test it with a last-page story.

## Should fix (may merge with a BACKLOG follow-up)

- **S1 — The gate's parity tests cannot fail on real layout.** `packages/ui/src/stories/parity.ts:136-150` and
  `DataGrid.test.tsx` compare `data-row-height` / `data-col-width` that both states read from the same token; in
  jsdom the measured branch (`parity.ts:154`) is skipped. M1–M3 all pass the gate. The browser `measure` script
  (`packages/ui/scripts/measure-grid.mjs`) is the only real check and is not in `pnpm gate` or CI, and it covers
  comfortable density only, with no `wrap`, no inline-edit cell, no last page. Fix: extend `measure` with those
  cases and add a CI job (`build-storybook` + `measure`) — orchestrator decides where (CI is P3-SCAFFOLD's file).
- **S2 — Duplicate DOM id on pages with more than one grid.** `GridPagination.tsx:229,237`
  `id="rows-per-page-label"` is static; two grids on one page (the parity stories already have two; dashboards will)
  → duplicate id, every page-size select is labelled by the first one (axe `duplicate-id-aria`). Measured: the probe
  page reports `dupIds: ["rows-per-page-label"]`. Fix: `useId()`.
- **S3 — Shell copy is in TypeScript, not in a message catalogue (conventions §9).** `apps/web/app/(shell)/messages.ts`
  holds the section headings, brand, "Home", "Sign out"; `packages/ui/src/messages.tsx` holds the kit's English
  defaults (that one is acceptable: overridable through `UiMessagesProvider`). §9 puts UI copy in
  `apps/web/messages/<locale>/<module>.json`; a `shell.json` (or `platform.shell.json`) read through the same
  generated `messagesByLocale` the nav already uses (`nav.ts:3`) keeps `vi` possible later.
- **S4 — Inline edit ignores the currency exponent.** `InlineEditCell.tsx:131` calls `sanitizeNumeric(kind, …)`
  with the default 2 decimals; `MoneyField` passes `currencyDecimals(currency)` but `InlineEditCell` has no
  `currency` / `decimals` prop. A JPY bid (Amazon JP bids are whole yen) accepts `12.5`. Fix: add `currency`
  (or `decimals`) and pass it through.
- **S5 — No "select all matching the filter".** BACKLOG Gate 2 amendment (bulk slice) needs selection kept across
  pages and tabs (OK: `GridSelection` is owner state, max enforced at tick, `DataGrid.tsx:160-186`) and selection
  "all matching the filter" resolved server-side to the cap (300 / 100). The grid offers only per-row and per-page
  ticks; there is no affordance or state for "all N matching". Can come with the bulk slice, but the kit is where it
  belongs (UX-22 "solve once") — record as a follow-up for P3-DS or the bulk slice.
- **S6 — Bulk bar pushes the table down.** `DataGrid.tsx:406` inserts `bulkBar` between the toolbar and the table;
  `BulkActionBar` returns `null` at 0 selected (`BulkActionBar.tsx:46`). The first tick moves every row ~40 px under
  the pointer. Reserve the space or overlay the bar on the toolbar.

## Nits

- `DataGrid.tsx:552` totals alignment uses `def.numeric` while cells use `def.numeric && !def.exempt` (`:268,279`):
  an exempt numeric column with a total would right-align the total but left-align the cells.
- `GridColumn.width` is fixed: no column resize (UX-10 lists move/pin/resize). Not in the prompt; note for UX-10 gaps.
- UX-10 "move/pin disabled on touch pointers" not implemented (author reports it).
- Root `tsconfig.json`: adding `DOM` lib to the project that type-checks `scripts/` and `tools/` (Node code) hides
  accidental browser globals there; a `.storybook/tsconfig.json` would scope it. Harmless today.
- `.storybook/main.ts` resolves the a11y addon from `process.cwd()`; it works only when Storybook runs from the
  repo root (all scripts do). The author already asks to hoist `@storybook/addon-a11y` to the root (request 4).
- `apps/web/app/page.tsx:6` still says "The app shell arrives with P3-DS" (not this task's file; orchestrator).

## Ownership (PLAN row: `packages/ui/**`, `apps/web/app/(shell)/**`, `apps/web/app/(app)/layout.tsx`, shell code reading the registries; BACKLOG §1.3 adds `apps/web/app/layout.tsx`, `.storybook/**`)

| File outside the PLAN row | Judgement |
|---|---|
| `apps/web/app/layout.tsx` | **In scope** — BACKLOG §1.3 gives the root layout to P3-DS; the scaffold's comment said so. Change is minimal (emotion SSR cache, `InitColorSchemeScript`, `Providers`). |
| `.storybook/main.ts`, `.storybook/preview.ts` | **In scope** — BACKLOG §1.3 lists `.storybook/**` under P3-DS; the scaffold's comments anticipated it. |
| `apps/web/next.config.ts` (+1 line `@seller-hub/ui` in `transpilePackages`) | **Necessary** — the package is source-only; without it `next build` fails. Acceptable. |
| `apps/web/package.json` (`@seller-hub/ui`, MUI, emotion deps) | **Necessary** — the web app imports them (`layout.tsx`, `AppRouterCacheProvider`). Acceptable; pinned versions should move to the workspace catalog (author request 1, orchestrator). |
| `tsconfig.json` (root: `jsx`, DOM lib) | **Necessary** for root `tsc` to follow `.storybook` → `packages/ui`; acceptable, see nit. |
| `pnpm-lock.yaml` | **Expected**. Overlaps with P3-CLIENTS → second merge regenerates with `pnpm install` (STATUS). |
| `docs/reports/P3-DS.md` | Own report. |

No other file outside OWNED_PATHS. All out-of-row changes are reported in the author's report.

## Other checks

- **Components vs what slices need:** data grid — column chooser with show/hide, Show all, drag + up/down
  reorder, pin left/right, Total row (present while loading), compare row, server paging/sort, filter bar (search,
  metric thresholds, quick chips), selection across pages with max at tick time, bulk bar with confirm dialog per
  action, inline edit ("Not saved" keeps the value), empty row, in-place error with Retry; KPI card, time-series
  chart (compare dashed, gaps not zeros); date range with presets + compare + future days blocked; Money / Integer /
  Percent / Search / MultiSelect / StatusChip fields (no `type="number"`); EmptyState, ErrorCard, toasts (partial
  = warning), ConfirmDialog, Modal; URL chain helpers (pure). Gaps: S5 (select all matching), column resize (nit).
- **Shell from registries:** `AppFrame.tsx:6,22` builds the sidebar from `nav.generated.ts` filtered by permission;
  `SlotOutlet.tsx:3` renders `slots.generated.ts` for `shell.header.actions` / `shell.sidebar.footer`; nav labels
  from the slice message file (`nav.ts:11-15`). Tested in `shell.test.tsx` (grouping/order, permission filter and
  nothing while loading, labels, breadcrumbs, render of a registered entry). OK.
- **Permissions (D55):** `PermissionProvider` / `useCan` / `PermissionGate` hide or lock; every check false while
  loading; `BulkActionBar` hides without permission. Role → permission mapping is P3-IDENTITY's; the session is a
  typed stub (`session.ts`) granting what the nav asks — clearly labelled. OK.
- **a11y basics:** skip link + `main#main-content`, `nav` landmarks with labels, `aria-sort` on headers, sort as
  buttons, `aria-busy` on the loading table, checkbox labels, live region for the selection count. Axe runs only
  in the Storybook panel, not in the gate (author reports it). S2 is the one defect found.
- **No Amazon branding (D51):** neutral palette and name `seller-hub`; no Amazon logo, colours (`#ff9900`,
  `#232f3e`) or names in UI copy. Marketplace ids in the stub are data. OK.
- **Copy in catalogues (§9):** kit strings go through `useMessages` with overrides; shell copy in TS → S3.
- **Feature imports through `public.ts`:** the branch adds no feature-to-feature import (only `features/example`
  exists). The lint rule enforcing it is still missing — P3-SCAFFOLD/orchestrator follow-up, not this task.
- **Clean room (D0):** author states no legacy source opened; nothing Yes4All-specific found in the diff.
- **ADR-0003:** MUI 7 core + emotion + TanStack Table v8 + Recharts, own `DataGrid`, no MUI X. TanStack Virtual,
  `nuqs`, react-hook-form are not used yet — they belong to pages (URL wiring, forms) per the ADR's own split.
  Consistent.
- Tenancy, secrets/PII, Amazon usage, migrations, contracts: not applicable (UI kit and shell, no data access).

## Gate (re-run in the worktree)

Run from `.claude/worktrees/p3-ds-306d32` with `COMPOSE_PROJECT_NAME=sellerhub_p5ds SH_PORT_OFFSET=600
SH_ENV_FILE=.env.example SH_REQUIRE_DB=1`: `pnpm stack:up && pnpm gate` → **exit 0**. gen/lint/typecheck/test/build
all green (turbo 12/12). Tests: ui 120, web 12, api 13, core 9, config 10, mod-example 9, worker 7, testing 7,
contracts 4, metrics 3, db 2 (DB required, not skipped), tools 19. Then `pnpm stack:down` (sellerhub_p5ds removed;
`ads-api-cache-1` and the other sellerhub_* stacks untouched). Worktree left clean (`git status` empty).

Not re-run: the author's `build-storybook` + `measure` (my independent probe reproduces its baseline numbers
exactly, see the table above). `pnpm e2e`: no shell spec exists.

**Gate green does not clear M1–M3**: see S1.

## Follow-ups for BACKLOG (if merged after M1–M3)

1. S1 — browser `measure` in CI with compact / wrap / inline-edit / last-page cases.
2. S5 — "select all matching the filter" state in `DataGrid` + `BulkActionBar` (cap 300 / 100).
3. S3 — move shell copy to `apps/web/messages/en/…json`.
4. S4 — currency exponent in `InlineEditCell`.
5. Lint rule: web features import each other only through `public.ts` (P3-SCAFFOLD carry-over).
6. Catalog versions for MUI / emotion / TanStack / Recharts; ESLint browser globals + hooks rules for
   `packages/ui/**` (author requests 1, 2).

---

## Re-review (2026-11-13) — commit `bce9210` (15 files, +613 / −84, on top of `d7578c0`)

### Verdict: **MERGE** (= `APPROVE`). M1–M3 are fixed and measured. The QA fixes are in the code. No new blocker.

### M1–M3: fix, test, would the test fail without the fix

| | Fix | Gate test (jsdom, `rowSizing.test.tsx`) | Browser test (`measure`, new stories) | Fails on `d7578c0`? |
|---|---|---|---|---|
| M1 compact | `Checkbox sx={{ p: 0.5 }}` (`DataGrid.tsx`), `IconButton p: 0.5` (`InlineEditCell.tsx`) | compares the declared 32 px in both states. **It would pass without the fix**, because the declared height was already 32 in both | "compact + selection", "compact + inline edit", "compact + compare + inline edit" compare `getBoundingClientRect` heights loading vs loaded | **Yes, browser only.** My probe on `d7578c0` measured 32 → 37.56 px in the same configuration; on `bce9210` it measures 32 → 32 |
| M2 wrap | `wrapStyle(lines)` clamps text to `skeletonLines` (`TruncatedText.tsx`); `rowHeightFor()` budgets `lines × 18 + 13` (`rowSizing.ts`) → 49 px for 2 lines | asserts 49 px in both states, plus `-webkit-line-clamp: 2` and 2 skeleton bars. Would fail without the fix (declared 40, no clamp) | "wrapping column", "wrap + compact + compare" | Yes, in both. Probe: was 40 → 67.84; now 49 → 49 |
| M3 last page | `skeletonRowCount(pageSize, pageIndex, totalRows)` (`rowSizing.ts`), used at `DataGrid.tsx` `dataRowCount` | 12 rows in both states on page 13 of 312; unknown total still gives 25. Would fail without the fix (25 vs 12) | "last page (12 rows)", "last page + compact + wrap + inline edit", "total unknown" | Yes, in both. Probe with a known total: was 25 → 7 rows; now 7 → 7 (table 360 = 360) |

My independent probe (same scratch harness as the first review, now with a known total on the last page) on `bce9210`.
Loading = loaded in every case. Rows/row height/table height/pager top: baseline 25/40/1080/1133; compact
25/32/880/933; compact + compare 25/48/1288/1341; compare 25/56/1496/1549; wrap 25/49/1314/1367; inline edit
25/40; compact + inline edit 25/32/880/933; last page 7, known total, 7/40/360/413; last page + compact + wrap +
inline edit 7/49/432/485; container 800 px 25/40. The last page with an *unknown* total still draws 25 rows, which
is correct (UX-04: page size before the first answer).

**Residual (S1, carried):** M1's only failing-without-fix test is the browser `measure`, which is still outside
`pnpm gate` and CI. Add a CI job for `build-storybook` + `measure` (orchestrator/CI owner). Follow-up, not blocking.

### QA fixes (code check; the P5-QA session re-measures them in the browser)

- **Visible focus on the shell sidebar button.** `theme.tsx`: `MuiButtonBase` `&.Mui-focusVisible` gets a 2 px
  primary outline, and `MuiCssBaseline` gives one to `a, button, [tabindex], [role=button]:focus-visible`. Sortable
  headers keep `all: unset` but add `&:focus-visible` (`DataGrid.tsx`). The menu toggle is a MUI `IconButton`
  (`AppShell.tsx:132`), so the ButtonBase rule covers it. `measure` checks the computed outline after a real Tab
  on the nav link, the header sort button, the pager and the menu toggle: all `ok`.
- **Accessible name on the grid select.** `GridPagination.tsx`: `useId()` + `labelId` (replaces the static id = S2).
  The test finds 2 comboboxes named "Rows per page" with two grids, and every id unique. axe finds no violations in
  three stories (`region`, `landmark-one-main` and `page-has-heading-one` are disabled there, as story-iframe
  artefacts).
- **Landmarks.** `AppShell` owns the only `<main>`. `apps/web/app/(app)/example/page.tsx` drops `<main>` for a
  `<div>`. `shell.test.tsx` adds a test that no file under `app/(app)` contains `<main` and that exactly one
  `main` role wraps the page.

### Ownership of the fix commit

New outside the PLAN row: `apps/web/app/(app)/example/page.tsx`, the example slice's page from P3-SCAFFOLD. The
change is one tag, needed for the single-`main` QA fix. **Acceptable**, but name it to the orchestrator.
`packages/ui/package.json` adds `axe-core 4.10.3` (dev) and `pnpm-lock.yaml` changes with it: expected. Everything
else is in `packages/ui/**`, `apps/web/app/(shell)/**` and the task's report.

### New nits (non-blocking)

- `rowSizing.ts`: `LINE_HEIGHT` 18 / `CELL_VERTICAL` 13 are constants, not tokens in `tokens.ts` with the rest of
  the grid geometry. A theme font-size change would need both kept in step. The browser `measure` would catch drift.
- `skeletonRowCount` uses the previous `totalRows` on a filter or search change. If the new answer has a different
  count, rows still change once. That cannot be avoided without the count; page change (the common case) is exact.
- The compact in-place transition reports CLS 4.7e-6 in my probe (0 in `measure`, which runs comfortable only).
  This is sub-pixel and has no visible effect.
- First-review S3 (shell copy in TS), S5 (select all matching), S6 (bulk bar pushes the table) are unchanged.
  S4 is partly fixed: `InlineEditCell` now takes `decimals`; the caller must pass the currency exponent. These are
  BACKLOG follow-ups as listed above.

### Gate (re-run, Docker down — DB/Redis part SKIPPED)

From `.claude/worktrees/p3-ds-306d32` at `bce9210`, with `COMPOSE_PROJECT_NAME=sellerhub_p5ds SH_PORT_OFFSET=600
SH_ENV_FILE=.env.example`. The stack was not started (Docker Desktop down, per the orchestrator).
- `pnpm install --frozen-lockfile`: lockfile up to date.
- `pnpm gate` → **exit 0**. Tests: ui 141 (was 120), web 14 (was 12), config 10, core 9, contracts 4, metrics 3,
  db 2, tools 19, worker 6 + 1 skipped, mod-example 3 + 6 skipped, testing 2 + 5 skipped, api 4 + 9 skipped.
- **SKIPPED: 21 DB/Redis tests** (worker 1, mod-example 6, testing 5, api 9) — "no test database / no Redis
  reachable". They passed in the first review's run with the stack (`d7578c0`). This commit does not touch
  any DB/Redis code.
- `pnpm build-storybook` → exit 0. `pnpm --filter @seller-hub/ui run measure` → exit 0, `MEASURE OK`: 14/14 shape
  configurations ok, CLS 0, 4/4 focus cases ok, axe 0 violations on 3 stories (APP_URL not set: app-page axe not run).
- Worktree left clean (`git status` empty).
