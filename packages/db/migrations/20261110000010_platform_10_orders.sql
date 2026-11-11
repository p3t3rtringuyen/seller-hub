-- Up Migration
-- Source: db/design/10_orders.sql (P2-DATA, frozen reference). Verbatim copy; packages/testing/test/platform-db.test.ts keeps them identical.
-- seller-hub data model — 10 orders (orders WITHOUT PII, SP-API)
-- Slice: MVP (ORD-02 sync + list + detail). ORD-01 order metrics are facts (12_facts_ops.sql).
-- D11 = no PII: buyer name/e-mail/phone, delivery address lines, city, postal code, buyer PO number
-- and gift messages are never stored, logged or kept in `raw` (the ingest mapper drops them first).
-- Ship country / state-or-region are kept as coarse geography for sales views.
-- Sources: report GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL (backfill, catalog/spapi/reports.json),
-- orders@2026-01-01 searchOrders / getOrder (catalog/spapi/definitions/orders@2026-01-01.json: Order,
-- OrderItem, OrderFulfillment, SalesChannel, ItemProduct, ItemPrice, ItemProceeds, OrderProceeds).
-- Status vocabulary: FulfillmentStatus of orders@2026-01-01; report values (Pending, Shipped, …) are
-- normalised to it by the mapper.

create table orders.orders (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  seller_account_id         uuid not null,
  marketplace_id            text not null references ref.marketplaces (id), -- SalesChannel.marketplaceId
  amazon_order_id           text not null,               -- Order.orderId
  purchased_at              timestamptz not null,        -- Order.createdTime (report purchase-date)
  purchase_date             date not null,               -- marketplace-local date of purchased_at (conventions §6)
  amazon_last_updated_at    timestamptz not null,        -- Order.lastUpdatedTime (incremental cursor)
  fulfillment_status        text not null check (fulfillment_status in
                              ('PENDING', 'PENDING_AVAILABILITY', 'UNSHIPPED', 'PARTIALLY_SHIPPED', 'SHIPPED',
                               'CANCELLED', 'UNFULFILLABLE')), -- OrderFulfillment.fulfillmentStatus
  fulfilled_by              text,                        -- OrderFulfillment.fulfilledBy (AMAZON / MERCHANT) → FBA vs MFN
  fulfillment_service_level text,                        -- OrderFulfillment.fulfillmentServiceLevel
  sales_channel             text not null,               -- SalesChannel.channelName (Amazon.com, Non-Amazon …)
  programs                  text[] not null default '{}', -- Order.programs (e.g. PRIME, AMAZON_BUSINESS)
  is_business_order         boolean,                     -- report is-business-order / programs
  item_count                integer,                     -- sum of OrderItem.quantityOrdered
  order_total_amount        numeric(18,4),               -- OrderProceeds.grandTotal / sum of report item-price
  currency                  char(3) references ref.currencies (code),
  ship_country_code         char(2),                     -- coarse geography only (D11)
  ship_state_or_region      text,                        -- coarse geography only (D11)
  latest_ship_at            timestamptz,                 -- OrderFulfillment.shipByWindow.endTime
  latest_delivery_at        timestamptz,                 -- OrderFulfillment.deliverByWindow.endTime
  source                    text not null check (source in ('report', 'api')), -- last writer (API wins when newer)
  raw                       jsonb not null default '{}', -- PII-stripped payload
  synced_at                 timestamptz not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (seller_account_id, amazon_order_id),
  unique (tenant_id, id),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table orders.orders is
  'Amazon mirror without PII (D11). orders@2026-01-01 Order + report GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL. Retention: until the seller account is deleted (fact-like business record). Restricted fields belong to future pii.* tables (README §PII).';
-- Order list (ORD-02): filter marketplace / status / channel, date range, default sort purchased_at desc.
create index orders_list_idx on orders.orders (seller_account_id, marketplace_id, purchased_at desc);
create index orders_status_idx on orders.orders (seller_account_id, fulfillment_status, purchased_at desc);
create index orders_purchase_date_idx on orders.orders (seller_account_id, purchase_date);
create index orders_updated_idx on orders.orders (seller_account_id, amazon_last_updated_at);
create trigger orders_touch before update on orders.orders for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('orders.orders');

create table orders.order_items (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  seller_account_id         uuid not null,
  order_id                  uuid not null,
  amazon_order_item_id      text not null,               -- OrderItem.orderItemId (report: synthesized from order id + sku when absent)
  asin                      text,                        -- ItemProduct.asin
  seller_sku                text,                        -- ItemProduct.sellerSku
  title                     text,                        -- ItemProduct.title
  condition_type            text,                        -- ItemCondition.conditionType
  quantity_ordered          integer not null,            -- OrderItem.quantityOrdered
  quantity_shipped          integer,                     -- ItemFulfillment.quantityFulfilled
  unit_price_amount         numeric(18,4),               -- ItemPrice.unitPrice
  item_price_amount         numeric(18,4),               -- report item-price (line total)
  item_tax_amount           numeric(18,4),               -- report item-tax / ItemTax
  shipping_price_amount     numeric(18,4),               -- report shipping-price
  promotion_discount_amount numeric(18,4),               -- report item-promotion-discount / ItemPromotion
  proceeds_amount           numeric(18,4),               -- ItemProceeds.proceedsTotal
  currency                  char(3) references ref.currencies (code),
  item_status               text,                        -- report item-status
  raw                       jsonb not null default '{}',
  synced_at                 timestamptz not null,
  unique (order_id, amazon_order_item_id),
  foreign key (tenant_id, order_id) references orders.orders (tenant_id, id) on delete cascade
);
comment on table orders.order_items is
  'Amazon mirror without PII. orders@2026-01-01 OrderItem / ItemProduct / ItemPrice / ItemProceeds; report line columns. Order detail screen (ORD-02).';
create index order_items_sku_idx on orders.order_items (seller_account_id, seller_sku);
create index order_items_asin_idx on orders.order_items (seller_account_id, asin);
select core.apply_tenant_rls('orders.order_items');
