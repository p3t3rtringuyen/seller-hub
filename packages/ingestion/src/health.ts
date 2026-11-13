import type { SellerScope } from "@seller-hub/core";
import type { Database } from "@seller-hub/db";
import { parseDurationMs } from "./duration";
import * as repo from "./repository";
import type { IngestDefinition } from "./types";

// Sync health = a table query (ADR-0008 consequences): lag is `now - last_success_at`. Feeds the sync status screen
// (`apps/web/app/(app)/settings/sync`), the freshness badges and the alert in ADR-0013.

export type Freshness = "fresh" | "stale" | "failing" | "paused" | "never";

export interface SyncHealthItem {
  syncKey: string;
  scopeKey: string;
  description: string | null;
  family: string | null;
  status: string;
  freshness: Freshness;
  pausedReason: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  /** Seconds since the last success; null when it never succeeded. */
  lagSeconds: number | null;
  nextRunAt: string | null;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  lastRun: { rows: number; durationMs: number; throttles: number } | null;
  /** In-flight runs of this sync (their scratch lives in the cursor). */
  runningRuns: number;
}

export interface JobRunItem {
  id: string;
  syncKey: string;
  priority: string;
  state: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  rows: number | null;
  attempts: number;
  errorCode: string | null;
  errorDetail: string | null;
}

export interface SyncHealth {
  items: SyncHealthItem[];
  recentRuns: JobRunItem[];
  generatedAt: string;
}

function freshnessOf(s: repo.SyncStateRow, every: number | null, now: Date): Freshness {
  if (s.status === "paused" || s.status === "disabled") return "paused";
  if (s.status === "failing" || s.consecutiveFailures > 0) return "failing";
  if (!s.lastSuccessAt) return "never";
  // Stale = more than two cycles late; sync without a schedule is never stale.
  if (every && now.getTime() - s.lastSuccessAt.getTime() > every * 2.5) return "stale";
  return "fresh";
}

export async function getSyncHealth(
  scope: SellerScope,
  db: Database,
  definitions: readonly IngestDefinition[],
  now: Date = new Date(),
): Promise<SyncHealth> {
  const byKey = new Map(definitions.map((d) => [d.key, d]));
  const [states, runs] = await Promise.all([
    repo.listSyncStates(scope, db),
    repo.listRuns(scope, db, { limit: 30 }),
  ]);
  const items = states.map((s): SyncHealthItem => {
    const def = byKey.get(s.syncKey);
    const every =
      def && "schedule" in def && def.schedule ? parseDurationMs(def.schedule.every) : null;
    const last = (s.cursor.lastRun ?? null) as {
      rows?: number;
      durationMs?: number;
      throttles?: number;
    } | null;
    const running = s.cursor.runs ? Object.keys(s.cursor.runs as object).length : 0;
    return {
      syncKey: s.syncKey,
      scopeKey: s.scopeKey,
      description: def?.description ?? null,
      family: def?.family ?? null,
      status: s.status,
      freshness: freshnessOf(s, every, now),
      pausedReason: s.pausedReason,
      lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: s.lastFailureAt?.toISOString() ?? null,
      lagSeconds: s.lastSuccessAt
        ? Math.round((now.getTime() - s.lastSuccessAt.getTime()) / 1000)
        : null,
      nextRunAt: s.nextRunAt?.toISOString() ?? null,
      consecutiveFailures: s.consecutiveFailures,
      lastErrorCode: s.lastErrorCode,
      lastRun:
        last && typeof last.rows === "number"
          ? { rows: last.rows, durationMs: last.durationMs ?? 0, throttles: last.throttles ?? 0 }
          : null,
      runningRuns: running,
    };
  });
  return {
    items,
    generatedAt: now.toISOString(),
    recentRuns: runs.map((r) => ({
      id: r.id,
      syncKey: r.syncKey,
      priority: r.priority,
      state: r.state,
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      durationMs:
        r.startedAt && r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
      rows: r.rowsUpserted,
      attempts: r.attempts,
      errorCode: r.errorCode,
      errorDetail: r.errorDetail,
    })),
  };
}
