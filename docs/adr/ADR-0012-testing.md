# ADR-0012 — Testing strategy

Status: Accepted, pending Gate 2 (D20) · Date: 2026-11-10 · Task: P2-ARCH

## Context

D54 a: Vitest + React Testing Library, Storybook with interaction tests, Playwright, in a Turborepo pipeline that
blocks merge when red. CLAUDE.md: every repository has a tenancy test; "measure, do not reason". Amazon facts: Ads
test accounts have **no performance data** (`docs/discovery/ads-domains.md` §1); SP-API has a static sandbox; real
seller credentials are gated by D30 (OPEN, default sandbox + Ads test account). No live Amazon calls in CI.
Pattern to reuse: sample-data mode replaying API responses (`docs/discovery/reference-patterns.md` §1.5).

## Options

**Database in tests**
| Option | For | Against |
|---|---|---|
| **Real Postgres 16 (Testcontainers locally, service container in CI), one database per worker, migrations applied once, each test in a rolled-back transaction or truncated schema** | tests RLS, partitions, `ON CONFLICT`, enums for real | slower than mocks; Docker required |
| pg-mem / SQLite | fast | no RLS/partitions; false confidence |
| Mocked repositories | fastest | tests nothing about SQL |

**Amazon in tests**
| Option | For | Against |
|---|---|---|
| Live sandbox in CI | real responses | flaky, rate-limited, needs secrets in CI, Ads sandbox has no data |
| **Recorded fixtures replayed by the client's `replay` mode + a small Amazon mock HTTP server for e2e; sandbox smoke run manually / nightly outside PR CI** | deterministic, offline, covers 207/429 edge cases we can script | fixtures drift → refresh procedure needed |

## Decision

| Layer | Tool | Scope | Runs in PR CI |
|---|---|---|---|
| Unit | Vitest | pure functions: metrics, money, limit validation, 207 mapping, rule evaluation, cursor maths | yes |
| Repository | Vitest + real Postgres 16 | every repository: CRUD + **cross-tenant invisibility with RLS on** + scope-required (type + runtime) | yes |
| Service / module | Vitest + Postgres + Redis (Testcontainers) | services with the Amazon client in `replay` mode | yes |
| API contract | Vitest + `fastify.inject` | every route: auth required, permission matrix (one allowed + one denied role), response validated against the OpenAPI bundle; a test lists all routes and fails on any without `x-permission` | yes |
| Amazon client contract | Vitest | request builders validated against the generated schemas from `refs/` models; fixtures validated against response schemas; v0 adapter list = exception table | yes |
| Ingestion | Vitest + fixtures | each sync definition: parse recorded report/export/Parquet files, upsert twice → same rows (idempotency), restatement replaces, cursor advances; 429 / `Retry-After` / 5xx sequences scripted | yes |
| Command executor | Vitest + fixtures | 207 mixed results, retry-only-failed, reconcile after timeout, replace-semantics full record, caps and kill switch | yes |
| UI components | Storybook (current major) + interaction tests + Vitest/RTL | every `packages/ui` component and module widgets; UX rules (UX-01..UX-23) as stories | yes |
| E2E | Playwright | docker compose stack + Amazon mock server (fixture-driven): sign-in, connect (mock LWA), sync, Campaign Manager, bulk edit with partial failure, rule preview/approve | yes (smoke set), full set nightly |
| Sandbox smoke | Vitest script `pnpm smoke:amazon` | SP-API sandbox + Ads test account: LWA, one read per API family, one Ads CRUD round trip | **no** — manual / nightly with secrets (P3-SMOKE, Gate 3) |

Fixtures: `packages/testing/fixtures/<api>/<operation>/<case>.json|.gz|.parquet`, recorded from sandbox/test
accounts or synthesised from the model schemas, **redacted** by a recorder that strips tokens, ids of real sellers
and any PII field; a fixture refresh is a deliberate task, not part of CI.

Coverage gates: changed-lines coverage ≥ 80 % for `packages/amazon-core`, `packages/ingestion`,
`modules/platform-commands`, `modules/automation`; no global percentage gate elsewhere.

## Consequences

- CI needs Docker (Postgres, Redis, MinIO service containers).
- Report/metric logic is tested on synthetic fixtures until real accounts exist (D30); P3-SMOKE validates the
  wiring only.
- The Amazon mock server doubles as the dev "demo mode" (no credentials needed to run the UI).

## Revisit when

D30 grants a real read-only seller account (add a recorded "golden" fixture set), or CI time exceeds budget.
