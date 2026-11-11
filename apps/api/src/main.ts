import { loadConfig, loadEnvFile } from "@seller-hub/config";
import { createLogger } from "@seller-hub/core";
import { createDb } from "@seller-hub/db";
import { Redis } from "ioredis";
import { sql } from "kysely";
import { buildApp } from "./app";

loadEnvFile();
const config = loadConfig();
const logger = createLogger({ name: "api", level: config.env.SH_LOG_LEVEL });

const handle = createDb(config.databaseUrl);
const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });

const { app } = await buildApp({
  logger,
  readiness: {
    database: async () => void (await sql`select 1`.execute(handle.db)),
    redis: async () => {
      if (redis.status === "wait") await redis.connect();
      await redis.ping();
    },
  },
});

await app.listen({ host: config.env.SH_API_HOST, port: config.ports.api });
logger.info({ port: config.ports.api }, "api listening");

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info({ signal }, "shutting down");
  try {
    await app.close();
    await handle.close();
    redis.disconnect();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
