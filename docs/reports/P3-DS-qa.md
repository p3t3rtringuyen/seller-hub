# P3-DS — QA run (P5-QA-P3-DS)

Branch checked: worktree `claude/p5-qa-ds-dcb574`, HEAD `d7578c0` (the P3-DS commit, `feat(ui): design system, data grid and app shell (P3-DS)`).
Stack: `COMPOSE_PROJECT_NAME=sellerhub_p5qads`, `SH_PORT_OFFSET=700`, `SH_ENV_FILE=.env.example` (ports: PG 56132, Redis 57079, MinIO 59700, API 4800, web 3800).
Code not changed; nothing committed. `ads-api-cache-1` and the `sellerhub_p5clients` stack were not touched.

## Commands and results

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | OK (Done in 1m 34s) |
| `pnpm stack:up`, `db:migrate` (15 applied), `db:seed` | OK, stack healthy |
| `pnpm test:integration` (`SH_REQUIRE_DB=1`, DB and Redis required, so no DB test skipped) | **exit 0**. ui 4 files / 120 tests; web 3 files / 12 tests; core, contracts, metrics, db, worker, mod-example, testing, api, config all green; tools 19 tests (registry 10, contracts 9) green |
| `pnpm build-storybook` | **exit 0** (66 stories indexed, `storybook-static/`) |
| `pnpm --filter @seller-hub/ui run measure` | `MEASURE OK: shapes equal, no clipped cell, CLS 0` |
| `pnpm e2e` (Playwright, chromium, starts web dev) | **3 passed** (smoke: home, `/example` registries, BFF 501 problem) |

Storybook and the app were served locally (`127.0.0.1:6706` static Storybook, `127.0.0.1:3800` web dev) for the browser pane.

## Checklist

Legend: PASS / FAIL / NOT RUN. "jsdom" = the story's `play` interaction test run by Vitest (`composeStories().run()`), not a real browser.

### 1. Table skeleton = real table shape

Measured with `getBoundingClientRect` in the built Storybook (`measure` probe, viewport 1400, pageSize 25) and re-checked in the browser pane (`campaigns-loading` vs `campaigns`, `keywords-loading` vs `keywords`).

| Table | Columns | Body rows (skel. / loaded) | Row h (skel. / loaded) | Header / Total h | Table h (skel. → loaded) | Pager top (skel. → loaded) | Clipped | Result |
|---|---|---|---|---|---|---|---|---|
| campaigns (browser) | 12 | 25 / 25 | 40 / 40 | 40 / 40 | 1080 → 1080 | — | 0 | PASS |
| keywords (browser) | 12 | 25 / 25 | 40 / 40 | 40 / 40 | 1080 → 1080 | — | 0 | PASS |
| ad groups (probe) | 11 | 25 / 25 | 40 / 40 | 40 / 40 | 1080 → 1080 | 1133 → 1133 | 0 | PASS |
| product targets (probe) | 12 | 25 / 25 | 40 / 40 | 40 / 40 | 1080 → 1080 | 1133 → 1133 | 0 | PASS |
| auto targets (probe) | 10 | 25 / 25 | 40 / 40 | 40 / 40 | 1080 → 1080 | 1133 → 1133 | 0 | PASS |
| campaigns + compare (probe) | 12 | 25 / 25 | 56 / 56 | 40 / 56 | 1496 → 1496 | 1549 → 1549 | 0 | PASS |

- Column widths (px, browser, campaigns): `44,280,110,92,140,120,96,88,108,108,92,92` — identical in the skeleton and the loaded table. keywords: `44,260,104,220,180,100,120,120,96,108,108,92` in both. Probe checks `columnWidths, rowHeights, rowCount, header, totals, toolbar, pagination, totalHeight` all true for all six tables.
- Layout shift while switching loading → loaded: CLS **0**.
- Toolbar, Total row and pager are present in the skeleton (`Rows per page` text present, Total row present).
- Note: the browser check covers two loading stories (campaigns, keywords). Ad groups, product/auto targets are checked by the probe only (the probe compares loading vs loaded for the same entity config).

