# Report P1-API — legacy ads backend inventory and ads-api → Amazon call map

Status: DONE · checkout: main (nothing committed) · model: Sonnet · clean room (D0)

## What was done

Read the legacy Go backend (read-only) and produced five outputs:

| File | Content |
| --- | --- |
| `catalog/legacy/api-endpoints.json` | 251 routes (212 external, 39 internal): method, path, group, handler, usecase, entities, data sources, Amazon call ids, auth, notes |
| `catalog/legacy/entities.json` | 75 persisted structs / read models with fields, table, class (17 amazon-mirror, 19 app-owned, 39 internal), Amazon object, notes |
| `catalog/legacy/jobs.json` | 25 rows: 13 CLI jobs/services, 11 Kafka consumers, 1 producer family |
| `catalog/legacy/api-amazon-calls.json` | **the call map**: 177 client functions, each with proxy path, HTTP method(s), matched Amazon operation (id, path, version), media types, headers, request/response shape, `usedBy`, `v1Operation` |
| `docs/discovery/legacy-api-domain.md` | domains + business rules as requirements, 32-row replacement map, 18 traps, coverage |

## Headline findings (for P1-SCOPE and the architects)

1. ads-api never talks to Amazon: an internal proxy holds LWA and mirrors Amazon paths (D52). Of 177
   client calls, **149 match a public Amazon Ads v0 operation** in `catalog/ads/operations.json`
   (method + normalised path); **27 are NOT Amazon Ads API calls** but private Amazon Ads console endpoints
   driven with a real user's cookie (fetched from a "cookie bot") and scraped CSRF tokens; 1 is a
   debug leftover. seller-hub must drop the 27 and use Ads reports + v1 queries.
2. v1 (D53) coverage of the 149: **86 map to a v1 operation** (campaigns, ad groups, ads, targets
   incl. negatives via `negative=true` and `targetLevel`), **11 partial** (creatives), **52 are named v0
   exceptions**: portfolios, budget rules (+events/association), optimisation rules, all target-level
   recommendations, moderation, audiences, product metadata, creative asset library, SB `listAsins`.
3. Metrics are not fetched from Amazon at request time: they come from a reporting database filled by an
   external ETL; the OOB feed is the Marketing Stream `budget-usage` dataset in that database. Marketing
   Stream v1 is on a deprecation path (shut-off 2027-06-30 per the docs in `refs/`).
4. The automation "bots" are external models; ads-api is only the executor with status columns. The
   decision logic does not exist in the repo → a product/design decision for P1-SCOPE (replacement row 12).
5. Security traps worth a Gate-1 line: 34 of 39 internal routes and 4 external routes are
   unauthenticated, 46 external routes have no role check, the access log dumps full requests incl.
   `Authorization`, errors are returned as HTTP 200.

## Commands run and results

Read-only exploration only (`ls`, `grep`/Grep, `sed`, `git status`); no legacy command was built or run.

- Route extraction: a Python script (kept in my scratchpad, not in the repo) parsed
  `router/external.go` and `router/internal.go`; **212 + 39 registrations found; the count equals
  `grep -c` of verbs in each file** (212, 39).
- Client calls: a script parsed `pkg/xservice/aws/*.go`: 177 functions with an HTTP client call.
  Each was matched on (HTTP method, normalised path) to `catalog/ads/operations.json` (generation v0):
  149 matched, 27 are console-private (named explicitly), 1 not an Amazon call. `usedBy` was found by
  scanning for calls on the client interface from usecases, handlers, jobs, consumers (a few client
  functions have no detected external caller; see `usedBy`).
- JSON validity: `JSON.parse` of all four files → ok.
- Secrets check: grep of all outputs for URLs, passwords, long digit strings → none (only the words
  "bearer token" as a description). No `.env*` or `profiles.csv*` file was opened (the code that reads
  the CSV was read to learn its columns).
- Endpoint → call ids cross-check: the generator asserts every Amazon call id referenced from
  `api-endpoints.json` / `jobs.json` exists in `api-amazon-calls.json` (passes).

## Checks skipped / limits

- **No dynamic verification.** The proxy's code is not in the repo: LWA ownership, regional routing and
  the response envelope are inferred from the client's headers and response structs (stated as inferred).
- `amazonOperation` proves the path exists in the spec, not that the legacy request body satisfies it.
- Per-route `amazonCalls` / `dataSources` in `api-endpoints.json` come from handler/usecase naming
  and the Amazon-call usage of each usecase file (verified: every id exists; the migrate and automation
  groups were cross-checked against `usedBy`). A few read paths were classified by name only (e.g. which
  grids hit the reporting DB); doubtful ones say so in `notes`.
