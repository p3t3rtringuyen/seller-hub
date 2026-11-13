import type { Logger } from "@seller-hub/core";
import type { ApiFamily, Region } from "./regions";

/** What one finished call (success or failure) reports. Allow-list: no URL, no query, no body, no headers, no token (conventions §7). */
export interface CallEvent {
  operation: string;
  api: ApiFamily;
  region: Region;
  tenantId: string;
  sellerAccountId: string;
  /** Last HTTP status seen; undefined when the call never got an answer (network failure, local rate limit). */
  status?: number;
  durationMs: number;
  /** `x-amzn-RequestId` / `x-amz-request-id` of the last answer. */
  requestId?: string;
  /** `x-amzn-RateLimit-Limit` of the last answer. */
  rateLimit?: string;
  /** Number of re-sends after the first attempt. */
  retries: number;
  /** At least one attempt was answered 429. */
  throttled: boolean;
  /** Milliseconds spent waiting for our own limiter. */
  waitedMs: number;
  outcome: "ok" | "error";
  /** Error class name when outcome = error. */
  error?: string;
}

/** Hook for logging, metrics and OTel spans. Must not throw; the client ignores anything it throws. */
export interface CallObserver {
  onCall(event: CallEvent): void;
}

export const noopObserver: CallObserver = { onCall: () => undefined };

/** Logs one line per call with the allow-listed fields only. */
export function loggerObserver(logger: Logger): CallObserver {
  return {
    onCall(e) {
      const line = {
        operation: e.operation,
        api: e.api,
        region: e.region,
        tenantId: e.tenantId,
        sellerAccountId: e.sellerAccountId,
        status: e.status,
        durationMs: Math.round(e.durationMs),
        requestId: e.requestId,
        rateLimit: e.rateLimit,
        retries: e.retries,
        throttled: e.throttled,
        waitedMs: Math.round(e.waitedMs),
        error: e.error,
      };
      if (e.outcome === "ok") logger.info(line, "amazon call");
      else logger.warn(line, "amazon call failed");
    },
  };
}

export function combineObservers(...observers: CallObserver[]): CallObserver {
  return {
    onCall(e) {
      for (const o of observers) {
        try {
          o.onCall(e);
        } catch {
          // observers must never break a call
        }
      }
    },
  };
}
