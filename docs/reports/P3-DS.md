# P3-DS — Design system and app shell

Branch `claude/p3-ds-306d32` (from `main` 69f44a0 + status commit 52ab652). No Figma (R9 not given): neutral, dense,
data-first UI from the UX rules in `catalog/legacy/web-ux-rules.json`. Clean room: no legacy source opened.

## What was built

### `packages/ui` (`@seller-hub/ui`, source-only, MUI 7 + emotion + TanStack Table v8 + Recharts 3, ADR-0003)

| Area | Components / modules |
|---|---|
| Tokens, theme | `tokens.ts` (colour, type, spacing, radius, elevation, grid geometry), `theme.tsx` (`ThemeProvider`, CSS variables, light + dark through `data-theme`) |
| Copy | `messages.tsx`: English defaults for every string the kit renders, `UiMessagesProvider` to override (conventions §9, UX-22) |
| Permissions (D55) | `PermissionProvider`, `useCan`, `PermissionGate` (hide / lock; every check false while roles load, UX-19) |
| Fields (UX-01) | `MoneyField` (currency symbol + exponent from the marketplace currency, never `type=number`), `IntegerField`, `PercentField`, `SearchField` (debounced), `MultiSelect` (max at tick time), `StatusChip` (text + tone), pure `sanitize.ts` |
| Feedback | `EmptyState`, `ErrorCard` (message, Retry, copy error content, UX-20), `ToastProvider` / `useToast` / `useBulkResultToast` (200 is not success: partial = warning with counts, UX-12/13), `ConfirmDialog`, `Modal` |
| Data grid | `DataGrid` (TanStack engine; server-side page / sort; column order, hide, left/right pin; Total row; compare row; selection across pages with max; empty row; in-place error), `ColumnChooser`, `BulkActionBar`, `InlineEditCell` ("Not saved" keeps typed value), `FilterBar` (search, metric threshold filters, quick chips), `GridPagination`, `DeltaBadge`, `TruncatedText`, `SkeletonMark`, pure `columnState.ts` |
| Dates (UX-17) | `DateRangeCompare` (presets, custom, compare with End autofill, future days blocked, zone hint) + pure `dates.ts`; "today" comes from the server in the marketplace zone |
| Charts | `KpiCard` (fixed box loading or ready), `TimeSeriesChart` (compare overlay dashed, gaps not zeros) |
| URL state (UX-07..09) | `urlState.ts`: typed chain tab → sub → modal(+id), drop invalid levels, clear below on change, push on open / replace on close, per-tab listing prefixes, readable query strings. Pure; the app wires it to its router |
| Shell | `AppShell` (sidebar collapsed by default, breadcrumbs, title, skip link), `ContextSwitcher` (tenant / seller account / marketplace, disabled while switching, UX-18), `ThemeToggle` |
| Probes | `describeGridShape`, `measureGridShape`, `findBareClips` (shape / clipping measurements, see below) |

Skeleton rule (UX-04) is structural: loading and loaded rows are produced by the same table markup: same `<colgroup>`
widths, same cell padding, `rowHeight` set by one token (40 / 32 compact; 56 / 48 with compare), body rows = `pageSize`,
header, toolbar, Total row (label + bars) and pager always rendered, skeleton shapes per column (`checkbox`, `switch`,
`text` lines, `number`, `disc`, `chip`).

### `apps/web`
- `app/layout.tsx`: emotion SSR cache, `InitColorSchemeScript` (no wrong-theme flash), `Providers` (theme, copy, toasts).
- `app/(app)/layout.tsx` renders `AppFrame` around every authenticated page.
- `app/(shell)/`: `AppFrame` (sidebar from `nav.generated.ts` filtered by permission, breadcrumbs, `SlotOutlet` reading
  `slots.generated.ts`: slots `shell.header.actions`, `shell.sidebar.footer`), `nav.ts` (sections, order, labels from the
  slice message file `<module>.<key>`), `breadcrumbs.ts`, `messages.ts` (shell copy), `Providers.tsx`, `session.ts`.
- `session.ts` is the **typed stub** for the hook P3-IDENTITY implements (`useShellSession`: loading, permissions, active
  tenant / seller account / marketplace + options, switching). The stub grants the permissions the nav registry asks for.

### Storybook
`.storybook/main.ts` (a11y addon resolved from `packages/ui`) and `.storybook/preview.ts` re-exporting
`packages/ui/storybook/preview-config.tsx` (theme + light/dark toolbar, toasts, permissions). 66 stories, every one with a
`play` interaction test.

