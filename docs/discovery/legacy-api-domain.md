# Legacy ads backend (ads-api): domains, business rules and replacement map

Task P1-API · clean room (D0) · sources: the legacy Go backend, read-only. Companion catalogues
(all under `catalog/legacy/`): `api-endpoints.json` (251 routes), `entities.json` (75 structs),
`jobs.json` (25 jobs / consumers / producers), `api-amazon-calls.json` (177 client calls, the
ads-api → Amazon call map). Nothing here is code from the legacy repo; rules are re-stated as
requirements. Internal product names are generic except in the "legacy source" column of §2.

## 0. What the legacy system is

A Go service (HTTP API + CLI jobs + Kafka consumers) that manages Amazon Advertising for one
company: about 60 Amazon "profiles" (one per marketplace/seller account), three ad products
(Sponsored Products SP, Brands SB, Display SD), one shared Postgres schema, and a lot of data it does
not own.

Four facts shape everything seller-hub must replace:

1. **It never calls Amazon directly.** Every Amazon call goes to an internal proxy that holds the
   LWA credentials and mirrors Amazon's paths (D52). ads-api sends only a proxy token, the profile id
   (`Amazon-Advertising-API-Scope`) and a regional endpoint hint. 149 of the 177 client calls map
   1:1 to a public Amazon Ads **v0** operation (matched against `catalog/ads/operations.json`).
2. **27 calls are not Amazon Ads API calls at all.** They drive the Amazon Ads *console's private
   endpoints* (a GraphQL bootstrap, a `retrieveReport` report gateway, `cm/...` and `sd/api/v1/...`
   routes) with the browser cookie of a real console user, fetched from an internal "cookie bot"
   service, plus CSRF tokens scraped from the console. ("Prime mod" / real-time mode in the UI.)
   seller-hub must not copy this (§3, trap 1).
3. **The data behind the grids is not from Amazon in real time.** Metrics (spend, sales, ACOS, TOS
   impression share, placement, search terms) are read from a reporting database filled by someone
   else's ETL; the out-of-budget feed is the Amazon Marketing Stream `budget-usage` dataset landed in
   that database.
4. **The automation does not decide anything.** "Bots" (budget, bids, search-term harvesting,
   campaign creation, budget recommendations) are models outside this repo that write work queues into
   warehouse tables; ads-api validates, calls Amazon, and writes a status back. The decision logic is
   not in the repo and is the biggest gap seller-hub has to design (§1.7).

## 1. Domains and business rules worth keeping

Rules are phrased as requirements for seller-hub ("shall"). "Amazon" means the Ads API unless stated.
Every rule below was seen in code or in the legacy SRS; where it is only an intent in the SRS it is
marked *(SRS)*.

### 1.1 Account scope, users, roles, portfolio permissions

- A request is scoped to **one Amazon profile** (header `AProfileId`), then checked for a role in
  that profile. Roles: module admin, organisation admin, profile admin, campaign view, campaign edit
  (implies view), report view, notification edit, portfolio view/edit/create.
- Campaign writes also need **portfolio edit** permission: a user may only see/act on the portfolios
  assigned to them. Organisation admins see all portfolios read-only.
- Role grants are unique per (email, role, role group, org, item, profile). Users and grants were
  mirrored from a corporate portal through events; the app also had a local user + department table.
- seller-hub: tenants own seller accounts; roles per tenant and per seller account; **portfolio is an
  Amazon object** (`portfolioId`) so portfolio-level permission is a good, Amazon-native grain.
  Keycloak/portal/department concepts are internal (§2).

### 1.2 Campaigns

- List/search/filter with metrics, detail, create, update, state change (enabled / paused /
  archived), bulk update with per-item result, clone (same profile and **across profiles/
  marketplaces**, with keyword translation to the target language), delete = **archive** (Amazon has
  no hard delete).
- Campaign **name unique per ad product** before create/update. Creating is **locked** (5 minutes) per
  name+type to stop double submits.
- Start date cannot be moved into the past; an already-past start date is immutable; end date >= start
  and >= today; **campaigns that ended** have restricted budget/state changes.
