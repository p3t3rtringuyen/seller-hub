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
  truncate with an ellipsis and a tooltip, never clip bare; skeleton rows the height of real rows
  while loading, with headers and static parts rendered at once; selection with bulk-action bar;
  inline edit cell.
- Fields: currency (digits and one decimal point, currency from the marketplace, never
  `type="number"`), whole number (digits only), percentage, search, multi-select, status chip.
- Feedback: empty, error, toast, confirm dialog (for bulk and destructive actions).
- URL state helpers for tab → sub-tab → modal, per the legacy rule.
- Storybook (or the ADR's equivalent) with a story per component and per state.

## Done when

Gate command green; every component has a story; a probe in the stories shows no table cell
clipping text without an ellipsis, and skeleton rows measure the same height as loaded rows.
Report the measurements.