## Measurements (the "done when" probes)

Real browser (chromium 1228 via Playwright against `pnpm build-storybook`, `pnpm --filter @seller-hub/ui run measure`,
viewport 1400 px, page size 25). Loading grid vs loaded grid, same entity, measured with `getBoundingClientRect`:

| Entity tab | Columns (+select) | Body rows | Row height | Header / Total height | Table height loading → loaded | Pager top loading → loaded | Clipped cells |
|---|---|---|---|---|---|---|---|
| campaigns | 12 | 25 | 40 | 40 / 40 | 1080 → 1080 | 1133 → 1133 | 0 |
| ad groups | 11 | 25 | 40 | 40 / 40 | 1080 → 1080 | 1133 → 1133 | 0 |
| keywords | 12 | 25 | 40 | 40 / 40 | 1080 → 1080 | 1133 → 1133 | 0 |
| product targets | 12 | 25 | 40 | 40 / 40 | 1080 → 1080 | 1133 → 1133 | 0 |
| auto targets | 10 | 25 | 40 | 40 / 40 | 1080 → 1080 | 1133 → 1133 | 0 |
| campaigns + compare | 12 | 25 | 56 | 40 / 56 | 1496 → 1496 | 1549 → 1549 | 0 |

Column widths (per `<th>`), toolbar height, pager height are equal loading vs loaded in every row. **Cumulative layout
shift** while one grid switches loading → loaded (`PerformanceObserver` `layout-shift`): **0**. `findBareClips` (hidden
overflow, no ellipsis, `scrollWidth > clientWidth`): **none**, with deliberately long names in the data.
Raw JSON is written to `storybook-static/measure-grid.json` by the script (gitignored).

The same assertions run in the gate without a browser (jsdom has no layout, so they compare the declared widths /
heights the grid writes on its elements): per entity tab and per compare mode in `DataGrid.test.tsx` and in the
`Skeleton = loaded: …` stories (`stories/parity.ts`); the stories also compare the measured boxes when a layout engine
exists (Storybook in a browser).

## Commands and results

| Command | Result |
|---|---|
| `pnpm gate` (stack `sellerhub_p3ds`, offset 200, up; `SH_ENV_FILE=.env.example`) | **exit 0** (final run, see below) |
| `@seller-hub/ui` tests | 4 files, 120 tests pass: 66 story interaction tests run through `composeStories().run()` (Vitest, jsdom), 36 DataGrid/skeleton/component RTL tests, logic tests (sanitizers, column state, dates, URL chain, messages), story-coverage check |
| `@seller-hub/web` tests | 3 files, 12 tests pass (nav registry → sections, breadcrumbs, `AppFrame` renders the registered nav entry + slot) |
| other packages | unchanged and green (core 9, metrics 3, contracts 4, db 2, worker 7, config 10, mod-example 9, testing 7, api 13; tools 19) |
| `pnpm build-storybook` | OK |
| `pnpm --filter @seller-hub/ui run measure` | `MEASURE OK: shapes equal, no clipped cell, CLS 0` |
| `next start` smoke (`/example`, HTTP 200) | server HTML has the sidebar, nav link `/example` with `aria-current`, breadcrumbs, switcher, the slot output |

DB-backed tests ran against the live stack (not skipped). Not run: `pnpm e2e` (no Playwright spec for the shell yet).

## Files touched outside OWNED_PATHS (all minimal, please review)

- `tsconfig.json` (root): added `jsx: react-jsx` and `lib: DOM` so the root `tsc` can follow `.storybook` into `packages/ui`.
- `apps/web/next.config.ts`: `@seller-hub/ui` added to `transpilePackages` (required to consume the source-only package).
- `apps/web/package.json`: `@seller-hub/ui`, `@mui/material`, `@mui/material-nextjs`, `@emotion/*`.
- `.storybook/main.ts`, `.storybook/preview.ts` (config the scaffold created; BACKLOG §1.3 lists `.storybook/**` as P3-DS).
- `pnpm-lock.yaml`: new dependencies of `packages/ui` and `apps/web` (expected).

## Requests to the orchestrator (shared files)

1. **Versions in the catalog**: `packages/ui` and `apps/web` pin MUI / emotion / TanStack / Recharts / user-event versions
   directly, because `pnpm-workspace.yaml` is not mine. Move to `catalog:`:
   `@mui/material 7.3.11`, `@mui/material-nextjs 7.3.10`, `@emotion/react 11.14.0`, `@emotion/styled 11.14.1`,
   `@emotion/cache 11.14.0`, `@tanstack/react-table 8.21.3`, `recharts 3.10.1`, `@testing-library/user-event 14.6.1`,
   `@storybook/addon-a11y 9.1.21`.
