# Legacy web app — feature inventory (P1-WEB)

Source: the legacy advertising web UI (`ads-web`, Next.js Pages Router, read-only, clean room per D0).
Machine-readable twin: `catalog/legacy/web-features.json` (26 feature entries covering every route),
`catalog/legacy/web-ux-rules.json` (26 UX rules), `catalog/legacy/web-non-feature-routes.json`.
Everything below is a **requirement** in my own words; no legacy code, comments or internal names are reused.

How the evidence was gathered: the legacy repo ships its own functional/API specs and a codebase
overview; I read those first, then spot-checked the code (column/metric config, tooltips, constants,
service files). Each claim is marked by confidence in the JSON/report: `spec` (documented and
cross-read), `code` (seen in source), `partial` (service files only), `INFERRED` (standard formula,
not stated in the product).

Legend: **[Amazon]** = write/read goes to Amazon Ads API; **[internal]** = legacy-company-specific concept,
with a note on a generic equivalent; **[both]** = v1 and v2 of the screen coexist in the legacy app.

## 0. Platform behaviours that apply everywhere

- **Profile = one advertising account in one marketplace** (country, currency, time zone). Every request
  carries the profile id; switching profile invalidates all cached data. Active profile: URL param, then
  saved choice, then first in list; mirrored into URL + cookie. Unknown profile id in URL -> chooser dialog.
  seller-hub equivalent: `seller_account_id` + marketplace (tenancy rules in CLAUDE.md).
- **Marketplace constraints are data, not constants**: budget min/max per ad product and account type,
  bid min/max, site restrictions, hour-of-day availability come from per-profile config. Hard-coded
  fallbacks in legacy: campaign budget 1..1,000,000; bid 0.02..10,000; portfolio-campaign budget 0.02..10,000
  (portfolio screen only). seller-hub must read limits from Amazon/marketplace metadata.
- **Time zone**: "today", calendar ceilings, default 30-day range, start-date minimum use the profile zone.
- **Roles** (per profile): campaign view, campaign edit, portfolio create/edit, notification edit, admin.
  Admin implies everything; no implication edit => view. A missing per-entity `isEdit` flag means read-only.
  Write controls are hidden without permission and disabled-with-reason when the entity forbids.
- **Auth**: Keycloak in browser today; BFF (httpOnly session, PKCE, server proxy for `/api/backend` and
  `/api/portal`) built but flagged off. BFF is the pattern to keep. [internal: Keycloak]
- **Realtime vs stored**: the legacy keeps a stored copy of Amazon data (stale, richer metrics, history)
  and a separate "Real-time mode" that reads/writes Amazon directly for Delivering/OOB campaigns.
  See section 12 — this is a scope decision for seller-hub, not a UI detail.
- **Write semantics to respect**: campaign and ad-group PUT replace the entire record; placement bidding
  is a whole-set array; bulk writes return 200 with per-row failures (`totalSuccess = 0` is rejection);
  archive = DELETE; SD uses lower-case state values, SB/SP upper-case.

## 1. Home (`/`) — issue dashboard [both]

What/why: first screen; surfaces work that needs attention today.
- Three stat cards: Assigned Issues [internal tickets], Total ASIN Out Of Stock, Total Product Ads Ineligible
  (+ "Prev last days: N" caption). Download ineligible-ASIN report -> opens Reports.
- Four "Your issues" tables (skeleton rows 4/4/4/3, each fails independently with Retry):
  1. Campaigns almost/out of budget — top 4 by out-of-budget percent;
  2. Keyword targets with abnormal ACOS increase — last-7-day ACOS rose >= 15 points; top 4;
  3. Product targets with the same rule; 4. ASINs with the same rule (top 3).
  Each metric column header is a menu to swap the metric (menu lists unused metrics; session-only).
- Toolbar: campaign search, dynamic filters, date range (no Life time), "Show last 30 days".
- "See all" opens the target page in a new tab with the filters/dates carried (pageSize 50).
- Second tab embeds an external BI report [internal]. Search/filter/date are intentionally not in the URL.
- Generic version: yes — "needs attention" lists driven by Ads + SP-API data (OOS ASINs via inventory). The
  ticket card and BI embed are internal.

## 2. Campaign listing — Sponsored Ads manager (`/campaign`, `/campaigns`, `/campaigns/{type}`) [both][Amazon]

