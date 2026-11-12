import type { Clock, Random } from "./clock";
import { downloadDocument } from "./download";
import type { DownloadOptions } from "./download";
import { systemClock } from "./clock";
import type { CredentialRef } from "./credentials";
import { appFingerprint } from "./credentials";
import {
  AmazonApiError,
  AmazonAuthError,
  AmazonNotFoundError,
  AmazonThrottledError,
  AmazonUpstreamError,
  AmazonValidationError,
  OperationUsageError,
  PiiDisabled,
  ReplayMissError,
} from "./errors";
import type { ErrorContext } from "./errors";
import type { LwaTokenService } from "./lwa";
import type { CallObserver } from "./observer";
import { noopObserver } from "./observer";
import type { BucketSpec, RateLimiter, WaitMode } from "./rate-limit";
import { bucketKey } from "./rate-limit";
import type { AmazonMode } from "./regions";
import { baseUrlFor } from "./regions";
import { DEFAULT_RETRY_POLICY, classifyStatus, fullJitterDelayMs, parseRetryAfter } from "./retry";
import type { RetryPolicy } from "./retry";
import type { HttpRequest, HttpResponse, HttpTransport, OperationMeta } from "./types";
import { encodeText, jsonOf, textOf } from "./types";

// The one way to call Amazon (ADR-0006). One `call()` = credential → token → rate limit → send → classify →
// retry/backoff → typed result or typed error, with exactly one observer event at the end.

export interface AdsLimiterDefaults extends BucketSpec {
  /** AIMD floor / ceiling / additive step (requests per second). */
  minRate: number;
  maxRate: number;
  step: number;
}

export interface AmazonClientOptions {
  mode: AmazonMode;
  transport: HttpTransport;
  lwa: LwaTokenService;
  limiter: RateLimiter;
  clock?: Clock;
  random?: Random;
  retry?: RetryPolicy;
  observer?: CallObserver;
  /** SP-API requires a User-Agent that names the app. */
  userAgent?: string;
  requestTimeoutMs?: number;
  /** Ads has no limit table: conservative start, AIMD afterwards (ADR-0006). */
  ads?: AdsLimiterDefaults;
}

export interface CallInput {
  operation: OperationMeta;
  ref: CredentialRef;
  path?: Record<string, string | number>;
  query?: Record<string, unknown>;
  /** JSON body (serialised here). */
  body?: unknown;
  /** Pre-encoded body (feeds, uploads); wins over `body`. */
  rawBody?: string | Uint8Array;
  headers?: Record<string, string>;
  /** Ads: profile id for `Amazon-Advertising-API-Scope`. */
  profileId?: string;
  /** Ads: advertiser account id for `Amazon-Ads-AccountId`. */
  accountId?: string;
  accept?: string;
  contentType?: string;
  /** Default: wait for the limiter (workers). Interactive callers pass `{ kind: "failFast" }`. */
  wait?: WaitMode;
  /** The caller guarantees repeating this write cannot duplicate its effect (natural key / idempotency key). */
  idempotent?: boolean;
  responseType?: "json" | "bytes";
  /** A Restricted Data Token. Not supported while D11 = no PII: setting it is refused. */
  restrictedDataToken?: string;
  /**
   * Set ONLY by a typed client that has inspected this exact request and found it carries no PII data element
   * (for example `orders.searchOrders` without BUYER / RECIPIENT in `includedData`). Without it, every operation
   * the catalogue flags `restricted` is refused (D11, fail closed).
   */
  piiCheck?: { verifiedNoPii: true; reason: string };
}

export interface CallResult<T> {
  status: number;
  headers: Record<string, string>;
  body: T;
  requestId?: string;
  /** Total sends including the first. */
  attempts: number;
}

const DEFAULT_ADS: AdsLimiterDefaults = { rate: 2, burst: 4, minRate: 0.2, maxRate: 10, step: 0.1 };

export class AmazonClient {
  private readonly clock: Clock;
  private readonly random: Random;
  private readonly retry: RetryPolicy;
  private readonly observer: CallObserver;
  private readonly ads: AdsLimiterDefaults;

  constructor(private readonly options: AmazonClientOptions) {
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.retry = options.retry ?? DEFAULT_RETRY_POLICY;
    this.observer = options.observer ?? noopObserver;
    this.ads = options.ads ?? DEFAULT_ADS;
  }

