# Conventions

Binding for every implementation session. Where a rule comes from a legacy trap, the trap number from
`docs/discovery/legacy-api-domain.md` §3 or the UX rule id from `catalog/legacy/web-ux-rules.json` is given.

## 1. Naming

| Thing | Rule | Example |
|---|---|---|
| Workspace package | `@seller-hub/<name>`; modules `@seller-hub/mod-<name>` | `@seller-hub/amazon-core`, `@seller-hub/mod-ads` |
| Folders, files | kebab-case; one exported concept per file; tests next to code as `*.test.ts` | `campaign-repository.ts` |
| TS types / classes | PascalCase; no `I` prefix; DTOs come from generated contract types, not hand-written | `CampaignRow` |
| Functions, variables | camelCase; booleans `is/has/can` | `canWriteAds` |
| Constants | `SCREAMING_SNAKE` only for true constants (not limits, not copy) | `MAX_WAIT_MS` |
| DB schema / table / column | snake_case; tables **plural**; FK `<singular>_id`; timestamps `*_at`; dates `*_date` | `ads.campaigns.portfolio_id` |
| Amazon ids in DB | `amazon_<entity>_id text`; never numeric types (ids exceed 2^53 and v1 ids are strings) | `amazon_campaign_id` |
| HTTP paths | kebab-case plural nouns, versioned `/v1`; seller-scoped under `/v1/seller-accounts/{sellerAccountId}/…` | `/v1/seller-accounts/{id}/ads/campaigns` |
| JSON fields | camelCase | `dailyBudget` |
| operationId | `<module>.<verb><Noun>` | `ads.listCampaigns` |
| Queue names | `<module>.<job>`; job ids deterministic (see §8) | `ads.sp-report-daily` |
| Permissions | `<area>.<action>` | `ads.write`, `members.manage` |
| Env vars | `SH_` for seller-hub settings; `SPAPI_`, `ADS_` for Amazon app credentials (names in `.env.example`) | `SH_MASTER_KEY` |
| Enums | Amazon enums keep Amazon's values verbatim (`ENABLED`, `PAUSED`) and cite their model file; our own enums lower_snake | `command_status = 'partially_succeeded'` |

## 2. IDs

- Internal primary keys: **UUIDv7** (time-ordered, generated in the app with one helper in `packages/core`).
- Amazon identifiers stay separate columns with their own unique constraint scoped by seller account
  (`unique (seller_account_id, amazon_campaign_id)`).
- The public API exposes our UUID as `id` and Amazon's id as `amazonId` (or the Amazon field name); URLs use our ids.
- Correlation: every request gets `X-Request-Id` (accepted from the BFF if well-formed, otherwise generated),
  returned in the response header and in every error body as `traceId`, propagated into jobs.

## 3. Errors

The HTTP status is always the real one (legacy trap 2: errors answered with 200 — do not repeat).
Error bodies are RFC 9457 problem details, `Content-Type: application/problem+json`:

```json
{
  "type": "https://seller-hub.dev/problems/validation",
  "title": "Validation failed",
  "status": 422,
  "code": "validation_failed",
  "detail": "2 fields are invalid",
  "traceId": "01J…",
  "errors": [{ "path": "/items/3/bid", "code": "below_min", "message": "Minimum bid for US is 0.02", "meta": {"min": "0.02"} }]
}
```

| Status | When |
|---|---|
| 400 | malformed request (schema) |
| 401 | no / expired session |
| 403 | authenticated but not permitted (RBAC or tenant scope) — never leak whether the resource exists in another tenant; cross-tenant ids return **404** |
| 404 | not found in this scope |
| 409 | conflict (stale version, duplicate submit, command already approved) |
| 422 | business validation (limits, name rules UX-16) |
| 428 | confirmation required (destructive or bulk command without `confirmationToken`, ADR-0011) |
| 429 | our own API rate limit |
| 502 / 503 | Amazon failed / Amazon throttled an interactive lookup (`Retry-After` set) |

- `code` values are a closed list per module, declared in its contract file.
- Commands: `POST` returns **202** with the command; reading a command returns **200** with per-item results.
  A command whose items partly failed has `status: "partially_succeeded"` and per-item errors — it is not an HTTP
  error, and the UI renders it as warnings + errors (UX-13), never as success.
- Amazon errors are mapped to our codes at the client boundary; Amazon's raw message goes to `meta.amazon`
  (sanitised: no tokens, no PII).

## 4. Lists: pagination, sorting, filtering

Two shapes; the contract says which one an endpoint uses.

**Grids (offset)** — tables with page numbers and totals (UX-09, UX-11):
`?page=1&pageSize=50` (max 200), response `{ items, page, pageSize, total, totals?, freshness }`.
`totals` is the Total row (ADS-03) computed over the whole filtered set, not the page.

**Feeds (cursor)** — exports, sync status, audit/history, anything appended:
`?limit=100&cursor=<opaque>`, response `{ items, nextCursor }`. Cursors are opaque base64url, signed, scoped to
the caller's tenant.

**Sorting**: `sort=-spend,name` — comma list, `-` for descending; only fields whitelisted in the contract; a stable
tiebreaker (`id`) is always appended server-side.

**Filtering**:
- equality / IN on enums: `state=ENABLED,PAUSED`;
- text search: `q=` (name / id contains, case-insensitive; trigram index where needed);
- numeric and metric ranges: `filter[acos][gt]=30&filter[clicks][gte]=10` (OpenAPI `deepObject`), operators
  `eq, ne, gt, gte, lt, lte`;
- quick chips (ADS-03 "out of budget", "impressions no clicks") are named presets `preset=out_of_budget`
  resolved server-side;
