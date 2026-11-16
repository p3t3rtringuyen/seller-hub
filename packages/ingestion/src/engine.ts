import { createHash } from "node:crypto";
import {
  AmazonThrottledError,
  ConnectionNeedsReauth,
  LocalRateLimitError,
  AmazonClientError,
  type ConcurrencyGate,
} from "@seller-hub/amazon-core";
import type { AdsClient, AdsReports } from "@seller-hub/amazon-ads";
import type { SpClient } from "@seller-hub/amazon-sp";
import type { Logger, SellerScope } from "@seller-hub/core";
import type { Database } from "@seller-hub/db";
import { DAY_MS, nextRunDelayMs } from "./duration";
import { timeZoneFor, windowDates } from "./windows";
import {
  adapterFor,
  DEFAULT_POLLING,
  type LandedDocument,
  type PollingConfig,
} from "./families/async-jobs";
import { isAdsDefinition, isPull, scopeKindOf } from "./definitions";
import type { SellerDirectory } from "./directory";
import { rawObjectKey, type ObjectStore } from "./object-store";
import * as repo from "./repository";
import type {
  DataKioskPort,
  IngestDefinition,
  PullDefinition,
  RunContext,
  RunEnqueuer,
  RunPayload,
  StepResult,
  SyncTarget,
  UpsertContext,
} from "./types";

export interface EngineConfig {
  /** Runs of one seller account per family at once (ADR-0008 decision 8). Default 2. */
  sellerConcurrency: number;
  /** A failed run is retried this many times (non-throttle failures). Default 4. */
  maxAttempts: number;
  /** A run delayed by throttling this many times is failed (a guard against a stuck limiter). Default 200. */
  maxThrottles: number;
  /** Paged pulls hand the worker back after this long so one big pull cannot hold a slot for hours. */
  stepBudgetMs: number;
  /** Lease on a claimed sync state: if the run has not finished by then the tick may start it again. */
  leaseMs: number;
  rawRetentionDays: number;
  jobRunRetentionDays: number;
  polling: PollingConfig;
  /** Base delay of the failure backoff (doubles per attempt, capped at 1 h). */
  backoffBaseMs: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  sellerConcurrency: 2,
  maxAttempts: 4,
  maxThrottles: 200,
  stepBudgetMs: 45_000,
  leaseMs: 2 * 60 * 60_000,
  rawRetentionDays: 35,
  jobRunRetentionDays: 90,
  polling: DEFAULT_POLLING,
  backoffBaseMs: 30_000,
};

export interface EngineDeps {
  /** `sh_app`: every run step. RLS applies. */
  db: Database;
  /** `sh_owner`: the scheduler's claim of due rows and partition maintenance only. */
  system: Database;
  directory: SellerDirectory;
  definitions: readonly IngestDefinition[];
  amazon: {
    sp: SpClient;
    ads: AdsClient;
    adsReports: AdsReports;
    gate: ConcurrencyGate;
    kiosk?: DataKioskPort;
  };
  objectStore: ObjectStore;
  enqueuer: RunEnqueuer;
  logger: Logger;
  now?: () => Date;
  random?: () => number;
  config?: Partial<EngineConfig>;
}

export interface Engine {
  readonly deps: Required<Pick<EngineDeps, "now" | "random">> & EngineDeps;
  readonly config: EngineConfig;
  readonly pull: ReadonlyMap<string, PullDefinition>;
  processRun(payload: RunPayload): Promise<StepResult>;
  buildContext(args: {
    scope: SellerScope;
    target: SyncTarget;
    def: PullDefinition;
    run: repo.RunRow;
    state: repo.SyncStateRow;
    entityIds?: readonly string[];
  }): RunContext;
}

const sanitize = (e: unknown): { code: string; detail: string } => {
  const message = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : "Error";
  const code =
    (e as { code?: unknown } | null)?.code && typeof (e as { code: unknown }).code === "string"
      ? String((e as { code: string }).code)
      : name;
  return { code: code.slice(0, 80), detail: message.slice(0, 500) };
};

