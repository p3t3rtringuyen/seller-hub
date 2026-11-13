import type { AdsClient, AdsReports, AdsScope } from "@seller-hub/amazon-ads";
import type { Region } from "@seller-hub/amazon-core";
import type { SpClient, SpScope } from "@seller-hub/amazon-sp";
import type { Logger, SellerScope } from "@seller-hub/core";
import type { ScopedTx } from "@seller-hub/db";

// What a slice writes (`modules/<m>/src/sync/<k>/*.sync.ts`, default export) and what the engine hands back to it.
// ADR-0008 decision 2. `@seller-hub/core` keeps `SyncDefinition` framework-neutral with an index signature;
// `toIngestDefinitions` (definitions.ts) narrows a registered definition to the shapes below and rejects bad ones at boot.

export const PRIORITY_CLASSES = ["interactive", "scheduled", "backfill"] as const;
export type PriorityClass = (typeof PRIORITY_CLASSES)[number];

/** BullMQ priority number per class (lower runs first). ADR-0008 decision 1. */
export const PRIORITY_NUMBER: Record<PriorityClass, number> = {
  interactive: 1,
  scheduled: 5,
  backfill: 10,
};

export const SYNC_FAMILIES = [
  "paged-pull",
  "sync-read",
  "spapi-report",
  "ads-report",
  "ads-export",
  "data-kiosk",
  "spapi-notification",
  "stream",
] as const;
export type SyncFamily = (typeof SYNC_FAMILIES)[number];

/** Families that pull on a schedule. `spapi-notification` and `stream` are push sources (inbox consumers). */
export const PULL_FAMILIES: readonly SyncFamily[] = [
  "paged-pull",
  "sync-read",
  "spapi-report",
  "ads-report",
  "ads-export",
  "data-kiosk",
];

/** Which scope a sync repeats over: one per account, per marketplace the account sells in, or per Ads profile. */
export type SyncScopeKind = "account" | "marketplace" | "ads-profile";

export interface SyncTargetProfile {
  /** Amazon Ads profile id (text, conventions §1). */
  profileId: string;
  marketplaceId: string | null;
  accountType: "seller" | "vendor" | "agency";
}

/** What the scheduler needs to know about one connected seller account. Supplied by a `SellerDirectory`. */
export interface SyncTarget {
  tenantId: string;
  sellerAccountId: string;
  accountType: "seller" | "vendor";
  region: Region;
  marketplaceIds: readonly string[];
  adsProfiles: readonly SyncTargetProfile[];
  /**
   * Per API: set when that connection is not usable (needs reauth, revoked, account disconnected). The scheduler
   * pauses the syncs of that API instead of failing them (ADR-0008 decision 11).
   */
  paused: Partial<Record<"sp" | "ads", "needs_reauth" | "tenant_suspended" | "disconnected">>;
}

export interface RunWindow {
  start: Date | null;
  end: Date | null;
}

export interface DataKioskPort {
  createQuery(scope: SpScope, query: string): Promise<{ queryId: string }>;
  getQuery(
    scope: SpScope,
    queryId: string,
  ): Promise<{
    status: "IN_QUEUE" | "IN_PROGRESS" | "DONE" | "FATAL" | "CANCELLED";
    documentId?: string;
    errorDocumentId?: string;
  }>;
  getDocument(scope: SpScope, documentId: string): Promise<{ url: string }>;
}

/** Everything a definition's callbacks may use. Amazon access goes through the clients (rate limits, retries inside). */
export interface RunContext {
  scope: SellerScope;
  target: SyncTarget;
  syncKey: string;
  /** Marketplace id or Ads profile id this run is for (`''` for an account-wide sync). */
  scopeKey: string;
  runId: string;
  priority: PriorityClass;
  window: RunWindow;
  /** Committed cursor of the sync (e.g. `lastUpdatedAfter`). Never changes during a run. */
  cursor: Readonly<Record<string, unknown>>;
  /** Set for refresh-after-write runs (D62 a): only these entities are wanted. */
  entityIds: readonly string[] | undefined;
  marketplaceIds: readonly string[];
  spScope: SpScope;
  adsScope: AdsScope;
  sp: SpClient;
  ads: AdsClient;
  adsReports: AdsReports;
  kiosk: DataKioskPort | undefined;
  log: Logger;
  now(): Date;
}

