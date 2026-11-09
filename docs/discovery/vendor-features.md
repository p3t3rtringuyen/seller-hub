# Vendor Central feature inventory (P1-VENDOR)

Source: read-only walk of Vendor Central (CA, Direct Fulfillment vendor account) starting at Promotion Central, 2026-11-09. Structure only: no promotion names, ASINs, prices, funding, vendor codes or account names were recorded. Machine-readable twin: `catalog/vendor/vendor-features.json` (24 entries). API mapping from `catalog/spapi/**` (42 vendor operations). Clean room (D0): written from observation, no legacy code.

**Account limits that shape what was seen:** a DF vendor in Canada; `Personalized promotion` and `Points Deal` are blocked for this marketplace; there is no Invoices/Payments entry in the menu. Steps 2 and 3 of the deal wizard were not opened (advancing would create a draft on a live account).

## 1. Promotion Central

### 1.1 Manage Promotions (`/promotion-central/dashboard`)
- Region tabs: Americas, Europe, Asia Pacific, India, Middle East/North Africa. KPI tiles (past 30 days): Sales, Units sold, Funding, Glance views.
- List columns: Promotion (title, type, ASIN count) · Status (+ issue count) · Schedule (dates, event badge, store, audience) · Promotion terms · Performance (Sales, Units sold, Glance views, Conversion) · Action (Edit, caret: View, Cancel).
- Filters: search (ASIN/SKU/title/id); Status (Cancelled, Cancelling, Ended, Processing, Running, Has issues, Upcoming, Needs approval; default Running+Upcoming+Needs approval); Type (Best Deal, Fixed Price Discount, Lightning Deal, Personalized promotion, Points Deal); Store (per country); All filters adds Event, Vendor Code, Creator, Start Date, End date. Export to CSV.
- Create menu: Create Deal · Create Price Discount · Create personalized promotion · Create Points Deal.
- Amazon auto-generates "Auto Promotion" Best Deals per eligible ASIN; they show up as "Needs approval"/"Has issues". Price Discounts created after the Promotion Central announcement can only be managed here (older ones on a legacy page).

### 1.2 Promotion detail (`/promotion-central/deals/view/{id}`)
- Header: Promotion ID, Type, Event, Audience, Start/End date (15-minute grid), Amazon Store, Billing Vendor Code, Agreement, Funding source; More details: Deal ID, PSS ID. Revision selector ("View Revision": Published).
- Actions: Clone · Edit · Cancel Promotion · Download Current Products.
- Tabs: **Products** (Pricing: likely promotional price / your price / featured offer; Units: sold, committed; Discount: discount, per-unit funding, estimated total funding), **Issues** (same rows, per-product issue label, observed "Discount too low"), **Activity** (revision log: time, author System/Vendor, status Published/Superseded, promotion-level and product-level updates with "Download Product Changes").

### 1.3 Promotion types
| Type | Status here | What was read |
|---|---|---|
| Best Deal | Reachable | Multi-day deal with Deals Badge; schedule = start + end date. Seen in list/detail. |
| Lightning Deal | Reachable (wizard step 1 only) | Deals Badge for a few hours (usually 4–12, set by Amazon); only a **start date** is entered ("Runs for up to 12 hours"). No existing example in the account. |
| Price discount (Fixed Price Discount) | Reachable (wizard step 1 only) | Discounted price for a duration; start/end **date and time** (defaults 12:00 AM / 11:45 PM). |
| Personalized promotion | **Not reachable** | "Access restricted – not supported in your marketplace yet." |
| Points Deal | **Not reachable** | "Access restricted – Points Promotion is not supported in your marketplace yet." |
| Coupons | Reachable | Separate area, see §2.6. |
| Prime Exclusive | Not offered | No such type in the menu, Type filter or wizard for this account. |

### 1.4 Create wizard (`/promotion-central/deals/create/details`), title "Create a deal or price discount"
Three steps: 1 Set details · 2 Add products · 3 Set product discounts.
Step 1 fields: **Amazon Store** (select, eligible stores only) · **Billing Vendor Code** (select) · **Promotion Type** (radio, default Best Deal) · **Schedule** (varies by type, above). Validation seen: "Start date is required", "End date is required", banner "Fix highlighted issues to submit". Steps 2–3: **unreachable** (would need valid dates and create a draft); inputs inferred only: products by ASIN and per-product discount/price.

## 2. Other Vendor Central areas (top menu)
Menu: Orders · Items · Supply Chain · Advertising · Merchandising · Growth · Reports · Learn.

### 2.1 Orders → Purchase Orders
- Sub-nav: PO Dashboard · Manage POs · Recently Modified POs · Manage POs in bulk. Dashboard is mostly policy/FC announcements.
- Manage POs: tabs Unconfirmed / Confirmed / Closed / All (counts); View by PO or PO items; search by PO, ASIN or external id (500 values); order date range, ship-to; sort & filter; customize columns/export.
- Columns: PO · Vendor code · PO items · Order date · Requested quantity · Total requested cost · Ship-to location · SAN · Consolidation ID · Window start/end · Freight terms.
- Actions: Upload PO confirmation, Export PO to Excel (PO items), Customize export. Rule shown: unconfirmed PO items without an ASN are auto-cancelled at the cancellation deadline.

### 2.2 Orders → Shipments
Search PO/ASN/ARN; toggles: draft only, missing trailer ID, pending ASN submission; tabs All shipments / All appointments / All ASN defects. Columns: Shipment ID (ARN)/ASN · Creation date · Status/date · POs · Packing details · Carrier/Mode · Ship from/to · Action. Download/export data.

### 2.3 Orders → Vendor-initiated orders
Program selector with one program, **Born to Run**: vendor submits expected 10-week units; Amazon buys up to the approved amount; unsold units after 10 weeks may incur returns/retention fees.

