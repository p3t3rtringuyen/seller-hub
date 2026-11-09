# Feature ideas: market benchmark + Amazon toolkit (P1-REF)

Status: discovery input for P1-SCOPE. Not a scope decision: MVP choice belongs to the user (D10, column **MVP?** in `docs/SCOPE.md`).
Decisions that bind this file: **D56** (requirements only: no copied UI, text or branding), **D5** (Seller + Vendor), **D51** (ads features follow the Amazon Ads console), **D53** (Ads API v1 by default; exceptions are named), **D50** (AI assistant as an MCP client; every write approved by a human).

## How to read an entry

- **Sources**: `PAC` Pacvue · `PER` Perpetua (incl. Sellics) · `H10` Helium 10 Ads (formerly Adtomic) · `SKA` Skai · `TK` `refs/amazon/selling-partner-agentic-toolkit` · `SMP` `refs/amazon/selling-partner-api-samples`.
- **Evidence**: `[official]` = vendor help center or product page read in search results · `[3p]` = third-party review or comparison only · `[toolkit]`/`[sample]` = Amazon repo file.
- **Applicability**: `S` Seller (3P) · `V` Vendor (1P) · `S+V` both. Where a feature only works for one side, the entry says so.
- **Amazon API**: operation IDs verified in `catalog/spapi/operations.json` or `catalog/ads/operations.json`. Ads API version follows D53: `v1` unless marked `v0 exception` (exception list at the end of this file).
- **Write approval**: `none` (read-only) · `preview+approve` (a human approves each change) · `rule+cap` (an automatic rule may act inside a cap the user sets; changes are logged and reversible) · `always-draft` (the AI drafts, a human applies).
- **Surface**: `screen` (classic UI) · `AI` (assistant answer or action, D50) · `both`.

### Source caveats (read before using any entry)

- Vendor pages for Pacvue, Perpetua and Skai returned HTTP 403/404 to the fetch tool. Their feature lists come from search-result excerpts, Perpetua's public help center (`help.perpetua.io`), Helium 10's public help center (`kb.helium10.com`), and third-party reviews. Those reviews disagree on plan names and prices, so **no pricing is recorded here**.
- Helium 10's rename from Adtomic to Helium 10 Ads, and its rebuild on Pacvue, come from one third-party blog. Treat as unverified.
- Skai's Amazon DSP page lists audience analysis, reporting and experiments. It did not list bid automation, dayparting, harvesting or sales/inventory data. Skai's AI and "Agentic OS" appear only as product names in navigation.
- A "Nova" comparison page says vendor Sponsored Products data come from vendor Ads profiles. We did not confirm that from an Amazon source. **Open question:** do 1P vendors use the same Ads profiles and endpoints as sellers? Check in `docs/discovery/ads-domains.md` before writing any V ads entry as ready.

---

## A. Ads optimisation (from the market, D51)

### F-01 Goal-based bid optimisation (ROAS / ACoS / CVR target)
- **Story**: As a seller I want to set a target (ROAS, ACoS or conversion rate) per campaign or group and let the tool move bids toward it, so I do not adjust bids by hand.
- **Sources**: `PER` [official] goals with ROAS/ACoS/CVR and "contextual, conversion-based" bidding; `PAC` [3p] dynamic bid adjustments; `H10` [official] AI campaign management, rules-based bidding; `SKA` [3p] AI adjusts bids and budgets toward goals (single third-party source).
- **Amazon API**: read `v1` query campaigns / ad groups / targets (`/adsApi/v1/query/campaigns`, `/query/adGroups`, `/query/targets`) and reports (`/adsApi/v1/create/reports`, `/retrieve/reports`). Bid write: `v0 exception` (`/sp/targets` PUT `UpdateSponsoredProductsTargetingClauses`; keyword bid PUT `UpdateSponsoredProductsKeywords`).
- **Writes**: `rule+cap` for auto mode (max change % per day, floor and ceiling per bid); `preview+approve` for the first run of a new goal.
- **Applicability**: S now; V only after the Ads-profile question above is closed.
- **Surface**: both.