/** Handed to `upsert`: a transaction already scoped to the tenant and seller account (RLS applies). */
export interface UpsertContext {
  scope: SellerScope;
  trx: ScopedTx;
  syncKey: string;
  scopeKey: string;
  runId: string;
  window: RunWindow;
  log: Logger;
  now(): Date;
}

export type Upsert<Row> = (ctx: UpsertContext, rows: readonly Row[]) => Promise<void>;

interface DefinitionBase<Row> {
  /** Unique, starts with the module name (`listings.merchant-listings`). */
  key: string;
  schedule?: { every: string; jitter?: string };
  /** Which accounts the sync applies to (`accountTypes` defaults to both). */
  appliesTo?: { api?: "sp" | "ads"; accountTypes?: readonly ("seller" | "vendor")[] };
  /** Defaults: Ads syncs run per Ads profile, SP-API syncs per account. */
  scopeKind?: SyncScopeKind;
  window?: {
    /** Days re-pulled on every run so restatements converge (Ads: 3). */
    lookbackDays?: number;
    /** How far back a backfill may reach. */
    backfillDays?: number;
    /** Largest range one run may ask for; a longer gap is caught up by the next runs. */
    maxRangeDays?: number;
  };
  /** Amazon operation ids the definition uses; checked against the client allow-lists at boot. */
  operations?: readonly string[];
  /** Rows per `upsert` call. Default 500. */
  batchSize?: number;
  /** Runs of this sync per seller account at once. Default 1. */
  concurrency?: number;
  /** Minutes subtracted from the new cursor so late-updated rows are seen again (ADR-0008 decision 6). */
  cursorOverlapMinutes?: number;
  /** Computes the committed cursor after a successful run. Default: `{ lastUpdatedAfter, windowEnd }`. */
  nextCursor?: (
    ctx: RunContext,
    previous: Record<string, unknown>,
    stats: { startedAt: Date; rows: number },
  ) => Record<string, unknown>;
  /** Refresh-after-write (D62 a): fetch just these entities. Without it a refresh runs the whole sync. */
  refreshEntities?: (ctx: RunContext, entityIds: readonly string[]) => Promise<readonly Row[]>;
  upsert: Upsert<Row>;
  /** Free-form note for the sync status screen. */
  description?: string;
}

export interface PagedPullDefinition<Row = unknown> extends DefinitionBase<Row> {
  family: "paged-pull" | "sync-read";
  /** One page. Return `nextToken` while more pages exist. Resumed from the stored token after a crash. */
  fetchPage: (
    ctx: RunContext,
    token: string | undefined,
  ) => Promise<{ rows: readonly Row[]; nextToken?: string | null | undefined }>;
}

export interface SpReportDefinition<Row = unknown> extends DefinitionBase<Row> {
  family: "spapi-report";
  report: (ctx: RunContext) => {
    reportType: string;
    marketplaceIds?: readonly string[];
    dataStartTime?: string;
    dataEndTime?: string;
    reportOptions?: Record<string, string>;
  };
  parse: (text: string, ctx: RunContext) => readonly Row[] | Promise<readonly Row[]>;
}

export interface AdsReportDefinition<Row = unknown> extends DefinitionBase<Row> {
  family: "ads-report";
  /** Body of AdsApiv1CreateReport (v1 only, D57 a). */
  buildRequest: (ctx: RunContext) => Record<string, unknown>;
  /** One text per downloaded part (CSV parts repeat their header). */
  parse: (parts: readonly string[], ctx: RunContext) => readonly Row[] | Promise<readonly Row[]>;
}

