-- Up Migration
-- Source: db/design/05_ads.sql (P2-DATA, frozen reference). Verbatim copy; packages/testing/test/platform-db.test.ts keeps them identical.
-- seller-hub data model — 05 ads (Amazon Ads mirror, Sponsored Products)
-- Slice: L0 (ADS-01 sync, ADS-03 read) + MVP (ADS-04..09 write through ops.commands, refresh after write, D62 a).
-- Generation: Ads API v1 by default (D53); v0 named exceptions: EX-PORTFOLIOS (portfolios),
-- EX-PROFILES (profiles, core.ads_profiles), EX-CHANGE-HISTORY (ops.change_history source=amazon).
-- One table per entity per ad product (ADR-0009 decision 2, legacy trap 16). SB/SD tables come with ADS-12/13.
--
-- Common mirror columns (ADR-0009 decision 2):
--   raw jsonb                  last Amazon payload, for fields not modelled yet
--   amazon_created_at          v1 creationDateTime
--   amazon_last_updated_at     v1 lastUpdatedDateTime (drives incremental sync)
--   synced_at                  when our mirror last saw the entity
--   deleted_at                 not returned by Amazon any more (export reconciliation). ARCHIVED stays a state.
-- Enum policy: Amazon values verbatim (conventions §1). CHECK constraints only on enums we WRITE
-- (state, match types, bid strategy, placement); read-only enums that Amazon extends often
-- (deliveryStatus, deliveryReasons) are text so a new value never breaks ingestion.

-- ---------------------------------------------------------------------------
-- Portfolios — v0 EX-PORTFOLIOS (ADS-09)
-- ---------------------------------------------------------------------------
create table ads.portfolios (
  id                      uuid primary key,
  tenant_id               uuid not null,
  seller_account_id       uuid not null,
  ads_profile_id          uuid not null,
  marketplace_id          text not null references ref.marketplaces (id),
  amazon_portfolio_id     text not null,                -- Portfolio.portfolioId
  name                    text not null,                -- Portfolio.name
  state                   text not null,                -- Portfolio.state (EntityState; v0 doc lists ENABLED)
  in_budget               boolean,                      -- Portfolio.inBudget
  budget_policy           text check (budget_policy in ('DATE_RANGE', 'MONTHLY_RECURRING', 'NO_CAP', 'OTHER')), -- PortfolioBudget.policy
  budget_amount           numeric(18,4),                -- PortfolioBudget.amount
  budget_currency         char(3) references ref.currencies (code), -- PortfolioBudget.currencyCode
  budget_start_date       date,                         -- PortfolioBudget.startDate
  budget_end_date         date,                         -- PortfolioBudget.endDate
  serving_status          text,                         -- PortfolioExtendedData.servingStatus
  status_reasons          text[] not null default '{}', -- PortfolioExtendedData.statusReasons
  raw                     jsonb not null default '{}',
  amazon_created_at       timestamptz,                  -- PortfolioExtendedData.creationDateTime
  amazon_last_updated_at  timestamptz,                  -- PortfolioExtendedData.lastUpdateDateTime
  synced_at               timestamptz not null,
  deleted_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (seller_account_id, amazon_portfolio_id),
  unique (tenant_id, id),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, ads_profile_id) references core.ads_profiles (tenant_id, id) on delete cascade,
  check (budget_policy is distinct from 'DATE_RANGE' or budget_start_date is not null)
);
comment on table ads.portfolios is
  'Amazon mirror. v0 Portfolios (catalog/ads/definitions/Portfolios.json: Portfolio, PortfolioBudget, PortfolioExtendedData). Legacy "Portfolio" kept only id/state; name and budget now mirrored.';
create index portfolios_list_idx on ads.portfolios (seller_account_id, ads_profile_id, name) where deleted_at is null;
create index portfolios_name_trgm on ads.portfolios using gin (name gin_trgm_ops);
create trigger portfolios_touch before update on ads.portfolios for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('ads.portfolios');

