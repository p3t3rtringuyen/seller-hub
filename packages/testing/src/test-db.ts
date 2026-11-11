import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot, loadConfig, loadEnvFile } from "@seller-hub/config";
import { uuidv7 } from "@seller-hub/core";
import {
  createDb,
  enableAppLogin,
  listMigrationFiles,
  runMigrations,
  runSeeds,
  type DbHandle,
} from "@seller-hub/db";
import pg from "pg";

// Real Postgres for repository / service / API tests (ADR-0012). Uses the dev stack's server (compose),
// creates one throw-away database per call from a migrated TEMPLATE database, and drops it afterwards.
// The template is named after a hash of all migration files, so a new migration builds a new template.
//
//   const t = await tryCreateTestDb();            // null when no database is reachable (and not required)
//   describe.skipIf(!t)(...)                       // SH_REQUIRE_DB=1 turns "skip" into a failure

export interface TestDb {
  name: string;
  ownerUrl: string;
  appUrl: string;
  /** sh_owner: bypasses RLS — for arranging data only. */
  owner: DbHandle;
  /** sh_app: NOBYPASSRLS — the connection the code under test must use. */
  app: DbHandle;
  drop(): Promise<void>;
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

function migrationsHash(root: string): string {
  const h = createHash("sha256");
  for (const f of listMigrationFiles(root)) h.update(f.name).update(readFileSync(f.path));
  return h.digest("hex").slice(0, 12);
}

async function ensureTemplate(
  adminUrl: string,
  ownerBase: string,
  appPassword: string,
  root: string,
): Promise<string> {
  const name = `sh_tpl_${migrationsHash(root)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query("select pg_advisory_lock(8_246_001)");
    const exists = await admin.query("select 1 from pg_database where datname = $1", [name]);
    if (exists.rowCount === 0) {
      await admin.query(`create database "${name}"`);
      try {
        const url = withDatabase(ownerBase, name);
        await runMigrations(url);
        await enableAppLogin(url, appPassword);
      } catch (e) {
        await admin.query(`drop database if exists "${name}"`);
        throw e;
      }
    }
    await admin.query("select pg_advisory_unlock(8_246_001)");
  } finally {
    await admin.end();
  }
  return name;
}

export async function createTestDb(): Promise<TestDb> {
  loadEnvFile();
  const root = findRepoRoot();
  const cfg = loadConfig({ ...process.env, NODE_ENV: "test" });
  const adminUrl =
    process.env.SH_TEST_ADMIN_DATABASE_URL ?? withDatabase(cfg.databaseOwnerUrl, "postgres");
  const template = await ensureTemplate(
    adminUrl,
    cfg.databaseOwnerUrl,
    cfg.env.SH_PG_APP_PASSWORD,
    root,
  );
  const name = `sh_t_${uuidv7().replace(/-/g, "").slice(-16)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`create database "${name}" template "${template}"`);
  } finally {
    await admin.end();
  }
  const ownerUrl = withDatabase(cfg.databaseOwnerUrl, name);
  const appUrl = withDatabase(cfg.databaseUrl, name);
  const owner = createDb(ownerUrl, { max: 2 });
  const app = createDb(appUrl, { max: 4 });
  return {
    name,
    ownerUrl,
    appUrl,
    owner,
    app,
    async drop() {
      await app.close();
      await owner.close();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      try {
        await a.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await a.end();
      }
    },
  };
}

/** null when no database is reachable and SH_REQUIRE_DB is not set; throws when it is required. */
export async function tryCreateTestDb(): Promise<TestDb | null> {
  try {
    return await createTestDb();
  } catch (e) {
    if (process.env.SH_REQUIRE_DB === "1") throw e;
    // eslint-disable-next-line no-console
    console.warn(
      `[testing] no test database (${(e as Error).message.split("\n")[0]}); DB tests are skipped. Run pnpm stack:up.`,
    );
    return null;
  }
}

/** Runs the platform fixture seed (two tenants + one seller account each) and every module seed. */
export async function seedFixtures(db: TestDb): Promise<string[]> {
  return runSeeds({ db: db.owner.db, log: () => undefined });
}

export const fixturesDir = (): string => join(findRepoRoot(), "packages", "testing", "fixtures");