### 2. Grid features, panels and states

| Item | Result | Evidence |
|---|---|---|
| Column chooser / pin / hide | PASS (jsdom) | `ColumnChooserFlow`, `PinnedAndHiddenColumns`, `ColumnChooserStandalone` stories pass |
| Totals row | PASS (jsdom + browser presence) | Total row found in the browser on campaigns (`Total` text, 40 px) |
| Compare columns | PASS (jsdom + probe) | `WithCompare`, `ShapeParityCompare` pass; compare row height 56 |
| Filters | PASS (jsdom) | `Filters` story (search, metric thresholds, quick chips) passes |
| Bulk select across pages | PASS (jsdom) | `SelectionAcrossPages` passes. Cap in the story is `maxSelection: 30`. The brief's cap of 300 / 100 is **not** in the kit: NOT RUN for those numbers, needs a decision (which cap is the rule) |
| Sort + paging | PASS (jsdom) | `SortAndPage` passes |
| Inline edit (keeps typed value on failure) | PASS (jsdom) | `InlineEdit`, `InlineEditFailureKeepsValue` pass |
| Date presets / custom / future-days blocked | PASS (jsdom) | `DateRangeCompare` default, custom-only, future-days-blocked stories pass |
| KPI cards (fixed box loading / ready) | PASS (jsdom) | `KpiCards…` ready, loading, no-data, same-box stories pass |
| Chart (compare overlay, gaps) | PASS (jsdom) | `chart`, `chart-loading`, `chart-empty` stories pass |
| Modal / confirm dialog | PASS (jsdom) | `Confirm`, `ModalForm` stories pass |
| Toast (partial = warning with counts) | PASS (jsdom) | `Toasts` story passes |
| Empty state | PASS (jsdom) | `Empty`, `EmptyDefaultMessage` stories pass |
| Error state (ErrorCard, Retry) | PASS (jsdom) | `ErrorState`, `error` stories pass |
| Partial failure from the API, throttled call, cross-tenant user | NOT RUN | No live API call in the kit; the Storybook stories use fixtures. The API and the tenant isolation are other slices' tests |
| Visual check of the panels in a real browser | NOT RUN | Only the grid tables were walked in the browser pane; the panels were checked through the jsdom story tests |

### 3. App shell

| Item | Result | Evidence |
|---|---|---|
| Nav items render from the generated registry | PASS | Browser `/example`: nav shows `Example` (registry entry, `/example`, from `nav.generated.ts`) and `Home`; breadcrumbs `Home / Example`; `h1` "Example"; skip link present |
| Slots render from the generated registry | NOT RUN in browser | No `data-slot` elements in the DOM on `/example`; the registry's slots are covered by `AppFrame` unit test (`apps/web` shell test, PASS) |
| Permission-locked item hidden for a lower role | PASS (unit) / NOT RUN (browser) | `apps/web/app/(shell)/shell.test.tsx` "offers only entries the user may open, and nothing while roles load" passes. In the browser the session stub grants every permission the registry asks for, so a lower role cannot be shown there |
| Context switcher (tenant / seller account / marketplace) | PASS (browser) | `Demo seller account`, `United States` visible in the header; switching state covered by `Switching` story (jsdom PASS) |

### 4. Keyboard focus and accessibility

