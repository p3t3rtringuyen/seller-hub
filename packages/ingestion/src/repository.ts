import { uuidv7, requireSellerScope, type SellerScope } from "@seller-hub/core";
import { withScope, type Database, type ScopedTx } from "@seller-hub/db";
import { sql, type Transaction } from "kysely";
import type { DB } from "@seller-hub/db";
import type { PriorityClass } from "./types";

// The only SQL of the engine. Two kinds of function, never mixed:
//  - SCOPED (first argument is a SellerScope): run through `withScope`, so RLS pins them to one tenant and one
//    seller account. Every run step uses these.
//  - SYSTEM (first argument is the owner `Database`): the scheduler's cross-tenant claim of due rows and the
//    partition maintenance. They read/write ids and schedule state only.

export type Trx = Transaction<DB> | ScopedTx;

export type RunState =
  | "requested"
  | "processing"
  | "downloading"
  | "parsing"
  | "upserting"
  | "done"
  | "failed"
  | "cancelled";
export const TERMINAL_STATES: readonly RunState[] = ["done", "failed", "cancelled"];

export interface RunRow {
  id: string;
  createdAt: Date;
  tenantId: string;
  sellerAccountId: string;
  syncStateId: string | null;
  syncKey: string;
  family: string;
  priority: PriorityClass;
  jobKey: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  state: RunState;
  amazonRequestId: string | null;
  amazonDocumentId: string | null;
  attempts: number;
  rowsUpserted: number | null;
  errorCode: string | null;
  errorDetail: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  traceId: string | null;
}

export interface SyncStateRow {
  id: string;
  tenantId: string;
  sellerAccountId: string;
  syncKey: string;
  scopeKey: string;
  status: string;
  pausedReason: string | null;
  nextRunAt: Date | null;
  lastStartedAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  cursor: Record<string, unknown>;
  backfill: Record<string, unknown> | null;
}

/** Per-run scratch kept in `sync_states.cursor.runs[runId]` while a run is in flight. */
export interface RunScratch {
  nextToken?: string | null;
  pages?: number;
  throttles?: number;
  rows?: number;
  entityIds?: string[];
  /** The last page was committed: a resume must not start over (nextToken null alone is ambiguous). */
  complete?: boolean;
  /** Heartbeat: when the next step of this run is due (see findStaleRuns). */
  nextStepAt?: string;
  /** Step number of the job that must run next (R1). */
  nextStep?: number;
  /** Part keys landed in the object store, in order. */
  parts?: { key: string; sourceRef?: string }[];
}

type Row = Record<string, unknown>;
const d = (v: unknown): Date | null =>
  v == null ? null : v instanceof Date ? v : new Date(String(v));

function mapRun(r: Row): RunRow {
  return {
    id: r.id as string,
    createdAt: d(r.created_at) as Date,
    tenantId: r.tenant_id as string,
    sellerAccountId: r.seller_account_id as string,
    syncStateId: (r.sync_state_id as string | null) ?? null,
    syncKey: r.sync_key as string,
    family: r.family as string,
    priority: r.priority_class as PriorityClass,
    jobKey: r.job_key as string,
    windowStart: d(r.window_start),
    windowEnd: d(r.window_end),
    state: r.state as RunState,
    amazonRequestId: (r.amazon_request_id as string | null) ?? null,
    amazonDocumentId: (r.amazon_document_id as string | null) ?? null,
    attempts: Number(r.attempts ?? 0),
    rowsUpserted: r.rows_upserted == null ? null : Number(r.rows_upserted),
    errorCode: (r.error_code as string | null) ?? null,
    errorDetail: (r.error_detail as string | null) ?? null,
    startedAt: d(r.started_at),
    finishedAt: d(r.finished_at),
    traceId: (r.trace_id as string | null) ?? null,
  };
}

