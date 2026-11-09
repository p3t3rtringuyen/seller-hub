# P1-VENDOR report

**Result: DONE (with named gaps).** Read-only walk of Vendor Central in the user's Chrome (CA Direct Fulfillment vendor account), 2026-11-09.

## Files
- `catalog/vendor/vendor-features.json` — 24 entries, parses, all required keys present.
- `docs/discovery/vendor-features.md` — readable inventory ending with the API coverage table.
- `docs/reports/P1-VENDOR.md` — this file. Nothing committed (main checkout).

## Commands and results
- `node -e require(vendor-features.json)` → 24 entries OK, 0 entries missing keys.
- Node queries on `catalog/spapi/operations.json`, `reports.json` → 42 vendor operations listed (vendorOrders, vendorShipments, vendorInvoices, vendorTransactionStatus, 6 vendorDirectFulfillment* APIs); 8 `GET_VENDOR_*` report types; `promotions@2025-12-01` is seller-audience only.

## Safety
No Submit/Save/Create/Edit/Cancel/Upload/Confirm was clicked. Clicks used: menus, tabs, dropdown lists (closed with Escape), radio selection inside the empty wizard (client-side), one "Next" click with empty dates to read validation messages (nothing saved), and the close (X) of three info/survey/creation dialogs. The coupon "Create" button only opened a chooser dialog, closed with X. No "Leave site?" dialog occurred. No vendor codes, ASINs, names, prices or funding amounts are recorded. All three tabs I opened were closed; none remain.

## Not reachable / not done
- **Personalized promotion, Points Deal**: "Access restricted – not supported in your marketplace yet."
- **Create wizard steps 2 and 3** (Add products, Set product discounts): advancing needs valid dates and would create a draft. Fields not recorded; only step titles.
- **Prime Exclusive**: not offered in this account.
- **Invoices / Payments**: no menu entry for this account.
- Not opened (menu names only): most Items entries, Supply Chain, Advertising (external link), Growth, Brand Analytics/VoC/Prep/Concession Hub, Learn, Recently Modified POs, Manage POs in bulk, Shipments row actions and create flow, DF bulk-action options and order columns (no orders), coupon one-at-a-time flow and campaign detail, Retail Analytics Inventory/Net PPM/Catalogue tabs.
- Dashboard text was captured by script/screenshot; the account is Canada-only so other regions' tabs were not checked.

## Open questions for P1-SCOPE
1. Vendor promotions (deals, price discounts, coupons) are console-only: either scope them out of MVP or confirm whether `promotions@2025-12-01` (Pricing role) returns vendor promotions.
2. Is seller-hub's vendor MVP the PO → ASN → invoice flow plus Retail Analytics reports (all API-backed)? Promotion/coupon management would then be a read-only roadmap item.
3. DF order/shipping operations are RDT-restricted (D11): DF stays out of MVP unless D11 changes.

## Follow-ups
- Re-run with a first-party (non-DF) US vendor account to see Invoices/Payments, Lightning Deal list, Personalized and Points promotions, and wizard steps 2–3 (needs a user-approved sandbox/draft).