Five tabs share one page: **Campaigns, Ad groups, Product ads, Targeting Keywords, Targeting Products & Auto**.
Header: four metric cards (Spend, Order, Sale, Impression) with a Show-chart toggle; toolbar: Filter, search,
date range with presets (Today, Yesterday, Last 7 days, Last week, Last 30 days, This month, Last month, This year,
Life time) and **Compare data** (End defaults to Start + range length), Export, Create Campaign, column menu,
fullscreen; table with a Total row; pager with 5/10/15/20/25/30/50/100 rows.

**Campaign columns (default order = old product):** Active switch · Campaign name (link, rename, row menu Copy) ·
AWS name · Status · Type (+ targeting kind on line 2) · Portfolio (link; literal "No Portfolio") · Bidding strategy ·
Start date · End date (inline) · Budget (inline; caption "Daily|Lifetime - Recommend $x") · Top-of-search IS ·
then metrics (below). Recommendations and Daily max budget columns were deliberately dropped in v2.

**Metrics** (restated; those with no definition in the UI are flagged):

| Metric | Meaning |
| --- | --- |
| Spend | total click/impression charges; invalid clicks removed for up to ~3 days |
| Orders | orders attributed to ads (14-day window; SP = advertised + brand products sold by Amazon, SB/SD wider); cancelled/failed payment removed after ~72 h; data lag up to ~12 h |
| Sales | sales value attributed to ads, same attribution rules |
| Clicks / Impressions | counts |
| CTR | clicks / impressions |
| CPC | average cost per click |
| ACOS | spend / sales |
| ROAS | sales / spend |
| Top-of-search IS | share of eligible top-of-search impressions received; SB+SP only; last 90 days; SP = first page |
| CR, CPM, CPO, CPU, AOV | **INFERRED** standard formulas (orders/clicks, spend/impr x1000, spend/orders, spend/units, sales/orders); computed by the backend; four of them are not filterable in the backend (shown with a Beta chip in filters) |
| Extended SB/SD | detail page views, Brand Store page views, NTB orders / sales and their % shares, long-term sales and ROAS; plus Display "plus" metrics: cumulative reach, household reach, cost per 1000 viewable impressions |

**Actions**
- Switch Active (spinner on row, toast; locked if archived/ended/end date passed/no permission; tooltip says why).
- Inline: rename, Budget (within marketplace bounds; click "Recommend $x" -> confirm), End date (or No End Date). Edits send the
  full record; Total row recomputed after a budget edit.
- Bulk on Campaigns (selection max 300, kept across pages): Enable, Pause, Archive (irreversible), Adjust budget,
  Portfolio > Move / Remove, Copy to another profile. Disabled-with-tooltip rules and confirm texts are in the JSON.
  Adjust budget rules: +$, +%, set to $, -$, -% (rounded to cents, result must be > 0; money = digits + one dot, percent = integers).
- Bulk on Ad groups: Enable/Pause/Archive; Product ads: Enable/Pause; Targeting tabs: Adjust bid, Apply suggested bid
  (disabled when bids are owned by cost control or none has a suggestion), Adjust state (Enabled/Paused/Archived). Child tabs max 100 selected.
- Copy campaign (same profile): name, dates, "pause new campaign after creation". Copy to another profile: target account (not current),
  default start today, no end date; does **not** copy budget rules, automation rules or creatives.
- Export: client xlsx of selected rows else current page, visible columns only; or background export (up to 1000 selected).
- Create Campaign: objective chooser (SP/SB/SD); seller accounts can pick only SP, SB/SD shown dimmed.
- Column menu (show/hide, reorder, pin left/right, resize; stored per browser).

**Endpoints:** `campaigns/get-list`, `ad-group/get-list`, `product-ads/get-list`, `target/get-all-targeting`,
`campaigns/update-multiple`, `PUT campaigns/{id}`, `ad-group/update-state`, `product-ads/update-state`,
`keyword|target/updates`, `campaigns/clone`, `campaigns/clone-from-profile`, `portfolio/list-for-filter`, `exports`.
URL state: tab, per-tab prefixed listing state, dates/compare, page size, selection; v1-compatible links.

## 3. Create campaign — Sponsored Products (`/campaign/create`, `/campaign/create-sponser-product`) [both][Amazon]

One long scrolling page, sections appear progressively; submit button lists up to 6 blockers.
1. **Campaign settings**: name (required, <=117, none of `! # % <` `>`; default "Campaign - timestamp"), portfolio (enabled only, optional),
   start (not before today in profile zone, not after end), end or "No End Date", country (locked), budget (1.00..1,000,000.00; 2 decimals).
