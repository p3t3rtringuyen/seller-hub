// Shapes of the files that slices ADD and that `tools/registry` discovers (BACKLOG §1.2).
// Every convention file DEFAULT-exports its value (or an array of values). The `define*` helpers are
// identity functions that give editors and tsc the type.
//
// Framework-neutral on purpose: modules do not import Fastify, BullMQ or React. P3-INGEST extends
// `SyncDefinition` / `JobDefinition` (runner fields); keep the keys below stable.

import type { Scope } from "./scope";
import type { Logger } from "./logger";

// --- roles and permissions ---------------------------------------------------------------------------

/** The five fixed roles (D55), per seller account. */
export const ROLES = ["owner", "admin", "manager", "analyst", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** `modules/<m>/src/permissions/<k>.permissions.ts` default-exports PermissionDecl[]. */
export interface PermissionDecl {
  /** `<area>.<action>`, e.g. `ads.write`. */
  permission: string;
  /** Roles that hold it (listed explicitly; no implicit inheritance). */
  roles: readonly Role[];
}
export const definePermissions = (decls: readonly PermissionDecl[]): readonly PermissionDecl[] =>
  decls;

// --- HTTP routes -------------------------------------------------------------------------------------

export interface OperationRequest {
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  /** Resolved by the API guard from `x-scope` (null only for `x-public` operations). */
  scope: Scope | null;
  traceId: string;
  log: Logger;
}

export interface OperationResponse<T = unknown> {
  status: number;
  body?: T;
  headers?: Record<string, string>;
}

export type OperationHandler = (req: OperationRequest) => Promise<OperationResponse | unknown>;

/** What the API gives a route module. */
export interface ApiRouter {
  /** Binds a contract `operationId` to a handler. Unknown ids fail the boot. */
  operation(operationId: string, handler: OperationHandler): void;
}

/** `modules/<m>/src/routes/<k>/*.route.ts` default-exports a RouteModule. */
export type RouteModule = (router: ApiRouter) => void | Promise<void>;
export const defineRoutes = (fn: RouteModule): RouteModule => fn;
export const respond = <T>(
  status: number,
  body?: T,
  headers?: Record<string, string>,
): OperationResponse<T> => ({
  status,
  ...(body !== undefined ? { body } : {}),
  ...(headers ? { headers } : {}),
});

// --- worker: sync definitions and jobs ---------------------------------------------------------------

/** Every job payload carries these (conventions §8); a job without them is rejected. */
export interface JobPayloadBase {
  tenantId: string;
  sellerAccountId: string;
  traceId: string;
}

/** ADR-0008 `SyncDefinition`. P3-INGEST adds runner-specific fields through the index signature. */
export interface SyncDefinition {
  /** Unique, e.g. `ads.sp-report-daily`; the build fails on a duplicate. */
  key: string;
  /** Runner family, e.g. `paged-pull`, `ads-report`, `sp-report`. */
  family: string;
  appliesTo?: Record<string, unknown>;
  schedule?: { every: string; jitter?: string };
  window?: Record<string, unknown>;
  /** Amazon operation ids, checked against the catalog allow-list by P3-INGEST. */
  operations?: readonly string[];
  [extra: string]: unknown;
}
export const defineSync = <T extends SyncDefinition>(d: T): T => d;

export interface JobContext<P extends JobPayloadBase = JobPayloadBase> {
  data: P;
  log: Logger;
  jobId: string;
}

/** `modules/<m>/src/jobs/<k>/*.job.ts` default-exports a JobDefinition (extension of ADR-0008). */
export interface JobDefinition<P extends JobPayloadBase = JobPayloadBase> {
  /** `<module>.<job>`. */
  queue: string;
  process: (ctx: JobContext<P>) => Promise<unknown>;
  schedule?: { every: string };
  concurrency?: number;
}
export const defineJob = <P extends JobPayloadBase>(d: JobDefinition<P>): JobDefinition<P> => d;

// --- command handlers (Amazon writes, ADR-0011) -------------------------------------------------------

export interface CommandItemResult {
  index: number;
  status: "succeeded" | "failed";
  retryable?: boolean;
  error?: { code: string; message?: string; meta?: Record<string, unknown> };
}

export interface CommandHandler<Item = unknown> {
  /** `ads.target.update-bid`. Unique; the build fails on a duplicate. */
  kind: string;
  /** JSON Schema of one command's payload; mirrored in the slice contract with `x-command-kind`. */
  payloadSchema: Record<string, unknown>;
  /** Permission needed to submit the kind (declared in a permissions file). */
  permission: string;
  /** Items per Amazon call; from `catalog/ads/operations.json` `batchMax` (trap 15). */
  batchMax: number;
  apply: (scope: Scope, items: readonly Item[]) => Promise<CommandItemResult[]>;
  reconcile?: (scope: Scope, items: readonly Item[]) => Promise<CommandItemResult[]>;
}
export const defineCommand = <Item>(d: CommandHandler<Item>): CommandHandler<Item> => d;

// --- web: navigation and slots (plain data; React types live in apps/web) -----------------------------

/** `apps/web/features/<m>/<k>/<k>.nav.ts` default-exports NavEntry (or an array). */
export interface NavEntry {
  id: string;
  /** Key in the message catalogue (`<m>.<k>` namespace). */
  labelKey: string;
  href: string;
  section: string;
  order: number;
  permission: string;
}
export const defineNav = <T extends NavEntry | readonly NavEntry[]>(n: T): T => n;

// --- metrics ----------------------------------------------------------------------------------------

/** `packages/metrics/src/<domain>/*.metric.ts` default-exports a MetricDefinition (conventions §5). */
export interface MetricDefinition {
  id: string;
  /** Machine-readable formula over summed base measures, e.g. `spend / sales`. */
  formula: string;
  unit: "money" | "ratio" | "count" | "percent";
  /** Which direction is better, for colouring. */
  direction: "higher_is_better" | "lower_is_better" | "neutral";
  /** Key in the message catalogue. */
  labelKey: string;
}
export const defineMetric = (m: MetricDefinition): MetricDefinition => m;