- Creating a campaign creates the whole tree (campaign → ad groups → ads → keywords/targets) in one
  user action. If Amazon succeeds and the local write or the audit log fails, the code tries a
  **compensating archive/delete** on Amazon (no outbox; failures leave drift).
- Manual budget edits can be **blocked while an automation owns the budget** (budget rule engine rule, BR-007).
- Placement bidding: three percentages per campaign (top of search, rest of search, product pages);
  SB has bid adjustments by placement and shopper segment; SD has audience/cohort bidding.
- Every write produces a user-activity log and an operation log (§1.10) and invalidates caches.
- Batching limits seen: 99 portfolio ids per live campaign query; 10 campaigns per budget-rule
  assignment; automation batches of 100 (SP) and 10 (SB).

### 1.3 Ad groups, product ads, creatives

- Ad group name unique within a campaign; default bid; SP target type auto/manual; SB/SD creative type.
- Product ads: create one or many (bulk returns per-item success/error), update, state change;
  **ASIN eligibility** is recorded (status + extended reason) and exportable as an
  "ineligible ASIN" list.
- SB creatives: video, brand video, store spotlight, product collection (+ extended); SD creatives with
  asset upload/search/register, ad previews and **moderation results** (policy violations) per ad.
- Brand store lookups (stores, store pages, ASINs on a page) feed store-spotlight and landing-page pickers.
- Creative edits are versioned (`creative_histories`).

### 1.4 Keywords, targets, negatives, recommendations

- Keywords (match type, bid, state) and product/category/audience targets with expression lists;
  negative keywords and negative targets at ad-group level; negative keywords/products at **campaign
  level** (SP). Bulk create/update with per-item results; duplicates (same text+match type, same
  expression) rejected; archived items are ignored in duplicate checks.
- Recommendations surfaced in creation flows: keyword (ranked), bid (theme based),
  product, category (+ refinements), product counts ("how many ASINs match"), brand (negative brands
  search/recommend), SB keyword/theme, SD target and audience.
- A keyword translation helper (LLM, model name hard-coded) translates non-US keywords/search terms to
  English; results are cached in `keyword_translates`.
- Competitor target products come from a warehouse table, not from Amazon.

### 1.5 Budgets

Two different things share the word "budget":

**a) Amazon budget rules** (Amazon objects): create, update, enable/disable (state/status), assign and
unassign to campaigns, list campaigns of a rule, rule-by-id, "all rules for advertiser", multi-create
(`create-multiple`), bulk assignment; duration is date range or event, recurrence daily/weekly/
monthly/intra-day, `performanceMeasureCondition` (metric/operator/value) and `budgetIncreaseBy`
(type/value). `aws_rule_id` unique locally. A rule can be created once for many profiles in one request
(`profileIds`). Budget recommendations per campaign (rule suggestions and an "events" feed of
rule triggers) are read from Amazon.

**b) Budget recommendations from a model** (internal): a warehouse feed with current vs recommended
budget, department, country group, segmentation, action. The UI lets a user **approve** (optionally edit)
a recommendation; the confirmation is written back to the feed and the campaign budget is updated.

**c) Out-of-budget (OOB)**: campaigns or portfolios reaching `budget_usage_percentage >= 100` (Marketing
Stream budget-usage) are (i) listed in an OOB log with campaign runtime, (ii) notified to every user who
has access to that portfolio (distinct email per profile, one notification per user), and (iii) can be
**topped up automatically** by the budget rule engine queue (final budget input vs last budget, with processed flag
and error text). Two notifier versions exist (v1 3-day window, v2 campaigns + portfolios).

**d) Internal budget accounting** (company-specific, see §2): monthly budget approved by a finance
ticket per team/profile/platform; a daily job compares spend with it and alerts. seller-hub equivalent
is a user-entered monthly cap per seller account / group, compared with spend from reports.

### 1.6 Bidding rules and optimisation rules

- **Bidding rule (app-side scheduler):** per campaign: metric field + date range + operator + value;
  action = raise/lower placement bid percentages (PP / ROS / TOS) by value; recurrence = date window and
  a daily time-of-day window. Evaluation (every run): outside the window → restore saved original
  percentages and mark the rule paused; inside the window and `metric (op) value` becomes true and the
  rule was not running → apply action (percentages floor at 0) and mark running; rule running and the
  condition no longer holds → restore and re-enable. Time is the profile's marketplace time zone.
  Action types are listed by action (`action-type/:type`); a delete restores the saved percentages.