export function createEngine(deps: EngineDeps): Engine {
  const config: EngineConfig = { ...DEFAULT_ENGINE_CONFIG, ...deps.config };
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const full = { ...deps, now, random };
  const pull = new Map<string, PullDefinition>(
    deps.definitions.filter(isPull).map((d) => [d.key, d]),
  );

  const keysFor = (api: "sp" | "ads"): string[] =>
    [...pull.values()].filter((d) => (isAdsDefinition(d) ? "ads" : "sp") === api).map((d) => d.key);

  function buildContext(a: {
    scope: SellerScope;
    target: SyncTarget;
    def: PullDefinition;
    run: repo.RunRow;
    state: repo.SyncStateRow;
    entityIds?: readonly string[];
  }): RunContext {
    const { scope, target, def, run, state } = a;
    const kind = scopeKindOf(def);
    const spScope = {
      tenantId: scope.tenantId,
      sellerAccountId: scope.sellerAccountId,
      region: target.region,
    };
    const tz = timeZoneFor(target, def, state.scopeKey);
    const { cursor: stateCursor } = state;
    const { runs: _runs, lastRun: _lastRun, ...cursor } = stateCursor as Record<string, unknown>;
    void _runs;
    void _lastRun;
    return {
      scope,
      target,
      syncKey: run.syncKey,
      scopeKey: state.scopeKey,
      runId: run.id,
      priority: run.priority,
      window: { start: run.windowStart, end: run.windowEnd },
      timeZone: tz,
      dates: windowDates({ start: run.windowStart, end: run.windowEnd }, tz),
      cursor,
      entityIds: a.entityIds,
      marketplaceIds: kind === "marketplace" ? [state.scopeKey] : target.marketplaceIds,
      spScope,
      adsScope: {
        ...spScope,
        ...(state.scopeKey && kind === "ads-profile" ? { profileId: state.scopeKey } : {}),
      },
      sp: deps.amazon.sp,
      ads: deps.amazon.ads,
      adsReports: deps.amazon.adsReports,
      kiosk: deps.amazon.kiosk,
      log: deps.logger.child({
        syncKey: run.syncKey,
        runId: run.id,
        tenantId: scope.tenantId,
        sellerAccountId: scope.sellerAccountId,
        traceId: run.traceId,
      }),
      now,
    };
  }

  const backoffMs = (attempt: number): number =>
    Math.min(60 * 60_000, config.backoffBaseMs * 2 ** Math.max(0, attempt - 1)) *
    (0.75 + random() * 0.5);

  async function processRun(payload: RunPayload): Promise<StepResult> {
    const scope: SellerScope = {
      tenantId: payload.tenantId,
      sellerAccountId: payload.sellerAccountId,
    };
    const run = await repo.getRun(scope, deps.db, payload.runId, new Date(payload.runCreatedAt));
    if (!run) return { done: true, state: "missing" };
    if (repo.TERMINAL_STATES.includes(run.state)) return { done: true, state: run.state };

    const def = pull.get(run.syncKey);
    const state0 = run.syncStateId
      ? await repo.getSyncState(scope, deps.db, run.syncStateId)
      : null;
    if (!def || !state0) {
      await failRun(
        scope,
        run,
        state0,
        "unknown_definition",
        `no definition or sync state for ${run.syncKey}`,
        false,
      );
      return { done: true, state: "failed" };
    }
    let state: repo.SyncStateRow = state0;
    const target = await deps.directory.getTarget(scope);
    if (!target) {
      await cancelRun(scope, run, state, "account_unavailable");
      return { done: true, state: "cancelled" };
    }
    const api = isAdsDefinition(def) ? "ads" : "sp";
    if (target.paused[api]) {
      await repo.pauseSyncs(scope, deps.db, keysFor(api), target.paused[api] as string);
      await cancelRun(scope, run, state, target.paused[api] as string);
      return { done: true, state: "cancelled" };
    }
    if (target.connected?.[api] === false) {
      await cancelRun(scope, run, state, "not_connected");
      return { done: true, state: "cancelled" };
    }

    // One chain per run (B1): a second step chain of the same run (a stale re-enqueue racing a slow step) is dropped,
    // not delayed. The lease is longer than any step; it is released as soon as the step returns.
    const runLease = await deps.amazon.gate.tryAcquire(`ingest:run:${run.id}`, 1, 60 * 60_000);
    if (!runLease) return { done: true, state: "duplicate" };
    try {
      // One chain per run (R1, N7): the run stores the step it expects next; a job from an older step is a leftover of
      // a chain that was re-enqueued while the original was still queued, and it is dropped. Read AFTER the lease: a
      // chain that finished this step a moment ago has advanced it.
      const fresh = await repo.getSyncState(scope, deps.db, state.id);
      const expected =
        (fresh?.cursor.runs as Record<string, { nextStep?: number }> | undefined)?.[run.id]
          ?.nextStep ?? 0;
      if (payload.step < expected) return { done: true, state: "duplicate" };
      if (fresh) state = fresh;
      // Per-seller fairness (decision 8): at most N runs of this account and family at once.
      const lease = await deps.amazon.gate.tryAcquire(
        `ingest:seller:${scope.sellerAccountId}:${def.family}`,
        def.concurrency ?? config.sellerConcurrency,
        45 * 60_000,
      );
      const result: StepResult = lease
        ? await (async () => {
            try {
              return await step(scope, run, state, def, target);
            } finally {
              await lease.release();
            }
          })()
        : { done: false, delayMs: 5_000 + Math.floor(random() * 25_000), state: run.state };
      // Heartbeat: say when the next step is due, so a healthy wait is never mistaken for a dead chain.
      if (!result.done)
        await repo.scoped(scope, deps.db, (trx) =>
          repo.setNextStepAt(
            trx,
            state.id,
            run.id,
            new Date(now().getTime() + (result.delayMs ?? 0)),
            payload.step + 1,
          ),
        );
      return result;
    } finally {
      await runLease.release();
    }
  }

  async function step(
    scope: SellerScope,
    run: repo.RunRow,
    state: repo.SyncStateRow,
    def: PullDefinition,
    target: SyncTarget,
  ): Promise<StepResult> {
    const t0 = now();
    const scratch = await repo.scoped(scope, deps.db, (trx) =>
      repo.readScratch(trx, state.id, run.id),
    );
    const ctx = buildContext({
      scope,
      target,
      def,
      run,
      state,
      ...(scratch.entityIds ? { entityIds: scratch.entityIds } : {}),
    });
    const aux = run.priority === "backfill" || !!scratch.entityIds;
    try {
      if (!run.startedAt) {
        await repo.scoped(scope, deps.db, async (trx) => {
          await repo.patchRun(trx, run, { startedAt: t0 });
          if (!aux) await repo.markRunning(trx, state.id, t0, config.leaseMs);
        });
        run = { ...run, startedAt: t0 };
      }
      const rows =
        def.family === "paged-pull" || def.family === "sync-read"
          ? await pagedLoop(ctx, run, state, def, scratch, t0)
          : await asyncLoop(ctx, run, state, def, scratch);
      if (rows.next) return rows.next;
      return await finish(ctx, run, state, def, aux, t0, rows.total);
    } catch (e) {
      return await handleError(e, ctx, run, state, def, aux);
    }
  }

  // --- paged pull / sync read ---------------------------------------------------------------------------------

  async function pagedLoop(
    ctx: RunContext,
    run: repo.RunRow,
    state: repo.SyncStateRow,
    def: Extract<PullDefinition, { family: "paged-pull" | "sync-read" }>,
    scratch: repo.RunScratch,
    t0: Date,
  ): Promise<{ total: number; next?: StepResult }> {
    await markState(ctx, run, "processing");
    let total = scratch.rows ?? 0;
    if (scratch.entityIds && def.refreshEntities) {
      const rows = await def.refreshEntities(ctx, scratch.entityIds);
      total += await upsertAll(ctx, def, rows, state, run, scratch, null);
      return { total };
    }
    if (scratch.complete) return { total }; // crashed between the last page's commit and finish: do not start over
    let token = scratch.nextToken ?? undefined;
    let pages = scratch.pages ?? 0;
    for (;;) {
      const page = await def.fetchPage(ctx, token);
      const next = page.nextToken ?? null;
      pages += 1;
      total += page.rows.length;
      // The rows and the cursor move together: after a crash the run resumes at the first page not committed.
      await upsertAll(ctx, def, page.rows, state, run, { ...scratch, rows: total, pages }, next);
      if (!next) return { total };
      token = next;
      scratch = { ...scratch, nextToken: next, pages, rows: total };
      if (now().getTime() - t0.getTime() > config.stepBudgetMs)
        return { total, next: { done: false, delayMs: 0, state: "processing" } };
    }
  }

  /** Upserts `rows` in batches inside one scoped transaction; when `nextToken !== undefined` also persists progress. */
  async function upsertAll(
    ctx: RunContext,
    def: PullDefinition,
    rows: readonly unknown[],
    state: repo.SyncStateRow,
    run: repo.RunRow,
    scratch: repo.RunScratch,
    nextToken: string | null,
  ): Promise<number> {
    const size = def.batchSize ?? 500;
    await repo.scoped(ctx.scope, deps.db, async (trx) => {
      const uctx: UpsertContext = {
        scope: ctx.scope,
        trx,
        syncKey: ctx.syncKey,
        scopeKey: ctx.scopeKey,
        runId: ctx.runId,
        window: ctx.window,
        log: ctx.log,
        now,
      };
      for (let i = 0; i < rows.length; i += size) await def.upsert(uctx, rows.slice(i, i + size));
      await repo.writeScratch(trx, state.id, run.id, {
        ...scratch,
        ...(nextToken ? { nextToken } : { nextToken: null, complete: true }),
      });
      await repo.patchRun(trx, run, { attempts: 0 }); // progress was made: transient errors count afresh
    });
    return rows.length;
  }

  // --- report / export / query families ------------------------------------------------------------------------

  async function markState(ctx: RunContext, run: repo.RunRow, s: repo.RunState): Promise<void> {
    if (run.state === s) return;
    await repo.scoped(ctx.scope, deps.db, (trx) => repo.patchRun(trx, run, { state: s }));
    run.state = s;
  }

  async function asyncLoop(
    ctx: RunContext,
    run: repo.RunRow,
    state: repo.SyncStateRow,
    def: PullDefinition,
    scratch: repo.RunScratch,
  ): Promise<{ total: number; next?: StepResult }> {
    const adapter = adapterFor(def.family as never, config.polling);
    if (!adapter) throw new Error(`family ${def.family} has no async adapter`);
    const a = adapter as unknown as {
      create(c: RunContext, d: PullDefinition): Promise<string>;
      poll(
        c: RunContext,
        d: PullDefinition,
        id: string,
      ): Promise<{ ready: boolean; retryAfterMs?: number; documentId?: string | null }>;
      download(
        c: RunContext,
        d: PullDefinition,
        id: string,
        doc: string,
      ): Promise<LandedDocument[]>;
    };

    if (run.state === "requested") {
      const requestId = await a.create(ctx, def);
      await repo.scoped(ctx.scope, deps.db, (trx) =>
        repo.patchRun(trx, run, {
          state: "processing",
          amazonRequestId: requestId,
          attempts: 0,
        }),
      );
      run = Object.assign(run, { state: "processing" as const, amazonRequestId: requestId });
      return { total: 0, next: { done: false, delayMs: 2_000, state: "processing" } };
    }
    if (run.state === "processing") {
      if (!run.amazonRequestId) throw new Error("run is processing without a request id");
      const polled = await a.poll(ctx, def, run.amazonRequestId);
      if (!polled.ready)
        return {
          total: 0,
          next: { done: false, delayMs: polled.retryAfterMs ?? 15_000, state: "processing" },
        };
      if (polled.documentId == null) {
        // Amazon has no data for this window (SP-API CANCELLED, Data Kiosk DONE without a document): a successful
        // run with zero rows, nothing to land or parse (M5).
        await markState(ctx, run, "upserting");
        return { total: 0 };
      }
      await repo.scoped(ctx.scope, deps.db, (trx) =>
        repo.patchRun(trx, run, {
          state: "downloading",
          amazonDocumentId: polled.documentId ?? null,
          attempts: 0,
        }),
      );
      Object.assign(run, { state: "downloading", amazonDocumentId: polled.documentId ?? null });
    }
    if (run.state === "downloading") {
      if (!run.amazonRequestId || !run.amazonDocumentId) throw new Error("download without ids");
      const docs = await a.download(ctx, def, run.amazonRequestId, run.amazonDocumentId);
      await land(ctx, run, docs);
      await markState(ctx, run, "parsing");
    }
    // parsing + upserting: read the landed documents back from the object store (never from Amazon again).
    const texts = await readLanded(ctx, run);
    await markState(ctx, run, "parsing");
    const rows = await parseDoc(def, texts, ctx);
    await markState(ctx, run, "upserting");
    const total = await upsertAll(ctx, def, rows, state, run, scratch, null);
    if (def.family === "ads-export" && def.reconcile) {
      await repo.scoped(ctx.scope, deps.db, async (trx) => {
        await def.reconcile?.(
          {
            scope: ctx.scope,
            trx,
            syncKey: ctx.syncKey,
            scopeKey: ctx.scopeKey,
            runId: ctx.runId,
            window: ctx.window,
            log: ctx.log,
            now,
          },
          rows,
        );
      });
    }
    return { total };
  }

  async function parseDoc(
    def: PullDefinition,
    texts: string[],
    ctx: RunContext,
  ): Promise<readonly unknown[]> {
    switch (def.family) {
      case "ads-report":
        return def.parse(texts, ctx);
      case "spapi-report":
      case "ads-export":
      case "data-kiosk":
        return def.parse(texts.join("\n"), ctx);
      default:
        return [];
    }
  }

  async function land(ctx: RunContext, run: repo.RunRow, docs: LandedDocument[]): Promise<void> {
    const at = now();
    const expires = new Date(at.getTime() + config.rawRetentionDays * DAY_MS);
    const rows: Parameters<typeof repo.insertRawObject>[1][] = [];
    let part = 0;
    for (const doc of docs) {
      // The key is stable for the run (its creation date, not "now"), so a retry overwrites the same object.
      const key = rawObjectKey({
        tenantId: ctx.scope.tenantId,
        sellerAccountId: ctx.scope.sellerAccountId as string,
        syncKey: ctx.syncKey,
        at: run.createdAt,
        runId: run.id,
        part,
      });
      await deps.objectStore.put(key, doc.bytes, doc.contentType);
      rows.push({
        tenantId: ctx.scope.tenantId,
        sellerAccountId: ctx.scope.sellerAccountId as string,
        runId: run.id,
        syncKey: ctx.syncKey,
        objectKey: key,
        part,
        contentType: doc.contentType,
        byteSize: doc.bytes.byteLength,
        sha256: createHash("sha256").update(doc.bytes).digest(),
        sourceRef: doc.sourceRef,
        now: at,
        expiresAt: expires,
      });
      part += 1;
    }
    // One transaction: the index of this run is replaced as a whole, so a retried landing never duplicates a part.
    await repo.scoped(ctx.scope, deps.db, (trx) =>
      repo.replaceRawObjects(
        trx,
        {
          tenantId: ctx.scope.tenantId,
          sellerAccountId: ctx.scope.sellerAccountId as string,
          runId: run.id,
        },
        rows,
      ),
    );
  }

  async function readLanded(ctx: RunContext, run: repo.RunRow): Promise<string[]> {
    const objects = await repo.listRawObjects(ctx.scope, deps.db, run.id);
    const out: string[] = [];
    for (const o of objects) {
      const bytes = await deps.objectStore.get(o.objectKey);
      if (!bytes)
        throw new Error(`landed document ${o.objectKey} is missing from the object store`);
      out.push(new TextDecoder().decode(bytes));
    }
    return out;
  }

  // --- finishing -----------------------------------------------------------------------------------------------

  async function finish(
    ctx: RunContext,
    run: repo.RunRow,
    state: repo.SyncStateRow,
    def: PullDefinition,
    aux: boolean,
    t0: Date,
    total: number,
  ): Promise<StepResult> {
    const finishedAt = now();
    const scratch = await repo.scoped(ctx.scope, deps.db, (trx) =>
      repo.readScratch(trx, state.id, run.id),
    );
    await repo.scoped(ctx.scope, deps.db, async (trx) => {
      await repo.patchRun(trx, run, {
        state: "done",
        rowsUpserted: total,
        errorCode: null,
        errorDetail: null,
        finishedAt,
      });
      if (aux) {
        await repo.finishAuxRun(trx, state.id, run.id);
        return;
      }
      const startedAt = run.startedAt ?? t0;
      const previous = state.cursor;
      const overlapMs = (def.cursorOverlapMinutes ?? 0) * 60_000;
      const base = { ...previous };
      delete base.runs;
      delete base.lastRun;
      const stats = { startedAt, rows: total };
      const cursor = def.nextCursor
        ? def.nextCursor(ctx, base, stats)
        : {
            ...base,
            lastUpdatedAfter: new Date(startedAt.getTime() - overlapMs).toISOString(),
            ...(run.windowEnd ? { windowEnd: run.windowEnd.toISOString() } : {}),
          };
      await repo.finishSyncSuccess(trx, state.id, run.id, {
        cursor,
        now: finishedAt,
        nextRunAt: def.schedule
          ? new Date(finishedAt.getTime() + nextRunDelayMs(def.schedule, random))
          : null,
        lastRun: {
          runId: run.id,
          rows: total,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          throttles: scratch.throttles ?? 0,
        },
      });
    });
    ctx.log.info({ rows: total, state: "done" }, "sync run finished");
    return { done: true, state: "done" };
  }

  async function failRun(
    scope: SellerScope,
    run: repo.RunRow,
    state: repo.SyncStateRow | null,
    code: string,
    detail: string,
    countFailure: boolean,
    throttles = 0,
  ): Promise<void> {
    const at = now();
    await repo.scoped(scope, deps.db, async (trx) => {
      await repo.patchRun(trx, run, {
        state: "failed",
        errorCode: code,
        errorDetail: detail,
        finishedAt: at,
      });
      if (state && countFailure) {
        const failures = state.consecutiveFailures + 1;
        const delay = Math.min(60 * 60_000, backoffMs(failures) * 4);
        await repo.finishSyncFailure(trx, state.id, run.id, {
          now: at,
          errorCode: code,
          nextRunAt: new Date(at.getTime() + delay),
          throttles,
        });
      } else if (state) {
        await repo.finishAuxRun(trx, state.id, run.id);
      }
    });
  }

  async function cancelRun(
    scope: SellerScope,
    run: repo.RunRow,
    state: repo.SyncStateRow | null,
    reason: string,
  ): Promise<void> {
    await repo.scoped(scope, deps.db, async (trx) => {
      await repo.patchRun(trx, run, { state: "cancelled", errorCode: reason, finishedAt: now() });
      if (state) await repo.finishAuxRun(trx, state.id, run.id);
    });
  }

  async function handleError(
    e: unknown,
    ctx: RunContext,
    run: repo.RunRow,
    state: repo.SyncStateRow,
    def: PullDefinition,
    aux: boolean,
  ): Promise<StepResult> {
    const { scope } = ctx;
    if (e instanceof ConnectionNeedsReauth) {
      const api = isAdsDefinition(def) ? "ads" : "sp";
      await repo.pauseSyncs(scope, deps.db, keysFor(api), "needs_reauth");
      await failRun(
        scope,
        run,
        state,
        "needs_reauth",
        "the connection needs the seller to reconnect",
        false,
      );
      ctx.log.warn({ api }, "connection needs reauth: syncs paused");
      return { done: true, state: "failed" };
    }
    // Throttling is a delay, not a failure (decision 11).
    if (e instanceof AmazonThrottledError || e instanceof LocalRateLimitError) {
      const scratch = await repo.scoped(scope, deps.db, (trx) =>
        repo.readScratch(trx, state.id, run.id),
      );
      const throttles = (scratch.throttles ?? 0) + 1;
      if (throttles > config.maxThrottles) {
        await failRun(
          scope,
          run,
          state,
          "throttled_too_long",
          `throttled ${throttles} times`,
          !aux,
          throttles,
        );
        return { done: true, state: "failed" };
      }
      await repo.scoped(scope, deps.db, async (trx) => {
        await repo.writeScratch(trx, state.id, run.id, { ...scratch, throttles });
        await repo.patchRun(trx, run, { errorCode: "throttled" });
      });
      const delay = Math.max(1_000, e.retryAfterMs) + Math.floor(random() * 2_000);
      ctx.log.info({ throttles, delayMs: delay }, "throttled: run delayed");
      return { done: false, delayMs: delay, state: run.state };
    }
    const { code, detail } = sanitize(e);
    const retryable = e instanceof AmazonClientError ? e.retryable : true; // unknown errors: bounded retries
    const attempts = run.attempts + 1;
    const scratch = await repo.scoped(scope, deps.db, (trx) =>
      repo.readScratch(trx, state.id, run.id),
    );
    if (retryable && attempts < config.maxAttempts) {
      await repo.scoped(scope, deps.db, (trx) =>
        repo.patchRun(trx, run, { attempts, errorCode: code, errorDetail: detail }),
      );
      const delay = backoffMs(attempts);
      ctx.log.warn({ attempts, delayMs: delay, code }, "run step failed: retry scheduled");
      return { done: false, delayMs: delay, state: run.state };
    }
    await failRun(scope, run, state, code, detail, !aux, scratch.throttles ?? 0);
    ctx.log.error({ code, attempts }, "sync run failed");
    return { done: true, state: "failed" };
  }

  return { deps: full, config, pull, processRun, buildContext };
}
