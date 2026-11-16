import { createHash } from "node:crypto";
import {
  addDays,
  daysBetween,
  localDateOf,
  type LocalDate,
  type SellerScope,
} from "@seller-hub/core";
import type { Database } from "@seller-hub/db";
import { isAdsDefinition, isPull, scopeKindOf } from "./definitions";
import type { SellerDirectory } from "./directory";
import { getSyncHealth, type SyncHealth } from "./health";
import * as repo from "./repository";
import type {
  IngestDefinition,
  PullDefinition,
  RunEnqueuer,
  RunPayload,
  SyncTarget,
  PriorityClass,
} from "./types";
import { backfillWindows, computeWindow, timeZoneFor } from "./windows";

// The enqueue-only half of the engine. It needs no Amazon client, no object store and no registry: only the database,
// the seller directory, the definitions' metadata and the queue. The API (refresh route, sync-health route), the command
// executor (refresh after write, D62 a) and the worker's scheduler all use this one object, so they enqueue onto the
// same queues and never start a second step chain for a run that is already live (B1).

export const payloadFor = (run: repo.RunRow, step: number): RunPayload => ({
  tenantId: run.tenantId,
  sellerAccountId: run.sellerAccountId,
  traceId: run.traceId ?? run.id,
  runId: run.id,
  runCreatedAt: run.createdAt.toISOString(),
  step,
});

export const jobIdFor = (runId: string, step: number): string => `${runId}-${step}`;