- **Optimisation rule (Amazon object):** SP bid/CPC optimisation rules and SB optimisation rules,
  created and associated to campaigns; bulk create/update. Removing an association relies on a console
  endpoint (no public operation found: unresolved, see api-amazon-calls `UnAssignOptimizationRuleAWS`).

### 1.7 Automation (decision logic missing from the repo)

Executors that exist and must be reproduced; the *decision* models do not exist here.

| Automation | Executor does | Inputs the new system must compute itself |
| --- | --- | --- |
| Auto negative search terms ("bad") | add search term as negative keyword or negative product target, per profile × ad product × adding type; skip when the same negative exists as keyword or target counterpart; SD unsupported; archived items ignored; status 3=pending → ok/fail + error type; optional per-row `confirm to action` | which search terms are "bad" (waste: clicks/spend without orders over a window); thresholds per account |
| Archived negatives | remove (archive) negatives the model un-flagged | when a negative becomes "good" again |
| Good search terms | add as keyword (SP/SB) or target with bid and match type; skip duplicates | which terms qualify (orders/ACOS window), initial bid |
| Auto bidding | set keyword/target bids; batch by product type | target ACOS/ROAS bid model |
| Auto budget | set campaign daily budget and the three placement percentages | budget allocation model per marketplace/department |
| OOB top-up | raise budget when a campaign runs out early | when and how much (cap, daily limit, undo) |
| Auto campaign creation | create campaigns from specification tables (campaign, ad groups, ASIN ads, keywords/targets, strategy, placement %, budget) | which ASINs/keywords get campaigns (launch playbook) |
| Inventory auto-stop | pause every product ad of an ASIN when it is out of stock in a country; feature-flagged; pause only, never re-enable | stock signal per ASIN × marketplace (SP-API inventory) and re-enable policy |

Rules to keep: every executor is **idempotent per row** (status column), marks rows pending before
work, writes an error type on failure, reports start/end/summary to a chat room, runs as a named
automation user in the audit log, and respects "confirm to action" when set.

### 1.8 Reporting and search terms

- Grids and charts at five levels (campaign, ad group, ad/ASIN, target, keyword) plus portfolio and
  product (ASIN) level, each with: list, count, **count vs previous period (compare)** and a time-series
  chart; sort/filter config served by `/configs/aws-filter`.
- Metrics: spend, sales, units, clicks, impressions, orders, CTR, CPC, ACOS, ROAS, CR, CPM, CPO, CPU,
  AOV, top-of-search impression share, OOB %, plus a **placement breakdown**; spend/sales converted
  to a reporting currency by country ("USD" columns); last data date is shown ("freshness").
- Search terms: list from the search-term report with flags "already added as keyword / target /
  negative keyword / negative target" per ad group, selection for harvesting, totals, ad-group info, and
  **impression share/rank detail** per term (null if absent).
- Product-level view joins ad data with inventory/days-of-cover, GMV/affiliate/promotion metrics and
  SKU lifecycle (internal sources, §2).
- Spend dashboards (`report/get-spend`, by date, performance by date) are per profile/team.

### 1.9 Alerts and notifications

- **Campaign drift alert:** compares Amazon vs local state per profile and product and posts a chat
  summary (parts of the code are commented out).
- **Inventory alert:** an upstream engine raises alerts (ASIN/SKU/country, level, days of cover,
  triggered rules JSON). The app stores them, notifies the responsible users (in-app), shows a list and
  accepts user feedback (a comment) per alert; action `AUTO_STOP_ADS` can also pause ads (§1.7).
- **Notification incidents:** admin-created banners (profiles, priority, severity colour, recurrence).
- **Tickets:** a mirror of an internal ticketing system (list/detail/update/mark read/log); content is
  not stored, only read/marked state.

### 1.10 Activity / audit logs, exports, download history

- Every write records: who, when, entity (campaign/ad group/...) with before→after per field,
  profile, trace id. A second log records operation-level events and bulk-request results (per item).