| Item | Result | Evidence |
|---|---|---|
| Keyboard focus visible (app shell) | **FAIL** | `/example`: after two Tab presses the focused element is the sidebar `Expand menu` button (`BUTTON`), `:focus-visible` matches, but computed `outline-style: none`, `outline-width: 0px`, `box-shadow: none`, `background-color: rgba(0,0,0,0)`, `border: 0px`, `::after` outline none. No visible focus indicator was measured. The nav link `/example` has `tabIndex` 0 and no outline either; the focus style of the other shell controls was not measured. |
| Keyboard focus visible (grid) | NOT RUN | Not walked |
| a11y: axe-core 4.14.0 on Storybook `shell-appshell--default` | 1 violation (moderate, `region`) | Story iframe has no landmarks; treated as a story artefact |
| a11y: axe on Storybook `data-grid-datagrid--campaigns` | 4 violations: **1 serious `aria-input-field-name`** on `.MuiSelect-select` (`role=combobox` with no accessible name); 3 moderate (`region` x4 nodes, `landmark-one-main`, `page-has-heading-one`) | The serious one is real: the grid's select has no label. The landmark/heading ones are artefacts of the isolated story iframe |
| a11y: axe on app `/example` | 3 violations, all moderate: `landmark-main-is-top-level`, `landmark-no-duplicate-main`, `landmark-unique` | Real: the page has a `main` landmark problem (nested or duplicate `main` in the shell) |
| Storybook a11y addon run | NOT RUN | The addon panel was not read; axe was run directly with the same engine (axe-core 4.14.0). The Vitest runner does not run axe (as in the P3-DS report) |

## Failures (steps to reproduce)

1. **Keyboard focus not visible on the sidebar toggle.** Open `http://127.0.0.1:3800/example`, press Tab twice, the focused button is `Expand menu`. Its computed outline, box-shadow and background are unchanged (see table). Expected: a visible focus ring (UX rule for keyboard focus).
2. **Serious a11y violation in the grid.** Open the `data-grid/datagrid--campaigns` story, run axe-core: `aria-input-field-name` on `.MuiSelect-select` (`role=combobox`, no name). Expected: every control has an accessible name.
3. **Landmark violations in the app page.** Open `http://127.0.0.1:3800/example`, run axe-core: `landmark-main-is-top-level`, `landmark-no-duplicate-main`, `landmark-unique`. Expected: one top-level `main` landmark.

## Verdict

Measured table shape, unit, integration, Storybook build and Playwright checks pass. The keyboard focus check and the two a11y checks above FAIL.

**Overall: FAIL (3 items)** — focus indicator (shell), serious aria name (grid select), landmarks (app page).

## Checks skipped / not run

- Throttled call, partial API failure, cross-tenant user (no live data path in the kit).
- Permission-locked item in the browser (stub grants everything; unit test only).
- Slot rendering in the browser (no slot output on `/example`).
- Grid keyboard focus, panel visuals in a real browser, the Storybook a11y addon panel.
- Selection cap of 300 / 100 from the brief: the kit uses `maxSelection: 30`; the number needs a decision.
- DB row-count queries: not needed for the checks above.

## Environment notes

- `.env.local` was not created or read (a deny rule blocks it in this worktree); `SH_ENV_FILE=.env.example` was used.
- Brief named branch `claude/p3-ds-306d32`; the worktree is on `claude/p5-qa-ds-dcb574` at the same commit `d7578c0`.
- Playwright used the already installed `chromium-1228`; no new browser download.
- Stack `sellerhub_p5qads` brought down at the end (`pnpm stack:down`).

## Re-check (2026-11-13)

Branch: fast-forwarded to `bce9210` (`fix(ui): skeleton parity for compact, wrap and last page; focus, names and landmarks`) with `git merge --ff-only claude/p3-ds-306d32`. No code changed, nothing committed. Docker Desktop was down: not started. DB-dependent items are NOT RUN. The web app pages used here need no DB.