/** The (sync, scope) rows a definition needs for one account. Empty when it does not apply or the API is not usable. */
export function scopesFor(def: PullDefinition, target: SyncTarget): string[] {
  const types = def.appliesTo?.accountTypes;
  if (types && !types.includes(target.accountType)) return [];
  const api = isAdsDefinition(def) ? "ads" : "sp";
  if (target.connected?.[api] === false) return []; // no active connection: nothing to sync (M4)
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

export interface RunRequesterOptions {
  /** `sh_app`. */
  db: Database;
  /** `sh_owner`: only to create missing sync-state rows. */
  system: Database;
  directory: SellerDirectory;
  definitions: readonly IngestDefinition[];
  enqueuer: RunEnqueuer;
  now?: () => Date;
}

export function createRunRequester(o: RunRequesterOptions) {
  const now = o.now ?? (() => new Date());
  const pull = new Map<string, PullDefinition>(o.definitions.filter(isPull).map((d) => [d.key, d]));

  /** Sync keys of the definitions that use `api`: pausing and resuming act on these, not on a key prefix. */
  const keysFor = (api: "sp" | "ads"): string[] =>
    [...pull.values()].filter((d) => (isAdsDefinition(d) ? "ads" : "sp") === api).map((d) => d.key);

  function definition(syncKey: string): PullDefinition {
    const def = pull.get(syncKey);
    if (!def) throw new Error(`unknown sync definition ${syncKey}`);
    return def;
  }

  async function enqueueRun(
    run: repo.RunRow,
    priority: PriorityClass,
    delayMs?: number,
  ): Promise<void> {
    await o.enqueuer.enqueue(payloadFor(run, 0), {
      priority,
      jobId: jobIdFor(run.id, 0),
      ...(delayMs ? { delayMs } : {}),
    });
  }

  async function targetOf(scope: SellerScope): Promise<SyncTarget> {
    const target = await o.directory.getTarget({
      tenantId: scope.tenantId,
      sellerAccountId: scope.sellerAccountId as string,
    });
    if (!target) throw new Error("seller account not found or not active");
    return target;
  }

  /** Finds the sync state for (syncKey, scopeKey), creating it when the account qualifies. */
  async function stateFor(
    scope: SellerScope,
    def: PullDefinition,
    scopeKey: string,
    target: SyncTarget,
  ): Promise<repo.SyncStateRow> {
    const existing = await repo.findSyncState(scope, o.db, def.key, scopeKey);
    if (existing) return existing;
    if (!scopesFor(def, target).includes(scopeKey))
      throw new Error(`${def.key} does not apply to this account/scope`);
    await repo.ensureSyncStates(o.system, [
      {
        tenantId: scope.tenantId,
        sellerAccountId: scope.sellerAccountId as string,
        syncKey: def.key,
        scopeKey,
        nextRunAt: now(),
      },
    ]);
    const created = await repo.findSyncState(scope, o.db, def.key, scopeKey);
    if (!created) throw new Error("sync state could not be created");
    return created;
  }

  /**
   * Refresh after write (D62 a) and "Refresh now": an `interactive` run for this sync. With `entityIds` and a
   * definition that has `refreshEntities`, only those entities are fetched. When the run is already open (same
   * window or entity set) nothing is enqueued: the live step chain carries it, a second chain would only duplicate
   * Amazon calls (B1). A chain that really died is picked up by the stale sweep.
   */
  async function requestRefresh(
    scope: SellerScope,
    r: { syncKey: string; scopeKey?: string; entityIds?: readonly string[]; traceId?: string },
  ): Promise<{ runId: string; created: boolean }> {
    const def = definition(r.syncKey);
    const target = await targetOf(scope);
    const state = await stateFor(scope, def, r.scopeKey ?? "", target);
    const at = now();
    const entityIds =
      r.entityIds?.length && def.refreshEntities ? [...r.entityIds].sort() : undefined;
    if (!entityIds) {
      const open = await repo.findOpenSyncRun(scope, o.db, state.id);
      if (open) return { runId: open.id, created: false };
    }
    const tz = timeZoneFor(target, def, state.scopeKey);
    const window = entityIds
      ? { start: null, end: null }
      : computeWindow(def, state.cursor, at, tz);
    const { run, created } = await repo.createRun(scope, o.db, {
      syncStateId: state.id,
      syncKey: def.key,
      scopeKey: state.scopeKey,
      family: entityIds ? "entity-refresh" : def.family,
      priority: "interactive",
      windowStart: window.start,
      windowEnd: window.end,
      traceId: r.traceId ?? `refresh:${at.getTime()}`,
      ...(entityIds
        ? {
            entityIds,
            keySuffix: createHash("sha1").update(entityIds.join(",")).digest("hex").slice(0, 12),
          }
        : {}),
      now: at,
    });
    if (created) await enqueueRun(run, "interactive");
    return { runId: run.id, created };
  }

  /**
   * Backfill (ADR-0008 decision 7) over inclusive marketplace-local dates: windows of at most `maxRangeDays`, newest
   * first, each at `backfill` priority. A window that already has an open run is left to its live chain.
   */
  async function backfill(
    scope: SellerScope,
    r: { syncKey: string; scopeKey?: string; fromDate: LocalDate; toDate: LocalDate },
  ): Promise<{ windows: number }> {
    const def = definition(r.syncKey);
    if (!def.window?.maxRangeDays && !def.window?.backfillDays)
      throw new Error(`${def.key} declares no window, so it cannot be backfilled`);
    const target = await targetOf(scope);
    const state = await stateFor(scope, def, r.scopeKey ?? "", target);
    const tz = timeZoneFor(target, def, state.scopeKey);
    const at = now();
    const today = localDateOf(at, tz);
    const keep = def.window.backfillDays ?? 730;
    if (daysBetween(r.fromDate, today) > keep)
      throw new Error(`${def.key} keeps ${keep} days of history; from is too early`);
    if (r.fromDate > r.toDate) throw new Error("from must not be after to");
    if (r.toDate > today) throw new Error("to is in the future");
    const windows = backfillWindows(r.fromDate, r.toDate, def.window.maxRangeDays ?? 31, tz);
    let i = 0;
    for (const w of windows) {
      const { run, created } = await repo.createRun(scope, o.db, {
        syncStateId: state.id,
        syncKey: def.key,
        scopeKey: state.scopeKey,
        family: def.family,
        priority: "backfill",
        windowStart: w.start,
        windowEnd: w.end,
        traceId: `backfill:${at.getTime()}`,
        now: at,
      });
      if (created) await enqueueRun(run, "backfill", i * 500);
      i++;
    }
    return { windows: windows.length };
  }

  return {
    definition,
    keysFor,
    pull,
    requestRefresh,
    backfill,
    enqueueRun,
    /** Sync health for the status screen, with the definitions' metadata (description, schedule). */
    getSyncHealth: (scope: SellerScope): Promise<SyncHealth> =>
      getSyncHealth(scope, o.db, o.definitions, now()),
    /** Next local date helper kept here so API callers need not import time code. */
    addDays,
  };
}

export type RunRequester = ReturnType<typeof createRunRequester>;
