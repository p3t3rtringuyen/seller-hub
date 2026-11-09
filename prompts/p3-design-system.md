# P3-DS — Design system and app shell

Model: Sonnet · checkout: worktree (commit on your branch)
OWNED_PATHS: `packages/ui/**`, `apps/web/app/(shell)/**`, `docs/reports/P3-DS.md`

## Goal

Every screen in P4 is assembled from these parts, so the UX rules are solved once, here.

## Inputs

ADR on the frontend and UI kit, `docs/discovery/legacy-web-features.md` ("UX rules to carry
over"), `catalog/legacy/web-ux-rules.json`, `catalog/legacy/web-features.json` (what the tables
and forms must support). Figma link if the user gave one (R9) — then audit the frames before
building and match them; otherwise a neutral, dense, data-first design.

## Build

- Tokens (colour, type, spacing, radius, elevation) with light and dark themes.
- Shell: sidebar navigation fed by a registry (per the shared-file protocol), header, tenant /
  seller account / marketplace switcher (data from a hook P3-IDENTITY will implement; use a
  typed stub now), date-range picker with presets.
- Data table: server-side pagination, sort, filter; column picker; totals row; cells that wrap or
  truncate with an ellipsis and a tooltip, never clip bare; **skeleton matches the real shape**
  while loading: same column set, widths and alignment as the entity being loaded (the campaigns
  page switches entity tabs — campaigns / ad groups / keywords / product targets / auto targets —
  each with its own columns), same row height and row count as `pageSize`, header, toolbar
  (filters, date range, column picker), totals row and pagination rendered at once, no layout
  shift when data arrives; selection with bulk-action bar; inline edit cell.
- Fields: currency (digits and one decimal point, currency from the marketplace, never
  `type="number"`), whole number (digits only), percentage, search, multi-select, status chip.
- Feedback: empty, error, toast, confirm dialog (for bulk and destructive actions).
- URL state helpers for tab → sub-tab → modal, per the legacy rule.
- Storybook (or the ADR's equivalent) with a story per component and per state.

## Done when

Gate command green; every component has a story; a probe in the stories shows no table cell
clipping text without an ellipsis, and the skeleton of every table story has the same column
count, column widths, row height and row count as its loaded state (measure with a Storybook
interaction test per entity tab; zero cumulative layout shift on load). Report the measurements.
