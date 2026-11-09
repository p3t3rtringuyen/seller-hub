# Amazon Ads API domain map (v1 default, v0 as named exceptions)

Generated for task P1-ADS from `catalog/ads/**` (builder: `tools/catalog/ads.mjs`; source: the
`refs/amazon-ads` mirror fetched 2026-10-14 plus `refs/amazon/ads-advanced-tools-docs`). Counts:
**200 specs catalogued** (94 v1, 106 v0), **5 skipped**, **1,090 operations** (238 v1, 852 v0), every one
classified in `catalog/ads/domain-map.json`.

Decisions applied: **D53 (v1 default; each v0-only area is a named exception)**, D52 (call Amazon directly
with each seller's LWA credentials), D51 (the Amazon Ads console is the feature reference), D5 (Seller +
Vendor, Seller first), D50 (MCP is a later layer, see `ads-mcp.md`).

## How to read

- **v1** = the unified `/adsApi/v1/...` contracts (`AmazonAdsAPI<Product><Entity>Contract_prod_3p.json`).
  **v0** = everything else (SP v3, SB v4, SD v3, Portfolios, Exports, Profiles, Reporting v3, ...).
- Every operation has one *treatment* in `domain-map.json`:
  `v1-default` (use) · `v0-exception` (use v0, named `EX-*`) · `v0-superseded` (a v1 equivalent exists, the
  map names it in `v1Equivalent`; do not call) · `v0-deprecated` (legacy or shut-off announced; do not call) ·
  `v1-out-of-scope` / `v0-out-of-scope` (DSP, deals, media planning, AMC, data provider, retail ad service ...).
- Operation names below are `operationId`s from `catalog/ads/operations.json`; schemas are in
  `catalog/ads/definitions/<api>.json`.
- This document says what the *docs and specs* say. It does not claim behaviour that only a live call can
  show (real throttling numbers, which profiles a seller has). Those are flagged **verify live**.

| Treatment | Operations |
|---|---|
| v1-default | 161 |
| v0-exception (20 named exceptions, §4) | 196 |
| v0-superseded (v1 equivalent exists) | 107 |
| v0-deprecated | 67 |
| v0-out-of-scope | 482 |
| v1-out-of-scope | 77 |
| **Total** | **1,090** |

The authoritative numbers are the `tally` and `byDomain` objects in `catalog/ads/domain-map.json`, which the
builder recomputes on every run (the table above is a copy).

## 1. Authentication, headers, regions, sandbox

**LWA (Login with Amazon).** Auth-code grant, then refresh token per seller (D52: each seller connects their own
Amazon Ads user). Scope `advertising::campaign_management` (legacy alias `cpc_advertising:campaign_management`,
identical); test accounts also need `advertising::test:create_account`; Data-provider APIs
`advertising::audiences`. Source: `security` blocks in the v1 specs, `profiles-3-0`.

| Region | API host | LWA authorize | LWA token endpoint |
|---|---|---|---|
| NA (US CA MX BR) | `https://advertising-api.amazon.com` | `https://www.amazon.com/ap/oa` | `https://api.amazon.com/auth/o2/token` |
| EU (UK DE FR IT ES NL SE PL TR AE SA EG BE ZA IE) | `https://advertising-api-eu.amazon.com` | `https://eu.account.amazon.com/ap/oa` | `https://api.amazon.co.uk/auth/o2/token` |
| FE (JP AU SG) | `https://advertising-api-fe.amazon.com` | `https://apac.account.amazon.com/ap/oa` | `https://api.amazon.co.jp/auth/o2/token` |

(`docs/guides/get-started/*`, every v1 spec `servers`.) Authorization and token endpoints differ per region; call the host of the region that owns the profile.

**Headers.**

| Header | v1 | v0 |
|---|---|---|
| Client id | `Amazon-Ads-ClientId` (required) | `Amazon-Advertising-API-ClientId` (required; the rename is global) |
| Token | `Authorization: Bearer Atza\|...` | same |
| Profile | `Amazon-Advertising-API-Scope` - optional in v1 ("can keep sending it"); required for most sponsored-ads v0 calls | required on nearly every v0 call |
| Advertising account | `Amazon-Ads-AccountId` (optional for sponsored ads, required for ADSP and cross-product) | n/a (only reporting v3 accepts it) |
| Manager account | `Amazon-Ads-Manager-AccountId` | n/a |
| Body | `Content-Type: application/json`, `Accept: application/json` | **versioned vendor media types**, e.g. `application/vnd.spCampaign.v3+json`, `application/vnd.campaignsexport.v1+json` |
| Prefer | n/a | `Prefer: return=representation` on SP v3 create/update/delete returns full objects instead of ids |

Account model in v1 (`reference/amazon-ads/getting-started.md`): the **advertising account**
(`advertiserAccountId`, `amzn1.ads-account.g.*`) is the new identifier; the **profile id** (legacy,
per marketplace) still drives `Amazon-Advertising-API-Scope`. `AdvertiserAccount.alternateIds` is the bridge
(**verify live** that it carries the profile id before retiring Profiles, see `EX-PROFILES`).

**Sandbox / test accounts.** There is no separate sandbox host in the spec set. Amazon offers **test
accounts** (`POST /testAccounts`, `EX-TEST-ACCOUNTS`): they never serve ads, have no billing and **no
performance data**, so reports return empty. Limit documented in the MCP tool text: one per account type per
marketplace. Unsupported: Lock Screen Ads, Posts, Stores; Insights API; VIDEO assets. Good for CRUD and
contract tests, useless for report/ingestion tests (use recorded fixtures for those).

## 2. Cross-cutting behaviour

**v1 request model.** Every v1 operation is `POST /adsApi/v1/{create|update|delete|query|retrieve|list}/<plural>`
(only `list` and a few retrieves are `GET`). One contract set across SP, SB, SD, ST, DSP: the `ALL` contracts
are generic (an `adProduct` field selects the product) and each product also has a product-specific contract
with only the attributes valid for it (`SPCreateCampaign` vs `CreateCampaign`).
Rule for seller-hub: **generate clients from the product-specific contracts**; they carry the business-rule
validation (`reference/amazon-ads/getting-started.md`, "ad product selection").

**Batch and partial failure (the thing to get right).** Write operations are batch calls:
`create`/`update` take an array (`campaigns`, `adGroups`, `ads`, `targets`; max **1,000** per call for SP
campaigns, check `batchMax` per operation), `delete` takes `campaignIds`/`adGroupIds`/... A call returns **HTTP
207** with `{success:[{index,<entity>}], error:[{index,errors:[...]}]}`; the HTTP status says nothing about
individual items. 158 of the 238 v1 operations are 207 multi-status. Per-item errors use enum codes
(`BAD_REQUEST`, ...), not v0 exception class names. SP v3 (v0) is the same shape inside a wrapper
(`{campaigns:{success,error}}`, migration skill `unified-api-migration-guide` §3.3).
Design consequence: the write layer must map `index` back to the input row, retry only failed items, and
treat 207 as "partially applied".