function mapState(r: Row): SyncStateRow {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    sellerAccountId: r.seller_account_id as string,
    syncKey: r.sync_key as string,
    scopeKey: r.scope_key as string,
    status: r.status as string,
    pausedReason: (r.paused_reason as string | null) ?? null,
    nextRunAt: d(r.next_run_at),
    lastStartedAt: d(r.last_started_at),
    lastSuccessAt: d(r.last_success_at),
    lastFailureAt: d(r.last_failure_at),
    consecutiveFailures: Number(r.consecutive_failures ?? 0),
    lastErrorCode: (r.last_error_code as string | null) ?? null,
    cursor: (r.cursor as Record<string, unknown>) ?? {},
    backfill: (r.backfill as Record<string, unknown> | null) ?? null,
  };
}

// --- scoped: sync states -------------------------------------------------------------------------------------

export async function getSyncState(
  scope: SellerScope,
  db: Database,
  id: string,
): Promise<SyncStateRow | null> {
  const s = requireSellerScope(scope);
  return withScope(db, s, async (trx) => {
    const res = await sql<Row>`select * from ingest.sync_states
      where id = ${id} and tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}`.execute(
      trx,
    );
    return res.rows[0] ? mapState(res.rows[0]) : null;
  });
}

export async function findSyncState(
  scope: SellerScope,
  db: Database,
  syncKey: string,
  scopeKey: string,
): Promise<SyncStateRow | null> {
  const s = requireSellerScope(scope);
  return withScope(db, s, async (trx) => {
    const res = await sql<Row>`select * from ingest.sync_states
      where tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}
        and sync_key = ${syncKey} and scope_key = ${scopeKey}`.execute(trx);
    return res.rows[0] ? mapState(res.rows[0]) : null;
  });
}

export async function listSyncStates(scope: SellerScope, db: Database): Promise<SyncStateRow[]> {
  const s = requireSellerScope(scope);
  return withScope(db, s, async (trx) => {
    const res = await sql<Row>`select * from ingest.sync_states
      where tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}
      order by sync_key, scope_key`.execute(trx);
    return res.rows.map(mapState);
  });
}

export async function readScratch(
  trx: Trx,
  syncStateId: string,
  runId: string,
): Promise<RunScratch> {
  const res = await sql<{ s: RunScratch | null }>`
    select cursor #> array['runs', ${runId}::text] as s from ingest.sync_states where id = ${syncStateId}`.execute(
    trx,
  );
  return res.rows[0]?.s ?? {};
}

export async function writeScratch(
  trx: Trx,
  syncStateId: string,
  runId: string,
  scratch: RunScratch,
): Promise<void> {
  await sql`
    update ingest.sync_states
       set cursor = jsonb_set(jsonb_set(cursor, '{runs}', coalesce(cursor->'runs', '{}'::jsonb), true),
                              array['runs', ${runId}::text], ${JSON.stringify(scratch)}::jsonb, true)
     where id = ${syncStateId}`.execute(trx);
}

export async function markRunning(
  trx: Trx,
  syncStateId: string,
  now: Date,
  leaseMs: number,
): Promise<void> {
  await sql`update ingest.sync_states
      set status = 'running', last_started_at = ${now}, next_run_at = ${new Date(now.getTime() + leaseMs)}
    where id = ${syncStateId} and status <> 'paused' and status <> 'disabled'`.execute(trx);
}

export interface SuccessPatch {
  cursor: Record<string, unknown>;
  now: Date;
  /** The next scheduled run; null = none (a sync without a schedule runs only on demand). */
  nextRunAt: Date | null;
  lastRun: { runId: string; rows: number; durationMs: number; throttles: number };
}

/** Success: drop the run's scratch, store the new cursor and last-run summary, schedule the next run. */
export async function finishSyncSuccess(
  trx: Trx,
  syncStateId: string,
  runId: string,
  p: SuccessPatch,
): Promise<void> {
  const cursorJson = JSON.stringify(p.cursor);
  await sql`
    update ingest.sync_states s set
      cursor = jsonb_set(
                 (${cursorJson}::jsonb || jsonb_build_object('runs', coalesce(s.cursor->'runs', '{}'::jsonb)))
                 #- array['runs', ${runId}::text],
                 '{lastRun}', ${JSON.stringify(p.lastRun)}::jsonb, true),
      status = case when s.status in ('paused', 'disabled') then s.status else 'idle' end,
      last_success_at = ${p.now}, consecutive_failures = 0, last_error_code = null,
      next_run_at = ${p.nextRunAt}::timestamptz
    where s.id = ${syncStateId}`.execute(trx);
}

