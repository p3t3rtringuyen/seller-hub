import { requireScope, requireSellerScope, uuidv7, type Scope } from "@seller-hub/core";
import { withScope, type Database, type ScopedTx } from "@seller-hub/db";
import { sql } from "kysely";
import type { SealedSecret } from "../../vault/envelope";

// Repository for `core.connections`, `core.credentials`, `core.connect_states`, `core.ads_profiles` and the Ads link in
// `core.seller_account_marketplaces`. Scope first, explicit tenant/seller-account filters, RLS behind them.
// `core.credentials` is selected ONLY here (ADR-0005), and only by `getSealedCredential`.

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

export type ApiKind = "spapi" | "ads";
export type ConnectionStatus = "pending" | "active" | "needs_reauth" | "revoked" | "error";

export interface ConnectionRow {
  id: string;
  sellerAccountId: string;
  api: ApiKind;
  regionCode: string;
  status: ConnectionStatus;
  authMethod: "self_authorization" | "oauth_code";
  scopes: string[];
  connectedAt: string | null;
  lastTokenRefreshAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  revokedAt: string | null;
}

export interface AdsProfileRow {
  id: string;
  sellerAccountId: string;
  amazonProfileId: string;
  accountType: "seller" | "vendor" | "agency";
  accountName: string | null;
  adsCountryCode: string;
  marketplaceId: string | null;
  currency: string | null;
  timeZone: string;
  validPaymentMethod: boolean | null;
  status: "available" | "linked" | "unavailable";
  linkedMarketplaceId: string | null;
  syncedAt: string;
}

export interface AdsProfileInput {
  amazonProfileId: string;
  amazonAccountInfoId: string | null;
  accountType: "seller" | "vendor" | "agency";
  accountName: string | null;
  adsCountryCode: string;
  marketplaceId: string | null;
  currency: string | null;
  timeZone: string;
  validPaymentMethod: boolean | null;
}

interface ConnectionDb {
  id: string;
  seller_account_id: string;
  api: ApiKind;
  region_code: string;
  status: ConnectionStatus;
  auth_method: "self_authorization" | "oauth_code";
  scopes: string[];
  connected_at: Date | null;
  last_token_refresh_at: Date | null;
  last_error_code: string | null;
  last_error_at: Date | null;
  revoked_at: Date | null;
}
const toConnection = (r: ConnectionDb): ConnectionRow => ({
  id: r.id,
  sellerAccountId: r.seller_account_id,
  api: r.api,
  regionCode: r.region_code,
  status: r.status,
  authMethod: r.auth_method,
  scopes: r.scopes,
  connectedAt: r.connected_at ? iso(r.connected_at) : null,
  lastTokenRefreshAt: r.last_token_refresh_at ? iso(r.last_token_refresh_at) : null,
  lastErrorCode: r.last_error_code,
  lastErrorAt: r.last_error_at ? iso(r.last_error_at) : null,
  revokedAt: r.revoked_at ? iso(r.revoked_at) : null,
});
const CONNECTION_COLS = sql.raw(
  "id, seller_account_id, api, region_code, status, auth_method, scopes, connected_at, last_token_refresh_at, last_error_code, last_error_at, revoked_at",
);

interface ProfileDb {
  id: string;
  seller_account_id: string;
  amazon_profile_id: string;
  account_type: "seller" | "vendor" | "agency";
  account_name: string | null;
  ads_country_code: string;
  marketplace_id: string | null;
  currency: string | null;
  time_zone: string;
  valid_payment_method: boolean | null;
  status: "available" | "linked" | "unavailable";
  synced_at: Date;
  linked_marketplace_id: string | null;
}
const toProfile = (r: ProfileDb): AdsProfileRow => ({
  id: r.id,
  sellerAccountId: r.seller_account_id,
  amazonProfileId: r.amazon_profile_id,
  accountType: r.account_type,
  accountName: r.account_name,
  adsCountryCode: r.ads_country_code,
  marketplaceId: r.marketplace_id,
  currency: r.currency,
  timeZone: r.time_zone,
  validPaymentMethod: r.valid_payment_method,
  status: r.status,
  linkedMarketplaceId: r.linked_marketplace_id,
  syncedAt: iso(r.synced_at),
});

function run<T>(
  db: Database,
  scope: Scope,
  trx: ScopedTx | undefined,
  fn: (t: ScopedTx) => Promise<T>,
): Promise<T> {
  return trx ? fn(trx) : withScope(db, scope, fn);
}