  get mode(): AmazonMode {
    return this.options.mode;
  }

  get time(): Clock {
    return this.clock;
  }

  /** Fetches a pre-signed report / export URL (no auth header), retried, gunzipped when gzip. */
  download(
    url: string,
    options: Pick<DownloadOptions, "compression" | "maxBytes"> = {},
  ): Promise<Uint8Array> {
    return downloadDocument({
      transport: this.options.transport,
      url,
      clock: this.clock,
      random: this.random,
      retry: this.retry,
      ...options,
    });
  }

  async call<T = unknown>(input: CallInput): Promise<CallResult<T>> {
    const op = input.operation;
    const ref = input.ref;
    const ctx: ErrorContext = { operation: op.id, api: op.api, region: ref.region };
    const started = this.clock.now();
    const stats = {
      retries: 0,
      throttled: false,
      waitedMs: 0,
      status: undefined as number | undefined,
      requestId: undefined as string | undefined,
      rateLimit: undefined as string | undefined,
    };
    try {
      const result = await this.run<T>(input, ctx, stats);
      this.emit(input, started, stats, undefined);
      return result;
    } catch (error) {
      this.emit(input, started, stats, error);
      throw error;
    }
  }

  private emit(
    input: CallInput,
    started: number,
    stats: {
      retries: number;
      throttled: boolean;
      waitedMs: number;
      status: number | undefined;
      requestId: string | undefined;
      rateLimit: string | undefined;
    },
    error: unknown,
  ): void {
    try {
      this.observer.onCall({
        operation: input.operation.id,
        api: input.operation.api,
        region: input.ref.region,
        tenantId: input.ref.tenantId,
        sellerAccountId: input.ref.sellerAccountId,
        ...(stats.status !== undefined ? { status: stats.status } : {}),
        durationMs: this.clock.now() - started,
        ...(stats.requestId !== undefined ? { requestId: stats.requestId } : {}),
        ...(stats.rateLimit !== undefined ? { rateLimit: stats.rateLimit } : {}),
        retries: stats.retries,
        throttled: stats.throttled,
        waitedMs: stats.waitedMs,
        outcome: error === undefined ? "ok" : "error",
        ...(error !== undefined
          ? { error: error instanceof Error ? error.name : "UnknownError" }
          : {}),
      });
    } catch {
      // observers must never break a call
    }
  }

