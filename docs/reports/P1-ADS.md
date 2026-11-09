# P1-ADS report - Amazon Ads API and Ads MCP catalogue

Status: DONE. Main checkout, nothing committed (per brief).

## What was done

- `tools/catalog/ads.mjs`: single-file builder (Node >= 20, ESM, no dependencies, deterministic). Reads the
  `refs/amazon-ads` mirror (falls back to the git common dir from a worktree) and writes `catalog/ads/**`.
  Includes a YAML-subset parser because 9 specs are YAML (SD v3, SB v3, SP v2, Profiles, DSP 2.2/3.0/3.1, Creative
  Asset Library, Data Provider) and no dependencies are allowed.
- `catalog/ads/` (9.0 MB): `apis.json`, `operations.json`, `definitions/*.json` (200), `reports.json`, `stream.json`,
  `mcp-tools.json`, plus one extra: `domain-map.json` (every operation -> domain + treatment + named exception +
  v1 equivalent). The extra file is what makes "maps every operation" checkable: the builder **throws** if any
  operation is unclassified.
- `docs/discovery/ads-domains.md`: auth/headers/regions/sandbox, cross-cutting rules (v1 request model, 207
  partial failure, read strategy, throttling), 14 domains, the 20-row exception table (D53), deprecation
  calendar, Seller/Vendor notes (D5), appendix with the treatment of all 200 APIs.
- `docs/discovery/ads-mcp.md`: server, endpoints, auth, account contexts, skills, all 18 groups / 110 tools
  with R/W and backing operation, coverage vs the API, workshop reference architecture, SP-API connector.

## Results (numbers from the files)

| Item | Value |
|---|---|
| Specs in `refs/amazon-ads/specs` (non-MCP) | 205 = 200 catalogued (94 v1, 106 v0; 15 beta) + 5 skipped |
| Skipped | `AdGroupTargeting-{ContentGenre,ContentRating,VideoAdFormat,VideoAdInitiationType,VideoAdPlayerSize}` - invalid JSON upstream ("Bad control character"), DSP closed beta |
| MCP spec files | 18 groups, 110 tools (63 write, 47 read) |
| Operations | 1,090 (v1 238, v0 852) |
| Treatments | v1-default 161, v0-exception 196 (20 `EX-*`), v0-superseded 107, v0-deprecated 67, v0-out-of-scope 482, v1-out-of-scope 77 |
| v3 report types | 22 pages, 739 columns; v1 reporting fields 844 (709 metrics, 135 dimensions); 5 v3->v1 migration examples |
| Stream datasets | 29 (27 v1, 2 v2) |

## Commands run and results

- `node tools/catalog/ads.mjs` (after `rm -rf catalog/ads`) - clean exit; prints `apis: 200 catalogued, 5 skipped;
  operations: 1090`.
- Determinism: two consecutive full runs, `find catalog/ads -type f | xargs sha256sum | sha256sum` identical
  (`71a73b8e...a17060`).
- YAML parser check: operation counts equal raw `grep` counts of path-level HTTP methods for every YAML spec
  (SD v3 76, SB v3 38, SP v2 11, DSP 3.1 27, Profiles 3, Creative Asset Library 6, Data Provider 5, DSP 3.0 2, DSP 2.2 2).
  Two parser bugs were found by this check and fixed (blank lines inside plain scalars; multi-line flow lists).
- Coverage: every MCP group name appears in `ads-mcp.md`; 110 tool rows in the doc = 110 in `mcp-tools.json`.

## Spot checks (step 2) against the raw spec files

1. `SPCreateCampaign` (`specs/dest/AmazonAdsAPISPCampaignsContract_prod_3p.json`): raw `POST
   /adsApi/v1/create/campaigns`, responses 207/400/401/403/404/413/429/5xx, params AccountIdHeaderOptional,
   ClientIdHeader, ScopeHeaderOptional; request `campaigns` array maxItems 1000. Catalogue: batch true, field
   `campaigns`, max 1000, 207 true, headers `Amazon-Ads-ClientId*` required, AccountId and Scope optional. **Match.**
2. `CreateSponsoredProductsCampaigns` (v0, `SponsoredProducts_prod_3p.json`): raw content type
   `application/vnd.spCampaign.v3+json`, 207/400/401/403/415/429/500, `campaigns` maxItems 1000. Catalogue:
   contentType and accept `application/vnd.spCampaign.v3+json`, batch/207 true, max 1000, headers
   `Amazon-Advertising-API-ClientId*`, `-Scope*`, `Prefer`. **Match.**