- dates: `from`, `to` (inclusive, `YYYY-MM-DD`, marketplace local dates), compare window `compareFrom`,
  `compareTo`.
- URL state in the web app mirrors these names one to one (UX-07/UX-09 prefixes per tab).

## 5. Money and numbers

- JSON: money is `{ "amount": "12.3400", "currency": "USD" }` — amount as a **decimal string**, ISO 4217 code.
  Where a whole grid shares one currency, the response carries `currency` once and amounts as strings.
- DB: `numeric(18,4)` plus a `currency char(3)` column (or the seller account's marketplace currency when the
  table is single-currency by construction — say so in the table comment).
- Code: no float arithmetic on money. Use the `Money` / `Decimal` helpers in `packages/core` (decimal.js).
  Rounding only at the edge, to the marketplace's currency precision (JPY 0 decimals).
- Ratios (ACOS, ROAS, CTR, CVR) are computed from summed numerators / denominators, never averaged; returned as
  decimal strings with 4 places; `null` when the denominator is 0. Metric definitions live once in
  `packages/metrics` (formula, unit, direction, copy key) and are used by api and web.
- Bid / budget bounds are **data** (`ref.marketplace_limits`, seeded from
  `refs/amazon-ads/docs/reference/concepts/limits.md`, by marketplace × ad product × account type) — never
  constants (legacy hard-coded 0.02..10 000; UX-14, PLT-04).
- Inputs for money / percentages / counts use the text-field component from `packages/ui` (UX-01).

## 6. Time

- Storage: `timestamptz` in UTC for instants. API instants: ISO 8601 with `Z`.
- Business dates: `date` columns keyed by the **marketplace's local date** (`ref.marketplaces.time_zone`, e.g.
  `America/Los_Angeles` for US). Ads report rows already use the profile's date; SP-API `getOrderMetrics` is
  requested with the marketplace time zone in `interval`/`granularityTimeZone`.
- "Today", default ranges, calendar ceilings and start-date minimums are computed in the marketplace time zone
  on the server and sent to the UI (UX-17); the browser's zone is never used for business dates.
- Scheduling (cron-like) is stored in UTC with the marketplace zone as metadata when the user picked a local time.
- Libraries: `Temporal` polyfill (`@js-temporal/polyfill`) or `date-fns-tz` — one choice, made in P3-SCAFFOLD,
  wrapped in `packages/core/time`.

## 7. Logging and secrets

- Logger: pino, JSON, one logger per process, child loggers carry `traceId`, `tenantId`, `sellerAccountId`,
  `jobId`, `commandId`.
- **Allow-list serialisers** (trap 3): requests log method, route template, status, duration, `traceId`, user id.
  Never: `Authorization`, cookies, `Set-Cookie`, query strings of auth/connect routes, request or response bodies
  of `/auth/*`, `/connections/*`, LWA token calls, RDT calls.
- Amazon calls log: operation id, region, HTTP status, `x-amzn-RequestId` / `x-amz-request-id`,
  `x-amzn-RateLimit-Limit`, retry count, duration. Bodies only at `debug` level, only in development, and only
  through the PII/secret redactor.
- No PII (D11): buyer name, address, phone, email never reach logs, traces, error bodies or the audit log.
- Secrets come from env (names in `.env.example`) or the vault (ADR-0005). Config validation fails closed at boot
  (trap 7): a missing secret stops the process; there are no default secrets and no bypass tokens.
- `node scripts/check-env.mjs` prints names only; sessions never print values.

## 8. Jobs and idempotency

- Job ids are deterministic: `<queue>:<sellerAccountId>:<windowOrKey>` so a duplicate enqueue is a no-op.
- Every job payload carries `tenantId`, `sellerAccountId`, `traceId`; a job without them is rejected.
- Upserts use natural keys; a re-run of the same window converges to the same rows.

## 9. Copy, constants and configuration

- UI copy (labels, tooltips, metric definitions, validation messages, empty states) lives in message catalogues:
  `apps/web/messages/<locale>/<module>.json` (next-intl). One file per module, owned by that module's slice — no
  shared copy file to edit (UX-22). English first; `vi` can be added per module.
- Validation messages that the API returns use `code` + `meta`; the web app renders the text from the catalogue.
- Marketplace facts (currency, time zone, region, limits) are reference **data** in `ref.*`, seeded by migration
  from Amazon's docs, not code constants.
- Tunables (batch sizes, page sizes, waits) live in one `config` object per package, typed, overridable by env;
  Amazon batch maxima come from `catalog/ads/operations.json` `batchMax` (trap 15).
- Feature flags: env-driven, one file `packages/config/src/flags.ts`, read server-side only.

## 10. Tenancy in code

- Every repository function takes a `Scope` (`{ tenantId, sellerAccountId? }`) as its first argument; the type
  system makes it mandatory. Queries filter by it; Postgres RLS enforces it again (ADR-0004, ADR-0009).
- No cross-tenant joins; global tables live only in `ref` and `identity.users`.
- Redis keys, object-store keys, queue job ids and cache keys start with the tenant id.
- Each repository has a test that proves another tenant's rows are invisible (CLAUDE.md).

## 11. Code boundaries (enforced by lint, ADR-0001)

- `apps/web` imports only `packages/contracts` (generated client and types), `packages/ui`, `packages/metrics`,
  `packages/config` — never `modules/*`, `packages/db`, `packages/amazon-*`.
- `modules/<a>` may import `packages/*` and other modules' **public entry** (`modules/<b>/src/index.ts`) only;
  never another module's repository or tables.
- Only `packages/amazon-*` talk to Amazon; only executor jobs call Amazon write operations (trap 8).
