import { createLogger } from "@seller-hub/core";
import { loadConfig, loadEnvFile } from "@seller-hub/config";
import { QueueEvents } from "bullmq";
import { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { assertJobPayload, jobId } from "../src/payload";
import { parseEveryMs, startWorkers } from "../src/runtime";

describe("job payload rules (conventions §8)", () => {
  it("rejects a payload without tenantId, sellerAccountId or traceId", () => {
    expect(() => assertJobPayload({ tenantId: "t", sellerAccountId: "s" })).toThrow(/traceId/);
    expect(() => assertJobPayload(null)).toThrow(/tenantId/);
    expect(assertJobPayload({ tenantId: "t", sellerAccountId: "s", traceId: "x" }).tenantId).toBe(
      "t",
    );
  });
  it("builds deterministic job ids and parses intervals", () => {
    expect(jobId("ads.sp-report-daily", "sa", "2026-11-09")).toBe(
      "ads.sp-report-daily:sa:2026-11-09",
    );
    expect(parseEveryMs("6h")).toBe(21_600_000);
    expect(() => parseEveryMs("soon")).toThrow(/invalid/);
  });
});

async function tryRedis(): Promise<Redis | null> {
  loadEnvFile();
  try {
    const cfg = loadConfig({ ...process.env, NODE_ENV: "test" });
    const redis = new Redis(cfg.redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    redis.on("error", () => undefined);
    await redis.connect();
    return redis;
  } catch (e) {
    if (process.env.SH_REQUIRE_DB === "1") throw e;
    console.warn("[worker test] no Redis reachable; integration test skipped (pnpm stack:up)");
    return null;
  }
}

const redis = await tryRedis();

describe.skipIf(!redis)("queue connection (needs Redis)", () => {
  it("processes a no-op job and closes gracefully", async () => {
    const logger = createLogger({ name: "test", level: "silent" });
    const running = await startWorkers({ connection: redis!, logger, jobs: [] });
    const queue = running.queues.get("platform.noop")!;
    const events = new QueueEvents("platform.noop", { connection: redis!.duplicate() });
    await events.waitUntilReady();
    const job = await queue.add(
      "noop",
      { tenantId: "t", sellerAccountId: "s", traceId: "x" },
      { jobId: `test-${Date.now()}`, removeOnComplete: true },
    );
    await expect(job.waitUntilFinished(events, 10_000)).resolves.toEqual({ ok: true });
    await events.close();
    await running.close();
    redis!.disconnect();
  });
});
