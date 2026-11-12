import type { Random } from "./clock";

// Retry policy (ADR-0006): 429 and 5xx/network on reads retry with full jitter (base 1 s, cap 60 s, 6 attempts),
// `Retry-After` is honoured, 400/401/403/404/422 are never retried (401 once after a forced token refresh).

export interface RetryPolicy {
  /** Total attempts including the first one. */
  maxAttempts: number;
  baseMs: number;
  capMs: number;
  /** A `Retry-After` longer than this is not slept on: the call fails with `AmazonThrottledError` so a worker can delay the job instead. */
  maxRetryAfterMs: number;
}

export const DEFAULT_RETRY_POLICY: Readonly<RetryPolicy> = {
  maxAttempts: 6,
  baseMs: 1000,
  capMs: 60_000,
  maxRetryAfterMs: 120_000,
};

/** AWS "full jitter": uniform in [0, min(cap, base · 2^(retry-1))]. `retry` counts from 1 (the first retry). */
export function fullJitterDelayMs(retry: number, policy: RetryPolicy, random: Random): number {
  const ceiling = Math.min(policy.capMs, policy.baseMs * 2 ** Math.max(0, retry - 1));
  return Math.floor(random() * ceiling);
}

/** `Retry-After` is either delta-seconds or an HTTP date. Returns ms, or undefined when absent or unparsable. */
export function parseRetryAfter(value: string | undefined, nowMs: number): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - nowMs);
}

export type Retryability = "never" | "throttle" | "server";

/**
 * 429 → "throttle" (Amazon did not process the request, safe for reads and writes).
 * 5xx → "server" (retry only reads or writes the caller marked idempotent).
 */
export function classifyStatus(status: number): Retryability {
  if (status === 429) return "throttle";
  if (status >= 500 && status <= 599) return "server";
  return "never";
}
