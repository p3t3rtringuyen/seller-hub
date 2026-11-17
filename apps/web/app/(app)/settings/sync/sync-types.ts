// Shape of GET /v1/seller-accounts/{sellerAccountId}/sync-health. Mirrors `SyncHealth` in packages/ingestion
// (src/health.ts); kept as a local copy because apps/web does not import server packages. The route and contract
// that serve it belong to the API layer (see docs/reports/P3-INGEST.md, "Needs from others").

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
  lagSeconds: number | null;
  nextRunAt: string | null;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  lastRun: { rows: number; durationMs: number; throttles: number } | null;
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
