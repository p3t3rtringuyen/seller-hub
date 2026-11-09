# Reference patterns from Amazon's repos (P1-REF)

Status: discovery input for the architects (P2). Read-only: no script under `refs/` was run, no dependency installed, nothing copied.

Decisions that bind this file: **D0 / clean room** (we take patterns and requirements, never code, comments, host names or Yes4All names), **D3** (TypeScript: Next.js BFF, Node API, BullMQ worker, PostgreSQL 16), **D1** (tenant-ready schema, self-hosted first), **D5** (Seller + Vendor), **D50** (AI assistant as MCP client; writes need a human), **D52** (call Amazon directly with each seller's LWA credentials; no internal proxy).

## Method and conventions

- Paths are relative to the repository root and point into `refs/amazon/…` (gitignored; present in the main checkout).
- Every operation ID was checked against `catalog/spapi/operations.json` (SP-API) or `catalog/ads/operations.json` (Ads). Where an ID appears only in a sample or toolkit file and not in the catalog or `refs/amazon/selling-partner-api-models/models/`, the text says so.
- Each section ends with **Adoption** (2–4 lines for seller-hub with the D3 stack).

---

## 1. Use-case samples (`refs/amazon/selling-partner-api-samples/use-cases/`)

The sample README lists seven use cases. Each has a section below. `code-recipes/` and `local-ai-sandbox/` sit beside `use-cases/` and were not reviewed in depth (see "Not reviewed").

### 1.1 Website authorization (`use-cases/website-authorization/`)
- **Problem**: how a seller authorises our app (LWA website OAuth) and how we get the first refresh token.
- **APIs**: LWA token endpoint (`authorization_code` grant, then refresh); Sellers `getMarketplaceParticipations` (catalog: `sellers` v1) as the first authenticated call.
- **Infrastructure**: Python Flask app; no AWS needed for the sample itself (deploy scripts `app/deploy.sh`, `app/pre-requisites.sh`).
- **Steps**: (1) landing page with an Authorize button; (2) redirect to Seller Central consent URL with `application_id`, a `state` value and `version=beta` while the app is in DRAFT (`code/python/application.py` around line 12; `code/python/utils/api_utils.py`); (3) callback reads `spapi_oauth_code`, `state`, `selling_partner_id`; (4) exchange code for a refresh token (`utils/api_utils.py`, `_get_lwa_refresh_token`); (5) refresh to an access token and call Sellers.
- **Gotchas the sample states itself**: `state` is generated but not validated (CSRF risk; README says so); the refresh token must be stored in safe storage; `version=beta` must be removed for PUBLISHED apps.
- **Files**: `use-cases/website-authorization/README.md`, `code/python/application.py`, `code/python/utils/api_utils.py`, `code/python/utils/constants.py`, `docs/DEPLOYMENT.md`.
- **Adoption**: in `apps/web` (Next.js BFF) implement the callback as a server route; generate `state` per request, store it server-side with the user's session, and check it on return. Store the refresh token encrypted in the tenant's seller-account row (`tenant_id`, `seller_account_id`). Record the `selling_partner_id` as the seller's merchant token. Use `version=beta` only in the dev environment.

### 1.2 Authorization lifecycle management (`use-cases/auth-lifecycle-management/`)
- **Problem**: running many tenant authorisations over time: client-secret rotation, revocation, inactive tenants, PII access.
- **APIs**: Applications `rotateApplicationClientSecret` (catalog: `application` 2023-11-30, `POST /applications/2023-11-30/clientSecret`); Tokens `createRestrictedDataToken` (catalog: `tokens` 2021-03-01); grantless operations (LWA `client_credentials` with a scope, see SDK section); Notifications for client-secret events (SQS destination).
- **Infrastructure**: AWS CDK (`lib/SpApiOauthStack.ts`), API Gateway, Lambda (Node), DynamoDB (partner table keyed by partner ID), Secrets Manager, SQS, EventBridge scheduler for reminders.
- **Steps and state**: `lambda/statusManager.js` moves a partner through states; `lambda/credentialRotation.js` rotates the client secret and updates the stored expiry (`newClientSecretExpiryTime`, `oldClientSecretExpiryTime` from the notification); `lambda/reminderManager.js` finds `MARKED_INACTIVE` partners and sends a reminder every `REMINDER_INTERVAL_DAYS`, stored as `lastReminderSent`; `lambda/notifications.js` handles incoming events; `lambda/appstore.js` and `lambda/authtest.js` cover the App Store flow and a test call.
- **Gotchas**: the sample's rotation code runs only for self-authorised partners (comment at `credentialRotation.js` line ~30); the README says the grantless calls need no tenant refresh token and cannot be used for tenant data. The reminder message is built from a template ID (`REVOCATION_REMINDER` in `reminderManager.js`); the delivery channel is not checked in this review, so do not reuse it without reading `reminderManager.js` in full.
- **Files**: `use-cases/auth-lifecycle-management/README.md`, `QuickStart.md`, `lambda/credentialRotation.js`, `lambda/reminderManager.js`, `lambda/statusManager.js`, `lib/SpApiOauthStack.ts`.
- **Adoption**: model tenant authorisation as a state machine in Postgres (`authorized → inactive → revoked`, plus a reminder timestamp). Use a scheduled job in the BullMQ worker for reminders. Rotate the app's client secret through the same worker, with its own audit row. Keep RDT for any PII call (D11: out of MVP). Tie this to D1: our schema is multi-tenant, but each deployment owns one app.

### 1.3 Notifications pipeline (`use-cases/notifications/`)
- **Problem**: receive SP-API events (orders, listings, feeds, etc.) reliably, without polling.
- **APIs**: Notifications `createSubscription` (`POST /notifications/v1/subscriptions/{notificationType}`), `createDestination`, `getSubscriptions`, `getDestinations`, `sendTestNotification` (all in catalog: `notifications` v1).
- **Infrastructure**: AWS: SQS and EventBridge destinations; Lambda subscribers; DLQ plus "reprocess" Lambdas; Step Functions for order changes (`app/step-functions/order-change-step-functions-workflow-definition.json`); DynamoDB subscription table (`SPAPINotificationSubscriptionTable`). Other clouds as forwarders (GCP Pub/Sub, Azure Service Bus or Storage Queue, webhook receiver). Java code.
- **Steps**: (1) create a destination; (2) subscribe per notification type (types and their config in `app/config/notification-type-definition.json`); (3) the handler receives the message from SQS or EventBridge; (4) for order changes, a Step Function calls `RetrieveOrderHandler` and then `SendNotificationHandler`, so the event carries the fresh order; (5) failures go to a DLQ; a reprocess Lambda redrives them.
- **Gotchas**: the sample's cross-platform forwarding is a feature we do not need; the fetch-after-notify pattern is the useful part. Notifications carry a payload that may be stale, so fetch the object again before acting. Use `sendTestNotification` in sandbox to check the path.
- **Files**: `use-cases/notifications/README.md`, `app/config/notification-type-definition.json`, `app/step-functions/order-change-step-functions-workflow-definition.json`, `app/sp-api-app-cdk/lib/sp-api-app-cdk-stack.ts`, `code/java/src/main/java/lambda/process/internal/orderchange/stepfunctions/RetrieveOrderHandler.java`, `…/SendNotificationHandler.java`, `…/SQSReprocessHandler.java`.
- **Adoption**: the worker consumes SQS (Notifications) in the same process model as BullMQ jobs: the inbound message is written to a Postgres inbox table first (idempotent by notification ID), then a job fetches the object again. Dead letters are re-queued from the inbox, not by a separate Lambda. Notifications for Ads (Marketing Stream) are a separate path (see `refs/amazon-ads`).

### 1.4 Listings workflows (`use-cases/listings/`)
- **Problem**: create, edit and fix listings with schema-driven forms.
- **APIs** (all in catalog): `listings` 2021-08-01 `searchListingsItems`, `getListingsItem`, `putListingsItem`, `patchListingsItem`, `deleteListingsItem`; `productTypeDefinitions` 2020-09-01 `searchDefinitionsProductTypes` (and `getDefinitionsProductType`); `catalogItems` 2022-04-01 (`searchCatalogItems`); feeds (`feeds` 2021-06-30) and `subscriptions`.
- **Infrastructure**: Next.js app (App Router, `app/api/*` routes), AWS CLI setup for an IAM user and a settings store (the README says app settings are stored securely in AWS).
- **Pattern**: product-type definition JSON Schema drives the form: `app/components/listing-attributes-editor-component.tsx`, `schema-validator-button.tsx`, `schema-validation-errors-dialog.tsx`, `form-async-drop-down-component.tsx`; the submission result dialog shows issues from the API.
- **Gotchas**: the README says some npm scripts fail on Windows and that Node 14.18 is the minimum (old). The sample predates the current Listings version guidance, so check the version chosen in each route.
- **Files**: `use-cases/listings/README.md`, `app/api/listingsitem/route.ts`, `app/api/ptddefinitions/route.ts`, `app/api/feeds/route.ts`, `app/components/listing-attributes-editor-component.tsx`, `app/components/schema-validator-button.tsx`.
- **Adoption**: store the PTD schema version with each listing draft; validate client-side from the schema and server-side before every `patchListingsItem`. Use the validation-preview mode (as the toolkit does) before any write. Form rendering: build it from the schema, not from hand-written forms.

### 1.5 A+ Content Manager (`use-cases/aplus-content-manager/`)
- **Problem**: find listings without A+ content, author Standard, Premium and Brand Story documents, upload images, attach to ASINs, submit, preview.
- **APIs** (catalog `aplusContent` 2020-11-01): `searchContentDocuments`, `createContentDocument`, `getContentDocument`, `updateContentDocument`, `listContentDocumentAsinRelations`, `postContentDocumentAsinRelations`, `validateContentDocumentAsinRelations`, `postContentDocumentApprovalSubmission`, `postContentDocumentSuspendSubmission`, `searchContentPublishRecords`; `createMedia` / `getMedia` / `updateMedia` (video, README). Uploads API is also named in the README (`uploads` 2020-11-01 is in the SDK; check it in the catalog before use).
- **Infrastructure**: a local React client (Vite) and a Node server; the server holds the credentials and has no authentication of its own (README: bind 127.0.0.1 only).
- **Pattern worth taking**: a **sample-data mode** that replays the API's responses (including validation messages) in memory, so the UI and tests run without credentials (`server/mock/`, `npm run dev:mock`). Also a three-step editor (Content, ASINs, Publish) with a "check before save" that shows the API's validation messages next to each field.
- **Gotchas**: the detail-page preview imitates a marketplace page's markup and styles. Under D56 we take the requirement (preview content as the customer sees it), not the markup or styles; design our own preview.
- **Files**: `use-cases/aplus-content-manager/README.md`, `server/mock/fixtures/documents.json`, `server/mock/catalog.json`, `client/src/components/DocumentEditor.tsx`, `client/src/components/PublishPanel.tsx`.
- **Adoption**: add a mock mode to `packages/amazon-sp` (fixtures from recorded sandbox responses); use the same pattern for the test suite (D54). The three-step editor maps to a wizard in `apps/web`. Keep submission behind a human approval (A+ goes live after Amazon review).

### 1.6 Data Kiosk MCP server (`use-cases/amazon-data-kiosk-mcp-server/`)
- **Problem**: analytics questions in natural language over Data Kiosk (sales and traffic, economics, vendor analytics).
- **APIs** (catalog `dataKiosk` 2023-11-15): `createQuery`, `getQuery`, `getQueries`, `cancelQuery`, `getDocument`. The sample tools are `create-query`, `check-query-status`, `cancel-query`, `get-document-details`, `download-document`, `list-queries`, `get-api-help`.
- **Auth**: `packages/common/src/auth/amazonAuth.ts` exchanges the refresh token for an access token; `packages/common/src/api/baseApi.ts` sends `x-amz-access-token` on each call. The sample does not use the SDK.
- **Structure**: monorepo with `common`, `seller-server` (`src/api/salesAndTraffic.ts`, `economics.ts`) and `vendor-server` (`src/api/vendorAnalytics.ts`). Use one server per account type.
- **Pattern**: an asynchronous query lifecycle: create the query, poll its status, read the document's download URL, download and parse. Cancel a running query when a user leaves.
- **Gotchas**: README says the sample is for test environments and the developer must comply with the Acceptable Use Policy and Data Protection Policy. Data Kiosk output can be large; plan a stream-to-disk step.
- **Files**: `use-cases/amazon-data-kiosk-mcp-server/README.md`, `packages/common/src/api/baseApi.ts`, `packages/common/src/auth/amazonAuth.ts`, `packages/common/src/utils/graphqlHelpers.ts`, `packages/seller-server/src/api/salesAndTraffic.ts`, `packages/vendor-server/src/api/vendorAnalytics.ts`.
- **Adoption**: the worker runs Data Kiosk queries as a job type with states (`requested → processing → done → downloaded`), stores the document reference per tenant and seller account, and the BFF reads only stored results. This gives a sales-and-traffic source for F-13 without per-request load.

### 1.7 Local MCP for SP-API (`use-cases/sp-api-dev-mcp/`)
- **Problem**: give developers' AI tools reference search, code generation, migration and review for SP-API.
- **Tools** (dev assistant, `sp-api-dev-assistant-mcp-server/src/tools/`): `sp_api_reference` (search docs with embeddings), `sp_api_explore_catalog`, `sp_api_execute` (live calls with signing), `sp_api_generate_code_sample`, `sp_api_migration_assistant` (Orders v0 to 2026-01-01), `sp_api_optimize` (review against best practices). A second server, a workflow builder, is described in the README; not reviewed in depth.
- **Infrastructure**: local Node process; a catalog loaded from Swagger/OpenAPI (`src/catalog/`); a local search index (`src/tools/search-tools/index-manager.ts`, `embedding-service.ts`).
- **Patterns worth taking**: (a) a **catalog-driven** client: operations and schemas are loaded from models, not hand-written (matches our `catalog/` and `tools/` generators); (b) a **migration guide** as data (`src/resources/orders-api-migration-data.json`); (c) an execute tool that signs requests (`src/auth/sp-api-auth.ts`).
- **Gotchas**: `sp_api_execute` can call live APIs with the user's credentials. Our MCP server (D50 b) must not expose an execute tool without approval; the sample does not gate it.
- **Files**: `use-cases/sp-api-dev-mcp/README.md`, `sp-api-dev-assistant-mcp-server/src/tools/execute-api-tool.ts`, `…/src/auth/sp-api-auth.ts`, `…/src/catalog/catalog-loader.ts`, `…/src/tools/migration-assistant-tools/orders-api-migration/code-analyzer.ts`, `…/src/resources/orders-api-migration-data.json`.
- **Adoption**: use the sample as a developer tool during P2 and P3 (search, codegen, migration checks). For the product's MCP server (D50 b), copy the design (catalog-driven tools, typed inputs), not the execute tool. Start Orders on `orders` 2026-01-01; the migration data file lists the field mapping we need.

---

## 2. SDK (`refs/amazon/selling-partner-api-sdk/`)

The root README gives a feature table: JavaScript has Basic API support, **RDT ❌**, Rate limiter ✅.

- **What exists in the JavaScript SDK** (`javascript/sdk/`): one folder per API version under `sdk/src/<api>_<version>/` (for example `orders_v0`, `listingsitems_v2021_08_01`, `datakiosk_v2023_11_15`, `tokens_v2021_03_01`), each with `ApiClient.js`, `api/`, `model/`. Helpers in `sdk/helper/`.
- **LWA**: `sdk/helper/LwaAuthClient.mjs` caches the access token and refreshes it 60 s before expiry; it accepts a refresh token **or** a scope (grantless) and rejects both at once. `sdk/src/orders_v0/ApiClient.js` lines ~27–110 show the same flow inside each client (refresh token, or `client_credentials` with a scope).
- **Rate limiter**: `sdk/helper/SuperagentRateLimiter.mjs` uses **Bottleneck** (`import Bottleneck from 'bottleneck'`) with a reservoir per operation: `reservoir` = burst, refreshed at the permit rate, `maxConcurrent` = burst. Per-operation values are in `sdk/helper/DefaultRateLimitMap.mjs` and `resources/rate-limits.yml` (format: rate, burst). Example: `TokensApi-createRestrictedDataToken` = rate 1, burst 10.
- **RDT**: the per-API `ApiClient.js` includes a `TokensApiClient` with `retrieveRestrictedDataToken(method, url)` and optional `dataElements` (`buyerInfo`, `shippingAddress`, `buyerTaxInformation`); see `sdk/src/orders_v0/ApiClient.js` lines ~113–180. **Conflict:** the README table says RDT is not supported in JavaScript. The code has it. Verify with a sandbox call before relying on either statement.
- **Generation**: `javascript/scripts/` and `scripts/generate-sdk.sh` (root `scripts/`) generate every SDK from `selling-partner-api-models`. `scripts/api-blacklist.txt` excludes superseded models (for example `catalogItems_2020-12-01`, `listingsItems_2020-09-01`, `shipping.json` v1); `scripts/api-overrides.txt` holds package-path overrides. Note `orders_v2026_01_01` and `fulfillmentoutbound_v2026_07_04` are present in the generated code, so the SDK is ahead of several samples.
- **User-Agent**: `ApiClient.js` sets `amazon-selling-partner-api-sdk/<version>/JavaScript`. Use our own agent string (identify the product, not the SDK).
- **Gotchas**: the SDK is generated and large; it does not know our tenancy model, and its clients take credentials per instance. Use it as a reference implementation, not as the data layer.

**Adoption (D3, TypeScript):** build our own thin client in `packages/amazon-sp` per API family, generated from `catalog/spapi/` (the committed catalogue). Reuse the **patterns**: a token cache with a 60 s margin; per-operation limiter with reservoir and burst from a rate table (we store `rate` and `burst` from `resources/rate-limits.yml` in the catalogue); RDT as a separate token call with `dataElements`, never stored in logs (D11). Verify the RDT conflict with a sandbox call during P2.

## 3. Agentic toolkit (`refs/amazon/selling-partner-agentic-toolkit/`)

The toolkit is a set of skills and commands for an AI assistant connected to Amazon's SP-API MCP gateway (`https://sellingpartner-ai.amazon.com/mcp`, per the README). Feature-level entries are in `docs/discovery/feature-ideas.md`; this section lists the **patterns**.

- **P-T1 Role-scoped connector.** The README says the assistant can only use tools the seller's Seller Central roles allow. Our equivalent is the D55 role model (Owner, Admin, Manager, Analyst, Viewer), enforced in our API, not in the model.
- **P-T2 Write = draft, preview, approve.** Every write in the skills is "draft for approval" and is first run in `VALIDATION_PREVIEW` (`listings_patchListingsItem`, see `listing-issues/SKILL.md` Step 5–6, `stockout-prevention/SKILL.md` Step 6). Our rule: no write without an approval record (D50).
- **P-T3 Generate → list → confirm, with async polling.** `fba-inbound-management/SKILL.md` ("The async pattern") sets the order: generate options, poll `getInboundOperationStatus` until done, list, confirm. Reuse for any SP-API operation that returns an operation ID.
- **P-T4 Discover before query.** `seller-analytics/SKILL.md` Step 2 says never guess metric names; discover first. Our analogue: read the operation and its schema from `catalog/` before generating a call.
- **P-T5 Gate before write.** `listing-compliance/SKILL.md` runs a read-only gate (`getListingsRestrictions`) before any listing write. Make it a pipeline step in our write path.
- **P-T6 Explicit context on every call.** `entityId` (merchant token) and `marketplaceIds` are passed on every call and asked once per session (see `seller-analytics`, `stockout-prevention`, `listing-compliance` tool sections). For us: tenant and seller-account scope on every row and query (CLAUDE.md tenancy rule).
- **P-T7 Reports versus order metrics.** `stockout-prevention/references/reports-vs-ordermetrics.md` chooses the synchronous `sales` v1 `getOrderMetrics` over the asynchronous Reports API for short windows. Use the same rule in the worker design (sync for small, report job for large).
- **P-T8 Evals per skill.** Each skill has `eval/evals.json`. Use the same format for our AI assistant (D50 a): test cases with expected tool calls and refusals (for example "do not give pricing advice").
- **P-T9 PII and summaries.** `support-case-helper` redacts personal data before it writes a summary; the README states what data is sent. Reuse the PII rule in our assistant prompts (D11).

**Gotchas**:
- Several tool names used by the skills are connector tools, not public SP-API operations. Found in the skills and **not** in `refs/amazon/selling-partner-api-models/models/` or `catalog/spapi/`: `analytics_getMetricMetadata`, `analytics_getMetricData` (seller-analytics); `finances_monthEndClosing` (finance-month-end-closer); `sellerAssistant_sellerAssistantCreate` and `sellerAssistant_sellerAssistantGet` (listing-compliance, via `call_destructive_tool`). Do not build on them. Replace with public operations (see feature-ideas F-15, F-22, F-25).
- The toolkit's SP-API tool names (`fbaInbound_*`, `listings_*`, `sales_*`, `fbaInventory_*`) map to public operations; the mapping for each is in `feature-ideas.md` section D.
- Scope: `fba-inbound-management` says sellers only (vendors use another flow).

## 4. Postman collections (`refs/amazon/selling-partner-api-postman/Postman Collections/`)

Eight collections (request counts from a read-only parse of each JSON):

| Collection | Requests | Useful for |
|---|---|---|
| `getting-started-with-sp-api-for-sellers.json` | 147 | LWA access token and grantless token (folders 1.1, 1.2); Sellers, Catalog Items, Listings (PTD, Items, Restrictions), Feeds, Reports |
| `getting-started-with-sp-api-for-vendors.json` | 75 | the vendor equivalent; use for D5 vendor checks |
| `product-and-listing-management.json` | 86 | Listings Items create, update, offers, B2B/B2C offers, close, discounts; bulk JSON_LISTINGS_FEED |
| `fba-shipping-and-inventory.json` | 150 | FBA Inbound plans (pallets, small parcel), FBA Inventory v1, reports and Smart Stock Optimization, AWD inbound |
| `fbm-shipping-and-inventory.json` | 20 | multi-location inventory, buy-shipping flow, External Fulfillment (Easy Ship) |
| `orders-processing-and-management.json` | 24 | the Orders v2026-01-01 migration recipes (consolidation, retrieval, migration patterns) |
| `pricing-management.json` | 10 | Pricing API recipes; includes "Automate Pricing Rules" (not in our product scope yet, see feature-ideas P-03) |
| `reporting-and-analytics.json` | 17 | Data Kiosk flow, retail and brand analytics, report operations |

- **How to use them**: manual checks against a **sandbox** or a D30 test account only (D30 is open; default is sandbox). The collections hold variables for credentials; set them in a local environment file, never in the repository.
- **Gotchas**: the collections are Amazon-maintained and may lag the models; compare each request's path and version with the catalog before copying.

## 5. Not reviewed or only skimmed

- `refs/amazon/selling-partner-api-samples/code-recipes/` and `local-ai-sandbox/`: names only. The brief named `labs/`, which does not exist at the sample root; the sample tree has `code-recipes/` instead.
- Java code in `use-cases/notifications/code/`: read by file path, not in full.
- `use-cases/listings/` and `use-cases/aplus-content-manager/` client components: read by name and README, not line by line.
- The `*_CN` and `*_JP` READMEs of notifications: not read.
- The Amazon Ads references (`refs/amazon-ads/`) were used only for the Marketing Stream and budget-usage facts in `feature-ideas.md`.

## 6. Source file index (quick reference)

| Pattern | Primary files |
|---|---|
| Website authorization | `refs/amazon/selling-partner-api-samples/use-cases/website-authorization/code/python/application.py`, `…/utils/api_utils.py` |
| Authorization lifecycle | `…/use-cases/auth-lifecycle-management/lambda/credentialRotation.js`, `…/reminderManager.js`, `…/statusManager.js` |
| Notifications | `…/use-cases/notifications/app/config/notification-type-definition.json`, `…/app/step-functions/order-change-step-functions-workflow-definition.json` |
| Listings forms | `…/use-cases/listings/app/components/listing-attributes-editor-component.tsx` |
| A+ mock mode | `…/use-cases/aplus-content-manager/server/mock/` |
| Data Kiosk lifecycle | `…/use-cases/amazon-data-kiosk-mcp-server/packages/common/src/api/baseApi.ts` |
| Catalog-driven MCP | `…/use-cases/sp-api-dev-mcp/sp-api-dev-assistant-mcp-server/src/catalog/catalog-loader.ts` |
| SDK token cache and limiter | `refs/amazon/selling-partner-api-sdk/javascript/sdk/helper/LwaAuthClient.mjs`, `…/SuperagentRateLimiter.mjs`, `…/DefaultRateLimitMap.mjs`, `refs/amazon/selling-partner-api-sdk/resources/rate-limits.yml` |
| SDK RDT | `refs/amazon/selling-partner-api-sdk/javascript/sdk/src/orders_v0/ApiClient.js` |
| Toolkit async pattern | `refs/amazon/selling-partner-agentic-toolkit/skills/fba-inbound-management/SKILL.md` |
| Toolkit write gate | `refs/amazon/selling-partner-agentic-toolkit/skills/listing-issues/SKILL.md`, `…/listing-compliance/SKILL.md` |
| Toolkit reports choice | `refs/amazon/selling-partner-agentic-toolkit/skills/stockout-prevention/references/reports-vs-ordermetrics.md` |
</content>
