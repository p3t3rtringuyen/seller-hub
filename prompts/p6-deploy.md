# P6-DEPLOY — Release shapes

Model: Sonnet · checkout: worktree (commit on your branch)
OWNED_PATHS: `deploy/**`, `apps/*/Dockerfile`, `docs/onboarding/**`, `docs/operations/**`,
`docs/reports/P6-DEPLOY.md`

## Goal

Two ways to run seller-hub (D21, D40): a seller hosts it themselves, or it runs in the cloud.

## Build

- Production Dockerfiles per app (multi-stage, non-root, health checks).
- `deploy/self-host/` — docker compose for production: Postgres with backups, Redis, object
  storage, the apps, a reverse proxy with TLS; migrations on start; an `.env.example` for it.
- `deploy/cloud/` — infrastructure as code for the D21 target (for AWS: managed Postgres, Redis,
  container service, SQS queues for SP-API notifications and Marketing Stream, object storage,
  KMS, secrets manager), with environments `staging` and `production`.
- Observability wiring per the ADR; dashboards and alerts for sync lag, throttling, job failures.
- `docs/operations/` — runbooks: deploy, roll back, restore a backup, rotate keys, re-auth a
  seller, handle an Amazon outage.
- `docs/onboarding/self-host.md` — for a seller, step by step: register a private SP-API app,
  apply for the Ads API, self-authorize, configure, first sync. Written for a non-developer
  operator. Plus `docs/onboarding/saas.md` if D1 includes (b).

## Done when

A clean machine following `docs/onboarding/self-host.md` reaches a running instance (verify with a
fresh compose project); IaC validates (`plan` / `validate`, no apply without the user); runbooks
reference real commands.