  private async run<T>(
    input: CallInput,
    ctx: ErrorContext,
    stats: {
      retries: number;
      throttled: boolean;
      waitedMs: number;
      status: number | undefined;
      requestId: string | undefined;
      rateLimit: string | undefined;
    },
  ): Promise<CallResult<T>> {
    const op = input.operation;
    const ref = input.ref;

    if (ref.api !== op.api) {
      throw new OperationUsageError(
        `credential is for ${ref.api} but ${op.id} is an ${op.api} operation`,
        ctx,
      );
    }
    // `op.regions` (from Amazon's role pages) is advisory: it is incomplete for some operations (sellers.getAccount
    // lists EU only, every model host is NA), so the seller account's region decides, not the catalogue.
    // D11: nothing that can return PII leaves the process. Checked here so no caller can bypass the SP client's own guard.
    if (
      input.restrictedDataToken !== undefined ||
      (op.restricted && !input.piiCheck?.verifiedNoPii)
    ) {
      throw new PiiDisabled(op.id, op.restrictedReason ?? "restricted data");
    }

    const isRead = op.method === "GET";
    const mayRepeatAfterServerError = isRead || input.idempotent === true || op.idempotent === true;
    const wait: WaitMode = input.wait ?? { kind: "wait" };

    let forcedRefresh = false;
    let attempt = 0;
    let lastRetryAfterMs = 0;

    for (;;) {
      attempt++;
      const { accessToken, clientId } = await this.options.lwa.getAccess(ref, {
        forceRefresh: forcedRefresh,
      });
      forcedRefresh = false;

      const key = bucketKey({
        tenantId: ref.tenantId,
        appId: appFingerprint({ clientId }),
        api: ref.api,
        region: ref.region,
        sellerAccountId: ref.sellerAccountId,
        operation: op.api === "ads" ? op.family : op.id,
      });
      const spec: BucketSpec =
        op.api === "ads"
          ? { rate: this.ads.rate, burst: this.ads.burst }
          : (op.rateLimit ?? this.options.limiter.defaultSpec);
      stats.waitedMs += await this.options.limiter.acquire(key, spec, wait, ctx);

      const request = this.buildRequest(input, accessToken, clientId);
      let response: HttpResponse;
      try {
        response = await this.options.transport.send(request);
      } catch (cause) {
        // A missing fixture is a test-setup error, not a network failure: never retry or wrap it.
        if (cause instanceof ReplayMissError) throw cause;
        if (mayRepeatAfterServerError && attempt < this.retry.maxAttempts) {
          stats.retries++;
          await this.clock.sleep(fullJitterDelayMs(attempt, this.retry, this.random));
          continue;
        }
        throw new AmazonUpstreamError(
          mayRepeatAfterServerError
            ? `${op.id}: network failure after ${attempt} attempt(s)`
            : `${op.id}: network failure; the write may or may not have been applied, reconcile by re-reading`,
          ctx,
          mayRepeatAfterServerError,
          { cause },
        );
      }

      stats.status = response.status;
      const requestId =
        response.headers["x-amzn-requestid"] ?? response.headers["x-amz-request-id"];
      if (requestId !== undefined) stats.requestId = requestId;
      const rateHeader = response.headers["x-amzn-ratelimit-limit"];
      if (rateHeader !== undefined) stats.rateLimit = rateHeader;
      const withRequestId: ErrorContext = {
        ...ctx,
        status: response.status,
        ...(requestId ? { requestId } : {}),
      };

      if (response.status >= 200 && response.status < 300) {
        if (op.api === "sp") await this.options.limiter.observeAmazonLimit(key, rateHeader);
        else await this.options.limiter.onSuccess(key, spec, this.ads.step, this.ads.maxRate);
        const body = (input.responseType === "bytes" ? response.body : jsonOf(response)) as T;
        return {
          status: response.status,
          headers: response.headers,
          body,
          ...(requestId ? { requestId } : {}),
          attempts: attempt,
        };
      }

      const kind = classifyStatus(response.status);

      if (
        response.status === 401 &&
        attempt < this.retry.maxAttempts &&
        stats.retries === 0 &&
        !forcedRefresh
      ) {
        // Token may have been revoked or rotated: refresh once, then retry immediately.
        stats.retries++;
        forcedRefresh = true;
        continue;
      }

      if (kind === "throttle") {
        stats.throttled = true;
        const retryAfter = parseRetryAfter(response.headers["retry-after"], this.clock.now());
        lastRetryAfterMs = retryAfter ?? 0;
        if (op.api === "sp") await this.options.limiter.observeAmazonLimit(key, rateHeader);
        else await this.options.limiter.onThrottled(key, spec, this.ads.minRate);
        const tooLong = retryAfter !== undefined && retryAfter > this.retry.maxRetryAfterMs;
        if (tooLong || attempt >= this.retry.maxAttempts) {
          throw new AmazonThrottledError(
            `${op.id}: throttled by Amazon (429) after ${attempt} attempt(s)`,
            withRequestId,
            retryAfter ?? Math.max(lastRetryAfterMs, this.retry.baseMs),
          );
        }
        stats.retries++;
        await this.clock.sleep(
          Math.max(retryAfter ?? 0, fullJitterDelayMs(attempt, this.retry, this.random)),
        );
        continue;
      }

      if (kind === "server") {
        if (mayRepeatAfterServerError && attempt < this.retry.maxAttempts) {
          stats.retries++;
          await this.clock.sleep(
            Math.max(
              parseRetryAfter(response.headers["retry-after"], this.clock.now()) ?? 0,
              fullJitterDelayMs(attempt, this.retry, this.random),
            ),
          );
          continue;
        }
        throw new AmazonUpstreamError(
          mayRepeatAfterServerError
            ? `${op.id}: Amazon answered ${response.status} after ${attempt} attempt(s)`
            : `${op.id}: Amazon answered ${response.status}; the write may or may not have been applied, reconcile by re-reading`,
          withRequestId,
          mayRepeatAfterServerError,
        );
      }

      throw this.mapClientError(op, response, withRequestId);
    }
  }

