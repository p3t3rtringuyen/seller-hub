# Table → source mapping

For every table: source, column → source field, refresh mode, retention, PII flag. Column-level mappings are
also written as SQL comments next to each column in `db/design/*.sql`; this file is the reviewable summary.

Refresh modes: **report** (async report / export), **pull** (paged API), **sync-read** (one call per window),
**notification** / **stream** (push, v1), **command** (written after our own Amazon write — refresh-after-write,
D62 a), **user** (UI input), **system** (written by our services), **seed** (migration).
Retention codes: **acct** = until the seller account (or tenant) is deleted; see README §4 for the others.
Model paths are relative to the repository root. `ads-defs/` = `catalog/ads/definitions/`,
`sp-defs/` = `catalog/spapi/definitions/`.

## 1. Summary

| Table | Source | Refresh | Retention | PII |
|---|---|---|---|---|
| `ref.regions` | Ads `RegionCode` (`ads-defs/AmazonAdsAPIALLAdvertiserAccountsContract.json`) | seed | permanent | no |
| `ref.currencies` | `SPCurrencyCode` (`ads-defs/AmazonAdsAPISPCampaignsContract.json`), `Marketplace.defaultCurrencyCode` (`sp-defs/sellers@v1.json`) | seed | permanent | no |
| `ref.marketplaces` | `Marketplace` (`sp-defs/sellers@v1.json`), `Profile.countryCode/timezone` (`ads-defs/profiles-3-0.json`), ids from `refs/amazon/selling-partner-api-samples/local-ai-sandbox/src/marketplaceIds.ts` | seed | permanent | no |
| `ref.ads_limits` | `refs/amazon-ads/docs/reference/concepts/limits.md` | seed | permanent | no |
| `identity.users` | app-owned | user | until user deleted | member e-mail (tenant user, not buyer PII) |
| `identity.auth_accounts`, `identity.sessions`, `identity.verifications`, `identity.two_factor_secrets` | app-owned (ADR-0004) | system | sessions/verifications 30 d after expiry | secrets hashed/encrypted |
| `identity.api_tokens` | app-owned (ADR-0004 §6) | user | until revoked + 30 d | hashed |
| `core.tenants`, `core.memberships`, `core.role_grants`, `core.invitations` | app-owned (ADR-0004) | user | tenants: until deleted; invitations 30 d after expiry | invitation e-mail (tenant user) |
| `core.seller_accounts` | app-owned; `selling_partner_id` from `SellingPartnerMetadata.sellingPartnerId` (`sp-defs/finances@2024-06-19.json`) | user / system | acct | no |
| `core.connections`, `core.connect_states` | app-owned (ADR-0005) | system | connections acct; states 1 d | no |
| `core.credentials` | app-owned (ADR-0005), LWA refresh tokens encrypted | system | until disconnect | secret (encrypted) |
| `core.ads_profiles` | v0 `listProfiles` EX-PROFILES (`ads-defs/profiles-3-0.json`), v1 `QueryAdvertiserAccount` (`ads-defs/AmazonAdsAPIALLAdvertiserAccountsContract.json`) | pull (on connect + daily) | acct | no |
| `core.seller_account_marketplaces` | `sellers.getMarketplaceParticipations` (`sp-defs/sellers@v1.json`) + user link to Ads profile | sync-read (daily) + user | acct | no |
| `core.user_preferences` | app-owned | user | acct | no |
| `ingest.sync_states` | app-owned (ADR-0008) | system | acct | no |
| `ingest.job_runs` | app-owned (ADR-0008) | system | 90 d | no |
| `ingest.raw_objects` | app-owned index of S3 objects | system | 35 d | raw docs PII-stripped before landing for orders |
| `ingest.inbox` | `catalog/spapi/notifications.json`, `catalog/ads/stream.json` | notification / stream (v1) | 35 d / 90 d | no (ORDER_CHANGE has no buyer data) |
| `ads.portfolios` | v0 `Portfolio` EX-PORTFOLIOS (`ads-defs/Portfolios.json`) | pull + command | acct | no |
| `ads.sp_campaigns` | v1 `SPCampaign` (`ads-defs/AmazonAdsAPISPCampaignsContract.json`) | pull (query by lastUpdated) + report (EX-EXPORTS daily reconcile) + command | acct | no |
| `ads.sp_campaign_placement_adjustments` | v1 `SPPlacementBidAdjustment` (same file) | as campaigns | acct | no |
| `ads.sp_ad_groups` | v1 `SPAdGroup` (`ads-defs/AmazonAdsAPISPAdGroupsContract.json`) | as campaigns | acct | no |
| `ads.sp_ads` | v1 `SPAd` (`ads-defs/AmazonAdsAPISPAdsContract.json`) | as campaigns | acct | no |
| `ads.sp_targets` | v1 `SPTarget` (`ads-defs/AmazonAdsAPISPTargetsContract.json`) | as campaigns | acct | no |
| `facts.ads_sp_*_daily` (6 tables) | v1 reports `AdsApiv1CreateReport` (`catalog/ads/reports.json` → `v1.fields`) | report (6 h, 3-day lookback; backfill 24 months) | acct | no (search term = shopper query text, not personal data) |
| `catalog.listings`, `catalog.listing_issues` | report `GET_MERCHANT_LISTINGS_ALL_DATA` (`catalog/spapi/reports.json`), `searchListingsItems` (`sp-defs/listingsItems@2021-08-01.json`) | report (daily) + pull (status/issues) | acct | no |
| `catalog.catalog_items` | `getCatalogItem` (`sp-defs/catalogItems@2022-04-01.json`) | pull (new ASINs, weekly refresh) | acct | no |
| `inventory.fba_inventory` | `getInventorySummaries` (`sp-defs/fbaInventory@v1.json`) | pull (incremental by startDateTime) | acct | no |
| `orders.orders`, `orders.order_items` | report `GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL`; `searchOrders`/`getOrder` (`sp-defs/orders@2026-01-01.json`) | report (backfill) + pull (lastUpdatedAfter, 15 min overlap) | acct | **stripped**: no buyer/address fields (D11) |
| `finance.transactions`, `finance.transaction_lines` | `listTransactions` (`sp-defs/finances@2024-06-19.json`) | pull (postedAfter with overlap) | acct | no |
| `finance.financial_event_groups` | `listFinancialEventGroups` (`sp-defs/finances@v0.json`) | pull (daily) | acct | `AccountTail` dropped |
| `facts.sales_daily` | `getOrderMetrics` (`sp-defs/sales@v1.json`) | sync-read (daily + intraday for today) | acct | no |
| `facts.inventory_fba_daily` | copy of `inventory.fba_inventory` | system (daily snapshot) | acct | no |
| `facts.finance_sku_daily` | aggregate of `finance.transaction_lines` | system (after finance sync) | acct | no |
| `ops.commands`, `ops.command_items`, `ops.outbox` | app-owned (ADR-0011) | user / rule / system | 25 months (outbox 7 d) | no |
| `ops.audit_log` | app-owned (ADR-0011) | system | 25 months | actor e-mail label only; never buyer PII |
| `ops.change_history` | app-owned + Amazon: sync diffs and v0 `getHistory` EX-CHANGE-HISTORY (`ads-defs/Changehistory.json`) | command / pull / system | 25 months | no |
| `ops.automation_settings`, `ops.rules`, `ops.rule_runs` | app-owned (ADR-0011 §5, D63 a) | user / system | settings/rules acct; runs 25 months | no |

