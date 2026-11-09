# Amazon Ads MCP Server and the SP-API counterpart

Generated for task P1-ADS from `catalog/ads/mcp-tools.json` (builder `tools/catalog/ads.mjs`; sources
`refs/amazon-ads/specs/mcp/*.json` - 18 files, one per tool group - and `refs/amazon-ads/docs/mcp/*`,
`docs/knowledge-hub/hands-on-workshops/amazon-ads-mcp-server/*`).
Decision applied: **D50 c** - seller-hub first becomes an MCP *client* of Amazon's servers (Ads + SP-API) after
the MVP, with every write approved by the user; its own MCP server comes later. D52: Amazon is called with each
seller's own LWA credentials. The server is **open beta**: tool names, groups and behaviour can change; treat
`mcp-tools.json` as a snapshot of the 2026-10-14 mirror.

**Important limit of this catalogue.** Amazon publishes tool names, descriptions and input schemas, but **no
table "tool -> API operation"**. The `backingOperations` column is derived by matching names and descriptions
against the OpenAPI catalogue; each link is marked `direct` (same name / same description) or `inferred`
(purpose match, e.g. `update_campaign_budget` -> `UpdateCampaign`). The builder fails if a referenced
operationId does not exist, but it cannot prove the server really calls it. Verify with a live call.

## 1. What the server is

- A hosted MCP server that "translates Amazon Ads APIs into two MCP primitives": **tools** (functions with
  description, input schema and result) and **skills** (pre-defined prompts that guide a client through a workflow).
  It is run by Amazon; Amazon Ads does not own the LLM or the client (Claude, ChatGPT, Kiro, Bedrock, AgentCore,
  Amazon Quick are named as compatible).
- **Standard tools**: deterministic actions (update a budget; create a whole SP campaign = several API calls
  in one tool). **Expert tools**: inference behind the tool; today only `amc_sql_generator` (natural language ->
  validated AMC SQL), **closed beta, not in the spec files** (so not in `mcp-tools.json`).
- Transport: streamable HTTP. Status: **open beta** (the specs live under "Betas > MCP Tools (beta)").

## 2. Endpoints, auth, headers

| Region | Regular (`/mcp`) | Lite (`/mcp/lite`) |
|---|---|---|
| NA | `https://advertising-ai.amazon.com/mcp` | `https://advertising-ai.amazon.com/mcp/lite` |
| EU | `https://advertising-ai-eu.amazon.com/mcp` | `https://advertising-ai-eu.amazon.com/mcp/lite` |
| FE | `https://advertising-ai-fe.amazon.com/mcp` | `https://advertising-ai-fe.amazon.com/mcp/lite` |

(URLs are not region-agnostic; use the region of the account.)

- **Regular**: one MCP tool per operation, i.e. all 110 tools registered; large context footprint.
  **Lite**: same capability, exposed as three meta-tools - `amazon_ads_mcp-search_tools` (natural-language
  search, returns the matching tools plus the rest of each matched namespace), `amazon_ads_mcp-describe_tools`
  (full input schema), `amazon_ads_mcp-invoke_tool` - the agent loops search -> describe -> invoke. Best for
  small-context models. Tool full names in this catalogue are `<group>-<tool>` (the form used in `disabledTools`
  examples: `campaign_management-delete_campaign`).
- **Authorization (two options).**
  1. *Token mode*: you complete the normal Ads API LWA grant, then send `Authorization: Bearer Atza|...` and
     `Amazon-Ads-ClientId: <LWA client id>` (plus `Accept: application/json, text/event-stream`). You refresh the
     token yourself (the workshop agent exchanges the refresh token at `https://api.amazon.com/auth/o2/token`
     then connects).
  2. *OAuth 2.1* (browser flow handled by the MCP client): **public client** (client id only; access token expires
     in 1 h, popup re-auth) or **private client** (client id + secret; refresh token kept in the OS keychain /
     credentials file). The LWA security profile must list the client's callback URL as an Allowed Return URL
     (Kiro `http://localhost:<port>/oauth/callback`, Claude Code `http://localhost:<port>/callback`, Claude Desktop
     `https://claude.ai/api/mcp/auth_callback`, ChatGPT `https://chatgpt.com/connector/oauth/<APP_ID>`, Amazon Quick
     `https://quick.aws.com/sn/oauthcallback`). A mismatch fails with redirect-URI error.