- Logs are searchable with filters (served from a search index in legacy; a plain table is enough).
- Excel export of logs and of ASIN-status lists; each export has a **download history** row (status,
  name, URL, range, error) and the file is stored in object storage with a download URL.

### 1.11 Cross-cutting behaviour worth keeping

- Redis cache with explicit invalidation after writes for Amazon-derived reads (campaign lists, rule
  lists, recommendations, store pages 5 min).
- A per-request **trace id** in every response and every log line.
- Soft-delete + created/updated/deleted by/at on every table (audit trail).
- Bulk endpoints always return per-item success/error.

## 2. Replacement map

One row per external dependency. "Status": **resolved** (Amazon source identified), **user input**,
**drop**, **design** (no external source; seller-hub must build the capability), **unresolved**.
SP-API identifiers are named from knowledge of the SP-API and must be confirmed by `catalog/spapi`
(P1-SPAPI) and the Ads catalogue (P1-ADS).

| # | Legacy source | Supplied | Features depending on it | seller-hub replacement | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Internal Amazon proxy — public paths (149 calls) | LWA auth, region routing, forwarding of SP/SB/SD v0 operations, response envelope `{mess, code, legacyTenantCode, data}` | every create/update/list of campaigns, ad groups, ads, keywords, targets, negatives, rules, recommendations, creatives | Call Amazon Ads directly with each seller's LWA token (D52): `Authorization`, client-id header, `Amazon-Advertising-API-Scope` (v0) or `Amazon-Ads-AccountId` (v1), regional host per account. Entities on **v1** (D53): `{SP,SB,SD}{Create,Query,Update,Delete}{Campaign,AdGroup,Ad,Target}`; negatives = targets with `negative=true`. Named **v0 exceptions**: portfolios, budget rules (+ events/association), optimisation rules, all recommendation endpoints, moderation, audiences/targetable entities, product metadata, standalone SB/SD creatives, creative asset library, SB `listAsins`. See api-amazon-calls `v1Operation` | resolved |
| 2 | Internal Amazon proxy — console-private paths (27 calls) | live grids with metrics for campaigns, ad groups, ads, targets, search terms, placement, audience performance | "Prime mod" real-time mode | **Drop.** Entities from v1 `Query*`; metrics from Ads reports (v1 `AdsApiv1CreateReport`/`Retrieve` if coverage is enough, otherwise v0 Reporting v3 `createAsyncReport`: `spCampaigns`, `spAdGroups`, `spTargeting`, `spSearchTerm`, `spAdvertisedProduct`, placement group-by); near-real-time spend via Marketing Stream. Per-call guidance in api-amazon-calls | resolved (field coverage to confirm in P1-ADS) |
| 3 | Cookie bot / console session service (+ cookie cache, `backup-cookie` endpoint) | the logged-in cookie of a real person for the console | everything in row 2 | **Drop.** Violates Amazon's terms and breaks on every console change; no equivalent needed | drop |
| 4 | Profile list CSV (profile → team / category / marketplace) | internal grouping of profiles into teams and categories | budget job, team dashboards, department filters | User-defined **groups/tags** of seller accounts per tenant | user input |
| 5 | App Postgres (campaigns, ad groups, ads, targets, rules, logs, roles, ...) | local mirror of Amazon objects and app data | all screens | seller-hub DB (P2-DATA); `amazon-mirror` entities keep Amazon ids; every row gets `tenant_id` + `seller_account_id`; full pull replaced by v1 `Query*` with paging + change polling | design |
| 6 | Reporting DB (warehouse replica: daily spend, orders by ad group / ASIN / campaign top-of-search, target & keyword reports, promotion spend, placement, search-term report, category tree, ad eligibility) | all metrics in grids/charts/compare | reporting grids, dashboards, search terms | Ads reports (row 2 list) ingested by worker into own tables on schedule; for freshness subscribe to Marketing Stream `sp-traffic`, `sp-conversion`, `sb-*`, `sd-*`. Currency conversion stays an app rule | resolved |
| 7 | Reporting DB — stream budget-usage table | OOB feed (`budget_usage_percentage`, scope campaign/portfolio) | OOB log, OOB notifications, auto top-up | Marketing Stream dataset `budget-usage` (SP/SB/SD, campaign + portfolio), delivered via SQS/Firehose; fallback: v0 `POST /portfolios/budget/usage` and polling. **Stream v1 is on a deprecation path, shut-off 2027-06-30** (docs) — design the ingest behind an interface and check the v1 `streamSubscriptions` operations | resolved (re-check Stream v2 timeline) |
| 8 | Reporting DB — product metadata query | title/image/price for ASINs | product pickers, product grid | Ads `ProductMetadata` (v0) for ad eligibility + SP-API Catalog Items (`getCatalogItem`/`searchCatalogItems`) for titles/images | resolved |
| 9 | Warehouse (CDH) — saleable inventory, days of cover (DOC), GMV, affiliate, promotion metrics, SKU performance, SKU → department | product grid inventory columns, "ASINs by DOC" filter, inventory alerts, department filters | product view, alerts | Inventory: SP-API FBA Inventory (`getInventorySummaries`) (`GET /fba/inventory/v1/summaries`; no FBA inventory report type exists in `catalog/spapi/reports.json`, so none is named); sales: `GET_SALES_AND_TRAFFIC_REPORT` or Data Kiosk (`salesAndTraffic`); DOC computed in seller-hub from sales velocity; **COGS = user input**; GMV/affiliate/promo/SKU performance/department: company-specific model data → drop or user input | resolved (inventory, sales) / drop (rest) |
| 10 | Warehouse (CDH) — impression-share summary per search term | rank/share for a search term in an ad group | search-term detail drawer | Ads search-term report columns `searchTermImpressionRank` / `searchTermImpressionShare` (present in the Reporting v3 docs) for advertised terms; Brand Analytics Search Query Performance (SP-API report `GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT`, needs Brand Registry) for market share | resolved (coverage to confirm) |
| 11 | Datamart — inventory alert metrics master + upstream inventory-alert engine (Kafka) | alert events per ASIN/country with rules | inventory alerts, auto-stop ads | seller-hub inventory rules over SP-API inventory (rows 9); SP-API Notifications (`FBA_INVENTORY_AVAILABILITY_CHANGES`) for push; pause/resume actions via v1 `SPUpdateAd` state | design |
| 12 | Warehouse automation queues (`legacy automation store: *`) + the bots (budget, bid, search-term, campaign creation, budget recommendation) | the decisions | all of §1.7, budget recommendations approval | **A rules/automation engine inside seller-hub** (user-configurable rules and thresholds, dry-run, approval step = existing `confirm to action`, audit). Amazon-native building blocks: budget rules, optimisation rules, Ads `Recommendations` feed. Not copyable: the models are company IP | design |
| 13 | Kafka — automation triggers (budget, target bid, create campaign, create/delete negative search term, add keyword) + DLQs | decoupling bot → executor | automation | BullMQ queues in the worker; retries/failed jobs replace DLQ + `kafka_failed_histories` + `repush` | resolved |
| 14 | Kafka — notification topics (in, out) and the notification platform | in-app notification bus (OOB, inventory, tickets) | notifications | `notifications` table + SSE/websocket + email; no external bus | design |
| 15 | Kafka — user/operation activity topics → search index | audit trail + search | activity log screens | append-only `audit_log` table (tenant scoped); Postgres full-text if needed | design |
| 16 | Kafka — portal permission events | user ↔ role sync | RBAC | own users/roles/invitations per tenant | drop |
| 17 | Redis | cache (auth, profile, campaign lists, rules, recommendations, report), locks, cookie store | latency, create-campaign lock | Redis (already planned for BullMQ) for cache + locks; no cookie store | resolved |
| 18 | Identity provider (Keycloak token verification, bypass token for non-production) | user identity | login | Auth owned by seller-hub BFF (tokens never reach browser, per P3); no static bypass token | design |
| 19 | Corporate portal / user directory (users, departments, roles) | who a user is, which department | RBAC, filters, emails for notifications | seller-hub users; departments become optional user groups | drop |
| 20 | Ticketing system (tickets list/detail/update, mark read) | work items linked to ASINs | tickets screens | not an Amazon capability; if wanted, a native task/comment feature | drop |
| 21 | Product lifecycle service (SKU lifecycle by platform/country) | SKU status, department (e.g. skip one department for alerts) | inventory alert filter | SP-API Listings Items (`getListingsItem`: status, issues) | resolved |
| 22 | Catalog service (ASIN ↔ SKU map, SKUs by person in charge) | SKU for ASIN, responsibility | product grid, alert recipients | SP-API Listings/Catalog + FBA inventory (seller SKU per ASIN); **person-in-charge = user input** | resolved / user input |
| 23 | Object-storage wrapper | Excel upload and URL | exports | own object store (S3-compatible) + signed URL, or stream the file | resolved |
| 24 | Search index (activity logs) | search | log screens | row 15 | design |
| 25 | Chat webhook (GG Chat) and mail service | automation summaries, error events, budget alerts | automation, budget job, alerts | tenant-configurable channels (email, Slack/Teams webhook); errors go to the app's own log, not to a chat room | design |
| 26 | LLM client (keyword/search-term translation, model name hard-coded) | English translation of non-US keywords | clone across profiles, search-term view | optional feature behind a setting and a provider key per tenant, or drop | drop / optional |
| 27 | Competitor target product table | competitor ASIN suggestions | product-target picker | Ads product/category recommendations (v0 `getProductRecommendations`); the table itself is company data | drop |
| 28 | Internal budget ticket flow (`budget_accounts`, daily budget report) | approved monthly budget per team | budget job, dashboards | user-entered cap per seller account/group vs report spend | user input |
| 29 | Brand Stores console endpoints (list stores/pages, page ASINs) | store pickers | SB store-spotlight, landing pages | v1 `QueryBrandStore` / `QueryBrandStorePage` (`/adsApi/v1/query/brandStores`, `.../brandStorePages`); SB `listAsins` stays v0 | resolved |
| 30 | Amazon Business (B2B) placement report (console) | B2B placement metrics | campaign placement tab | Ads reports; check B2B coverage | unresolved |
| 31 | Disassociate SP optimisation rule from a campaign (console endpoint) | removing a rule | optimisation rule edit | no public operation found in v0/v1 catalogue; try re-associate/replace or delete the rule | unresolved |
| 32 | Profile discovery (`/v2/profiles`) | list of accessible profiles with country, account info | account selection, region/marketplace mapping | v0 `listProfiles` (still needed for the profile id scope) and v1 `QueryAdvertiserAccount` / SP-API `getMarketplaceParticipations` for seller ids | resolved |

