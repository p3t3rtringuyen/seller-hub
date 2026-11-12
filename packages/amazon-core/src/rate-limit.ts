import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { Clock } from "./clock";
import { systemClock } from "./clock";
import { LocalRateLimitError } from "./errors";
import type { ErrorContext } from "./errors";

// Distributed token bucket (ADR-0006). One bucket per (tenant, app, api, region, seller account, operation);
// every api/worker process talks to the same store, so one machine's burst counts against all of them.
//
// Semantics: `rate` tokens/second refill up to `burst`; a call costs 1 token and is granted only if a whole
// token is there (nothing is consumed on a refusal, the refusal says how long until one is). The rate can be
// overridden at runtime (SP-API: `x-amzn-RateLimit-Limit`; Ads: AIMD), the override carries a TTL.

export interface BucketSpec {
  rate: number;
  burst: number;
}

export interface TakeResult {
  granted: boolean;
  /** When refused: ms until one token is available at the current rate. */
  waitMs: number;
}

export interface BucketStore {
  take(key: string, spec: BucketSpec): Promise<TakeResult>;
  /** Overrides the refill rate for `key` for `ttlMs`. */
  setRate(key: string, rate: number, ttlMs: number): Promise<void>;
  getRate(key: string): Promise<number | null>;
}

/** Same algorithm as the Lua script, for tests and single-process dev. */
export class MemoryBucketStore implements BucketStore {
  private readonly buckets = new Map<string, { tokens: number; ts: number }>();
  private readonly rates = new Map<string, { rate: number; until: number }>();
  constructor(private readonly clock: Clock = systemClock) {}

  async take(key: string, spec: BucketSpec): Promise<TakeResult> {
    const now = this.clock.now();
    const rate = (await this.getRate(key)) ?? spec.rate;
    const b = this.buckets.get(key) ?? { tokens: spec.burst, ts: now };
    b.tokens = Math.min(spec.burst, b.tokens + (Math.max(0, now - b.ts) * rate) / 1000);
    b.ts = now;
    let result: TakeResult;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      result = { granted: true, waitMs: 0 };
    } else {
      result = { granted: false, waitMs: Math.ceil(((1 - b.tokens) * 1000) / rate) };
    }
    this.buckets.set(key, b);
    return result;
  }
  async setRate(key: string, rate: number, ttlMs: number) {
    this.rates.set(key, { rate, until: this.clock.now() + ttlMs });
  }
  async getRate(key: string) {
    const r = this.rates.get(key);
    if (!r) return null;
    if (r.until <= this.clock.now()) {
      this.rates.delete(key);
      return null;
    }
    return r.rate;
  }
}

// Refill uses Redis' own clock (TIME) so workers with skewed clocks share one budget.
const TAKE_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local override = redis.call('GET', KEYS[2])
if override then rate = tonumber(override) end
local st = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(st[1])
local ts = tonumber(st[2])
if tokens == nil then tokens = burst; ts = now end
tokens = math.min(burst, tokens + math.max(0, now - ts) * rate / 1000)
local granted = 0
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
  granted = 1
else
  wait = math.ceil((1 - tokens) * 1000 / rate)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil(burst * 1000 / rate) + 60000)
