import { createHash } from "node:crypto";
import type { SellerScope } from "@seller-hub/core";
import { DAY_MS, nextRunDelayMs, parseDurationMs } from "./duration";
import { isAdsDefinition, scopeKindOf } from "./definitions";
import { computeWindow, jobIdOf, payloadOf, type Engine } from "./engine";
import * as repo from "./repository";
import type { PriorityClass, PullDefinition, SyncTarget } from "./types";

// DB-driven scheduler (ADR-0008 "Scheduling"): one tick per minute under a leader lock claims the sync states that
// are due, creates a run for each and enqueues it. "Refresh now" and backfill create runs at higher/lower priority.

/** The (sync, scope) rows a definition needs for one account. Empty when the definition does not apply. */
export function scopesFor(def: PullDefinition, target: SyncTarget): string[] {
  const types = def.appliesTo?.accountTypes;
  if (types && !types.includes(target.accountType)) return [];
  const api = isAdsDefinition(def) ? "ads" : "sp";
  if (target.paused[api]) return [];
  switch (scopeKindOf(def)) {
    case "marketplace":
      return [...target.marketplaceIds];
    case "ads-profile":
      return target.adsProfiles.filter((p) => p.accountType !== "agency").map((p) => p.profileId);
    default:
      return api === "ads" && target.adsProfiles.length === 0 ? [] : [""];
  }
}

export interface TickResult {
  leader: boolean;
  ensured: number;
  enqueued: number;
  resumed: number;
  skipped: number;
}