- **Account context.**
  - *Dynamic* (default): the model is asked for account ids and passes them **in the request body**
    (`profileId`, `managerAccountId`, `advertiserAccountId` - the last may be a DSP advertiser, a global account
    or an AMC instance depending on the tool). Discover accounts with `account_management-query_advertiser_account`.
    For multi-marketplace clients: choose the marketplace first, then the profile.
  - *Fixed*: send `Amazon-Ads-AI-Account-Selection-Mode: FIXED` plus at least one of
    `Amazon-Advertising-API-Scope` (profile), `Amazon-Ads-AccountID`, `Amazon-Ads-Manager-AccountID`; the model is
    not asked. All fixed headers must belong to **one** account.
  - **seller-hub choice (proposal, not a decision):** use **fixed** context per tenant seller-account: the tenant
    scope is then enforced by headers set by our code, not by the model - this fits the tenancy rule.
- Lite uses the same modes. Tool filtering is documented only as a *client* feature (Kiro `disabledTools`); an own client
  should filter by allow-list in code. Amazon's own advice: filtering tools cuts context tokens and improves quality.

## 3. Skills (workflow and capability prompts)

12 skills in `docs/mcp/skills/skills-library`: account-context-identifiers, advertiser-accounts,
advertiser-product-group-eligibility, amc-workflows, create-dsp-pb-campaign, manager-accounts, product-eligibility,
program-eligibility, reporting, terms-token, user-invitations, user-permissions. Two kinds: **workflow skills**
(multi-step orchestration with sequencing and error recovery, e.g. `ads-reporting`: create report -> poll ->
retrieve; `dsp-campaign-analysis`) and **capability skills** (how to call a tool). They are triggered by clients
that understand Anthropic skill definitions (e.g. Claude Code); availability varies by client. Tool inputs have an
optional `skill:{skillName,version}` field ("populate only when a skill definition provides it").

## 4. Tool groups and tools

110 tools in 18 groups. **R** = read-only, **W** = changes data; side effect: `mutates`, `destructive` (delete /
disassociate), `starts-job` (async report or AMC query; no entity changes). "Ads API operation" is the backing
operation from `domain-map.json` terms: *v1* = default generation, *v0* = a named exception (D53).

### 4.1 Find the account and its context