export async function finishSyncFailure(
  trx: Trx,
  syncStateId: string,
  runId: string,
  p: { now: Date; errorCode: string; nextRunAt: Date; throttles: number },
): Promise<void> {
  await sql`
    update ingest.sync_states s set
      cursor = jsonb_set(s.cursor #- array['runs', ${runId}::text], '{lastRun}',
                         ${JSON.stringify({ runId, failed: true, throttles: p.throttles })}::jsonb, true),
      status = case when s.status in ('paused', 'disabled') then s.status else 'failing' end,
      last_failure_at = ${p.now}, consecutive_failures = s.consecutive_failures + 1,
      last_error_code = ${p.errorCode}, next_run_at = ${p.nextRunAt}
    where s.id = ${syncStateId}`.execute(trx);
}

/** A connection needs the seller to reconnect: pause every sync of that API for the account (decision 11). */
export async function pauseSyncs(
  scope: SellerScope,
  db: Database,
  syncKeys: readonly string[],
  reason: string,
): Promise<number> {
  const s = requireSellerScope(scope);
  if (syncKeys.length === 0) return 0;
  return withScope(db, s, async (trx) => {
    const res = await sql`update ingest.sync_states
        set status = 'paused', paused_reason = ${reason}
      where tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}
        and status not in ('paused', 'disabled')
        and sync_key in (${sql.join([...syncKeys])})`.execute(trx);
    return Number(res.numAffectedRows ?? 0);
  });
}

// --- scoped: runs --------------------------------------------------------------------------------------------

export interface NewRun {
  syncStateId: string;
  syncKey: string;
  scopeKey: string;
  family: string;
  priority: PriorityClass;
  windowStart: Date | null;
  windowEnd: Date | null;
  traceId: string;
  entityIds?: readonly string[];
  /** Distinguishes runs that share a window (entity refreshes). */
  keySuffix?: string;
  now: Date;
}

/** job_key = {syncKey}:{sellerAccountId}[:{scopeKey}]:{windowStart}:{windowEnd} (ADR-0008 decision 5). */
export const jobKeyOf = (
  sellerAccountId: string,
  r: Pick<NewRun, "syncKey" | "scopeKey" | "windowStart" | "windowEnd" | "keySuffix">,
): string =>
  [
    r.syncKey,
    sellerAccountId,
    ...(r.scopeKey ? [r.scopeKey] : []),
    r.windowStart?.toISOString() ?? "-",
    r.windowEnd?.toISOString() ?? "-",
    ...(r.keySuffix ? [r.keySuffix] : []),
  ].join(":");

/**
 * Creates the run row, or returns the existing OPEN run with the same job key (a duplicate enqueue resumes,
 * never starts a second run). `created` says which happened.
 */
export async function createRun(
  scope: SellerScope,
  db: Database,
  n: NewRun,
): Promise<{ run: RunRow; created: boolean }> {
  const s = requireSellerScope(scope);
  return withScope(db, s, async (trx) => {
    const jobKey = jobKeyOf(s.sellerAccountId, n);
    const open = await sql<Row>`select * from ingest.job_runs
      where seller_account_id = ${s.sellerAccountId} and tenant_id = ${s.tenantId} and job_key = ${jobKey}
        and state not in ('done', 'failed', 'cancelled')
      order by created_at desc limit 1`.execute(trx);
    if (open.rows[0]) return { run: mapRun(open.rows[0]), created: false };
    const id = uuidv7(n.now.getTime());
    const res = await sql<Row>`insert into ingest.job_runs
        (id, tenant_id, seller_account_id, sync_state_id, sync_key, family, priority_class, job_key,
         window_start, window_end, trace_id, created_at)
      values (${id}, ${s.tenantId}, ${s.sellerAccountId}, ${n.syncStateId}, ${n.syncKey}, ${n.family}, ${n.priority},
              ${jobKey}, ${n.windowStart}, ${n.windowEnd}, ${n.traceId}, ${n.now})
      returning *`.execute(trx);
    const run = mapRun(res.rows[0] as Row);
    if (n.entityIds?.length)
      await writeScratch(trx, n.syncStateId, id, { entityIds: [...n.entityIds] });
    return { run, created: true };
  });
}

