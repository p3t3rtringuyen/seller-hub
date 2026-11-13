import { requireScope, uuidv7, type Role, type Scope } from "@seller-hub/core";
import { withScope, type Database, type ScopedTx } from "@seller-hub/db";
import { sql } from "kysely";
import type { Grant } from "../../access";
import type {
  InvitationRow,
  InvitableRole,
  MemberRow,
  SellerAccountRow,
  TenantRow,
  UserMembership,
} from "../../types";

// Repository for tenants, memberships, grants, invitations, seller accounts and per-user preferences.
// Every function takes a Scope first (conventions §10) and filters by it explicitly; Postgres RLS enforces it again.
// Runs inside `withScope`, or inside the caller's transaction when `trx` is passed (so audit rows commit with it).

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

function run<T>(
  db: Database,
  scope: Scope,
  trx: ScopedTx | undefined,
  fn: (trx: ScopedTx) => Promise<T>,
): Promise<T> {
  return trx ? fn(trx) : withScope(db, scope, fn);
}

interface InvitationDbRow {
  id: string;
  email: string;
  role: InvitableRole;
  seller_account_id: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  invited_by: string | null;
}
const toInvitation = (r: InvitationDbRow): InvitationRow => ({
  id: r.id,
  email: r.email,
  role: r.role,
  sellerAccountId: r.seller_account_id,
  expiresAt: iso(r.expires_at),
  acceptedAt: r.accepted_at ? iso(r.accepted_at) : null,
  revokedAt: r.revoked_at ? iso(r.revoked_at) : null,
  createdAt: iso(r.created_at),
  invitedBy: r.invited_by,
});

interface SellerAccountDbRow {
  id: string;
  name: string;
  region_code: "NA" | "EU" | "FE";
  account_type: "seller" | "vendor";
  selling_partner_id: string | null;
  status: "active" | "disconnected" | "deleting";
}
const toSellerAccount = (r: SellerAccountDbRow): SellerAccountRow => ({
  id: r.id,
  name: r.name,
  regionCode: r.region_code,
  accountType: r.account_type,
  sellingPartnerId: r.selling_partner_id,
  status: r.status,
});

interface GrantDbRow {
  role: Role;
  seller_account_id: string | null;
  marketplace_id: string | null;
}
const toGrant = (r: GrantDbRow): Grant => ({
  role: r.role,
  sellerAccountId: r.seller_account_id,
  marketplaceId: r.marketplace_id,
});