### 2.4 Orders → Direct Fulfillment Orders
Counters (New orders, Shipped, Cancelled, Late shipments), warehouse selector, "Shipments due by", carrier tabs. Refine by: search, received-on range, Status (Unshipped, Shipped, Paid, Cancelled), Next Processing Step (Download Packing Slips, Add tracking, Print label, Confirm shipment), Warehouse, Ships by, Products in order (single/multiple), Hazmat. Bulk "Available actions". Order columns not captured (no rows).

### 2.5 Items → Catalogue
Tabs: All listings · Complete drafts · Activate listings · Enhance listings · Review listing changes. Columns: Product details (image, title, ASIN, UPC, SKU) · Vendor code/Product type/Brand · Page views (30 d) · Availability · Cost · Last updated / Recommended next step. Search up to 250 ASINs, vendor-code multi-select, favourites, sort. Row menu: Edit listing, Manage images, Update availability, Download pre-filled spreadsheet. Buttons: Add listings, Vendor code priority. Other Items entries (not opened): Improve listing quality, Add Products, Bulk product submissions, Upload Images, Manage Product Availability, Upload and Manage Videos, Product Certificates, Manage Product Compliance, Manage Catalog Feeds.

### 2.6 Merchandising → Coupons
Coupon campaign cards (created on, coupon count, name, budget type, total budget, status, warnings). Filters: name, Starts (any time … date range), Budget (All/Share/Per individual coupon), Status (All, Needs your attention, Active, Complete, Canceled, Expired). **Create a new campaign** dialog: Standard vs Reorder coupon; download spreadsheet → fill → upload; or "create one at a time" (Standard only; Reorder needs spreadsheet). Other Merchandising entries (not opened): Promotions, Amazon Vine, A+ Content Manager, Manage your experiments, Business Pricing Discounts, Shopping guides.

### 2.7 Reports → Retail Analytics
Tabs Sales · Inventory · Net PPM · Catalogue; Manage Downloads. Home tiles: Customer Returns, Open Purchase Order Quantity, Sellable/Unsellable On-Hand Units. Sales: time frame, view by (ASIN, vendor code), distributor view (Sourcing), program view (Retail), brand/category/subcategory, currency, prior period / year-over-year, CSV/Excel; columns include Shipped Revenue, Shipped COGS, Shipped Units, Customer Returns (26 selectable). Other Reports (not opened): Brand Analytics, Voice of the Customer, Product Prep and Packaging, Concession Hub.

### 2.8 Not opened / not present
Supply Chain (Supply Chain Connect, Analyze Performance), Advertising (link to Amazon Ads, not followed), Growth (Product Opportunity Explorer, Manage Your Brands), Learn. **Invoices / Payments: no menu entry for this account** (named unreachable).

## 3. API coverage table
Model files are in `catalog/spapi/definitions/`. "Console-only" = no public SP-API operation found in the catalogue.

| Feature | SP-API operation | Console-only? | Notes |
|---|---|---|---|
| Promotion list / detail / performance | none (`promotions@2025-12-01` search/get exist but audience is seller) | **Yes** | Vendor coverage of that API unverified. |
| Create / edit / clone / cancel deal, price discount, lightning deal | none | **Yes** | Write wizard; major gap for vendor promotions. |
| Personalized promotion, Points Deal | none | **Yes** | Blocked for this marketplace. |
| Coupon campaigns | none | **Yes** | Spreadsheet-driven. |
| Purchase order list/detail | `vendorOrders.getPurchaseOrders`, `getPurchaseOrder`, `getPurchaseOrdersStatus` | No | Poll by changed/created windows. |
| PO confirmation | `vendorOrders.submitAcknowledgement` | No | Console also offers upload and bulk. |
| Shipments / ASN | `vendorShipments.SubmitShipments`, `SubmitShipmentConfirmations`, `GetShipmentDetails`, `GetShipmentLabels` | No | Appointments and ASN defects: console-only. |
| Async result of submissions | `vendorTransactionStatus.getTransaction` | No | |
| Vendor-initiated orders (Born to Run) | none | **Yes** | |
| Direct fulfillment orders | `vendorDirectFulfillmentOrders.getOrders/getOrder/submitAcknowledgement` (2021-12-28) | No | RDT-restricted → D11. |
| DF labels, packing slips, confirmations, status | `vendorDirectFulfillmentShipping.*` (2021-12-28) | No | Several RDT-restricted. |
| DF inventory feed | `vendorDirectFulfillmentInventory.submitInventoryUpdate` | No | |
| DF invoices | `vendorDirectFulfillmentPayments.submitInvoice` | No | Submit only. |
| Invoices (non-DF) | `vendorInvoices.submitInvoices` | No | No UI in this account; no payment-read API. |
| Catalogue listing view | `catalogItems.searchCatalogItems/getCatalogItem` (2022-04-01) | No | Cost, vendor-code priority, availability are console data. |
| Add/edit listings, bulk submit | `listingsItems.*` (partial vendor support), Feeds API | Partly | Confirm in P3. |
| A+ content | `aplusContent.*` | No | |
| Images, videos, certificates, compliance | none | **Yes** | |
| Retail Analytics (sales, inventory, traffic, forecast, net PPM) | Reports `GET_VENDOR_*` (8 types), Data Kiosk `vendorAnalytics` | No | Reports are async. |
| Brand Analytics | Reports `GET_BRAND_ANALYTICS_*` | No | Needs Brand Analytics role. |
| Supply Chain, Growth, Vine, VoC, Concession Hub, Learn | none | **Yes** | Not opened. |
| Advertising | Amazon Ads API (not SP-API) | n/a | Separate catalogue. |
