import { requireSellerScope, uuidv7, type Scope } from "@seller-hub/core";
import { withScope, type Database } from "@seller-hub/db";
import { sql } from "kysely";

// EXAMPLE repository (delete with modules/example). The pattern every repository follows:
//  - the FIRST argument is a Scope (type) and requireSellerScope() rejects a missing one at runtime;
//  - every statement runs inside withScope(), so Postgres RLS filters by tenant/seller account;
//  - the query ALSO filters by the scope explicitly (defence in depth, conventions §10).
// The table is created by migrations/20261110120000_example_hello_create-hello.sql.

export interface HelloRow {
  id: string;
  greeting: string;
}

export function helloRepository(db: Database) {
  return {
    async list(scope: Scope): Promise<HelloRow[]> {
      const s = requireSellerScope(scope);
      return withScope(db, s, async (trx) => {
        const { rows } = await sql<HelloRow>`
          select id, greeting from ops.example_hello
           where tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}
           order by id`.execute(trx);
        return rows;
      });
    },

    async count(scope: Scope): Promise<number> {
      return (await this.list(scope)).length;
    },

    async create(scope: Scope, greeting: string): Promise<HelloRow> {
      const s = requireSellerScope(scope);
      const id = uuidv7();
      return withScope(db, s, async (trx) => {
        await sql`
          insert into ops.example_hello (id, tenant_id, seller_account_id, greeting)
          values (${id}, ${s.tenantId}, ${s.sellerAccountId}, ${greeting})`.execute(trx);
        return { id, greeting };
      });
    },
  };
}
