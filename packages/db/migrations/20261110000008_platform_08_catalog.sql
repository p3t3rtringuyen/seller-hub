-- Up Migration
-- Source: db/design/08_catalog.sql (P2-DATA, frozen reference). Verbatim copy; test/migrations-match-design.test.ts keeps them identical.
-- seller-hub data model — 08 catalog (listings and ASIN enrichment, SP-API)
-- Slice: MVP (CAT-01 sync, CAT-02 Listing screen). Writes to listings (CAT-03) are v1.
-- Sources: report GET_MERCHANT_LISTINGS_ALL_DATA (catalog/spapi/reports.json; flat file, columns per
-- Amazon's report docs), listingsItems.searchListingsItems includedData=summaries,issues,offers,
-- fulfillmentAvailability (catalog/spapi/definitions/listingsItems@2021-08-01.json),
-- catalogItems.getCatalogItem (catalog/spapi/definitions/catalogItems@2022-04-01.json).

create table catalog.listings (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  seller_account_id         uuid not null,
  marketplace_id            text not null references ref.marketplaces (id),
  seller_sku                text not null,               -- Item.sku / report seller-sku
  asin                      text,                        -- ItemSummaryByMarketplace.asin / report asin1
  fn_sku                    text,                        -- ItemSummaryByMarketplace.fnSku
  item_name                 text,                        -- ItemSummaryByMarketplace.itemName / report item-name
  product_type              text,                        -- ItemSummaryByMarketplace.productType
  condition_type            text,                        -- ItemSummaryByMarketplace.conditionType (new_new, used_good, …)
  statuses                  text[] not null default '{}', -- ItemSummaryByMarketplace.status (BUYABLE, DISCOVERABLE)
  report_status             text,                        -- report status column (Active / Inactive / Incomplete)
  main_image_url            text,                        -- ItemSummaryByMarketplace.mainImage.link
  price_amount              numeric(18,4),               -- ItemOfferByMarketplace.price (offerType B2C) / report price
  price_currency            char(3) references ref.currencies (code),
  fulfillment_channel       text,                        -- FulfillmentAvailability.fulfillmentChannelCode (DEFAULT = merchant, AMAZON_NA …)
  merchant_quantity         integer,                     -- FulfillmentAvailability.quantity for merchant-fulfilled offers
  issue_error_count         integer not null default 0,  -- count of Issue.severity = ERROR (summary for grid filters)
  issue_warning_count       integer not null default 0,
  open_date                 timestamptz,                 -- report open-date
  amazon_created_at         timestamptz,                 -- ItemSummaryByMarketplace.createdDate
  amazon_last_updated_at    timestamptz,                 -- ItemSummaryByMarketplace.lastUpdatedDate
  raw                       jsonb not null default '{}',
  synced_at                 timestamptz not null,
  deleted_at                timestamptz,                 -- no longer in the full report
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (seller_account_id, marketplace_id, seller_sku),
  unique (tenant_id, id),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table catalog.listings is
  'Amazon mirror. One SKU offer per marketplace. Full sync from GET_MERCHANT_LISTINGS_ALL_DATA, status/issues/offer from searchListingsItems (Item, ItemSummaryByMarketplace, ItemOfferByMarketplace, FulfillmentAvailability). FBA quantity comes from inventory.fba_inventory; "running ads" from ads.sp_ads (CAT-02 joins).';
-- Listing screen (CAT-02): filter marketplace / status / has issues, search SKU / ASIN / title, sort by title or updated.
create index listings_list_idx on catalog.listings (seller_account_id, marketplace_id, item_name) where deleted_at is null;
create index listings_asin_idx on catalog.listings (seller_account_id, marketplace_id, asin) where deleted_at is null;
create index listings_issues_idx on catalog.listings (seller_account_id, marketplace_id) where issue_error_count > 0 and deleted_at is null;
create index listings_statuses_gin on catalog.listings using gin (statuses);
create index listings_search_trgm on catalog.listings using gin ((coalesce(item_name, '') || ' ' || seller_sku || ' ' || coalesce(asin, '')) gin_trgm_ops);
create trigger listings_touch before update on catalog.listings for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('catalog.listings');

create table catalog.listing_issues (
  id                  uuid primary key,
  tenant_id           uuid not null,
  seller_account_id   uuid not null,
  listing_id          uuid not null,
  code                text not null,                     -- Issue.code
  severity            text not null check (severity in ('ERROR', 'WARNING', 'INFO')), -- Issue.severity
  message             text not null,                     -- Issue.message
  categories          text[] not null default '{}',      -- Issue.categories
  attribute_names     text[] not null default '{}',      -- Issue.attributeNames
  enforcements        jsonb,                             -- Issue.enforcements (IssueEnforcements)
  synced_at           timestamptz not null,
  foreign key (tenant_id, listing_id) references catalog.listings (tenant_id, id) on delete cascade
);
comment on table catalog.listing_issues is
  'Amazon mirror. listingsItems Issue (catalog/spapi/definitions/listingsItems@2021-08-01.json). Replaced as a set per listing on each sync.';
create index listing_issues_listing_idx on catalog.listing_issues (listing_id, severity);
create index listing_issues_code_idx on catalog.listing_issues (seller_account_id, code);
select core.apply_tenant_rls('catalog.listing_issues');

-- ASIN enrichment (title, image, brand) fetched only for ASINs new to the seller account (CAT-01).
-- Scoped by seller account (fetched with that seller's token; no cross-tenant sharing, conventions §10).
create table catalog.catalog_items (
  id                  uuid primary key,
  tenant_id           uuid not null,
  seller_account_id   uuid not null,
  marketplace_id      text not null references ref.marketplaces (id),
  asin                text not null,                     -- Item.asin
  title               text,                              -- ItemSummaryByMarketplace.itemName
  brand               text,                              -- ItemSummaryByMarketplace.brand
  main_image_url      text,                              -- ItemImages (variant MAIN)
  product_type        text,                              -- ItemProductTypeByMarketplace.productType
  browse_node_id      text,                              -- ItemBrowseClassification.classificationId
  browse_node_name    text,
  parent_asin         text,                              -- ItemRelationships (VARIATION parent)
  raw                 jsonb not null default '{}',
  synced_at           timestamptz not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (seller_account_id, marketplace_id, asin),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table catalog.catalog_items is
  'Amazon mirror. catalogItems@2022-04-01 getCatalogItem (Item, ItemSummaryByMarketplace, ItemImages, ItemRelationships, ItemBrowseClassification). Used for ASINs without a listing row too (ads on vendor/other ASINs, product targets).';
create index catalog_items_title_trgm on catalog.catalog_items using gin (title gin_trgm_ops);
create trigger catalog_items_touch before update on catalog.catalog_items for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('catalog.catalog_items');