## 2. Column mappings — Amazon-derived tables

### `core.ads_profiles` — `ads-defs/profiles-3-0.json`, `ads-defs/AmazonAdsAPIALLAdvertiserAccountsContract.json`
`amazon_profile_id` ← `Profile.profileId` (int64 stored as text) · `account_type` ← `AccountInfo.type` (seller|vendor|agency) ·
`account_sub_type` ← `AccountInfo.subType` · `amazon_account_info_id` ← `AccountInfo.id` · `account_name` ← `AccountInfo.name` ·
`ads_country_code` ← `Profile.countryCode` · `marketplace_id` ← `AccountInfo.marketplaceStringId` · `currency` ← `Profile.currencyCode` ·
`time_zone` ← `Profile.timezone` · `valid_payment_method` ← `AccountInfo.validPaymentMethod` ·
`amazon_advertiser_account_id` ← `AdvertiserAccount.advertiserAccountId` (matched by `alternateIds[].profileId`) · `raw` ← full payload.

### `core.seller_account_marketplaces` — `sp-defs/sellers@v1.json`
`marketplace_id` ← `MarketplaceParticipation.marketplace.id` · `is_participating` ← `participation.isParticipating` ·
`has_suspended_listings` ← `participation.hasSuspendedListings` · `ads_profile_id` ← user link (one profile per marketplace).