**Read strategy** (docs: `reference/concepts/rate-limiting.md`, `guides/exports/faq.md`,
`reporting/ads-v1/limits.md`):

| Need | Use | Notes |
|---|---|---|
| A page of entities for the UI | v1 `query` (73 query ops) | `maxResults` ≤ 1000 (SP), `nextToken` paging, `adProductFilter` **required** in queries |
| Whole account structure, 1-2x/day | **Exports** (v0, `EX-EXPORTS`) | async, 202 then `GET /exports/{id}`, download URL valid 1 h (regenerable 24 h), default cap **5 in-progress jobs per endpoint**, "not for real-time" |
| Performance numbers | v1 Reports (ad hoc) or Stream v2 (push) | see §3.10/§3.11 |
| State changes | v1 query diff, or Change history (`EX-CHANGE-HISTORY`, SP/SB only) | Stream v1 "messaging" datasets are being shut off; docs say use Campaign Management |

**Throttling.** HTTP `429` with a `Retry-After` header (seconds). Limits are **dynamic, based on system load**
(`rate-limiting.md`): the docs give no per-operation rps/burst table (unlike SP-API). What the docs do say:
list-with-extended-data calls weigh **5x** a normal call; reporting limits shrink when the regional report
queue is long (spread backfills over the day); Reporting v1 concurrency can be as low as **1 concurrent report** and
**1 request/s**, per client, raisable only by support ticket; exports cap 5 in-progress per endpoint;
use exponential backoff with jitter and a max retry. All 238 v1 operations declare a 429 response.
Documented service targets (`concepts/limits.md`): synchronous CRUD p99 30 s; impression/click to API
availability 12 h (invalidation 72 h); async report/snapshot generation 15 min. **Verify live**: the real
per-client numbers.

**Constraints worth encoding** (`concepts/limits.md`): min/max bid and budget tables per marketplace and
product (they differ for Seller vs Vendor, e.g. SD US vendor max daily budget 50,000 vs seller 1,000,000;
SB IN vendor min daily 500 vs seller 100), keyword and entity-name character rules. Store them as data,
not code.

## 3. Domains

Legend: **v1 ops** are the default; **v0** rows are the exceptions detailed in §4.

### 3.1 Accounts and profiles

| | |
|---|---|
| Entities | advertiser account (global or per-marketplace), profile, manager account, account link / invite, selling account link, user, permission, role, terms token, test account |
| v1 ops | `CreateAdvertiserAccount`, `QueryAdvertiserAccount`, `UpdateAdvertiserAccount` (registration + list; account states `APPROVED, ARCHIVED, REGISTRATION_IN_PROGRESS, REJECTED`); `CreateManagerAccount`, `QueryManagerAccount`, `UpdateManagerAccount`; `QuerySellingAccount`, `QuerySeller`; beta: `Create/Query/UpdateAccountLink*`, `AccountLinkInvite*`, `AccountCombinationInvitation*` |
| v0 exceptions | `EX-PROFILES` (`listProfiles`, `getProfileById`, `updateProfiles`), `EX-TERMS-TOKEN`, `EX-MANAGER-LINKING` (`associate` / `disassociate`), `EX-USERS-PERMISSIONS` (invitations, `UpdateUserPermissions`, `QueryUserRoles`, `ListUsers`), `EX-TEST-ACCOUNTS`, `EX-ELIGIBILITY` (`ProgramEligibility`, `productEligibility`) |
| Not to use | `RegisterAdsAccount`, `ListAdsAccounts`, `GetAccount` (`/adsAccounts`, `/adsAccounts/list`) - **legacy account management, deprecated July 2026, 404 from July 2027**; replaced by v1 create/query advertiserAccounts |
| Write behaviour | v1 account create/update are batch 207; registration is async (`REGISTRATION_IN_PROGRESS`); v0 profile update is a plain PUT |
| Read | `query` (paged); profiles list is small. Cache profile -> marketplace/currency/timezone/type per tenant |
| Seller vs Vendor | v0 profile `accountInfo.type` ∈ `seller`, `vendor`, `agency` (agency = DSP/data-provider); `validPaymentMethod` is **vendor only**; v1 `SellingProgram` ∈ `AMAZON_SELLER, AMAZON_VENDOR, AMAZON_AUTHOR`; `subType` `KDP_AUTHOR`, `AMAZON_ATTRIBUTION` |
| Throttling | standard 429; no figures |

Note: `GET /v2/profiles` returns **nothing** until the account has created at least one campaign in the console
(spec text) - onboarding must handle "connected but empty".

### 3.2 Portfolios

Entities: portfolio (name, budget policy, state), portfolio budget usage. **No v1 portfolio entity** (v1
campaigns carry `portfolioId` and a `portfolioIdFilter` only). **Exception `EX-PORTFOLIOS`**:
`CreatePortfolios`, `UpdatePortfolios` (batch 100, media type `application/vnd.spPortfolio.v3+json`, 207,
`Prefer` header), `ListPortfolios` (POST `/portfolios/list`), `portfolioBudgetUsage` (media type
`application/vnd.portfoliobudgetusage.v1+json`, batch 100, both scope + client headers required). No delete
(archive via update). Read: list is paged; budget usage on demand. Throttling: standard.

### 3.3 Campaigns (SP, SB, SD, ST)

| | |
|---|---|
| Entities | campaign: `name, state, status{delivery}, budgets[], startDateTime/endDateTime, portfolioId, marketplaceScope (SINGLE/GLOBAL), marketplaces/countries, retailerScope, optimizations{bidSettings{bidStrategy, bidAdjustments}}, autoCreationSettings, tags` (SP: `SPCampaign`) |
| v1 ops | `SPCreateCampaign` / `SPUpdateCampaign` / `SPDeleteCampaign` / `SPQueryCampaign`, same for `SB*`, `SD*`, `ST*`, `SPGlobal*`; generic `CreateCampaign`, `UpdateCampaign`, `DeleteCampaign`, `QueryCampaign` |
| v0 (do not call) | SP v3 `CreateSponsoredProductsCampaigns` ... `ListSponsoredProductsCampaigns`; SB v4 `...BrandsCampaigns`; SD v3 `/sd/campaigns*`. Each maps to its v1 operation in `domain-map.json` (`v1Equivalent`). |
| v0 exception | `EX-EVENTS` (`/sp/v1/events`, v1 `CreateEvent` is closed beta) |
| Writes | batch 1,000, 207 partial failure. v1 changes vs v3: ISO-8601 `startDateTime`, `adProduct` + `marketplaceScope` required on create, budgets restructured, queries need `adProductFilter` (migration skill §3). SP v1 adds **SP Global** (one campaign across marketplaces; IE and ZA not supported) |
| Read | `query` + `nextToken` for UI; Exports for bulk sync; v1 `status.deliveryStatus` + `deliveryReasons[]` replaces `servingStatus` (the v0 "extended" lists cost 5x) |
| Throttling | standard |
| Deprecations | SB Product Collection ad type: creates become Manual Collection from Aug 2026, error from Jan 2027 |

