import { loadConfig, loadEnvFile } from "@seller-hub/config";
import { createLogger, isUuid } from "@seller-hub/core";
import { replayInbox } from "@seller-hub/ingestion";
import { Redis } from "ioredis";
import { createIngest } from "./ingest";
import { syncs } from "./registry.generated";

// Operator commands for the ingestion engine. They only create runs and put them on the queues; a running worker
// (pnpm dev / start) executes them.
//
//   pnpm --filter @seller-hub/worker ingest backfill --tenant <uuid> --account <uuid> --sync <key> --from 2026-01-01 --to 2026-03-01 [--scope <marketplace|profile>]
//   pnpm --filter @seller-hub/worker ingest refresh  --tenant <uuid> --account <uuid> --sync <key> [--scope <s>] [--entity <id> ...]
//   pnpm --filter @seller-hub/worker ingest replay-inbox --tenant <uuid> --account <uuid>

function parseArgs(argv: string[]): { cmd: string; flags: Map<string, string[]> } {
  const [cmd = "", ...rest] = argv;
  const flags = new Map<string, string[]>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    if (!a.startsWith("--")) continue;
    const v = rest[i + 1];
    if (v === undefined || v.startsWith("--")) continue;
    flags.set(a.slice(2), [...(flags.get(a.slice(2)) ?? []), v]);
    i++;
  }
  return { cmd, flags };
}

const out = (line: string): void =>
  void process.stdout.write(`${line}
`);

function usage(msg: string): never {
  process.stderr.write(`ingest: ${msg}
`);
  process.exit(2);
}

loadEnvFile();
const { cmd, flags } = parseArgs(process.argv.slice(2));
const one = (name: string): string | undefined => flags.get(name)?.[0];
const need = (name: string): string => one(name) ?? usage(`--${name} is required`);

const tenantId = need("tenant");
const sellerAccountId = need("account");
if (!isUuid(tenantId) || !isUuid(sellerAccountId)) usage("--tenant and --account must be UUIDs");
const scope = { tenantId, sellerAccountId };

const config = loadConfig();
const logger = createLogger({ name: "ingest-cli", level: config.env.SH_LOG_LEVEL });
const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const ingest = await createIngest({
  config,
  logger,
  connection,
  definitions: syncs.map((s) => s.value),
});
try {
  if (cmd === "backfill") {
    // Local dates of the profile/marketplace (conventions §6), inclusive.
    const fromDate = need("from");
    const toDate = need("to");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate))
      usage("--from/--to must be dates (YYYY-MM-DD, marketplace-local)");
    const scopeKey = one("scope");
    const res = await ingest.scheduler.backfill(scope, {
      syncKey: need("sync"),
      fromDate,
      toDate,
      ...(scopeKey ? { scopeKey } : {}),
    });
    out(`backfill: ${res.windows} window(s) queued (newest first, priority backfill)`);
  } else if (cmd === "refresh") {
    const scopeKey = one("scope");
    const entityIds = flags.get("entity");
    const res = await ingest.scheduler.requestRefresh(scope, {
      syncKey: need("sync"),
      ...(scopeKey ? { scopeKey } : {}),
      ...(entityIds ? { entityIds } : {}),
    });
    out(`refresh: run ${res.runId} ${res.created ? "created" : "already open"}`);
  } else if (cmd === "replay-inbox") {
    out(`replay-inbox: ${await replayInbox(scope, ingest.app.db)} message(s) reset to pending`);
  } else {
    usage("commands: backfill | refresh | replay-inbox");
  }
} finally {
  await ingest.close();
  connection.disconnect();
}
