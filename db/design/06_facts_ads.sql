-- seller-hub data model — 06 facts: Ads SP daily metrics
-- Slice: L0 (ADS-02 campaign / ad group / target / ad), MVP (ADS-07 search term; placement for ADS-05).
-- Source: Ads API v1 reports only (D57 a; AdsApiv1CreateReport / AdsApiv1RetrieveReport,
-- catalog/ads/reports.json → v1.fields). No Reporting v3 (shut off 2027-06-30).
-- Frame: ADR-0009 decision 3 — monthly range partitions on `date` = profile/marketplace-local date
-- (v1 dimension date.value is already in the profile time zone). Retention: kept until the seller account
-- is deleted (D64 a); v1 date retention upstream is 24 months (reports.json → v1.dataRetention).
--
-- Rules for every fact table here:
--  * Keys are Amazon ids (text), not our UUIDs: report rows can arrive before the mirror row exists; join
--    to ads.* on (seller_account_id, amazon_*_id).
--  * Only additive measures are stored; ratios (CTR, CPC, ACOS, ROAS, CVR, CPM, CPO, AOV) are computed
--    from sums (conventions §5) in packages/metrics.
--  * A window is re-loaded idempotently (delete+insert or ON CONFLICT per partition window; ADR-0008 decision 5),
--    so restatements converge.
--  * Columns v1 does not provide for SP are not modelled (D57 a); nullable where v1 coverage is unconfirmed.
--  * No FK (partitioned, retention by seller account); the purge job deletes by seller_account_id.
--
-- Shared measure columns (v1 field id → column):
--   metric.impressions → impressions        metric.clicks → clicks
--   metric.totalCost   → cost               metric.sales  → sales   (SP: 7-day for sellers, 14-day for vendors)
--   metric.purchases   → purchases          metric.unitsSold → units_sold
--   budgetCurrency.value / campaign.currencyCode → currency

create table facts.ads_sp_campaign_daily (
  tenant_id                        uuid not null,
  seller_account_id                uuid not null,
  date                             date not null,          -- date.value
  marketplace_id                   text not null,
  amazon_campaign_id               text not null,          -- campaign.id
  amazon_portfolio_id              text,                   -- portfolio.portfolioId
  campaign_name                    text,                   -- campaign.name (snapshot at report time)
  impressions                      bigint not null default 0,
  clicks                           bigint not null default 0,
  cost                             numeric(18,4) not null default 0,
  sales                            numeric(18,4) not null default 0,
  purchases                        bigint not null default 0,
  units_sold                       bigint not null default 0,
  top_of_search_impression_share   numeric(9,6),           -- metric.topOfSearchImpressionShare (ratio 0..1)
  impression_share                 numeric(9,6),           -- metric.impressionShare
  impression_share_rank            bigint,                 -- metric.impressionShareRank
  currency                         char(3) not null,
  job_run_id                       uuid,
  loaded_at                        timestamptz not null default now(),
  primary key (tenant_id, seller_account_id, date, amazon_campaign_id)
) partition by range (date);
comment on table facts.ads_sp_campaign_daily is
  'Fact. v1 report, adProduct SPONSORED_PRODUCTS, dimensions date.value + campaign.id (catalog/ads/reports.json v1.fields). Feeds Campaign Manager grid/KPIs/charts (ADS-03), "out of budget" chip with ads.sp_campaigns.delivery_reasons. Legacy CampaignReport/ChartReport/DimCampaign* read models land here.';
create index ads_sp_campaign_daily_entity_idx on facts.ads_sp_campaign_daily (seller_account_id, amazon_campaign_id, date);
select core.apply_tenant_rls('facts.ads_sp_campaign_daily');

create table facts.ads_sp_ad_group_daily (
  tenant_id            uuid not null,
  seller_account_id    uuid not null,
  date                 date not null,
  marketplace_id       text not null,
  amazon_campaign_id   text not null,                      -- campaign.id
  amazon_ad_group_id   text not null,                      -- adGroup.id
  impressions          bigint not null default 0,
  clicks               bigint not null default 0,
  cost                 numeric(18,4) not null default 0,
  sales                numeric(18,4) not null default 0,
  purchases            bigint not null default 0,
  units_sold           bigint not null default 0,
  currency             char(3) not null,
  job_run_id           uuid,
  loaded_at            timestamptz not null default now(),
  primary key (tenant_id, seller_account_id, date, amazon_ad_group_id)
) partition by range (date);
comment on table facts.ads_sp_ad_group_daily is 'Fact. v1 report SP, dimensions date.value + campaign.id + adGroup.id. Legacy AdGroupReport.';
create index ads_sp_ad_group_daily_entity_idx on facts.ads_sp_ad_group_daily (seller_account_id, amazon_ad_group_id, date);
create index ads_sp_ad_group_daily_campaign_idx on facts.ads_sp_ad_group_daily (seller_account_id, amazon_campaign_id, date);
select core.apply_tenant_rls('facts.ads_sp_ad_group_daily');

