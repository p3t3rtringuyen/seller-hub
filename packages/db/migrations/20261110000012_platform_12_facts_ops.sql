-- Up Migration
-- Source: db/design/12_facts_ops.sql (P2-DATA, frozen reference). Verbatim copy; test/migrations-match-design.test.ts keeps them identical.
-- seller-hub data model — 12 facts: sales, inventory, finance (SP-API)
-- Slice: MVP (ORD-01 sales overview + TACoS, INV-01 history, FIN-01 fees per SKU/month).
-- Same rules as 06_facts_ads.sql: monthly range partitions on the marketplace-local `date`, natural keys,
-- additive measures only, idempotent window reloads, no FK, kept until the seller account is deleted (D64 a).

-- ORD-01: sales.getOrderMetrics, granularity Day, granularityTimeZone = marketplace zone
-- (catalog/spapi/definitions/sales@v1.json: OrderMetricsInterval, Money). One call per scope:
-- marketplace total (scope_kind 'marketplace', scope_value ''), or per ASIN / SKU.
create table facts.sales_daily (
  tenant_id            uuid not null,
  seller_account_id    uuid not null,
  date                 date not null,                    -- OrderMetricsInterval.interval start (local day)
  marketplace_id       text not null,
  scope_kind           text not null check (scope_kind in ('marketplace', 'asin', 'sku')),
  scope_value          text not null default '',          -- ASIN or SKU; '' for the marketplace total
  fulfillment_network  text not null default 'ALL' check (fulfillment_network in ('ALL', 'AFN', 'MFN')), -- request filter
  order_count          integer not null,                 -- OrderMetricsInterval.orderCount
  order_item_count     integer not null,                 -- OrderMetricsInterval.orderItemCount
  unit_count           integer not null,                 -- OrderMetricsInterval.unitCount
  total_sales          numeric(18,4) not null,           -- OrderMetricsInterval.totalSales.amount
  currency             char(3) not null,                 -- OrderMetricsInterval.totalSales.currencyCode
  job_run_id           uuid,
  loaded_at            timestamptz not null default now(),
  primary key (tenant_id, seller_account_id, date, marketplace_id, scope_kind, scope_value, fulfillment_network)
) partition by range (date);
comment on table facts.sales_daily is
  'Fact. sales@v1 getOrderMetrics (0.5 rps). TACoS = ads cost (facts.ads_sp_*_daily) / total_sales; averageUnitPrice is derived (total_sales / unit_count), not stored.';
create index sales_daily_scope_idx on facts.sales_daily (seller_account_id, scope_kind, scope_value, date);
select core.apply_tenant_rls('facts.sales_daily');

-- INV-01 history: one snapshot per SKU per local day, taken after the inventory sync.
create table facts.inventory_fba_daily (
  tenant_id                    uuid not null,
  seller_account_id            uuid not null,
  date                         date not null,
  marketplace_id               text not null,
  seller_sku                   text not null,
  fn_sku                       text not null,
  asin                         text,
  total_quantity               integer,
  fulfillable_quantity         integer,
  inbound_quantity             integer,                  -- working + shipped + receiving
  reserved_quantity            integer,
  researching_quantity         integer,
  unfulfillable_quantity       integer,
  snapshot_at                  timestamptz not null,
  primary key (tenant_id, seller_account_id, date, marketplace_id, seller_sku, fn_sku)
) partition by range (date);
comment on table facts.inventory_fba_daily is
  'Fact. Daily copy of inventory.fba_inventory (fbaInventory@v1 InventorySummary/InventoryDetails). Basis for days-of-cover (INV-02, v1) and stock-out history.';
create index inventory_fba_daily_asin_idx on facts.inventory_fba_daily (seller_account_id, asin, date);
select core.apply_tenant_rls('facts.inventory_fba_daily');

-- FIN-01: fee / charge / refund totals per SKU, breakdown type and local posted day.
create table facts.finance_sku_daily (
  tenant_id            uuid not null,
  seller_account_id    uuid not null,
  date                 date not null,                    -- posted_date
  marketplace_id       text not null default '',          -- '' for account-level lines
  seller_sku           text not null default '',          -- '' for lines without ProductContext (account fees)
  transaction_type     text not null,                    -- Transaction.transactionType
  breakdown_type       text not null,                    -- leaf Breakdown.breakdownType
  amount               numeric(18,4) not null,           -- sum of finance.transaction_lines.amount
  currency             char(3) not null,
  line_count           integer not null,
  job_run_id           uuid,
  loaded_at            timestamptz not null default now(),
  primary key (tenant_id, seller_account_id, date, marketplace_id, seller_sku, transaction_type, breakdown_type, currency)
) partition by range (date);
comment on table facts.finance_sku_daily is
  'Fact. Aggregate of finance.transaction_lines (finances@2024-06-19 Breakdown leaves) by day x SKU x type; month totals are sums over it (FIN-01). Rebuilt for every posted_date touched by a sync.';
create index finance_sku_daily_sku_idx on facts.finance_sku_daily (seller_account_id, seller_sku, date);
select core.apply_tenant_rls('facts.finance_sku_daily');