### `ads.portfolios` — `ads-defs/Portfolios.json`
`amazon_portfolio_id` ← `portfolioId` · `name` ← `name` · `state` ← `state` · `in_budget` ← `inBudget` ·
`budget_policy` ← `budget.policy` · `budget_amount` ← `budget.amount` · `budget_currency` ← `budget.currencyCode` ·
`budget_start_date` / `budget_end_date` ← `budget.startDate` / `endDate` · `serving_status` ← `extendedData.servingStatus` ·
`status_reasons` ← `extendedData.statusReasons` · `amazon_created_at` / `amazon_last_updated_at` ← `extendedData.creationDateTime` / `lastUpdateDateTime`.

### `ads.sp_campaigns` — `ads-defs/AmazonAdsAPISPCampaignsContract.json` (`SPCampaign`)
`amazon_campaign_id` ← `campaignId` · `name` ← `name` · `state` ← `state` (`SPState`) · `delivery_status` ← `status.deliveryStatus` ·
`delivery_reasons` ← `status.deliveryReasons` (`SPDeliveryReason`; "out of budget" chip = `CAMPAIGN_OUT_OF_BUDGET`) ·
`marketplace_id` ← `marketplaces[0]` mapped via `ref.marketplaces.country_code` (`marketplaceScope` = `SINGLE_MARKETPLACE`) ·
`amazon_portfolio_id` ← `portfolioId` · `auto_create_targets` ← `autoCreationSettings.autoCreateTargets` · `targeting_type` derived (AUTO when true) ·
`start_at` / `end_at` ← `startDateTime` / `endDateTime` · `budget_type` ← `budgets[0].budgetType` · `budget_recurrence` ← `budgets[0].recurrenceTimePeriod` ·
`daily_budget` ← `budgets[0].budgetValue.monetaryBudget.value` · `budget_rule_value` ← `…monetaryBudget.ruleValue` · `currency` ← `…monetaryBudget.currencyCode` ·
`bid_strategy` ← `optimizations.bidSettings.bidStrategy` · `site_restrictions` ← `siteRestrictions` · `global_campaign_id` ← `globalCampaignId` ·
`tags` ← `tags` · `amazon_created_at` ← `creationDateTime` · `amazon_last_updated_at` ← `lastUpdatedDateTime`.
Not modelled (kept in `raw`): `countries`, `retailerScope`, `autoScaleGlobalCampaign`, `optimizations.budgetSettings`, audience and creative bid adjustments.

### `ads.sp_campaign_placement_adjustments`
`placement` ← `optimizations.bidSettings.bidAdjustments.placementBidAdjustments[].placement` (`SPPlacement`) · `percentage` ← `…percentage`.

### `ads.sp_ad_groups` — `ads-defs/AmazonAdsAPISPAdGroupsContract.json` (`SPAdGroup`)
`amazon_ad_group_id` ← `adGroupId` · `amazon_campaign_id` ← `campaignId` · `name` · `state` · `delivery_status` / `delivery_reasons` ← `status.*` ·
`default_bid` ← `bid.defaultBid` · `currency` ← `bid.currencyCode` · `global_ad_group_id` · `tags` · timestamps as above.
Not modelled: `adSettings.productAttributeSetRefinementConfigurationId`, `retailerId`, `retailerScope` (in `raw`).

### `ads.sp_ads` — `ads-defs/AmazonAdsAPISPAdsContract.json` (`SPAd`)
`amazon_ad_id` ← `adId` · `amazon_ad_group_id` / `amazon_campaign_id` ← `adGroupId` / `campaignId` · `ad_type` ← `adType` ·
`product_id` / `product_id_type` ← `creative.productCreativeSettings.advertisedProduct.productId` / `productIdType` ·
`asin` ← `…resolvedProductId` when `resolvedProductIdType = ASIN`, else `productId` when `productIdType = ASIN` ·
`sku` ← `productId` when `productIdType = SKU` · `state` · `delivery_status` / `delivery_reasons` ← `status.*` · `global_ad_id` · `tags`.
Not modelled: `headline`, `spotlightVideos`, `globalStoreSetting` (in `raw`).