/**
 * The open run of a sync that carries the live schedule (not a backfill window, not an entity refresh), if any.
 * A scheduled window ends "now", so two requests never share a job key: this is what makes a second request, or a tick
 * that finds the sync due while its refresh is still queued, join the live run instead of starting another (B1).
 */
export async function findOpenSyncRun(
  scope: SellerScope,
  db: Database,
  syncStateId: string,
): Promise<RunRow | null> {
  const s = requireSellerScope(scope);
  return withScope(db, s, async (trx) => {
    const res = await sql<Row>`select * from ingest.job_runs
      where sync_state_id = ${syncStateId} and tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}
        and state not in ('done', 'failed', 'cancelled')
        and priority_class <> 'backfill' and family <> 'entity-refresh'
      order by created_at desc limit 1`.execute(trx);
    return res.rows[0] ? mapRun(res.rows[0]) : null;
  });
}

export async function getRun(
  scope: SellerScope,
  db: Database,
  runId: string,
  createdAt: Date,
): Promise<RunRow | null> {
  const s = requireSellerScope(scope);
  return withScope(db, s, async (trx) => {
    const res = await sql<Row>`select * from ingest.job_runs
      where id = ${runId} and created_at = ${createdAt}
        and tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}`.execute(trx);
    return res.rows[0] ? mapRun(res.rows[0]) : null;
  });
}

export interface RunPatch {
  state?: RunState;
  amazonRequestId?: string | null;
  amazonDocumentId?: string | null;
  attempts?: number;
  rowsUpserted?: number;
  errorCode?: string | null;
  errorDetail?: string | null;
  startedAt?: Date;
  finishedAt?: Date;
}

export async function patchRun(trx: Trx, run: RunRow, p: RunPatch): Promise<void> {
  await sql`update ingest.job_runs set
      state = coalesce(${p.state ?? null}, state),
      amazon_request_id = case when ${p.amazonRequestId !== undefined} then ${p.amazonRequestId ?? null} else amazon_request_id end,
      amazon_document_id = case when ${p.amazonDocumentId !== undefined} then ${p.amazonDocumentId ?? null} else amazon_document_id end,
      attempts = coalesce(${p.attempts ?? null}, attempts),
      rows_upserted = coalesce(${p.rowsUpserted ?? null}, rows_upserted),
      error_code = case when ${p.errorCode !== undefined} then ${p.errorCode ?? null} else error_code end,
      error_detail = case when ${p.errorDetail !== undefined} then ${p.errorDetail ?? null} else error_detail end,
      started_at = coalesce(started_at, ${p.startedAt ?? null}),
      finished_at = coalesce(${p.finishedAt ?? null}, finished_at)
    where id = ${run.id} and created_at = ${run.createdAt}
      and tenant_id = ${run.tenantId} and seller_account_id = ${run.sellerAccountId}`.execute(trx);
}

export async function scoped<T>(
  scope: SellerScope,
  db: Database,
  fn: (trx: ScopedTx) => Promise<T>,
): Promise<T> {
  return withScope(db, requireSellerScope(scope), fn);
}