2. **Sites** (only if the profile permits): Amazon and beyond | Amazon Business.
3. **Bidding strategy**: dynamic up and down | dynamic down only (default) | fixed.
4. **Bid adjustments**: placements top of search / product pages / rest of search (0..900 %), Amazon Business placement switch
   (hidden for Amazon-Business-only; 0 % row not sent), audiences (pick + 1..900 %).
5. **Ad group**: name (<=244).
6. **Products**: Suggested list (10/page, search, Add), Enter list (paste ASINs), Upload file; rejections itemised
   (invalid length, duplicate, non-existent, ineligible); added table with Export / Remove all; >=1 required.
7. **Targeting** (appears after >=1 product): Automatic (default bid, or bids per group: close match, loose match, substitutes,
   complements; >=1 group on; disabled groups sent Paused) | Manual keyword (suggestions with Broad/Phrase/Exact bids, Add / Add All,
   paste/upload with pricing, missing-suggestion prompt, <=150 rows, char/word limits) | Manual product (categories tree with brand refine, individual products, <=150).
   Bid valid range = [marketplace min, min(max bid, budget)].
8. **Negative targeting**: negative keyword (exact/phrase, <=200) and negative product/brand (<=200); hidden sections are never sent.
9. **Launch**: confirm dialog "Set State for Campaign" (Enable/Pause), then create. Blocked with a toast while marketplace limits are loading.
   Success -> list; failure -> error dialog with status, message, copy button.
Endpoints: `POST campaigns`, `keyword/get-recommend`, `target/get-bid-recommend`, `target/get-product-recommend`, `category/get-recommend|get-list|get-refine`,
`audience/get-list-audience/{type}`, `negative-target/brand-search|brand-recommend`.

## 4. Create campaign — Sponsored Brands and Display [both][Amazon]

**SB** (`/campaign/create-sponser-brand`): goal first (Drive page visits = CPC; Grow brand impression share = vCPM, changing goal confirms and
resets dependent sections); campaign settings (Daily|Lifetime budget with per-type bounds); sites; Ad group and Ad (formats Store Spotlight,
Video, Brand video, Product collection; manual collections only; landing page Store vs Detail page for video; ASIN minimums 3/3/1, Store needs 3 subpages
with distinct ASINs; creative: brand name, logo, headline, video, ad title <=32); targeting mode keyword|product (only CPC goal); cost control (target
avg CPC >= 0.50 and <= daily budget, Page-visit goal only); campaign bid adjustments (placement 0..900, audience 1..900). Submit blockers: limits not loaded, video
spec failed/checking. Success shows a review screen ("ad under review, 24-48 h"). No draft is kept.
**SD** (`/campaign/create-sponser-display`): campaign settings; ad group (<=244); bid optimization (reach/vCPM, page visits, conversions;
only same-family options); ad format Image|Video; products (>=1); tactic Contextual | Audiences; contextual rows (>=1, <=150) or audiences (>=1, <=20, lookback each);
bid per row >= 0.02 and < half the daily budget; creative (logo/headline/image switches, off = not sent and not required; video required for video ads, spec-gated).
Endpoints: `POST campaigns` (type in payload), SB recommendation endpoints (`sb/recommendations/keyword|targets/bids|targets/category|targets/products`),
SD assets (`sd/assets/upload`, `register`, `GET sd/assets`), `sd/creatives/preview`.

## 5. Campaign detail (SP, SB, SD) [both][Amazon]

Header: breadcrumb, name, Active switch, facts (Status, Type - targeting, Country, Schedule, Budget). Tabs:
- **Campaign settings** (SB most complete): IDs, portfolio, type, Active + "Archive this campaign" (confirm: deletes the campaign, ad groups, ads, targeting on Amazon; irreversible),
  status, schedule, cost type, budget, goal, cost control. One Save for the tab. Name <=117 (128 if equal to AWS name), no special chars;
  start date read-only once running. SP adds sites (read-only) and bidding strategy; SD cost type read-only.
