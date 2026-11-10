import { requireScope, type Scope } from "@seller-hub/core";
import { sql, type Transaction } from "kysely";
import type { Database } from "./client";
import type { DB } from "./generated/db";

export type ScopedTx = Transaction<DB>;

/**
 * Runs `fn` in a transaction with `app.tenant_id` (+ `app.seller_account_id`, `app.user_id`) set LOCAL, so
 * Postgres RLS (`core.apply_tenant_rls`) filters every statement (ADR-0009 decision 7). Compatible with
 * PgBouncer transaction mode. A missing scope throws before any SQL runs.
 */
export async function withScope<T>(
  db: Database,
  scope: Scope,
  fn: (trx: ScopedTx) => Promise<T>,
): Promise<T> {
  const s = requireScope(scope);
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${s.tenantId}, true),
                     set_config('app.seller_account_id', ${s.sellerAccountId ?? ""}, true),
                     set_config('app.user_id', ${s.userId ?? ""}, true)`.execute(trx);
    return fn(trx);
  });
}