  private mapClientError(
    op: OperationMeta,
    response: HttpResponse,
    ctx: ErrorContext & { status?: number },
  ): AmazonApiError {
    const parsed = parseErrorPayload(response);
    const status = response.status;
    const message = `${op.id}: Amazon answered ${status}${parsed.code ? ` ${parsed.code}` : ""}${parsed.message ? `: ${parsed.message}` : ""}`;
    const c = { ...ctx, status };
    if (status === 400 || status === 422)
      return new AmazonValidationError(message, c, parsed.code, parsed.details);
    if (status === 401 || status === 403)
      return new AmazonAuthError(message, c, parsed.code, parsed.details);
    if (status === 404) return new AmazonNotFoundError(message, c, parsed.code, parsed.details);
    return new AmazonApiError(message, c, parsed.code, parsed.details);
  }

  private buildRequest(input: CallInput, accessToken: string, clientId: string): HttpRequest {
    const op = input.operation;
    const base = baseUrlFor(op.api, input.ref.region, this.options.mode);
    const url = base + fillPath(op.path, input.path) + serialiseQuery(input.query);
    const headers: Record<string, string> = {
      accept: input.accept ?? op.accept?.[0] ?? "application/json",
      "user-agent": this.options.userAgent ?? "seller-hub/0 (Language=TypeScript)",
    };
    if (op.api === "sp") {
      headers["x-amz-access-token"] = accessToken;
    } else {
      headers.authorization = `Bearer ${accessToken}`;
      // v1 renamed the client-id header; v0 still uses the old one (docs/discovery/ads-domains.md §1).
      headers[op.generation === "v1" ? "amazon-ads-clientid" : "amazon-advertising-api-clientid"] =
        clientId;
      if (input.profileId) headers["amazon-advertising-api-scope"] = input.profileId;
      if (input.accountId) headers["amazon-ads-accountid"] = input.accountId;
    }
    let body: string | Uint8Array | undefined;
    if (input.rawBody !== undefined) body = input.rawBody;
    else if (input.body !== undefined) body = encodeText(JSON.stringify(input.body));
    if (body !== undefined)
      headers["content-type"] = input.contentType ?? op.contentType?.[0] ?? "application/json";
    Object.assign(headers, lowerCaseKeys(input.headers));
    return {
      method: op.method,
      url,
      headers,
      body,
      timeoutMs: this.options.requestTimeoutMs ?? 60_000,
    };
  }
}

function lowerCaseKeys(h: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = v;
  return out;
}

export function fillPath(
  template: string,
  params: Record<string, string | number> | undefined,
): string {
  return template.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    const v = params?.[name];
    if (v === undefined)
      throw new OperationUsageError(`missing path parameter "${name}" for ${template}`);
    return encodeURIComponent(String(v));
  });
}

/** SP-API / Ads convention: arrays are comma-separated, undefined/null skipped, booleans as true/false. */
export function serialiseQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    const value = Array.isArray(v) ? v.map(String).join(",") : String(v);
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(value)}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

const SECRETISH = /token|secret|password|authorization|credential|api[-_]?key/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      out[k] = SECRETISH.test(k) ? "[redacted]" : scrub(v, depth + 1);
    return out;
  }
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  return value;
}

/** Amazon error bodies: SP `{ errors: [{ code, message, details }] }`; Ads `{ code, message }` or `{ errors: [...] }`. */
export function parseErrorPayload(response: HttpResponse): {
  code?: string;
  message?: string;
  details: unknown;
} {
  const body = jsonOf(response);
  if (typeof body !== "object" || body === null) {
    const text = textOf(response.body).slice(0, 200);
    return { details: text === "" ? undefined : { text } };
  }
  const o = body as Record<string, unknown>;
  const first = Array.isArray(o.errors)
    ? (o.errors[0] as Record<string, unknown> | undefined)
    : undefined;
  const src = first ?? o;
  const code = typeof src.code === "string" ? src.code : undefined;
  const message = typeof src.message === "string" ? src.message.slice(0, 300) : undefined;
  return {
    ...(code !== undefined ? { code } : {}),
    ...(message !== undefined ? { message } : {}),
    details: scrub(body),
  };
}
