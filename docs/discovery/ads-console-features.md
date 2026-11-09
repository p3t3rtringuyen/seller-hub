# Amazon Ads console — feature inventory (P1-CONSOLE)

Source: the live console, read-only, on 2026-11-09 (test advertiser; Sponsored Brands campaigns only, no Stores,
no product segments). Structure only — no account data. Machine-readable twin:
`catalog/console/console-features.json`. URLs use `entityId=…`. Decision D51: the console is the feature
reference (copy features and workflows, never branding).

Coverage legend: **Read** = fields read in the UI · **Partial** = reached but not all states · **Not covered** = see reason.

## 1. Campaign Builder

### 1.1 Type chooser (`/cb?country=US`)
- Country dropdown, "View drafts".
- Tiles: **Sponsored Products**, **Sponsored Brands**, **Display** and **Streaming TV** (the last two grouped as "DVA+").
- The three tabs the brief calls "Amazon and beyond / Amazon Business / Across retailers" exist **only on the Sponsored Products card**:
  - Amazon and beyond — promote product listings (default).
  - Amazon Business — reach business customers (B2B-only placement).
  - Across retailers — "choose retailer" dropdown; Create stays disabled until a retailer is chosen (options not opened).

### 1.2 Sponsored Products — one scrolling page, Forecast (Beta) panel at the side (Read)
| # | Section | Fields and options |
|---|---|---|
| 1 | Ad group settings | Ad group name; Sites: Amazon and beyond (default) / Amazon Business |
| 2 | Products | Search (name or ASIN) / Enter list / Upload; "N products"; empty state points to Seller/Vendor Central |
| 3 | Targeting mode | Automatic (default) / Manual |
| 3a | Automatic | Default bid (shows suggested bid for regular days); "Set bids by targeting group" (expandable) |
| 3b | Manual | Keyword targeting or Product targeting |
| 3b-i | Keywords | Suggested / Enter list / Upload file; Bid selection (Suggested bid); filter Broad/Phrase/Exact; sort (Orders…); columns Keyword, IS\|IR, Match type, Sugg. bid, Bid; "Apply all"; errors "You have one or more errors in this list", "Some keywords are not eligible for targeting" |
| 3b-ii | Products | Categories (Suggested/Search) and Individual Products; Bid + Apply all |
| 3c | Targeting with AI | needs ≥ 2 targets, ≥ $10 daily budget, single-country campaign |
| 4 | Negative keywords (optional) | Negative exact / Negative phrase; one keyword per line |
| 5 | Negative products (optional) | Exclude brands / Exclude products; "Your brands" with Exclude / Exclude all |
| 6 | SP video | Review/add videos table; auto-created videos opt-in checkbox |
| 7 | Bidding strategy | Dynamic up and down (up to +100%) / Dynamic down only / Fixed |
| 8 | Placements | Top of search, Rest of search, Product pages (%); Amazon Business placement boost |
| 9 | Audiences (Beta) | Amazon audiences (High interest; Clicked/Added to cart; Purchased) with bid % |
| 10 | Video bid adjustment | % |
| 11 | Settings | Campaign name, Portfolio, Start, End, Country (read-only), Daily budget, "Launch in N additional countries" (Beta, global campaigns) |
| 12 | Rules (Beta) | template "Increase bids for high-traffic days" |
Buttons: Save as Draft, Launch campaign. Min/max values and most validation messages were not shown without submitting.

### 1.3 Sponsored Brands — one page (Read, Partial)
- **Goals**: Drive page visits (clicks, CPC) · Grow brand impression share (top-of-search IS, VCPM) · Reserve share of voice (New; fixed price).
- **Settings**: name, portfolio, start/end, country, budget (+ period), Sites (Amazon / Amazon Business).
- **Ad group**: name; format **Collections / Store spotlight / Video**; Collection type Automatic (default) / Manual.
- **Ad** (automatic collection): ad name, brand name (required — "Review and correct issues"), logo (optional).
- **Products**: automatic = recommended product segments/keywords (New) + "Product exclusions"; manual = pick products.
- **Store spotlight**: Store on Amazon (needs ≥ 4 pages, each with ≥ 1 unique product) and bid adjustments (Placements, Audiences).
- **Video**: landing page = Store on Amazon / Product detail page; Choose a Store/page; audience bid adjustments (New-to-brand preset at 100%).
- Buttons: Save as draft, Submit for review.
- Not read: creative/asset upload steps, per-goal differences, period options for budget.

### 1.4 Display — one page (Read)
Campaign settings (daily budget default $100) → ad group (Image / Video) → products (Search/Enter list/Upload) → optimization strategy (Reach / Page visits / Conversions + Cost control Beta) → targeting ("Audiences and contextual targeting, together"; filters All/Search/Contextual/Remarketing/In-market/Interest and lifestyle; 5 preset targets with bids). Launch campaign only; no draft button.

### 1.5 Streaming TV — **Not covered** (outside the three required types; not opened).

## 2. Campaign Manager