- **Ad groups**: the ad-group listing pinned to the campaign; Create Ad Group button (hidden without edit permission, disabled if campaign forbids). Bulk actions when editable.
- **Bid adjustment** (SB, SP): All Placement (always shows every placement, absent = 0 %, 0..900), Audiences (rows + "Campaign total", 1..900, "Remove" = set to 0 %, Adjust audience modal, export log -> download link), SP: Amazon Business pill (hidden if campaign is Amazon-Business only). Each panel one Save; saves upsert into the full placement array.
- **Negative targeting** (SP): keywords / products, Add negative targeting, bulk Archive.
- **Budget rules** (all): list, active switch (optimistic), Add budget rule, modal on URL `budgetRule=new|<amazon rule id>`. SB metrics: top-of-search IS, % NTB, ROAS; SP: ACOS, CTR, CVR, ROAS.
- **History**: Campaign History (Level/Type/Action filters, search, export) and Out of Budget History.
- Side tree panel (campaign > ad group > ad), lazy per branch.
Missing record -> "Record not found" modal. SD has 4 tabs only.

## 6. Ad group detail and create ad group [both][Amazon]

Tabs: Ad group settings · Ads · Targeting · Negative targeting · Search term (SB, SP) · History · (SD) Creative.
- Settings: name (<=244/255), default bid (required, marketplace range), Active, Archive (confirm; deletes ads/targeting).
- Ads: product ads table (Active, ad/product, Status, SKU, metrics; SP adds stock-level columns), **Add Products to Advertise** (disabled if first ad ended; SP blocks ASINs already in group), bulk Enable/Pause; SB **Manage Creative** side panel with version history, preview per placement, Edit ad (blocked while in review, up to 72 h moderation).
- Targeting: shared target table; Add keyword / product target (SP auto groups have no add); partial-success handling (`errors` or `totalSuccess = 0` shown as failure).
- Negative targeting: keyword/product pills locked by ad-group kind; Add; Archive (confirm).
- Search term (see section 7).
- SD Creative: video, brand logo, headline, image with on/off switches; "Submit for review" (POST first, PUT after); moderation rejection reasons shown; preview debounced 500 ms.
- **Create ad group** (`/campaigns/{type}/{id}/new-ad-group`, SB and SD): same cards as campaign create minus campaign-level cards; campaign supplies goal/cost type/budget as read-only seeds; success shows review screen (SB).
Endpoints: see JSON (`ad-group/*`, `product-ads/*`, `keyword|target/*`, `negative-keyword`, `sb/creatives/list`, `product-ads/{id}/update-creative`, `sd/{id}/creatives`, `sd/moderation/creatives`).

## 7. Targeting listing (`/targeting`) and search terms [both][Amazon]

Targeting listing: tabs Keywords | Products (incl. auto). Columns: Active · Targeting (translation shown below the keyword for configured countries, e.g. JP) · Type/match · Status ·
Bid (inline) · Sugg. bid · Campaign · Campaign status · Ad group · Products · metrics. Bulk: Adjust bid, Apply suggested bid, Adjust state (Enabled/Paused/Archived).
Confirm copy "Confirm Pause 2 Keywords". Bids locked when cost control owns them. Tooltip definitions: bid = max paid per click; suggested bid = from similar winning bids.
Search terms (ad group tab): customer search term table with "Add as keyword / negative keyword / product / negative product"; product ad groups accept only ASIN terms; drawer "Search term impression rank & share" for 7/14/30 days (`search-terms/get-list`, `impression-share/detail`).

## 8. Portfolios [both][Amazon]

- List `/portfolios` (v2) / `/portfolios/management`: Portfolio (link), Status, Budget cap, Budget start/end, metrics, Modify. One load of up to 500 rows, client paging.
  Create = name only, 2-step confirm, created with **no cap**. Modify = name + cap policy: none | date range (start, end Never|On) | monthly recurring (restarts on the 1st, ends Never|On).
  Create permission is separate (`ads_portfolio_create`).
- Detail: header (status, cap) + campaigns table (columns Active, Campaigns, AWS name, Status, Type, Start, End, Budget, metrics). Bulk Enable/Pause/Archive, Adjust budget (withholds rows leaving 0.02..10,000), Move/Remove portfolio; inline budget/end date/switch; reload after each write.
- `/portfolios/setting*` (users, permissions per portfolio, out-of-budget log) [internal RBAC].

## 9. Budget recommendation, budget rules and bidding rules [both]