Unresolved / needs another task's catalogue: rows 2 (v1 report field coverage), 7 (Stream v2
timeline), 10, 30, 31. Row 12 is not an Amazon gap but a product decision (how much automation ships
in the MVP) for P1-SCOPE.

## 3. Traps the legacy system records that seller-hub should design out

1. **Console scraping.** 27 of 177 Amazon calls use a person's browser session and private endpoints
   with scraped CSRF tokens; one of them even scrapes the console landing page for an entity id. Use
   official APIs only.
2. **Errors answered with HTTP 200.** The response helper has a variant that returns status 200 with
   an error message inside; bind errors do the same; the Amazon proxy envelope returns `code` inside a
   200. Clients must check a field. Use real HTTP status codes and a typed error envelope.
3. **Request logging captures secrets.** The access logger dumps the whole request (including
   `Authorization` and cookies) and the response body for every non-skipped route; the generic
   forwarder logs the headers it forwards. Redact by allow-list; never log tokens or PII.
4. **Unauthenticated operational routes.** 4 external routes sit before the auth middleware
   (campaign and ad-group lookup by Amazon id, health info, check-file). On `/api/internal`, the group
   registered *before* the internal-token middleware (34 of 39 routes) exposes Redis get/set/delete/keys,
   a raw-DB runner, a migration trigger, 18 sync/automation triggers (`migrate/*`), a budget-request
   publisher, a bidding cron, a user migration and `test/*`. The routes behind the internal token include
   a generic HTTP forwarder (`api-interface/call`) that takes URL, method, headers and body from the
   caller (open proxy / SSRF). Authenticate every route; no generic forwarders.