export function tenancyRepository(db: Database) {
  return {
    async getTenant(scope: Scope, trx?: ScopedTx): Promise<TenantRow | null> {
      const s = requireScope(scope);
      return run(db, s, trx, async (t) => {
        const { rows } = await sql<{
          id: string;
          name: string;
          status: "active" | "suspended";
          require_two_factor: boolean;
        }>`select id, name, status, require_two_factor from core.tenants where id = ${s.tenantId}`.execute(
          t,
        );
        const r = rows[0];
        return r
          ? { id: r.id, name: r.name, status: r.status, requireTwoFactor: r.require_two_factor }
          : null;
      });
    },

    /** Profile of the signed-in user (`identity.users` is global; the caller passes its own id from the session). */
    async getUserProfile(
      scope: Scope,
    ): Promise<{ id: string; email: string; displayName: string | null; locale: string } | null> {
      const s = requireScope(scope);
      if (!s.userId) throw new Error("userId is required in the scope");
      return withScope(db, s, async (t) => {
        const { rows } = await sql<{
          id: string;
          email: string;
          display_name: string | null;
          locale: string;
        }>`select id, email, display_name, locale from identity.users
            where id = ${s.userId} and disabled_at is null`.execute(t);
        const r = rows[0];
        return r
          ? { id: r.id, email: r.email, displayName: r.display_name, locale: r.locale }
          : null;
      });
    },

    /** The user's own memberships across tenants (`scope.userId` required; use `userScope(userId)`). */
    async listUserMemberships(scope: Scope): Promise<UserMembership[]> {
      const s = requireScope(scope);
      if (!s.userId) throw new Error("userId is required in the scope");
      return withScope(db, s, async (t) => {
        const { rows } = await sql<{
          id: string;
          tenant_id: string;
          name: string;
          status: "active" | "suspended";
          tenant_status: "active" | "suspended";
        }>`select m.id, m.tenant_id, t.name, m.status, t.status as tenant_status
             from core.memberships m join core.tenants t on t.id = m.tenant_id
            where m.user_id = ${s.userId} order by m.created_at, m.id`.execute(t);
        return rows.map((r) => ({
          membershipId: r.id,
          tenantId: r.tenant_id,
          tenantName: r.name,
          status: r.status,
          tenantStatus: r.tenant_status,
        }));
      });
    },

    async findMembershipByUser(
      scope: Scope,
      userId: string,
      trx?: ScopedTx,
    ): Promise<{ id: string; status: "active" | "suspended" } | null> {
      const s = requireScope(scope);
      return run(db, s, trx, async (t) => {
        const { rows } = await sql<{ id: string; status: "active" | "suspended" }>`
          select id, status from core.memberships
           where tenant_id = ${s.tenantId} and user_id = ${userId}`.execute(t);
        return rows[0] ?? null;
      });
    },

    async listMembers(scope: Scope, trx?: ScopedTx): Promise<MemberRow[]> {
      const s = requireScope(scope);
      return run(db, s, trx, async (t) => {
        const { rows } = await sql<{
          id: string;
          user_id: string;
          email: string;
          display_name: string | null;
          status: "active" | "suspended";
          created_at: Date;
        }>`select m.id, m.user_id, u.email, u.display_name, m.status, m.created_at
             from core.memberships m join identity.users u on u.id = m.user_id
            where m.tenant_id = ${s.tenantId} order by m.created_at, m.id`.execute(t);
        return rows.map((r) => ({
          membershipId: r.id,
          userId: r.user_id,
          email: r.email,
          displayName: r.display_name,
          status: r.status,
          createdAt: iso(r.created_at),
        }));
      });
    },

    async createMembership(scope: Scope, userId: string, trx?: ScopedTx): Promise<string> {
      const s = requireScope(scope);
      const id = uuidv7();
      await run(db, s, trx, async (t) => {
        await sql`insert into core.memberships (id, tenant_id, user_id)
                  values (${id}, ${s.tenantId}, ${userId})`.execute(t);
      });
      return id;
    },

    async deleteMembership(scope: Scope, membershipId: string, trx?: ScopedTx): Promise<void> {
      const s = requireScope(scope);
      await run(db, s, trx, async (t) => {
        await sql`delete from core.memberships
                   where tenant_id = ${s.tenantId} and id = ${membershipId}`.execute(t);
      });
    },

    async createTenant(scope: Scope, name: string, trx: ScopedTx): Promise<void> {
      const s = requireScope(scope);
      await sql`insert into core.tenants (id, name) values (${s.tenantId}, ${name})`.execute(trx);
    },

    // --- grants --------------------------------------------------------------------------------------------
    async listGrants(scope: Scope, membershipId: string, trx?: ScopedTx): Promise<Grant[]> {
      const s = requireScope(scope);
      return run(db, s, trx, async (t) => {
        const { rows } = await sql<GrantDbRow>`
          select role, seller_account_id, marketplace_id from core.role_grants
           where tenant_id = ${s.tenantId} and membership_id = ${membershipId}
           order by created_at, id`.execute(t);
        return rows.map(toGrant);
      });
    },

    /** Grants of a user in the tenant of the scope (empty when the user is not an active member). */
    async listGrantsForUser(scope: Scope, userId: string, trx?: ScopedTx): Promise<Grant[]> {
      const s = requireScope(scope);
      return run(db, s, trx, async (t) => {
        const { rows } = await sql<GrantDbRow>`
          select g.role, g.seller_account_id, g.marketplace_id
            from core.role_grants g join core.memberships m
              on m.tenant_id = g.tenant_id and m.id = g.membership_id
           where g.tenant_id = ${s.tenantId} and m.user_id = ${userId} and m.status = 'active'`.execute(
          t,
        );
        return rows.map(toGrant);
      });
    },

    /** Replaces all grants of a membership. */
    async replaceGrants(
      scope: Scope,
      membershipId: string,
      grants: readonly { role: Role; sellerAccountId: string | null }[],
      grantedBy: string | null,
      trx?: ScopedTx,
    ): Promise<void> {
      const s = requireScope(scope);
      await run(db, s, trx, async (t) => {
        await sql`delete from core.role_grants
                   where tenant_id = ${s.tenantId} and membership_id = ${membershipId}`.execute(t);
        for (const g of grants) {
          await sql`insert into core.role_grants (id, tenant_id, membership_id, role, seller_account_id, granted_by)
                    values (${uuidv7()}, ${s.tenantId}, ${membershipId}, ${g.role}, ${g.sellerAccountId}, ${grantedBy})`.execute(
            t,
          );
        }
      });
    },

    /** Active memberships that hold a tenant-wide owner grant. */
    async countOwners(scope: Scope, trx?: ScopedTx): Promise<number> {
      const s = requireScope(scope);
      return run(db, s, trx, async (t) => {
        const { rows } = await sql<{ n: string }>`
          select count(distinct g.membership_id)::text as n
            from core.role_grants g join core.memberships m
              on m.tenant_id = g.tenant_id and m.id = g.membership_id
           where g.tenant_id = ${s.tenantId} and g.role = 'owner' and g.seller_account_id is null
             and m.status = 'active'`.execute(t);
        return Number(rows[0]?.n ?? 0);
      });
    },

    // --- invitations ---------------------------------------------------------------------------------------
    async listInvitations(scope: Scope): Promise<InvitationRow[]> {
      const s = requireScope(scope);
      return withScope(db, s, async (t) => {
        const { rows } = await sql<InvitationDbRow>`
          select id, email, role, seller_account_id, expires_at, accepted_at, revoked_at, created_at, invited_by
            from core.invitations where tenant_id = ${s.tenantId}
           order by created_at desc, id limit 200`.execute(t);
        return rows.map(toInvitation);
      });
    },

    async getInvitation(scope: Scope, id: string, trx?: ScopedTx): Promise<InvitationRow | null> {
      const s = requireScope(scope);
      return run(db, s, trx, async (t) => {
        const { rows } = await sql<InvitationDbRow>`
          select id, email, role, seller_account_id, expires_at, accepted_at, revoked_at, created_at, invited_by
            from core.invitations where tenant_id = ${s.tenantId} and id = ${id}`.execute(t);
        return rows[0] ? toInvitation(rows[0]) : null;
      });
    },

    async createInvitation(
      scope: Scope,
      input: {
        email: string;
        role: InvitableRole;
        sellerAccountId: string | null;
        tokenHash: Buffer;
        expiresAt: Date;
        invitedBy: string | null;
      },
      trx?: ScopedTx,
    ): Promise<string> {
      const s = requireScope(scope);
      const id = uuidv7();
      await run(db, s, trx, async (t) => {
        await sql`insert into core.invitations
                    (id, tenant_id, email, role, seller_account_id, token_hash, invited_by, expires_at)
                  values (${id}, ${s.tenantId}, ${input.email}, ${input.role}, ${input.sellerAccountId},
                          ${input.tokenHash}, ${input.invitedBy}, ${input.expiresAt.toISOString()})`.execute(
          t,
        );
      });
      return id;
    },

    /** Closes an open invitation of the same e-mail so a re-invite replaces it (partial unique index). */
    async revokeOpenInvitationsFor(scope: Scope, email: string, trx?: ScopedTx): Promise<void> {
      const s = requireScope(scope);
      await run(db, s, trx, async (t) => {
        await sql`update core.invitations set revoked_at = now()
                   where tenant_id = ${s.tenantId} and email_normalized = lower(${email})
                     and accepted_at is null and revoked_at is null`.execute(t);
      });
    },

    async revokeInvitation(scope: Scope, id: string, trx?: ScopedTx): Promise<boolean> {
      const s = requireScope(scope);
      return run(db, s, trx, async (t) => {
        const r = await sql`update core.invitations set revoked_at = now()
                             where tenant_id = ${s.tenantId} and id = ${id}
                               and accepted_at is null and revoked_at is null`.execute(t);
        return Number(r.numAffectedRows ?? 0) > 0;
      });
    },

    async markInvitationAccepted(
      scope: Scope,
      id: string,
      userId: string,
      trx: ScopedTx,
    ): Promise<void> {
      const s = requireScope(scope);
      await sql`update core.invitations set accepted_at = now(), accepted_user_id = ${userId}
                 where tenant_id = ${s.tenantId} and id = ${id}`.execute(trx);
    },

    // --- seller accounts ------------------------------------------------------------------------------------
    async listSellerAccounts(scope: Scope): Promise<SellerAccountRow[]> {
      const s = requireScope(scope);
      return withScope(db, s, async (t) => {
        const { rows } = await sql<SellerAccountDbRow>`
          select id, name, region_code, account_type, selling_partner_id, status
            from core.seller_accounts where tenant_id = ${s.tenantId}
           order by created_at, id`.execute(t);
        return rows.map(toSellerAccount);
      });
    },

    async getSellerAccount(scope: Scope, id: string): Promise<SellerAccountRow | null> {
      const s = requireScope(scope);
      return withScope(db, s, async (t) => {
        const { rows } = await sql<SellerAccountDbRow>`
          select id, name, region_code, account_type, selling_partner_id, status
            from core.seller_accounts where tenant_id = ${s.tenantId} and id = ${id}`.execute(t);
        return rows[0] ? toSellerAccount(rows[0]) : null;
      });
    },

    async createSellerAccount(
      scope: Scope,
      input: { name: string; regionCode: string; accountType: "seller" | "vendor" },
      trx?: ScopedTx,
    ): Promise<string> {
      const s = requireScope(scope);
      const id = uuidv7();
      await run(db, s, trx, async (t) => {
        await sql`insert into core.seller_accounts (id, tenant_id, name, region_code, account_type)
                  values (${id}, ${s.tenantId}, ${input.name}, ${input.regionCode}, ${input.accountType})`.execute(
          t,
        );
      });
      return id;
    },

    /** Marketplaces visible for an account: its region's enabled ones plus any it already has a row for. */
    async listAccountMarketplaces(scope: Scope, sellerAccountId: string) {
      const s = requireScope(scope);
      return withScope(db, s, async (t) => {
        const { rows } = await sql<{
          marketplace_id: string;
          name: string;
          country_code: string;
          currency: string;
          time_zone: string;
          is_enabled: boolean;
          is_participating: boolean | null;
          ads_profile_id: string | null;
        }>`select m.id as marketplace_id, m.name, m.country_code, m.default_currency as currency,
                  m.time_zone, coalesce(sam.is_enabled, true) as is_enabled,
                  sam.is_participating, sam.ads_profile_id
             from core.seller_accounts sa
             join ref.marketplaces m on m.region_code = sa.region_code
             left join core.seller_account_marketplaces sam
               on sam.seller_account_id = sa.id and sam.marketplace_id = m.id
            where sa.tenant_id = ${s.tenantId} and sa.id = ${sellerAccountId}
              and (m.is_enabled or sam.marketplace_id is not null)
            order by m.country_code`.execute(t);
        return rows.map((r) => ({
          marketplaceId: r.marketplace_id,
          name: r.name,
          countryCode: r.country_code,
          currency: r.currency,
          timeZone: r.time_zone,
          isEnabled: r.is_enabled,
          isParticipating: r.is_participating,
          adsProfileId: r.ads_profile_id,
        }));
      });
    },

    // --- per-user preferences (ADS-03 column layout etc.) ----------------------------------------------------
    async getPreference(scope: Scope, userId: string, key: string): Promise<unknown> {
      const s = requireScope(scope);
      return withScope(db, s, async (t) => {
        const { rows } = await sql<{ value: unknown }>`
          select value from core.user_preferences
           where tenant_id = ${s.tenantId} and user_id = ${userId} and pref_key = ${key}`.execute(
          t,
        );
        return rows[0] ? rows[0].value : null;
      });
    },

    async putPreference(scope: Scope, userId: string, key: string, value: unknown): Promise<void> {
      const s = requireScope(scope);
      await withScope(db, s, async (t) => {
        await sql`insert into core.user_preferences (tenant_id, user_id, pref_key, value)
                  values (${s.tenantId}, ${userId}, ${key}, ${JSON.stringify(value)}::jsonb)
                  on conflict (tenant_id, user_id, pref_key)
                  do update set value = excluded.value, updated_at = now()`.execute(t);
      });
    },

    async deletePreference(scope: Scope, userId: string, key: string): Promise<void> {
      const s = requireScope(scope);
      await withScope(db, s, async (t) => {
        await sql`delete from core.user_preferences
                   where tenant_id = ${s.tenantId} and user_id = ${userId} and pref_key = ${key}`.execute(
          t,
        );
      });
    },
  };
}

export type TenancyRepository = ReturnType<typeof tenancyRepository>;