- `/budget-recommendation`: SP campaigns with Amazon's recommended daily budget. Extra columns: Avg. time in budget, Recommend budget, Est. missed sales/impressions/clicks. OOB alert card counts campaigns out/almost out of budget today and applies a filter. Apply suggestion with confirm (writes whole record). [Amazon]
- `/rules` (budget + bid rules): merged SB/SD/SP list (Active, Rule, Type, Campaign type, Status, Description, Schedule; 50/page). Create/Edit modal: Budget rule (increase 1..100 %) or Bid rule (adjustment 1..100, no SB); Schedule (date range, daily/weekly recurrence, hours of day only in US, CA, UK, IN, JP) or Performance (metric SP/SD: ACOS, CTR, CVR, ROAS; SB: top-of-search IS, % NTB sales, ROAS; comparison; threshold > 0 and <= 100 except ROAS). Campaign impact picker lists Enabled campaigns of the same type only (backend rejects mixed types). Partial campaign failures shown as warnings. Name <=128.
  Hourly rules warn when daily budget < 10 (UI-only rule). [Amazon: budget rules] [internal: bid rules are an app-side automation]
- v1-only `/rule-campaign`, `/budget-rule`, `/rules/{id}`, `/rules/create-rule`: assign/unassign a rule to campaigns (`{type}/budgets/assign|un-assign`), older create/edit forms; superseded by `/rules`.

## 10. History, reports, export centre [both]

- History: tabs Campaign History (ID, Level link-to-entity, Type, Action, From, To, Date, User; Level/Action tree filter; Export in page / Export all -> background report), History out of budget, Log Request Action (bulk copy-campaign requests with per-campaign result dialog; hidden when scoped to a campaign/ad group). [internal audit of app changes + Amazon OOB events]
- Reports `/reports`: Status chip, Report name, Last run, Report period, Download (SUCCESS + URL only); max 300 rows; no pagination.
- Export centre (flag): background export of table queries, progress ring, auto-download once, cancel, restore, max 1000 selected, max 10 jobs listed.

## 11. Inventory alert, products, tickets, dashboards [both][internal-heavy]

- Inventory alert: Alert ID, Country, ASIN, Inventory level chip (14 levels), Action on ASIN, Has feedback, Send Feedback, Alert time. Search by ASIN/alert id; level multi-select; custom date range only; export selected with feedback detail. [internal engine; generic = stock-risk alerts on advertised ASINs from SP-API]
- Products `/products`: product > campaign > ad group tree, trends drawer, eligibility, inventory/DOC/real sale/TACOS columns, Add to existing campaign (1..10 products), Turn off ads (confirm; rejected ads listed). [internal data sources; generic equivalent exists]
- Product issue tickets: list + detail (Action, Description, Assignee, Due date, On/off, Confirm) [internal workflow].
- `/dashboard-campaign`: Total spend / Total performance charts by date, marketplace and team [team internal; Walmart/Wayfair out of scope].
- `/budget-account`: monthly budget request tickets with manager/finance approval, clone, delete, export [internal finance workflow].

## 12. Real-time mode (`/amazon/*`, `?v=2`) [Amazon]

Live Amazon reads/writes for Delivering and Out-of-budget campaigns only, with a banner explaining it. Campaign list (page size 50 or 100, extended SB/SD metrics, Total budget row), budget edit (1..1,000,000), bulk Adjust budget/Enable/Pause,
targeting list with cursor paging and bid edit (0.02..10,000), campaign detail (Ad Group, Bid adjustment placement 0..900 / audiences / Amazon Business, Negative targeting, Budget rules, History), ad group detail (Ads, Targeting, Search terms). Writes patch cache, rows outside Amazon range are withheld and reported.
Implication: users valued live Amazon data and OOB visibility because the stored copy lagged. seller-hub should answer this in SCOPE (ingestion freshness vs live reads) rather than ship two modes.

## 13. Notifications, user management, docs, shell [both][internal]

- Notification bell (WebSocket; All/Mentions; module filter; unread count), incident banner (profile + date + hours window, priority colour, dismissible except High; dismiss key includes updated time), Notification Management admin page (Active, Name, Type, Time, Last updated, Created/Updated by; create/edit modal with profiles by country, priority+colour, description, date range, hours, state).
- User management: tabs User Management (Name & Email, Department, Role, Profile Access; 800 ms search; assign role + profiles drawer with Select role / Select profiles / Confirm; bulk) and Portfolio User Management (Assign Portfolio). Department is internal.
- `/docs` developer-facing docs viewer: skip.
- Shell: sidebar (Home, Standard mode, Real-time mode, Rules, Inventory Alert, User management, Portfolio management, Settings; footer Help center, All app), navbar (profile selector, export centre, help, bell, user menu), breadcrumbs, route loading overlay, `/403`, `/404`, error boundary.

## 14. Per-marketplace limits seen (for tests, not as constants)

