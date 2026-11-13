import type {
  AmazonClient,
  BatchResult,
  CallResult,
  OperationArgs,
  OperationMeta,
  OperationResponse,
  Region,
  WaitMode,
} from "@seller-hub/amazon-core";
import {
  AmazonApiError,
  AmazonThrottledError,
  AmazonUpstreamError,
  LocalRateLimitError,
  OperationUsageError,
  chunk,
  failedBatch,
  mapMultiStatus,
  mergeBatchResults,
} from "@seller-hub/amazon-core";
import { ADS_OPERATIONS, ADS_V0_EXCEPTIONS } from "./generated/operations";
import type { AdsOperationId, AdsOperationTypes } from "./generated/operations";

/** Which seller account's Ads credential a call runs as, plus the Ads headers that pick the advertiser. */
export interface AdsScope {
  readonly tenantId: string;
  readonly sellerAccountId: string;
  readonly region: Region;
  /** `Amazon-Advertising-API-Scope`: the Ads profile id. Required by most v0 calls, optional in v1. */
  readonly profileId?: string;
  /** `Amazon-Ads-AccountId`: the advertiser account id (v1). */
  readonly accountId?: string;
}

export interface AdsCallOptions {
  wait?: WaitMode;
  idempotent?: boolean;
  /** Media type override for operations that offer several versions (v0 recommendations). */
  accept?: string;
  /** Extra request headers (for example `Prefer`). */
  headers?: Record<string, string>;
}

export type AdsResult<K extends AdsOperationId> = CallResult<
  OperationResponse<AdsOperationTypes[K]>
>;
type Args<K extends AdsOperationId> = OperationArgs<AdsOperationTypes[K]>;
type CallRest<K extends AdsOperationId> =
  object extends Args<K>
    ? [args?: Args<K>, options?: AdsCallOptions]
    : [args: Args<K>, options?: AdsCallOptions];

export type AdsClient = {
  call<K extends AdsOperationId>(
    id: K,
    scope: AdsScope,
    ...rest: CallRest<K>
  ): Promise<AdsResult<K>>;
  /**
   * Batch write/query-by-items with 207 mapping: chunks `items` by the operation's catalogue `batchMax`, sends one
   * request per chunk and returns one result per input item, in input order (conventions §3 `partially_succeeded`).
   */
  batch<TIn, TOut = unknown>(
    id: AdsOperationId,
    scope: AdsScope,
    items: readonly TIn[],
    options?: AdsBatchOptions,
  ): Promise<BatchResult<TIn, TOut>>;
  download(url: string, options?: { compression?: "auto" | "gzip" | "none" }): Promise<Uint8Array>;
  sleep(ms: number): Promise<void>;
  now(): number;
  readonly core: AmazonClient;
} & { [K in AdsOperationId]: (scope: AdsScope, ...rest: CallRest<K>) => Promise<AdsResult<K>> };

export interface AdsBatchOptions extends AdsCallOptions {
  /** Extra body properties sent with every chunk (for example `{ adProductFilter: … }`). */
  extraBody?: Record<string, unknown>;
}

/** Operation id → its catalogue metadata, with the D53 rule enforced: a v0 operation must be a named exception. */
function metaOf(id: string): OperationMeta {
  const meta = (ADS_OPERATIONS as Record<string, OperationMeta | undefined>)[id];
  if (!meta)
    throw new OperationUsageError(`unknown Ads operation "${id}"`, { operation: id, api: "ads" });
  if (meta.generation === "v0" && !ADS_V0_EXCEPTIONS[id]) {
    throw new OperationUsageError(`${id} is a v0 operation without a named exception (D53)`, {
      operation: id,
      api: "ads",
    });
  }
  return meta;
}

