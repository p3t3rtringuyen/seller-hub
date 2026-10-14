# P1-ADS — Amazon Ads API and Ads MCP catalogue

Model: Sonnet · checkout: main · do not commit
OWNED_PATHS: `tools/catalog/ads.mjs`, `catalog/ads/**`, `docs/discovery/ads-domains.md`,
`docs/discovery/ads-mcp.md`, `docs/reports/P1-ADS.md`

## Goal

The same catalogue as P1-SPAPI, for the Amazon Ads API — the API ads-web/ads-api actually run on —
plus what Amazon's hosted Ads MCP Server offers, because seller-hub will build on it (D50).

## Inputs (read-only)

`refs/amazon-ads/` — a mirror of advertising.amazon.com/API/docs made by
`node scripts/fetch-ads-refs.mjs` (run it if the folder is missing):
- `INDEX.md`, `manifest.json` — every file, its source URL and the TOC section it sits under.
- `toc/` — the docs site's own tables of contents.
- `specs/dest/*_prod_3p.json` — OpenAPI specs. Two generations live side by side:
  - **v0 / classic** (TOC "Amazon Ads API v0"): Sponsored Products v3, Sponsored Brands v4,
    Sponsored Display, Profiles, Portfolios, Reporting v3, Exports, Marketing Stream, Budget rules,
    Recommendations, Change history, Test accounts, … (also `specs/sponsored-*`, `specs/profiles`);
  - **v1 / unified** (`AmazonAdsAPI<Product><Entity>Contract_prod_3p.json`): one API across ad
    products (ALL, SP, SPGLOBAL, SB, SD, ST, DSP).
- `specs/mcp/*.json` — the Ads MCP Server's tool definitions (beta), one file per tool group.
- `docs/**.md` — every docs page: guides, reference overviews, `mcp/` (overview, get started,
  Lite, OAuth 2.1, skills library), knowledge-hub workshops (incl. the Ads MCP Server workshop),
  release notes.

Also `refs/amazon/ads-advanced-tools-docs/` (from `scripts/fetch-refs.ps1`): Postman collections,
Marketing Stream CloudFormation templates (SQS / Firehose / S3), and
`unified-campaign-management-migration-skills/` — Amazon's own guide from v0 to v1, the best
source for D53.

Five DSP closed-beta specs in `specs/dest/AdGroupTargeting-*` are not valid JSON upstream; skip
them and say so.

## Steps

1. Write `tools/catalog/ads.mjs` (Node ≥ 20, ESM, no dependencies, deterministic) producing
   `catalog/ads/apis.json` (api, generation v0|v1, ad product, version, file, title from the TOC),
   `catalog/ads/operations.json` (also each operation's versioned `Content-Type` / `Accept` media
   types, e.g. `application/vnd.spCampaign.v3+json`, required headers, and whether it is a batch
   call with per-item / 207 results), `catalog/ads/definitions/*.json`, `catalog/ads/reports.json`
   (Reporting v3: report type ids, columns, group-bys, time units, lookback limits),
   `catalog/ads/stream.json` (Marketing Stream datasets) and `catalog/ads/mcp-tools.json` (tool
   name, group, inputs, what it does, read or write).
2. Spot-check three operations and two MCP tools against the files; record the checks.
3. `docs/discovery/ads-domains.md`:
   - Auth and headers (LWA scope `advertising::campaign_management`, `Amazon-Advertising-API-ClientId`,
     `Amazon-Advertising-API-Scope` profile header, v1 account headers), regions (NA / EU / FE),
     sandbox / test accounts.
   - Domains: accounts & profiles; portfolios; SP / SB / SD campaigns, ad groups, ads, keywords,
     product & audience targets, negatives; budgets and budget rules; bid adjustments;
     recommendations; reporting; Marketing Stream; exports; change history.
   - For each: entities, write operations and their partial-failure behaviour, read strategy
     (export vs list vs stream), throttling (429 + `Retry-After`; say what the docs say about
     limits).
   - **v1 first, v0 as named exceptions (D53 decided: v1).** For each domain: the v1 operations
     seller-hub uses; where v1 has no equivalent (no Portfolios or Budget rules entity today — check
     every domain, incl. profiles vs advertiser accounts, exports, change history, bid
     adjustments, Marketing Stream), the v0 operation to use instead, as an **exception table**
     (domain · v0 operation · why · what to watch in release notes). Add what Amazon's docs,
     release notes and the migration skills say about v0 deprecation dates.
4. `docs/discovery/ads-mcp.md`:
   - What the hosted server is (status: open beta), endpoints per region (`/mcp` and `/mcp/lite`),
     auth (LWA OAuth 2.1, public vs private client, required headers, dynamic vs fixed account
     context), standard vs expert tools, skills.
   - The tool groups and tools (from `catalog/ads/mcp-tools.json`), grouped by what a seller does,
     with read/write marked.
   - What the MCP covers and what it does not, compared with the API (so seller-hub knows when to
     call the API directly and when an agent can use MCP).
   - The workshop's reference architecture (agent + MCP + deployment), summarised.
   - The SP-API counterpart: the Selling Partner connector the agentic toolkit registers
     (`refs/amazon/selling-partner-agentic-toolkit/.mcp.json`), in one paragraph.

## Done when

Every spec in `refs/amazon-ads/specs` is catalogued or listed as skipped with the reason; every
MCP tool group is in `mcp-tools.json`; both docs cover every section above.
