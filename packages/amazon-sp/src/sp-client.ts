import type {
  AmazonClient,
  CallResult,
  OperationArgs,
  OperationResponse,
  Region,
  WaitMode,
} from "@seller-hub/amazon-core";
import { OperationUsageError, PiiDisabled } from "@seller-hub/amazon-core";
import { SP_OPERATIONS } from "./generated/operations";
import type { SpOperationId, SpOperationTypes } from "./generated/operations";
import { checkRestriction, withRestrictedDataToken } from "./restriction";

/** Which seller account a call runs as. Seller and vendor accounts use the same shape (D5). */
export interface SpScope {
  readonly tenantId: string;
  readonly sellerAccountId: string;
  readonly region: Region;
}

export interface SpCallOptions {
  /** Default: wait for the rate limiter. Interactive callers use `{ kind: "failFast" }`. */
  wait?: WaitMode;
  /** The caller guarantees a repeated write cannot duplicate its effect. */
  idempotent?: boolean;
}

export type SpResult<K extends SpOperationId> = CallResult<OperationResponse<SpOperationTypes[K]>>;

type Args<K extends SpOperationId> = OperationArgs<SpOperationTypes[K]>;
type CallRest<K extends SpOperationId> =
  object extends Args<K>
    ? [args?: Args<K>, options?: SpCallOptions]
    : [args: Args<K>, options?: SpCallOptions];

type FamilyOf<K extends string> = K extends `${infer F}.${string}` ? F : never;
export type SpFamily = FamilyOf<SpOperationId>;

/** `sp.sellers.getMarketplaceParticipations(scope)` - one method per generated operation, typed from Amazon's model. */
export type SpFamilyApi<F extends string> = {
  [K in SpOperationId as K extends `${F}.${infer O}` ? O : never]: (
    scope: SpScope,
    ...rest: CallRest<K>
  ) => Promise<SpResult<K>>;
};

export type SpClient = {
  /** Generic entry point: `sp.call("reports.createReport", scope, { body })`. */
  call<K extends SpOperationId>(id: K, scope: SpScope, ...rest: CallRest<K>): Promise<SpResult<K>>;
  /** Restricted Data Token flow. D11: always throws `PiiDisabled`. */
  withRestrictedDataToken: typeof withRestrictedDataToken;
  /** Pre-signed document download (reports, feeds): no auth header, retried, gunzipped. */
  download(url: string, options?: { compression?: "auto" | "gzip" | "none" }): Promise<Uint8Array>;
  /** Sleep on the client's clock (tests use a manual one). */
  sleep(ms: number): Promise<void>;
  now(): number;
} & { [F in SpFamily]: SpFamilyApi<F> };

export function createSpClient(core: AmazonClient): SpClient {
  async function call<K extends SpOperationId>(
    id: K,
    scope: SpScope,
    args?: Args<K>,
    options: SpCallOptions = {},
  ): Promise<SpResult<K>> {
    const meta = (
      SP_OPERATIONS as Record<string, (typeof SP_OPERATIONS)[SpOperationId] | undefined>
    )[id];
    if (!meta)
      throw new OperationUsageError(`unknown SP-API operation "${id}"`, {
        operation: id,
        api: "sp",
      });
    const a = (args ?? {}) as {
      path?: Record<string, string | number>;
      query?: Record<string, unknown>;
      body?: unknown;
    };

    const verdict = checkRestriction(id, meta.restricted === true, a);
    if (verdict.refuse) throw new PiiDisabled(id, verdict.refuse);

    const result = await core.call({
      operation: meta,
      ref: {
        tenantId: scope.tenantId,
        sellerAccountId: scope.sellerAccountId,
        api: "sp",
        region: scope.region,
      },
      ...(a.path ? { path: a.path } : {}),
      ...(a.query ? { query: a.query } : {}),
      ...(a.body !== undefined ? { body: a.body } : {}),
      ...(options.wait ? { wait: options.wait } : {}),
      ...(options.idempotent !== undefined ? { idempotent: options.idempotent } : {}),
      ...(verdict.allowedBecause
        ? { piiCheck: { verifiedNoPii: true as const, reason: verdict.allowedBecause } }
        : {}),
    });
    return result as SpResult<K>;
  }

  const base = {
    call: (id: SpOperationId, scope: SpScope, ...rest: unknown[]) =>
      (
        call as (
          id: SpOperationId,
          scope: SpScope,
          args?: unknown,
          options?: SpCallOptions,
        ) => Promise<unknown>
      )(id, scope, rest[0], rest[1] as SpCallOptions | undefined),
    withRestrictedDataToken,
    download: (url: string, options?: { compression?: "auto" | "gzip" | "none" }) =>
      core.download(url, options ?? {}),
    sleep: (ms: number) => core.time.sleep(ms),
    now: () => core.time.now(),
  };

  const families = new Map<string, unknown>();
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || prop in target) return Reflect.get(target, prop, receiver);
      if (!Object.keys(SP_OPERATIONS).some((k) => k.startsWith(`${prop}.`))) return undefined;
      let api = families.get(prop);
      if (!api) {
        api = new Proxy(
          {},
          {
            get(_t, op) {
              if (typeof op !== "string") return undefined;
              const id = `${prop}.${op}`;
              if (!(id in SP_OPERATIONS)) return undefined;
              return (scope: SpScope, args?: unknown, options?: SpCallOptions) =>
                (
                  call as (
                    id: string,
                    scope: SpScope,
                    args?: unknown,
                    options?: SpCallOptions,
                  ) => Promise<unknown>
                )(id, scope, args, options);
            },
          },
        );
        families.set(prop, api);
      }
      return api;
    },
  }) as unknown as SpClient;
}