-- ---------------------------------------------------------------------------
-- SP campaigns — v1 SPCampaign (catalog/ads/definitions/AmazonAdsAPISPCampaignsContract.json)
-- ---------------------------------------------------------------------------
create table ads.sp_campaigns (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  seller_account_id         uuid not null,
  ads_profile_id            uuid not null,
  marketplace_id            text not null references ref.marketplaces (id), -- SPCampaign.marketplaces[0] (SINGLE_MARKETPLACE)
  amazon_campaign_id        text not null,              -- SPCampaign.campaignId
  amazon_portfolio_id       text,                       -- SPCampaign.portfolioId
  portfolio_id              uuid,                       -- resolved; NULL until the portfolio is mirrored
  name                      text not null,              -- SPCampaign.name
  state                     text not null check (state in ('ENABLED', 'PAUSED', 'ARCHIVED')), -- SPState
  delivery_status           text,                       -- SPStatus.deliveryStatus (DELIVERING|NOT_DELIVERING|UNAVAILABLE)
  delivery_reasons          text[] not null default '{}', -- SPStatus.deliveryReasons (SPDeliveryReason)
  targeting_type            text check (targeting_type in ('AUTO', 'MANUAL')), -- derived: autoCreationSettings.autoCreateTargets
  auto_create_targets       boolean not null,           -- SPAutoCreationSettings.autoCreateTargets
  start_at                  timestamptz not null,       -- SPCampaign.startDateTime
  end_at                    timestamptz,                -- SPCampaign.endDateTime
  budget_type               text not null default 'MONETARY' check (budget_type in ('MONETARY')), -- SPBudget.budgetType
  budget_recurrence         text not null default 'DAILY' check (budget_recurrence in ('DAILY')), -- SPBudget.recurrenceTimePeriod
  daily_budget              numeric(18,4) not null,     -- SPMonetaryBudget.value
  budget_rule_value         numeric(18,4),              -- SPMonetaryBudget.ruleValue (budget after a rule applied)
  currency                  char(3) not null references ref.currencies (code), -- SPMonetaryBudget.currencyCode
  bid_strategy              text check (bid_strategy in ('MANUAL', 'RULE_BASED', 'SALES_DOWN_ONLY', 'SALES_UP_AND_DOWN')), -- SPBidSettings.bidStrategy
  site_restrictions         text[] not null default '{}', -- SPCampaign.siteRestrictions (AMAZON_BUSINESS|AMAZON_HAUL)
  global_campaign_id        text,                       -- SPCampaign.globalCampaignId
  tags                      jsonb not null default '[]', -- SPCampaign.tags [{key,value}]
  raw                       jsonb not null default '{}',
  amazon_created_at         timestamptz not null,       -- SPCampaign.creationDateTime
  amazon_last_updated_at    timestamptz not null,       -- SPCampaign.lastUpdatedDateTime
  synced_at                 timestamptz not null,
  deleted_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (seller_account_id, amazon_campaign_id),
  unique (tenant_id, id),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, ads_profile_id) references core.ads_profiles (tenant_id, id) on delete cascade,
  foreign key (tenant_id, portfolio_id) references ads.portfolios (tenant_id, id) on delete set null (portfolio_id)
);
comment on table ads.sp_campaigns is
  'Amazon mirror. v1 SPCampaign (catalog/ads/definitions/AmazonAdsAPISPCampaignsContract.json). Legacy "Campaigns" (one table for SP/SB/SD) maps here for SP only; legacy local display-name and request-date columns are not kept.';
-- Campaign Manager grid (ADS-03): filter state / portfolio / profile, search name, default sort by name;
-- metric sorts are computed from facts joined on amazon_campaign_id.
create index sp_campaigns_list_idx on ads.sp_campaigns (seller_account_id, ads_profile_id, state, name) where deleted_at is null;
create index sp_campaigns_portfolio_idx on ads.sp_campaigns (seller_account_id, amazon_portfolio_id) where deleted_at is null;
create index sp_campaigns_name_trgm on ads.sp_campaigns using gin (name gin_trgm_ops);
create index sp_campaigns_updated_idx on ads.sp_campaigns (seller_account_id, amazon_last_updated_at);
create trigger sp_campaigns_touch before update on ads.sp_campaigns for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('ads.sp_campaigns');