- Table names: where no explicit name exists in the repo, GORM's default naming is assumed and the entry
  says `tableSource: inferred`. Only one SQL migration exists, so column types are as in struct tags.
- `services/ads-export` (separate export module), `learn/` and tests were not analysed; business rules
  were read from code and the legacy SRS, not from live data.
- SP-API names in the replacement map (FBA Inventory, Sales and Traffic report, Brand Analytics,
  Notifications) come from my knowledge of the SP-API and are **not yet checked** against `catalog/spapi`.
- v1 report/search-term/placement field coverage is not checked (needs P1-ADS definitions).

## Open questions (replacement map rows marked unresolved)

1. Row 2: do v1 reports (`AdsApiv1CreateReport`) cover search-term, placement and impression-share
   columns, or must seller-hub use v0 Reporting v3 (`createAsyncReport`) as a named exception?
2. Row 7: Marketing Stream v1 shut-off on 2027-06-30; what replaces `budget-usage` (v1 stream
   subscriptions exist in the catalogue)?
3. Row 30: Amazon Business (B2B) placement metrics: any API source?
4. Row 31: no public operation to disassociate an SP optimisation rule from a campaign.
5. Row 12 / §1.7: how much automation (rules engine, search-term harvesting, auto top-up, auto-stop on
   stock-out) is in the MVP? The legacy decision models cannot be copied.
6. Row 9: COGS, person-in-charge and department are user input; confirm in D-numbers when P1-SCOPE
   decides inventory/profit features.

## Follow-ups

- P1-SCOPE: take replacement-map rows 2, 7, 12 and traps 4–6 into `docs/SCOPE.md`.
- P2-DATA: use `entities.json` classes (amazon-mirror → keep Amazon ids, add tenant/seller columns; app-owned
  → redesign; internal → drop or user input).
- P2 ADR: record the **named v0 exceptions** list from `api-amazon-calls.json` (`v1Operation.status == v0-exception`),
  as D53 requires.
- Orchestrator: remember that the legacy repo working tree has uncommitted changes that are not mine
  (`.env` and `learn/ads-export/lab/internal/config/config.go` modified; untracked `package-lock.json` and
  several `data/exports/*.xlsx` files appear while the legacy app seems to be running elsewhere).

## Incident (disclosed)

Early on my route-extraction script wrote two temporary JSON files (`ext_routes.json`,
`int_routes.json`) into the legacy repo root because of a wrong working directory. I noticed on the next
command and **deleted both immediately** (`rm`); `git status` of the legacy repo afterwards shows only
the pre-existing changes listed above. No other file was written outside this repo and the scratchpad.

## Files created / changed

Created: `catalog/legacy/api-endpoints.json`, `catalog/legacy/entities.json`, `catalog/legacy/jobs.json`,
`catalog/legacy/api-amazon-calls.json`, `docs/discovery/legacy-api-domain.md`, `docs/reports/P1-API.md`.
Changed: none. Nothing committed (main checkout).

## Follow-up round (orchestrator request: clean room + SP-API check)

1. **Neutralised legacy-company names** in `catalog/legacy/api-amazon-calls.json`, `api-endpoints.json`,
   `jobs.json`, `entities.json` and `docs/discovery/legacy-api-domain.md`: proxy headers
   `Y4A-Token` → `internalProxyAuthHeader`, `Y4A-Api-Endpoint` → `internalProxyEndpointHeader`, envelope field
   `y4aCode` → `legacyTenantCode`; warehouse/automation/reporting table names → "legacy automation store: <what it
   holds>" / "legacy reporting table: …"; bot codenames → "budget / keyword-bid / search-term / campaign-creation /
   budget-recommendation rule engine"; struct and field prefixes (`Yams*`, `ExecuteHermes*`…) → neutral names; role
   `AdminYAMS` → `ModuleAdmin`. Business meaning kept. Mechanical replacement, JSON re-parsed: all four files valid.
2. **Grep** `grep -rciE "yes4all|y4a|jarvis|hermes|aegis|atlas|yams"` over the five files → **0 in every file**
   (verified after the last edit; the replacement tables inside `docs/reports/P1-API.md` itself are outside the scope).
3. **SP-API names checked against `catalog/spapi`:** `getInventorySummaries`, `getCatalogItem`, `searchCatalogItems`,
   `getListingsItem`, `getMarketplaceParticipations` exist; report `GET_SALES_AND_TRAFFIC_REPORT`, Brand Analytics
   `GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT`, notification `FBA_INVENTORY_AVAILABILITY_CHANGES` and Data Kiosk
   `salesAndTraffic` exist. **Fixed:** `GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA` is not in `catalog/spapi/reports.json`
   → removed from replacement row 9 (use the Inventory API). Row 9 "SP-API names not yet checked" caveat above is now resolved.
