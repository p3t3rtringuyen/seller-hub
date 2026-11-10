-- seller-hub data model — 11 finance (financial transactions, SP-API)
-- Slice: MVP (FIN-01: transactions by posted date; transactions screen + fee totals per SKU/month).
-- Sources: finances@2024-06-19 listTransactions (catalog/spapi/definitions/finances@2024-06-19.json:
-- Transaction, Item, Breakdown, RelatedIdentifier, Context, Currency, SellingPartnerMetadata);
-- finances@v0 listFinancialEventGroups (catalog/spapi/definitions/finances@v0.json: FinancialEventGroup).
-- Read-only: seller-hub never moves money (SCOPE FIN-04 note).

create table finance.transactions (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  seller_account_id         uuid not null,
  marketplace_id            text references ref.marketplaces (id), -- MarketplaceDetails.marketplaceId (may be absent: account-level)
  amazon_transaction_id     text not null,               -- Transaction.transactionId
  transaction_type          text not null,               -- Transaction.transactionType (Shipment, Refund, ServiceFee, ProductAdsPayment …)
  transaction_status        text,                        -- Transaction.transactionStatus (DEFERRED, RELEASED …)
  description               text,                        -- Transaction.description
  posted_at                 timestamptz not null,        -- Transaction.postedDate
  posted_date               date not null,               -- marketplace-local date of posted_at (account zone when no marketplace)
  total_amount              numeric(18,4) not null,      -- Transaction.totalAmount.currencyAmount
  currency                  char(3) not null references ref.currencies (code), -- Transaction.totalAmount.currencyCode
  amazon_order_id           text,                        -- RelatedIdentifier ORDER_ID
  settlement_id             text,                        -- RelatedIdentifier SETTLEMENT_ID
  financial_event_group_id  text,                        -- RelatedIdentifier FINANCIAL_EVENT_GROUP_ID
  related_identifiers       jsonb not null default '[]', -- Transaction.relatedIdentifiers verbatim
  breakdowns                jsonb not null default '[]', -- Transaction.breakdowns tree verbatim
  contexts                  jsonb not null default '[]', -- Transaction.contexts
  raw                       jsonb not null default '{}',
  synced_at                 timestamptz not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (seller_account_id, amazon_transaction_id),
  unique (tenant_id, id),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table finance.transactions is
  'Amazon mirror. finances@2024-06-19 Transaction, polled by postedAfter with overlap; DEFERRED → RELEASED updates the same transactionId. Kept until the seller account is deleted (business record).';
-- Transactions screen (FIN-01): date range on posted_date, filter type/status/marketplace, search order id; sort posted_at desc.
create index transactions_list_idx on finance.transactions (seller_account_id, posted_at desc);
create index transactions_type_idx on finance.transactions (seller_account_id, transaction_type, posted_date);
create index transactions_order_idx on finance.transactions (seller_account_id, amazon_order_id) where amazon_order_id is not null;
create index transactions_group_idx on finance.transactions (seller_account_id, financial_event_group_id) where financial_event_group_id is not null;
create trigger transactions_touch before update on finance.transactions for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('finance.transactions');

-- Flattened leaf amounts (per transaction, per item when present) for fee totals by SKU/type/month.
create table finance.transaction_lines (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  seller_account_id         uuid not null,
  transaction_id            uuid not null,
  item_index                integer,                     -- position in Transaction.items; NULL = transaction-level breakdown
  breakdown_path            text not null,               -- breakdownType path from root, e.g. 'Expenses/AmazonFees/FBAFulfillmentFee'
  breakdown_type            text not null,               -- leaf Breakdown.breakdownType
  amount                    numeric(18,4) not null,      -- leaf Breakdown.breakdownAmount.currencyAmount
  currency                  char(3) not null references ref.currencies (code),
  asin                      text,                        -- ProductContext.asin
  seller_sku                text,                        -- ProductContext.sku
  quantity                  integer,                     -- ProductContext.quantityShipped
  fulfillment_network       text,                        -- ProductContext.fulfillmentNetwork (AFN / MFN)
  posted_date               date not null,               -- copied from the transaction for date filters
  unique nulls not distinct (transaction_id, item_index, breakdown_path),
  foreign key (tenant_id, transaction_id) references finance.transactions (tenant_id, id) on delete cascade
);
comment on table finance.transaction_lines is
  'Derived from finances@2024-06-19 Item.breakdowns / Transaction.breakdowns (leaf Breakdown nodes) and Item.contexts (ProductContext). Rebuilt with its transaction. Source of facts.finance_sku_daily.';
create index transaction_lines_sku_idx on finance.transaction_lines (seller_account_id, seller_sku, posted_date);
create index transaction_lines_type_idx on finance.transaction_lines (seller_account_id, breakdown_type, posted_date);
select core.apply_tenant_rls('finance.transaction_lines');

create table finance.financial_event_groups (
  id                          uuid primary key,
  tenant_id                   uuid not null,
  seller_account_id           uuid not null,
  amazon_group_id             text not null,             -- FinancialEventGroup.FinancialEventGroupId
  processing_status           text,                      -- ProcessingStatus (Open / Closed)
  fund_transfer_status        text,                      -- FundTransferStatus
  group_start_at              timestamptz,               -- FinancialEventGroupStart
  group_end_at                timestamptz,               -- FinancialEventGroupEnd
  fund_transfer_at            timestamptz,               -- FundTransferDate
  original_total_amount       numeric(18,4),             -- OriginalTotal
  original_total_currency     char(3) references ref.currencies (code),
  converted_total_amount      numeric(18,4),             -- ConvertedTotal
  converted_total_currency    char(3) references ref.currencies (code),
  beginning_balance_amount    numeric(18,4),             -- BeginningBalance
  beginning_balance_currency  char(3) references ref.currencies (code),
  trace_id                    text,                      -- TraceId (Amazon's transfer trace id)
  raw                         jsonb not null default '{}', -- AccountTail removed before storing
  synced_at                   timestamptz not null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (seller_account_id, amazon_group_id),
  foreign key (tenant_id, seller_account_id) references core.seller_accounts (tenant_id, id) on delete cascade
);
comment on table finance.financial_event_groups is
  'Amazon mirror. finances@v0 listFinancialEventGroups (settlement groups). AccountTail (bank account digits) is not stored. Reconciliation/payouts are v1 (FIN-04).';
create index financial_event_groups_list_idx on finance.financial_event_groups (seller_account_id, group_start_at desc);
create trigger feg_touch before update on finance.financial_event_groups for each row execute function core.touch_updated_at();
select core.apply_tenant_rls('finance.financial_event_groups');