5. **46 external routes have no role check** (any authenticated caller passes the route): all
   `/rules/*`, most `/budgets/*`, `/report/*`, user/operation/request logs, audience lists, SB
   recommendations, the inventory alert list, profile and role lists, store lookups and `sd/:id/creatives`.
   Default-deny at the router; one test per route that proves the ACL.
6. **Debug leftovers in the production router:** `profile/get-profile-wrong`, `profile/test-profile`,
   `profile/call-profile` (the client GETs its own localhost with a hard-coded dummy bearer),
   `health-check/check-file`, `internal/test/*`, `budgets/run-job` (a GET that triggers the budget-report computation),
   a hard-coded numeric profile id for non-production in the inventory auto-stop path.
7. **Static bypass/secret defaults.** A non-production bypass token and secret-like defaults in the
   config struct (SRS R-001, FR-001). Config must fail closed; secrets only from env/secret store.
8. **Handlers talking to Amazon directly** (target recommendation handlers call the client, skipping
   usecase checks and ACL). One path to Amazon, behind permission checks.
9. **Dual-write without outbox.** Amazon + DB + cache + audit + Kafka are written one after another,
   with best-effort compensation. Make the Amazon response the source, store the result in the same
   transaction as the intent (outbox), and reconcile.
10. **Full re-pull sync.** The "migrate" jobs fetch everything for every profile with no incremental
    state. Use v1 query filters/paging and last-sync markers; respect 429 / throttling.
