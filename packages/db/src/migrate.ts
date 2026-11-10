import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { findRepoRoot } from "@seller-hub/config";
import pg from "pg";

// Migration runner (ADR-0009 decision 8): plain SQL, forward-only, one lock, ordered by timestamp.
//
// Deviation from ADR-0009 (which names node-pg-migrate): BACKLOG §1.2 fixes the file name as
// `<UTC yyyymmddhhmmss>_<module>_<key>_<desc>.sql` in several directories; node-pg-migrate does not
// recognise 14-digit timestamps and orders a multi-directory set by its own rules. This runner keeps the
// same behaviour the ADR asks for (lock, history table, forward-only) with the ordering the registry
// validated. Files may start with the `-- Up Migration` marker (kept for compatibility); a
// `-- Down Migration` section is refused.
//
// `pnpm gen` writes `db/migrations/index.generated.json` (ordered, validated); when it is absent the
// runner scans `packages/db/migrations` and `modules/*/migrations`.

export interface MigrationFile {
  name: string; // file name without .sql
  timestamp: string;
  path: string; // absolute
}

const NAME_RE = /^(\d{14})_(.+)\.sql$/;

export function listMigrationFiles(root: string = findRepoRoot()): MigrationFile[] {
  const indexFile = join(root, "db", "migrations", "index.generated.json");
  let paths: string[];
  if (existsSync(indexFile)) {
    const parsed = JSON.parse(readFileSync(indexFile, "utf8")) as {
      migrations: { file: string }[];
    };
    paths = parsed.migrations.map((m) => join(root, m.file));
  } else {
    const dirs = [join(root, "packages", "db", "migrations")];
    const modulesDir = join(root, "modules");
    if (existsSync(modulesDir)) {
      for (const m of readdirSync(modulesDir)) dirs.push(join(modulesDir, m, "migrations"));
    }
    paths = dirs.filter(existsSync).flatMap((d) =>
      readdirSync(d)
        .filter((f) => f.endsWith(".sql"))
        .map((f) => join(d, f)),
    );
  }
  const files = paths.map((path) => {
    const m = NAME_RE.exec(basename(path));
    if (!m) throw new Error(`${path}: migration file names start with a 14-digit UTC timestamp`);
    return { name: basename(path, ".sql"), timestamp: m[1]!, path };
  });
  return files.sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp) || a.name.localeCompare(b.name),
  );
}

const LOCK_KEY = 8_246_002;

export async function runMigrations(
  ownerUrl: string,
  options: { files?: MigrationFile[]; log?: (msg: string) => void } = {},
): Promise<string[]> {
  const files = options.files ?? listMigrationFiles();
  const log = options.log ?? (() => undefined);
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(
      "create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set(
      (await client.query<{ name: string }>("select name from public.schema_migrations")).rows.map(
        (r) => r.name,
      ),
    );

    const known = new Set(files.map((f) => f.name));
    const missing = [...done].filter((n) => !known.has(n));
    if (missing.length)
      throw new Error(
        `applied migrations without a file (never delete merged migrations): ${missing.join(", ")}`,
      );

    const latestApplied = files
      .filter((f) => done.has(f.name))
      .reduce((max, f) => (f.timestamp > max ? f.timestamp : max), "");
    for (const file of files) {
      if (done.has(file.name)) continue;
      if (file.timestamp < latestApplied) {
        throw new Error(
          `${file.name} is older than an applied migration (${latestApplied}); migrations are forward-only — give it a newer timestamp`,
        );
      }
      const text = readFileSync(file.path, "utf8");
      if (/^--\s*Down Migration/im.test(text))
        throw new Error(`${file.name}: down migrations are not supported (forward-only)`);
      const sql = text.replace(/^--\s*Up Migration\s*$/im, "");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into public.schema_migrations (name) values ($1)", [file.name]);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw new Error(`${file.name}: ${(e as Error).message}`);
      }
      applied.push(file.name);
      log(`applied ${file.name}`);
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
  return applied;
}

/**
 * `sh_app` is created NOLOGIN by the foundation migration (deployment gives it a login, P6). The dev stack
 * does that here, from the password in the environment.
 */
export async function enableAppLogin(ownerUrl: string, appPassword: string): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ literal: string }>(
      "select quote_literal($1) as literal",
      [appPassword],
    );
    await client.query(`alter role sh_app login password ${rows[0]!.literal}`);
  } finally {
    await client.end();
  }
}