export async function insertRawObject(
  trx: Trx,
  p: {
    tenantId: string;
    sellerAccountId: string;
    runId: string;
    syncKey: string;
    objectKey: string;
    part: number;
    contentType: string | null;
    byteSize: number;
    sha256: Buffer;
    sourceRef: string | null;
    now: Date;
    expiresAt: Date;
  },
): Promise<void> {
  await sql`insert into ingest.raw_objects
      (id, tenant_id, seller_account_id, job_run_id, sync_key, object_key, part, content_type, compression,
       byte_size, sha256, source_ref, landed_at, expires_at)
    values (${uuidv7(p.now.getTime())}, ${p.tenantId}, ${p.sellerAccountId}, ${p.runId}, ${p.syncKey}, ${p.objectKey},
            ${p.part}, ${p.contentType}, 'none', ${p.byteSize}, ${p.sha256}, ${p.sourceRef}, ${p.now}, ${p.expiresAt})`.execute(
    trx,
  );
}

export async function listRawObjects(
  scope: SellerScope,
  db: Database,
  runId: string,
): Promise<{ objectKey: string; part: number; sourceRef: string | null }[]> {
  const s = requireSellerScope(scope);
  return withScope(db, s, async (trx) => {
    const res = await sql<{ object_key: string; part: number; source_ref: string | null }>`
      select object_key, part, source_ref from ingest.raw_objects
       where job_run_id = ${runId} and tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}
       order by part`.execute(trx);
    return res.rows.map((r) => ({
      objectKey: r.object_key,
      part: r.part,
      sourceRef: r.source_ref,
    }));
  });
}

export async function listRuns(
  scope: SellerScope,
  db: Database,
  opts: { syncKey?: string; limit?: number } = {},
): Promise<RunRow[]> {
  const s = requireSellerScope(scope);
  return withScope(db, s, async (trx) => {
    const res = await sql<Row>`select * from ingest.job_runs
      where tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}
        ${opts.syncKey ? sql`and sync_key = ${opts.syncKey}` : sql``}
      order by created_at desc limit ${opts.limit ?? 50}`.execute(trx);
    return res.rows.map(mapRun);
  });
}

// --- system (cross-tenant; scheduler and maintenance only) -------------------------------------------------------

export interface EnsureState {
  tenantId: string;
  sellerAccountId: string;
  syncKey: string;
  scopeKey: string;
  /** null = no schedule (runs only on demand). */
  nextRunAt: Date | null;
}

/** Inserts missing (account, sync, scope) rows; existing rows are left alone. Returns how many were created. */
export async function ensureSyncStates(
  system: Database,
  rows: readonly EnsureState[],
): Promise<number> {
  let created = 0;
  await system.transaction().execute(async (trx) => {
    for (const r of rows) {
      const res = await sql`insert into ingest.sync_states
          (id, tenant_id, seller_account_id, sync_key, scope_key, status, next_run_at)
        values (${uuidv7()}, ${r.tenantId}, ${r.sellerAccountId}, ${r.syncKey}, ${r.scopeKey}, 'idle', ${r.nextRunAt})
        on conflict (seller_account_id, sync_key, scope_key) do nothing`.execute(trx);
      created += Number(res.numAffectedRows ?? 0);
    }
  });
  return created;
}

export interface DueState {
  id: string;
  tenantId: string;
  sellerAccountId: string;
  syncKey: string;
  scopeKey: string;
  cursor: Record<string, unknown>;
}

/**
 * Claims up to `limit` due rows (skip locked, so two ticks never take the same row) and gives each a lease: until
 * `now + leaseMs` it is not due again. A crashed worker's row becomes due again when the lease runs out.
 */
export async function claimDueStates(
  system: Database,
  now: Date,
  limit: number,
  leaseMs: number,
): Promise<DueState[]> {
  const res = await sql<Row>`
    with due as (
      select id from ingest.sync_states
       where status in ('idle', 'scheduled', 'failing', 'running') and next_run_at <= ${now}
       order by next_run_at limit ${limit} for update skip locked)
    update ingest.sync_states s
       set status = case when s.status = 'running' then 'running' else 'scheduled' end,
           next_run_at = ${new Date(now.getTime() + leaseMs)}
      from due where s.id = due.id
    returning s.id, s.tenant_id, s.seller_account_id, s.sync_key, s.scope_key, s.cursor`.execute(
    system,
  );
  return res.rows.map((r) => ({
    id: r.id as string,
    tenantId: r.tenant_id as string,
    sellerAccountId: r.seller_account_id as string,
    syncKey: r.sync_key as string,
    scopeKey: r.scope_key as string,
    cursor: (r.cursor as Record<string, unknown>) ?? {},
  }));
}

