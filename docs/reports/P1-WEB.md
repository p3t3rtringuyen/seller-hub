# Report P1-WEB — legacy web (ads-web) feature inventory

Status: DONE (with the gaps below). Main checkout, nothing committed.

## What I did
Read the legacy repo's own docs (CLAUDE.md, rules, codebase overview, the three functional specs and API
specs under its `docs/v2-spec`), then spot-checked source for: the metric tooltips and column configs,
numeric/limit constants, listing/target/portfolio/rule/budget-account/dashboard/ticket service files, and
the route list of `src/pages` (79 files). Wrote requirements in my own words; no code, comments, host
names or company names copied (grep for the company/system names in my outputs: clean).

## Files created
- `catalog/legacy/web-features.json` — 26 entries (array, schema from the prompt plus optional `internal`,
  `internalNote`, per-column `definition`, action `note`) covering all page routes.
- `catalog/legacy/web-ux-rules.json` — 26 UX rules (numeric inputs, cell overflow, skeletons, URL hierarchy,
  selection, bulk, write semantics, validation, limits, dates/time zone, profile switch, permissions, errors,
  export, re-render cost, video spec, shell, BFF auth).
- `catalog/legacy/web-non-feature-routes.json` — 12 non-feature routes (403, 404, error boundary, app/document,
  BFF auth and proxy API routes, health check, dev helper). Extra file; allowed by `web-*.json`.
- `docs/discovery/legacy-web-features.md` — 16 sections by area.
- `docs/reports/P1-WEB.md` — this file.

## Commands and results
- Route coverage: script listing every file under legacy `src/pages` vs route strings in the two catalogs:
  all covered (the 11 reported "misses" were nested paths covered by grouped route patterns, e.g. `.../ads`,
  `/campaign/{sp|sb|sd}/[id]/ad-group/[adGroupID]`, `_app`; also the component file under `/budget-rule`).
- `JSON.parse` of the three catalogs: OK. Generator script was in the scratchpad, not committed.
- Grep for forbidden names in my outputs: clean.
- Legacy repo: read-only (reads + `git status --short`/`git branch` only). Note: it was on a feature branch
  with other people's uncommitted changes, which I did not touch. `.env*`/`profiles.csv*` not opened.

## Checks skipped / not possible
- Endpoint cross-check was not possible at first delivery; done afterwards, see "Follow-up" at the end.
- No app was run (no servers, no browser); everything is from docs and source.

## Confidence and known gaps
- High (spec cross-read and partly code): campaign listing, create SP/SB/SD, campaign/ad-group detail (SB best),
  portfolios, budget recommendation, rules, history, reports, inventory alert, products, notifications,
  user management, export centre, auth.
- Partial (service files only, not walked screen by screen): `/budget-account`, `/dashboard-campaign`,
  `/portfolios/setting*`, `/rule-campaign`, `/budget-rule`, `/rules/{id}`, `/rules/create-rule`, product issue ticket detail,
  v1 SP/SD detail pages, v1 `/amazon/*` screens (covered through the real-time spec).
- INFERRED formulas (not defined in the UI): CR, CPM, CPO, CPU, AOV, TACOS — flagged in the JSON.
- The legacy specs themselves list unverified items (SP/SD header facts, SP/SD budget-rule metrics, state
  mapping for SP/SD, audience write for SP, negative-targeting field names); I carried them as unverified.
- Per-marketplace limits: the app has no table; it reads profile constraints. Numbers in the doc are fallbacks
  seen in code, not Amazon truth — the Ads API specs (P1-ADS) must supply the real bounds.

## Findings worth the orchestrator's attention
1. **Realtime vs stored**: the legacy built a second "Real-time mode" because its stored copy lags Amazon. This is
   a scope/architecture decision for seller-hub (ingestion freshness vs live reads), not a UI feature.
2. **Write-safety traps to design for**: record-replacing PUTs, whole-set placement arrays, HTTP 200 with
   per-row failures, archive implemented as DELETE, SD lower-case states vs SB/SP upper-case.
3. **Quirks not to carry over**: portfolio edit toast says "Add portfolio success!"; Turn-off-ads has no
   edit-permission check in UI; SD create-ad-group page skips the editable/archived check on direct URL;
   user-management page shows the table to non-admins who type the URL (backend may block).
4. **Internal (legacy-company-specific) concepts** marked `internal` with generic-equivalent notes: issue tickets, BI iframe,
   departments, team dimension, budget-account approvals, inventory-alert engine + "Action on ASIN", warehouse
   inventory/real-sale columns, per-portfolio RBAC, bid rules automation, Walmart/Wayfair options.
5. Hours-of-day budget rules exist only in US, CA, UK, IN, JP (legacy rule) — confirm against Amazon docs.

## Open questions (for P1-SCOPE / user)
- Do we mirror Amazon data (like the legacy) or read live (like Real-time mode), or both?
- Bid rules (internal automation) — in scope for MVP, and is a generic rule engine wanted?
- Compare-range, Top-of-search IS (90-day limit) and extended SB/SD metrics: which reports (Ads reporting v3 / Marketing Stream) supply them?
- Copy campaign across profiles: Amazon has no native copy; seller-hub would rebuild it — keep?

## Follow-ups
- Re-run the endpoint cross-check when `catalog/legacy/api-endpoints.json` exists.
- A screen-by-screen pass on the partial items above if SCOPE keeps them.

## Follow-up: endpoint cross-check against P1-API
Extra file: `catalog/legacy/web-endpoint-crosscheck.json` (matched / no-route / unlisted-backend lists).
Against `catalog/legacy/api-endpoints.json` (212 external routes, typed second mount expanded): 194 web calls -> 188 match,
5 have no backend route (the background export service; four budget-account calls served by a separate portal API), 1 is a
web-server route. 95 external backend routes are not listed by any web entry (grouping in section 17 of the discovery doc).
Errors in my first draft found and fixed in `web-features.json`: portfolio operations (list, users, per-portfolio users) and
ticket profiles are POST; suffix-emails is GET; the audience list path parameter is the campaign type.
Caveat: the 95 are not proof of unused routes — the web catalog is per-screen at requirement level and v1 secondary dialogs
were not enumerated. Neutral wording only; no company-specific names, headers or schema names written (grep clean).
