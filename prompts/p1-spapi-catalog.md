# P1-SPAPI — SP-API catalogue

Model: Sonnet · checkout: main · do not commit
OWNED_PATHS: `tools/catalog/spapi.mjs`, `catalog/spapi/**`, `docs/discovery/spapi-domains.md`,
`docs/reports/P1-SPAPI.md`

## Goal

Turn Amazon's SP-API models into a machine-readable catalogue that later sessions (data model,
clients, backlog) consume directly, plus a domain map a person can read in ten minutes.

## Inputs (read-only)

- `refs/amazon/selling-partner-api-models/models/<api>-model/*.json` — Swagger 2.0 for most;
  handle OpenAPI 3 too. Several APIs ship more than one version (`v0` plus dated versions).
- `refs/amazon/selling-partner-api-models/schemas/{reports,notifications,feeds,data-kiosk}`.
- `refs/amazon/VERSIONS.txt` — the commit you stamp on every output.

## Steps

1. Write `tools/catalog/spapi.mjs` (Node ≥ 20, ESM, no dependencies). Deterministic: the same
   input gives byte-identical output (sorted keys and arrays, no timestamps). It must be re-runnable
   when Amazon updates the models. It writes:
   - `catalog/spapi/apis.json` — `[{api, version, file, title, operationCount, superseded: bool,
     supersededBy?}]`. Superseded = a newer version of the same API exists, or the model marks it
     deprecated.
   - `catalog/spapi/operations.json` — `[{api, version, operationId, method, path, summary,
     rateLimit: {rate, burst} | null, restricted: bool, params: [{name, in, required, type}],
     requestRef, responseRef}]`. Rate limits come from the usage-plan table in each operation's
     description. `restricted` is true when the description says the operation needs a Restricted
     Data Token or returns PII.
   - `catalog/spapi/definitions/<api>@<version>.json` — flattened definitions:
     `{Name: {type, required[], properties: {prop: {type, format, enum, ref, description}}}}`,
     description cut to its first sentence.
   - `catalog/spapi/reports.json` — report types and their schema files.
   - `catalog/spapi/notifications.json` — notification types and payload schema files.
   - `catalog/spapi/stamp.json` — source commit and counts.
2. Run it. Spot-check three operations by hand against the source JSON (one rate limit, one
   restricted flag, one parameter list). Record those checks in your report.
3. Roles: if you can fetch Amazon's "roles in the Selling Partner API" page from
   developer-docs.amazon.com, map each API to the role(s) it needs. Otherwise write `unknown` — do
   not guess.
4. Write `docs/discovery/spapi-domains.md`. Group the seller APIs into domains — Account &
   marketplaces; Catalog & listings (incl. product type definitions, restrictions, A+ content);
   Pricing & fees; Orders; FBA inventory; FBA inbound (incl. AWD); Outbound / multi-channel
   fulfilment; Merchant-fulfilled shipping; Finance & settlements; Reports & Data Kiosk;
   Notifications; Buyer messaging, solicitations & feedback; Feeds & uploads; Replenishment, sales
   and the rest. For each domain:
   - APIs and the version to build on (and which versions are superseded, by what);
   - key entities (with definition file references);
   - how data is best acquired: synchronous call, report, Data Kiosk query, or notification —
     with the reason (volume, rate limit, freshness);
   - rate-limit hotspots (list endpoints under 1 rps), restricted operations, required roles.
   Vendor APIs go in a closing section "Out of scope unless D5 changes", one line each.

## Done when

- The script runs clean; every model file is represented, or listed in the report as skipped with
  the reason.
- Counts in `stamp.json` match the number of model files.
- The domain doc covers every seller API.

## Stop and ask

Report `NEEDS_DECISION` if a model cannot be parsed without losing operations.
