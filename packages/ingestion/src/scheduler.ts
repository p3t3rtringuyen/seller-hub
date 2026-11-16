import type { SellerScope } from "@seller-hub/core";
import { nextRunDelayMs } from "./duration";
import { isAdsDefinition } from "./definitions";
import type { Engine } from "./engine";
import * as repo from "./repository";
import {
  createRunRequester,
  jobIdFor,
  payloadFor,
  scopesFor,
  type RunRequester,
} from "./requester";
import { computeWindow, timeZoneFor } from "./windows";

export { scopesFor } from "./requester";

// DB-driven scheduler (ADR-0008 "Scheduling"): one tick per minute under a leader lock claims the sync states that
// are due, creates a run for each and enqueues it. Refresh and backfill live in the requester (enqueue-only), which the
// API and the command executor share.

export interface TickResult {
  leader: boolean;
  ensured: number;
  enqueued: number;
  /** Open runs found overdue (their chain died) and put back on the queue. */
  resumed: number;
  skipped: number;
}

/** A step overdue by this much past its own scheduled time means its chain is gone (a worker died). */
const STALE_GRACE_MS = 10 * 60_000;

export function createScheduler(
  engine: Engine,
  options: { claimBatch?: number; ensureEveryMs?: number; requester?: RunRequester } = {},
) {
  const { deps, config } = engine;
  const claimBatch = options.claimBatch ?? 200;
  const ensureEveryMs = options.ensureEveryMs ?? 10 * 60_000;
  const requester =
    options.requester ??
    createRunRequester({
      db: deps.db,
      system: deps.system,
      directory: deps.directory,
      definitions: deps.definitions,
      enqueuer: deps.enqueuer,
      now: deps.now,
    });
  let lastEnsure = 0;

  /** Creates missing sync-state rows, staggered by the definition's jitter, and applies pause/resume from the directory. */
  async function ensureStates(): Promise<number> {
    const targets = await deps.directory.listTargets();
    const now = deps.now();
    const rows: repo.EnsureState[] = [];
    for (const t of targets) {
      for (const def of engine.pull.values()) {
        const startsIn = def.schedule
          ? nextRunDelayMs(
              { every: "0s", ...(def.schedule.jitter ? { jitter: def.schedule.jitter } : {}) },
              deps.random,
            )
          : 0;
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
          syncKeys: requester.keysFor(api),
          reason: t.paused[api] ?? (t.connected?.[api] === false ? "not_connected" : undefined),
          now,
        });
      }
    }
    return repo.ensureSyncStates(deps.system, rows);
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
        if (!target || target.paused[api] || target.connected?.[api] === false) {
          result.skipped++;
          continue;
        }
        if (await repo.findOpenSyncRun(scope, deps.db, s.id)) {
          result.skipped++; // its live chain carries it
          continue;
        }
        const window = computeWindow(def, s.cursor, now, timeZoneFor(target, def, s.scopeKey));
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
        // An open run keeps its live chain; only a new run needs a first step (B1).
        if (created) {
          await requester.enqueueRun(run, "scheduled");
          result.enqueued++;
        } else result.skipped++;
      }
      // A run whose chain died is overdue past its own next step; put it back (idempotent: it resumes from its state,
      // and a duplicate chain is dropped by the per-run lease in processRun).
      for (const run of await repo.findStaleRuns(deps.system, now, STALE_GRACE_MS, 100)) {
        await deps.enqueuer.enqueue(payloadFor(run, Math.floor(now.getTime() / 1000)), {
          priority: run.priority,
          jobId: jobIdFor(run.id, Math.floor(now.getTime() / 1000)),
        });
        result.resumed++;
      }
      return result;
    } finally {
      await leader.release();
    }
  }

  /** Daily maintenance: next months' partitions, retention (D64 a) and inbox purge. */
  async function maintenance() {
    const parts = await repo.maintainPartitions(deps.system, deps.now(), {
      jobRunDays: config.jobRunRetentionDays,
      rawDays: config.rawRetentionDays,
    });
    const inboxPurged = await repo.purgeInbox(deps.system, deps.now(), {
      doneDays: config.rawRetentionDays,
      failedDays: 90,
    });
    return { ...parts, inboxPurged };
  }

  return {
    tick,
    ensureStates,
    maintenance,
    requester,
    requestRefresh: requester.requestRefresh,
    backfill: requester.backfill,
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