export function connectionsRepository(db: Database) {
  return {
    // --- connections -------------------------------------------------------------------------------------------
    async list(scope: Scope): Promise<ConnectionRow[]> {
      const s = requireSellerScope(scope);
      return withScope(db, s, async (t) => {
        const { rows } = await sql<ConnectionDb>`
          select ${CONNECTION_COLS} from core.connections
           where tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}
           order by api`.execute(t);
        return rows.map(toConnection);
      });
    },

    async get(scope: Scope, api: ApiKind, trx?: ScopedTx): Promise<ConnectionRow | null> {
      const s = requireSellerScope(scope);
      return run(db, s, trx, async (t) => {
        const { rows } = await sql<ConnectionDb>`
          select ${CONNECTION_COLS} from core.connections
           where tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId} and api = ${api}`.execute(
          t,
        );
        return rows[0] ? toConnection(rows[0]) : null;
      });
    },

    /** Creates or reactivates the connection of a seller account for an API. */
    async upsertActive(
      scope: Scope,
      input: {
        api: ApiKind;
        regionCode: string;
        authMethod: "self_authorization" | "oauth_code";
        scopes: string[];
        connectedBy: string | null;
      },
      trx: ScopedTx,
    ): Promise<string> {
      const s = requireSellerScope(scope);
      const { rows } = await sql<{ id: string }>`
        insert into core.connections
          (id, tenant_id, seller_account_id, api, region_code, status, auth_method, scopes, connected_by, connected_at)
        values (${uuidv7()}, ${s.tenantId}, ${s.sellerAccountId}, ${input.api}, ${input.regionCode}, 'active',
                ${input.authMethod}, ${sql.val(input.scopes)}::text[], ${input.connectedBy}, now())
        on conflict (seller_account_id, api) do update
          set status = 'active', region_code = excluded.region_code, auth_method = excluded.auth_method,
              scopes = excluded.scopes, connected_by = excluded.connected_by, connected_at = now(),
              revoked_at = null, last_error_code = null, last_error_at = null
        returning id`.execute(trx);
      return rows[0]!.id;
    },

    async markStatus(
      scope: Scope,
      api: ApiKind,
      status: ConnectionStatus,
      errorCode: string | null,
      trx?: ScopedTx,
    ): Promise<void> {
      const s = requireSellerScope(scope);
      await run(db, s, trx, async (t) => {
        await sql`update core.connections
                     set status = ${status},
                         revoked_at = case when ${status} = 'revoked' then now() else revoked_at end,
                         last_error_code = ${errorCode},
                         last_error_at = case when ${errorCode}::text is null then last_error_at else now() end
                   where tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId} and api = ${api}`.execute(
          t,
        );
      });
    },

    // --- credentials (ADR-0005) -------------------------------------------------------------------------------
    /** Replaces the credential of a connection (a refreshed or re-entered token). */
    async replaceCredential(
      scope: Scope,
      input: { connectionId: string; kind: string; regionCode: string; sealed: SealedSecret },
      trx: ScopedTx,
    ): Promise<void> {
      const s = requireSellerScope(scope);
      await sql`delete from core.credentials
                 where tenant_id = ${s.tenantId} and connection_id = ${input.connectionId} and kind = ${input.kind}`.execute(
        trx,
      );
      await sql`insert into core.credentials
                  (id, tenant_id, seller_account_id, connection_id, kind, region_code, kek_id, wrapped_dek, iv, ciphertext, auth_tag)
                values (${uuidv7()}, ${s.tenantId}, ${s.sellerAccountId}, ${input.connectionId}, ${input.kind},
                        ${input.regionCode}, ${input.sealed.kekId}, ${input.sealed.wrappedDek}, ${input.sealed.iv},
                        ${input.sealed.ciphertext}, ${input.sealed.authTag})`.execute(trx);
    },

    /** Crypto-shred: deletes the credential rows of a connection. */
    async deleteCredentials(scope: Scope, connectionId: string, trx: ScopedTx): Promise<number> {
      const s = requireSellerScope(scope);
      const r = await sql`delete from core.credentials
                           where tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}
                             and connection_id = ${connectionId}`.execute(trx);
      return Number(r.numAffectedRows ?? 0);
    },

    /** The one place the sealed secret is read. Only active connections hand out a credential. */
    async getSealedCredential(
      scope: Scope,
      api: ApiKind,
    ): Promise<{ kind: string; regionCode: string; sealed: SealedSecret } | null> {
      const s = requireSellerScope(scope);
      return withScope(db, s, async (t) => {
        const { rows } = await sql<{
          kind: string;
          region_code: string;
          kek_id: string;
          wrapped_dek: Buffer;
          iv: Buffer;
          ciphertext: Buffer;
          auth_tag: Buffer;
        }>`select cr.kind, cr.region_code, cr.kek_id, cr.wrapped_dek, cr.iv, cr.ciphertext, cr.auth_tag
             from core.credentials cr join core.connections c
               on c.tenant_id = cr.tenant_id and c.id = cr.connection_id
            where cr.tenant_id = ${s.tenantId} and cr.seller_account_id = ${s.sellerAccountId}
              and c.api = ${api} and c.status in ('active', 'error') and cr.revoked_at is null`.execute(
          t,
        );
        const r = rows[0];
        return r
          ? {
              kind: r.kind,
              regionCode: r.region_code,
              sealed: {
                kekId: r.kek_id,
                wrappedDek: r.wrapped_dek,
                iv: r.iv,
                ciphertext: r.ciphertext,
                authTag: r.auth_tag,
              },
            }
          : null;
      });
    },

    // --- connect states (CSRF of the OAuth flow, ADR-0005 decision 7) ------------------------------------------
    async createState(
      scope: Scope,
      input: {
        sellerAccountId: string;
        userId: string;
        api: ApiKind;
        regionCode: string;
        stateHash: Buffer;
        ttlMs: number;
      },
    ): Promise<void> {
      const s = requireScope(scope);
      await withScope(db, s, async (t) => {
        await sql`insert into core.connect_states (id, tenant_id, seller_account_id, user_id, api, region_code, state_hash, expires_at)
                  values (${uuidv7()}, ${s.tenantId}, ${input.sellerAccountId}, ${input.userId}, ${input.api},
                          ${input.regionCode}, ${input.stateHash}, now() + ${input.ttlMs / 1000} * interval '1 second')`.execute(
          t,
        );
      });
    },

    /** Consumes a live state of this tenant and user exactly once. */
    async consumeState(
      scope: Scope,
      stateHash: Buffer,
      api: ApiKind,
    ): Promise<{ sellerAccountId: string | null; regionCode: string } | null> {
      const s = requireScope(scope);
      return withScope(db, s, async (t) => {
        const { rows } = await sql<{ seller_account_id: string | null; region_code: string }>`
          update core.connect_states set consumed_at = now()
           where tenant_id = ${s.tenantId} and state_hash = ${stateHash} and api = ${api}
             and user_id = ${s.userId ?? null} and consumed_at is null and expires_at > now()
           returning seller_account_id, region_code`.execute(t);
        return rows[0]
          ? { sellerAccountId: rows[0].seller_account_id, regionCode: rows[0].region_code }
          : null;
      });
    },

    // --- Ads profiles ------------------------------------------------------------------------------------------
    async listProfiles(scope: Scope): Promise<AdsProfileRow[]> {
      const s = requireSellerScope(scope);
      return withScope(db, s, async (t) => {
        const { rows } = await sql<ProfileDb>`
          select p.id, p.seller_account_id, p.amazon_profile_id, p.account_type, p.account_name, p.ads_country_code,
                 p.marketplace_id, p.currency, p.time_zone, p.valid_payment_method, p.status, p.synced_at,
                 sam.marketplace_id as linked_marketplace_id
            from core.ads_profiles p
            left join core.seller_account_marketplaces sam
              on sam.seller_account_id = p.seller_account_id and sam.ads_profile_id = p.id
           where p.tenant_id = ${s.tenantId} and p.seller_account_id = ${s.sellerAccountId}
           order by p.ads_country_code, p.amazon_profile_id`.execute(t);
        return rows.map(toProfile);
      });
    },

    async getProfile(
      scope: Scope,
      amazonProfileId: string,
      trx?: ScopedTx,
    ): Promise<AdsProfileRow | null> {
      const s = requireSellerScope(scope);
      return run(db, s, trx, async (t) => {
        const { rows } = await sql<ProfileDb>`
          select p.id, p.seller_account_id, p.amazon_profile_id, p.account_type, p.account_name, p.ads_country_code,
                 p.marketplace_id, p.currency, p.time_zone, p.valid_payment_method, p.status, p.synced_at,
                 sam.marketplace_id as linked_marketplace_id
            from core.ads_profiles p
            left join core.seller_account_marketplaces sam
              on sam.seller_account_id = p.seller_account_id and sam.ads_profile_id = p.id
           where p.tenant_id = ${s.tenantId} and p.seller_account_id = ${s.sellerAccountId}
             and p.amazon_profile_id = ${amazonProfileId}`.execute(t);
        return rows[0] ? toProfile(rows[0]) : null;
      });
    },

    /** Upserts the profiles Amazon returned and marks the ones it no longer returns as unavailable. */
    async syncProfiles(
      scope: Scope,
      connectionId: string,
      profiles: readonly AdsProfileInput[],
      trx: ScopedTx,
    ): Promise<void> {
      const s = requireSellerScope(scope);
      for (const p of profiles) {
        await sql`
          insert into core.ads_profiles
            (id, tenant_id, seller_account_id, connection_id, amazon_profile_id, account_type, amazon_account_info_id,
             account_name, ads_country_code, marketplace_id, currency, time_zone, valid_payment_method, status, synced_at)
          values (${uuidv7()}, ${s.tenantId}, ${s.sellerAccountId}, ${connectionId}, ${p.amazonProfileId}, ${p.accountType},
                  ${p.amazonAccountInfoId}, ${p.accountName}, ${p.adsCountryCode}, ${p.marketplaceId}, ${p.currency},
                  ${p.timeZone}, ${p.validPaymentMethod}, 'available', now())
          on conflict (seller_account_id, amazon_profile_id) do update
            set connection_id = excluded.connection_id, account_type = excluded.account_type,
                amazon_account_info_id = excluded.amazon_account_info_id, account_name = excluded.account_name,
                ads_country_code = excluded.ads_country_code, marketplace_id = excluded.marketplace_id,
                currency = excluded.currency, time_zone = excluded.time_zone,
                valid_payment_method = excluded.valid_payment_method, synced_at = now(),
                status = case when core.ads_profiles.status = 'unavailable' then 'available' else core.ads_profiles.status end`.execute(
          trx,
        );
      }
      const keep = profiles.map((p) => p.amazonProfileId);
      await sql`update core.ads_profiles set status = 'unavailable'
                 where tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}
                   and connection_id = ${connectionId}
                   and (${keep.length === 0} or amazon_profile_id <> all(${sql.val(keep)}::text[]))`.execute(
        trx,
      );
    },

    /** Links a profile to a marketplace of the account (one profile per marketplace, one marketplace per profile). */
    async linkProfile(
      scope: Scope,
      profileId: string,
      marketplaceId: string,
      trx: ScopedTx,
    ): Promise<void> {
      const s = requireSellerScope(scope);
      // free the profile from any other marketplace and the marketplace from any other profile
      await sql`update core.seller_account_marketplaces set ads_profile_id = null
                 where tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId}
                   and (ads_profile_id = ${profileId} or marketplace_id = ${marketplaceId})`.execute(
        trx,
      );
      await sql`update core.ads_profiles set status = 'available'
                 where tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId} and status = 'linked'
                   and id not in (select ads_profile_id from core.seller_account_marketplaces
                                   where seller_account_id = ${s.sellerAccountId} and ads_profile_id is not null)`.execute(
        trx,
      );
      await sql`insert into core.seller_account_marketplaces (tenant_id, seller_account_id, marketplace_id, ads_profile_id)
                values (${s.tenantId}, ${s.sellerAccountId}, ${marketplaceId}, ${profileId})
                on conflict (seller_account_id, marketplace_id) do update set ads_profile_id = excluded.ads_profile_id`.execute(
        trx,
      );
      await sql`update core.ads_profiles set status = 'linked'
                 where tenant_id = ${s.tenantId} and id = ${profileId}`.execute(trx);
    },

    async unlinkProfile(scope: Scope, profileId: string, trx: ScopedTx): Promise<void> {
      const s = requireSellerScope(scope);
      await sql`update core.seller_account_marketplaces set ads_profile_id = null
                 where tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId} and ads_profile_id = ${profileId}`.execute(
        trx,
      );
      await sql`update core.ads_profiles set status = 'available'
                 where tenant_id = ${s.tenantId} and seller_account_id = ${s.sellerAccountId} and id = ${profileId} and status = 'linked'`.execute(
        trx,
      );
    },

    /** Marketplace facts needed to validate a link (global reference data). */
    async getMarketplaceRef(
      marketplaceId: string,
    ): Promise<{ id: string; regionCode: string; adsCountryCode: string } | null> {
      const { rows } = await sql<{ id: string; region_code: string; ads_country_code: string }>`
        select id, region_code, ads_country_code from ref.marketplaces where id = ${marketplaceId}`.execute(
        db,
      );
      return rows[0]
        ? {
            id: rows[0].id,
            regionCode: rows[0].region_code,
            adsCountryCode: rows[0].ads_country_code,
          }
        : null;
    },

    async knownMarketplaceIds(): Promise<Set<string>> {
      const { rows } = await sql<{ id: string }>`select id from ref.marketplaces`.execute(db);
      return new Set(rows.map((r) => r.id));
    },
    async knownCurrencies(): Promise<Set<string>> {
      const { rows } = await sql<{ code: string }>`select code from ref.currencies`.execute(db);
      return new Set(rows.map((r) => r.code));
    },
  };
}

export type ConnectionsRepository = ReturnType<typeof connectionsRepository>;
