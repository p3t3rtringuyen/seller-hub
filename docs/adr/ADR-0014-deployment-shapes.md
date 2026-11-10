# ADR-0014 — Deployment shapes: self-host and cloud

Status: Accepted, pending Gate 2 (D20) — D21 DECIDED 2026-11-10 (default: docker compose self-host + AWS cloud). · Date: 2026-11-10 · Task: P2-ARCH

## Context

D1 c: self-host first (each seller deploys, with their own private SP-API app and Ads LWA client), SaaS after
P6-SEC. D58 a: Marketing Stream v2 delivers Parquet to an **S3 bucket + SQS queue in AWS** (self-host: the seller's
own AWS; SaaS: a shared bucket with per-tenant prefixes). SP-API notifications deliver to SQS or EventBridge
(`docs/discovery/reference-patterns.md` §1.3, `catalog/spapi/notifications.json`). So both shapes touch AWS for push
data even when the app runs elsewhere. The application images must be identical across shapes.

## Options

**Self-host**
| Option | For | Against |
|---|---|---|
| **docker compose** (one host) | one command; matches the expected scale (one seller, few users); easy backups | single host; manual upgrades |
| Kubernetes / Helm | HA, scaling | far beyond a single seller's needs; operational burden |
| Single all-in-one container | simplest install | mixes stateful services; hard upgrades |

**Cloud (SaaS, later)**
| Option | For | Against |
|---|---|---|
| **AWS: ECS Fargate + RDS PostgreSQL 16 + ElastiCache Redis + S3 + KMS + SQS + Secrets Manager** | Stream v2 / notifications are AWS-native; KMS for the vault; managed Postgres 16 | AWS lock-in for the hosted product only |
| AWS EKS | portable manifests | cluster ops cost for a small team |
| Other cloud (GCP/Azure) + AWS only for SQS/S3 | cloud preference | cross-cloud egress and two IAM worlds |

## Decision (proposed)

Same three images (`web`, `api`, `worker`) in both shapes; behaviour differs only by env.

| Concern | Self-host (docker compose) | Cloud (AWS) |
|---|---|---|
| Processes | `web`, `api`, `worker` (scheduler leader elected by Redis lock; scale workers with `--scale worker=N`), `migrate` one-shot | ECS services `web`, `api`, `worker` (autoscale on queue depth), `migrate` task per release |
| Postgres 16 | `postgres:16` container, volume, nightly `pg_dump` sidecar to the object store | RDS PostgreSQL 16, Multi-AZ, PITR |
| Redis 7 | container, AOF on, `maxmemory-policy noeviction` (BullMQ requirement) | ElastiCache (noeviction), Multi-AZ |
| Object store | MinIO container | S3 with lifecycle rules |
| Vault KEK | `SH_MASTER_KEYS` env (ADR-0005) | KMS key per environment |
| App secrets (LWA client id/secret) | `.env.local` | Secrets Manager → task env |
| TLS / ingress | Caddy container (automatic HTTPS) or the user's proxy | ALB + ACM |
| Stream v2 / SP notifications (v1) | seller's own AWS account: S3 bucket + SQS queue created by a provided CloudFormation template; worker reads with an IAM user/role key stored in the vault (`aws_stream` kind) | shared S3 bucket and SQS per region, prefixes per tenant; IAM role of the worker task |
| Email | SMTP env (optional) | SES |
| Observability | in-app health + optional Prometheus/OTLP | CloudWatch / OTLP collector, alarms |
| Upgrades | `docker compose pull && up -d`; `migrate` runs first; forward-only migrations (ADR-0009) | blue/green per service; migrate task gates deploy |
| Ports / project name | configurable (`COMPOSE_PROJECT_NAME`, port offset) — PLAN concurrency rule | n/a |

Not in either shape: Keycloak (ADR-0004), Kafka (replaced by BullMQ + tables), any proxy to Amazon (D52).

## Consequences

- P3-SCAFFOLD writes `docker-compose.yml` (+ `docker-compose.dev.yml`) and Dockerfiles; P6-DEPLOY writes the AWS
  infrastructure (IaC tool chosen then) and the self-host CloudFormation template for Stream/notifications.
- A self-hoster who does not want AWS at all still gets everything except Stream v2 and push notifications
  (reports + polling still work; freshness ~ daily per D58 b behaviour).

## Revisit when

D21 is decided differently (e.g. another cloud), or D40 sets hosting and operator constraints.