### 2.1 Campaign list (`/campaign-manager/all-campaigns`) (Read for the Sponsored Brands tab)
- Tabs: All · Sponsored Products · Sponsored Brands · Display, Video & Audio. Level switch: Campaigns · Ad groups · Targets (Targets = Sponsored Products only).
- KPI strip (Impressions, Clicks, Branded searches, DPV, NTB purchases, Sales, each "View details") and a performance chart (4 selectable metrics).
- Default columns (14): Active, Campaign name, Country, Status, Type, Start, End, Top-of-search bid adjustment, Budget amount, Clicks, CTR, CPC, Total cost, Top-of-search impression share.
- Customize columns: 7 groups, 48 columns (Retailer, Portfolio name, bid strategy, cost type, impressions, CPM, vCTR, vCPM, viewable metrics, reach, video quartiles, DPV/ATC/branded searches/store page views (+NTB), purchases, sales, ACOS, ROAS, NTB %, long-term sales/ROAS…). Apply / Reset to default.
- Filters: Active status (default "All but archived"), Country, Retailer, Portfolio, Budget, every metric; search; 3 quick chips (impressions and no clicks · top-of-search impressions · out of budget); natural-language "Search with metrics or settings".
- Date ranges: Today … Lifetime, calendar, "Create report" for > 90 days. View: Default / Compact (no saved views).
- Row: kebab (Add to filter, Edit settings, Copy), inline Active switch, Status tooltip.
- Bulk actions: Enable, Pause, Archive, Delete; View targets/ad groups; Update start/end date, budget, portfolio (move/remove/create); Modules Performance/Analytics/Logs.
- Export: Download table, Create report.
- Not covered: tooltip text for all but Status; saved views (none exist); All/SP/DVA tabs.

### 2.2 Campaign detail (SB) — tabs: Ad groups · Bid adjustments (Placements, Audiences) · Budget rules · Settings · History (Read)
Details per tab in the JSON. Notables: placement bid % editable per row; audiences footnote about overlap; budget rules empty-state text; settings include Goal, Cost target explanation, Targeting with AI; history covers 90 days.
Not covered: SP detail (Placements/Negative targeting tabs), SD detail.

### 2.3 Ad group detail (SB) — Ads · Targeting · Negative targeting · Search terms · Ad group settings · History (Read except History)
Ads (create ad, bulk actions, landing-page link, Manage ad), Targeting (add product targets, suggested bid + Apply, inline bid), Negative targeting, Search terms (65-day window), Settings (name, id, active, status, archive).

### 2.4 Portfolios area (Read, Partial)
Side nav: Portfolios · Campaigns · Drafts · Products · Targeting · Budgets · History · Bulk operations · Rules · Settings.
- Portfolios: list with inline budget/dates, Create portfolio.
- Budgets: recommendation columns (recommended budget + Apply all, est. missed sales/impressions/clicks, avg time in budget).
- Rules: budget and bid rules list (Enabled, Type, Status, Description, Schedule), Add rule.
- Products: eligibility, trends, recommendations; Create campaign / Add to existing campaign.
- Targeting: cross-campaign targets with Top performers.
- Bulk operations: upload/download campaigns spreadsheet, job history.
- Not covered: portfolio detail, Drafts, History, Settings.

## 3. One click away (names only, not opened)
Recommendations · Brand profiles (New) · Brand Stores · Creator connections · Creative assets · Creative Studio (Beta, AI) · Translations · Brand metrics (Beta) · Brand impression share (Beta) · Ads planner · Amazon Attribution (Beta) · Amazon Marketing Cloud · Sponsored ads reports · Brand lift studies · Data manager · Events · Partner Directory · Ads Academy · Billing (New) · Verification Center · in-page "Ads Agent" AI chat (Beta). Of these, ads-web has none of them except reports and a recommendation-like budget view.

## 4. Parity table vs ads-web (`catalog/legacy/web-features.json`, P1-WEB done)
| Console feature | In ads-web? | Notes |
|---|---|---|
| Builder: Sponsored Products | Yes — Create SP campaign | ads-web is multi-step; console is one page. Compare fields in P1-SCOPE |
| Builder: Sponsored Brands | Yes | goals (3), formats (collections/store spotlight/video) need field-by-field check |
| Builder: Sponsored Display | Yes | |
| Streaming TV, across retailers, Amazon Business site choice, global (multi-country) launch | Not evident | out of scope for MVP likely |
| Forecast panel, Targeting with AI, auto-created SP video, rule templates in builder | No | candidates for later phase |
| Save as draft / View drafts | Not evident | |
| Campaign list with columns, filters, date ranges, export | Yes (26 columns) | console has 48 selectable columns, quick-filter chips, natural-language search |
| Customize columns, compact view | Partial | ads-web swaps single metrics only on the dashboard |
| Bulk Enable/Pause/Archive/budget/portfolio | Yes | console adds Update dates, Delete, Modules |
| Campaign detail: Ad groups, placements/audience bid adjustments, negative targeting, budget rules, settings | Yes | |
| Campaign detail: History tab (90 days) | Yes (/history global) | |
| Ad group detail: ads, targeting, negative targeting, search terms, settings | Yes | search terms exist in real-time mode |
| Targets level list, targeting page | Yes | |
| Budgets page with recommendations (+ missed sales/impressions/clicks) | Yes (Budget recommendation) | |
| Rules list (budget/bid) | Yes | |
| Portfolios list/detail/settings | Yes | |
| Products page (eligibility, add to campaign) | Yes | |
| Bulk operations (spreadsheet upload/download) | No | |
| Reports (create/download) | Yes (generated files) | |
| Recommendations, Brand Stores/profiles, Creative Studio, Brand metrics, Ads planner, Attribution, AMC, Brand lift, Billing | No | not advertising-management core |