### `ads.sp_targets` — `ads-defs/AmazonAdsAPISPTargetsContract.json` (`SPTarget`)
`amazon_target_id` ← `targetId` · `amazon_campaign_id` / `amazon_ad_group_id` ← `campaignId` / `adGroupId` · `target_level` ← `targetLevel` ·
`target_type` ← `targetType` · `negative` ← `negative` · `state` · `delivery_*` ← `status.*` · `bid` / `bid_currency` ← `bid.bid` / `bid.currencyCode` ·
`target_details` ← `targetDetails` (verbatim) · flattened from it: `keyword_text`, `match_type`, `native_language_keyword`, `native_language_locale`
← `SPKeywordTarget`; `product_id`, `product_id_type`, `match_type` ← `SPProductTarget`; `category_id`, `category_refinement` ← `SPProductCategoryTarget.productCategoryRefinement`;
`match_type` ← `SPThemeTarget.matchType` (auto targeting groups); `location_id` ← `SPLocationTarget.locationId`.

### `facts.ads_sp_*_daily` — `catalog/ads/reports.json` → `v1.fields` (adProduct `SPONSORED_PRODUCTS`)
Shared: `date` ← `date.value` · `impressions` ← `metric.impressions` · `clicks` ← `metric.clicks` · `cost` ← `metric.totalCost` ·
`sales` ← `metric.sales` (SP: 7-day sellers / 14-day vendors) · `purchases` ← `metric.purchases` · `units_sold` ← `metric.unitsSold` ·
`currency` ← `budgetCurrency.value` / `campaign.currencyCode`.
Per table keys/dimensions: campaign ← `campaign.id`, `portfolio.portfolioId`, `campaign.name`, plus `metric.topOfSearchImpressionShare`,
`metric.impressionShare`, `metric.impressionShareRank` · ad group ← `adGroup.id` · target ← `adGroupTarget.id`, `targeting.value`,
`targetingMatchType.value` · ad ← `ad.id`, `advertisedProduct.id`, `advertisedProductSku.value` · search term ← `searchTerm.value` +
`adGroupTarget.id` · placement ← `placementClassification.value`.
**Not available in v1 for SP, therefore not modelled (D57 a)**: v3 same-SKU / other-SKU split (`attributedSalesSameSku*`), 1/14/30-day
attribution variants (v1 has one window per account type), KENP. Legacy grids that showed them hide the column.
**Coverage to confirm (nullable)**: search-term `sales/purchases/units_sold`, placement conversions, target-level TOS IS (SCOPE ADS-07, D57).

### `catalog.listings` / `catalog.listing_issues` — `sp-defs/listingsItems@2021-08-01.json`, report `GET_MERCHANT_LISTINGS_ALL_DATA`
`seller_sku` ← `Item.sku` / report `seller-sku` · `asin` ← `summaries[].asin` / report `asin1` · `fn_sku` ← `summaries[].fnSku` ·
`item_name` ← `summaries[].itemName` / report `item-name` · `product_type` ← `summaries[].productType` · `condition_type` ← `summaries[].conditionType` ·
`statuses` ← `summaries[].status` · `report_status` ← report `status` · `main_image_url` ← `summaries[].mainImage.link` ·
`price_amount` / `price_currency` ← `offers[offerType=B2C].price` / report `price` · `fulfillment_channel` / `merchant_quantity` ←
`fulfillmentAvailability[].fulfillmentChannelCode` / `quantity` · `issue_*_count` ← count of `issues[].severity` · `open_date` ← report `open-date` ·
`amazon_created_at` / `amazon_last_updated_at` ← `summaries[].createdDate` / `lastUpdatedDate`.
Issues: `code`, `severity`, `message`, `categories`, `attribute_names` ← `Issue.attributeNames`, `enforcements` ← `Issue.enforcements`.
Report columns are documented by Amazon's report reference, not by a JSON model in `catalog/` (flat file) — the parser test fixes them.

### `catalog.catalog_items` — `sp-defs/catalogItems@2022-04-01.json`
`asin` ← `Item.asin` · `title` ← `summaries[].itemName` · `brand` ← `summaries[].brand` · `main_image_url` ← `images[].images[variant=MAIN].link` ·
`product_type` ← `productTypes[].productType` · `browse_node_id` / `browse_node_name` ← `summaries[].browseClassification.classificationId` / `displayName` ·
`parent_asin` ← `relationships[].relationships[type=VARIATION].parentAsins[0]`.

