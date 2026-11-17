import { loadConfig, loadEnvFile } from "@seller-hub/config";
import { parseAmazonMode } from "@seller-hub/amazon-core";
import { createLogger } from "@seller-hub/core";
import { createDb } from "@seller-hub/db";
import { Redis } from "ioredis";
import { createWorkerCredentials } from "./credentials";
import { commands, jobs, syncs } from "./registry.generated";
import { startIngest } from "./ingest";
import { startWorkers } from "./runtime";

loadEnvFile();
const config = loadConfig();
const logger = createLogger({ name: "worker", level: config.env.SH_LOG_LEVEL });

// BullMQ requires maxRetriesPerRequest: null on its connections.
const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const running = await startWorkers({ connection, logger, jobs: jobs.map((j) => j.value) });
// Credentials come from the vault (P3-IDENTITY); fails closed when no master key is configured.
const vaultDb = createDb(config.databaseUrl, { max: 3 });
const credentials = createWorkerCredentials({
  env: process.env,
  db: vaultDb.db,
  mode: parseAmazonMode(process.env.SH_AMAZON_MODE),
});
const ingest = await startIngest({
  config,
  logger,
  connection,
  credentials,
  definitions: syncs.map((s) => s.value),
});
logger.info(
  {
    queues: [...running.queues.keys()],
    syncDefinitions: syncs.length,
    commandHandlers: commands.length,
  },
  "worker started",
);

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  logger.info({ signal }, "shutting down: finishing active jobs");
  try {
    await running.close();
    await ingest.close();
    await vaultDb.close();
    connection.disconnect();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
