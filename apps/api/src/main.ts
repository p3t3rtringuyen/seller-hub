import { loadConfig, loadEnvFile } from "@seller-hub/config";
import { createLogger } from "@seller-hub/core";
import { createDb } from "@seller-hub/db";
import { Redis } from "ioredis";
import { sql } from "kysely";
import {
  authenticate,
  revokeSessionsOf,
} from "../../../modules/platform-auth/src/public/platform-auth";
import { createAuditWriter } from "../../../modules/platform-audit/src/public/platform-audit";
import {
  composeAmazon,
  provideConnectionsServices,
} from "../../../modules/platform-connections/src/public/platform-connections";
import { provideTenancyServices } from "../../../modules/platform-tenancy/src/public/platform-tenancy";
import { buildApp } from "./app";

loadEnvFile();
const config = loadConfig();
const logger = createLogger({ name: "api", level: config.env.SH_LOG_LEVEL });

const handle = createDb(config.databaseUrl);
const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });

// Identity and tenancy (P3-IDENTITY). Fails closed: composeAmazon() throws when no vault key (SH_MASTER_KEY) is set, so
// the process never starts without the means to protect Amazon credentials. SH_AMAZON_MODE unset = replay (mock, D30).
const audit = createAuditWriter(handle.db);
const amazon = composeAmazon({ env: process.env, db: handle.db, audit, logger, redis });

const { app, permissionMatrix } = await buildApp({
  logger,
  authenticator: authenticate,
  readiness: {
    database: async () => void (await sql`select 1`.execute(handle.db)),
    redis: async () => {
      if (redis.status === "wait") await redis.connect();
      await redis.ping();
    },
  },
});

provideTenancyServices({
  db: handle.db,
  audit,
  permissionMatrix,
  webPublicUrl: config.webUrl,
  onPrivilegeChange: revokeSessionsOf,
});
provideConnectionsServices({ keys: amazon.keys, amazon: amazon.port });
logger.info({ amazonMode: amazon.mode }, "amazon mode");

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