### `inventory.fba_inventory` — `sp-defs/fbaInventory@v1.json`
`seller_sku`, `fn_sku`, `asin`, `condition`, `product_name`, `total_quantity`, `amazon_last_updated_at` ← `InventorySummary.*`
(`lastUpdatedTime`) · `fulfillable_quantity`, `inbound_working_quantity`, `inbound_shipped_quantity`, `inbound_receiving_quantity` ← `InventoryDetails.*` ·
`reserved_*` ← `ReservedQuantity.*` · `researching_total_quantity` ← `ResearchingQuantity.totalResearchingQuantity` ·
`unfulfillable_total_quantity` / `unfulfillable_breakdown` ← `UnfulfillableQuantity` · `marketplace_id` ← `Granularity.granularityId`.

### `orders.orders` / `orders.order_items` — `sp-defs/orders@2026-01-01.json`, report `GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL`
Orders: `amazon_order_id` ← `Order.orderId` / `amazon-order-id` · `purchased_at` ← `createdTime` / `purchase-date` · `purchase_date` = local date ·
`amazon_last_updated_at` ← `lastUpdatedTime` / `last-updated-date` · `fulfillment_status` ← `fulfillment.fulfillmentStatus` / `order-status` (normalised) ·
`fulfilled_by` ← `fulfillment.fulfilledBy` / `fulfillment-channel` · `fulfillment_service_level` ← `fulfillment.fulfillmentServiceLevel` / `ship-service-level` ·
`sales_channel` ← `salesChannel.channelName` / `sales-channel` · `marketplace_id` ← `salesChannel.marketplaceId` · `programs` ← `programs` ·
`is_business_order` ← `is-business-order` · `order_total_amount` ← `proceeds.grandTotal` or sum of line `item-price` · `ship_country_code` / `ship_state_or_region` ←
`recipient.deliveryAddress.countryCode` / `stateOrRegion`, report `ship-country` / `ship-state` · `latest_ship_at` / `latest_delivery_at` ← `shipByWindow` / `deliverByWindow` end.
Items: `amazon_order_item_id` ← `OrderItem.orderItemId` · `asin`, `seller_sku`, `title`, `condition_type` ← `product.*` · `quantity_ordered` ←
`quantityOrdered` / `quantity` · `quantity_shipped` ← `fulfillment.quantityFulfilled` · `unit_price_amount` ← `product.price.unitPrice` ·
`item_price_amount`, `item_tax_amount`, `shipping_price_amount`, `promotion_discount_amount`, `item_status` ← report columns ·
`proceeds_amount` ← `proceeds.proceedsTotal`.
**Dropped (D11)**: `buyer.*`, `recipient.deliveryAddress` lines/city/postal code, report `ship-city`, `ship-postal-code`, buyer PO number, gift options.

### `finance.*` — `sp-defs/finances@2024-06-19.json`, `sp-defs/finances@v0.json`
Transactions: `amazon_transaction_id` ← `transactionId` · `transaction_type` / `transaction_status` / `description` ← same names ·
`posted_at` ← `postedDate` · `total_amount` / `currency` ← `totalAmount.currencyAmount` / `currencyCode` · `marketplace_id` ← `marketplaceDetails.marketplaceId` ·
`amazon_order_id`, `settlement_id`, `financial_event_group_id` ← `relatedIdentifiers[relatedIdentifierName=…]` · `related_identifiers`, `breakdowns`, `contexts` verbatim.
Lines: each leaf `Breakdown` under `breakdowns` / `items[].breakdowns` → `breakdown_path`, `breakdown_type`, `amount`, `currency`;
`asin`, `seller_sku`, `quantity`, `fulfillment_network` ← `items[].contexts[contextType=ProductContext]`.
Event groups: `amazon_group_id` ← `FinancialEventGroupId` · `processing_status` ← `ProcessingStatus` · `fund_transfer_status` / `fund_transfer_at` ←
`FundTransferStatus` / `FundTransferDate` · `group_start_at` / `group_end_at` ← `FinancialEventGroupStart` / `End` · `original_total_*`, `converted_total_*`,
`beginning_balance_*` ← same-named `Currency` objects · `trace_id` ← `TraceId`. `AccountTail` not stored.

