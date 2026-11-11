import { defineSeed, FIXTURE } from "@seller-hub/db";
import { sql } from "kysely";

// EXAMPLE seed (`seed/<k>.seed.ts`): synthetic rows for the fixture tenant. Idempotent.
export default defineSeed({
  name: "example.hello",
  async run({ db }) {
    await sql`
      insert into ops.example_hello (id, tenant_id, seller_account_id, greeting) values
        ('01900000-0000-7000-8000-0000000000a1', ${FIXTURE.tenantId}, ${FIXTURE.sellerAccountId}, 'hello from tenant A'),
        ('01900000-0000-7000-8000-0000000000b1', ${FIXTURE.otherTenantId}, ${FIXTURE.otherSellerAccountId}, 'hello from tenant B')
      on conflict (id) do nothing`.execute(db);
  },
});