### 3.4 Ad groups

Entities: ad group (`name, state, bid{defaultBid}, adProduct`). v1 `SP|SB|SD|ST|SPGlobal` `CreateAdGroup /
UpdateAdGroup / DeleteAdGroup / QueryAdGroup` (+ generic). v0 CRUD is superseded (`v1Equivalent`). Same batch /
207 / paging rules as campaigns. No exception.

### 3.5 Ads, ad associations, extensions, creatives

| | |
|---|---|
| Entities | ad (product ad / creative wrapper), ad association (ad ↔ ad group), ad extension (SP prompt / video extensions), SB creatives (collection, video, store spotlight) |
| v1 ops | `SP|SB|SD|ST CreateAd / UpdateAd / DeleteAd / QueryAd`, `CreateAdAssociation / Update / Delete / Query`, `SPCreateAdExtension / Query / Update`, `SPGlobal*` |
| v0 exceptions | `EX-MODERATION` (`moderationResults`, SB pre-moderation), `EX-BRAND-ASSETS` (creative asset library, `/media/describe`, `/stores/assets`, `/brands`, `/pageAsins`, Brand Home `ListStores` / `ListPages`) - needed to build SB/SD creatives |
| Seller vs Vendor | SP/SD product ads identify the product by **`sku` for sellers and `asin` for vendors** (spec examples) |
| Writes | SB creative settings moved inside the ad (`manualCollectionSettings`, `autoCollectionSettings`, ...); `productCollectionSettings` is deprecated (shutoff Jan 2027) |

### 3.6 Targets (keywords, products, categories, audiences, negatives)

| | |
|---|---|
| Entities | `target` with `targetType` ∈ `KEYWORD, LOCATION, PRODUCT, PRODUCT_CATEGORY, THEME` (SP) and match types `BROAD, EXACT, PHRASE`; negative targets are the same entity with `negative=true`; campaign-level negatives via level |
| v1 ops | `SP|SB|SD|ST|SPGlobal CreateTarget / UpdateTarget / DeleteTarget / QueryTarget` (+ generic). v1 folds SP keywords, negative keywords, campaign negative keywords, targets, negative targets and campaign negative targets (6 v3 endpoint families) into one |
| v0 (do not call) | all `/sp/keywords`, `/sp/negativeKeywords`, `/sp/campaignNegative*`, `/sp/targets*`, `/sp/negativeTargets*`, SB/SD target CRUD |
| v0 exceptions | `EX-TARGETING-DISCOVERY` (category browse + refinements, product counts, negative-brand search, locations, audience taxonomy, targetable entities), `EX-BRAND-SAFETY` (SD brand safety deny list) |
| Effort | highest of the migration (migration skill: SP targeting 🔴 High) |

### 3.7 Budgets and budget rules

No v1 entity. **Exceptions `EX-BUDGET-RULES`** (26 ops: SP/SB/SD budget rules, rule ↔ campaign association,
`GetSPBudgetRulesForAdvertiser`, `CreateBudgetRulesForSPCampaigns` batch 25, ...) and
**`EX-BUDGET-USAGE-RECS`** (9 ops: `spCampaignsBudgetUsage`, `sbCampaignsBudgetUsage`, SD usage,
`getBudgetRecommendations` batch 100 media type `application/vnd.budgetrecommendation.v3+json`,
`getBudgetRecommendation` initial, `SPGetBudgetRulesRecommendation`). The v1 campaign `budgets[]` (amount,
period, type) is the writable budget; rules and usage are v0. Stream v1 `budget-usage` and
`sp-budget-recommendations` datasets have **no v2 successor**; docs say messaging data -> Campaign Management,
recommendation data -> Recommendations API. SD budget minimums differ for vendors (see §2).

### 3.8 Bid adjustments and optimization rules

| | |
|---|---|
| In v1 | SP `optimizations.bidSettings`: `bidStrategy` (`SALES_DOWN_ONLY`, `SALES_UP_AND_DOWN`, `MANUAL`, `RULE_BASED`), `bidAdjustments` for placement (`TOP_OF_SEARCH`, `PRODUCT_PAGE`, `REST_OF_SEARCH`), audience and creative adjustments (`SPPlacementBidAdjustment`, `SPAudienceBidAdjustment`, `SPCreativeBidAdjustment`); SB legacy `shopperSegmentBidAdjustments` is marked for deprecation - do not use |
| Exception `EX-OPTIMIZATION-RULES` | 22 ops: SP `/sp/rules/optimization`, `/sp/rules/campaignOptimization*`, `AssociateOptimizationRulesToCampaign`; SB `/sb/rules/optimization*`; SD `/sd/optimizationRules*`. Needed only for rule-based bidding |
| Not for sellers | `BidAdjustments` / `BidModifiers` (`/dsp/rules/...`) are DSP |

### 3.9 Recommendations

v1: `QueryRecommendation` (POST, batch of `accessRequestedAccounts` up to 2,000), `ListRecommendation` (GET),
`SBQueryRecommendationType`, `SBCreateRecommendation` (SB, 1 per call). Only **4 types today**:
`REMOTE_CAMPAIGN_PAUSED`, `AUTOMATIC_GLOBAL_ADS_ENROLLMENT`, `BRAND_PRODUCT_SEGMENT`, `BRAND_PRODUCT_KEYWORD`
(`recommendation-types.md`; other types return `400 INVALID_RECOMMENDATION_TYPE`).
**Exception `EX-TARGETING-RECS`** (28 ops): theme-based bid recommendations (`/sp/targets/bid/recommendations`,
media type v4 required since the v3 content type is deprecated), keyword / product / category recommendations,
target promotion groups, `getCampaignRecommendations`, SB headline + optimization recommendations, SB insights /
forecasts, SD target + bid recommendations, campaign diagnostics. These are the "what should I change" features
of the console; they stay v0 until the v1 type list grows (watch `recommendation-types.md`).

### 3.10 Reporting