### `facts.sales_daily` — `sp-defs/sales@v1.json`
`date` ← `OrderMetricsInterval.interval` start · `order_count`, `order_item_count`, `unit_count` ← same names · `total_sales` / `currency` ←
`totalSales.amount` / `currencyCode` · `scope_kind`/`scope_value` ← request `asin` / `sku` parameter · `fulfillment_network` ← request filter.

## 3. Legacy entity coverage (`catalog/legacy/entities.json`, classes `amazon-mirror` and `app-owned`)

Internal-class entities (39: departments, tickets, BI, budget accounts, Walmart/Wayfair, Kafka plumbing) are out
of scope by D0/SCOPE and are not listed. Names below are the legacy entity names from the catalogue.

| Legacy entity | Class | Home in seller-hub | Notes |
|---|---|---|---|
| Campaigns | amazon-mirror | `ads.sp_campaigns` (SP); SB/SD later | one table per ad product (trap 16); local display-name/request dates dropped |
| AdGroups | amazon-mirror | `ads.sp_ad_groups` | |
| ProductAds | amazon-mirror | `ads.sp_ads` | SB creatives later |
| Targets, Keywords, NegativeKeywords, NegativeTargets, CampaignNegativeKeyword, CampaignNegativeProduct | amazon-mirror | `ads.sp_targets` | v1 `SPTarget` unifies all six; `native_language_keyword` kept (legacy local column is an Amazon field in v1) |
| Creatives | amazon-mirror | — (SB/SD, v1 ADS-12/13) | not MVP |
| CreativeHistories | app-owned | `ops.change_history` (later, for SB/SD creatives) | |
| Audience | amazon-mirror | — (SD, v1 ADS-13) | not MVP |
| BudgetRules, AssignedRules | amazon-mirror | — (ADS-11, v1) | budget rules are v0 EX-BUDGET-RULES; tables with that slice |
| OptimizationRuleCPC | amazon-mirror | — | Amazon "bid optimization" rules not in SCOPE; our rules are `ops.rules` |
| Portfolio | amazon-mirror | `ads.portfolios` | now with name and budget |
| Profile | amazon-mirror | `core.ads_profiles` | internal org code dropped |
| Categories | amazon-mirror | none (interactive, cached in Redis) | category tree via EX-TARGETING-DISCOVERY at build time (ADS-08) |
| BiddingRules | app-owned | `ops.rules` (new `rule_type` values in AUT-02/07) | not copied (clean room); placement-bid scheduling is AUT-07 (v1) |
| PortfolioUser, Roles | app-owned | `core.role_grants` | scope is seller account (D55); portfolio-level access not in D55 |
| PortfolioDisable | app-owned | `core.user_preferences` (hidden items) if needed | not in SCOPE as a feature |
| NotificationIncidents | app-owned | — (PLT-08, v1) | |
| InventoryAlertFeedback | app-owned | — (INV-03, v1) | |
| DownloadHistory | app-owned | — (PLT-09, v1 `ops.exports`) | MVP CSV export is inline |
| KafkaFailedHistory, MessagePublicFail | app-owned | `ingest.inbox` (failed rows) / BullMQ | no separate DLQ table (trap 14) |
| KeywordTranslate | app-owned | — | cross-marketplace copy is ADS-14 (v1) |
| LogRequestActions | app-owned | `ops.commands` | |
| LogRequestActivity | app-owned | `ops.command_items` | |
| OperationLog, OperationActivityLogs, UserActivityLogs, Log | app-owned | `ops.audit_log` (+ `ops.change_history` for entity changes) | |
| LogStatusAsinProductAds | app-owned | `ops.change_history` (`source=amazon`, `observed_via=sync_diff`, field `other`/state) | |
| StatusAsinProductAds | app-owned | `ads.sp_ads.delivery_status` / `delivery_reasons` | eligibility comes from v1 ad status |

Legacy report read models (CampaignReport, AdGroupReport, AdReport, TargetReport, KeywordReport, ChartReport,
ProductReport, SearchTermsReport, SkuPerformance) map to `facts.ads_sp_*_daily`; PortfolioReport is a sum of
campaign facts by `amazon_portfolio_id`.