-- Placement bid adjustments (ADS-05: TOS/ROS/PP 0–900 %). Replace semantics: the set is written whole (UX-14).
create table ads.sp_campaign_placement_adjustments (
  tenant_id          uuid not null,
  seller_account_id  uuid not null,
  campaign_id        uuid not null,
  placement          text not null check (placement in
                       ('TOP_OF_SEARCH', 'REST_OF_SEARCH', 'PRODUCT_PAGE', 'SITE_AMAZON_BUSINESS', 'TOP_OF_BROWSE', 'REST_OF_BROWSE')), -- SPPlacement
  percentage         integer not null check (percentage between 0 and 900), -- SPPlacementBidAdjustment.percentage
  synced_at          timestamptz not null,
  primary key (campaign_id, placement),
  foreign key (tenant_id, campaign_id) references ads.sp_campaigns (tenant_id, id) on delete cascade
);
comment on table ads.sp_campaign_placement_adjustments is
  'Amazon mirror. SPCampaign.optimizations.bidSettings.bidAdjustments.placementBidAdjustments (SPPlacementBidAdjustment, AmazonAdsAPISPCampaignsContract.json). Audience/creative adjustments stay in sp_campaigns.raw until a slice needs them. 0–900 range: console/legacy rule (LW §5), kept as CHECK and validated again from ref data.';
select core.apply_tenant_rls('ads.sp_campaign_placement_adjustments');

-- ---------------------------------------------------------------------------
-- SP ad groups — v1 SPAdGroup (catalog/ads/definitions/AmazonAdsAPISPAdGroupsContract.json)
-- ---------------------------------------------------------------------------
create table ads.sp_ad_groups (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  seller_account_id         uuid not null,
  campaign_id               uuid not null,
  marketplace_id            text not null references ref.marketplaces (id),
  amazon_ad_group_id        text not null,              -- SPAdGroup.adGroupId
  amazon_campaign_id        text not null,              -- SPAdGroup.campaignId
  name                      text not null,              -- SPAdGroup.name (unique per campaign: UX rule, enforced in app)
  state                     text not null check (state in ('ENABLED', 'PAUSED', 'ARCHIVED')),
  delivery_status           text,
  delivery_reasons          text[] not null default '{}',
  default_bid               numeric(18,4) not null,     -- SPAdGroupBid.defaultBid
  currency                  char(3) not null references ref.currencies (code), -- SPAdGroupBid.currencyCode
  global_ad_group_id        text,
  tags                      jsonb not null default '[]',
  raw                       jsonb not null default '{}',
  amazon_created_at         timestamptz not null,
  amazon_last_updated_at    timestamptz not null,
  synced_at                 timestamptz not null,
  deleted_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (seller_account_id, amazon_ad_group_id),
  unique (tenant_id, id),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, campaign_id) references ads.sp_campaigns (tenant_id, id) on delete cascade
);
comment on table ads.sp_ad_groups is 'Amazon mirror. v1 SPAdGroup. Legacy "AdGroups" (SP part).';
create index sp_ad_groups_campaign_idx on ads.sp_ad_groups (seller_account_id, campaign_id, state, name) where deleted_at is null;
create index sp_ad_groups_name_trgm on ads.sp_ad_groups using gin (name gin_trgm_ops);
create index sp_ad_groups_updated_idx on ads.sp_ad_groups (seller_account_id, amazon_last_updated_at);
create trigger sp_ad_groups_touch before update on ads.sp_ad_groups for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('ads.sp_ad_groups');

