# ADR-0013 — Observability

Status: Accepted, pending Gate 2 (D20) · Date: 2026-11-10 · Task: P2-ARCH

## Context

Self-hosters (D1 a first) run seller-hub without an SRE team; the cloud shape (D21 assumption: AWS) has managed
tooling. What must be visible: sync lag per seller account and sync, Amazon throttling, command failures, rule
runs, connection health (`needs_reauth`). Legacy keeps a trace id per request (worth keeping, legacy-api-domain
§1.11) but logs secrets (trap 3) and posts errors to a chat room (replacement map row 25).

## Options

| Option | For | Against |
|---|---|---|
| **OpenTelemetry SDK (traces + metrics) + pino JSON logs; exporters chosen by deployment (OTLP / Prometheus / CloudWatch); operational state also in Postgres tables shown in-app** | vendor-neutral; works with nothing configured (in-app health page) and with a full stack; trace context across api → queue → worker | some setup per shape |
| Vendor APM agent (Datadog, New Relic) | rich out of the box | cost and lock-in; not appropriate to ship to self-hosters |
| Logs only | simplest | no latency/throttle metrics; hard to correlate jobs |

## Decision

1. **Logs**: pino JSON to stdout, allow-list serialisers and redaction (conventions §7); fields `traceId`,
   `spanId`, `tenantId`, `sellerAccountId`, `jobId`, `commandId`, `operationId`.
2. **Traces**: OpenTelemetry Node SDK with HTTP/Fastify/undici/pg/ioredis instrumentation; trace context is put in
   BullMQ job data and restored in the worker, so a user's bulk edit shows API → outbox → executor → Amazon calls as
   one trace. Exporter: OTLP (endpoint from env), off by default in self-host.
3. **Metrics** (OTel; Prometheus `/metrics` on an internal port in self-host, OTLP/CloudWatch in cloud):
   `amazon_requests_total{api,operation,status}`, `amazon_throttled_total{api,operation}`,
   `amazon_request_duration_seconds`, `limiter_wait_seconds`, `queue_depth{queue}`, `job_duration_seconds{family}`,
   `job_failures_total{family}`, `sync_lag_seconds{sync}` (max over seller accounts), `commands_total{kind,status}`,
   `command_items_failed_total{kind,code}`.
4. **Operational tables** (source of truth for health, readable without any monitoring stack):
   `ingest.sync_states` (last success, lag, status, last error), `ingest.job_runs` (each run with timings, Amazon ids,
   row counts, error), `ops.commands` / `ops.rule_runs`. An in-app **System health** page (Owner/Admin) shows sync
   freshness per seller account and sync, throttling in the last hour, failing jobs, connections needing re-auth.
   The UI shows a freshness badge on every data screen (`freshness` in list responses, conventions §4).
5. **Alerting**:
   - in-app (MVP): health flags on the System health page and a banner for Owner/Admin when a sync is `failing`,
     lag > 2 × its schedule interval, a connection is `needs_reauth`, or a command fails entirely; email to
     Owner/Admin for `needs_reauth` and rule-run failures (SMTP if configured). Tenant channels (Slack/Teams/webhook)
     arrive with PLT-08 (v1).
   - operator (cloud): alert rules on `sync_lag_seconds`, `amazon_throttled_total` rate, `job_failures_total`,
     queue depth, DB/Redis health — defined in P6-DEPLOY.
6. **Health endpoints**: `/healthz` (liveness), `/readyz` (DB, Redis, object store reachable; migrations current) for
   api and worker; no internal state in public responses.

## Consequences

- Self-hosters get useful health without Grafana; operators can plug a stack in via env.
- Trace propagation through the queue is a P3-INGEST + P3-SCAFFOLD responsibility.
- Retention of `job_runs` is bounded (ADR-0009).

## Revisit when

SaaS launches (add SLOs per tenant, on-call routing) or volume makes table-based health queries expensive.
