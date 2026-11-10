-- seller-hub data model — 09 inventory (FBA inventory mirror, SP-API)
-- Slice: MVP (INV-01; inventory columns on Listing and Ads screens).
-- Source: fbaInventory.getInventorySummaries (details=true, granularity Marketplace, startDateTime for
-- changes) — catalog/spapi/definitions/fbaInventory@v1.json: InventorySummary, InventoryDetails,
-- ReservedQuantity, ResearchingQuantity, UnfulfillableQuantity. Daily snapshots go to
-- facts.inventory_fba_daily (12_facts_ops.sql).

create table inventory.fba_inventory (
  id                                 uuid primary key,
  tenant_id                          uuid not null,
  seller_account_id                  uuid not null,
  marketplace_id                     text not null references ref.marketplaces (id), -- Granularity.granularityId (Marketplace)
  seller_sku                         text not null,      -- InventorySummary.sellerSku
  fn_sku                             text not null,      -- InventorySummary.fnSku
  asin                               text,               -- InventorySummary.asin
  condition                          text,               -- InventorySummary.condition
  product_name                       text,               -- InventorySummary.productName
  total_quantity                     integer,            -- InventorySummary.totalQuantity
  fulfillable_quantity               integer,            -- InventoryDetails.fulfillableQuantity
  inbound_working_quantity           integer,            -- InventoryDetails.inboundWorkingQuantity
  inbound_shipped_quantity           integer,            -- InventoryDetails.inboundShippedQuantity
  inbound_receiving_quantity         integer,            -- InventoryDetails.inboundReceivingQuantity
  reserved_total_quantity            integer,            -- ReservedQuantity.totalReservedQuantity
  reserved_pending_customer_order    integer,            -- ReservedQuantity.pendingCustomerOrderQuantity
  reserved_pending_transshipment     integer,            -- ReservedQuantity.pendingTransshipmentQuantity
  reserved_fc_processing             integer,            -- ReservedQuantity.fcProcessingQuantity
  researching_total_quantity         integer,            -- ResearchingQuantity.totalResearchingQuantity
  unfulfillable_total_quantity       integer,            -- UnfulfillableQuantity.totalUnfulfillableQuantity
  unfulfillable_breakdown            jsonb,              -- UnfulfillableQuantity (customer/warehouse/distributor/carrier damaged, defective, expired)
  amazon_last_updated_at             timestamptz,        -- InventorySummary.lastUpdatedTime
  raw                                jsonb not null default '{}',
  synced_at                          timestamptz not null,
  created_at                         timestamptz not null default now(),
  updated_at                         timestamptz not null default now(),
  unique (seller_account_id, marketplace_id, seller_sku, fn_sku),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table inventory.fba_inventory is
  'Amazon mirror. Current FBA inventory per SKU/FNSKU per marketplace (fbaInventory@v1 getInventorySummaries). Incremental by startDateTime with overlap (ADR-0008 decision 6). Legacy InventoryAlert (internal engine) is not kept; alerts are v1 (INV-03).';
create index fba_inventory_asin_idx on inventory.fba_inventory (seller_account_id, marketplace_id, asin);
create index fba_inventory_low_idx on inventory.fba_inventory (seller_account_id, marketplace_id, fulfillable_quantity);
create trigger fba_inventory_touch before update on inventory.fba_inventory for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('inventory.fba_inventory');
