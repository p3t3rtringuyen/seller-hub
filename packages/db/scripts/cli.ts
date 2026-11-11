import { spawnSync } from "node:child_process";
import { loadConfig, loadEnvFile, findRepoRoot } from "@seller-hub/config";
import { createDb } from "../src/client";
import { enableAppLogin, runMigrations } from "../src/migrate";
import { runSeeds } from "../src/seed";
import pg from "pg";

const SCHEMAS = [
  "pii",
  "ops",
  "facts",
  "finance",
  "orders",
  "inventory",
  "catalog",
  "ads",
  "ingest",
  "ref",
  "core",
  "identity",
];

async function migrate(): Promise<void> {
  const cfg = loadConfig();
  const names = await runMigrations(cfg.databaseOwnerUrl, { log: (m) => console.log(m) });
  await enableAppLogin(cfg.databaseOwnerUrl, cfg.env.SH_PG_APP_PASSWORD);
  console.log(`migrate: ${names.length} applied now; sh_app login enabled`);
}

async function reset(): Promise<void> {
  const cfg = loadConfig();
  const host = cfg.env.SH_PG_HOST;
  if (cfg.env.NODE_ENV === "production" || !["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("db:reset only runs against a local database outside production");
  }
  const client = new pg.Client({ connectionString: cfg.databaseOwnerUrl });
  await client.connect();
  try {
    for (const s of SCHEMAS) await client.query(`drop schema if exists ${s} cascade`);
    await client.query("drop table if exists public.schema_migrations");
  } finally {
    await client.end();
  }
  console.log("reset: schemas dropped");
  await migrate();
}

async function seed(): Promise<void> {
  const cfg = loadConfig();
  const handle = createDb(cfg.databaseOwnerUrl, { max: 2 });
  try {
    const ran = await runSeeds({ db: handle.db, log: (m) => console.log(`  ${m}`) });
    console.log(`seed: ${ran.join(", ")}`);
  } finally {
    await handle.close();
  }
}

function codegen(): void {
  const cfg = loadConfig();
  const root = findRepoRoot();
  const res = spawnSync(
    "pnpm",
    [
      "exec",
      "kysely-codegen",
      "--dialect=postgres",
      "--out-file=src/generated/db.d.ts",
      `--include-pattern={${SCHEMAS.join(",")}}.*`,
      "--exclude-pattern=*.*_p[0-9][0-9][0-9][0-9][0-9][0-9]",
    ],
    {
      cwd: `${root}/packages/db`,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, DATABASE_URL: cfg.databaseOwnerUrl },
    },
  );
  if (res.status !== 0) process.exit(res.status ?? 1);
}

loadEnvFile();
const command = process.argv[2];
const commands: Record<string, () => Promise<void> | void> = { migrate, reset, seed, codegen };
const fn = command ? commands[command] : undefined;
if (!fn) {
  console.error(`usage: cli.ts <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}
Promise.resolve(fn()).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