2. **ESLint**: `packages/config/eslint.mjs` gives browser globals and the react-hooks rules only to `apps/web/**`;
   `packages/ui/**` gets neither (I used a `/* global */` comment in one script). Extend the `apps/web` block to
   `packages/ui/**/*.{ts,tsx}` (and keep the `@seller-hub/*` import restrictions: ui must not import core/db).
3. The web boundary rule forbids `@seller-hub/core` in `apps/web`; `packages/ui` therefore has its own date arithmetic
   (`dates/dates.ts`, plain ISO strings, no `Date.now()`), which stays correct because the server supplies "today".
4. `@storybook/addon-a11y` is resolved from `packages/ui`; if the root gains it, `.storybook/main.ts` can use the plain name.

## Decisions taken / defaults used

- ADR-0003 chosen path: MUI core + TanStack Table v8 (not v9, which is current on npm) + Recharts (charts decided inside
  `packages/ui`, as the ADR allows). Own `DataGrid`, no MUI X.
- Native `<input type="date">` with `max = today` for custom dates (no MUI X pickers); presets and compare logic are ours.
- Column reordering: drag and drop plus move up / down buttons in the column menu. Pin: left / right, click again to unpin.
- Whole-number field: pasting `15.39` keeps `15`; typing the dot then digits keeps adding digits (documented in
  `sanitize.test.ts`). The UX-01 sample string is asserted for both field kinds.
- Sidebar collapsed by default; collapsed items show a lettered badge with a tooltip instead of a flyout (flyout submenus
  can come with the first nav entry that has children).
- UX-07 detail: a modal under a sub-tab that is dropped as invalid is dropped too (the chain is broken).

## Open points / follow-ups

- **Not covered by tests**: axe/a11y checks run only in the Storybook a11y panel (`a11y.test: "error"` is set, but the
  Vitest runner does not execute axe; adding `@storybook/addon-vitest` would need a browser provider in the gate).
- UX-10 "move/pin disabled on touch pointers" is not implemented (the column menu works on touch too).
- UX-21 export, UX-06 lazy-tab preloading, UX-23 re-render budget are slice / page concerns; `DataGrid` takes stable
  `columns` and renders only what changed, but no profiling was done.
- `session.ts` stub: replace with the P3-IDENTITY hook; route-level gating ("no access" page) is each page's job (UX-19).
- Lint rule "web feature imports another feature only via `public.ts`" (from P3-SCAFFOLD report) is still open.
- No Playwright e2e for the shell yet (`e2e/shell/`), and no `storybook` job in CI (`pnpm --filter @seller-hub/ui run measure`
  needs a chromium and `pnpm build-storybook`; suggested for CI next to `e2e`).
- Stack `sellerhub_p3ds` brought down at the end (`pnpm stack:down`); `ads-api-cache-1` untouched.

## Review + QA fixes (round 2)

Inputs: `docs/reports/P3-DS-review.md` (MERGE-AFTER-FIXES, M1–M3) and `docs/reports/P3-DS-qa.md` (FAIL, 3 items).
The browser measurement (`pnpm --filter @seller-hub/ui run measure`, chromium 1228, page size 25, 1400 px) now covers
14 configurations instead of 6, and also probes keyboard focus and axe. Final run: `MEASURE OK: shapes equal, no
clipped cell, CLS 0`, with `APP_URL` set to the production build of the app (`next start`) so `/example` is checked too.

### Must fix (the skeleton rule)

| Item | Cause | Fix | Measured (loading → loaded) |
|---|---|---|---|
| **M1** compact rows 32 vs 37.56 px | small MUI checkbox is 20 px + 2×9 px padding; the inline-edit icon button likewise | grid checkbox and inline-edit button use `p: 0.5` (28 px / 24 px), so every control fits the 32 px row | compact + selection: row 32 → 32, table 880 → 880, pager 933 → 933. Compact + inline edit: same. Compact + compare + inline edit: 48 → 48, 1288 → 1288 |
| **M2** `wrap: true` grew rows | wrapped text was not clamped, skeleton drew 2 bars | wrapped text is clamped to `skeletonLines` (default 2) with `-webkit-line-clamp`, tooltip when clamped; the row height is budgeted from the line count by `datagrid/rowSizing.ts#rowHeightFor` (one function for skeleton and data rows) | wrapping column (long names): row 49 → 49, table 1314 → 1314, pager 1367 → 1367. Wrap + compact + compare: 69 → 69, 1834 → 1834 |
| **M3** last page jumped | skeleton always drew `pageSize` rows | `rowSizing.ts#skeletonRowCount`: `min(pageSize, total − pageIndex·pageSize)` when the total is known, `pageSize` before the first answer | page 13 of 312 rows: 12 rows → 12, table 560 → 560, pager 613 → 613. Last page + compact + wrap + inline edit: 12 → 12, 677 → 677. Unknown total: 25 → 25 |