-- ---------------------------------------------------------------------------
-- SP product ads — v1 SPAd (catalog/ads/definitions/AmazonAdsAPISPAdsContract.json)
-- ---------------------------------------------------------------------------
create table ads.sp_ads (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  seller_account_id         uuid not null,
  ad_group_id               uuid not null,
  campaign_id               uuid not null,
  marketplace_id            text not null references ref.marketplaces (id),
  amazon_ad_id              text not null,              -- SPAd.adId
  amazon_ad_group_id        text not null,
  amazon_campaign_id        text not null,
  ad_type                   text not null default 'PRODUCT_AD', -- SPAdType
  product_id                text not null,              -- SPAdvertisedProducts.productId
  product_id_type           text not null check (product_id_type in ('ASIN', 'SKU', 'RETAILER_OFFER')), -- SPProductIdType
  asin                      text,                       -- resolvedProductId when resolvedProductIdType = ASIN, or productId
  sku                       text,                       -- productId when productIdType = SKU (sellers); NULL for vendors (D60 seam)
  state                     text not null check (state in ('ENABLED', 'PAUSED', 'ARCHIVED')),
  delivery_status           text,
  delivery_reasons          text[] not null default '{}', -- eligibility: e.g. NOT_IN_BUYBOX, OUT_OF_STOCK
  global_ad_id              text,
  tags                      jsonb not null default '[]',
  raw                       jsonb not null default '{}',
  amazon_created_at         timestamptz not null,
  amazon_last_updated_at    timestamptz not null,
  synced_at                 timestamptz not null,
  deleted_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (seller_account_id, amazon_ad_id),
  unique (tenant_id, id),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, ad_group_id) references ads.sp_ad_groups (tenant_id, id) on delete cascade
);
comment on table ads.sp_ads is
  'Amazon mirror. v1 SPAd + SPProductCreative.productCreativeSettings.advertisedProduct. Legacy "ProductAds" (SP part); legacy ASIN status tables (StatusAsinProductAds, LogStatusAsinProductAds) are replaced by delivery_reasons here + ops.change_history.';
create index sp_ads_ad_group_idx on ads.sp_ads (seller_account_id, ad_group_id, state) where deleted_at is null;
create index sp_ads_asin_idx on ads.sp_ads (seller_account_id, marketplace_id, asin) where deleted_at is null;
create index sp_ads_sku_idx on ads.sp_ads (seller_account_id, marketplace_id, sku) where deleted_at is null;
create index sp_ads_updated_idx on ads.sp_ads (seller_account_id, amazon_last_updated_at);
create trigger sp_ads_touch before update on ads.sp_ads for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('ads.sp_ads');