/** Pause/unpause according to the directory: `needs_reauth` and friends pause, a healthy connection resumes. */
export async function reconcilePaused(
  system: Database,
  p: {
    tenantId: string;
    sellerAccountId: string;
    /** Sync keys of the definitions that use this API (decided by the definition, not by the key prefix). */
    syncKeys: readonly string[];
    reason: string | undefined;
    now: Date;
  },
): Promise<void> {
  if (p.syncKeys.length === 0) return;
  const keys = sql.join([...p.syncKeys]);
  if (p.reason) {
    await sql`update ingest.sync_states set status = 'paused', paused_reason = ${p.reason}
      where seller_account_id = ${p.sellerAccountId} and tenant_id = ${p.tenantId}
        and status not in ('paused', 'disabled') and sync_key in (${keys})`.execute(system);
  } else {
    await sql`update ingest.sync_states set status = 'idle', paused_reason = null, next_run_at = ${p.now}
      where seller_account_id = ${p.sellerAccountId} and tenant_id = ${p.tenantId}
        and status = 'paused' and paused_reason in ('needs_reauth', 'tenant_suspended', 'not_connected')
        and sync_key in (${keys})`.execute(system);
  }
}

/**
 * Retention (D64 a): drop monthly partitions of `ingest.job_runs` and `ingest.raw_objects` that lie wholly before
 * the horizon, and create the next months. Run by the maintenance job with the owner connection.
 */
export async function maintainPartitions(
  system: Database,
  now: Date,
  retention: { jobRunDays: number; rawDays: number },
): Promise<{ dropped: string[]; created: number }> {
  let created = 0;
  const dropped: string[] = [];
  for (const [table, days] of [
    ["ingest.job_runs", retention.jobRunDays],
    ["ingest.raw_objects", retention.rawDays],
  ] as const) {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const c = await sql<{ n: number }>`select core.ensure_monthly_partitions(
        ${table}::regclass, ${now}::date, (${now}::date + interval '3 months')::date) as n`.execute(
      system,
    );
    created += Number(c.rows[0]?.n ?? 0);
    const parts = await sql<{ name: string; bound: string }>`
      select c.relname as name, pg_get_expr(c.relpartbound, c.oid) as bound
        from pg_inherits i join pg_class c on c.oid = i.inhrelid
       where i.inhparent = ${table}::regclass`.execute(system);
    for (const p of parts.rows) {
      const m = /TO \('([^']+)'\)/.exec(p.bound);
      if (!m) continue;
      if (new Date(`${(m[1] as string).slice(0, 10)}T00:00:00Z`) <= cutoff) {
        await sql`drop table ${sql.id("ingest", p.name)}`.execute(system);
        dropped.push(`ingest.${p.name}`);
      }
    }
  }
  return { dropped, created };
}

// --- inbox (push sources) -------------------------------------------------------------------------------------

export interface InboxRow {
  id: string;
  source: "spapi-notification" | "marketing-stream";
  messageId: string;
  messageType: string;
  payload: unknown;
  status: string;
  attempts: number;
}

/** Inserts a push message; a duplicate (same source + message id) is ignored. Returns false for a duplicate. */
export async function insertInbox(
  scope: SellerScope,
  db: Database,
  m: {
    source: InboxRow["source"];
    messageId: string;
    messageType: string;
    payload: unknown;
    now: Date;
  },
): Promise<boolean> {
  const s = requireSellerScope(scope);
  return withScope(db, s, async (trx) => {
    const res = await sql`insert into ingest.inbox
        (id, tenant_id, seller_account_id, source, message_id, message_type, payload, received_at)
      values (${uuidv7(m.now.getTime())}, ${s.tenantId}, ${s.sellerAccountId}, ${m.source}, ${m.messageId},
              ${m.messageType}, ${JSON.stringify(m.payload)}::jsonb, ${m.now})
      on conflict (source, message_id) do nothing`.execute(trx);
    return Number(res.numAffectedRows ?? 0) === 1;
  });
}

