# P1-API — ads-api domain inventory and replacement map (clean room)

Model: Sonnet · checkout: main · do not commit
OWNED_PATHS: `catalog/legacy/api-endpoints.json`, `catalog/legacy/entities.json`,
`catalog/legacy/jobs.json`, `catalog/legacy/api-amazon-calls.json`,
`docs/discovery/legacy-api-domain.md`, `docs/reports/P1-API.md`

## Goal

Learn what ads-api does and — most important — **where its data comes from**, so seller-hub can
replace every internal Yes4All source with an Amazon one. You extract requirements, never code.

## Source (read-only)

`C:/Users/trinh/Projects/ads-api` — Go, Gin, fx, GORM. **Never open `.env`, `.env.*`,
`profiles.csv.*`, or print any host, connection string or credential.** Never run it, never touch
Kafka, Redis or databases. `git log` / `git show` are fine; nothing that changes the tree.

Read: `CLAUDE.md`, `docs/SRS_ADS_API.md`, `services/ads-api/http/router/*`, handlers, `usecase/`,
`usecase_common/`, `model/entity`, `kafka/consumer/*`, `jobs/`, `cmd/*.go`, `pkg/xservice/*`,
`db/migrations`.

## Outputs

- `catalog/legacy/api-endpoints.json` — `[{method, path, group: "external"|"internal", handler,
  usecase, entities[], dataSources[], amazonCalls[], notes}]`. `amazonCalls` = what the call
  ultimately does at Amazon (through the internal proxy), named by Amazon Ads concept and operation
  where you can tell.
- `catalog/legacy/entities.json` — `[{entity, table, fields[{name, type}], class, amazonObject,
  notes}]`, where `class` is one of:
  - `amazon-mirror` — a copy of an Amazon object (campaign, ad group, keyword, target, …);
  - `app-owned` — the app's own data (rules, alerts, logs, users, roles, tickets);
  - `internal` — Yes4All-specific (departments, SKU ownership, internal recommendation engines).
- `catalog/legacy/jobs.json` — every cron job, one-shot job and Kafka consumer: `[{name, trigger,
  does, reads, writes, amazonCalls}]`.
- `catalog/legacy/api-amazon-calls.json` — **how ads-api calls Amazon (D52).** Its clients in
  `pkg/xservice/aws/` call an internal proxy whose paths mirror the Amazon Ads API
  (`/amz_y4a/sp/campaigns/list`, `/amz_y4a/sb/keywords`, `/budgetRules`, …) and send Amazon's
  headers (`Amazon-Advertising-API-Scope` = profile id, see `header.go`). For every client call:
  `{client file, function, method, proxyPath, amazonOperation (method + path + version), mediaTypes,
  headers, requestShape, responseShape, usedBy (usecases), v1Operation}`. ads-api speaks v0;
  seller-hub builds on v1 (D53), so `v1Operation` names the v1 equivalent, or `none — v0
  exception`. Match `amazonOperation` against
  `catalog/ads/operations.json` if P1-ADS has produced it (otherwise against
  `refs/amazon-ads/specs`), and list proxy paths that match no Amazon operation — those are
  proxy-side logic seller-hub must rebuild itself. seller-hub makes these same Amazon calls
  directly, with each seller's own LWA credentials.
- `docs/discovery/legacy-api-domain.md`:
  1. Domains and their business rules worth keeping, written as requirements (auto bidding, budget
     rules, bidding rules / CPC optimisation, search-term harvesting and auto negatives, alerts,
     inventory alerts, out-of-budget notifications, activity / audit logs, roles and portfolio
     permissions, exports).
  2. **Replacement map** — the core of this task. One row per external dependency (the internal
     Amazon proxy service, each reporting database, the warehouse / activity log DB, Keycloak,
     Kafka topics, Redis caches): what data or capability it supplied, which features depend on it,
     and how seller-hub gets the same from Amazon directly (Ads API operation, Ads report type,
     Marketing Stream dataset, SP-API report / Data Kiosk query / notification) — or "user input"
     (e.g. COGS) or "drop". Mark rows you could not resolve.
  3. Traps the legacy docs record that a new system should design out (e.g. an error envelope that
     answers HTTP 200 with a 500 inside; request logging that captures auth headers).

Name internal concepts generically in your outputs; do not carry hostnames or service names that
only make sense inside Yes4All beyond the replacement map's "legacy source" column.

## Done when

Every route file, consumer and job is represented; every external dependency has a replacement
row.
