// 207 Multi-Status mapping (ADR-0006). A 207 is never "success" as a whole: every input item ends up either
// `ok` with its entity, or `!ok` with errors. An item Amazon did not mention at all is a failure
// (`missing_result`), never an assumed success.
//
// Shapes handled (spec sources: catalog/ads/operations.json `multiStatus207`):
//  - Ads v1:  { success: [{ index, <entity>: {...} }], error: [{ index, errors: [{ code, message, fieldLocation }] }] }
//  - Ads v0 (SP v3 style): { <batchField>: { success: [{ index, <entity>Id, <entity> }], error: [{ index, errors: [{ errorType, errorValue }] }] } }

export interface AmazonItemError {
  code: string;
  message?: string;
  /** JSON-pointer-like location inside the item (`fieldLocation` in v1). */
  fieldLocation?: string;
  /** Anything else Amazon sent for this error, already free of secrets. */
  meta?: unknown;
}

export type BatchItem<TIn, TOut> =
  | { index: number; input: TIn; ok: true; entity: TOut }
  | { index: number; input: TIn; ok: false; errors: AmazonItemError[]; retryable: boolean };

export interface BatchResult<TIn, TOut> {
  items: BatchItem<TIn, TOut>[];
  succeeded: number;
  failed: number;
  /** Every item succeeded. */
  allOk: boolean;
  /** Some succeeded and some failed (the command is `partially_succeeded`, conventions §3). */
  partial: boolean;
}

const RETRYABLE_ITEM_CODES = new Set([
  "INTERNAL_ERROR",
  "INTERNAL_FAILURE",
  "INTERNAL_SERVER_ERROR",
  "TOO_MANY_REQUESTS",
  "THROTTLED",
  "CONFLICT",
  "SERVICE_UNAVAILABLE",
]);

export const isRetryableItemError = (errors: readonly AmazonItemError[]): boolean =>
  errors.length > 0 && errors.every((e) => RETRYABLE_ITEM_CODES.has(e.code));

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function normaliseErrors(raw: unknown): AmazonItemError[] {
  if (!Array.isArray(raw)) return [{ code: "unknown_error", meta: raw }];
  return raw.map((e): AmazonItemError => {
    if (!isObj(e)) return { code: "unknown_error", meta: e };
    // v1: { code, message, fieldLocation }. v0: { errorType, errorValue: { <kind>: { message, … } } }.
    const code = String(e.code ?? e.errorType ?? "unknown_error");
    let message = typeof e.message === "string" ? e.message : undefined;
    let meta: unknown;
    if (isObj(e.errorValue)) {
      meta = e.errorValue;
      const first = Object.values(e.errorValue).find(isObj);
      if (message === undefined && first && typeof first.message === "string")
        message = first.message;
    }
    const out: AmazonItemError = { code };
    if (message !== undefined) out.message = message;
    if (typeof e.fieldLocation === "string") out.fieldLocation = e.fieldLocation;
    if (meta !== undefined) out.meta = meta;
    return out;
  });
}

export interface MapOptions {
  /** v0 wrapper key (`campaigns`) around `{ success, error }`. Omit for v1. */
  wrapperKey?: string | null | undefined;
  /** Name of the entity property inside a success item; default = the first object-valued property other than `index`. */
  entityKey?: string | undefined;
  /** Index of `inputs[0]` in Amazon's numbering (when this chunk is part of a larger batch). Default 0. */
  offset?: number;
}

export function mapMultiStatus<TIn, TOut = unknown>(
  inputs: readonly TIn[],
  payload: unknown,
  options: MapOptions = {},
): BatchResult<TIn, TOut> {
  const offset = options.offset ?? 0;
  let body: unknown = payload;
  if (options.wrapperKey && isObj(payload)) body = payload[options.wrapperKey];
  const success = isObj(body) && Array.isArray(body.success) ? (body.success as unknown[]) : [];
  const error = isObj(body) && Array.isArray(body.error) ? (body.error as unknown[]) : [];

  const byIndex = new Map<number, BatchItem<TIn, TOut>>();
  for (const s of success) {
    if (!isObj(s) || typeof s.index !== "number") continue;
    const i = s.index - offset;
    if (i < 0 || i >= inputs.length) continue;
    const key =
      options.entityKey ??
      Object.keys(s).find((k) => k !== "index" && isObj(s[k])) ??
      Object.keys(s).find((k) => k !== "index");
    byIndex.set(i, {
      index: i,
      input: inputs[i] as TIn,
      ok: true,
      entity: (key ? s[key] : s) as TOut,
    });
  }
  for (const e of error) {
    if (!isObj(e) || typeof e.index !== "number") continue;
    const i = e.index - offset;
    if (i < 0 || i >= inputs.length) continue;
    const errors = normaliseErrors(e.errors);
    byIndex.set(i, {
      index: i,
      input: inputs[i] as TIn,
      ok: false,
      errors,
      retryable: isRetryableItemError(errors),
    });
  }

  const items: BatchItem<TIn, TOut>[] = inputs.map(
    (input, i) =>
      byIndex.get(i) ?? {
        index: i,
        input,
        ok: false,
        errors: [{ code: "missing_result", message: "Amazon returned no result for this item" }],
        retryable: true,
      },
  );
  return summarise(items);
}

export function summarise<TIn, TOut>(items: BatchItem<TIn, TOut>[]): BatchResult<TIn, TOut> {
  const succeeded = items.filter((i) => i.ok).length;
  const failed = items.length - succeeded;
  return { items, succeeded, failed, allOk: failed === 0, partial: succeeded > 0 && failed > 0 };
}

/** Splits `items` into chunks of at most `max` (the operation's `batchMax`, catalog/ads/operations.json). */
export function chunk<T>(items: readonly T[], max: number): T[][] {
  if (!Number.isInteger(max) || max < 1) throw new Error("batch size must be a positive integer");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += max) out.push(items.slice(i, i + max));
  return out;
}

/** Merges per-chunk results back into one result in original input order, re-indexing items. */
export function mergeBatchResults<TIn, TOut>(
  chunks: readonly BatchResult<TIn, TOut>[],
): BatchResult<TIn, TOut> {
  const items: BatchItem<TIn, TOut>[] = [];
  for (const c of chunks) for (const it of c.items) items.push({ ...it, index: items.length });
  return summarise(items);
}

/** Result for chunks that could not be sent at all (the whole call failed): every item fails with the same error. */
export function failedBatch<TIn, TOut = never>(
  inputs: readonly TIn[],
  error: AmazonItemError,
  retryable: boolean,
): BatchResult<TIn, TOut> {
  return summarise(
    inputs.map((input, index): BatchItem<TIn, TOut> => ({
      index,
      input,
      ok: false,
      errors: [error],
      retryable,
    })),
  );
}
