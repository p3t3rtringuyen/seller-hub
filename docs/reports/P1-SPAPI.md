# P1-SPAPI — SP-API catalogue

Status: DONE. Main checkout, nothing committed (per CLAUDE.md).
Source: `selling-partner-api-models` @ `db2936aa19f4b48185173c385c51ab115166f221` (2026-10-29).

## What was built

- `tools/catalog/spapi.mjs` — Node ≥ 20, ESM, no dependencies. Reads `refs/amazon/selling-partner-api-models`
  (falls back to the git common dir's `refs/` from a worktree; `--refs`/`--out` override). Deterministic
  (sorted keys, no timestamps).
- `catalog/spapi/` (81 files, 2.2 MB): `apis.json`, `operations.json`, `definitions/<api>@<version>.json` (73),
  `reports.json`, `notifications.json`, `stamp.json`, plus extras `feeds.json`, `data-kiosk.json`, `roles.json`.
- `docs/discovery/spapi-domains.md` — 14 seller domains + a full vendor section; every one of the 394 operations
  appears (checked by script: 394 covered, 0 missing), with rate limit, RDT flag and roles.

## Numbers (`stamp.json`)

77 model files = 73 parsed + 4 skipped (all four are Amazon "API removed" stubs: authorization, fbaSmallandLight,
feeds_2020-09-04, reports_2020-09-04). 394 operations: 352 seller, 42 vendor. 315 on current (non-superseded)
versions. 30 restricted. 87 without a usage-plan table (rate = null). 348 with roles. All 73 models are Swagger 2.0.

## Commands and results

| Command | Result |
|---|---|
| `node tools/catalog/spapi.mjs` (also under `env -i`) | exit 0: 73 api versions, 394 operations, 73 definition files, 4 skipped |
| two consecutive runs, sha1 of all 81 files | identical (`da1c453dcb78`) |
| `node tools/catalog/spapi.mjs --roles-html … --types-html …` | regenerates `roles.json` from the saved Amazon pages (69 API sections, 28 feed / 28 notification / 125 report types) |
| doc coverage check (scratch script, not committed) | 394/394 operations present |

## Spot checks against the source JSON

1. **Rate limit** — `orders@v0.getOrders`: source usage-plan table `0.0167 | 20`; catalogue `rateLimit {rate: 0.0167, burst: 20}`. ✔
2. **Restricted flag** — `orders@v0.getOrderBuyerInfo`: the model text has no RDT wording at all, so only Amazon's
   restricted-operations list flags it (`restrictedReason: amazon-rdt-list`); `getOrders` is flagged by both (the
   `ShippingAddress`/`BuyerInfo` property descriptions in the model mention the RDT). ✔ (see limitation below)
3. **Parameters** — `orders@v0.getOrders`: 22 query params in source (e.g. `MarketplaceIds` required, array<string>);
   catalogue lists the same 22 with `in/required/type`. ✔

## Decisions and judgement calls

- **D5 = Seller + Vendor** overrides the prompt's "vendor out of scope" wording: all 42 vendor operations are catalogued
  (`audience: vendor`) and the doc has a full vendor section with tables, not a one-liner list.
- Version-level `superseded` = a newer version of the same API exists (or every op deprecated). It is coarse: e.g.
  `productPricing@v0` and `messaging@v1` have **no same-named successor operations**, and `orders@v0` still holds 8 ops
  that 2026-01-01 lacks. Consumers must use the per-operation `deprecated` flag and the doc's "no successor" lists.
- API renames to match Amazon's names rather than file stems: `fbaInbound.json` → `fbaInboundEligibility`,
  `definitionsProductTypes` → `productTypeDefinitions`, `application` → `applicationManagement`.
- Roles: fetched Amazon's role-mapping pages (`developer-docs.amazon.com/sp-api/docs/role-mappings`,
  `…/role-mappings-for-types`, via the `.amazon` redirect host) and parsed them into `roles.json`; 46 operations (new
  or absent from Amazon's page, e.g. all `fulfillmentOutbound@2026-07-04`) stay `roles: null` = `unknown`, not guessed.
- RDT list was transcribed by hand from Amazon's Tokens API use-case guide into `RDT_OPS` in the script (the page has
  no machine-readable form). The page names operations without versions; applied to all versions having that operationId.

## Limitations / open points

- `orders@2026-01-01.searchOrders` is **not** on Amazon's RDT list yet but returns the same PII fields behind an RDT;
  `restricted` is false for it. Decide when D11 is answered.
- Report types are not enumerated in the models; `reports.json` only lists the 22 schema files with the report type
  found in their examples (19 distinct). The full list with roles is in `roles.json → types.report` (from Amazon's page).
- Two role-page entries match no model operation (`Messaging v1 CreateAmazonMotors`, `Shipping v2 submitFeedback`).
- Acquisition recommendations in the domain doc (poll vs report vs notification) are my reasoning from the rate limits
  and Amazon's general design; they are not in the models. Items I could not verify from the models are worded as
  such (e.g. `includedData` in Orders 2026).
- Region endpoints are not in the models (all hosts are NA); the doc says so. `regions` per operation come from the
  role page.
- `docs/STATUS.md` shows as modified in git status — not touched by this task.

## Follow-ups

- P1-SCOPE: use `operations.json` filters (`audience`, `restricted`, `rateLimit`) for the MVP cut.
- When Amazon updates the models: re-run the builder; to refresh roles, re-save the two role pages and pass
  `--roles-html/--types-html`.
