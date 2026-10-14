# P1-WEB — ads-web feature inventory (clean room)

Model: Sonnet · checkout: main · do not commit
OWNED_PATHS: `catalog/legacy/web-features.json`, `catalog/legacy/web-ux-rules.json`,
`docs/discovery/legacy-web-features.md`, `docs/reports/P1-WEB.md`

## Goal

A complete list of what ads-web lets a user see and do, written as requirements — so seller-hub
can reach parity and then go further. You extract features and rules, never code.

## Source (read-only)

`C:/Users/trinh/Projects/ads-web` — Next.js 15 Pages Router, MUI 7, material-react-table. It is a
**shared working copy on a feature branch with other people's uncommitted work**: never edit,
never run `git checkout` / `switch` / `stash` / `reset` / `clean`, never start its servers, never
open `.env*`. `git log` and `git show` are fine.

Read in this order:
1. `CLAUDE.md`, `docs/CODEBASE_OVERVIEW.md` (route and module inventory), `docs/QA_TEST_PLAN.md`
   (expected behaviour), `.claude/rules/*.md` (UX rules learned the hard way).
2. `src/pages/**` (every route), `src/modules/**` (v2), `src/containers/**` (v1),
   `src/features/**`, and the data-access / service files to find which backend endpoint each
   screen calls.

## Output

`catalog/legacy/web-features.json`:

```json
[{ "route": "", "title": "", "entity": "", "amazonConcept": "",
   "columns": [{ "name": "", "metric": true, "definition": "" }],
   "filters": [], "actions": [{ "name": "", "kind": "create|edit|bulk|inline|export", "amazonWrite": true }],
   "forms": [{ "name": "", "fields": [{ "name": "", "type": "", "validation": "" }] }],
   "urlState": [], "roles": [], "endpoints": [{ "method": "", "path": "" }],
   "status": "v1|v2|both", "notes": "" }]
```

`catalog/legacy/web-ux-rules.json` and a section of the doc: the UX rules worth carrying over
(numeric inputs, table cell overflow, skeletons, URL hierarchy for tab/sub-tab/modal, …), restated
as requirements in your own words.

`docs/discovery/legacy-web-features.md`: one section per area (campaign list, SP / SB / SD
campaign detail, ad groups, targeting, search terms, portfolios, budget rules, bidding rules,
reports, dashboards, inventory alerts, notifications, history, user management, …). For each: what
the user does there and why, the metrics shown (with definitions), validation rules (bid / budget
min-max per marketplace), and what goes to Amazon versus what stays internal.

Mark anything Yes4All-specific (departments, internal SKU ownership, internal recommendation
engines) as `internal` with a one-line note on whether a generic version would make sense for any
seller.

## Done when

Every route under `src/pages` has an entry or is listed as non-feature (`_app`, `403`, …). If
`catalog/legacy/api-endpoints.json` (P1-API) exists when you finish, cross-check endpoints and list
the mismatches; otherwise say the cross-check was not possible.
