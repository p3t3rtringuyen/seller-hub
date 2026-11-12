import { Redis } from "ioredis";

/**
 * A Redis connection to the dev stack for tests (SH_REDIS_URL, else 127.0.0.1 on the stack's port derived from
 * SH_PORT_OFFSET). Returns null when none answers and SH_REQUIRE_DB is not 1, so DB-less machines skip; with
 * SH_REQUIRE_DB=1 it throws instead (pnpm test:integration). Always uses a throw-away key prefix.
 */
export async function tryConnectTestRedis(
  env: Record<string, string | undefined> = process.env,
): Promise<{ redis: Redis; prefix: string; close(): Promise<void> } | null> {
  const offset = Number(env.SH_PORT_OFFSET ?? "0");
  const url =
    env.SH_REDIS_URL || `redis://127.0.0.1:${56379 + (Number.isFinite(offset) ? offset : 0)}`;
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    connectTimeout: 1500,
  });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    await redis.ping();
  } catch (error) {
    redis.disconnect();
    if (env.SH_REQUIRE_DB === "1")
      throw new Error(`Redis required (SH_REQUIRE_DB=1) but not reachable at ${url}`, {
        cause: error,
      });
    return null;
  }
  const prefix = `test:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}:`;
  return {
    redis,
    prefix,
    async close() {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length) await redis.del(...keys);
      await redis.quit();
    },
  };
}
