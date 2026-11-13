import type { BatchResult, OperationArgs, OperationResponse } from "@seller-hub/amazon-core";
import type { AdsCallOptions, AdsClient, AdsScope } from "../ads-client";
import type { AdsOperationId, AdsOperationTypes } from "../generated/operations";

// Domain ports for the v1 sponsored-ads structure (D53): callers depend on these, never on an Ads API
// generation. A v1 adapter implements each port today; if Amazon changes the API, one adapter changes.

export interface Page<T> {
  items: T[];
  /** Pass back as `nextToken` in the request to get the next page. */
  nextToken?: string;
}

/** Typed request body of an operation, taken from Amazon's spec. */
export type BodyOf<K extends AdsOperationId> =
  OperationArgs<AdsOperationTypes[K]> extends { body: infer B } ? B : never;

/** Element type of the array property `F` of a request/response type. */
export type ItemOf<T, F extends string> = T extends { [P in F]?: readonly (infer I)[] } ? I : never;

export type ResponseOf<K extends AdsOperationId> = OperationResponse<AdsOperationTypes[K]>;

export interface EntityPort<Q, C, U, E> {
  /** One page. */
  query(scope: AdsScope, request: Q, options?: AdsCallOptions): Promise<Page<E>>;
  /** Every page, following `nextToken`. */
  queryPages(
    scope: AdsScope,
    request: Q,
    options?: AdsCallOptions,
  ): AsyncGenerator<E[], void, void>;
  /** Chunked by the catalogue `batchMax`; one result per input, in order (207 is never success as a whole). */
  create(
    scope: AdsScope,
    items: readonly C[],
    options?: AdsCallOptions,
  ): Promise<BatchResult<C, E>>;
  update(
    scope: AdsScope,
    items: readonly U[],
    options?: AdsCallOptions,
  ): Promise<BatchResult<U, E>>;
  delete(
    scope: AdsScope,
    ids: readonly string[],
    options?: AdsCallOptions,
  ): Promise<BatchResult<string, unknown>>;
}

export interface EntityOperations {
  query: AdsOperationId;
  create: AdsOperationId;
  update: AdsOperationId;
  delete: AdsOperationId;
  /** Property of the query response that holds the entities (`campaigns`). */
  listKey: string;
}

export function createEntityAdapter<Q, C, U, E>(
  ads: AdsClient,
  ops: EntityOperations,
): EntityPort<Q, C, U, E> {
  async function query(scope: AdsScope, request: Q, options?: AdsCallOptions): Promise<Page<E>> {
    const res = await ads.call(ops.query as "SPQueryCampaign", scope, { body: request } as never, {
      idempotent: true,
      ...options,
    });
    const body = (res.body ?? {}) as Record<string, unknown>;
    const items = (body[ops.listKey] as E[] | undefined) ?? [];
    const nextToken = typeof body.nextToken === "string" ? body.nextToken : undefined;
    return nextToken ? { items, nextToken } : { items };
  }
  return {
    query,
    async *queryPages(scope, request, options) {
      let token: string | undefined;
      do {
        const page = await query(
          scope,
          token ? ({ ...request, nextToken: token } as Q) : request,
          options,
        );
        if (page.items.length) yield page.items;
        token = page.nextToken;
      } while (token);
    },
    create: (scope, items, options) => ads.batch<C, E>(ops.create, scope, items, options),
    update: (scope, items, options) => ads.batch<U, E>(ops.update, scope, items, options),
    delete: (scope, ids, options) => ads.batch<string, unknown>(ops.delete, scope, ids, options),
  };
}