### Commands

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm build-storybook` | exit 0 |
| `pnpm --filter @seller-hub/ui run measure` | `MEASURE OK: shapes equal, no clipped cell, CLS 0` (Chromium via Playwright) |
| `pnpm --filter @seller-hub/ui run test` | exit 0: 5 files, 141 tests pass |
| `pnpm --filter @seller-hub/web run test` | exit 0: 3 files, 14 tests pass |
| `pnpm --filter @seller-hub/web run dev` + browser pane on `/example` | HTTP 200 |
| `pnpm test:integration`, `pnpm e2e` | NOT RUN: need the DB (Docker down) |

### (1) The three FAIL items from the first run

| Item | Result | Evidence |
|---|---|---|
| Keyboard focus visible on shell sidebar button | **PASS** | `/example`, Tab x2 → focused `BUTTON` "Expand menu", `:focus-visible` true, computed `outline: 2px solid rgb(110, 168, 255)`, `outline-offset: 2px` (before: `outline-style: none`) |
| Axe serious violation on the grid select (`aria-input-field-name`) | **PASS** | Storybook `data-grid-datagrid--campaigns`, axe-core 4.14.0: serious/critical = 0. Remaining 3 are moderate story-iframe artefacts (`region` x4, `landmark-one-main`, `page-has-heading-one`), same as in the first run |
| Landmark violations on `/example` | **PASS** | axe-core on `/example`: 0 violations (before: `landmark-main-is-top-level`, `landmark-no-duplicate-main`, `landmark-unique`) |

Shell story `shell-appshell--default`: axe 0 violations (before: 1 moderate `region`).

### (2) The three skeleton cases (probe, Chromium, viewport 1400, pageSize 25)

Row heights (px), rows (skeleton / loaded), table height (skeleton → loaded), pager top (skeleton → loaded). All checks true for each case, CLS 0, clipped cells 0.

| Case | Columns | Rows (skel / loaded) | Row h (skel / loaded) | Table h | Pager top | Result |
|---|---|---|---|---|---|---|
| compact + selection | 12 | 25 / 25 | 32 / 32 | 880 → 880 | 933 → 933 | PASS |
| compact + inline edit | 12 | 25 / 25 | 32 / 32 | 880 → 880 | 933 → 933 | PASS |
| compact + compare + inline edit | 12 | 25 / 25 | 48 / 48 | 1288 → 1288 | 1341 → 1341 | PASS |
| wrapping column | 12 | 25 / 25 | 49 / 49 | 1314 → 1314 | 1367 → 1367 | PASS |
| wrap + compact + compare | 12 | 25 / 25 | 69 / 69 | 1834 → 1834 | 1887 → 1887 | PASS |
| last page, known 12 rows (of pageSize 25) | 12 | 12 / 12 | 40 / 40 | 560 → 560 | 613 → 613 | PASS |
| last page + compact + wrap + inline edit | 11 | 12 / 12 | 49 / 49 | 677 → 677 | 730 → 730 | PASS |
| total unknown (skeleton = pageSize) | 12 | 25 / 25 | 40 / 40 | 1080 → 1080 | 1133 → 1133 | PASS |

The skeleton row count equals the loaded row count on the last page (12 rows, not pageSize 25).

### (3) Regression of the six earlier configurations

| Configuration | Rows (skel / loaded) | Row h | Table h (skel → loaded) | Pager top | Result |
|---|---|---|---|---|---|
| campaigns | 25 / 25 | 40 / 40 | 1080 → 1080 | 1133 → 1133 | PASS (same as run 1) |
| ad groups (11 cols) | 25 / 25 | 40 / 40 | 1080 → 1080 | 1133 → 1133 | PASS |
| keywords | 25 / 25 | 40 / 40 | 1080 → 1080 | 1133 → 1133 | PASS |
| product targets | 25 / 25 | 40 / 40 | 1080 → 1080 | 1133 → 1133 | PASS |
| auto targets (10 cols) | 25 / 25 | 40 / 40 | 1080 → 1080 | 1133 → 1133 | PASS |
| campaigns + compare | 25 / 25 | 56 / 56 | 1496 → 1496 | 1549 → 1549 | PASS |

Column widths for campaigns in the browser pane (run 1 and run 2): `44,280,110,92,140,120,96,88,108,108,92,92`, unchanged.

### Items NOT RUN (DB-dependent or not reached)

- `pnpm test:integration` and `pnpm e2e` (Playwright): need Postgres/Redis, Docker is down.
- Tenant isolation, partial API failure, throttled call, and permission-locked item in the live app.
- Browser visual walk of the grid panels (only the probe, the story axe, and the sidebar focus were measured in this re-check).

### Verdict

The three earlier FAIL items now PASS, the three skeleton edge cases PASS, and the six earlier configurations show no regression. The DB-dependent items stay NOT RUN.

**Overall (re-check): PASS (0 items FAIL; NOT RUN listed above).**