Campaign budget 1..1,000,000 (SP also quoted as min $1.00); bid min 0.02, max 10,000; portfolio-campaign budget 0.02..10,000; names: campaign 117/128, ad group 244/255; placement adjust 0..900 (audience 1..900);
keywords 150/targets 150/negatives 200; SD audiences 20; rule increase 1..100; hours-of-day marketplaces US, CA, UK, IN, JP; SB cost control >= 0.50. No per-marketplace table exists in the web app — it is fetched from the profile's constraints.

## 15. What goes to Amazon vs stays internal

- To Amazon: campaigns/ad groups/ads/targets/negatives create-update-state-archive, placement and audience bids, budget rules, portfolios (+caps), creatives and assets, SD creative review.
- Stays internal: history/audit, bid rules, portfolio user permissions, notifications, tickets, budget-account requests, saved columns/filters, reports/exports, issue dashboards, inventory alerts' recommendations.

## 16. Implications for seller-hub (feeds P1-SCOPE; D51 console is the reference)

1. Parity table (P1-CONSOLE) decides which of these Amazon already provides; this doc lists the extras users rely on: bulk edit with partial-result reporting, copy across profiles, OOB insights, budget recommendation apply, portfolio caps, multi-profile switching, saved/pinned columns, shareable URL state.
2. Keep: BFF auth, URL-as-state hierarchy, skeleton/empty-state discipline, whole-record write safety, 200-is-not-success handling, per-entity edit flags, timezone-correct dates.
3. Drop/replace: Walmart/Wayfair, departments, tickets, BI iframe, per-team budget requests, v1/v2 duplication, hard-coded limits.
4. Open questions are in `docs/reports/P1-WEB.md`.

## 17. Endpoint cross-check against P1-API (`catalog/legacy/api-endpoints.json`)

Method: each endpoint in `web-features.json` was normalised (prefix stripped, path params wildcarded, `{sp|sb|sd}` and
product-type segments expanded, including the typed second mount of the shared routes) and matched on method + path against the
212 external routes. Full lists: `catalog/legacy/web-endpoint-crosscheck.json`.

**Result: 194 web calls -> 188 match, 5 have no route in the backend inventory, 1 is a web-server route (not a backend one).**

- Matches include all campaign/ad-group/ad/target/negative/portfolio/rule/history/report/notification/inventory/product calls and the typed
  budget-rule family (`sp|sb|sd/budgets/*`) and the real-time `amz-*` reads.
- **Corrected by the check (my first draft was wrong, fixed in the catalog):** portfolio operations list/users and ticket profiles are POST (not GET);
  suffix-emails is GET; the audience list takes the campaign type as its path parameter.
- **Web calls with no backend route (not defects of the web app, they target other services):**
  - background export service (`POST exports`, reached through the web server's export proxy) — a separate service, not in the inventory;
  - the budget-account family (`GET portal/budget/approve-journey`, `POST portal/budget/ticket`, `.../clone`, `.../approve`) — served by a separate
    portal API. Both belong to internal/optional features, so seller-hub need not replace them one-to-one (export job service: yes, see UX-21).
- **Backend routes no web entry lists (95 of 212 external).** Caution: the web catalog lists calls per screen at requirement level, so some of these are
  used by v1 forms or secondary dialogs I did not enumerate; "not listed" is not proof of "unused". Grouped:
  - **Likely used by screens not walked in detail:** negative-target and negative-keyword create/delete/list, campaign-level negative keyword/product lists,
    SD target recommendation/verification, SB creative per-format create/preview, ad-group clone / list-all / target lists, campaign optimisation and bidding rules
    (per-campaign), store/page ASIN lookups, moderation results, taxonomy for audiences.
  - **Configuration and session plumbing:** profile list/diagnostics, role list/module-admin/profile-admin/assign-portfolios, filter and profile config, breadcrumbs.
  - **Backend-only/operations:** cache read/write, health check, budget run-job and total-by-profile, download-history create/update, ticket log/mark-as-read.
  - **Superseded by newer routes:** older `budget-recommendations/*` and `budgets/*` variants alongside the `rules/budget-rule/*` family (the UI uses `campaigns/recommend` and `budgets/*` as listed in section 9).
- **Implication for seller-hub:** screens never called a route in the "operations" and "cache" groups; those are backend concerns (ingestion, caching) and
  should not drive the web contract. Contract-first OpenAPI (`contracts/`) should start from the 188 matched calls, regrouped by capability.
