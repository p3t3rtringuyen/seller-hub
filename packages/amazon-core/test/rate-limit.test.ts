import { describe, expect, it } from "vitest";
import {
  LocalRateLimitError,
  MemoryBucketStore,
  MemoryConcurrencyGate,
  RateLimiter,
  bucketKey,
} from "../src";
import { ManualClock } from "../src/testing";

const key = (
  sellerAccountId: string,
  operation = "orders@2026-01-01.searchOrders",
  tenantId = "t1",
) => bucketKey({ tenantId, appId: "app0", api: "sp", region: "na", sellerAccountId, operation });

function setup() {
  const clock = new ManualClock();
  const store = new MemoryBucketStore(clock);
  return { clock, store, limiter: new RateLimiter({ store, clock }) };
}

describe("token bucket limiter", () => {
  it("allows the burst at once, then spaces calls at the documented rate", async () => {
    const { limiter, clock } = setup();
    const spec = { rate: 0.5, burst: 3 }; // sales.getOrderMetrics: 0.5 rps
    for (let i = 0; i < 3; i++)
      expect(await limiter.acquire(key("a"), spec, { kind: "wait" })).toBe(0);
    const waited = await limiter.acquire(key("a"), spec, { kind: "wait" });
    expect(waited).toBe(2000); // one token every 2 s
    expect(clock.sleeps).toEqual([2000]);
  });

  it("failFast refuses instead of sleeping and says how long to wait", async () => {
    const { limiter, clock } = setup();
    const spec = { rate: 1, burst: 1 };
    await limiter.acquire(key("a"), spec, { kind: "failFast" });
    const err = await limiter
      .acquire(key("a"), spec, { kind: "failFast" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LocalRateLimitError);
    expect((err as LocalRateLimitError).retryAfterMs).toBe(1000);
    expect(clock.sleeps).toEqual([]);
  });

  it("refuses a wait longer than the cap so a worker can delay the job instead", async () => {
    const { limiter } = setup();
    const spec = { rate: 0.0056, burst: 1 }; // searchOrders: one call every ~3 min
    await limiter.acquire(key("a"), spec, { kind: "wait", maxWaitMs: 60_000 });
    await expect(
      limiter.acquire(key("a"), spec, { kind: "wait", maxWaitMs: 60_000 }),
    ).rejects.toBeInstanceOf(LocalRateLimitError);
  });

  it("gives every (tenant, seller account, operation) its own bucket", async () => {
    const { limiter } = setup();
    const spec = { rate: 0.1, burst: 1 };
    await limiter.acquire(key("a"), spec, { kind: "failFast" });
    // same operation, another seller account / another tenant / another operation: untouched budget
    await limiter.acquire(key("b"), spec, { kind: "failFast" });
    await limiter.acquire(key("a", "orders@2026-01-01.searchOrders", "t2"), spec, {
      kind: "failFast",
    });
    await limiter.acquire(key("a", "sales.getOrderMetrics"), spec, { kind: "failFast" });
    await expect(limiter.acquire(key("a"), spec, { kind: "failFast" })).rejects.toBeInstanceOf(
      LocalRateLimitError,
    );
  });

  it("adopts the rate Amazon reports in x-amzn-RateLimit-Limit", async () => {
    const { limiter, clock } = setup();
    const spec = { rate: 0.1, burst: 1 };
    await limiter.acquire(key("a"), spec, { kind: "failFast" });
    await limiter.observeAmazonLimit(key("a"), "2"); // Amazon says 2 rps
    clock.advance(500);
    expect(await limiter.acquire(key("a"), spec, { kind: "failFast" })).toBe(0);
  });

  it("ignores a garbage rate header", async () => {
    const { limiter, store } = setup();
    await limiter.observeAmazonLimit(key("a"), "abc");
    await limiter.observeAmazonLimit(key("a"), "-1");
    await limiter.observeAmazonLimit(key("a"), undefined);
    expect(await store.getRate(key("a"))).toBeNull();
  });

  it("AIMD: halves on throttle (floor), creeps up on success (ceiling)", async () => {
    const { limiter } = setup();
    const spec = { rate: 2, burst: 4 };
    expect(await limiter.onThrottled(key("ads"), spec, 0.5)).toBe(1);
    expect(await limiter.onThrottled(key("ads"), spec, 0.5)).toBe(0.5);
    expect(await limiter.onThrottled(key("ads"), spec, 0.5)).toBe(0.5);
    expect(await limiter.onSuccess(key("ads"), spec, 0.25, 1)).toBe(0.75);
    expect(await limiter.onSuccess(key("ads"), spec, 0.25, 1)).toBe(1);
    expect(await limiter.onSuccess(key("ads"), spec, 0.25, 1)).toBe(1);
  });
});

describe("concurrency gate", () => {
  it("caps concurrent leases and frees a slot on release", async () => {
    const gate = new MemoryConcurrencyGate(new ManualClock());
    const a = await gate.tryAcquire("ads:v1-reports", 1, 60_000);
    expect(a).not.toBeNull();
    expect(await gate.tryAcquire("ads:v1-reports", 1, 60_000)).toBeNull();
    await a?.release();
    expect(await gate.tryAcquire("ads:v1-reports", 1, 60_000)).not.toBeNull();
  });

  it("expires a lease that was never released", async () => {
    const clock = new ManualClock();
    const gate = new MemoryConcurrencyGate(clock);
    await gate.tryAcquire("k", 1, 1000);
    clock.advance(1001);
    expect(await gate.tryAcquire("k", 1, 1000)).not.toBeNull();
  });
});
