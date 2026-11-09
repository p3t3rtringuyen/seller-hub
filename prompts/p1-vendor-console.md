# P1-VENDOR — Vendor Central feature inventory (read-only, in the user's browser)

Model: Sonnet · checkout: main · do not commit
OWNED_PATHS: `catalog/vendor/**`, `docs/discovery/vendor-features.md`, `docs/reports/P1-VENDOR.md`
Parameters from the brief: `START_URL` — the Vendor Central URL the user gave
(`https://vendorcentral.amazon.com/promotion-central/dashboard`).

## Goal

D5 puts Vendors in scope. Vendor Central (starting with Promotion Central) is the functional
reference for seller-hub's vendor features. Record what a vendor user can see and do there, as
structure and rules, and map each feature to the SP-API `vendor-*` operations (from
`catalog/spapi/**` if P1-SPAPI has finished, else `refs/amazon/selling-partner-api-models/models/vendor-*`)
or mark it **console-only** (no public API).

## How you work

- You drive the user's real Chrome through the Claude in Chrome tools (load the
  `anthropic-skills:chrome-browser` skill first). It is signed in to a **live vendor account**
  (owned by the user's employer). Work in your own tab; close it when done. Never run while
  another session drives Chrome (PLAN concurrency).
- **Read-only, without exception.** Navigate, switch tabs, open menus, dropdowns, filters and
  tooltips, and step through a creation wizard **to read its fields**. Never click anything that
  saves or changes the account: Submit, Save, Create, Cancel promotion, Edit, Accept, Confirm,
  Upload, Delete. Type only into search or filter boxes. Leave a wizard by navigating away. If a
  dialog needs a decision, stop and report `BLOCKED`.
- **Structure, not data.** Never record promotion names, ASINs, prices, funding amounts, vendor
  codes, account names or ids. Record labels, columns, options, validation messages, limits, help
  text.
- Prefer page text and the accessibility tree over screenshots.

## Cover

1. Promotion Central from `START_URL`: dashboard, every promotion type offered (e.g. Best Deal,
   Lightning Deal, Price Discount, Prime Exclusive, coupons if present): every step, field,
   option, default, min/max, eligibility rule and validation message; promotion list (columns,
   statuses, filters, actions); promotion detail and performance views.
2. One click from Promotion Central: the main Vendor Central areas reachable from the top menu
   (Orders / purchase orders, Shipments, Invoices / Payments, Items / catalog, Reports / Retail
   Analytics, Coupons, Advertising link) — one line each: purpose, key columns, actions, and the
   matching SP-API operation or "console-only".

## Outputs

- `catalog/vendor/vendor-features.json` — `[{area, screen, path, purpose, columns: [{name,
  definition}], filters[], actions[{name, kind, writes: true}], forms: [{step, fields: [{name,
  type, options, default, validation}]}], api: [{operation, model}] | "console-only", notes}]`.
- `docs/discovery/vendor-features.md` — the same, readable, grouped by area, ending with an
  **API coverage table**: feature · SP-API operation · console-only? · notes.
- `docs/reports/P1-VENDOR.md` per CLAUDE.md.

## Done when

Every promotion type and every area listed above is covered, or named as not reachable with the
reason (no permission, not available for this account).