Tests that measure: the new stories `Skeleton = loaded: …` (compact, compact + inline edit, compact + compare + inline
edit, wrap, wrap + compact + compare, last page, last page + compact + wrap + inline edit, unknown total) assert the
declared sizes in the gate and compare `getBoundingClientRect` boxes whenever a layout engine exists; the same stories are
measured in chromium by `measure` (all 14 configurations pass, per-config JSON in `storybook-static/measure-grid.json`).
`rowSizing.test.tsx` pins the budget numbers and the row counts. The review's note on CLS stands: CLS 0 is not
evidence of parity (rows are new nodes), so heights are compared, not CLS.
Honest limit: jsdom cannot measure layout, so the gate alone cannot fail on a real-layout regression; `measure` can
and must run in CI (see follow-ups).

### QA FAILs

1. **Focus indicator** (sidebar button): the theme now draws a 2 px primary outline on `:focus-visible` for links,
   buttons, `[tabindex]` and `MuiButtonBase.Mui-focusVisible` (`theme.tsx`); the sortable header button used `all: unset`
   and now sets its own ring. Measured by keyboard in chromium (computed outline): menu toggle, nav link, sort header,
   pager button and the app's skip link all have `outline: 2px solid`.
2. **Grid select without a name** (axe `aria-input-field-name`): `GridPagination` uses `labelId` + `useId()`; RTL test
   `combobox "Rows per page"`. This also fixes the duplicate id (review S2) when two grids share a page.
3. **Landmarks on `/example`**: the example page rendered its own `<main>` inside the shell's `<main>` (nested and
   duplicate). Fixed at the source: `apps/web/app/(app)/example/page.tsx` now renders a `<div>` (scaffold's example page,
   outside OWNED_PATHS, one-word change; it is deleted with `modules/example` anyway). Rule: the shell owns the only
   `<main>`; a test in `shell.test.tsx` fails if any file under `app/(app)` contains `<main`. axe on `/example` (all
   rules): 0 violations. axe on the stories (iframe artefacts `region`, `landmark-one-main`, `page-has-heading-one`
   excluded): 0 violations for the grid and the shell.

### Should-fix items done

- S2 duplicate id (above). S4 `InlineEditCell` takes `decimals` (currency exponent; JPY 0). Nit: Total-row alignment now
  uses `numeric && !exempt` like the cells.
- `measure` now also runs axe-core (`axe-core 4.10.3`, new devDependency of `packages/ui`) and keyboard-focus probes.

### Follow-ups (not done)

- **S1**: run `pnpm build-storybook && pnpm --filter @seller-hub/ui run measure` in CI (needs chromium; CI file is the
  orchestrator's). Optional: `APP_URL=… ` for the app-page axe check.
- **S3** shell copy to `apps/web/messages/en/*.json` (needs the generator's namespace for a non-slice file; left in
  `(shell)/messages.ts`). **S5** "select all matching the filter" (needs the bulk slice's cap and server resolution).
  **S6** reserve space for the bulk bar so the first tick does not move the table (decide: overlay on the toolbar).
- A row with an inline-edit error message grows while editing (edit state, not a loading transition).
- Remaining nits: DOM lib in root tsconfig vs a `.storybook/tsconfig.json`; `apps/web/app/page.tsx` placeholder text;
  UX-10 touch-pointer rule and column resize.
- Not covered by `pnpm gate`: browser measurement, axe, focus (all in `measure`).

### Commands (round 2)

`pnpm gate` (stack `sellerhub_p3ds`, offset 200, DB tests ran): exit 0, 12/12 tasks; ui 141 tests, web 14, api 13,
core 9, config 10, mod-example 9, worker 7, testing 7, contracts 4, metrics 3, db 2, tools 19. `pnpm build-storybook`
OK; `measure` with `APP_URL` OK. Stack brought down; `storybook-static` removed.