export function createAdsClient(core: AmazonClient): AdsClient {
  async function call(
    id: string,
    scope: AdsScope,
    args?: unknown,
    options: AdsCallOptions = {},
  ): Promise<CallResult<unknown>> {
    const meta = metaOf(id);
    const a = (args ?? {}) as {
      path?: Record<string, string | number>;
      query?: Record<string, unknown>;
      body?: unknown;
    };
    return core.call({
      operation: meta,
      ref: {
        tenantId: scope.tenantId,
        sellerAccountId: scope.sellerAccountId,
        api: "ads",
        region: scope.region,
      },
      ...(a.path ? { path: a.path } : {}),
      ...(a.query ? { query: a.query } : {}),
      ...(a.body !== undefined ? { body: a.body } : {}),
      ...(scope.profileId ? { profileId: scope.profileId } : {}),
      ...(scope.accountId ? { accountId: scope.accountId } : {}),
      ...(options.wait ? { wait: options.wait } : {}),
      ...(options.idempotent !== undefined ? { idempotent: options.idempotent } : {}),
      ...(options.accept ? { accept: options.accept } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
    });
  }

  async function batch<TIn, TOut>(
    id: string,
    scope: AdsScope,
    items: readonly TIn[],
    options: AdsBatchOptions = {},
  ): Promise<BatchResult<TIn, TOut>> {
    const meta = metaOf(id);
    if (!meta.batchField || !meta.multiStatus207) {
      throw new OperationUsageError(
        `${id} is not a batch operation (no batchField / 207 in the catalogue)`,
        { operation: id, api: "ads" },
      );
    }
    const max = meta.batchMax ?? 1000;
    const chunks = chunk(items, max);
    const results: BatchResult<TIn, TOut>[] = [];
    for (const part of chunks) {
      try {
        // v0 batch writes whose catalogue lists a `Prefer` header need `return=representation` or success items
        // carry only ids (ADR-0006).
        const prefer = meta.headers?.some((h) => h.name.toLowerCase() === "prefer")
          ? { prefer: "return=representation" }
          : {};
        const res = await call(
          id,
          scope,
          { body: { ...(options.extraBody ?? {}), [meta.batchField]: part } },
          { ...options, headers: { ...prefer, ...options.headers } },
        );
        results.push(
          mapMultiStatus<TIn, TOut>(part, res.body, {
            wrapperKey: meta.generation === "v0" ? meta.batchField : null,
            idempotent: meta.idempotent === true || options.idempotent === true,
          }),
        );
      } catch (error) {
        // Whole-request failures become per-item failures so a bulk command can report them item by item.
        // Credential / usage / PII problems are not item-level: they propagate.
        if (error instanceof AmazonApiError) {
          results.push(
            failedBatch<TIn, TOut>(
              part,
              { code: error.amazonCode ?? `http_${error.status}`, message: error.message },
              false,
            ),
          );
        } else if (error instanceof AmazonThrottledError || error instanceof LocalRateLimitError) {
          results.push(
            failedBatch<TIn, TOut>(
              part,
              { code: "TOO_MANY_REQUESTS", message: error.message },
              true,
            ),
          );
        } else if (error instanceof AmazonUpstreamError) {
          results.push(
            failedBatch<TIn, TOut>(
              part,
              {
                code: error.retryable ? "UPSTREAM_ERROR" : "outcome_unknown",
                message: error.message,
              },
              error.retryable,
            ),
          );
        } else throw error;
      }
    }
    return mergeBatchResults(results);
  }

  const base = {
    call: (id: string, scope: AdsScope, ...rest: unknown[]) =>
      call(id, scope, rest[0], rest[1] as AdsCallOptions | undefined),
    batch,
    download: (url: string, options?: { compression?: "auto" | "gzip" | "none" }) =>
      core.download(url, options ?? {}),
    sleep: (ms: number) => core.time.sleep(ms),
    now: () => core.time.now(),
    core,
  };
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || prop in target) return Reflect.get(target, prop, receiver);
      if (!(prop in ADS_OPERATIONS)) return undefined;
      return (scope: AdsScope, args?: unknown, options?: AdsCallOptions) =>
        call(prop, scope, args, options);
    },
  }) as unknown as AdsClient;
}