**`ads_accounts`** (3 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `ads_accounts-create_ads_account` | W | mutates | Create a new advertising account tied to a specific Amazon vendor, seller or author, or to a business who does not sell on Amazon. | `RegisterAdsAccount` (v0 exception, direct) |
| `ads_accounts-get_ads_account` | R | none | Request attributes of a given advertising account. | `GetAccount` (v0 exception, direct) |
| `ads_accounts-list_ads_accounts` | R | none | List all advertising accounts for the user associated with the access token. | `ListAdsAccounts` (v0 exception, direct) |

**`account_management`** (7 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `account_management-create_advertiser_account` | W | mutates | Create a new advertiser account (Global Account). Returns an advertiserAccountId in the format amzn1.ads-account.g.*. The account starts in REGISTRATI | `CreateAdvertiserAccount` (v1, direct) |
| `account_management-query_account_link` | R | none | Query account links. Manager Account users can retrieve details about all accounts linked to their Manager Accounts. Additionally, advertiser account  | `QueryAccountLink` (v1, direct) |
| `account_management-query_advertiser_account` | R | none | List or query advertiser accounts the user has access to. Without filters, returns global accounts. Use `isGlobalAccountFilter: { include: [true] }` f | `QueryAdvertiserAccount` (v1, direct) |
| `account_management-update_account_currency` | W | mutates | Update the currency code of an advertiser account. | `UpdateAdvertiserAccount` (v1, inferred) |
| `account_management-update_account_name` | W | mutates | Update the display name of an advertiser account. | `UpdateAdvertiserAccount` (v1, inferred) |
| `account_management-update_account_timezone` | W | mutates | Update the timezone of an advertiser account. | `UpdateAdvertiserAccount` (v1, inferred) |
| `account_management-update_advertiser_account` | W | mutates | Update an advertiser account. | `UpdateAdvertiserAccount` (v1, direct) |

**`manager_accounts`** (4 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `manager_accounts-associate_accounts` | W | mutates | Link Amazon Advertising accounts or advertisers with a Manager Account. | `LinkAdvertisingAccountsToManagerAccountPublicAPI` (v0 exception, direct) |
| `manager_accounts-create_manager_account` | W | mutates | Creates a new Amazon Advertising Manager account. | `createManagerAccount` (v0 exception, direct) |
| `manager_accounts-disassociate_accounts` | W | destructive | Unlink Amazon Advertising accounts or advertisers from a Manager Account. | `UnlinkAdvertisingAccountsToManagerAccountPublicAPI` (v0 exception, direct) |
| `manager_accounts-get_manager_accounts` | R | none | Returns all manager accounts that a user has access to, along with metadata for the Amazon Ads accounts linked to each manager account. NOTE: A maximu | `getManagerAccountsForUser` (v0 exception, direct) |

**`eligibility`** (2 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `eligibility-product_list` | R | none | Gets advertising eligibility status for a list of products. Returns eligibility objects for products sold by the merchant associated with the profile. | `productEligibility` (v0 exception, direct) |
| `eligibility-programs` | R | none | Checks advertiser eligibility for ad programs (Sponsored Products, Sponsored Brands, Sponsored Display, Stores, etc). | `ProgramEligibility` (v0 exception, direct) |

**`advertiser_product_group_eligibility`** (2 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `advertiser_product_group_eligibility-create` | W | mutates | Create request for specific advertiser product group eligibility (e.g., ADSP). | `CreateAdvertiserProductGroupEligibility` (v1, direct) |
| `advertiser_product_group_eligibility-query` | R | none | Query requests for advertiser product group eligibility based on advertiser account ID. | `QueryAdvertiserProductGroupEligibility` (v1, direct) |

**`terms_token`** (2 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `terms_token-create_terms_token` | W | mutates | Create a new UUID terms token for the customer to accept advertising terms. | `CreateTermsToken` (v0 exception, direct) |
| `terms_token-get_terms_token` | R | none | Get the terms token status for the customer. | `GetTermsToken` (v0 exception, direct) |

### 4.2 Build and manage campaigns

**`campaign_management`** (32 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `campaign_management-add_country_campaign` | W | mutates | Add countries to existing Amazon Ads Sponsored Products Manual campaigns with country-specific budget caps. Enables advertisers to expand campaign rea | `SPGlobalUpdateCampaign` (v1, inferred) |
| `campaign_management-check_product_eligibility` | R | none | Checks whether products are eligible for a specific ad product type. Returns eligibility status per product with detail reasons and help URLs for reso | `productEligibility` (v0 exception, inferred) |
| `campaign_management-create_ad` | W | mutates | Create Amazon Ads. Create individual ads within ad groups across all Amazon advertising products. | `CreateAd` (v1, direct) |
| `campaign_management-create_ad_association` | W | mutates | Create Amazon Ads Ad Associations. Associate ads with ad groups across Amazon advertising products. | `CreateAdAssociation` (v1, direct) |
| `campaign_management-create_ad_group` | W | mutates | Create Amazon Ads Ad Groups. Create ad groups for organizing ads within campaigns across all Amazon advertising products. | `CreateAdGroup` (v1, direct) |
| `campaign_management-create_bid_adjustment_rule` | W | mutates | Creates a bid adjustment rule and associates it with a DSP ad group. A bid adjustment rule contains dimension-based expressions with conditions and ac | `CreateBidAdjustmentRule` (v0 exception, direct) |
| `campaign_management-create_campaign` | W | mutates | Create an Amazon Ads Campaign. This tools supports Sponsored Products, Sponsored Brands and ADSP. | `CreateCampaign` (v1, direct) |
| `campaign_management-create_portfolio` | W | mutates | Create an Amazon Ads Portfolios. | `CreatePortfolios` (v0 exception, inferred) |
| `campaign_management-create_singleshot_portfolio` | W | mutates | Creates an Amazon Ads Portfolio and associates it with a campaign in a single operation. | `CreatePortfolios` (v0 exception, inferred), `UpdateCampaign` (v1, inferred) |
| `campaign_management-create_singleshot_sp_campaign` | W | mutates | Creates a complete Sponsored Products campaign (campaign + ad group + ads) across multiple marketplaces in a single operation. Supports both AUTO targ | `SPGlobalCreateCampaign` (v1, inferred), `SPGlobalCreateAdGroup` (v1, inferred), `SPGlobalCreateAd` (v1, inferred), `SPGlobalCreateTarget` (v1, inferred) |
| `campaign_management-create_target` | W | mutates | Create Amazon Ads Targets. Create targeting criteria including keywords, products, categories, and audiences. | `CreateTarget` (v1, direct) |
| `campaign_management-delete_ad` | W | destructive | Delete Amazon Ads. Remove individual ads from ad groups. | `DeleteAd` (v1, direct) |
| `campaign_management-delete_ad_association` | W | destructive | Delete Amazon Ads Ad Associations. Remove associations between ads and ad groups. | `DeleteAdAssociation` (v1, direct) |
| `campaign_management-delete_ad_group` | W | destructive | Delete Amazon Ads Ad Groups. Remove ad groups and their associated ads from campaigns. | `DeleteAdGroup` (v1, direct) |
| `campaign_management-delete_campaign` | W | destructive | Delete Amazon Ads Campaigns. Remove campaigns and all associated ad groups, ads, and targets. | `DeleteCampaign` (v1, direct) |
| `campaign_management-delete_target` | W | destructive | Delete Amazon Ads Targets. Remove targeting criteria from ad groups. | `DeleteTarget` (v1, direct) |
| `campaign_management-dsp_create_conversion_tracking_products` | W | mutates | Adds products to a DSP campaign to enable product-related conversion metrics. Newly added products will be appended to an existing list. Products may  | `DspPostProductConversionTrackingV1` (v0 exception, direct) |
| `campaign_management-query_ad` | R | none | Query Amazon Ads with advanced filtering capabilities. Search and filter individual ads across all Amazon advertising products. | `QueryAd` (v1, direct) |
| `campaign_management-query_ad_association` | R | none | Query Amazon Ads Ad Associations with advanced filtering capabilities. Search for associations between ads and ad groups. | `QueryAdAssociation` (v1, direct) |
| `campaign_management-query_ad_group` | R | none | Query Amazon Ads Ad Groups with advanced filtering capabilities. Search and filter ad groups across all Amazon advertising products. | `QueryAdGroup` (v1, direct) |
| `campaign_management-query_campaign` | R | none | Query Amazon Ads Campaigns with advanced filtering capabilities. Supports Sponsored Products, Sponsored Brands, Sponsored Display, Sponsored Televisio | `QueryCampaign` (v1, direct) |
| `campaign_management-query_portfolio` | R | none | Query an Amazon Ads Portfolios. | `ListPortfolios` (v0 exception, inferred) |
| `campaign_management-query_target` | R | none | Query Amazon Ads Targets with advanced filtering capabilities. Search for keywords, products, categories, audiences, and other targeting options. | `QueryTarget` (v1, direct) |
| `campaign_management-update_ad` | W | mutates | Update Amazon Ads. Modify individual ad settings including name and state. | `UpdateAd` (v1, direct) |
| `campaign_management-update_ad_association` | W | mutates | Update Amazon Ads Ad Associations. Modify associations between ads and ad groups. | `UpdateAdAssociation` (v1, direct) |
| `campaign_management-update_ad_group` | W | mutates | Update Amazon Ads Ad Groups. Modify ad group settings including name, state, and default bid. | `UpdateAdGroup` (v1, direct) |
| `campaign_management-update_campaign` | W | mutates | Update Amazon Ads Campaigns. Modify campaign settings including name, state, budget, and targeting options. | `UpdateCampaign` (v1, direct) |
| `campaign_management-update_campaign_budget` | W | mutates | Update Campaign Budget. | `UpdateCampaign` (v1, inferred) |
| `campaign_management-update_campaign_state` | W | mutates | Update Campaign State. | `UpdateCampaign` (v1, inferred) |
| `campaign_management-update_portfolio` | W | mutates | Update an Amazon Ads Portfolios. | `UpdatePortfolios` (v0 exception, inferred) |
| `campaign_management-update_target` | W | mutates | Update Amazon Ads Targets. Modify targeting criteria including bids, state, and targeting parameters. | `UpdateTarget` (v1, direct) |
| `campaign_management-update_target_bid` | W | mutates | Update Target Bid. | `UpdateTarget` (v1, inferred) |

### 4.3 Report on performance

**`reporting`** (6 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `reporting-create_campaign_report` | W | starts-job | Create a Campaign report. | `AdsApiv1CreateReport` (v1, inferred) |
| `reporting-create_inventory_report` | W | starts-job | Create an Inventory report. | `AdsApiv1CreateReport` (v1, inferred) |
| `reporting-create_product_report` | W | starts-job | Create a Product report. | `AdsApiv1CreateReport` (v1, inferred) |
| `reporting-create_report` | W | starts-job | Create a report. | `AdsApiv1CreateReport` (v1, direct) |
| `reporting-delete_report` | W | destructive | Delete a report. | `AdsApiv1DeleteReport` (v1, direct) |
| `reporting-retrieve_report` | R | none | Retrieve a report. | `AdsApiv1RetrieveReport` (v1, direct) |

**`amc`** (10 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `amc-create_workflow` | W | mutates | Creates a new Amazon Marketing Cloud (AMC) workflow that can be used to generate reports. | `createWorkflow` (v0 exception, direct) |
| `amc-delete_workflow` | W | destructive | Deletes the specified Amazon Marketing Cloud (AMC) workflow by id. Workflows are defined as a set of operations that take previously defined data sour | `deleteWorkflow` (v0 exception, direct) |
| `amc-execute_query` | W | starts-job | Executes an ad-hoc SQL query on Amazon Marketing Cloud (AMC) without requiring a pre-existing workflow. | `createWorkflowExecution` (v0 exception, inferred) |
| `amc-execute_workflow` | W | starts-job | Creates a new, ad-hoc execution of an existing Amazon Marketing Cloud (AMC) workflow | `createWorkflowExecution` (v0 exception, direct) |
| `amc-get_data_source` | R | none | Gets the requested Amazon Marketing Cloud (AMC) data source by id. Data sources can be used as input for reporting workflows. Each data source has a f | `getDataSource` (v0 exception, direct) |
| `amc-get_data_sources` | R | none | Returns a list of Amazon Marketing Cloud (AMC) data sources for a given instance and AMC Account | `listDataSources` (v0 exception, direct) |
| `amc-get_workflow` | R | none | Gets the requested Amazon Marketing Cloud (AMC) workflow by id. Workflows are defined as a set of operations that take previously defined data sources | `getWorkflow` (v0 exception, direct) |
| `amc-get_workflow_execution_download_url` | R | none | Retrieves pre-signed url for downloading Amazon Marketing Cloud (AMC) workflow execution results from S3 | `getWorkflowExecutionDownloadUrls` (v0 exception, direct) |
| `amc-get_workflow_execution_status` | R | none | Gets status information about the requested Amazon Marketing Cloud (AMC) workflow execution | `getWorkflowExecution` (v0 exception, direct) |
| `amc-get_workflows` | R | none | Returns a list of Amazon Marketing Cloud (AMC) workflows for the given instance and AMC Account | `listWorkflows` (v0 exception, direct) |

### 4.4 Money: billing and promotions

**`billing`** (4 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `billing-list_billing_profile_usages` | R | none | Lists the billing profiles linked to each country of a global ads account. Can filter by advertiser and optionally expand billing profile details. | `GetBillingProfileUsages` (v0 exception, direct) |
| `billing-list_invoice_summaries` | R | none | Lists billing invoice summaries in a global ads account. Supports filtering by date range, country, status, payment method, invoice number, and reserv | `GetBillingInvoiceSummaries` (v0 exception, direct) |
| `billing-list_invoices` | R | none | This tool allows retrieving invoices for Amazon advertising accounts. The tool fetches invoices across an advertiser account, allowing an account to a | `getAdvertiserInvoices` (v0 exception, inferred) |
| `billing-query_billing_notifications` | R | none | This tool allows retrieving comprehensive billing notifications for Amazon advertising accounts. The tool provides a comprehensive set of billing-rela | `bulkGetBillingNotifications` (v0 exception, direct) |

**`promotions`** (3 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `promotions-query_promotion_offers` | R | none | Query and list promotion offers available for an advertiser account. Returns promotion details including status, marketplace, promotion campaign info, | `QueryPromotionOffer` (v1, direct) |
| `promotions-query_promotion_rewards` | R | none | Query and list promotion rewards for an advertiser account. A promotion reward represents financial credit that has been granted to an advertiser and  | `QueryPromotionReward` (v1, direct) |
| `promotions-redeem_promotion_code` | W | mutates | Redeem a promotion code for an advertiser account. Creates a promotion code redemption that activates a promotional offer for the specified marketplac | `CreatePromotionCodeRedemption` (v1, direct) |

### 4.5 People and access

**`users`** (1 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `users-list_users` | R | none | List users with access to an advertising account. Pass accessRequestedAccount in the body to specify the account. Returns userId and masked email for  | `ListUsers` (v0 exception, direct) |

**`user_invitation`** (2 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `user_invitation-get` | R | none | Get details of a specific user invitation by its invitationId (e.g. { pathParameters: { invitationId: "<id>" } }). Use user_invitations-list first to  | `GetUserInvitation` (v0 exception, direct) |
| `user_invitation-redeem` | W | mutates | Redeem a user invitation to gain access to an advertising account. | `RedeemUserInvitation` (v0 exception, direct) |

**`user_invitations`** (3 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `user_invitations-create` | W | mutates | Create user invitations for an advertising account. Pass accessRequestedAccount in the body to specify the account. Each invitation needs a user (emai | `CreateUserInvitations` (v0 exception, direct) |
| `user_invitations-list` | R | none | List all user invitations for an advertising account. Pass accessRequestedAccount in the body to specify the account. | `ListUserInvitations` (v0 exception, direct) |
| `user_invitations-update` | W | mutates | Update user invitations — revoke or resend. Pass accessRequestedAccount in the body to specify the account. Each update needs invitationId (from user_ | `UpdateUserInvitations` (v0 exception, direct) |

**`user_permissions`** (3 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `user_permissions-delete_user_permissions` | W | destructive | Delete user permissions from an advertising account. Pass accessRequestedAccount in the body to specify the account. | `DeleteUserPermissions` (v0 exception, direct) |
| `user_permissions-list_user_permissions` | R | none | Query user permissions for a specific user on an advertising account. Pass accessRequestedAccount in the body to specify the account. | `QueryUserPermissions` (v0 exception, direct) |
| `user_permissions-update_user_permissions` | W | mutates | Update user permissions for an advertising account. Pass accessRequestedAccount in the body to specify the account. First call user_permissions-list_u | `UpdateUserPermissions` (v0 exception, direct) |

**`user_roles`** (1 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `user_roles-list_user_roles` | R | none | Query roles for a specific user on an advertising account (e.g. { body: { accessRequestedAccount: { advertiserAccountId: "<id>" }, userId: "<id>" } }) | `QueryUserRoles` (v0 exception, direct) |

### 4.6 Test accounts

**`test_accounts`** (2 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `test_accounts-create_test_account` | W | mutates | Submit an async test account creation request (e.g. { body: { accountType: "VENDOR", countryCode: "US" } }). Limit 1 per account type per marketplace. | `createAccount` (v0 exception, direct) |
| `test_accounts-get_test_accounts` | R | none | Get test account creation status and details. Pass requestId from a previous create call to check that request, or omit to list all test accounts for  | `GetAccountInformation` (v0 exception, direct) |

### 4.7 Brand content (Amazon Live)

**`amazon_live`** (23 tools)

| Tool | R/W | Side effect | What it does | Ads API operation (gen, confidence) |
|---|---|---|---|---|
| `amazon_live-create_broadcast` | W | mutates | Create a new Amazon Live broadcast scheduled on a specific channel. Required: title, channelId. Optional: scheduledStartDateTime, videoSource, streami | none in published specs |
| `amazon_live-create_broadcast_media_asset` | W | mutates | Create a media asset (thumbnail, sponsored image, HLS stream, MP4 video, or video clip) associated with an Amazon Live broadcast. Required: broadcastI | none in published specs |
| `amazon_live-create_carousel_item` | W | mutates | Create carousel items (products or landing pages) to be shown during an Amazon Live broadcast. Supports bulk create up to 45 items per call. Required  | none in published specs |
| `amazon_live-create_channel` | W | mutates | Create a new Amazon Live channel for a brand. A channel is the persistent home for a brand's livestreams. Required: title, brandId. Optional: brandAlt | none in published specs |
| `amazon_live-create_promo_code` | W | mutates | Associate a promotion code with an Amazon Live broadcast. The promo code string must already exist in the Amazon promotions system. Required: broadcas | none in published specs |
| `amazon_live-delete_broadcast` | W | destructive | Delete an Amazon Live broadcast by its broadcastId. This permanently removes the broadcast and cannot be undone. Only broadcasts that are not currentl | none in published specs |
| `amazon_live-list_broadcast_media_assets` | R | none | List media assets (thumbnails, sponsored images, HLS streams, MP4 videos, video clips) associated with an Amazon Live broadcast. Returns asset type, U | none in published specs |
| `amazon_live-list_broadcasts` | R | none | List all Amazon Live broadcasts for a specific channel. Returns paginated broadcast details filtered by channelId. Use this when you know the channel  | none in published specs |
| `amazon_live-list_carousel_items` | R | none | List carousel items (products or landing pages) shown during an Amazon Live broadcast. Returns display order, activation status, carousel type (PRODUC | none in published specs |
| `amazon_live-list_channels` | R | none | List all Amazon Live channels for the current advertiser account. No filters required — returns all channels the advertiser has access to, including c | none in published specs |
| `amazon_live-list_livestream_details` | R | none | List livestream technical details (streaming infrastructure) for an Amazon Live channel. Returns ingest endpoint, ingest type (WEBRTC/RTMPS/SRT), prev | none in published specs |
| `amazon_live-list_promo_codes` | R | none | List promotion codes associated with an Amazon Live broadcast. Returns promo code details including the code string, discount percentage, start/end ti | none in published specs |
| `amazon_live-query_broadcasts` | R | none | Query Amazon Live broadcasts for a brand. Supports filtering by brand ID, brand alternate IDs, creation date range, and broadcast status (UNSCHEDULED, | none in published specs |
| `amazon_live-query_channels` | R | none | Query Amazon Live channels for a brand. Returns channel details including title, follower count, state (OFFLINE/PREVIEWING/LIVE), feature flags, and a | none in published specs |
| `amazon_live-query_promo_code` | R | none | Validate promotion codes by querying Amazon's promotions system. Required: broadcastId filter and promoCode filter (up to 10 codes). Returns validated | none in published specs |
| `amazon_live-retrieve_broadcast` | R | none | Retrieve a specific Amazon Live broadcast by its broadcastId. Returns full broadcast details including status, scheduling, chat details, moderation ev | none in published specs |
| `amazon_live-retrieve_channel` | R | none | Retrieve a specific Amazon Live channel by its channelId. Returns full channel details including title, follower count, logo URL, state, feature flags | none in published specs |
| `amazon_live-retrieve_promo_code` | R | none | Retrieve a specific promotion code by its id. Returns full promo code details including the code string, discount percentage, validity window, and ass | none in published specs |
| `amazon_live-update_broadcast` | W | mutates | Update an existing Amazon Live broadcast. Required: broadcastId. Only provided fields are modified; others remain unchanged. CAUTION: broadcastStatus  | none in published specs |
| `amazon_live-update_broadcast_media_asset` | W | mutates | Update an existing broadcast media asset's metadata or content. Required: mediaAssetId. Only provided fields are modified. mediaAssetId, url, format,  | none in published specs |
| `amazon_live-update_carousel_item` | W | mutates | Update existing carousel items (products or landing pages) in an Amazon Live broadcast. Supports bulk update up to 45 items per call. Required per ite | none in published specs |
| `amazon_live-update_channel` | W | mutates | Update an existing Amazon Live channel. Required: channelId. Only provided fields are modified; others remain unchanged. channelState, followers, feat | none in published specs |
| `amazon_live-update_promo_code` | W | mutates | Update an existing promo code association on an Amazon Live broadcast. Required: id. Only the associated promo code string and broadcast can be update | none in published specs |

## 5. What the MCP covers and what it does not

Compared with `ads-domains.md`:

| Area | MCP | Ads API | Where seller-hub should call |
|---|---|---|---|
| Campaign / ad group / ad / target / association CRUD | `campaign_management` (query/create/update/delete, all ad products) | v1 contracts | API for bulk and scheduled work; MCP for assistant actions |
| One-shot SP campaign creation (campaign + ad group + ads, multi-marketplace) | `create_singleshot_sp_campaign`, `add_country_campaign` | SP Global contracts | MCP convenience; the API can do it step by step |
| Portfolios | `create/update/query_portfolio`, `create_singleshot_portfolio` | **v0 only** (`EX-PORTFOLIOS`) | MCP covers a v0 exception - useful, but not API-verified (inferred) |
| Ad-hoc reports | `reporting` (create / retrieve / delete; campaign, inventory, product helpers) | v1 Reports | MCP for the assistant; **API + Stream v2 for ingestion** |
| Account registration and access | `account_management`, `ads_accounts`, `manager_accounts`, `terms_token`, `users`, `user_*` | v1 accounts + v0 users | either; these are rare, human-in-the-loop actions |
| Eligibility | `eligibility`, `check_product_eligibility`, `advertiser_product_group_eligibility` | v0 / beta | MCP is easiest |
| Billing, promotions | `billing` (4 read tools), `promotions` | v0 `EX-BILLING`, v1 beta | read-only billing views through MCP are acceptable |
| AMC | `amc` (10) + expert `amc_sql_generator` | AMC APIs (out of MVP) | later |
| Test accounts | `test_accounts` | v0 | MCP for setup |
| **Not in MCP** | Marketing Stream subscriptions, Exports, Change history, Budget rules / usage / recommendations, optimization rules, SP/SB/SD recommendations, bid recommendations, Profiles, creative asset library, brand analytics | v0 exceptions + v1 stream | **API only**; no agent shortcut exists |
| **Only in MCP** | Amazon Live (23 tools: channels, broadcasts, carousel items, promo codes, media assets) | no operation in the published Ads specs | MCP only; check access; out of the MVP |

Rule of thumb (for D50): **API directly** for anything scheduled, bulk, tenant-wide or latency-sensitive
(ingestion, sync, automation rules); **MCP** for interactive assistant turns where an LLM chooses the action
and the user approves writes. Do not route ingestion through an LLM-facing server: it exposes no stream or
export, has no documented rate guarantees, and every call costs model tokens. Writes through MCP need the same
207-style partial-failure handling the API has (tools wrap the same batch operations; the result shape is the
tool's, **verify live**).

## 6. The workshop's reference architecture (summary)

"Amazon Ads MCP Server" hands-on workshop, 8 modules (`docs/knowledge-hub/hands-on-workshops/amazon-ads-mcp-server`):

1. Concepts: MCP tools / resources / prompts; **Amazon Bedrock AgentCore** runtime; two deployment protocols -
   **MCP** (servers, answer `tools/list` / `tools/call`) and **A2A** (agents, take natural language).
2. Modules 3-4: build a FastMCP server (a Bedrock Knowledge Base query tool) with **streamable-http,
   `stateless_http`** (each request independent, horizontally scalable behind AgentCore), test with MCP
   Inspector, deploy with the AgentCore toolkit.
3. Modules 5-6: a **LangGraph agent** (Claude on Bedrock) that discovers tools on the MCP server and orchestrates
   them; deployed as an A2A runtime.
4. Modules 7-8: the agent connects to the **Amazon Ads MCP Server** as a second MCP server: exchange the refresh
   token for an access token, connect with `Authorization` + `Amazon-Ads-ClientId`, discover tools, **filter the
   tool list** (less context, better answers), and aggregate tools from both servers.
5. Production advice in the workshop: do not hand the refresh token to the agent; put a dedicated MCP server /
   gateway in front that holds credentials. This is exactly D50 (b) later: seller-hub's own MCP server.

Reference shape for seller-hub (inferred from the above, not Amazon's statement): browser -> BFF -> agent service
(LLM) -> MCP client (our code) -> Amazon Ads MCP (region of the account, fixed context headers per tenant
seller-account, access token minted from the tenant's stored refresh token) with a human approval step before any
`W` tool.

## 7. SP-API counterpart (one paragraph)

The agentic toolkit (`refs/amazon/selling-partner-agentic-toolkit/.mcp.json`) registers one connector,
`amazon-selling-partner`, type `http`, URL `https://sellingpartner-ai.amazon.com/mcp` (no headers in the file:
authorization is handled by the client / OAuth). It is the Selling Partner API equivalent of the Ads server
(D50 mentions the same shape) and would be the second MCP endpoint of seller-hub's assistant; its tool list is the
subject of P1-SPAPI and `refs/amazon/selling-partner-agentic-toolkit`, not of this document.

## 8. Method and checks

- `mcp-tools.json`: 110 tools, 18 groups, each tool has `group`, `name`, `fullName`, `endpointPath`
  (`/mcp/<tool>`), `description`, `access`, `sideEffect`, `inputs` (top-level keys, their fields, required) and
  `backingOperations` (with `confidence`). `amazon_live` has 23 tools and no backing operation.
- Spot checks against the raw spec files: `reporting-retrieve_report` (input `body.reportIds`, description
  "Retrieve a report.") and `campaign_management-delete_campaign` ("Remove campaigns and all associated ad
  groups, ads, and targets." -> destructive, backing `DeleteCampaign /adsApi/v1/delete/campaigns`).
- Not covered: the Lite server's own tool catalogue beyond the three meta-tools; tool result shapes (the specs
  describe inputs only); rate limits of the MCP server (none documented).