export async function claimInbox(
  scope: SellerScope,
  db: Database,
  limit: number,
): Promise<InboxRow[]> {
  const s = requireSellerScope(scope);
  return withScope(db, s, async (trx) => {
    const res = await sql<Row>`
      with c as (select id from ingest.inbox
                  where status in ('pending', 'failed') and attempts < 5
                    and tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}
                  order by received_at limit ${limit} for update skip locked)
      update ingest.inbox i set status = 'processing', attempts = i.attempts + 1 from c where i.id = c.id
      returning i.*`.execute(trx);
    return res.rows.map((r) => ({
      id: r.id as string,
      source: r.source as InboxRow["source"],
      messageId: r.message_id as string,
      messageType: r.message_type as string,
      payload: r.payload,
      status: r.status as string,
      attempts: Number(r.attempts),
    }));
  });
}

export async function finishInbox(
  trx: Trx,
  id: string,
  result: { ok: true; now: Date } | { ok: false; errorCode: string },
): Promise<void> {
  if (result.ok)
    await sql`update ingest.inbox set status = 'done', error_code = null, processed_at = ${result.now} where id = ${id}`.execute(
      trx,
    );
  else
    await sql`update ingest.inbox set status = 'failed', error_code = ${result.errorCode} where id = ${id}`.execute(
      trx,
    );
}

/** Replay = reset the status (ADR-0008 decision 10; no separate DLQ table). */
export async function replayInbox(
  scope: SellerScope,
  db: Database,
  opts: { id?: string } = {},
): Promise<number> {
  const s = requireSellerScope(scope);
  return withScope(db, s, async (trx) => {
    const res =
      await sql`update ingest.inbox set status = 'pending', attempts = 0, error_code = null
      where status = 'failed' and tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}
        ${opts.id ? sql`and id = ${opts.id}` : sql``}`.execute(trx);
    return Number(res.numAffectedRows ?? 0);
  });
}

/** Distinct accounts with pending inbox rows (system view, used to fan out the inbox processor). */
export async function accountsWithPendingInbox(
  system: Database,
): Promise<{ tenantId: string; sellerAccountId: string }[]> {
  const res = await sql<{ tenant_id: string; seller_account_id: string }>`
    select distinct tenant_id, seller_account_id from ingest.inbox
     where status in ('pending', 'failed') and attempts < 5 limit 500`.execute(system);
  return res.rows.map((r) => ({ tenantId: r.tenant_id, sellerAccountId: r.seller_account_id }));
}

/**
 * Unfinished runs that are overdue: their own scheduled next step (`runs[runId].nextStepAt`, written every time a
 * step hands the run back) passed more than `graceMs` ago, or, with no heartbeat at all, the row has not changed for
 * `graceMs`. A run that is healthily waiting (a long poll, a Retry-After) is not stale.
 */
export async function findStaleRuns(
  system: Database,
  now: Date,
  graceMs: number,
  limit: number,
): Promise<{ run: RunRow; nextStep: number }[]> {
  const cutoff = new Date(now.getTime() - graceMs);
  const res = await sql<Row>`select jr.*,
      coalesce((s.cursor #>> array['runs', jr.id::text, 'nextStep'])::int, 0) as next_step
    from ingest.job_runs jr
    left join ingest.sync_states s on s.id = jr.sync_state_id
    where jr.state not in ('done', 'failed', 'cancelled')
      and coalesce((s.cursor #>> array['runs', jr.id::text, 'nextStepAt'])::timestamptz, jr.updated_at) < ${cutoff}
    order by jr.updated_at limit ${limit}`.execute(system);
  return res.rows.map((r) => ({ run: mapRun(r), nextStep: Number(r.next_step) }));
}