return {granted, wait}
`;

export class RedisBucketStore implements BucketStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "sh:",
  ) {}

  async take(key: string, spec: BucketSpec): Promise<TakeResult> {
    const [granted, wait] = (await this.redis.eval(
      TAKE_LUA,
      2,
      this.prefix + key,
      `${this.prefix}${key}:rate`,
      String(spec.rate),
      String(spec.burst),
    )) as [number, number];
    return { granted: granted === 1, waitMs: Number(wait) };
  }
  async setRate(key: string, rate: number, ttlMs: number) {
    await this.redis.set(`${this.prefix}${key}:rate`, String(rate), "PX", Math.ceil(ttlMs));
  }
  async getRate(key: string) {
    const v = await this.redis.get(`${this.prefix}${key}:rate`);
    return v === null ? null : Number(v);
  }
}

export type WaitMode = { kind: "wait"; maxWaitMs?: number } | { kind: "failFast" };

export interface LimiterOptions {
  store: BucketStore;
  clock?: Clock;
  /** Rate used when the catalogue has none (87 SP operations). Conservative on purpose. */
  defaultSpec?: BucketSpec;
  /** How long an `x-amzn-RateLimit-Limit` override lives. */
  overrideTtlMs?: number;
}

export class RateLimiter {
  private readonly store: BucketStore;
  private readonly clock: Clock;
  readonly defaultSpec: BucketSpec;
  private readonly overrideTtlMs: number;

  constructor(options: LimiterOptions) {
    this.store = options.store;
    this.clock = options.clock ?? systemClock;
    this.defaultSpec = options.defaultSpec ?? { rate: 1, burst: 2 };
    this.overrideTtlMs = options.overrideTtlMs ?? 60 * 60 * 1000;
  }

  /**
   * Takes one token. `wait` sleeps until it is available (up to `maxWaitMs`, default 2 min, then throws so the
   * worker can delay the job); `failFast` throws at once with the wait in `retryAfterMs` (interactive callers → 503).
   * Returns the milliseconds spent waiting.
   */
  async acquire(
    key: string,
    spec: BucketSpec,
    mode: WaitMode,
    context: ErrorContext = {},
  ): Promise<number> {
    const started = this.clock.now();
    const maxWait = mode.kind === "wait" ? (mode.maxWaitMs ?? 120_000) : 0;
    for (;;) {
      const r = await this.store.take(key, spec);
      if (r.granted) return this.clock.now() - started;
      const waited = this.clock.now() - started;
      if (mode.kind === "failFast" || waited + r.waitMs > maxWait) {
        throw new LocalRateLimitError(
          `rate limit: next slot for ${context.operation ?? key} in ${r.waitMs} ms`,
          context,
          r.waitMs,
        );
      }
      await this.clock.sleep(r.waitMs);
    }
  }

  /** SP-API sends its real rate in `x-amzn-RateLimit-Limit`; adopt it (it can differ from the documented one). */
  async observeAmazonLimit(key: string, headerValue: string | undefined): Promise<void> {
    if (headerValue === undefined) return;
    const rate = Number(headerValue);
    if (!Number.isFinite(rate) || rate <= 0) return;
    await this.store.setRate(key, rate, this.overrideTtlMs);
  }

  /** Ads AIMD, decrease: halve the rate on a 429 (never below `min`). */
  async onThrottled(key: string, spec: BucketSpec, min: number): Promise<number> {
    const current = (await this.store.getRate(key)) ?? spec.rate;
    const next = Math.max(min, current / 2);
    await this.store.setRate(key, next, this.overrideTtlMs);
    return next;
  }

  /** Ads AIMD, increase: creep up by `step` on success until the configured ceiling. */
  async onSuccess(key: string, spec: BucketSpec, step: number, max: number): Promise<number> {
    const current = (await this.store.getRate(key)) ?? spec.rate;
    if (current >= max) return current;
    const next = Math.min(max, current + step);
    await this.store.setRate(key, next, this.overrideTtlMs);
    return next;
  }
}

/** The bucket key (ADR-0006 `rl:{app}:{api}:{region}:{account}:{operation}`, tenant first per conventions §10). */
export function bucketKey(parts: {
  tenantId: string;
  appId: string;
  api: string;
  region: string;
  sellerAccountId: string;
  operation: string;
}): string {
  return `${parts.tenantId}:rl:${parts.appId}:${parts.api}:${parts.region}:${parts.sellerAccountId}:${parts.operation}`;
}

// ---- Concurrency gate: a counting semaphore with lease expiry (Ads report creation = 1, exports = 5) ----------

export interface GateLease {
  release(): Promise<void>;
}

export interface ConcurrencyGate {
  /** `null` when `limit` leases are already held. A lease that is never released expires after `leaseMs`. */
  tryAcquire(key: string, limit: number, leaseMs: number): Promise<GateLease | null>;
}

export class MemoryConcurrencyGate implements ConcurrencyGate {
  private readonly leases = new Map<string, Map<string, number>>();
  constructor(private readonly clock: Clock = systemClock) {}

  async tryAcquire(key: string, limit: number, leaseMs: number) {
    const now = this.clock.now();
    const held = this.leases.get(key) ?? new Map<string, number>();
    for (const [id, until] of held) if (until <= now) held.delete(id);
    if (held.size >= limit) return null;
    const id = randomUUID();
    held.set(id, now + leaseMs);
    this.leases.set(key, held);
    return { release: async () => void held.delete(id) };
  }
}

const GATE_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[3])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
`;

export class RedisConcurrencyGate implements ConcurrencyGate {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "sh:",
  ) {}

  async tryAcquire(key: string, limit: number, leaseMs: number) {
    const id = randomUUID();
    const k = `${this.prefix}${key}`;
    const ok = await this.redis.eval(GATE_LUA, 1, k, String(limit), String(leaseMs), id);
    if (ok !== 1) return null;
    return { release: async () => void (await this.redis.zrem(k, id)) };
  }
}