export interface AdsExportDefinition<Row = unknown> extends DefinitionBase<Row> {
  family: "ads-export";
  exportOperation: "CampaignExport" | "AdGroupExport" | "AdExport" | "TargetExport";
  buildRequest: (ctx: RunContext) => Record<string, unknown>;
  parse: (text: string, ctx: RunContext) => readonly Row[] | Promise<readonly Row[]>;
  /** Called after the upserts with every key the export contained, to mark mirror rows that are gone. */
  reconcile?: (ctx: UpsertContext, rows: readonly Row[]) => Promise<void>;
}

export interface DataKioskDefinition<Row = unknown> extends DefinitionBase<Row> {
  family: "data-kiosk";
  query: (ctx: RunContext) => string;
  parse: (text: string, ctx: RunContext) => readonly Row[] | Promise<readonly Row[]>;
}

export interface InboxMessage {
  id: string;
  messageId: string;
  source: "spapi-notification" | "marketing-stream";
  messageType: string;
  payload: unknown;
}

/** Push consumers: `spapi-notification` (SQS → inbox → fetch-after-notify) and `stream` (Marketing Stream v2, D58 a). */
export interface PushDefinition {
  key: string;
  family: "spapi-notification" | "stream";
  description?: string;
  /** Notification type / stream dataset this handler takes, e.g. `ORDER_CHANGE`, `sp-traffic`. */
  messageType: string;
  /** Runs inside the account's scope. Throwing leaves the inbox row `failed` (replay = reset the status). */
  handle: (ctx: PushContext, message: InboxMessage) => Promise<void>;
  operations?: readonly string[];
  schedule?: undefined;
  [extra: string]: unknown;
}

export interface PushContext {
  scope: SellerScope;
  trx: ScopedTx;
  log: Logger;
  now(): Date;
}

export type PullDefinition =
  | PagedPullDefinition<any> // eslint-disable-line @typescript-eslint/no-explicit-any -- row type differs per definition
  | SpReportDefinition<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  | AdsReportDefinition<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  | AdsExportDefinition<any> // eslint-disable-line @typescript-eslint/no-explicit-any
  | DataKioskDefinition<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type IngestDefinition = PullDefinition | PushDefinition;

// Identity helpers: editors and tsc give the right shape per family.
export const definePagedPull = <Row>(d: PagedPullDefinition<Row>): PagedPullDefinition<Row> => d;
export const defineSpReport = <Row>(d: SpReportDefinition<Row>): SpReportDefinition<Row> => d;
export const defineAdsReport = <Row>(d: AdsReportDefinition<Row>): AdsReportDefinition<Row> => d;
export const defineAdsExport = <Row>(d: AdsExportDefinition<Row>): AdsExportDefinition<Row> => d;
export const defineDataKiosk = <Row>(d: DataKioskDefinition<Row>): DataKioskDefinition<Row> => d;
export const definePush = (d: PushDefinition): PushDefinition => d;

/** Run payload on the BullMQ queues. Carries the conventions §8 fields. */
export interface RunPayload {
  tenantId: string;
  sellerAccountId: string;
  traceId: string;
  runId: string;
  /** Partition key of `ingest.job_runs`, so lookups touch one partition. */
  runCreatedAt: string;
  /** Increments with every delayed re-enqueue (poll, throttle) so BullMQ job ids stay unique. */
  step: number;
}

/** The queue seam. The worker implements it on BullMQ; tests use an in-memory one. */
export interface RunEnqueuer {
  enqueue(
    payload: RunPayload,
    options: { priority: PriorityClass; delayMs?: number; jobId: string },
  ): Promise<void>;
}

export interface StepResult {
  /** `done` = the run reached a terminal state. Otherwise re-enqueue after `delayMs`. */
  done: boolean;
  delayMs?: number;
  state: string;
}