/** Heartbeat: when the next step of the run is due. Written whenever a step hands the run back to the queue. */
export async function setNextStepAt(
  trx: Trx,
  syncStateId: string,
  runId: string,
  at: Date,
  /** The step number of the job that must run next; older jobs of the run are dropped. Omit to keep it. */
  nextStep?: number,
): Promise<void> {
  await sql`
    update ingest.sync_states
       set cursor = jsonb_set(
             jsonb_set(
               jsonb_set(jsonb_set(cursor, '{runs}', coalesce(cursor->'runs', '{}'::jsonb), true),
                         array['runs', ${runId}::text], coalesce(cursor #> array['runs', ${runId}::text], '{}'::jsonb), true),
               array['runs', ${runId}::text, 'nextStepAt'], to_jsonb(${at.toISOString()}::text), true),
             array['runs', ${runId}::text, 'nextStep'],
             to_jsonb(coalesce(${nextStep ?? null}::int, (cursor #>> array['runs', ${runId}::text, 'nextStep'])::int, 0)), true)
     where id = ${syncStateId}`.execute(trx);
}

/**
 * Replaces the raw-object index of a run in ONE transaction, so a retried landing never leaves duplicate parts
 * (the index has no unique key: it is partitioned on landed_at).
 */
export async function replaceRawObjects(
  trx: Trx,
  p: { tenantId: string; sellerAccountId: string; runId: string },
  rows: readonly Parameters<typeof insertRawObject>[1][],
): Promise<void> {
  await sql`delete from ingest.raw_objects
    where job_run_id = ${p.runId} and tenant_id = ${p.tenantId} and seller_account_id = ${p.sellerAccountId}`.execute(
    trx,
  );
  for (const r of rows) await insertRawObject(trx, r);
}

/** D64 a: inbox rows that are done are kept as long as raw objects, failed ones 90 days. */
export async function purgeInbox(
  system: Database,
  now: Date,
  retention: { doneDays: number; failedDays: number },
): Promise<number> {
  const day = 86_400_000;
  const res = await sql`delete from ingest.inbox
    where (status = 'done' and received_at < ${new Date(now.getTime() - retention.doneDays * day)})
       or (status = 'failed' and received_at < ${new Date(now.getTime() - retention.failedDays * day)})`.execute(
    system,
  );
  return Number(res.numAffectedRows ?? 0);
}

/** Backfill and entity-refresh runs do not touch the cursor or the schedule; they only drop their scratch. */
export async function finishAuxRun(trx: Trx, syncStateId: string, runId: string): Promise<void> {
  await sql`update ingest.sync_states set cursor = cursor #- array['runs', ${runId}::text]
    where id = ${syncStateId}`.execute(trx);
}

/** The sweep re-enqueued this run: push its next-step time out so the next tick does not do it again (R1). */
export async function bumpNextStepAt(system: Database, run: RunRow, at: Date): Promise<void> {
  if (!run.syncStateId) return;
  const stateId = run.syncStateId;
  await system.transaction().execute((trx) => setNextStepAt(trx, stateId, run.id, at));
}

/** Creates the sync-state row for one (sync, scope) under the caller's scope (RLS WITH CHECK applies): no owner role. */
export async function ensureSyncStateScoped(
  scope: SellerScope,
  db: Database,
  r: { syncKey: string; scopeKey: string; nextRunAt: Date | null },
): Promise<void> {
  const s = requireSellerScope(scope);
  await withScope(db, s, async (trx) => {
    await sql`insert into ingest.sync_states
        (id, tenant_id, seller_account_id, sync_key, scope_key, status, next_run_at)
      values (${uuidv7()}, ${s.tenantId}, ${s.sellerAccountId}, ${r.syncKey}, ${r.scopeKey}, 'idle', ${r.nextRunAt})
      on conflict (seller_account_id, sync_key, scope_key) do nothing`.execute(trx);
  });
}
