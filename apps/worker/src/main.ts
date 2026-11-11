import { loadConfig, loadEnvFile } from "@seller-hub/config";
import { createLogger } from "@seller-hub/core";
import { Redis } from "ioredis";
import { commands, jobs, syncs } from "./registry.generated";
import { startWorkers } from "./runtime";

loadEnvFile();
const config = loadConfig();
const logger = createLogger({ name: "worker", level: config.env.SH_LOG_LEVEL });

// BullMQ requires maxRetriesPerRequest: null on its connections.
const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const running = await startWorkers({ connection, logger, jobs: jobs.map((j) => j.value) });
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
    connection.disconnect();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
