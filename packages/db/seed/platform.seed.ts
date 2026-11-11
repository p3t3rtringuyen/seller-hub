import { sql } from "kysely";
import { defineSeed, FIXTURE } from "../src/seed";

// Platform fixtures: two tenants (so cross-tenant tests have a second one) and a seller account each.
// Idempotent; synthetic; no Amazon ids, no credentials. `ref.*` is seeded by the migrations themselves.
export default defineSeed({
  name: "platform.fixtures",
  async run({ db, log }) {
    await sql`
      insert into core.tenants (id, name) values
        (${FIXTURE.tenantId}, ${FIXTURE.tenantName}),
        (${FIXTURE.otherTenantId}, 'Other Fixture Tenant')
      on conflict (id) do nothing`.execute(db);
    await sql`
      insert into core.seller_accounts (id, tenant_id, name, region_code) values
        (${FIXTURE.sellerAccountId}, ${FIXTURE.tenantId}, ${FIXTURE.sellerAccountName}, 'NA'),
        (${FIXTURE.otherSellerAccountId}, ${FIXTURE.otherTenantId}, 'Other Fixture Seller (US)', 'NA')
      on conflict (id) do nothing`.execute(db);
    log("fixture tenants and seller accounts ready");
  },
});