11. **No tenant column.** The profile id is the only scope and the whole company shares tables, caches
    and queues. seller-hub: `tenant_id` + `seller_account_id` on every row, every key and every job.
12. **Business logic that is really company data:** department "SFO" skip, team CSV, named bots,
    hard-coded model name for the LLM, test profile id. Keep such things as tenant settings, not code.
13. **Two copies of the API** (`/api/external` and `/api/external/:typeApiParam`) share handlers; only
    the budget handlers read the path value. One route set; product type as an explicit parameter.
14. **Kafka consumer details:** DLQ consumer-group ids are hard-coded test-like values; failures are
    pushed to a DLQ and also stored in a table; replay is a manual CLI.
15. **Unbounded and unstable batching:** sizes (99, 10, 100) are literals; no central throttling per
    Amazon quota. Put limits in one place, per operation, from the spec (`batchMax` in the catalogue).
16. **Data model by convention.** One table for three ad products with a type column; Amazon ids as
    strings; JSON columns for rules; only one SQL migration exists, everything else is GORM auto-schema.
    seller-hub: migrations from day one, typed enums from Amazon's models.
17. **Third-party LLM receives customer keywords** without a setting or consent. Make it an explicit
    opt-in, per tenant.
18. **Soft-delete everywhere but no retention policy** (SRS NFR-DATA-001). Define retention for logs,
    exports and notification data; PII rules per D11.

## 4. Coverage

- Route files: `router/external.go` (212 registrations) and `router/internal.go` (39) → all in
  `api-endpoints.json`; mounted-twice rows carry `mountedAlsoUnder`.
- Handlers: 36 external + 10 internal handler files → each appears in at least one row (`handler` field).
- Entities: 75 structs listed in `entities.json` (17 amazon-mirror, 19 app-owned, 39 internal incl.
  read models); remaining ≈85 structs are JSON column types or DTOs.
- Jobs: 15 Cobra commands (13 jobs/services as rows; the two consumer commands are represented by their 11 consumers) + 1 producer family → `jobs.json` (25 rows).
- Amazon call map: every client function in the Amazon client package that issues an HTTP call (177).
  Helper packages under `pkg/xservice/aws/utils` and the request/response models were read for
  headers and shapes only.
- External services (`pkg/xservice/*`: Amazon client, Keycloak auth, product lifecycle, ticketing,
  portal, catalog, object storage, search, chat, mail, LLM, API-interface, chatbot) → §2 rows
  1–3, 16, 18–27.
- Not read in depth: `services/ads-export` (a separate export module with its own architecture test;
  only its existence is noted), `learn/` (experiments), `learn/ads-export/lab`.
