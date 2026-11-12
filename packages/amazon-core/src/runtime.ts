import type { Redis } from "ioredis";
import type { Logger } from "@seller-hub/core";
import type { Cipher } from "./cipher";
import type { Clock, Random } from "./clock";
import { systemClock } from "./clock";
import { AmazonClient } from "./client";
import type { AdsLimiterDefaults } from "./client";
import type { CredentialSource } from "./credentials";
import { fetchTransportFromEnv } from "./env";
import { LwaTokenService } from "./lwa";
import type { CallObserver } from "./observer";
import { combineObservers, loggerObserver } from "./observer";
import {
  MemoryBucketStore,
  MemoryConcurrencyGate,
  RateLimiter,
  RedisBucketStore,
  RedisConcurrencyGate,
} from "./rate-limit";
import type { BucketStore, ConcurrencyGate } from "./rate-limit";
import type { AmazonMode } from "./regions";
import type { RetryPolicy } from "./retry";
import { MemoryTokenCache, RedisTokenCache } from "./token-cache";
import type { TokenCache } from "./token-cache";
import type { HttpTransport } from "./types";

export interface AmazonRuntimeOptions {
  credentials: CredentialSource;
  /** Default: `SH_AMAZON_MODE` or `production`. `replay` requires `transport`. */
  mode?: AmazonMode;
  /** Required in `replay` mode (see `@seller-hub/amazon-core/testing`); defaults to `fetch` otherwise. */
  transport?: HttpTransport;
  /**
   * Shared state for tokens, rate limits and gates. Without it everything is in-process, which is only right
   * for tests and a single dev process (several workers would each get their own full budget).
   */
  redis?: Redis;
  /** Required with `redis`: access tokens are stored encrypted. */
  cipher?: Cipher;
  logger?: Logger;
  observer?: CallObserver;
  clock?: Clock;
  random?: Random;
  retry?: RetryPolicy;
  ads?: AdsLimiterDefaults;
  userAgent?: string;
  tokenCache?: TokenCache;
  bucketStore?: BucketStore;
  gate?: ConcurrencyGate;
}

export interface AmazonRuntime {
  client: AmazonClient;
  lwa: LwaTokenService;
  limiter: RateLimiter;
  gate: ConcurrencyGate;
  mode: AmazonMode;
  clock: Clock;
}

/** Wires the transport, LWA, limiter and client. Slices get a runtime from the composition root, never build one themselves. */
export function createAmazonRuntime(options: AmazonRuntimeOptions): AmazonRuntime {
  const clock = options.clock ?? systemClock;
  const { mode, transport } = fetchTransportFromEnv(options.mode, options.transport);
  if (options.redis && !options.cipher && !options.tokenCache) {
    throw new Error(
      "a cipher is required to cache access tokens in Redis (ADR-0006: tokens are encrypted)",
    );
  }
  const tokenCache =
    options.tokenCache ??
    (options.redis && options.cipher
      ? new RedisTokenCache(options.redis, options.cipher)
      : new MemoryTokenCache(clock));
  const bucketStore =
    options.bucketStore ??
    (options.redis ? new RedisBucketStore(options.redis) : new MemoryBucketStore(clock));
  const gate =
    options.gate ??
    (options.redis ? new RedisConcurrencyGate(options.redis) : new MemoryConcurrencyGate(clock));
  const limiter = new RateLimiter({ store: bucketStore, clock });
  const lwa = new LwaTokenService({
    transport,
    credentials: options.credentials,
    cache: tokenCache,
    clock,
    ...(options.random ? { random: options.random } : {}),
  });
  const observers = [
    options.observer,
    options.logger ? loggerObserver(options.logger) : undefined,
  ].filter((o): o is CallObserver => o !== undefined);
  const client = new AmazonClient({
    mode,
    transport,
    lwa,
    limiter,
    clock,
    ...(options.random ? { random: options.random } : {}),
    ...(options.retry ? { retry: options.retry } : {}),
    ...(options.ads ? { ads: options.ads } : {}),
    ...(options.userAgent ? { userAgent: options.userAgent } : {}),
    ...(observers.length ? { observer: combineObservers(...observers) } : {}),
  });
  return { client, lwa, limiter, gate, mode, clock };
}
