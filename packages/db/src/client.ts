import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "./generated/db";

export type Database = Kysely<DB>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

/**
 * One pool per process. The API and worker connect as `sh_app` (no BYPASSRLS); migrations, seeds and
 * maintenance connect as `sh_owner` (ADR-0009).
 */
export function createDb(connectionString: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return { db, pool, close: () => db.destroy() };
}