-- ---------------------------------------------------------------------------
-- SP targets — v1 SPTarget (catalog/ads/definitions/AmazonAdsAPISPTargetsContract.json)
-- Keywords, product (ASIN) targets, category targets, auto (theme) targets, and negatives at ad group
-- and campaign level are all one v1 entity distinguished by targetType / targetLevel / negative.
-- ---------------------------------------------------------------------------
create table ads.sp_targets (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  seller_account_id         uuid not null,
  campaign_id               uuid not null,
  ad_group_id               uuid,                       -- NULL when target_level = CAMPAIGN
  marketplace_id            text not null references ref.marketplaces (id),
  amazon_target_id          text not null,              -- SPTarget.targetId
  amazon_campaign_id        text not null,              -- SPTarget.campaignId
  amazon_ad_group_id        text,                       -- SPTarget.adGroupId
  target_level              text not null check (target_level in ('AD_GROUP', 'CAMPAIGN')), -- SPTargetLevel
  target_type               text not null check (target_type in ('KEYWORD', 'PRODUCT', 'PRODUCT_CATEGORY', 'THEME', 'LOCATION')), -- SPTargetType
  negative                  boolean not null,           -- SPTarget.negative
  state                     text not null check (state in ('ENABLED', 'PAUSED', 'ARCHIVED')),
  delivery_status           text,
  delivery_reasons          text[] not null default '{}',
  bid                       numeric(18,4),              -- SPTargetBid.bid (NULL: inherits ad group default bid; negatives)
  bid_currency              char(3) references ref.currencies (code), -- SPTargetBid.currencyCode
  -- One of SPTargetDetails, flattened for filters / duplicate checks:
  keyword_text              text,                       -- SPKeywordTarget.keyword
  keyword_text_normalized   text generated always as (lower(btrim(keyword_text))) stored,
  native_language_keyword   text,                       -- SPKeywordTarget.nativeLanguageKeyword
  native_language_locale    text,                       -- SPKeywordTarget.nativeLanguageLocale
  match_type                text check (match_type in (
                              'BROAD', 'EXACT', 'PHRASE',                                   -- SPKeywordMatchType
                              'PRODUCT_EXACT', 'PRODUCT_SIMILAR',                           -- SPProductMatchType
                              'KEYWORDS_CLOSE_MATCH', 'KEYWORDS_LOOSE_MATCH', 'PRODUCT_COMPLEMENTS', 'PRODUCT_SUBSTITUTES',
                              'KEYWORDS_RELATED_TO_GIFTS', 'KEYWORDS_RELATED_TO_PEER_BRANDS_PRODUCT_CATEGORY',
                              'KEYWORDS_RELATED_TO_PRIME_DAY', 'KEYWORDS_RELATED_TO_YOUR_BRAND',
                              'KEYWORDS_RELATED_TO_YOUR_PRODUCT_CATEGORY')),                -- SPThemeMatchType / SPMatchType
  product_id                text,                       -- SPProductTarget.product.productId
  product_id_type           text check (product_id_type in ('ASIN', 'SKU', 'RETAILER_OFFER')),
  category_id               text,                       -- SPProductCategoryRefinement.productCategoryId
  category_refinement       jsonb,                      -- SPProductCategoryRefinement (brand, price, rating, prime, age, genre)
  location_id               text,                       -- SPLocationTarget.locationId
  target_details            jsonb not null,             -- SPTarget.targetDetails verbatim (source for full-record writes)
  global_target_id          text,
  tags                      jsonb not null default '[]',
  raw                       jsonb not null default '{}',
  amazon_created_at         timestamptz not null,
  amazon_last_updated_at    timestamptz not null,
  synced_at                 timestamptz not null,
  deleted_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (seller_account_id, amazon_target_id),
  unique (tenant_id, id),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, campaign_id) references ads.sp_campaigns (tenant_id, id) on delete cascade,
  foreign key (tenant_id, ad_group_id) references ads.sp_ad_groups (tenant_id, id) on delete cascade,
  check ((target_level = 'CAMPAIGN') = (ad_group_id is null)),
  check (target_type <> 'KEYWORD' or keyword_text is not null)
);
comment on table ads.sp_targets is
  'Amazon mirror. v1 SPTarget with SPTargetDetails oneOf (SPKeywordTarget, SPProductTarget, SPProductCategoryTarget, SPThemeTarget, SPLocationTarget). Legacy Targets, Keywords, NegativeKeywords, NegativeTargets, CampaignNegativeKeyword, CampaignNegativeProduct all land here (v1 unifies them).';
-- Targets tab / ad group targeting (ADS-03, ADS-06), campaign negatives (ADS-05), "already a keyword/negative" flag (ADS-07).
create index sp_targets_ad_group_idx on ads.sp_targets (seller_account_id, ad_group_id, negative, state) where deleted_at is null;
create index sp_targets_campaign_idx on ads.sp_targets (seller_account_id, campaign_id, target_level, negative) where deleted_at is null;
create index sp_targets_keyword_idx on ads.sp_targets (seller_account_id, amazon_ad_group_id, keyword_text_normalized, match_type)
  where target_type = 'KEYWORD' and deleted_at is null;
create index sp_targets_product_idx on ads.sp_targets (seller_account_id, product_id) where target_type = 'PRODUCT' and deleted_at is null;
create index sp_targets_keyword_trgm on ads.sp_targets using gin (keyword_text gin_trgm_ops);
create index sp_targets_updated_idx on ads.sp_targets (seller_account_id, amazon_last_updated_at);
create trigger sp_targets_touch before update on ads.sp_targets for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('ads.sp_targets');