create table facts.ads_sp_target_daily (
  tenant_id                        uuid not null,
  seller_account_id                uuid not null,
  date                             date not null,
  marketplace_id                   text not null,
  amazon_campaign_id               text not null,
  amazon_ad_group_id               text not null,
  amazon_target_id                 text not null,          -- adGroupTarget.id
  targeting                        text,                   -- targeting.value (keyword text / ASIN expression)
  match_type                       text,                   -- targetingMatchType.value
  impressions                      bigint not null default 0,
  clicks                           bigint not null default 0,
  cost                             numeric(18,4) not null default 0,
  sales                            numeric(18,4) not null default 0,
  purchases                        bigint not null default 0,
  units_sold                       bigint not null default 0,
  top_of_search_impression_share   numeric(9,6),           -- availability at target level unconfirmed (D57)
  currency                         char(3) not null,
  job_run_id                       uuid,
  loaded_at                        timestamptz not null default now(),
  primary key (tenant_id, seller_account_id, date, amazon_target_id)
) partition by range (date);
comment on table facts.ads_sp_target_daily is
  'Fact. v1 report SP, dimensions date.value + adGroupTarget.id (+ targeting.value, targetingMatchType.value). Input of the L0 bid rule (AUT-01: ACOS over N complete days). Legacy TargetReport/KeywordReport.';
create index ads_sp_target_daily_entity_idx on facts.ads_sp_target_daily (seller_account_id, amazon_target_id, date);
create index ads_sp_target_daily_ad_group_idx on facts.ads_sp_target_daily (seller_account_id, amazon_ad_group_id, date);
select core.apply_tenant_rls('facts.ads_sp_target_daily');

create table facts.ads_sp_ad_daily (
  tenant_id            uuid not null,
  seller_account_id    uuid not null,
  date                 date not null,
  marketplace_id       text not null,
  amazon_campaign_id   text not null,
  amazon_ad_group_id   text not null,
  amazon_ad_id         text not null,                      -- ad.id
  asin                 text,                               -- advertisedProduct.id
  sku                  text,                               -- advertisedProductSku.value
  impressions          bigint not null default 0,
  clicks               bigint not null default 0,
  cost                 numeric(18,4) not null default 0,
  sales                numeric(18,4) not null default 0,
  purchases            bigint not null default 0,
  units_sold           bigint not null default 0,
  currency             char(3) not null,
  job_run_id           uuid,
  loaded_at            timestamptz not null default now(),
  primary key (tenant_id, seller_account_id, date, amazon_ad_id)
) partition by range (date);
comment on table facts.ads_sp_ad_daily is
  'Fact. v1 report SP advertised product (reports.json v1.migrationExamples sp-advertised-product): date.value, ad.id, advertisedProduct.id, advertisedProductSku.value. Also gives ad spend per ASIN/SKU for TACoS (ORD-01) and the "running ads" column (CAT-02). Legacy AdReport/ProductReport/SkuPerformance.';
create index ads_sp_ad_daily_entity_idx on facts.ads_sp_ad_daily (seller_account_id, amazon_ad_id, date);
create index ads_sp_ad_daily_asin_idx on facts.ads_sp_ad_daily (seller_account_id, marketplace_id, asin, date);
select core.apply_tenant_rls('facts.ads_sp_ad_daily');

create table facts.ads_sp_search_term_daily (
  tenant_id            uuid not null,
  seller_account_id    uuid not null,
  date                 date not null,
  marketplace_id       text not null,
  amazon_campaign_id   text not null,
  amazon_ad_group_id   text not null,
  amazon_target_id     text not null,                      -- adGroupTarget.id (the target that matched)
  search_term          text not null,                      -- searchTerm.value (customer query, not PII)
  targeting            text,                               -- targeting.value
  match_type           text,                               -- targetingMatchType.value
  impressions          bigint not null default 0,
  clicks               bigint not null default 0,
  cost                 numeric(18,4) not null default 0,
  sales                numeric(18,4),                      -- nullable: v1 search-term coverage to confirm (D57, SCOPE ADS-07)
  purchases            bigint,
  units_sold           bigint,
  currency             char(3) not null,
  job_run_id           uuid,
  loaded_at            timestamptz not null default now(),
  primary key (tenant_id, seller_account_id, date, amazon_ad_group_id, amazon_target_id, search_term)
) partition by range (date);
comment on table facts.ads_sp_search_term_daily is
  'Fact. v1 report SP with dimension searchTerm.value (v3 spSearchTerm equivalent via reports.json v1.migrationExamples). ADS-07 search-term table; "already a keyword/negative" is a join to ads.sp_targets.keyword_text_normalized. Legacy SearchTermsReport.';
create index ads_sp_search_term_daily_ad_group_idx on facts.ads_sp_search_term_daily (seller_account_id, amazon_ad_group_id, date);
create index ads_sp_search_term_daily_term_idx on facts.ads_sp_search_term_daily (seller_account_id, lower(search_term), date);
select core.apply_tenant_rls('facts.ads_sp_search_term_daily');

create table facts.ads_sp_placement_daily (
  tenant_id            uuid not null,
  seller_account_id    uuid not null,
  date                 date not null,
  marketplace_id       text not null,
  amazon_campaign_id   text not null,
  placement            text not null,                      -- placementClassification.value (Top of search, Rest of search, Product pages …)
  impressions          bigint not null default 0,
  clicks               bigint not null default 0,
  cost                 numeric(18,4) not null default 0,
  sales                numeric(18,4),
  purchases            bigint,
  units_sold           bigint,
  currency             char(3) not null,
  job_run_id           uuid,
  loaded_at            timestamptz not null default now(),
  primary key (tenant_id, seller_account_id, date, amazon_campaign_id, placement)
) partition by range (date);
comment on table facts.ads_sp_placement_daily is
  'Fact. v1 report SP with dimensions campaign.id + placementClassification.value. Shows performance next to placement bid adjustments (ADS-05). Placement value set is Amazon''s report vocabulary, stored verbatim (not the SPPlacement write enum).';
create index ads_sp_placement_daily_entity_idx on facts.ads_sp_placement_daily (seller_account_id, amazon_campaign_id, date);
select core.apply_tenant_rls('facts.ads_sp_placement_daily');
