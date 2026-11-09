# SP-API domain map

Generated for task P1-SPAPI from `catalog/spapi/**` (source: `selling-partner-api-models` @ `db2936aa19f4`, 2026-10-29; role data from Amazon's public role-mapping pages, see §Method). Counts: 73 model versions, 394 operations (352 seller, 42 vendor), 30 flagged restricted (RDT), 87 with no usage plan in the model.

Decisions applied: D2 a (SP-API + Ads API), D4 NA/US first but all regions catalogued (every model host is NA; region is client config; `regions` per operation come from Amazon's role page), **D5 Seller + Vendor** (so vendor APIs are catalogued in full in §V, not parked), D11 PII out of MVP (restricted operations are flagged, not planned).

## How to read this

- **rps / burst** = default usage plan from the operation description (`catalog/spapi/operations.json` → `rateLimit`). **Bold** = under 1 rps. `–` = the model has no usage-plan table; the real limit arrives in the `x-amzn-RateLimit-Limit` response header. Amazon may grant higher limits per seller, so the figures are floors, not caps.
- **RDT** = needs a Restricted Data Token to receive PII. Derived two ways and OR-ed: the model's own wording, and Amazon's "restricted operations" list from the Tokens API use-case guide (the models rarely mention it; for example `getOrderBuyerInfo` only appears on Amazon's list). `†` = operation flagged `deprecated` in the model.
- **Roles**: any one of the listed roles is enough. `*` = restricted role (extra Amazon vetting). `unknown` = the operation is absent from Amazon's role page (new or renamed) — not guessed. Legend at the end.
- "Superseded" is a **version-level** flag in `apis.json` (a newer version of the same API exists). It does not mean every operation moved: each domain lists operations that exist only in the old version.
- Key entities link to flattened definitions in `catalog/spapi/definitions/<api>@<version>.json`.

## Cross-cutting rules (apply to every domain)

1. **Rate limits are per (application, seller, operation) and low.** Most order, report, feed, finance and pricing endpoints are ≤ 2 rps and several are ≤ 0.02 rps (see the summary below). Design one token bucket per (seller account, operation), honour `x-amzn-RateLimit-Limit`, and back off on 429.
2. **Prefer push and bulk over poll.** Notifications (§11) for change detection, reports (§10) and Data Kiosk for history and analytics, feeds (§13) for bulk writes; synchronous calls for single-entity reads and user actions.
3. **PII (D11, out of MVP).** Orders, shipping labels, MFN/Easy Ship and some reports carry buyer data behind RDT + restricted roles. Without an RDT these calls still work and return redacted data. Anything restricted is flagged `restricted` in the catalogue so the MVP client can refuse to call it.
4. **Regions.** NA / EU / FE are separate endpoints and separate seller authorisations; a seller account can span several marketplaces inside a region. Roles vary by region for a few operations (Finances v0 AISP is EU-only, PISP EU-only).

### Slowest operations (current seller versions, < 0.1 rps)

| Operation | rps / burst |
|---|---|
| `orders@2026-01-01.searchOrders` | 0.0056/20 |
| `feeds@2021-06-30.createFeed` | 0.0083/15 |
| `sellers@v1.getAccount` | 0.016/15 |
| `sellers@v1.getMarketplaceParticipations` | 0.016/15 |
| `applicationManagement@2023-11-30.rotateApplicationClientSecret` | 0.0167/1 |
| `dataKiosk@2023-11-15.createQuery` | 0.0167/15 |
| `dataKiosk@2023-11-15.getDocument` | 0.0167/15 |
| `reports@2021-06-30.createReport` | 0.0167/15 |
| `reports@2021-06-30.getReportDocument` | 0.0167/15 |
| `transfers@2024-06-01.initiatePayout` | 0.017/2 |
| `dataKiosk@2023-11-15.cancelQuery` | 0.0222/10 |
| `dataKiosk@2023-11-15.getQueries` | 0.0222/10 |
| `feeds@2021-06-30.getFeedDocument` | 0.0222/10 |
| `feeds@2021-06-30.getFeeds` | 0.0222/10 |
| `reports@2021-06-30.cancelReport` | 0.0222/10 |
| `reports@2021-06-30.cancelReportSchedule` | 0.0222/10 |
| `reports@2021-06-30.createReportSchedule` | 0.0222/10 |
| `reports@2021-06-30.getReportSchedule` | 0.0222/10 |
| `reports@2021-06-30.getReportSchedules` | 0.0222/10 |
| `reports@2021-06-30.getReports` | 0.0222/10 |
| `productPricing@2022-05-01.getCompetitiveSummary` | 0.033/1 |
| `productPricing@2022-05-01.getFeaturedOfferExpectedPriceBatch` | 0.033/1 |

## 1. Account & marketplaces

- **APIs / versions:** `sellers@v1` (only version), `tokens@2021-03-01`, `applicationManagement@2023-11-30`, `appIntegrations@2024-04-01`. Nothing superseded. Removed by Amazon and therefore not in the catalogue: the Authorization API (`models/authorization-api-model/authorization.md` is a stub).
- **Key entities:** `MarketplaceParticipation` (`definitions/sellers@v1.json`), `Marketplace` (`definitions/sellers@v1.json`), `Participation` (`definitions/sellers@v1.json`), `Account` (`definitions/sellers@v1.json`), `Business` (`definitions/sellers@v1.json`), `CreateRestrictedDataTokenRequest` (`definitions/tokens@2021-03-01.json`)
- **Acquisition:** **Synchronous, once per connection and on a slow refresh.** `getMarketplaceParticipations` is the source of truth for which marketplaces a seller account can sell in (and whether participation is suspended); call it right after OAuth and then daily. `getAccount` (business/contact data) is rarely needed. Both run at 0.016 rps (≈ 1 call/minute), so never call them per request. `createRestrictedDataToken` (RDT, 1 rps) is the gate to every PII-bearing call — build it into the client layer even though PII is out of the MVP (D11). `rotateApplicationClientSecret` is grantless (app-level, not per seller). `appIntegrations` lets the app push notifications into Seller Central (needs the Notifications in Seller Central role) — optional.
- **Rate-limit hotspots (< 1 rps, current versions):** `sellers.getAccount` 0.016 rps; `sellers.getMarketplaceParticipations` 0.016 rps; `applicationManagement.rotateApplicationClientSecret` 0.0167 rps. 
- **Restricted (RDT) operations:** none.
- **Notes:** Marketplace IDs, country codes and the regional endpoint per marketplace are **not in the models**; they come from Amazon's "Marketplace IDs" and "SP-API endpoints" pages (NA `sellingpartnerapi-na.amazon.com`, EU `…-eu…`, FE `…-fe…`; D4: US `ATVPDKIKX0DER` first, schema covers all three regions). The `host` of every model is the NA host only; the region is a client-config concern.

**`sellers@v1`** — The Selling Partner API for Sellers

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getAccount` | GET `/sellers/v1/account` | **0.016/15** |  | AISP, FA |
| `getMarketplaceParticipations` | GET `/sellers/v1/marketplaceParticipations` | **0.016/15** |  | Amazon Fulfillment (FE only), Buyer Communication (FE only), Direct to Consumer Shipping (Restricted) (FE only), Finance and Accounting (FE only) +4 |

**`tokens@2021-03-01`** — Selling Partner API for Tokens 

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `createRestrictedDataToken` | POST `/tokens/2021-03-01/restrictedDataToken` | 1/10 |  | AF, BC, BS, DTC* +8 |

**`applicationManagement@2023-11-30`** — Selling Partner API for Application Management

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `rotateApplicationClientSecret` | POST `/applications/2023-11-30/clientSecret` | **0.0167/1** |  | None ( grantless ) |

**`appIntegrations@2024-04-01`** — The Selling Partner API for third party application integrations.

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `createNotification` | POST `/appIntegrations/2024-04-01/notifications` | 1/5 |  | NSC |
| `deleteNotifications` | POST `/appIntegrations/2024-04-01/notifications/deletion` | 1/5 |  | NSC |
| `recordActionFeedback` | POST `/appIntegrations/2024-04-01/notifications/{notificationId}/feedback` | 1/5 |  | NSC |

## 2. Catalog & listings (incl. product types, restrictions, A+ content)

- **APIs / versions:** Build on `catalogItems@2022-04-01` (2 ops; `2020-12-01` and `v0` are superseded; `v0.listCatalogCategories` has no successor), `listingsItems@2021-08-01` (`2020-09-01` superseded), `listingsRestrictions@2021-08-01`, `productTypeDefinitions@2020-09-01`, `aplusContent@2020-11-01`.
- **Key entities:** `Item` (`definitions/catalogItems@2022-04-01.json`), `ItemAttributes` (`definitions/catalogItems@2022-04-01.json`), `ItemBrowseClassifications` (`definitions/catalogItems@2022-04-01.json`), `Item` (`definitions/listingsItems@2021-08-01.json`), `ItemAttributes` (`definitions/listingsItems@2021-08-01.json`), `Issue` (`definitions/listingsItems@2021-08-01.json`), `FulfillmentAvailability` (`definitions/listingsItems@2021-08-01.json`)
- **Acquisition:** **Catalog (read-only reference data):** `searchCatalogItems`/`getCatalogItem` at 2 rps/2 burst — fine for on-demand enrichment, too slow for bulk. For full seller catalogues use **reports** (`GET_MERCHANT_LISTINGS_ALL_DATA`, `GET_MERCHANT_LISTINGS_DATA`, see section 10), then enrich only new ASINs via the API. **Listings:** `searchListingsItems` (5 rps) is the reading path for status/issues per SKU; `putListingsItem`/`patchListingsItem` is the write path (preferred over feeds for single-SKU edits; schema comes from `getDefinitionsProductType`). Large bulk edits go through the JSON listings feed (section 13). **Events:** `LISTINGS_ITEM_STATUS_CHANGE`, `LISTINGS_ITEM_ISSUES_CHANGE`, `ITEM_PRODUCT_TYPE_CHANGE`, `PRODUCT_TYPE_DEFINITIONS_CHANGE` notifications avoid polling. Product type definitions change rarely: cache by product type + marketplace, refresh on the notification. **A+ content:** 10 rps, but writes are asynchronous with an approval workflow (submit → approval → publish records); poll `searchContentPublishRecords` or accept staleness. Media upload goes through `uploads`.
- **Rate-limit hotspots (< 1 rps, current versions):** none under 1 rps in the model. The model carries no usage-plan table for: `productTypeDefinitions@2020-09-01` (2/2) — treat the limit as unknown and read `x-amzn-RateLimit-Limit` at run time.
- **Restricted (RDT) operations:** none.
- **Notes:** A+ Content docs list roles Brand Analytics or Product Listing — brand-registry accounts only. Listings/catalog bodies are attribute bags keyed by product-type schema: keep them as JSONB in storage, normalise only the identifiers (ASIN, SKU, product type, status, issues).

*Superseded:* `catalogItems@v0` → `2022-04-01` — 1 ops (0 flagged deprecated in the model). Operations with no same-named successor: `listCatalogCategories` 1/2.

*Superseded:* `catalogItems@2020-12-01` → `2022-04-01` — 2 ops (0 flagged deprecated in the model). Operations with no same-named successor: none.

**`catalogItems@2022-04-01`** — Selling Partner API for Catalog Items

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getCatalogItem` | GET `/catalog/2022-04-01/items/{asin}` | 2/2 |  | PL |
| `searchCatalogItems` | GET `/catalog/2022-04-01/items` | 2/2 |  | PL |

*Superseded:* `listingsItems@2020-09-01` → `2021-08-01` — 3 ops (0 flagged deprecated in the model). Operations with no same-named successor: none.

**`listingsItems@2021-08-01`** — Selling Partner API for Listings Items

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `deleteListingsItem` | DELETE `/listings/2021-08-01/items/{sellerId}/{sku}` | 5/5 |  | IOT, PL |
| `getListingsItem` | GET `/listings/2021-08-01/items/{sellerId}/{sku}` | 5/10 |  | IOT, PL |
| `patchListingsItem` | PATCH `/listings/2021-08-01/items/{sellerId}/{sku}` | 5/5 |  | IOT, PL |
| `putListingsItem` | PUT `/listings/2021-08-01/items/{sellerId}/{sku}` | 5/10 |  | IOT, PL |
| `searchListingsItems` | GET `/listings/2021-08-01/items/{sellerId}` | 5/5 |  | IOT, PL |

**`listingsRestrictions@2021-08-01`** — Selling Partner API for Listings Restrictions

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getListingsRestrictions` | GET `/listings/2021-08-01/restrictions` | 5/10 |  | PL |

**`productTypeDefinitions@2020-09-01`** — Selling Partner API for Product Type Definitions

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getDefinitionsProductType` | GET `/definitions/2020-09-01/productTypes/{productType}` | – |  | IOT, PL |
| `searchDefinitionsProductTypes` | GET `/definitions/2020-09-01/productTypes` | – |  | IOT, PL |

**`aplusContent@2020-11-01`** — Selling Partner API for A+ Content Management

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `createContentDocument` | POST `/aplus/2020-11-01/contentDocuments` | 10/10 |  | BA, PL |
| `createMedia` | POST `/aplus/2020-11-01/media` | 10/10 |  | unknown |
| `getContentDocument` | GET `/aplus/2020-11-01/contentDocuments/{contentReferenceKey}` | 10/10 |  | BA, PL |
| `getMedia` | GET `/aplus/2020-11-01/media/{mediaId}` | 10/10 |  | unknown |
| `listContentDocumentAsinRelations` | GET `/aplus/2020-11-01/contentDocuments/{contentReferenceKey}/asins` | 10/10 |  | BA, PL |
| `postContentDocumentApprovalSubmission` | POST `/aplus/2020-11-01/contentDocuments/{contentReferenceKey}/approvalSubmissions` | 10/10 |  | BA, PL |
| `postContentDocumentAsinRelations` | POST `/aplus/2020-11-01/contentDocuments/{contentReferenceKey}/asins` | 10/10 |  | BA, PL |
| `postContentDocumentSuspendSubmission` | POST `/aplus/2020-11-01/contentDocuments/{contentReferenceKey}/suspendSubmissions` | 10/10 |  | BA, PL |
| `searchContentDocuments` | GET `/aplus/2020-11-01/contentDocuments` | 10/10 |  | BA, PL |
| `searchContentPublishRecords` | GET `/aplus/2020-11-01/contentPublishRecords` | 10/10 |  | BA, PL |
| `updateContentDocument` | POST `/aplus/2020-11-01/contentDocuments/{contentReferenceKey}` | 10/10 |  | BA, PL |
| `updateMedia` | PATCH `/aplus/2020-11-01/media/{mediaId}` | 10/10 |  | unknown |
| `validateContentDocumentAsinRelations` | POST `/aplus/2020-11-01/contentAsinValidations` | 10/10 |  | BA, PL |

## 3. Pricing & fees

- **APIs / versions:** `productPricing@2022-05-01` (competitive summary, featured-offer expected price) supersedes `v0` by version label, but **`v0` still holds the only `getPricing`/`getCompetitivePricing`/`getListingOffers*` operations** — see the "no successor" list below; `productFees@v0` (only version); `promotions@2025-12-01`.
- **Key entities:** `FeaturedOfferExpectedPriceResult` (`definitions/productPricing@2022-05-01.json`), `FeaturedOffer` (`definitions/productPricing@2022-05-01.json`), `FeesEstimateResult` (`definitions/productFees@v0.json`), `FeesEstimate` (`definitions/productFees@v0.json`), `FeeDetail` (`definitions/productFees@v0.json`)
- **Acquisition:** **Fees:** `getMyFeesEstimates` (batch, 0.5 rps) for estimates at an assumed price; actual fees come from finances (section 9), not from here. **Pricing:** competitive/featured-offer data is rate-starved (`getCompetitiveSummary`, `getFeaturedOfferExpectedPriceBatch` at 0.033 rps ≈ 1 call per 30 s, batch up to 20) — do **not** poll it. Subscribe to `ANY_OFFER_CHANGED` / `PRICING_HEALTH` notifications for offer movement and call the API only for the listings that fired. Own prices come from listings reports/`getListingsItem`. **Promotions API** (0.1 rps) is new (2025-12): read-only search of promotions; ads-side promotion data is a different system.
- **Rate-limit hotspots (< 1 rps, current versions):** `productPricing.getCompetitiveSummary` 0.033 rps; `productPricing.getFeaturedOfferExpectedPriceBatch` 0.033 rps; `productFees.getMyFeesEstimates` 0.5 rps; `promotions.getPromotion` 0.1 rps; `promotions.getSelection` 0.1 rps; `promotions.searchPromotions` 0.1 rps. 
- **Restricted (RDT) operations:** none.

*Superseded:* `productPricing@v0` → `2022-05-01` — 6 ops (0 flagged deprecated in the model). Operations with no same-named successor: `getCompetitivePricing` 0.5/1, `getItemOffers` 0.5/1, `getItemOffersBatch` 0.1/1, `getListingOffers` 1/2, `getListingOffersBatch` 0.5/1, `getPricing` 0.5/1.

**`productPricing@2022-05-01`** — Selling Partner API for Pricing

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getCompetitiveSummary` | POST `/batches/products/pricing/2022-05-01/items/competitiveSummary` | **0.033/1** |  | PR |
| `getFeaturedOfferExpectedPriceBatch` | POST `/batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice` | **0.033/1** |  | PR |

**`productFees@v0`** — Selling Partner API for Product Fees

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getMyFeesEstimateForASIN` | POST `/products/fees/v0/items/{Asin}/feesEstimate` | 1/2 |  | AF, BC, BS, Direct to Consumer Shipping (Restricted) (EU, FE only) +8 |
| `getMyFeesEstimateForSKU` | POST `/products/fees/v0/listings/{SellerSKU}/feesEstimate` | 1/2 |  | AF, BC, BS, DTC* +8 |
| `getMyFeesEstimates` | POST `/products/fees/v0/feesEstimate` | **0.5/1** |  | PR, PL |

**`promotions@2025-12-01`** — The Selling Partner API for Promotions

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getPromotion` | GET `/promotions/2025-12-01/promotions/{promotionId}` | **0.1/2** |  | PR, PL |
| `getSelection` | GET `/promotions/2025-12-01/promotions/{promotionId}/selections/{selectionId}` | **0.1/2** |  | PR, PL |
| `searchPromotions` | GET `/promotions/2025-12-01/promotions` | **0.1/4** |  | PR, PL |

## 4. Orders

- **APIs / versions:** Build on `orders@2026-01-01` (`searchOrders`, `getOrder`). `orders@v0` is superseded; 6 of its 10 operations are flagged deprecated in the model (including `getOrders`), but `getOrderItems`, `getOrderAddress`, `getOrderBuyerInfo`, `getOrderItemsBuyerInfo`, `getOrderRegulatedInfo`, `confirmShipment`, `updateShipmentStatus`, `updateVerificationStatus` exist **only** in v0 at this commit — a client needs both until Amazon migrates them. 2026-01-01 takes an `includedData` parameter, which should remove the per-order `getOrderItems` loop (verify against the Amazon docs before relying on it).
- **Key entities:** `Order` (`definitions/orders@2026-01-01.json`), `OrderItem` (`definitions/orders@2026-01-01.json`), `Address` (`definitions/orders@v0.json`), `BuyerInfo` (`definitions/orders@v0.json`), `Buyer` (`definitions/orders@2026-01-01.json`), `CustomerAddress` (`definitions/orders@2026-01-01.json`)
- **Acquisition:** **Poll by last-updated time, not creation time** (`LastUpdatedAfter` in v0; check the `searchOrders` parameters in `operations.json`), with a 2-minute safety lag (the model requires the upper bound to be ≥ 2 min before now) and NextToken paging. The limit is brutal: `orders@2026-01-01.searchOrders` is **0.0056 rps (≈ 1 call per 3 minutes)** and v0 `getOrders` 0.0167 rps (≈ 1 per minute), burst 20, so a per-seller scheduler with a shared token bucket is mandatory. Cheaper and fresher: the `ORDER_CHANGE` notification (SQS/EventBridge) to learn *which* orders changed, then `getOrder`; and order *reports* (`GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL`, see section 10) for backfills of months of history. FBA orders are read-only. `getOrderItems` (v0, 0.5 rps) is per-order — for large backfills use reports instead of looping.
- **Rate-limit hotspots (< 1 rps, current versions):** `orders.getOrder` 0.5 rps; `orders.searchOrders` 0.0056 rps. 
- **Restricted (RDT) operations:** `orders@v0.getOrder`, `orders@v0.getOrderAddress`, `orders@v0.getOrderBuyerInfo`, `orders@v0.getOrderItems`, `orders@v0.getOrderItemsBuyerInfo`, `orders@v0.getOrderRegulatedInfo`, `orders@v0.getOrders`, `orders@2026-01-01.getOrder`.
- **Notes:** **PII / RDT (D11, out of MVP):** buyer name, e-mail, shipping address, tax info, customised-product info and regulated-order info are only returned with an RDT and a restricted role (DTC Shipping, Tax Invoicing, Tax Remittance). Without an RDT the same calls succeed but the PII fields are redacted — so MVP order sync works with the normal role set and simply has no buyer data. If D11 changes, the restricted set is the ops marked RDT below (plus reports/documents in sections 10 and 8).

*Superseded:* `orders@v0` → `2026-01-01` — 10 ops (6 flagged deprecated in the model). Operations with no same-named successor: `confirmShipment` 2/10, `getOrderAddress` (RDT) (deprecated) 0.5/30, `getOrderBuyerInfo` (RDT) (deprecated) 0.5/30, `getOrderItems` (RDT) (deprecated) 0.5/30, `getOrderItemsBuyerInfo` (RDT) (deprecated) 0.5/30, `getOrderRegulatedInfo` (RDT) 0.5/30, `getOrders` (RDT) (deprecated) 0.0167/20, `updateShipmentStatus` 5/15, `updateVerificationStatus` 0.5/30.

**`orders@2026-01-01`** — The Selling Partner API for Orders

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getOrder` | GET `/orders/2026-01-01/orders/{orderId}` | **0.5/30** | yes | AF, BC, BS, DTC* +8 |
| `searchOrders` | GET `/orders/2026-01-01/orders` | **0.0056/20** |  | AF, BC, BS, DTC* +8 |

## 5. FBA inventory

- **APIs / versions:** `fbaInventory@v1` (only version). `addInventory`, `createInventoryItem`, `deleteInventoryItem` are sandbox-only operations — exclude them from production clients.
- **Key entities:** `InventorySummary` (`definitions/fbaInventory@v1.json`), `InventoryDetails` (`definitions/fbaInventory@v1.json`), `ReservedQuantity` (`definitions/fbaInventory@v1.json`), `UnfulfillableQuantity` (`definitions/fbaInventory@v1.json`)
- **Acquisition:** **Hybrid.** `getInventorySummaries` (2 rps, paged via NextToken) is fine for a current snapshot; its parameters support a start-date filter for deltas (see `operations.json`). The `FBA_INVENTORY_AVAILABILITY_CHANGES` notification (and `ITEM_INVENTORY_EVENT_CHANGE`) gives freshness without polling. For planning data (days of supply, inbound recommendations, aged inventory, stranded, reimbursements, storage fees) there is no API: use reports `GET_FBA_MYI_ALL_INVENTORY_DATA`, `GET_FBA_INVENTORY_PLANNING_DATA`, `GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT`, `GET_STRANDED_INVENTORY_UI_DATA`, `GET_FBA_REIMBURSEMENTS_DATA`. AWD inventory is `awd.listInventory` (section 6).
- **Rate-limit hotspots (< 1 rps, current versions):** none under 1 rps in the model. The model carries no usage-plan table for: `fbaInventory@v1` (3/4) — treat the limit as unknown and read `x-amzn-RateLimit-Limit` at run time.
- **Restricted (RDT) operations:** none.

**`fbaInventory@v1`** — Selling Partner API for FBA Inventory

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `addInventory` | POST `/fba/inventory/v1/items/inventory` | – |  | AF, PL |
| `createInventoryItem` | POST `/fba/inventory/v1/items` | – |  | AF, PL |
| `deleteInventoryItem` | DELETE `/fba/inventory/v1/items/{sellerSku}` | – |  | AF, PL |
| `getInventorySummaries` | GET `/fba/inventory/v1/summaries` | 2/2 |  | AF, PL |

## 6. FBA inbound (incl. AWD)

- **APIs / versions:** Build on `fulfillmentInbound@2024-03-20` (45 ops, plan → packing → placement → transportation workflow, asynchronous with `getInboundOperationStatus`). `v0` (6 ops, the legacy shipment-plan API) is superseded. `fbaInboundEligibility@v1` is a one-call pre-check. `awd@2024-05-09` covers Amazon Warehousing & Distribution inbound/outbound/inventory and replenishment orders.
- **Key entities:** `InboundPlan` (`definitions/fulfillmentInbound@2024-03-20.json`), `InboundPlanSummary` (`definitions/fulfillmentInbound@2024-03-20.json`), `Shipment` (`definitions/fulfillmentInbound@2024-03-20.json`), `Box` (`definitions/fulfillmentInbound@2024-03-20.json`), `PlacementOption` (`definitions/fulfillmentInbound@2024-03-20.json`), `TransportationOption` (`definitions/fulfillmentInbound@2024-03-20.json`), `InboundShipment` (`definitions/awd@2024-05-09.json`), `InboundOrder` (`definitions/awd@2024-05-09.json`), `OutboundOrder` (`definitions/awd@2024-05-09.json`)
- **Acquisition:** **Synchronous but workflow-driven.** Creating inbound plans is a write workflow (many calls at 2 rps/burst 6, each asynchronous: poll `getInboundOperationStatus`). To *read* inbound state for dashboards use `listInboundPlans` + `getShipment`/`listShipmentItems` on a schedule (hourly is enough), not in the request path. Prep/compliance (`listPrepDetails`, `*ItemComplianceDetails`) are per-SKU lookups to cache. AWD: `listInventory` and `listInboundShipments` (1–2 rps) per tenant on a schedule; `replenishment` orders in AWD have no usage plan in the model.
- **Rate-limit hotspots (< 1 rps, current versions):** none under 1 rps in the model. The model carries no usage-plan table for: `fulfillmentInbound@2024-03-20` (5/45), `awd@2024-05-09` (4/21) — treat the limit as unknown and read `x-amzn-RateLimit-Limit` at run time.
- **Restricted (RDT) operations:** none.
- **Notes:** Needs the Amazon Fulfillment role (AWD: the AWD role). Shipping labels, box labels and the Delivery Challan document are binary downloads — outside the MVP read path.

*Superseded:* `fulfillmentInbound@v0` → `2024-03-20` — 6 ops (0 flagged deprecated in the model). Operations with no same-named successor: `getBillOfLading` 2/30, `getLabels` 2/30, `getPrepInstructions` 2/30, `getShipmentItems` 2/30, `getShipmentItemsByShipmentId` 2/30, `getShipments` 2/30.

**`fulfillmentInbound@2024-03-20`** — The Selling Partner API for FBA inbound operations.

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `cancelInboundPlan` | PUT `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/cancellation` | 2/2 |  | AF |
| `cancelSelfShipAppointment` | PUT `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/selfShipAppointmentCancellation` | – |  | AF |
| `confirmDeliveryWindowOptions` | POST `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/deliveryWindowOptions/{deliveryWindowOptionId}/confirmation` | 2/30 |  | AF |
| `confirmPackingOption` | POST `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/packingOptions/{packingOptionId}/confirmation` | 2/2 |  | AF |
| `confirmPlacementOption` | POST `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/placementOptions/{placementOptionId}/confirmation` | 2/2 |  | AF |
| `confirmShipmentContentUpdatePreview` | POST `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/contentUpdatePreviews/{contentUpdatePreviewId}/confirmation` | 2/30 |  | AF |
| `confirmTransportationOptions` | POST `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/transportationOptions/confirmation` | 2/2 |  | AF |
| `createInboundPlan` | POST `/inbound/fba/2024-03-20/inboundPlans` | 2/2 |  | AF |
| `createMarketplaceItemLabels` | POST `/inbound/fba/2024-03-20/items/labels` | 2/30 |  | AF |
| `generateDeliveryWindowOptions` | POST `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/deliveryWindowOptions` | 2/30 |  | AF |
| `generatePackingOptions` | POST `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/packingOptions` | 2/2 |  | AF |
| `generatePlacementOptions` | POST `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/placementOptions` | 2/2 |  | AF |
| `generateSelfShipAppointmentSlots` | POST `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/selfShipAppointmentSlots` | – |  | AF |
| `generateShipmentContentUpdatePreviews` | POST `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/contentUpdatePreviews` | 2/30 |  | AF |
| `generateTransportationOptions` | POST `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/transportationOptions` | 2/2 |  | AF |
| `getDeliveryChallanDocument` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/deliveryChallanDocument` | 2/6 |  | AF |
| `getInboundOperationStatus` | GET `/inbound/fba/2024-03-20/operations/{operationId}` | 2/6 |  | AF |
| `getInboundPlan` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}` | 2/6 |  | AF |
| `getSelfShipAppointmentSlots` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/selfShipAppointmentSlots` | – |  | AF |
| `getShipment` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}` | 2/6 |  | AF |
| `getShipmentContentUpdatePreview` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/contentUpdatePreviews/{contentUpdatePreviewId}` | 2/30 |  | AF |
| `listDeliveryWindowOptions` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/deliveryWindowOptions` | 2/30 |  | AF |
| `listInboundPlanBoxes` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/boxes` | 2/6 |  | AF |
| `listInboundPlanItems` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/items` | 2/6 |  | AF |
| `listInboundPlanPallets` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/pallets` | 2/6 |  | AF |
| `listInboundPlans` | GET `/inbound/fba/2024-03-20/inboundPlans` | 2/6 |  | AF |
| `listItemComplianceDetails` | GET `/inbound/fba/2024-03-20/items/compliance` | 2/6 |  | AF |
| `listPackingGroupBoxes` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/packingGroups/{packingGroupId}/boxes` | 2/30 |  | AF |
| `listPackingGroupItems` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/packingGroups/{packingGroupId}/items` | 2/30 |  | AF |
| `listPackingOptions` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/packingOptions` | 2/6 |  | AF |
| `listPlacementOptions` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/placementOptions` | 2/6 |  | AF |
| `listPrepDetails` | GET `/inbound/fba/2024-03-20/items/prepDetails` | – |  | AF |
| `listShipmentBoxes` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/boxes` | 2/30 |  | AF |
| `listShipmentContentUpdatePreviews` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/contentUpdatePreviews` | 2/30 |  | AF |
| `listShipmentItems` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/items` | 2/30 |  | AF |
| `listShipmentPallets` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/pallets` | 2/30 |  | AF |
| `listTransportationOptions` | GET `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/transportationOptions` | 2/6 |  | AF |
| `scheduleSelfShipAppointment` | POST `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/selfShipAppointmentSlots/{slotId}/schedule` | – |  | AF |
| `setPackingInformation` | POST `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/packingInformation` | 2/2 |  | AF |
| `setPrepDetails` | POST `/inbound/fba/2024-03-20/items/prepDetails` | 2/30 |  | AF |
| `updateInboundPlanName` | PUT `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/name` | 2/30 |  | AF |
| `updateItemComplianceDetails` | PUT `/inbound/fba/2024-03-20/items/compliance` | 2/6 |  | AF |
| `updateShipmentName` | PUT `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/name` | 2/30 |  | AF |
| `updateShipmentSourceAddress` | PUT `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/sourceAddress` | 2/30 |  | AF |
| `updateShipmentTrackingDetails` | PUT `/inbound/fba/2024-03-20/inboundPlans/{inboundPlanId}/shipments/{shipmentId}/trackingDetails` | 2/2 |  | AF |

**`fbaInboundEligibility@v1`** — Selling Partner API for FBA Inbound Eligibilty

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getItemEligibilityPreview` | GET `/fba/inbound/v1/eligibility/itemPreview` | 1/1 |  | AF |

**`awd@2024-05-09`** — The Selling Partner API for Amazon Warehousing and Distribution

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `cancelInbound` | POST `/awd/2024-05-09/inboundOrders/{orderId}/cancellation` | 1/1 |  | AWD |
| `checkInboundEligibility` | POST `/awd/2024-05-09/inboundEligibility` | 1/1 |  | AWD |
| `confirmInbound` | POST `/awd/2024-05-09/inboundOrders/{orderId}/confirmation` | 1/1 |  | AWD |
| `confirmOutbound` | POST `/awd/2024-05-09/outboundOrders/{orderId}/confirmation` | 1/1 |  | unknown |
| `confirmReplenishmentOrder` | POST `/awd/2024-05-09/replenishmentOrders/{orderId}/confirmation` | – |  | unknown |
| `createInbound` | POST `/awd/2024-05-09/inboundOrders` | 1/1 |  | AWD |
| `createOutbound` | POST `/awd/2024-05-09/outboundOrders` | 1/1 |  | unknown |
| `createReplenishmentOrder` | POST `/awd/2024-05-09/replenishmentOrders` | – |  | unknown |
| `getInbound` | GET `/awd/2024-05-09/inboundOrders/{orderId}` | 2/2 |  | AWD |
| `getInboundShipment` | GET `/awd/2024-05-09/inboundShipments/{shipmentId}` | 2/2 |  | AWD |
| `getInboundShipmentLabels` | GET `/awd/2024-05-09/inboundShipments/{shipmentId}/labels` | 1/2 |  | AWD |
| `getLabelPageTypes` | GET `/awd/2024-05-09/inboundShipments/{shipmentId}/labelPageTypes` | 1/2 |  | unknown |
| `getOutbound` | GET `/awd/2024-05-09/outboundOrders/{orderId}` | 1/1 |  | unknown |
| `getReplenishmentOrder` | GET `/awd/2024-05-09/replenishmentOrders/{orderId}` | – |  | unknown |
| `listInboundShipments` | GET `/awd/2024-05-09/inboundShipments` | 1/1 |  | AWD |
| `listInventory` | GET `/awd/2024-05-09/inventory` | 2/2 |  | AWD |
| `listOutbounds` | GET `/awd/2024-05-09/outboundOrders` | 1/1 |  | unknown |
| `listReplenishmentOrders` | GET `/awd/2024-05-09/replenishmentOrders` | – |  | unknown |
| `updateInbound` | PUT `/awd/2024-05-09/inboundOrders/{orderId}` | 1/1 |  | AWD |
| `updateInboundShipmentTransportDetails` | PUT `/awd/2024-05-09/inboundShipments/{shipmentId}/transport` | 1/1 |  | AWD |
| `updateOutbound` | PUT `/awd/2024-05-09/outboundOrders/{orderId}` | 1/1 |  | unknown |

## 7. Outbound / multi-channel fulfilment (MCF)

- **APIs / versions:** Build on `fulfillmentOutbound@2026-07-04` (9 ops). `2020-07-01` (14 ops) is superseded and still holds operations the new version dropped, listed below — check Amazon's deprecation table before relying on them. Roles for the 2026 version are not yet in Amazon's role page (`unknown`).
- **Key entities:** `FulfillmentOrder` (`definitions/fulfillmentOutbound@2026-07-04.json`), `OrderLineItem` (`definitions/fulfillmentOutbound@2026-07-04.json`), `Address` (`definitions/fulfillmentOutbound@2026-07-04.json`)
- **Acquisition:** **Synchronous writes, event-driven reads.** `createOrder`/`getOrderPreview` (2 rps) are user-triggered. Status tracking should use the `FULFILLMENT_ORDER_STATUS` notification (payload version `2026-07-04`) and `FBA_OUTBOUND_SHIPMENT_STATUS` rather than polling `listOrders`/`getOrder`. `getOffers` (5 rps) is the delivery-offer quote. MCF orders carry destination addresses (the seller customer, not an Amazon buyer) — treat as personal data in storage even though no RDT is involved.
- **Rate-limit hotspots (< 1 rps, current versions):** none under 1 rps in the model. The model carries no usage-plan table for: `fulfillmentOutbound@2026-07-04` (2/9) — treat the limit as unknown and read `x-amzn-RateLimit-Limit` at run time.
- **Restricted (RDT) operations:** none.

*Superseded:* `fulfillmentOutbound@2020-07-01` → `2026-07-04` — 14 ops (0 flagged deprecated in the model). Operations with no same-named successor: `cancelFulfillmentOrder` 2/30, `createFulfillmentOrder` 2/30, `createFulfillmentReturn` 2/30, `deliveryOffers` 5/30, `getFeatureInventory` 2/30, `getFeatureSKU` 2/30, `getFeatures` 2/30, `getFulfillmentOrder` 2/30, `getFulfillmentPreview` 2/30, `getPackageTrackingDetails` 2/30, `listAllFulfillmentOrders` 2/30, `listReturnReasonCodes` 2/30, `submitFulfillmentOrderStatusUpdate` –, `updateFulfillmentOrder` 2/30.

**`fulfillmentOutbound@2026-07-04`** — The Selling Partner API for Fulfillment Outbound

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `cancelOrder` | PUT `/fulfillment/outbound/2026-07-04/orders/{orderId}/cancel` | 2/30 |  | unknown |
| `createOrder` | POST `/fulfillment/outbound/2026-07-04/orders` | 2/30 |  | unknown |
| `getOffers` | POST `/fulfillment/outbound/2026-07-04/offers` | 5/30 |  | unknown |
| `getOrder` | GET `/fulfillment/outbound/2026-07-04/orders/{orderId}` | 2/30 |  | unknown |
| `getOrderPreview` | POST `/fulfillment/outbound/2026-07-04/previews` | 2/30 |  | unknown |
| `listOrders` | GET `/fulfillment/outbound/2026-07-04/orders` | 2/30 |  | unknown |
| `updateOrder` | PUT `/fulfillment/outbound/2026-07-04/orders/{orderId}` | 2/30 |  | unknown |
| `updateOrderStatus` | PUT `/fulfillment/outbound/2026-07-04/orders/{orderId}/status` | – |  | unknown |
| `updatePackage` | PUT `/fulfillment/outbound/2026-07-04/orders/{orderId}/packages/{packageId}` | – |  | unknown |

## 8. Merchant-fulfilled shipping, Easy Ship, tracking & external fulfilment

- **APIs / versions:** Shipping: build on `shipping@v2` (Amazon Buy Shipping; `v1` superseded). `merchantFulfillment@v0` is the older carrier-label API (still current in the model). `easyShip@2022-03-23` (Easy Ship; availability is market-specific), `tracking@2026-01-30`, `supplySources@2020-07-01` (multi-location inventory), and the four `externalFulfillment*` models (fulfilment from non-Amazon nodes — `externalFulfillmentLocation` is sandbox-only).
- **Key entities:** `Address` (`definitions/shipping@v2.json`), `Rate` (`definitions/shipping@v2.json`), `Package` (`definitions/shipping@v2.json`), `Shipment` (`definitions/merchantFulfillment@v0.json`), `ShippingService` (`definitions/merchantFulfillment@v0.json`), `AccessPoint` (`definitions/shipping@v2.json`)
- **Acquisition:** **Synchronous, user-initiated.** Rating, purchase and cancel are on-demand. `shipping@v2` has a flat **80 rps** limit across operations (the only high-throughput model) except `linkCarrierAccount` (5 rps). Tracking: use `getTracking` on demand or the `SHIPMENT_TRACKING_MILESTONE_CHANGED` notification. Label/document payloads are base64 blobs — do not store in Postgres rows. Nothing here is needed for read-only dashboards.
- **Rate-limit hotspots (< 1 rps, current versions):** none under 1 rps in the model. The model carries no usage-plan table for: `tracking@2026-01-30` (1/1), `supplySources@2020-07-01` (6/6), `externalFulfillmentInventory@2024-09-11` (1/1), `externalFulfillmentLocation@2026-07-30` (1/1), `externalFulfillmentReturns@2024-09-11` (2/2), `externalFulfillmentShipments@2024-09-11` (12/12) — treat the limit as unknown and read `x-amzn-RateLimit-Limit` at run time.
- **Restricted (RDT) operations:** `merchantFulfillment@v0.cancelShipment`, `merchantFulfillment@v0.createShipment`, `merchantFulfillment@v0.getShipment`, `shipping@v1.getShipment`, `easyShip@2022-03-23.createScheduledPackageBulk`.
- **Notes:** **RDT / PII:** `merchantFulfillment.getShipment/createShipment/cancelShipment`, `shipping@v1.getShipment`, `easyShip.createScheduledPackageBulk` are on Amazon's restricted list (they return buyer address data). Roles: mostly Direct-to-Consumer Shipping (restricted) — extra Amazon vetting.

**`merchantFulfillment@v0`** — Selling Partner API for Merchant Fulfillment

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `cancelShipment` | DELETE `/mfn/v0/shipments/{shipmentId}` | 1/1 | yes | DTC* |
| `createShipment` | POST `/mfn/v0/shipments` | 2/2 | yes | DTC* |
| `getAdditionalSellerInputs` | POST `/mfn/v0/additionalSellerInputs` | 1/1 |  | Buyer Communication (NA, FE only), DTC* |
| `getEligibleShipmentServices` | POST `/mfn/v0/eligibleShippingServices` | 6/12 |  | DTC* |
| `getShipment` | GET `/mfn/v0/shipments/{shipmentId}` | 1/1 | yes | DTC* |

*Superseded:* `shipping@v1` → `v2` — 9 ops (0 flagged deprecated in the model). Operations with no same-named successor: `createShipment` 5/15, `getAccount` 5/15, `getShipment` (RDT) 5/15, `getTrackingInformation` 1/1, `purchaseLabels` 5/15, `retrieveShippingLabel` 5/15.

**`shipping@v2`** — Amazon Shipping API

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `cancelShipment` | PUT `/shipping/v2/shipments/{shipmentId}/cancel` | 80/100 |  | Amazon Logistics, DTC* |
| `createClaim` | POST `/shipping/v2/claims` | 80/100 |  | unknown |
| `directPurchaseShipment` | POST `/shipping/v2/shipments/directPurchase` | 80/100 |  | unknown |
| `generateCollectionForm` | POST `/shipping/v2/collectionForms` | 80/100 |  | unknown |
| `getAccessPoints` | GET `/shipping/v2/accessPoints` | 80/100 |  | DTC* |
| `getAdditionalInputs` | GET `/shipping/v2/shipments/additionalInputs/schema` | 80/100 |  | Amazon Logistics, DTC* |
| `getCarrierAccountFormInputs` | GET `/shipping/v2/carrierAccountFormInputs` | 80/100 |  | unknown |
| `getCarrierAccounts` | PUT `/shipping/v2/carrierAccounts` | 80/100 |  | unknown |
| `getCollectionForm` | GET `/shipping/v2/collectionForms/{collectionFormId}` | 80/100 |  | unknown |
| `getCollectionFormHistory` | PUT `/shipping/v2/collectionForms/history` | 80/100 |  | unknown |
| `getRates` | POST `/shipping/v2/shipments/rates` | 80/100 |  | Amazon Logistics, DTC* |
| `getShipmentDocuments` | GET `/shipping/v2/shipments/{shipmentId}/documents` | 80/100 |  | Amazon Logistics, DTC* |
| `getTracking` | GET `/shipping/v2/tracking` | 80/100 |  | Amazon Logistics, DTC* |
| `getUnmanifestedShipments` | PUT `/shipping/v2/unmanifestedShipments` | 80/100 |  | unknown |
| `linkCarrierAccount` | PUT `/shipping/v2/carrierAccounts/{carrierId}` | 80/100 |  | unknown |
| `linkCarrierAccount` | POST `/shipping/v2/carrierAccounts/{carrierId}` | 5/10 |  | unknown |
| `oneClickShipment` | POST `/shipping/v2/oneClickShipment` | 80/100 |  | Amazon Logistics, DTC* |
| `purchaseShipment` | POST `/shipping/v2/shipments` | 80/100 |  | Amazon Logistics, PL |
| `submitNdrFeedback` | POST `/shipping/v2/ndrFeedback` | 80/100 |  | unknown |
| `unlinkCarrierAccount` | PUT `/shipping/v2/carrierAccounts/{carrierId}/unlink` | 80/100 |  | unknown |

**`easyShip@2022-03-23`** — Selling Partner API for Easy Ship

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `createScheduledPackage` | POST `/easyShip/2022-03-23/package` | 1/5 |  | DTC* |
| `createScheduledPackageBulk` | POST `/easyShip/2022-03-23/packages/bulk` | 1/5 | yes | DTC* |
| `getScheduledPackage` | GET `/easyShip/2022-03-23/package` | 1/5 |  | DTC* |
| `listHandoverSlots` | POST `/easyShip/2022-03-23/timeSlot` | 1/5 |  | DTC* |
| `updateScheduledPackages` | PATCH `/easyShip/2022-03-23/package` | 1/5 |  | DTC* |

**`tracking@2026-01-30`** — The Selling Partner API for tracking services provided by Amazon.

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getShipmentTracking` | GET `/tracking/2026-01-30/shipments/track` | – |  | None ( grantless ) |

**`supplySources@2020-07-01`** — Selling Partner API for Supply Sources

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `archiveSupplySource` | DELETE `/supplySources/2020-07-01/supplySources/{supplySourceId}` | – |  | SPI |
| `createSupplySource` | POST `/supplySources/2020-07-01/supplySources` | – |  | SPI |
| `getSupplySource` | GET `/supplySources/2020-07-01/supplySources/{supplySourceId}` | – |  | SPI |
| `getSupplySources` | GET `/supplySources/2020-07-01/supplySources` | – |  | SPI |
| `updateSupplySource` | PUT `/supplySources/2020-07-01/supplySources/{supplySourceId}` | – |  | SPI |
| `updateSupplySourceStatus` | PUT `/supplySources/2020-07-01/supplySources/{supplySourceId}/status` | – |  | SPI |

**`externalFulfillmentInventory@2024-09-11`** — The Selling Partner API for External Fulfillment Inventory Management

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `batchInventory` | POST `/externalFulfillment/inventory/2024-09-11/inventories` | – |  | DTC* |

**`externalFulfillmentLocation@2026-07-30`** — The Selling Partner API for Amazon External Fulfillment Location Management

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `createSandboxLocation` | POST `/externalFulfillment/2026-07-30/location` | – |  | unknown |

**`externalFulfillmentReturns@2024-09-11`** — The Selling Partner API for Amazon External Fulfillment Return Item Processing

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getReturn` | GET `/externalFulfillment/2024-09-11/returns/{returnId}` | – |  | DTC* |
| `listReturns` | GET `/externalFulfillment/2024-09-11/returns` | – |  | DTC* |

**`externalFulfillmentShipments@2024-09-11`** — The Selling Partner API for Amazon External Fulfillment Shipments Processing

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `createPackages` | POST `/externalFulfillment/2024-09-11/shipments/{shipmentId}/packages` | – |  | DTC* |
| `createSandboxShipment` | POST `/externalFulfillment/2024-09-11/shipments` | – |  | unknown |
| `generateInvoice` | POST `/externalFulfillment/2024-09-11/shipments/{shipmentId}/invoice` | – |  | DTC* |
| `generateShipLabels` | PUT `/externalFulfillment/2024-09-11/shipments/{shipmentId}/shipLabels` | – |  | DTC* |
| `getShipment` | GET `/externalFulfillment/2024-09-11/shipments/{shipmentId}` | – |  | DTC* |
| `getShipments` | GET `/externalFulfillment/2024-09-11/shipments` | – |  | DTC* |
| `processShipment` | POST `/externalFulfillment/2024-09-11/shipments/{shipmentId}` | – |  | DTC* |
| `retrieveInvoice` | GET `/externalFulfillment/2024-09-11/shipments/{shipmentId}/invoice` | – |  | DTC* |
| `retrieveShippingOptions` | GET `/externalFulfillment/2024-09-11/shipments/{shipmentId}/shippingOptions` | – |  | DTC* |
| `updatePackage` | PUT `/externalFulfillment/2024-09-11/shipments/{shipmentId}/packages/{packageId}` | – |  | DTC* |
| `updatePackageStatus` | PATCH `/externalFulfillment/2024-09-11/shipments/{shipmentId}/packages/{packageId}` | – |  | DTC* |
| `updateSandboxShipment` | PATCH `/externalFulfillment/2024-09-11/shipments/{shipmentId}` | – |  | unknown |

## 9. Finance & settlements (incl. invoicing, payouts, wallet)

- **APIs / versions:** Build on `finances@2024-06-19` (`listTransactions`, `listBalances`, `listSummary`) — `finances@v0` (event groups/events) is superseded but event-group semantics still matter for settlement reconciliation. Also `financeRemittance@2026-03-17`, `financesInvoices@2026-06-25`, `invoices@2024-06-19` (government/tax invoice documents and exports), `shipmentInvoicing@v0` and `deliveryShipmentInvoice@2022-07-01` (submit/check shipment invoices for regimes that require seller-uploaded invoices), `transfers@2024-06-01` (payout methods and payouts; `initiatePayout` is a **money movement** call — keep it out of the MVP and behind the explicit-approval rule), `sellerWallet@2024-03-01`.
- **Key entities:** `Transaction` (`definitions/finances@2024-06-19.json`), `Item` (`definitions/finances@2024-06-19.json`), `Breakdown` (`definitions/finances@2024-06-19.json`), `Balance` (`definitions/finances@2024-06-19.json`), `FinancialEvents` (`definitions/finances@v0.json`), `FinancialEventGroup` (`definitions/finances@v0.json`), `PaymentMethodDetails` (`definitions/transfers@2024-06-01.json`)
- **Acquisition:** **Hybrid, report-first for settlements.** `listTransactions` (0.5 rps, 2024-06-19) is the right incremental feed for orders-level fees/charges (filter by posted-date window and marketplace; it also joins to orders and ads charges); poll it every few hours per tenant. For official settlements and reconciliation use the **settlement reports** (`GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2`, generated by Amazon on its own schedule — fetch with `getReports` rather than requesting them) and the ledger reports (`GET_LEDGER_SUMMARY_VIEW_DATA`, `GET_LEDGER_DETAIL_VIEW_DATA`). Event: `TRANSACTION_UPDATE` and `FEE_PROMOTION` notifications. Role: Finance and Accounting.
- **Rate-limit hotspots (< 1 rps, current versions):** `finances.listBalances` 0.5 rps; `finances.listSummary` 0.5 rps; `finances.listTransactions` 0.5 rps; `transfers.getPaymentMethods` 0.5 rps; `transfers.initiatePayout` 0.017 rps; `transfers.listExpectedPayouts` 0.5 rps; `transfers.listPayouts` 0.5 rps. The model carries no usage-plan table for: `financeRemittance@2026-03-17` (2/2), `financesInvoices@2026-06-25` (2/2), `invoices@2024-06-19` (10/10), `sellerWallet@2024-03-01` (12/12) — treat the limit as unknown and read `x-amzn-RateLimit-Limit` at run time.
- **Restricted (RDT) operations:** `shipmentInvoicing@v0.getShipmentDetails`.
- **Notes:** Payout/wallet operations need AISP/PISP roles in the EU and are regulated; treat as out of the first release.

*Superseded:* `finances@v0` → `2024-06-19` — 4 ops (0 flagged deprecated in the model). Operations with no same-named successor: `listFinancialEventGroups` 0.5/30, `listFinancialEvents` 0.5/30, `listFinancialEventsByGroupId` 0.5/30, `listFinancialEventsByOrderId` 0.5/30.

**`finances@2024-06-19`** — The Selling Partner API for Finances

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `listBalances` | GET `/finances/2024-06-19/balances` | **0.5/10** |  | FA |
| `listSummary` | GET `/finances/2024-06-19/summary` | **0.5/10** |  | FA |
| `listTransactions` | GET `/finances/2024-06-19/transactions` | **0.5/10** |  | FA |

**`financeRemittance@2026-03-17`** — The Selling Partner API for Finance Remittance

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getRemittance` | GET `/finances/remittances/2026-03-17/remittances/{uniquePaymentId}` | – |  | FA |
| `getRemittanceHeaders` | GET `/finances/remittances/2026-03-17/remittances` | – |  | FA |

**`financesInvoices@2026-06-25`** — The Selling Partner API for Invoices

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getInvoice` | GET `/finances/invoices/2026-06-25/invoices/{invoiceIdentifier}` | – |  | unknown |
| `getInvoiceHeaders` | GET `/finances/invoices/2026-06-25/invoices` | – |  | unknown |

**`invoices@2024-06-19`** — The Selling Partner API for Invoices.

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `createGovernmentInvoice` | POST `/tax/invoices/2024-06-19/governmentInvoiceRequests` | – |  | unknown |
| `createInvoicesExport` | POST `/tax/invoices/2024-06-19/exports` | – |  | TI* |
| `getGovernmentInvoiceDocument` | GET `/tax/invoices/2024-06-19/governmentInvoiceRequests/{shipmentId}` | – |  | unknown |
| `getGovernmentInvoiceStatus` | GET `/tax/invoices/2024-06-19/governmentInvoiceRequests` | – |  | unknown |
| `getInvoice` | GET `/tax/invoices/2024-06-19/invoices/{invoiceId}` | – |  | TI* |
| `getInvoices` | GET `/tax/invoices/2024-06-19/invoices` | – |  | TI* |
| `getInvoicesAttributes` | GET `/tax/invoices/2024-06-19/attributes` | – |  | TI* |
| `getInvoicesDocument` | GET `/tax/invoices/2024-06-19/documents/{invoicesDocumentId}` | – |  | TI* |
| `getInvoicesExport` | GET `/tax/invoices/2024-06-19/exports/{exportId}` | – |  | TI* |
| `getInvoicesExports` | GET `/tax/invoices/2024-06-19/exports` | – |  | TI* |

**`shipmentInvoicing@v0`** — Selling Partner API for Shipment Invoicing

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getInvoiceStatus` | GET `/fba/outbound/brazil/v0/shipments/{shipmentId}/invoice/status` | 1.133/25 |  | TI* |
| `getShipmentDetails` | GET `/fba/outbound/brazil/v0/shipments/{shipmentId}` | 1.133/25 | yes | TI* |
| `submitInvoice` | POST `/fba/outbound/brazil/v0/shipments/{shipmentId}/invoice` | 1.133/25 |  | TI* |

**`deliveryShipmentInvoice@2022-07-01`** — Selling Partner API for Delivery Shipment Invoicing

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getInvoiceStatus` | GET `/delivery/2022-07-01/invoice/status` | 1.133/25 |  | unknown |
| `submitInvoice` | POST `/delivery/2022-07-01/invoice` | 1.133/25 |  | unknown |

**`transfers@2024-06-01`** — The Selling Partner API for Transfers.

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getPaymentMethods` | GET `/finances/transfers/2024-06-01/paymentMethods` | **0.5/30** |  | AISP, FA, PISP |
| `initiatePayout` | POST `/finances/transfers/2024-06-01/payouts` | **0.017/2** |  | FA, PISP |
| `listExpectedPayouts` | GET `/finances/transfers/2024-06-01/payouts/expected` | **0.5/10** |  | FA |
| `listPayouts` | GET `/finances/transfers/2024-06-01/payouts` | **0.5/10** |  | FA |

**`sellerWallet@2024-03-01`** — The Selling Partner API for Amazon Seller Wallet Open Banking API

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `createTransaction` | POST `/finances/transfers/wallet/2024-03-01/transactions` | – |  | AISP, PISP |
| `createTransferSchedule` | POST `/finances/transfers/wallet/2024-03-01/transferSchedules` | – |  | AISP, PISP |
| `deleteScheduleTransaction` | DELETE `/finances/transfers/wallet/2024-03-01/transferSchedules/{transferScheduleId}` | – |  | AISP, PISP |
| `getAccount` | GET `/finances/transfers/wallet/2024-03-01/accounts/{accountId}` | – |  | AISP |
| `getTransaction` | GET `/finances/transfers/wallet/2024-03-01/transactions/{transactionId}` | – |  | AISP |
| `getTransferPreview` | GET `/finances/transfers/wallet/2024-03-01/transferPreview` | – |  | AISP |
| `getTransferSchedule` | GET `/finances/transfers/wallet/2024-03-01/transferSchedules/{transferScheduleId}` | – |  | AISP |
| `listAccountBalances` | GET `/finances/transfers/wallet/2024-03-01/accounts/{accountId}/balance` | – |  | AISP |
| `listAccountTransactions` | GET `/finances/transfers/wallet/2024-03-01/transactions` | – |  | AISP |
| `listAccounts` | GET `/finances/transfers/wallet/2024-03-01/accounts` | – |  | AISP |
| `listTransferSchedules` | GET `/finances/transfers/wallet/2024-03-01/transferSchedules` | – |  | AISP |
| `updateTransferSchedule` | PUT `/finances/transfers/wallet/2024-03-01/transferSchedules` | – |  | AISP, PISP |

## 10. Reports & Data Kiosk

- **APIs / versions:** `reports@2021-06-30` (the 2020-09-04 version is removed: stub only), `dataKiosk@2023-11-15` with four GraphQL schemas (`economics@2024-03-15`, `salesAndTraffic@2024-04-24`, `sellerAnalytics@2025-03-31`, `vendorAnalytics@2024-09-30`).
- **Key entities:** `Report` (`definitions/reports@2021-06-30.json`), `ReportDocument` (`definitions/reports@2021-06-30.json`), `ReportSchedule` (`definitions/reports@2021-06-30.json`), `Query` (`definitions/dataKiosk@2023-11-15.json`)
- **Acquisition:** **The default for anything bulk or historic.** Flow: `createReport` (0.0167 rps ≈ 1/min) → poll `getReport` (2 rps) or receive `REPORT_PROCESSING_FINISHED` → `getReportDocument` (0.0167 rps, returns a pre-signed URL, gzip) → download. Schedule recurring pulls with `createReportSchedule` instead of re-requesting. Reports have per-type refresh cadence and window limits (see the Amazon report-type docs; not in the models). **Data Kiosk** (GraphQL: `createQuery` 0.0167 rps, then `getDocument`) is Amazon's replacement for the Sales & Traffic and brand-analytics reports and has the *Economics* schema (fees/profitability per ASIN/SKU) — prefer it for analytics because queries are narrower than flat-file reports; notification `DATA_KIOSK_QUERY_PROCESSING_FINISHED`. Report catalogue and schemas: `catalog/spapi/reports.json` (22 schema files, 19 distinct report types) and roles for 125 report types in `catalog/spapi/roles.json`.
- **Rate-limit hotspots (< 1 rps, current versions):** `reports.cancelReport` 0.0222 rps; `reports.cancelReportSchedule` 0.0222 rps; `reports.createReport` 0.0167 rps; `reports.createReportSchedule` 0.0222 rps; `reports.getReportDocument` 0.0167 rps; `reports.getReportSchedule` 0.0222 rps; `reports.getReportSchedules` 0.0222 rps; `reports.getReports` 0.0222 rps; `dataKiosk.cancelQuery` 0.0222 rps; `dataKiosk.createQuery` 0.0167 rps; `dataKiosk.getDocument` 0.0167 rps; `dataKiosk.getQueries` 0.0222 rps. 
- **Restricted (RDT) operations:** `reports@2021-06-30.getReportDocument`.
- **Notes:** **Restricted:** `reports.getReportDocument` is on Amazon's RDT list because some report types contain PII (order reports with shipping/tax/invoicing data, `GET_EASYSHIP_DOCUMENTS`, `GET_GST_MTR_*`, VAT invoice reports, `GET_FLAT_FILE_ACTIONABLE_ORDER_DATA_SHIPPING`). Non-PII reports work with a normal token. Brand Analytics reports need the Brand Analytics role and brand registry.

**`reports@2021-06-30`** — Selling Partner API for Reports

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `cancelReport` | DELETE `/reports/2021-06-30/reports/{reportId}` | **0.0222/10** |  | AF, BC, BS, DTC* +8 |
| `cancelReportSchedule` | DELETE `/reports/2021-06-30/schedules/{reportScheduleId}` | **0.0222/10** |  | AF, BC, BS, DTC* +8 |
| `createReport` | POST `/reports/2021-06-30/reports` | **0.0167/15** |  | AF, BC, BS, DTC* +8 |
| `createReportSchedule` | POST `/reports/2021-06-30/schedules` | **0.0222/10** |  | AF, BC, BS, DTC* +8 |
| `getReport` | GET `/reports/2021-06-30/reports/{reportId}` | 2/15 |  | AF, BC, BS, DTC* +8 |
| `getReportDocument` | GET `/reports/2021-06-30/documents/{reportDocumentId}` | **0.0167/15** | yes | AF, BC, BS, DTC* +8 |
| `getReportSchedule` | GET `/reports/2021-06-30/schedules/{reportScheduleId}` | **0.0222/10** |  | AF, BC, BS, DTC* +8 |
| `getReportSchedules` | GET `/reports/2021-06-30/schedules` | **0.0222/10** |  | AF, BC, BS, DTC* +8 |
| `getReports` | GET `/reports/2021-06-30/reports` | **0.0222/10** |  | AF, BC, BS, DTC* +8 |

**`dataKiosk@2023-11-15`** — Selling Partner API for Data Kiosk

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `cancelQuery` | DELETE `/dataKiosk/2023-11-15/queries/{queryId}` | **0.0222/10** |  | BA |
| `createQuery` | POST `/dataKiosk/2023-11-15/queries` | **0.0167/15** |  | BA |
| `getDocument` | GET `/dataKiosk/2023-11-15/documents/{documentId}` | **0.0167/15** |  | BA |
| `getQueries` | GET `/dataKiosk/2023-11-15/queries` | **0.0222/10** |  | BA |
| `getQuery` | GET `/dataKiosk/2023-11-15/queries/{queryId}` | 2/15 |  | BA |

## 11. Notifications

- **APIs / versions:** `notifications@v1` (only version). 26 payload schema files in `schemas/notifications/` (27 type names incl. B2B and listings v2 payload `2023-12-13`).
- **Key entities:** `Destination` (`definitions/notifications@v1.json`), `Subscription` (`definitions/notifications@v1.json`), `EventFilter` (`definitions/notifications@v1.json`), `AggregationSettings` (`definitions/notifications@v1.json`)
- **Acquisition:** **Push, via a destination the seller/app owns** (SQS or EventBridge; the destination lives in an AWS account the app controls). Two subscription modes: `createSubscription` per seller using their grant, or the **grantless** application-level subscription for some types (`createDestination`/`createSubscription` at 1 rps). Order-change, listing, inventory, fulfilment-status, report/feed/Data Kiosk completion and pricing events can replace most polling; keep a reconciling poll because delivery is at-least-once and unordered.
- **Rate-limit hotspots (< 1 rps, current versions):** none under 1 rps in the model. 
- **Restricted (RDT) operations:** none.

**`notifications@v1`** — Selling Partner API for Notifications

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `createDestination` | POST `/notifications/v1/destinations` | 1/5 |  | None ( grantless ) |
| `createSubscription` | POST `/notifications/v1/subscriptions/{notificationType}` | 1/5 |  | The role that is associated with the notification type |
| `deleteDestination` | DELETE `/notifications/v1/destinations/{destinationId}` | 1/5 |  | None ( grantless ) |
| `deleteSubscriptionById` | DELETE `/notifications/v1/subscriptions/{notificationType}/{subscriptionId}` | 1/5 |  | None ( grantless ) |
| `getDestination` | GET `/notifications/v1/destinations/{destinationId}` | 1/5 |  | None ( grantless ) |
| `getDestinations` | GET `/notifications/v1/destinations` | 1/5 |  | None ( grantless ) |
| `getSubscription` | GET `/notifications/v1/subscriptions/{notificationType}` | 1/5 |  | The role that is associated with the notification type |
| `getSubscriptionById` | GET `/notifications/v1/subscriptions/{notificationType}/{subscriptionId}` | 1/5 |  | None ( grantless ) |
| `getSubscriptions` | GET `/notifications/v1/subscriptions` | 1/5 |  | unknown |
| `sendTestNotification` | POST `/notifications/v1/subscriptions/{notificationType}/testNotification` | 1/5 |  | unknown |

## 12. Buyer messaging, solicitations & customer feedback

- **APIs / versions:** Messaging was split: `messaging@2026-04-20` (4 automation-configuration ops, role: Buyer Communication) vs `messaging@v1` (11 ops: per-order buyer messages such as confirm order/delivery details, legal disclosure, invoice; superseded by label only — **none of its operations has a same-named successor**). `solicitations@v1` (request review / feedback, one call per order, 1 rps), `customerFeedback@2024-06-01` (review topics/trends by item or browse node; Brand Analytics / Selling Partner Insights roles).
- **Key entities:** `AutomationConfiguration` (`definitions/messaging@2026-04-20.json`), `GetSolicitationActionsForOrderResponse` (`definitions/solicitations@v1.json`), `ItemReviewTopic` (`definitions/customerFeedback@2024-06-01.json`)
- **Acquisition:** **Synchronous, per order, user- or rule-triggered; no bulk path.** Messaging and solicitation both run at 1 rps and Amazon enforces eligibility windows (a solicitation is allowed only within an eligibility window and once per order) — check `getSolicitationActionsForOrder`/`getMessagingActionsForOrder` first. Customer-feedback endpoints have **no usage plan in the model** and are analytics (use Data Kiosk where possible). Messaging/solicitation operations are not on the Amazon RDT list and their roles (Buyer Communication, Buyer Solicitation) are not marked restricted on the Amazon role page.
- **Rate-limit hotspots (< 1 rps, current versions):** none under 1 rps in the model. The model carries no usage-plan table for: `messaging@2026-04-20` (4/4), `customerFeedback@2024-06-01` (7/7) — treat the limit as unknown and read `x-amzn-RateLimit-Limit` at run time.
- **Restricted (RDT) operations:** none.

*Superseded:* `messaging@v1` → `2026-04-20` — 11 ops (0 flagged deprecated in the model). Operations with no same-named successor: `CreateWarranty` 1/5, `GetAttributes` 1/5, `confirmCustomizationDetails` 1/5, `createConfirmDeliveryDetails` 1/5, `createConfirmOrderDetails` 1/5, `createConfirmServiceDetails` 1/5, `createDigitalAccessKey` 1/5, `createLegalDisclosure` 1/5, `createUnexpectedProblem` 1/5, `getMessagingActionsForOrder` 1/5, `sendInvoice` –.

**`messaging@2026-04-20`** — The Selling Partner API for Messaging Automations

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `createAutomationConfiguration` | POST `/messaging/2026-04-20/automationConfigurations` | – |  | BC |
| `getAutomationConfiguration` | GET `/messaging/2026-04-20/automationConfigurations/{automationId}` | – |  | BC |
| `listAutomationConfigurations` | GET `/messaging/2026-04-20/automationConfigurations` | – |  | BC |
| `updateAutomationConfiguration` | PUT `/messaging/2026-04-20/automationConfigurations/{automationId}` | – |  | BC |

**`solicitations@v1`** — Selling Partner API for Solicitations

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `createProductReviewAndSellerFeedbackSolicitation` | POST `/solicitations/v1/orders/{amazonOrderId}/solicitations/productReviewAndSellerFeedback` | 1/5 |  | BS, PL |
| `getSolicitationActionsForOrder` | GET `/solicitations/v1/orders/{amazonOrderId}` | 1/5 |  | BS, PL |

**`customerFeedback@2024-06-01`** — The Selling Partner API for CustomerFeedback

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getBrowseNodeReturnTopics` | GET `/customerFeedback/2024-06-01/browseNodes/{browseNodeId}/returns/topics` | – |  | BA, SPI |
| `getBrowseNodeReturnTrends` | GET `/customerFeedback/2024-06-01/browseNodes/{browseNodeId}/returns/trends` | – |  | BA, SPI |
| `getBrowseNodeReviewTopics` | GET `/customerFeedback/2024-06-01/browseNodes/{browseNodeId}/reviews/topics` | – |  | BA, SPI |
| `getBrowseNodeReviewTrends` | GET `/customerFeedback/2024-06-01/browseNodes/{browseNodeId}/reviews/trends` | – |  | BA, SPI |
| `getItemBrowseNode` | GET `/customerFeedback/2024-06-01/items/{asin}/browseNode` | – |  | BA, SPI |
| `getItemReviewTopics` | GET `/customerFeedback/2024-06-01/items/{asin}/reviews/topics` | – |  | BA, SPI |
| `getItemReviewTrends` | GET `/customerFeedback/2024-06-01/items/{asin}/reviews/trends` | – |  | BA, SPI |

## 13. Feeds & uploads

- **APIs / versions:** `feeds@2021-06-30` (2020-09-04 removed), `uploads@2020-11-01` (pre-signed upload destinations for A+ media etc.). Feed schemas: `schemas/feeds/` (JSON listings feed v2 + processing report).
- **Key entities:** `Feed` (`definitions/feeds@2021-06-30.json`), `FeedDocument` (`definitions/feeds@2021-06-30.json`), `CreateFeedSpecification` (`definitions/feeds@2021-06-30.json`), `UploadDestination` (`definitions/uploads@2020-11-01.json`)
- **Acquisition:** **Write path for bulk changes**: `createFeedDocument` (0.5 rps) → upload to the pre-signed URL → `createFeed` (**0.0083 rps ≈ 1 every 2 min**) → completion via `FEED_PROCESSING_FINISHED` or `getFeed` → `getFeedDocument` for the processing report. One feed can carry thousands of SKU messages, so batch. Feeds are the only path for some flat-file operations (inventory loader, price/quantity, order acknowledgement/fulfilment `POST_ORDER_FULFILLMENT_DATA`, which is DTC/restricted).
- **Rate-limit hotspots (< 1 rps, current versions):** `feeds.createFeed` 0.0083 rps; `feeds.createFeedDocument` 0.5 rps; `feeds.getFeedDocument` 0.0222 rps; `feeds.getFeeds` 0.0222 rps. 
- **Restricted (RDT) operations:** none.
- **Notes:** Roles depend on the feed type (28 types mapped in `catalog/spapi/roles.json`); the same createFeed op accepts many roles.

**`feeds@2021-06-30`** — Selling Partner API for Feeds

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `cancelFeed` | DELETE `/feeds/2021-06-30/feeds/{feedId}` | 2/15 |  | AF, BA, DTC*, IOT +4 |
| `createFeed` | POST `/feeds/2021-06-30/feeds` | **0.0083/15** |  | AF, BA, DTC*, IOT +4 |
| `createFeedDocument` | POST `/feeds/2021-06-30/documents` | **0.5/15** |  | AF, BA, DTC*, IOT +4 |
| `getFeed` | GET `/feeds/2021-06-30/feeds/{feedId}` | 2/15 |  | AF, BA, DTC*, IOT +5 |
| `getFeedDocument` | GET `/feeds/2021-06-30/documents/{feedDocumentId}` | **0.0222/10** |  | AF, BA, DTC*, IOT +4 |
| `getFeeds` | GET `/feeds/2021-06-30/feeds` | **0.0222/10** |  | AF, BA, DTC*, IOT +5 |

**`uploads@2020-11-01`** — Selling Partner API for Uploads

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `createUploadDestinationForResource` | POST `/uploads/2020-11-01/uploadDestinations/{resource}` | 10/10 |  | PL |

## 14. Replenishment, sales metrics, services, support & the rest

- **APIs / versions:** All single-version: `replenishment@2022-11-07` (Subscribe & Save offers/metrics), `sales@v1` (`getOrderMetrics` — aggregated sales by interval), `actionItems@2026-06-01` and `actionPlans@2026-06-01` (new, Selling Partner Insights role, no usage plans in the model), `services@v1` (Amazon Home Services jobs — a vertical most sellers don't use), `support@2025-02-01` (support cases, 0.1 rps, restricted role), `vehicles@2024-11-01` (automotive fitment lookup).
- **Key entities:** `EligibilityStatus` (`definitions/replenishment@2022-11-07.json`), `OrderMetricsInterval` (`definitions/sales@v1.json`), `ServiceJob` (`definitions/services@v1.json`), `Case` (`definitions/support@2025-02-01.json`)
- **Acquisition:** `getOrderMetrics` (0.5 rps) is a cheap way to get daily/weekly sales totals per marketplace/ASIN/SKU without ingesting orders — suitable for a dashboard MVP (aggregated; not a substitute for order-level data). Replenishment metrics are daily-grain snapshots: poll daily. `services`, `support`, `vehicles`: defer.
- **Rate-limit hotspots (< 1 rps, current versions):** `sales.getOrderMetrics` 0.5 rps; `support.getCase` 0.1 rps; `support.listCases` 0.1 rps; `support.listContacts` 0.1 rps. The model carries no usage-plan table for: `actionItems@2026-06-01` (3/3), `actionPlans@2026-06-01` (3/3), `vehicles@2024-11-01` (1/1) — treat the limit as unknown and read `x-amzn-RateLimit-Limit` at run time.
- **Restricted (RDT) operations:** none.
- **Notes:** `services@v1` Professional Services role and `support@2025-02-01` Selling Partner Support role are both restricted (PII).

**`replenishment@2022-11-07`** — Selling Partner API for Replenishment

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getSellingPartnerMetrics` | POST `/replenishment/2022-11-07/sellingPartners/metrics/search` | 1/1 |  | BA, IOT |
| `listOfferMetrics` | POST `/replenishment/2022-11-07/offers/metrics/search` | 1/1 |  | BA, IOT |
| `listOffers` | POST `/replenishment/2022-11-07/offers/search` | 1/1 |  | BA, IOT |

**`sales@v1`** — Selling Partner API for Sales

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getOrderMetrics` | GET `/sales/v1/orderMetrics` | **0.5/15** |  | Amazon Fulfillment (FE only), Buyer Communication (FE only), Buyer Solicitation (FE only), Direct to Consumer Shipping (Restricted) (FE only) +8 |

**`actionItems@2026-06-01`** — The Selling Partner API for Action Items

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `dismissActionItem` | POST `/actionItems/2026-06-01/items/{actionItemId}/dismissals` | – |  | SPI |
| `getActionItem` | GET `/actionItems/2026-06-01/items/{actionItemId}` | – |  | SPI |
| `listActionItems` | GET `/actionItems/2026-06-01/items` | – |  | SPI |

**`actionPlans@2026-06-01`** — The Selling Partner API for Action Plans

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `createActionPlan` | POST `/actionPlans/2026-06-01/plans` | – |  | SPI |
| `getActionPlan` | GET `/actionPlans/2026-06-01/plans/{actionPlanId}` | – |  | SPI |
| `listActionPlans` | GET `/actionPlans/2026-06-01/plans` | – |  | SPI |

**`services@v1`** — Selling Partner API for Services

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `addAppointmentForServiceJobByServiceJobId` | POST `/service/v1/serviceJobs/{serviceJobId}/appointments` | 5/20 |  | PS* |
| `assignAppointmentResources` | PUT `/service/v1/serviceJobs/{serviceJobId}/appointments/{appointmentId}/resources` | 1/2 |  | PS* |
| `cancelReservation` | DELETE `/service/v1/reservation/{reservationId}` | 5/20 |  | PS* |
| `cancelServiceJobByServiceJobId` | PUT `/service/v1/serviceJobs/{serviceJobId}/cancellations` | 5/20 |  | PS* |
| `completeServiceJobByServiceJobId` | PUT `/service/v1/serviceJobs/{serviceJobId}/completions` | 5/20 |  | PS* |
| `createReservation` | POST `/service/v1/reservation` | 5/20 |  | PS* |
| `createServiceDocumentUploadDestination` | POST `/service/v1/documents` | 5/20 |  | PS* |
| `getAppointmentSlots` | GET `/service/v1/appointmentSlots` | 20/40 |  | PS* |
| `getAppointmmentSlotsByJobId` | GET `/service/v1/serviceJobs/{serviceJobId}/appointmentSlots` | 5/20 |  | PS* |
| `getFixedSlotCapacity` | POST `/service/v1/serviceResources/{resourceId}/capacity/fixed` | 5/20 |  | PS* |
| `getRangeSlotCapacity` | POST `/service/v1/serviceResources/{resourceId}/capacity/range` | 5/20 |  | PS* |
| `getServiceJobByServiceJobId` | GET `/service/v1/serviceJobs/{serviceJobId}` | 20/40 |  | PS* |
| `getServiceJobs` | GET `/service/v1/serviceJobs` | 10/40 |  | PS* |
| `rescheduleAppointmentForServiceJobByServiceJobId` | POST `/service/v1/serviceJobs/{serviceJobId}/appointments/{appointmentId}` | 5/20 |  | PS* |
| `setAppointmentFulfillmentData` | PUT `/service/v1/serviceJobs/{serviceJobId}/appointments/{appointmentId}/fulfillment` | 5/20 |  | PS* |
| `updateReservation` | PUT `/service/v1/reservation/{reservationId}` | 5/20 |  | PS* |
| `updateSchedule` | PUT `/service/v1/serviceResources/{resourceId}/schedules` | 5/20 |  | PS* |

**`support@2025-02-01`** — The Selling Partner API for Support

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getCase` | GET `/support/2025-02-01/cases/{caseId}` | **0.1/10** |  | SPS* |
| `listCases` | POST `/support/2025-02-01/cases` | **0.1/10** |  | SPS* |
| `listContacts` | GET `/support/2025-02-01/cases/{caseId}/contacts` | **0.1/10** |  | SPS* |

**`vehicles@2024-11-01`** — The Selling Partner API for Automotive.

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getVehicles` | GET `/catalog/2024-11-01/automotive/vehicles` | – |  | unknown |

## V. Vendor APIs (in scope under D5 — Seller + Vendor; sequencing is a P1-SCOPE decision)

Vendor Central uses a different business model: Amazon buys from the vendor (purchase orders, ASN shipments, invoices, payments) and the "direct fulfilment" (DF) APIs cover vendors who ship to the consumer. Available roles for vendors: Amazon Fulfillment, AWD, Brand Analytics, Direct-to-Consumer Shipping (restricted), Product Listing, Finance and Accounting. Vendor APIs are mostly **polling by `createdAfter/changedAfter` windows with pagination**; vendor reports (§10: `GET_VENDOR_SALES_REPORT`, `GET_VENDOR_INVENTORY_REPORT`, `GET_VENDOR_TRAFFIC_REPORT`, `GET_VENDOR_FORECASTING_REPORT`, real-time sales/inventory/traffic, net pure product margin) and Data Kiosk `vendorAnalytics` carry the analytics. Seller-side APIs that also work for vendors: catalog, listings (partly), feeds, reports, notifications, FBA/AWD inbound (AF/AWD roles), A+ content, Data Kiosk.

- **Rate-limit hotspots (< 1 rps):** none under 1 rps in the model. The model carries no usage-plan table for: `vendorDirectFulfillmentSandboxData@2021-10-28` (2/2) — treat the limit as unknown and read `x-amzn-RateLimit-Limit` at run time.
- **Restricted (RDT) operations:** `vendorDirectFulfillmentOrders@v1.getOrder`, `vendorDirectFulfillmentOrders@v1.getOrders`, `vendorDirectFulfillmentOrders@2021-12-28.getOrder`, `vendorDirectFulfillmentOrders@2021-12-28.getOrders`, `vendorDirectFulfillmentShipping@v1.getCustomerInvoice`, `vendorDirectFulfillmentShipping@v1.getCustomerInvoices`, `vendorDirectFulfillmentShipping@v1.getPackingSlip`, `vendorDirectFulfillmentShipping@v1.getPackingSlips`, `vendorDirectFulfillmentShipping@v1.getShippingLabel`, `vendorDirectFulfillmentShipping@v1.getShippingLabels`, `vendorDirectFulfillmentShipping@2021-12-28.getCustomerInvoice`, `vendorDirectFulfillmentShipping@2021-12-28.getCustomerInvoices`, `vendorDirectFulfillmentShipping@2021-12-28.getPackingSlip`, `vendorDirectFulfillmentShipping@2021-12-28.getPackingSlips`, `vendorDirectFulfillmentShipping@2021-12-28.getShippingLabel`.

Version note: the V1 direct-fulfilment APIs are superseded by `2021-12-28` versions for orders, shipping and transactions; `vendorDirectFulfillmentInventory`, `…Payments`, `vendorOrders`, `vendorShipments`, `vendorInvoices`, `vendorTransactionStatus` exist only as V1 (current) and `…SandboxData` only as 2021-10-28.

**`vendorDirectFulfillmentInventory@v1`** — Selling Partner API for Direct Fulfillment Inventory Updates

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `submitInventoryUpdate` | POST `/vendor/directFulfillment/inventory/v1/warehouses/{warehouseId}/items` | 10/10 |  | DTC* |

*Superseded:* `vendorDirectFulfillmentOrders@v1` → `2021-12-28` — 3 ops (0 flagged deprecated in the model). Operations with no same-named successor: none.

**`vendorDirectFulfillmentOrders@2021-12-28`** — Selling Partner API for Direct Fulfillment Orders

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getOrder` | GET `/vendor/directFulfillment/orders/2021-12-28/purchaseOrders/{purchaseOrderNumber}` | 10/10 | yes | DTC* |
| `getOrders` | GET `/vendor/directFulfillment/orders/2021-12-28/purchaseOrders` | 10/10 | yes | DTC* |
| `submitAcknowledgement` | POST `/vendor/directFulfillment/orders/2021-12-28/acknowledgements` | 10/10 |  | DTC* |

**`vendorDirectFulfillmentPayments@v1`** — Selling Partner API for Direct Fulfillment Payments

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `submitInvoice` | POST `/vendor/directFulfillment/payments/v1/invoices` | 10/10 |  | DTC* |

**`vendorDirectFulfillmentSandboxData@2021-10-28`** — Selling Partner API for Vendor Direct Fulfillment Sandbox Test Data

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `generateOrderScenarios` | POST `/vendor/directFulfillment/sandbox/2021-10-28/orders` | – |  | DTC* |
| `getOrderScenarios` | GET `/vendor/directFulfillment/sandbox/2021-10-28/transactions/{transactionId}` | – |  | DTC* |

*Superseded:* `vendorDirectFulfillmentShipping@v1` → `2021-12-28` — 9 ops (0 flagged deprecated in the model). Operations with no same-named successor: none.

**`vendorDirectFulfillmentShipping@2021-12-28`** — Selling Partner API for Direct Fulfillment Shipping

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `createContainerLabel` | POST `/vendor/directFulfillment/shipping/2021-12-28/containerLabel` | 10/10 |  | DTC* |
| `createShippingLabels` | POST `/vendor/directFulfillment/shipping/2021-12-28/shippingLabels/{purchaseOrderNumber}` | 10/10 |  | DTC* |
| `getCustomerInvoice` | GET `/vendor/directFulfillment/shipping/2021-12-28/customerInvoices/{purchaseOrderNumber}` | 10/10 | yes | DTC* |
| `getCustomerInvoices` | GET `/vendor/directFulfillment/shipping/2021-12-28/customerInvoices` | 10/10 | yes | DTC* |
| `getPackingSlip` | GET `/vendor/directFulfillment/shipping/2021-12-28/packingSlips/{purchaseOrderNumber}` | 10/10 | yes | DTC* |
| `getPackingSlips` | GET `/vendor/directFulfillment/shipping/2021-12-28/packingSlips` | 10/10 | yes | DTC* |
| `getShippingLabel` | GET `/vendor/directFulfillment/shipping/2021-12-28/shippingLabels/{purchaseOrderNumber}` | 10/10 | yes | DTC* |
| `getShippingLabels` | GET `/vendor/directFulfillment/shipping/2021-12-28/shippingLabels` | 10/10 |  | DTC* |
| `submitShipmentConfirmations` | POST `/vendor/directFulfillment/shipping/2021-12-28/shipmentConfirmations` | 10/10 |  | AF, DTC* |
| `submitShipmentStatusUpdates` | POST `/vendor/directFulfillment/shipping/2021-12-28/shipmentStatusUpdates` | 10/10 |  | DTC* |
| `submitShippingLabelRequest` | POST `/vendor/directFulfillment/shipping/2021-12-28/shippingLabels` | 10/10 |  | DTC* |

*Superseded:* `vendorDirectFulfillmentTransactions@v1` → `2021-12-28` — 1 ops (0 flagged deprecated in the model). Operations with no same-named successor: none.

**`vendorDirectFulfillmentTransactions@2021-12-28`** — Selling Partner API for Direct Fulfillment Transaction Status

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getTransactionStatus` | GET `/vendor/directFulfillment/transactions/2021-12-28/transactions/{transactionId}` | 10/10 |  | DTC* |

**`vendorInvoices@v1`** — Selling Partner API for Retail Procurement Payments

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `submitInvoices` | POST `/vendor/payments/v1/invoices` | 10/10 |  | AF, IOT |

**`vendorOrders@v1`** — Selling Partner API for Retail Procurement Orders

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getPurchaseOrder` | GET `/vendor/orders/v1/purchaseOrders/{purchaseOrderNumber}` | 10/10 |  | AF, IOT |
| `getPurchaseOrders` | GET `/vendor/orders/v1/purchaseOrders` | 10/10 |  | AF, IOT |
| `getPurchaseOrdersStatus` | GET `/vendor/orders/v1/purchaseOrdersStatus` | 10/10 |  | AF, IOT |
| `submitAcknowledgement` | POST `/vendor/orders/v1/acknowledgements` | 10/10 |  | AF, IOT |

**`vendorShipments@v1`** — Selling Partner API for Retail Procurement Shipments

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `GetShipmentDetails` | GET `/vendor/shipping/v1/shipments` | 10/10 |  | AF |
| `GetShipmentLabels` | GET `/vendor/shipping/v1/transportLabels` | 10/10 |  | AF |
| `SubmitShipmentConfirmations` | POST `/vendor/shipping/v1/shipmentConfirmations` | 10/10 |  | AF, Inventory and Order Tracking (NA, FE only) |
| `SubmitShipments` | POST `/vendor/shipping/v1/shipments` | 10/10 |  | AF |

**`vendorTransactionStatus@v1`** — Selling Partner API for Retail Procurement Transaction Status

| Operation | Call | rps / burst | RDT | Roles |
|---|---|---|---|---|
| `getTransaction` | GET `/vendor/transactions/v1/transactions/{transactionId}` | 10/20 |  | AF, Inventory and Order Tracking (NA, EU only) |

## Reports, notifications and Data Kiosk catalogues (referenced above)

- **Report types** with a published JSON schema: `END_USER_DATA_REPORT`, `MARKETPLACE_ASIN_PAGE_VIEW_METRICS`, `GET_PROMOTION_PERFORMANCE_REPORT`, `GET_COUPON_PERFORMANCE_REPORT`, `GET_SALES_AND_TRAFFIC_REPORT`, `GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT`, `GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT`, `GET_BRAND_ANALYTICS_REPEAT_PURCHASE_REPORT`, `GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT`, `GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT`, `GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT`, `GET_COUPON_PERFORMANCE_REPORT`, `GET_VENDOR_FORECASTING_REPORT`, `GET_VENDOR_INVENTORY_REPORT`, `GET_VENDOR_NET_PURE_PRODUCT_MARGIN_REPORT`, `GET_VENDOR_REAL_TIME_INVENTORY_REPORT`, `GET_VENDOR_REAL_TIME_SALES_REPORT`, `GET_VENDOR_REAL_TIME_TRAFFIC_REPORT`, `GET_VENDOR_SALES_REPORT`, `GET_VENDOR_TRAFFIC_REPORT`; three more schema files (account health, two B2B opportunity reports) carry no report-type string in the schema. The full list of report types and the roles for each (125) is in `catalog/spapi/roles.json` under `types.report`; the report-types list itself is not defined in the models.
- **Notification types** (28 from Amazon's role page; 26 payload schema files): `ACCOUNT_STATUS_CHANGED`, `ANY_OFFER_CHANGED`, `B2B_ANY_OFFER_CHANGED`, `BOPIS_CHECKIN_DETAILS`, `BRANDED_ITEM_CONTENT_CHANGE`, `DATA_KIOSK_QUERY_PROCESSING_FINISHED`, `DETAIL_PAGE_TRAFFIC_EVENT`, `FBA_INVENTORY_AVAILABILITY_CHANGES`, `FBA_OUTBOUND_SHIPMENT_STATUS`, `FEED_PROCESSING_FINISHED`, `FEE_PROMOTION`, `FULFILLMENT_ORDER_STATUS`, `ITEM_INVENTORY_EVENT_CHANGE`, `ITEM_PRODUCT_TYPE_CHANGE`, `ITEM_SALES_EVENT_CHANGE`, `LISTINGS_ITEM_ISSUES_CHANGE`, `LISTINGS_ITEM_MFN_QUANTITY_CHANGE`, `LISTINGS_ITEM_STATUS_CHANGE`, `ORDER_CHANGE`, `ORDER_STATUS_CHANGE`, `PRICING_HEALTH`, `PRODUCT_TYPE_DEFINITIONS_CHANGE`, `REPORT_PROCESSING_FINISHED`, `SHIPMENT_TRACKING_MILESTONE_CHANGED`, `SHIPPING_CHARGE_NOTIFICATION`, `TAX_INVOICE_EXPORT_STATUS_CHANGE`, `TAX_INVOICE_ISSUANCE_ELIGIBILITY_STATUS_CHANGE`, `TAX_INVOICE_ISSUANCE_STATUS`. Payload schemas → `catalog/spapi/notifications.json`.
- **Data Kiosk schemas**: `analytics_economics_2024_03_15.graphql`, `analytics_salesAndTraffic_2024_04_24.graphql`, `analytics_sellerAnalytics_2025_03_31.graphql`, `analytics_vendorAnalytics_2024_09_30.graphql` (GraphQL; `catalog/spapi/data-kiosk.json`).
- **Feed types** mapped to roles: 28 (`types.feed`); JSON/XML feed schemas: 3 files in `catalog/spapi/feeds.json`.

## Role legend

| Code | Role (as named on Amazon's page) |
|---|---|
| AF | Amazon Fulfillment |
| AISP | Account Information Service Provider |
| AWD | Amazon Warehousing and Distribution |
| Amazon Fulfillment (FE only) | Amazon Fulfillment (FE only) |
| Amazon Logistics | Amazon Logistics |
| BA | Brand Analytics |
| BC | Buyer Communication |
| BS | Buyer Solicitation |
| Buyer Communication (FE only) | Buyer Communication (FE only) |
| Buyer Communication (NA, FE only) | Buyer Communication (NA, FE only) |
| Buyer Solicitation (FE only) | Buyer Solicitation (FE only) |
| DTC* | Direct to Consumer Shipping (Restricted) |
| Direct to Consumer Shipping (Restricted) (EU, FE only) | Direct to Consumer Shipping (Restricted) (EU, FE only) |
| Direct to Consumer Shipping (Restricted) (FE only) | Direct to Consumer Shipping (Restricted) (FE only) |
| FA | Finance and Accounting |
| Finance and Accounting (FE only) | Finance and Accounting (FE only) |
| IOT | Inventory and Order Tracking |
| Inventory and Order Tracking (FE only) | Inventory and Order Tracking (FE only) |
| Inventory and Order Tracking (NA, EU only) | Inventory and Order Tracking (NA, EU only) |
| Inventory and Order Tracking (NA, FE only) | Inventory and Order Tracking (NA, FE only) |
| NSC | Notifications in Seller Central |
| None ( grantless ) | None ( grantless ) |
| PISP | Payment Initiation Service Provider (EU only) |
| PL | Product Listing |
| PR | Pricing |
| PS* | Professional Services (Restricted) |
| Pricing (FE only) | Pricing (FE only) |
| Professional Services (Restricted) (FE only) | Professional Services (Restricted) (FE only) |
| SPI | Selling Partner Insights |
| SPS* | Selling Partner Support (Restricted) |
| Selling Partner Insights (FE only) | Selling Partner Insights (FE only) |
| TI* | Tax Invoicing (Restricted) |
| TR* | Tax Remittance (Restricted) |
| Tax Invoicing (Restricted) (FE only) | Tax Invoicing (Restricted) (FE only) |
| Tax Remittance (Restricted) (FE only) | Tax Remittance (Restricted) (FE only) |
| The role that is associated with the notification type | The role that is associated with the notification type |

## Method and limits

- Builder: `node tools/catalog/spapi.mjs` (offline, deterministic). Roles are refreshed with `--roles-html <role-mappings.html> --types-html <role-mappings-for-types.html>` (pages saved from `https://developer-docs.amazon.com/sp-api/docs/role-mappings` and `…/role-mappings-for-types`, fetched 2026-11-09); the parsed result is committed as `catalog/spapi/roles.json`.
- RDT list transcribed by hand from Amazon's Tokens API use-case guide (the script holds it in `RDT_OPS`). It names operations of "Orders API" without version; it is applied to every version that has the same operationId. `orders@2026-01-01.searchOrders` is not on Amazon's list yet but returns the same PII fields behind RDT — treat as restricted when D11 is decided.
- 2 role-page entries have no matching model operation (`Messaging API v1 CreateAmazonMotors`, `Shipping API v2 submitFeedback`): Amazon page typos/renames, ignored.
- 46 operations have `roles: null` (absent from the role page) — they stay `unknown`.
- Skipped model files: `models/authorization-api-model/authorization.md` (API removed by Amazon (stub .md only)); `models/fba-small-and-light-api-model/fbaSmallandLight.md` (API removed by Amazon (stub .md only)); `models/feeds-api-model/feeds_2020-09-04.md` (API removed by Amazon (stub .md only)); `models/reports-api-model/reports_2020-09-04.md` (API removed by Amazon (stub .md only)).