### F-02 Rule builder (condition → threshold → action)
- **Story**: As a manager I want rules such as "if ACoS > 40% over 7 days, lower bid by 10%" so the tool applies my policy on a schedule.
- **Sources**: `PER` [official] rules built from condition, threshold and action (rules-style actions: budget increase, negative match, spend shift based on ACoS or season); `PAC` [official] rule-based automation and custom keyword bidding rules; `H10` [official] rules-based bidding and automation.
- **Amazon API**: the rules run inside our worker (no Amazon rule API in the catalog). Inputs: F-01 reads and reports. Writes: campaign and ad-group calls `v1`; keyword and target bids `v0 exception`.
- **Writes**: `rule+cap`. Creating or editing a rule needs the Manager role (D55); running it is logged.
- **Applicability**: S+V (depends on ads profiles, see caveat).
- **Surface**: screen (rule editor), AI (explain a rule's last run).

### F-03 Dayparting (hour-of-week bid schedule)
- **Story**: As a seller I want bids raised or lowered at set hours or days so spend follows when my customers convert.
- **Sources**: `PAC` [official] dayparting page and a published case study (hour-of-day bid rules); `PAC` hourly adjustments fed by Marketing Stream data is [3p] only; `H10` [official] schedule bids on or off at set hours, multiplier by day; `PER` [official] dayparting multipliers applied last in custom goals; worked example in help center.
- **Amazon API**: no Amazon dayparting endpoint in the catalog. Build in our worker: hourly input from Ads Marketing Stream v2 (`refs/amazon-ads/docs/guides/amazon-marketing-stream/`; v1 is deprecated, shut-off 2027-06-30 per that doc) plus bid writes `v0 exception`. A note: the DSP has its own `daypart` targeting (`DspCreateAdGroupTargetingDayparts`, v0), which is a different feature.
- **Writes**: `rule+cap`; the schedule itself is a seller setting.
- **Applicability**: S (ads); V depends on ads.
- **Surface**: screen (grid editor), AI (summary).

### F-04 Daily budget pacing across campaigns
- **Story**: As a manager I want to see whether spend will land on my monthly target, and which campaigns to move money to, so budget is not spent in the first week.
- **Sources**: `PER` [official] cross-order budget pacing ("how you are tracking toward your monthly target"); `PER` [3p] pace-versus-efficiency mode (dual optimisation); `H10` [official] budget rules that change daily budgets by clicks, spend or weekday.
- **Amazon API**: budget usage `v0 exception` (`/sp/campaigns/budget/usage` `spCampaignsBudgetUsage`; `/sb/campaigns/budget/usage`; `/portfolios/budget/usage`). Campaign budget writes: `v1` campaign update (`/adsApi/v1/update/campaigns`). Amazon's budget rules are `v0 exception` (`/sp/budgetRules`, `/sb/budgetRules`).
- **Writes**: `rule+cap` for budget moves inside a cap; any move above the cap is `preview+approve`.
- **Applicability**: S (ads); V depends on ads.
- **Surface**: both.

### F-05 Keyword harvesting (search terms → exact match)
- **Story**: As a seller I want converting search terms from auto campaigns copied into manual exact-match campaigns automatically, with a threshold I choose.
- **Sources**: `PER` [official] harvesting on by default for goals, criteria by phrase and match type, conversion bar that rises with keyword count; `PAC` [official] keyword harvesting automated rules; `H10` [official] add winning search terms into exact-match campaigns automatically.
- **Amazon API**: search-term data via `v1` reports (`/adsApi/v1/create/reports`; the report type must be confirmed against the Ads reports spec); keyword create `v0 exception` (`CreateSponsoredProductsKeywords`).
- **Writes**: `preview+approve` by default; `rule+cap` only once the user turns it on, with a daily cap on new keywords.
- **Applicability**: S (ads); V depends on ads.
- **Surface**: both.

### F-06 Negative keyword automation (wasted terms → negative)
- **Story**: As a seller I want terms that get clicks but no sales for N clicks added as negatives, so I stop paying for them.
- **Sources**: `H10` [official] rules such as click threshold without a sale add a negative match (the threshold is the user's choice; a third-party example uses 15 clicks, not a default); `PER` [official] negative keyword targeting in goal setup, goal-level negatives carry to the linked Keyword Boost campaign; `PER` [3p] rules that remove keywords and add them as negatives.
- **Amazon API**: `v0 exception` (`CreateSponsoredProductsNegativeKeywords`, `CreateSponsoredProductsNegativeTargetingClauses`); input from search-term reports `v1`.
- **Writes**: `preview+approve` by default; `rule+cap` optional.
- **Applicability**: S (ads); V depends on ads.
- **Surface**: both.

### F-07 Campaign creation from a goal or from a listing
- **Story**: As a seller I want to pick an ASIN and a goal, and get a suggested campaign structure (auto, manual, exact, brand defense) that I review before it goes live.
- **Sources**: `PER` [official] automated campaign creation and goal-based launch ("custom goal"); `H10` [official] AI campaign management.
- **Amazon API**: `v1` create campaigns and ad groups (`/adsApi/v1/create/campaigns`); ASIN attributes from Catalog Items 2022-04-01 `searchCatalogItems` and Listings Items.
- **Writes**: `always-draft`: the tool shows the full draft (budget, bids, targets) and the user applies it. This matches D51, which follows the Amazon Ads console Campaign Builder.
- **Applicability**: S (ads); V depends on ads.
- **Surface**: screen (wizard), AI (draft from a sentence).

### F-08 Takeover of existing campaigns
- **Story**: As a seller I want to bring existing campaigns under the tool without rebuilding them.
- **Sources**: `PER` [official] campaign takeover for Sponsored Products (taken-over campaigns start with harvesting off).
- **Amazon API**: `v1` query campaigns / ad groups / targets; then the F-01..F-06 writes.
- **Writes**: `preview+approve` for the first takeover (show what will change; harvesting and automation default to off).
- **Applicability**: S+V (depends on ads).
- **Surface**: screen.

### F-09 Bulk edit with preview and undo
- **Story**: As a manager I want to edit hundreds of bids or budgets in one table, see the diff, and roll back the last batch.
- **Sources**: `SKA` [official] bulk actions to manage changes at scale; `PAC` [official] customised dashboards and bulk management.
- **Amazon API**: `v1` campaign update; `v0 exception` for keyword and target bids. Mind the rate limits (see reference-patterns, SDK section).
- **Writes**: `preview+approve` for the whole batch; rollback is a new batch.
- **Applicability**: S+V (depends on ads).
- **Surface**: screen.

### F-10 Ingest Amazon's own campaign recommendations
- **Story**: As a seller I want Amazon's recommendations shown in one inbox next to the tool's own suggestions, so I decide once.
- **Sources**: `PER` [3p] "smart recommendations"; this is also an Amazon-side feature (Marketing Stream dataset `sponsored-ads-campaign-diagnostics-recommendations`, in `refs/amazon-ads/docs/guides/amazon-marketing-stream/datasets/`).
- **Amazon API**: `v1` `GET /adsApi/v1/recommendations`, `POST /adsApi/v1/query/recommendations`, `POST /adsApi/v1/query/recommendationTypes/sb`.
- **Writes**: `preview+approve` (accepting a recommendation is a write).
- **Applicability**: S+V (depends on ads).
- **Surface**: screen, AI.

---

## B. Joins across sales, inventory and ads

### F-11 Pause ads when stock runs low; resume on restock
- **Story**: As a seller I want campaigns paused when FBA units drop below a threshold and resumed when stock returns, so I do not pay for clicks I cannot ship.
- **Sources**: `PAC` [official] Amazon's ads blog describes pausing campaigns when inventory falls under a set threshold and resuming on replenishment (source: Amazon Ads blog, linked from Pacvue's content).
- **Amazon API**: inventory `v1` `GET /fba/inventory/v1/summaries` (`getInventorySummaries`); pause and resume via `v1` `/adsApi/v1/update/campaigns`. Vendor side: `vendorDirectFulfillmentInventory.submitInventoryUpdate` (write) and vendor inventory reports.
- **Writes**: `rule+cap` for pause (safe direction); `preview+approve` for resume if the user wants to check stock first.
- **Applicability**: S (FBA); V (vendor inventory, with the vendor inventory report source to confirm).
- **Surface**: both.

### F-12 Profit-aware ROAS and TACoS view (sales + fees + ads)
- **Story**: As a manager I want ROAS and TACoS computed net of Amazon fees and cost of goods, not just gross sales, so the bid rules use the true margin.
- **Sources**: `H10` [3p] Helium 10 is described as a full seller suite with profit tools (depth not verified); `PER` [3p] TACoS-aware pacing (third-party summary only); `TK` finance-month-end-closer reconciles net proceeds with settlements.
- **Amazon API**: `finances` v2024-06-19 `listTransactions`; v0 `listFinancialEventGroups`; `sales` v1 `getOrderMetrics` (orders by window); product fees `productFees` v0 `getMyFeesEstimateForSKU`; ads spend from `v1` reports.
- **Writes**: none (read-only view). Feeds F-01 and F-04 as an option ("optimise to profit").
- **Applicability**: S (fees, settlements); V uses vendor payments instead (section H).
- **Surface**: screen, AI.

### F-13 Sales and traffic analytics with attributed vs organic split
- **Story**: As an analyst I want daily sales, sessions and conversion per ASIN, with the ad-attributed share separated from organic, in one dashboard.
- **Sources**: `PER` [official] total sales analytics, attributed vs organic and customisable metrics (product page feature list); `SMP` Data Kiosk MCP sales & traffic queries (`amazon-data-kiosk-mcp-server`).
- **Amazon API**: `dataKiosk` 2023-11-15 `createQuery`, `getQuery`, `getDocument`, `cancelQuery`; or Reports API `createReport` / `getReport` / `getReportDocument` for simpler reports.
- **Writes**: none.
- **Applicability**: S+V (vendor analytics also via Data Kiosk; confirm vendor query names in the sample).
- **Surface**: screen, AI.

### F-14 Stock-out and reorder advice (inventory + velocity + inbound)
- **Story**: As a seller I want to see days of cover per SKU and the reorder quantity and date, and whether an inbound shipment lands in time.
- **Sources**: `TK` `stockout-prevention` skill (days of supply, velocity, inbound gap); the skill forbids pricing advice, a choice we can keep.
- **Amazon API**: `fbaInventory` v1 `getInventorySummaries`; `sales` v1 `getOrderMetrics`; `fulfillmentInbound` 2024-03-20 `listInboundPlans` and `getInboundOperationStatus`.
- **Writes**: `always-draft` (reorder is a plan the user creates in F-15).
- **Applicability**: S (FBA). V: vendor purchase orders replace inbound (section H).
- **Surface**: both.

---

## C. AI assistant and analytics (D50)

### F-15 Ask the account a question (sales, ads, stock, listings)
- **Story**: As a seller I want to ask "why did sales drop last week?" and get a sourced answer.
- **Sources**: `TK` `seller-analytics` skill (discover metrics first, never guess names), `TK` `sp-sales-drop` command (baseline window, ranked causes, diagnosis only); `H10` [official] AI-powered campaign management; `SKA` [3p] AI and agent products (names only).
- **Amazon API**: read only. Note: the toolkit calls connector tools `analytics_getMetricData` and `analytics_getMetricMetadata`. **They are not in the public SP-API models** (grep of `refs/amazon/selling-partner-api-models` found no match), so we cannot build on them. Use `sales` v1 `getOrderMetrics` and Data Kiosk instead.
- **Writes**: none; any write the assistant drafts goes through a human.
- **Applicability**: S+V (depends on data source).
- **Surface**: AI.

### F-16 Sales-drop diagnosis
- **Story**: As a manager I want the revenue delta split into causes (listing suppressed, stock-out, buy-box, ad spend, account health) with a next-step list.
- **Sources**: `TK` `sp-sales-drop` command and `seller-analytics` skill.
- **Amazon API**: `sales` v1 `getOrderMetrics` (both windows); `listings` 2021-08-01 `searchListingsItems` (issues); `fbaInventory` v1; `productPricing` 2022-05-01 `getCompetitiveSummary` (buy box signal); `v1` Ads reports.
- **Writes**: none (diagnosis only, per the command's rule).
- **Applicability**: S+V.
- **Surface**: AI, screen.

### F-17 Ads recommendation summary in plain language
- **Story**: As a manager I want each campaign's last-7-day result and the top three changes that would help, written in plain language, with a link to the screen where I apply them.
- **Sources**: `PER` [3p] smart recommendations; `SKA` [3p] AI optimisation (single source).
- **Amazon API**: `v1` reports and recommendations (F-10).
- **Writes**: `always-draft`.
- **Applicability**: S+V (depends on ads).
- **Surface**: AI.

---

## D. Seller operations (from the Amazon agentic toolkit)

### F-18 Listing troubleshooter (router)
- **Story**: As a seller I want one entry point for "something is wrong with my listing" that finds the cause and sends me to the right fix.
- **Sources**: `TK` `listing-troubleshooter` skill, `TK` `sp-fix-listing` command.
- **Amazon API**: `listings` 2021-08-01 `searchListingsItems` with `includedData=summaries,issues`.
- **Writes**: none (routing only).
- **Applicability**: S (listings for vendors exist too; confirm for V in this scope).
- **Surface**: both.

### F-19 Fix listing issues (suppression, missing attributes)
- **Story**: As a seller I want each listing issue explained, the fix previewed, and applied only after my approval.
- **Sources**: `TK` `listing-issues` skill (triage by impact, preview, approval).
- **Amazon API**: `listings` 2021-08-01 `searchListingsItems`, `getListingsItem`, `patchListingsItem` (run `mode=VALIDATION_PREVIEW` first). `productTypeDefinitions` for attribute rules.
- **Writes**: `preview+approve` (always).
- **Applicability**: S+V (vendor listings to confirm).
- **Surface**: both.

### F-20 Buyability check (offer, completeness, inventory)
- **Story**: As a seller I want to know why a listing is not buyable and fix the offer after approval.
- **Sources**: `TK` `listing-buyability` skill.
- **Amazon API**: `listings` 2021-08-01 `searchListingsItems` (`includedData=summaries,offers,attributes,issues`); `patchListingsItem` for the offer.
- **Writes**: `preview+approve`.
- **Applicability**: S.
- **Surface**: both.

### F-21 Searchability review (title, bullets, generic keywords)
- **Story**: As a seller I want to know whether a listing can be found, and see suggested content changes for approval.
- **Sources**: `TK` `listing-searchability` skill (relevancy step marked "pending tool" in the skill).
- **Amazon API**: `listings` 2021-08-01 `searchListingsItems`; `patchListingsItem`.
- **Writes**: `preview+approve`.
- **Applicability**: S (vendor: confirm).
- **Surface**: both.

### F-22 Compliance gate before a listing write
- **Story**: As a seller I want a checklist of regulatory facts (ingredients, claims, certifications, condition) before a restricted listing is created or changed.
- **Sources**: `TK` `listing-compliance` skill (gate, advisory only).
- **Amazon API**: `listings` 2021-08-01 `getListingsRestrictions` (verified in catalog; `GET /listings/2021-08-01/restrictions`). The skill's Seller Assistant step uses connector tools `sellerAssistant_*` that are **not public SP-API** (not in models); do not depend on them.
- **Writes**: none; it is a gate.
- **Applicability**: S (vendor: confirm).
- **Surface**: both.

### F-23 FBA inbound plan workflow (create → pack → place → transport → confirm)
- **Story**: As a seller I want an FBA shipment created step by step, each step previewed and confirmed by me, and its status tracked.
- **Sources**: `TK` `fba-inbound-management` skill (scope: sellers only; vendors use a different flow).
- **Amazon API**: `fulfillmentInbound` 2024-03-20: `createInboundPlan`, `listInboundPlans`, `generatePackingOptions` / `listPackingOptions` / `confirmPackingOption`, `generatePlacementOptions` / `confirmPlacementOption`, `generateTransportationOptions` / `confirmTransportationOptions`, `generateDeliveryWindowOptions` / `confirmDeliveryWindowOptions`, `getInboundOperationStatus` (poll).
- **Writes**: `preview+approve` at every gate; the placement step is permanent and charges fees (per the skill's hard gate).
- **Applicability**: S only.
- **Surface**: both.

### F-24 Stock-out check command
- **Story**: As a seller I want `/sp-stockout-check` to return CRITICAL / WARNING / HEALTHY per SKU with a reorder quantity.
- **Sources**: `TK` `sp-stockout-check` command.
- **Amazon API**: as F-14.
- **Writes**: `always-draft`.
- **Applicability**: S.
- **Surface**: AI.

### F-25 Month-end close and payout reconciliation
- **Story**: As a finance user I want the month's net proceeds reconciled against settlements, the payout status confirmed, and an accountant summary I can export.
- **Sources**: `TK` `finance-month-end-closer` skill (read-only; never moves money).
- **Amazon API**: `finances` v2024-06-19 `listTransactions`, `listBalances`; `transfers` 2024-06-01 `listPayouts`, `listExpectedPayouts`; `finances` v0 `listFinancialEventGroups` (settlement groups) and `listFinancialEvents`. The skill's connector tool `finances_monthEndClosing` **is not in the public models**; build the reconciliation from the public operations above.
- **Writes**: none. Never initiate a payout (`initiatePayout` exists but is out of scope).
- **Applicability**: S (vendor payments: section H).
- **Surface**: screen, AI.

### F-26 Secondary user access (guided only)
- **Story**: As an account owner I want guidance to give a secondary user access to the assistant, with the grant done by me in Seller Central.
- **Sources**: `TK` `invite-secondary-users` skill (advisory; UI step).
- **Amazon API**: none identified. Do not build a write.
- **Writes**: none.
- **Applicability**: S.
- **Surface**: both (static guide). Note: our own RBAC (D55) is separate.

### F-27 Support case helper
- **Story**: As a seller I want a clean, PII-free case summary and the right Seller Support path, with the case sent only after my confirmation.
- **Sources**: `TK` `support-case-helper` skill.
- **Amazon API**: `support` 2025-02-01 `listCases`, `getCase`, `listContacts` (read). Creating a case is not in the models: keep the human hand-off. Redact buyer PII.
- **Writes**: `always-draft` (the user sends it).
- **Applicability**: S+V (confirm).
- **Surface**: AI, screen.

### F-28 SP-API knowledge assistant for builders
- **Story**: As a developer on this project I want answers about SP-API grounded in Amazon's docs, with a code sample.
- **Sources**: `TK` `sp-api-knowledge` skill; `SMP` `sp-api-dev-mcp` (search and code generation).
- **Amazon API**: none at run time; a build-time tool.
- **Writes**: none.
- **Applicability**: build tooling (not a user feature). Keep it out of the product scope; use it in P2 design.
- **Surface**: AI (developer).

---

## E. Vendor (1P) support (D5)

### F-29 Vendor order and shipment workflow (PO → ack → ship → invoice)
- **Story**: As a vendor I want purchase orders pulled, acknowledged, shipped and invoiced from one screen.
- **Sources**: no competitor page read covers the PO-to-invoice flow in detail. Pacvue [official] vendor connection needs Vendor Central integration rights (support article, search excerpt). Operation names come from the committed catalog. The `SMP` samples list Listings and A+ as usable by sellers and vendors, but ship no vendor order sample.
- **Amazon API**: `vendorOrders` v1 `getPurchaseOrders`, `getPurchaseOrdersStatus`, `submitAcknowledgement`; `vendorShipments` `SubmitShipments`, `GetShipmentDetails`, `GetShipmentLabels`; `vendorInvoices` `submitInvoices`; `vendorTransactionStatus` `getTransaction`. Direct fulfilment (DF) is a separate family: `vendorDirectFulfillmentOrders`, `…Shipping`, `…Payments`, `…Inventory`.
- **Writes**: `preview+approve` for acknowledgements, shipments and invoices (they are legal documents).
- **Applicability**: V only.
- **Surface**: screen.

### F-30 Vendor sales, inventory and ads join
- **Story**: As a vendor I want sell-through, stock and ad spend per ASIN side by side, and ads paused when stock is short.
- **Sources**: `PAC` [official] inventory-driven pause and resume (Amazon ads blog); `PAC` [official] "Product IQ for Amazon 1P Vendors" overlays commerce and ad KPIs on product pages (a browser extension for 1P vendors; idea only, do not copy).
- **Amazon API**: vendor data via Data Kiosk vendor analytics (sample `amazon-data-kiosk-mcp-server` `packages/vendor-server`), vendor inventory submit, vendor orders; ads via F-11 (to confirm for vendors).
- **Writes**: as F-11.
- **Applicability**: V (ads part to confirm).
- **Surface**: screen, AI.

### F-31 A+ content workflow (Standard, Premium, Brand Story)
- **Story**: As a seller or vendor I want to find listings without A+ content, create or edit documents, attach them to ASINs, submit for approval and preview.
- **Sources**: `SMP` `aplus-content-manager` sample (local app; sample-data mode).
- **Amazon API**: `aplusContent` 2020-11-01 `searchContentDocuments`, `createContentDocument`, `updateContentDocument`, `postContentDocumentAsinRelations`, `postContentDocumentApprovalSubmission`, `postContentDocumentSuspendSubmission`, `searchContentPublishRecords`; `createMedia` / `updateMedia` for video (sample notes Media API).
- **Writes**: `preview+approve` (submission goes live after Amazon review).
- **Applicability**: S+V (sample says both; Brand Registry needed).
- **Surface**: screen.

### F-32 Ads for 1P vendors (open)
- **Story**: As a vendor I want F-01..F-09 for my vendor ad accounts.
- **Sources**: `PAC` [official] vendor-side connection (commerce required, ads optional); `PER` and `H10` do not state 1P coverage on the pages read.
- **Amazon API**: unknown for 1P profiles. Open question (see caveats).
- **Writes**: as the matching F entry.
- **Applicability**: V, blocked on the question.
- **Surface**: screen.

---

## F. Parked or out of scope for now

- **P-01 Amazon DSP audiences, line-item budget allocation** (`PER` DSP product; `SKA` DSP). Park: needs DSP API coverage (not checked in this task) and a separate spend model. Revisit in P1-SCOPE.
- **P-02 Non-Amazon channels (Walmart, Google, Meta, retail media networks)** (`PER`, `SKA`, `PAC`). Out of D2 (SP-API + Ads API).
- **P-03 Automated price changes and pricing rules** (Amazon's own "Automate Pricing" rules in `refs/amazon/selling-partner-api-postman` pricing collection; `TK` forbids pricing advice). Park: the toolkit's guardrail is a product choice we must decide, not copy.
- **P-04 Incrementality experiments** (`SKA` experiments and measurement). Park.
- **P-05 Product-page KPI overlay** (`PAC` Product IQ browser extension). Park; idea only.
- **P-06 Browser-side Seller Central screens** (not an API feature). Excluded.

---

## G. Coverage check

- Competitor features listed (from the brief): automated optimisation F-01, rule-based bidding F-02, dayparting F-03, budget pacing F-04, keyword harvesting F-05, negatives F-06, sales+inventory+ads joins F-11..F-14, AI analytics F-15..F-17, vendor 1P F-29..F-32. Each has a source, an API and an applicability.
- Toolkit skills and commands: every skill (12) and command (3) has at least one entry: seller-analytics F-15, finance-month-end-closer F-25, stockout-prevention F-14, fba-inbound-management F-23, listing-troubleshooter F-18, listing-issues F-19, listing-buyability F-20, listing-searchability F-21, listing-compliance F-22, invite-secondary-users F-26, support-case-helper F-27, sp-api-knowledge F-28; commands `sp-stockout-check` F-24, `sp-fix-listing` F-19, `sp-sales-drop` F-16.
- Not checked: Skai's and Pacvue's current pricing and plan tiers (out of scope), and any feature that only appears behind a login.

## H. Vendor and seller mapping (quick reference)

| Feature area | Seller (S) | Vendor (V) |
|---|---|---|
| Orders | `orders` v2026-01-01 (Postman migration recipes) | `vendorOrders` v1 / `vendorDirectFulfillmentOrders` |
| Inventory | `fbaInventory` v1 | `vendorDirectFulfillmentInventory.submitInventoryUpdate` |
| Money | `finances` 2024-06-19 | `vendorTransactionStatus`, `vendorDirectFulfillmentPayments` |
| Ads | Ads v1 (+ v0 exceptions) | open (F-32) |
| Listings | `listings` 2021-08-01 | same API family, confirm per product type |

The vendor side of F-14 (stock-out) is vendor purchase orders and inventory; the vendor side of F-25 (month-end) is the vendor transaction status and payments families.

## I. Ads API v0 exceptions seen in this task (for the D53 log)

Recorded in `catalog/ads/operations.json` as v0 (no v1 operation found in the committed catalog):

- Keywords and negative keywords: `/sp/keywords`, `/sp/negativeKeywords`, `/sb/keywords`, `/sb/negativeKeywords`, `/sb/negativeTargets`.
- Target and bid updates: `/sp/targets` (`UpdateSponsoredProductsTargetingClauses`).
- Budget rules: `/sp/budgetRules`, `/sb/budgetRules`.
- Budget usage: `/sp/campaigns/budget/usage`, `/sb/campaigns/budget/usage`, `/portfolios/budget/usage`.
- Portfolios: `/portfolios`, `/portfolios/list`.
- Exports: `/campaigns/export`.

Ads-domain owners: confirm this list with `docs/discovery/ads-domains.md` before it is used as an ADR input.

## J. Source files and URLs

### J.1 Amazon repo files (under `refs/amazon/`)

| Entry | Files |
|---|---|
| F-13, F-30 (analytics, vendor analytics) | `selling-partner-api-samples/use-cases/amazon-data-kiosk-mcp-server/packages/seller-server/src/api/salesAndTraffic.ts`, `…/vendor-server/src/api/vendorAnalytics.ts` |
| F-14, F-16, F-24 (stock-out, sales drop, stockout command) | `selling-partner-agentic-toolkit/skills/stockout-prevention/SKILL.md`, `…/references/reports-vs-ordermetrics.md`, `…/commands/sp-stockout-check.md`, `…/skills/seller-analytics/SKILL.md`, `…/commands/sp-sales-drop.md` |
| F-15 (AI analytics) | `selling-partner-agentic-toolkit/skills/seller-analytics/SKILL.md`, `…/references/metrics-catalog.md`, `…/request-reference.md` |
| F-18 (troubleshooter) | `selling-partner-agentic-toolkit/skills/listing-troubleshooter/SKILL.md`, `…/commands/sp-fix-listing.md` |
| F-19 (listing issues) | `selling-partner-agentic-toolkit/skills/listing-issues/SKILL.md`, `…/references/fix-playbook.md`, `…/issue-taxonomy.md` |
| F-20 (buyability) | `selling-partner-agentic-toolkit/skills/listing-buyability/SKILL.md` |
| F-21 (searchability) | `selling-partner-agentic-toolkit/skills/listing-searchability/SKILL.md` |
| F-22 (compliance) | `selling-partner-agentic-toolkit/skills/listing-compliance/SKILL.md`, `…/references/regulatory-map.md`, `…/seller-assistant-protocol.md` |
| F-23 (FBA inbound) | `selling-partner-agentic-toolkit/skills/fba-inbound-management/SKILL.md`, `…/references/tools-and-additional.md`, `…/carriers-and-shipping.md`, `…/special-workflows.md` |
| F-25 (month-end) | `selling-partner-agentic-toolkit/skills/finance-month-end-closer/SKILL.md`, `…/references/reconciliation-notes.md`, `…/seller-central-urls.md` |
| F-26 (secondary users) | `selling-partner-agentic-toolkit/skills/invite-secondary-users/SKILL.md`, `…/references/manage-agents-guide.md`, `…/quick-collaborator.md` |
| F-27 (support) | `selling-partner-agentic-toolkit/skills/support-case-helper/SKILL.md` |
| F-28 (knowledge) | `selling-partner-agentic-toolkit/skills/sp-api-knowledge/SKILL.md`, `selling-partner-api-samples/use-cases/sp-api-dev-mcp/README.md` |
| F-29 (vendor orders) | `selling-partner-api-postman/Postman Collections/getting-started-with-sp-api-for-vendors.json`; operation IDs in `catalog/spapi/operations.json` |
| F-31 (A+) | `selling-partner-api-samples/use-cases/aplus-content-manager/README.md`, `…/server/mock/fixtures/documents.json` |
| F-03, F-11 (Ads inputs) | `refs/amazon-ads/docs/guides/amazon-marketing-stream/overview.md`, `…/datasets/budget-usage.md`, `…/datasets/sponsored-ads-campaign-diagnostics-recommendations.md`, `refs/amazon-ads/docs/guides/budgets/usage/overview.md` |

### J.2 Competitor public pages used (search excerpts and reads; no login)

- Pacvue: `pacvue.com/tag/dayparting` (HTTP 403 on fetch; excerpt from search), support article `support.pacvue.com/hc/en-us/articles/25418579767069` (vendor connection; excerpt), Amazon Ads blog "How vendors manage inventory and advertising spend with Pacvue" (inventory-based pause; excerpt).
- Perpetua: help center `help.perpetua.io/en/articles/5734740-keyword-harvesting-in-perpetua` (harvesting), `…/3628489-keyword-boost` (budget starting point, negatives), `…/5650960-sponsored-products-how-to-launch-a-custom-goal` (goals, dayparting multipliers last), `…/5820481-campaign-takeover-for-sponsored-products` (takeover), `…/9204011-multipliers-and-interactions-in-perpetua` (multipliers); product page `perpetua.io/` (fetched: bid optimisation, automation, rules-style actions, attributed vs organic sales); DSP blog `perpetua.io/blog-maximizing-amazon-dsp-efficiency-by-solving-constrained-budget-allocation` (search excerpt).
- Helium 10 Ads: `kb.helium10.com/hc/en-us/articles/18076439623963-Adtomic-Rules-Automation` (rules and budget rules; search excerpt), `helium10.com/ads-learning-hub/` (feature list; search excerpt), `helium10.com/tools/advertising/helium10ads/` (dayparting, harvesting; search excerpt). `helium10.com/tools/adtomic/` returned 404 on fetch.
- Skai: `skai.io/capabilities/amazon-dsp` (fetched: audience, reporting, cross-channel, experiments; no bid automation or dayparting listed), `skai.io/amazon-advertising` (HTTP 403 on fetch).
- Third-party comparisons used only as a signal (flagged `[3p]`): Daniks.AI vs Pacvue, SellerApp dayparting help, AdLabs, Off Hours, Ad Badger, Sellozo, amztoolhub, Ryze, Nova.