export function createScheduler(engine: Engine, options: { claimBatch?: number; ensureEveryMs?: number } = {}) {
  const { deps, config } = engine;
  const claimBatch = options.claimBatch ?? 200;
  const ensureEveryMs = options.ensureEveryMs ?? 10 * 60_000;
  let lastEnsure = 0;

  /** Creates missing sync-state rows, staggered by the definition's jitter, and applies pause/resume from the directory. */
  async function ensureStates(): Promise<number> {
    const targets = await deps.directory.listTargets();
    const now = deps.now();
    const rows: repo.EnsureState[] = [];
    for (const t of targets) {
      for (const def of engine.pull.values()) {
        const startsIn = def.schedule ? nextRunDelayMs({ every: "0s", ...(def.schedule.jitter ? { jitter: def.schedule.jitter } : {}) }, deps.random) : 0;
        for (const scopeKey of scopesFor(def, t)) {
          rows.push({
            tenantId: t.tenantId,
            sellerAccountId: t.sellerAccountId,
            syncKey: def.key,
            scopeKey,
            nextRunAt: def.schedule ? new Date(now.getTime() + startsIn) : null,
          });
        }
      }
      for (const api of ["sp", "ads"] as const) {
        await repo.reconcilePaused(deps.system, {
          tenantId: t.tenantId,
          sellerAccountId: t.sellerAccountId,
          api,
          reason: t.paused[api],
          now,
        });
      }
    }
    return repo.ensureSyncStates(deps.system, rows);
  }

  async function enqueueRun(run: repo.RunRow, priority: PriorityClass, step: number, delayMs?: number): Promise<void> {
    await deps.enqueuer.enqueue(payloadOf(run, step), {
      priority,
      jobId: jobIdOf(run.id, step),
      ...(delayMs ? { delayMs } : {}),
    });
  }

  async function tick(): Promise<TickResult> {
    const result: TickResult = { leader: false, ensured: 0, enqueued: 0, resumed: 0, skipped: 0 };
    const leader = await deps.amazon.gate.tryAcquire("ingest:tick", 1, 55_000);
    if (!leader) return result;
    result.leader = true;
    try {
      const now = deps.now();
      if (now.getTime() - lastEnsure >= ensureEveryMs) {
        result.ensured = await ensureStates();
        lastEnsure = now.getTime();
      }
      const due = await repo.claimDueStates(deps.system, now, claimBatch, config.leaseMs);
      for (const s of due) {
        const def = engine.pull.get(s.syncKey);
        const scope: SellerScope = { tenantId: s.tenantId, sellerAccountId: s.sellerAccountId };
        if (!def) {
          result.skipped++;
          continue;
        }
        const target = await deps.directory.getTarget(scope);
        const api = isAdsDefinition(def) ? "ads" : "sp";
        if (!target || target.paused[api]) {
          result.skipped++;
          continue;
        }
        const window = computeWindow(def, s.cursor, now);
        const { run, created } = await repo.createRun(scope, deps.db, {
          syncStateId: s.id,
          syncKey: s.syncKey,
          scopeKey: s.scopeKey,
          family: def.family,
          priority: "scheduled",
          windowStart: window.start,
          windowEnd: window.end,
          traceId: `tick:${now.getTime()}`,
          now,
        });
        await enqueueRun(run, "scheduled", created ? 0 : Math.floor(now.getTime() / 1000));
        result[created ? "enqueued" : "resumed"]++;
      }
      // A run whose worker died stops moving; put it back on the queue (idempotent: the run resumes from its state).
      for (const run of await repo.findStaleRuns(deps.system, now, 10 * 60_000, 100)) {
        await enqueueRun(run, run.priority, Math.floor(now.getTime() / 1000));
        result.resumed++;
      }
      return result;
    } finally {
      await leader.release();
    }
  }

  /** Looks up the sync state for (syncKey, scopeKey), creating it when the account qualifies. */
  async function stateFor(scope: SellerScope, def: PullDefinition, scopeKey: string): Promise<repo.SyncStateRow> {
    const existing = await repo.findSyncState(scope, deps.db, def.key, scopeKey);
    if (existing) return existing;
    const target = await deps.directory.getTarget({ tenantId: scope.tenantId, sellerAccountId: scope.sellerAccountId as string });
    if (!target) throw new Error("seller account not found or not active");
    if (!scopesFor(def, target).includes(scopeKey))
      throw new Error(`${def.key} does not apply to this account/scope`);
    await repo.ensureSyncStates(deps.system, [
      { tenantId: scope.tenantId, sellerAccountId: scope.sellerAccountId as string, syncKey: def.key, scopeKey, nextRunAt: deps.now() },
    ]);
    const created = await repo.findSyncState(scope, deps.db, def.key, scopeKey);
    if (!created) throw new Error("sync state could not be created");
    return created;
  }

  function definition(syncKey: string): PullDefinition {
    const def = engine.pull.get(syncKey);
    if (!def) throw new Error(`unknown sync definition ${syncKey}`);
    return def;
  }

  /**
   * Refresh after write (D62 a) and per-campaign refresh: an `interactive` run for this sync. With `entityIds` and a
   * definition that has `refreshEntities`, only those entities are fetched; otherwise the whole sync runs now.
   */
  async function requestRefresh(
    scope: SellerScope,
    r: { syncKey: string; scopeKey?: string; entityIds?: readonly string[]; traceId?: string },
  ): Promise<{ runId: string; created: boolean }> {
    const def = definition(r.syncKey);
    const state = await stateFor(scope, def, r.scopeKey ?? "");
    const now = deps.now();
    const entityIds = r.entityIds?.length && def.refreshEntities ? [...r.entityIds].sort() : undefined;
    const window = entityIds ? { start: null, end: null } : computeWindow(def, state.cursor, now);
    const { run, created } = await repo.createRun(scope, deps.db, {
      syncStateId: state.id,
      syncKey: def.key,
      scopeKey: state.scopeKey,
      family: entityIds ? "entity-refresh" : def.family,
      priority: "interactive",
      windowStart: window.start,
      windowEnd: window.end,
      traceId: r.traceId ?? `refresh:${now.getTime()}`,
      ...(entityIds
        ? { entityIds, keySuffix: createHash("sha1").update(entityIds.join(",")).digest("hex").slice(0, 12) }
        : {}),
      now,
    });
    // Interactive work jumps the queue even when it found an open scheduled run (priority is per queue entry).
    await enqueueRun(run, "interactive", created ? 0 : Math.floor(now.getTime() / 1000));
    return { runId: run.id, created };
  }

  /**
   * Backfill (ADR-0008 decision 7): split [from, to] into windows of at most `maxRangeDays`, newest first, and
   * enqueue each at `backfill` priority. Windows are idempotent: a window that already has an open run is reused.
   */
  async function backfill(
    scope: SellerScope,
    r: { syncKey: string; scopeKey?: string; from: Date; to: Date },
  ): Promise<{ windows: number }> {
    const def = definition(r.syncKey);
    if (!def.window?.maxRangeDays && !def.window?.backfillDays)
      throw new Error(`${def.key} declares no window, so it cannot be backfilled`);
    const now = deps.now();
    const maxBack = (def.window.backfillDays ?? 730) * DAY_MS;
    if (now.getTime() - r.from.getTime() > maxBack)
      throw new Error(`${def.key} keeps ${def.window.backfillDays ?? 730} days of history; from is too early`);
    if (r.from >= r.to) throw new Error("from must be before to");
    const state = await stateFor(scope, def, r.scopeKey ?? "");
    const chunk = (def.window.maxRangeDays ?? 31) * DAY_MS;
    const windows: { start: Date; end: Date }[] = [];
    for (let end = r.to.getTime(); end > r.from.getTime(); end -= chunk) {
      windows.push({ start: new Date(Math.max(r.from.getTime(), end - chunk)), end: new Date(end) });
    }
    let i = 0;
    for (const w of windows) {
      const { run, created } = await repo.createRun(scope, deps.db, {
        syncStateId: state.id,
        syncKey: def.key,
        scopeKey: state.scopeKey,
        family: def.family,
        priority: "backfill",
        windowStart: w.start,
        windowEnd: w.end,
        traceId: `backfill:${now.getTime()}`,
        now,
      });
      await enqueueRun(run, "backfill", created ? 0 : Math.floor(now.getTime() / 1000), i * 500);
      i++;
    }
    return { windows: windows.length };
  }

  /** Daily maintenance: next months' partitions and retention (D64 a). */
  function maintenance() {
    return repo.maintainPartitions(deps.system, deps.now(), {
      jobRunDays: config.jobRunRetentionDays,
      rawDays: config.rawRetentionDays,
    });
  }

  return { tick, ensureStates, requestRefresh, backfill, maintenance, parseDurationMs };
}

export type Scheduler = ReturnType<typeof createScheduler>;