| | |
|---|---|
| v1 (default) | `AdsApiv1CreateReport`, `AdsApiv1RetrieveReport`, `AdsApiv1DeleteReport` (`/adsApi/v1/{create,retrieve,delete}/reports`); body: `accessRequestedAccounts[]`, `reports[]` with `format` ∈ `CSV, GZIP_JSON, PARTITIONED_CSV, PARTITIONED_GZIP_JSON`, `periods`, `query{fields,filter}`. Fields are standardized dimension / metric ids (**844 in `reports.json`: 709 metrics, 135 dimensions**) with per-field compatibility; conversions are by **traffic date** not conversion date |
| v0 (replaced, deprecated) | Reporting v3 `createAsyncReport / getAsyncReport / deleteAsyncReport` (`POST /reporting/reports`, media type `application/vnd.createasyncreportrequest.v3+json`) with 22 report types (`spCampaigns`, `spTargeting`, `spSearchTerm`, `spAdvertisedProduct`, `spPurchasedProduct`, `sbCampaigns` ... ; `reports.json` → `v3.reportTypes`) and 739 columns; SD/SB v3 reports and snapshots; Sponsored Ads v2 reports. **All shut off 2027-06-30.** The migration table v3 report type -> v1 field list is in `reports.json` → `v1.migrationExamples` (5 SP report types documented) |
| Retention (v1) | `hour.value` 14 d / 14 d; `date.value` 24 months, max 120-day range; `week/day/dayOfWeek` 24 months, 15-month range; `month` 6 years, 25 months; `year` and `dateRange` 6 years |
| Retention (v3) | per type, e.g. `spCampaigns` 31-day range, 95-day retention; `sbCampaigns` 60 days; `sdCampaigns` 65 days (`reports.json`) |
| Exceptions | `EX-BRAND-ANALYTICS` (Brand Metrics, benchmarks, Stores insights, MMM) |
| Write/partial failure | report create is a single request that returns a report id; check status on retrieve; oversized reports fail immediately or after processing - split by date/account |
| Strategy | **Stream v2 first for scale** (Amazon: "shift most use cases to Stream"), v1 Reports for backfill and ad-hoc |
| Throttling | 429; concurrency can be 1; spread requests; exponential backoff |

### 3.11 Amazon Marketing Stream

| | |
|---|---|
| v1 (default) | `AdsApiv1CreateStreamSubscription`, `...Query...`, `...Retrieve...`, `...Delete...` (`/adsApi/v1/*/streamSubscriptions`); one subscription per call, one advertiser account per subscription; Query `maxResults` 1-5000; max **5 destinations** (S3 bucket + SQS queue) per client app |
| Datasets (v2) | `ads-performance-v1` (hourly; SP, SB, SD, ST, DSP; 437 fields; restatement window 70 days) and `ads-converted-product-v1` (daily; 189 fields). Delivery: Apache **Parquet to an S3 bucket you own** + SQS notification; records keyed by dimensions with `streamBatch.version` (highest wins); **totals not deltas**; as frequent as 15 min |
| v0 (deprecated) | `CreateStreamSubscription` etc. (`/streams/subscriptions`) for the 27 v1 datasets (`sp-traffic`, `sp-conversion`, `sb-*`, `sd-*`, `budget-usage`, `sp-budget-recommendations`, campaign-management `campaigns/adgroups/ads/targets`, diagnostics, `adsp-*`) delivered via Firehose or SQS as JSON. **Stream v1 shuts off 2027-06-30.** |
| Gap | no v2 dataset for entity changes, budget usage or recommendations -> poll v1 query / v0 budget usage |
| Destination | the S3 bucket + SQS queue live in an AWS account, and each subscription is scoped to one advertiser account (D52: a bucket per tenant or a shared bucket with per-tenant prefixes - **open for P2/P4**) |

### 3.12 Exports

Exception **`EX-EXPORTS`**: `CampaignExport`, `AdGroupExport`, `TargetExport` (target type filter, up to 9
types), `AdExport` (POST `/campaigns/export`, ..., 202, media types `application/vnd.<entity>export.v1+json`),
`GetExport` (poll; new download URL on every call). SP, SB, SD.
Supports one-to-two syncs per day; cap 5 in-progress per endpoint; metadata at request time only (no history).
Amazon states Exports is **not** affected by the Sept 2026 deprecations.

### 3.13 Change history

Exception **`EX-CHANGE-HISTORY`**: `getHistory` (`POST /history`, `application/json`). SP and SB campaigns only,
no SD, no actor, times in UTC epoch, accepts alphanumeric or numeric ids. Useful for the "activity log" feature;
seller-hub should also keep its own audit trail (writes made through seller-hub).

### 3.14 Everything else a seller might touch

| Area | Treatment |
|---|---|
| Billing / invoices / billing profiles / payment methods | `EX-BILLING` (21 ops) |
| Brand stores, creative assets, SB media | v1 `QueryBrandStore*` (query) + `EX-BRAND-ASSETS` |
| Labels | v1 `QueryLabel`, `QueryLabelObjectAssociation` |
| Promotions / communications / events | v1 beta (`QueryPromotionOffer`, `CreatePromotionCodeRedemption`, ...) |
| Posts, SD/SB v3, SP v2 legacy | deprecated, never call |
| Amazon Live (MCP only) | no public API operation exists for it in the specs (23 MCP tools) |
| Amazon DSP, deals, supplier, media planning, AMC, attribution, data provider, retail ad service | out of scope (agency/DSP), 482 v0 + 77 v1 operations; Sponsored TV v1 is catalogued but out of the Seller/Vendor MVP |

## 4. Exception table (D53)

One row per named exception. "Watch" = where Amazon will announce the v1 equivalent (check
`docs/release-notes/ads-api-v1.md` and `docs/release-notes/deprecations.md` after each mirror refresh).

