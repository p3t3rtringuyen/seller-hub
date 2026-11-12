import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RateLimiter,
  RedisBucketStore,
  RedisConcurrencyGate,
  RedisTokenCache,
  createAesGcmCipher,
  type CachedToken,
} from "../src";
import { tryConnectTestRedis } from "../src/testing";

// Needs the dev stack's Redis (pnpm stack:up). Skipped when none answers; SH_REQUIRE_DB=1 (test:integration) makes
// a missing Redis a failure instead.
const handle = await tryConnectTestRedis();

describe.skipIf(!handle)("Redis-backed stores (shared across processes)", () => {
  const h = handle as NonNullable<typeof handle>;
  afterAll(async () => {
    await h?.close();
  });
  beforeAll(() => undefined);

  it("two limiters on one Redis share a single token budget", async () => {
    const spec = { rate: 0.1, burst: 2 };
    const a = new RateLimiter({ store: new RedisBucketStore(h.redis, h.prefix) });
    const b = new RateLimiter({ store: new RedisBucketStore(h.redis, h.prefix) });
    await a.acquire("t1:rl:x", spec, { kind: "failFast" });
    await b.acquire("t1:rl:x", spec, { kind: "failFast" });
    // burst of 2 is now spent across both "machines"
    await expect(a.acquire("t1:rl:x", spec, { kind: "failFast" })).rejects.toThrow(/rate limit/);
    await expect(b.acquire("t1:rl:x", spec, { kind: "failFast" })).rejects.toThrow(/rate limit/);
  });

  it("a rate override from x-amzn-RateLimit-Limit is shared and applies at once", async () => {
    const store = new RedisBucketStore(h.redis, h.prefix);
    const limiter = new RateLimiter({ store });
    const spec = { rate: 0.001, burst: 1 };
    await limiter.acquire("t1:rl:y", spec, { kind: "failFast" });
    await limiter.observeAmazonLimit("t1:rl:y", "1000");
    await new Promise((r) => setTimeout(r, 30));
    await limiter.acquire("t1:rl:y", spec, { kind: "failFast" });
  });

  it("buckets are isolated per key", async () => {
    const limiter = new RateLimiter({ store: new RedisBucketStore(h.redis, h.prefix) });
    const spec = { rate: 0.01, burst: 1 };
    await limiter.acquire("t1:rl:a", spec, { kind: "failFast" });
    await limiter.acquire("t2:rl:a", spec, { kind: "failFast" });
  });

  it("the gate enforces a global concurrency of 1", async () => {
    const gate = new RedisConcurrencyGate(h.redis, h.prefix);
    const one = await gate.tryAcquire("ads:reports", 1, 30_000);
    expect(one).not.toBeNull();
    expect(await gate.tryAcquire("ads:reports", 1, 30_000)).toBeNull();
    await one?.release();
    expect(await gate.tryAcquire("ads:reports", 1, 30_000)).not.toBeNull();
  });

  it("the token cache stores access tokens encrypted and locks across processes", async () => {
    const cipher = createAesGcmCipher(new Uint8Array(32).fill(7));
    const cache = new RedisTokenCache(h.redis, cipher, h.prefix);
    const token: CachedToken = {
      accessToken: "Atza|secret-access-token",
      expiresAtMs: Date.now() + 3_600_000,
    };
    await cache.set("t1:lwa:sp", token, 60_000);
    expect(await cache.get("t1:lwa:sp")).toEqual(token);
    const raw = await h.redis.get(`${h.prefix}t1:lwa:sp`);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("Atza");
    expect(raw).not.toContain("secret-access-token");

    const lock = await cache.tryLock("t1:lwa:sp", 5_000);
    expect(lock).not.toBeNull();
    expect(await cache.tryLock("t1:lwa:sp", 5_000)).toBeNull();
    await lock?.release();
    expect(await cache.tryLock("t1:lwa:sp", 5_000)).not.toBeNull();
  });

  it("a different key reads the entry as a miss, not as garbage", async () => {
    const a = new RedisTokenCache(
      h.redis,
      createAesGcmCipher(new Uint8Array(32).fill(1)),
      h.prefix,
    );
    const b = new RedisTokenCache(
      h.redis,
      createAesGcmCipher(new Uint8Array(32).fill(2)),
      h.prefix,
    );
    await a.set("k", { accessToken: "x", expiresAtMs: Date.now() + 10_000 }, 10_000);
    expect(await b.get("k")).toBeNull();
  });
});
