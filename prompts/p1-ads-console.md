# P1-CONSOLE — Amazon Ads console feature inventory (read-only, in the user's browser)

Model: Sonnet · checkout: main · do not commit
OWNED_PATHS: `catalog/console/**`, `docs/discovery/ads-console-features.md`,
`docs/reports/P1-CONSOLE.md`
Parameters from the brief: `START_URL` — the console URL the user gave (it carries their
advertiser `entityId`; do not write the id into any file, write `entityId=…`).

## Goal

The Amazon Ads console (Campaign Builder, Campaign Manager and the screens around them) is the
functional reference for seller-hub's advertising features (D51); ads-web itself imitated it.
Record what a user can see and do there, as structure and rules — so P1-SCOPE can measure ads-web
and seller-hub against it.

## How you work

- You drive the user's real Chrome through the Claude in Chrome tools (load the
  `anthropic-skills:chrome-browser` skill first). It is signed in to a **live advertiser
  account**. Work in your own tab; close it when done.
- **Read-only, without exception.** You may navigate, switch tabs, open menus, dropdowns, column
  pickers, filter panels and tooltips, and step through a creation wizard **to read its fields**.
  You must never click anything that saves or changes the account: Launch, Save, Submit, Create,
  Apply, Update, Pause, Enable, Archive, Delete, Bulk actions, Accept, Confirm. Do not type into
  any field except a search or filter box. Leave a wizard by navigating away. If a page shows a
  dialog that would need a decision, stop and report `BLOCKED`.
- **Structure, not data.** Never record campaign names, ASINs, keywords, amounts, account names or
  ids. Record labels, columns, options, validation messages, limits and help text.
- Prefer page text and the accessibility tree over screenshots.

## Cover

1. Campaign Builder from `START_URL`: every campaign type offered on each tab ("Amazon and
   beyond", "Amazon Business", "Across retailers"), and for Sponsored Products, Sponsored Brands
   and Sponsored Display: every step, field, option, default, min/max and validation message.
2. Campaign Manager: the campaigns list (columns with their tooltip definitions, filters, saved
   views, date ranges, bulk and inline actions, charts), campaign detail and its tabs (ad groups,
   placements, negative targeting, budget rules, history, settings…), ad group detail and its tabs
   (ads, targeting, negative targeting, search terms…), portfolios.
3. Everything one click from those (recommendations, budgets, bulk operations, reports,
   measurement) — one line each with what it is, unless it is an advertising feature ads-web has.

## Outputs

- `catalog/console/console-features.json` — `[{screen, path (entityId=…), purpose, columns:
  [{name, definition}], filters[], actions[{name, kind, writes: true}], forms: [{step, fields:
  [{name, type, options, default, validation}]}], notes}]`.
- `docs/discovery/ads-console-features.md` — the same, readable, grouped by area; then **a parity
  table** against `catalog/legacy/web-features.json` (if P1-WEB has finished; otherwise against
  ads-web's `docs/CODEBASE_OVERVIEW.md`): console feature · in ads-web? · notes.

## Done when

Every campaign type's builder and every Campaign Manager tab listed above is covered, or named as
not reachable with the reason (no permission, not available for this account).