3. `CampaignExport` (v0 Exports): raw `application/vnd.campaignsexport.v1+json`, responses 202/400/401/406.
   Catalogue: same media types, `successCodes ['202']`, batch false (after fixing a false positive where
   `stateFilter` arrays were counted as batch fields). **Match after fix.**
4. MCP `reporting-retrieve_report`: raw description "Retrieve a report."; catalogue read / sideEffect none, input
   `body.reportIds` required array, backing `AdsApiv1RetrieveReport` (direct). **Match.**
5. MCP `campaign_management-delete_campaign`: raw "Delete Amazon Ads Campaigns. Remove campaigns and all
   associated ad groups, ads, and targets."; catalogue write / destructive, backing `DeleteCampaign
   POST /adsApi/v1/delete/campaigns`. **Match.**

## Checks skipped or limited

- No live call to Amazon (no credentials by rule). Real throttling numbers, the content of v1
  `alternateIds`, and MCP tool result shapes are marked **verify live** in the docs.
- Tool -> API operation links in `mcp-tools.json` are inferred by name/description (`confidence` field); Amazon
  publishes no such table. 18 of 110 tools have `inferred` links, 23 (Amazon Live) have none.
- `domain-map.json` rules are my classification (D53 reading), not Amazon's; every `v0-superseded` operation names
  its v1 equivalent when one exists by naming convention (`v1Equivalent`), `null` otherwise.
- Heuristic fields in `operations.json` (`batch`, `batchField`, `paginated`, `permissions`) are parsed from schemas
  and prose; treat them as hints.
- Appendix A of `ads-domains.md` is a one-time generation from `domain-map.json`; re-generate it if the builder
  output changes (it is not produced by the builder, which only owns `catalog/ads/**`).
- Output size: `catalog/ads` is 9.0 MB (definitions are 200 files); if that is too big for the repo, drop
  `definitions/` for non-seller APIs (DSP) from the builder - not done because the brief asked for all specs.

## Findings P1-SCOPE / orchestrator should know (facts from the files)

1. **Hard dates:** Reporting API v3, Sponsored Ads v2 reporting and Marketing Stream v1 stop on **2027-06-30**;
   legacy account management (`/adsAccounts*`) 404s from **July 2027**; SB Product Collection errors from **Jan 2027**.
   Build only on v1 reports + Stream v2.
2. **No sunset date** is announced for SP v3 / SB v4 / SD v3 CRUD: v1 is safe to default to (D53), v0 CRUD is not urgent.
3. **v1 gaps = the exceptions** (20): portfolios, budget rules, budget usage/recommendations, optimization rules,
   recommendations (v1 has 4 types), target discovery lookups, exports, change history, profiles, billing, user
   permissions, creative assets/moderation, brand analytics. They stay v0 and are named in `EX-*`.
4. **Stream v2 is reporting only** (2 datasets) and delivers Parquet to an S3 bucket in an AWS account; entity-change,
   budget and recommendation streams are discontinued with no replacement. Per-tenant AWS destination design is open.
5. **Reporting v1 concurrency can be 1** and 1 req/s per client; ingestion should lean on Stream v2.
6. The Ads MCP server publishes **no tool->API table**, no stream/export tool, and Amazon Live tools with no API.
   MCP is fit for assistant turns (D50 a), not for ingestion.
7. Test accounts have no performance data: report/ingestion tests need fixtures.

## Open questions

- Q1 (for D31/D30-style credential check): does `AdvertiserAccount.alternateIds` return the profile id, so that
  Profiles (`EX-PROFILES`) can be dropped? Needs one real account.
- Q2: Stream v2 lists "Global Account, Amazon DSP Regional Account" as supported account types - does a plain
  Seller/Vendor advertiser qualify? Needs a real account or support ticket.
- Q3: where should seller-hub's Stream destination live (bucket per tenant vs shared with prefixes)? P2-DATA/P3.

## Follow-ups

- Re-run the builder after every `scripts/fetch-ads-refs.mjs` refresh and diff `domain-map.json` `tally`: a
  change in an `EX-*` count or a new v1 contract is the signal that an exception can be retired.
- P1-SCOPE: use `docs/discovery/ads-domains.md` §7 and the exception table to size the ads wave.
- ADR candidate: "v0 exceptions list" (D53 says exceptions go in `ads-domains.md` / ADR).