| ID | Domain | v0 operations (count) | Why v1 is not enough | Watch in release notes |
|---|---|---|---|---|
| EX-PORTFOLIOS | portfolios | Portfolios: Create/Update/List/BudgetUsage (4) | no portfolio entity in v1 | v1 release notes, v1 overview "future vision" |
| EX-BUDGET-RULES | budgets | SP/SB/SD budget rules + association (26) | "keep using v3/v4" (migration skill) | `ads-api-v1.md` for a budget-rule entity |
| EX-BUDGET-USAGE-RECS | budgets | budget usage, budget recommendations (9) | not migrable; Stream v1 budget datasets die 2027-06-30 | same |
| EX-OPTIMIZATION-RULES | bid-adjustments | SP/SB/SD optimization rules (22) | v1 covers static bid adjustments only | v1 "rules" expansion |
| EX-TARGETING-RECS | recommendations | bid / keyword / product / category / theme recs, TPG, SB headline, forecasts, insights, diagnostics (28) | v1 Recommendations has 4 types | `recommendation-types.md` |
| EX-TARGETING-DISCOVERY | targets | categories, refinements, product counts, brand/location/audience lookups (17) | no v1 lookup operations | v1 Targets contracts |
| EX-BRAND-SAFETY | targets | SD brand-safety deny list (6) | none in v1 | SD target changes |
| EX-EXPORTS | exports | Campaign/AdGroup/Ad/Target export + GetExport (5) | no bulk metadata export in v1 | `deprecations.md` (stated "not affected") |
| EX-CHANGE-HISTORY | change-history | `getHistory` (1) | no v1 history | any v1 events/history entity |
| EX-PROFILES | accounts | list/get/update profiles (3) | profile id still the Scope header; v1 `alternateIds` unverified | `getting-started.md` |
| EX-TERMS-TOKEN | accounts | create/get terms token (2) | used by registration | account registration guide |
| EX-MANAGER-LINKING | accounts | associate / disassociate (2) | v1 ManagerAccounts lacks linking | v1 ManagerAccounts |
| EX-USERS-PERMISSIONS | accounts | invitations, permissions, roles, users (10) | v1 has only beta account links | v1 beta AccountLinks |
| EX-TEST-ACCOUNTS | accounts | create / get test account (2) | none in v1 | test accounts docs |
| EX-ELIGIBILITY | accounts | program + product eligibility, product selector (3) | v1 eligibility is beta/product-group | developer/betas |
| EX-BILLING | billing | invoices, billing profiles, payment methods (21) | none in v1 | release notes |
| EX-BRAND-ASSETS | creative-assets | asset library, SB media/stores/brands/pageAsins, Brand Home (13) | v1 BrandStores* query-only | v1 BrandStores* |
| EX-MODERATION | ads | moderation + pre-moderation (2) | none in v1 | moderation guide |
| EX-BRAND-ANALYTICS | reporting | Brand Metrics, benchmarks, Stores, MMM (19) | outside v1 reporting | brand-metrics guide |
| EX-EVENTS | campaigns | `/sp/v1/events` (1) | v1 `CreateEvent` closed beta | developer/betas |

## 5. v0 deprecation dates (what the docs and release notes say)

| What | Date | Source |
|---|---|---|
| Reporting API v3, Sponsored Ads v2 reporting, **Amazon Marketing Stream v1** | announced Sept 2026; **hard shutoff 2027-06-30**, all regions | `release-notes/deprecations.md`; banner on every v3 reporting and Stream v1 page |
| Legacy account management (`/adsAccounts*`, `/dsp/advertisers*`; 6 endpoints) | deprecated July 2026 (`Warning: 299` header, new integrations blocked); **404 from July 2027** | same |
| SB Product Collection ad type (v0 `productCollection*` and v1 `productCollectionSettings`) | Aug 2026 maps to Manual Collection; **error from Jan 2027** | same |
| Commitment / inventory management product-specific APIs | Dec 2026 / Aug 2027 | same (not seller-relevant) |
| SP v3 theme-based bid recommendations content type v3 | deprecated, use `application/vnd.spthemebasedbidrecommendation.v4+json` | same (Aug 2024) |
| SP v2 suggested keywords / bid recommendations, Profiles v1, V2 Stores, Brand Posts, DSP legacy campaign APIs | already shut off (2024-2026) | same |
| SP v3, SB v4, SD v3 campaign management (CRUD) | **no shutoff date announced** ("Existing v4 endpoints continue to work", "timeline for v3/v4 sunset" is an open question in the migration skill) | `unified-sb-migration`, `unified-api-migration-guide` |
| Exports API | explicitly **not** deprecated | `deprecations.md` |

Consequence for D53: building on v1 is safe; the v0 exceptions in §4 are not on any announced sunset list except
those in this table, so they are stable until v1 grows an equivalent.

## 6. Seller and Vendor (D5)

- Account types: profile `type` `seller` / `vendor` (`agency` is DSP); v1 selling program `AMAZON_SELLER`,
  `AMAZON_VENDOR`, `AMAZON_AUTHOR` (KDP). Sellers and vendors use the **same** SP / SB / SD operations.
- Documented differences: product identifier on ads (`sku` seller, `asin` vendor); budget limits (SD vendor max
  50,000 in US/CA/UK/DE/FR/IT/ES, SB IN vendor min 500, SD vendor max in IN/JP 5,000,000); vendor profiles expose
  `validPaymentMethod`; the eligibility APIs (`EX-ELIGIBILITY`) tell which programs an account can use.
- The specs show no separate Ads API path for vendors: Seller first, Vendor second (D5) is a UI / eligibility
  concern, not a second integration.

## 7. What seller-hub should build on (summary for P1-SCOPE)

1. v1 account + campaign + ad group + ad + target CRUD, v1 reports and Stream v2 - all `v1-default`.
2. Four reads that the console shows and v1 lacks: portfolios, budget rules / usage, recommendations, exports
   (and change history) - named exceptions with owners to re-check on each Amazon release.
3. Nothing in DSP / AMC for MVP.
4. Biggest engineering risks: 207 partial failures, report concurrency 1, Stream v2 AWS destination per
   tenant, profile-id vs advertiser-account-id duality.

## 8. Method, checks and gaps

- Builder: `node tools/catalog/ads.mjs` (Node >= 20, no dependencies, deterministic: two runs give
  byte-identical output). It parses 191 JSON specs and 9 YAML specs with a built-in YAML-subset parser.
  Path counts were cross-checked against raw `grep` for all 9 YAML specs (e.g. SD 3.0: 76 operations / 50 path
  keys, SB 3.0: 38 / 26).
- **Skipped (5 specs, invalid JSON upstream, DSP closed beta):** `AdGroupTargeting-ContentGenre`,
  `-ContentRating`, `-VideoAdFormat`, `-VideoAdInitiationType`, `-VideoAdPlayerSize` (`apis.json` → `skipped`,
  reason "Bad control character in string literal"). They are DSP only.
- **Heuristics:** `batch` = 207 response or a non-filter array property with `maxItems`; `paginated` = body has
  `nextToken`/`maxResults`; permissions parsed from "Requires one of these permissions". Review before using
  them as truth for a specific operation.
- **Gaps / verify live:** the real rate limits; whether v1 `alternateIds` carries the profile id; which of the
  v1 beta contracts the seller's LWA app can call; Stream v2 account-type support for Seller/Vendor
  advertisers (docs list "Global Account, Amazon DSP regional account" as supported account types).

Spot checks (recorded in `docs/reports/P1-ADS.md`): `SPCreateCampaign`, `CreateSponsoredProductsCampaigns`,
`CampaignExport` against the raw spec files; MCP `reporting-retrieve_report`, `campaign_management-delete_campaign`.

