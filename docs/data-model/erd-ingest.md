# ERD — `ingest`

DDL: `db/design/04_ingest.sql`. All rows carry `tenant_id`, `seller_account_id`.

```mermaid
erDiagram
  seller_accounts ||--o{ sync_states : "one per sync key x scope"
  sync_states ||--o{ job_runs : "runs (logical link)"
  job_runs ||--o{ raw_objects : "landed documents (logical link)"
  seller_accounts ||--o{ inbox : "push messages (v1)"

  sync_states {
    uuid id PK
    text sync_key UK
    text scope_key UK
    text status
    timestamptz next_run_at
    timestamptz last_success_at
    jsonb cursor
  }
  job_runs {
    uuid id PK
    timestamptz created_at PK "partition key, monthly, 90 d"
    text job_key
    text family
    text state "requested..done|failed"
    text amazon_request_id
  }
  raw_objects {
    uuid id PK
    timestamptz landed_at PK "partition key, monthly, 35 d"
    text object_key
    timestamptz expires_at
  }
  inbox {
    uuid id PK
    text source
    text message_id UK
    text status
  }
  seller_accounts {
    uuid id PK
  }
```

`job_runs` and `raw_objects` are partitioned; links to them are logical (no FK) so partitions can be dropped
independently.