## Appendix A. Treatment of every catalogued API

One row per spec in `catalog/ads/apis.json` (200). `treatment` counts operations; an `EX-*` id is a named exception. The per-operation map is `catalog/ads/domain-map.json`.

| API id | Gen | Product | Ops | Treatment (operations) |
|---|---|---|---|---|
| AdGroupandCampaign-V1 | v0 | DSP | 6 | v0-out-of-scope 6 |
| AdGroupTargeting-Apps | v0 | DSP | 3 | v0-out-of-scope 3 |
| AdGroupTargeting-Audiences | v0 | DSP | 3 | v0-out-of-scope 3 |
| AdGroupTargeting-Auto | v0 | DSP | 3 | v0-out-of-scope 3 |
| AdGroupTargeting-Dayparts | v0 | DSP | 3 | v0-out-of-scope 3 |
| AdGroupTargeting-Devices | v0 | DSP | 3 | v0-out-of-scope 3 |
| AdGroupTargeting-GeoLocations | v0 | DSP | 3 | v0-out-of-scope 3 |
| AdGroupTargeting-IABContentCategory | v0 | DSP | 3 | v0-out-of-scope 3 |
| AdGroupTargeting-InventorySources | v0 | DSP | 3 | v0-out-of-scope 3 |
| AdGroupTargeting-Product | v0 | DSP | 3 | v0-out-of-scope 3 |
| AdGroupTargeting-ProductCategory | v0 | DSP | 3 | v0-out-of-scope 3 |
| AdGroupTargeting-Third-party | v0 | DSP | 4 | v0-out-of-scope 4 |
| AdLibraryAPI | v0 | - | 2 | v0-out-of-scope 2 |
| AdsDataManager | v0 | - | 17 | v0-out-of-scope 17 |
| ADSPAudiences | v0 | DSP | 1 | v0-out-of-scope 1 |
| AdvertiserDataUpload | v0 | AMC | 14 | v0-out-of-scope 14 |
| Advertisers | v0 | - | 2 | EX-BILLING 2 |
| AdvertisingAccounts | v0 | - | 5 | v0-deprecated 3, EX-TERMS-TOKEN 2 |
| AdvertisingBilling | v0 | - | 19 | EX-BILLING 19 |
| AdvertisingInvitations | v0 | - | 5 | EX-USERS-PERMISSIONS 5 |
| AdvertisingTestAccount | v0 | - | 2 | EX-TEST-ACCOUNTS 2 |
| AdvertisingUserPermissionsManagement | v0 | - | 5 | EX-USERS-PERMISSIONS 5 |
| AmazonAdsAPIALLAccountCombinationInvitationsContract_beta (beta) | v1 | ALL | 3 | v1-default 3 |
| AmazonAdsAPIALLAccountLinkInvitesContract_beta (beta) | v1 | ALL | 4 | v1-default 4 |
| AmazonAdsAPIALLAccountLinksContract_beta (beta) | v1 | ALL | 3 | v1-default 3 |
| AmazonAdsAPIALLAdAssociationsContract | v1 | ALL | 4 | v1-default 4 |
| AmazonAdsAPIALLAdExtensionsContract | v1 | ALL | 3 | v1-default 3 |
| AmazonAdsAPIALLAdGroupsContract | v1 | ALL | 4 | v1-default 4 |
| AmazonAdsAPIALLAdsContract | v1 | ALL | 4 | v1-default 4 |
| AmazonAdsAPIALLAdvertiserAccountsContract | v1 | ALL | 3 | v1-default 3 |
| AmazonAdsAPIALLAdvertiserProductGroupEligibilitiesContract_beta (beta) | v1 | ALL | 2 | v1-default 2 |
| AmazonAdsAPIALLAdvertisingDealsContract | v1 | ALL | 7 | v1-out-of-scope 7 |
| AmazonAdsAPIALLAdvertisingDealTargetsContract | v1 | ALL | 3 | v1-out-of-scope 3 |
| AmazonAdsAPIALLBrandedKeywordsPricingsContract | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLBrandStoreEditionPublishVersionsContract | v1 | ALL | 2 | v1-default 2 |
| AmazonAdsAPIALLBrandStoreEditionsContract | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLBrandStorePagesContract | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLBrandStorePagesContract_beta (beta) | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLBrandStoresContract | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLBuyerSeatsContract | v1 | ALL | 2 | v1-out-of-scope 2 |
| AmazonAdsAPIALLCampaignForecastsContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLCampaignsContract | v1 | ALL | 4 | v1-default 4 |
| AmazonAdsAPIALLCommitmentsContract | v1 | ALL | 5 | v1-out-of-scope 5 |
| AmazonAdsAPIALLCommitmentSpendsContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLCommunicationContactsContract_beta (beta) | v1 | ALL | 2 | v1-default 2 |
| AmazonAdsAPIALLCommunicationPreferencesContract_beta (beta) | v1 | ALL | 2 | v1-default 2 |
| AmazonAdsAPIALLDealAdvertiserAccessEntriesContract | v1 | ALL | 3 | v1-out-of-scope 3 |
| AmazonAdsAPIALLDealAdvertiserAccessesContract | v1 | ALL | 3 | v1-out-of-scope 3 |
| AmazonAdsAPIALLDealAvailsesContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLDealPerformancesContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLDealPlanningMetricsesContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLDealPreferencesContract | v1 | ALL | 2 | v1-out-of-scope 2 |
| AmazonAdsAPIALLEventsContract_beta (beta) | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLGeoLocationsContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLInventoryGroupsContract_beta (beta) | v1 | ALL | 3 | v1-out-of-scope 3 |
| AmazonAdsAPIALLKeywordReservationValidationsContract | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLLabelObjectAssociationsContract | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLLabelsContract | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLLinearTvDaypartsContract_beta (beta) | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLLinearTvIncrementalReachForecastsContract_beta (beta) | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLLinearTvReachForecastsContract_beta (beta) | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLLocationIndexesContract | v1 | ALL | 4 | v1-out-of-scope 4 |
| AmazonAdsAPIALLManagerAccountsContract | v1 | ALL | 3 | v1-default 3 |
| AmazonAdsAPIALLPromotionCodeRedemptionsContract_beta (beta) | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLPromotionOffersContract_beta (beta) | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLPromotionRewardsContract_beta (beta) | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLPublishersContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLRecommendationsContract | v1 | ALL | 3 | v1-default 3 |
| AmazonAdsAPIALLRecommendationTypesContract | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLReportsContract | v1 | ALL | 3 | v1-default 3 |
| AmazonAdsAPIALLReservedTargetPricingsContract | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLSellersContract | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLSellingAccountsContract | v1 | ALL | 1 | v1-default 1 |
| AmazonAdsAPIALLStreamSubscriptionsContract | v1 | ALL | 4 | v1-default 4 |
| AmazonAdsAPIALLSupplierAdProductPricesContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLSupplierAdProductsContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLSupplierProposalDestinationsContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLSupplierProposalsContract | v1 | ALL | 3 | v1-out-of-scope 3 |
| AmazonAdsAPIALLSupplierProposedDealForecastsContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLSupplierProposedDealHistoricalVersionsContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLSupplierProposedDealRevisionsContract | v1 | ALL | 2 | v1-out-of-scope 2 |
| AmazonAdsAPIALLSupplierProposedDealsContract | v1 | ALL | 3 | v1-out-of-scope 3 |
| AmazonAdsAPIALLSupplierPublishersContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLSuppliersContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLSupplierTargetItemsContract | v1 | ALL | 1 | v1-out-of-scope 1 |
| AmazonAdsAPIALLTargetsContract | v1 | ALL | 4 | v1-default 4 |
| AmazonAdsAPIDSPAdGroupsContract | v1 | DSP | 3 | v1-out-of-scope 3 |
| AmazonAdsAPIDSPAdsContract | v1 | DSP | 3 | v1-out-of-scope 3 |
| AmazonAdsAPIDSPAdvertisingDealsContract | v1 | DSP | 3 | v1-out-of-scope 3 |
| AmazonAdsAPIDSPCampaignsContract | v1 | DSP | 3 | v1-out-of-scope 3 |
| AmazonAdsAPIDSPTargetsContract | v1 | DSP | 3 | v1-out-of-scope 3 |
| AmazonAdsAPIExports | v0 | - | 5 | EX-EXPORTS 5 |
| AmazonAdsAPISBAdExtensionsContract | v1 | SB | 3 | v1-default 3 |
| AmazonAdsAPISBAdGroupsContract | v1 | SB | 4 | v1-default 4 |
| AmazonAdsAPISBAdsContract | v1 | SB | 4 | v1-default 4 |
| AmazonAdsAPISBAdvertisingDealsContract | v1 | SB | 4 | v1-out-of-scope 4 |
| AmazonAdsAPISBCampaignsContract | v1 | SB | 4 | v1-default 4 |
| AmazonAdsAPISBRecommendationsContract | v1 | SB | 1 | v1-default 1 |
| AmazonAdsAPISBTargetsContract | v1 | SB | 4 | v1-default 4 |
| AmazonAdsAPISDAdGroupsContract | v1 | SD | 4 | v1-default 4 |
| AmazonAdsAPISDAdsContract | v1 | SD | 4 | v1-default 4 |
| AmazonAdsAPISDCampaignsContract | v1 | SD | 4 | v1-default 4 |
| AmazonAdsAPISDTargetsContract | v1 | SD | 4 | v1-default 4 |
| AmazonAdsAPISPAdExtensionsContract | v1 | SP | 3 | v1-default 3 |
| AmazonAdsAPISPAdGroupsContract | v1 | SP | 4 | v1-default 4 |
| AmazonAdsAPISPAdsContract | v1 | SP | 4 | v1-default 4 |
| AmazonAdsAPISPCampaignsContract | v1 | SP | 4 | v1-default 4 |
| AmazonAdsAPISPGLOBALAdExtensionsContract | v1 | SPGLOBAL | 3 | v1-default 3 |
| AmazonAdsAPISPGLOBALAdGroupsContract | v1 | SPGLOBAL | 4 | v1-default 4 |
| AmazonAdsAPISPGLOBALAdsContract | v1 | SPGLOBAL | 4 | v1-default 4 |
| AmazonAdsAPISPGLOBALCampaignsContract | v1 | SPGLOBAL | 4 | v1-default 4 |
| AmazonAdsAPISPGLOBALTargetsContract | v1 | SPGLOBAL | 4 | v1-default 4 |
| AmazonAdsAPISPTargetsContract | v1 | SP | 4 | v1-default 4 |
| AmazonAdsAPISTAdGroupsContract | v1 | ST | 3 | v1-default 3 |
| AmazonAdsAPISTAdsContract | v1 | ST | 4 | v1-default 4 |
| AmazonAdsAPISTCampaignsContract | v1 | ST | 3 | v1-default 3 |
| AmazonAdsAPISTTargetsContract | v1 | ST | 4 | v1-default 4 |
| AmazonAdsDSPAPITargets-V1 | v0 | DSP | 4 | v0-out-of-scope 4 |
| AmazonAdvertiserAPIforRetailAdService | v0 | - | 16 | v0-out-of-scope 16 |
| AmazonAttribution | v0 | - | 5 | v0-out-of-scope 5 |
| AmazonMarketingStream | v0 | - | 8 | v0-out-of-scope 4, v0-deprecated 4 |
| AMCAdministration | v0 | AMC | 25 | v0-out-of-scope 25 |
| AMCCustomModels | v0 | AMC | 23 | v0-out-of-scope 23 |
| Audiences | v0 | - | 4 | EX-TARGETING-DISCOVERY 2, v0-out-of-scope 2 |
| BidAdjustments | v0 | DSP | 8 | v0-out-of-scope 8 |
| BidModifiers | v0 | - | 7 | v0-out-of-scope 7 |
| BrandAidV2 | v0 | - | 2 | v0-out-of-scope 2 |
| BrandBenchmarks | v0 | - | 2 | EX-BRAND-ANALYTICS 2 |
| BrandHome | v0 | - | 2 | EX-BRAND-ASSETS 2 |
| BrandMetrics | v0 | - | 2 | EX-BRAND-ANALYTICS 2 |
| CampaignConversionTracking-Products-V1 | v0 | DSP | 3 | v0-out-of-scope 3 |
| CampaignFlights-V1 | v0 | DSP | 4 | v0-out-of-scope 4 |
| Changehistory | v0 | - | 1 | EX-CHANGE-HISTORY 1 |
| CombinedAudienceAPI | v0 | DSP | 2 | v0-out-of-scope 2 |
| ConversionsAPI | v0 | DSP | 17 | v0-out-of-scope 17 |
| creative-asset-library | v0 | - | 6 | EX-BRAND-ASSETS 6 |
| D16GDspApiActionableInsights | v0 | DSP | 2 | v0-out-of-scope 2 |
| D16GDspApiCampaignInsightsV1 | v0 | DSP | 1 | v0-out-of-scope 1 |
| D16GDspApiDeals | v0 | DSP | 2 | v0-out-of-scope 2 |
| D16GFMApiFrequencyGroupAssociationV1 | v0 | DSP | 6 | v0-out-of-scope 6 |
| D16GFMApiFrequencyGroupV1 | v0 | DSP | 4 | v0-out-of-scope 4 |
| D16GSeatsApiService | v0 | DSP | 3 | v0-out-of-scope 3 |
| data-provider | v0 | - | 5 | v0-out-of-scope 5 |
| DealAdvertiserPermissions | v0 | DSP | 8 | v0-out-of-scope 8 |
| DealProposals | v0 | DSP | 19 | v0-out-of-scope 19 |
| Deals | v0 | DSP | 8 | v0-out-of-scope 8 |
| Diagnostics | v0 | - | 1 | EX-TARGETING-RECS 1 |
| Discovery-AdvertisedProductCategories-V1 | v0 | DSP | 1 | v0-out-of-scope 1 |
| Discovery-Apps-V1 | v0 | DSP | 1 | v0-out-of-scope 1 |
| Discovery-DomainLists-V1 | v0 | DSP | 1 | v0-out-of-scope 1 |
| Discovery-IABContentCategories-V1 | v0 | DSP | 1 | v0-out-of-scope 1 |
| Discovery-InventorySourceExchanges-V1 | v0 | DSP | 1 | v0-out-of-scope 1 |
| Discovery-ProductandProductCategory | v0 | DSP | 4 | v0-out-of-scope 4 |
| Discovery-Third-partyTargetSegments-V1 | v0 | DSP | 1 | v0-out-of-scope 1 |
| dsp-2-2-reports_previous | v0 | DSP | 2 | v0-out-of-scope 2 |
| dsp-3-0-advertiser | v0 | DSP | 2 | v0-out-of-scope 2 |
| dsp-3-0-InventoryGroups_prod_3p | v0 | DSP | 4 | v0-out-of-scope 4 |
| dsp-3-1 | v0 | DSP | 27 | v0-out-of-scope 27 |
| DSPAdCreativeAPI-V1 | v0 | DSP | 9 | v0-out-of-scope 9 |
| DSPAdCreativeAssociationAPIV1 | v0 | DSP | 6 | v0-out-of-scope 6 |
| DSPDiscovery | v0 | DSP | 1 | v0-out-of-scope 1 |
| DSPGuidance | v0 | DSP | 3 | v0-out-of-scope 3 |
| DSPQuickActions | v0 | DSP | 5 | v0-out-of-scope 5 |
| DSPReports | v0 | - | 2 | v0-out-of-scope 2 |
| Eligibility | v0 | - | 2 | EX-ELIGIBILITY 2 |
| GoalSeekingBidderTargetKPIRecommendation | v0 | DSP | 1 | v0-out-of-scope 1 |
| HashedRecords | v0 | - | 1 | v0-out-of-scope 1 |
| InheritedSettingsAPI-V1 | v0 | DSP | 6 | v0-out-of-scope 6 |
| Insights | v0 | - | 1 | v0-out-of-scope 1 |
| Localization | v0 | - | 4 | v0-out-of-scope 4 |
| Locations | v0 | - | 1 | EX-TARGETING-DISCOVERY 1 |
| ManagerAccount | v0 | - | 4 | v0-superseded 2, EX-MANAGER-LINKING 2 |
| MarketingMixModeling | v0 | - | 10 | EX-BRAND-ANALYTICS 10 |
| Measurement | v0 | DSP | 30 | v0-out-of-scope 30 |
| MediaInsightsHub | v0 | - | 5 | v0-out-of-scope 5 |
| MediaPlanningAPI | v0 | - | 41 | v0-out-of-scope 41 |
| Moderation | v0 | - | 1 | EX-MODERATION 1 |
| OfflineReport | v0 | - | 3 | v0-superseded 3 |
| PartnerOpportunities | v0 | - | 5 | v0-out-of-scope 5 |
| PersonaBuilderAPI | v0 | - | 5 | v0-out-of-scope 5 |
| Portfolios | v0 | - | 4 | EX-PORTFOLIOS 4 |
| Posts | v0 | - | 11 | v0-deprecated 11 |
| PreModeration | v0 | - | 1 | EX-MODERATION 1 |
| ProductSelector | v0 | - | 1 | EX-ELIGIBILITY 1 |
| profiles-3-0 | v0 | - | 3 | EX-PROFILES 3 |
| ReachPlanningService | v0 | - | 5 | v0-out-of-scope 5 |
| RetailerIdentityAPIforRetailAdService | v0 | - | 1 | v0-out-of-scope 1 |
| Rule-BasedAudiences | v0 | AMC | 6 | v0-out-of-scope 6 |
| SeatIDs | v0 | DSP | 1 | v0-out-of-scope 1 |
| sponsored-brands-3-0 | v0 | SB | 38 | EX-BRAND-ASSETS 5, EX-BUDGET-USAGE-RECS 1, v0-deprecated 27, EX-TARGETING-RECS 4, EX-TARGETING-DISCOVERY 1 |
| sponsored-brands-4-0 | v0 | SB | 54 | v0-superseded 26, EX-BUDGET-RULES 8, EX-BUDGET-USAGE-RECS 2, EX-TARGETING-RECS 5, EX-OPTIMIZATION-RULES 5, EX-TARGETING-DISCOVERY 3, v0-deprecated 5 |
| sponsored-display-3-0 | v0 | SD | 76 | v0-deprecated 6, v0-superseded 40, EX-OPTIMIZATION-RULES 7, EX-BRAND-SAFETY 6, EX-BUDGET-RULES 8, EX-BUDGET-USAGE-RECS 2, EX-TARGETING-RECS 4, EX-TARGETING-DISCOVERY 3 |
| sponsored-products-2-0 | v0 | SP | 11 | v0-deprecated 11 |
| SponsoredBrandsCategoryBenchmark | v0 | SB | 3 | EX-BRAND-ANALYTICS 3 |
| SponsoredProducts | v0 | SP | 80 | v0-superseded 36, EX-BUDGET-RULES 10, EX-TARGETING-RECS 14, EX-OPTIMIZATION-RULES 10, EX-BUDGET-USAGE-RECS 4, EX-TARGETING-DISCOVERY 5, EX-EVENTS 1 |
| SponsoredTV | v0 | - | 26 | v0-out-of-scope 26 |
| Stores | v0 | - | 2 | EX-BRAND-ANALYTICS 2 |
| TargetableEntities | v0 | - | 2 | EX-TARGETING-DISCOVERY 2 |
| ValidationConfigurationsAPI | v0 | - | 2 | v0-out-of-scope 2 |
| WorkflowManagementService | v0 | AMC | 17 | v0-out-of-scope 17 |

Skipped specs (not catalogued): see §8.
