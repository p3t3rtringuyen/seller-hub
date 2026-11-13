import { parseRegion } from "@seller-hub/amazon-core";
import type { Scope } from "@seller-hub/core";
import type { Database } from "@seller-hub/db";
import { sql } from "kysely";
import type { SyncTarget } from "./types";

/**
 * Which seller accounts exist and how they are connected. P3-IDENTITY owns the tables behind this (tenancy,
 * connections); the engine only needs the answer below, so it depends on this port, not on their module.
 * The worker passes `createDbSellerDirectory(systemDb)` until P3-IDENTITY exposes its own implementation.
 */
export interface SellerDirectory {
  /** Every active seller account of every tenant — the scheduler's cross-tenant view (system use only). */
  listTargets(): Promise<SyncTarget[]>;
  /** One account, or null when it is gone/disconnected. */
  getTarget(scope: Required<Pick<Scope, "tenantId" | "sellerAccountId">>): Promise<SyncTarget | null>;
}

interface TargetRow {
  id: string;
  tenant_id: string;
  account_type: "seller" | "vendor";
  region_code: string;
  status: string;
  marketplace_ids: string[];
  profiles: { profileId: string; marketplaceId: string | null; accountType: string }[] | null;
  sp_status: string | null;
  ads_status: string | null;
}

function pausedOf(status: string | null): SyncTarget["paused"][keyof SyncTarget["paused"]] {
  if (status === "needs_reauth" || status === "revoked" || status === "error") return "needs_reauth";
  return undefined;
}

function toTarget(r: TargetRow): SyncTarget {
  const paused: SyncTarget["paused"] = {};
  const sp = pausedOf(r.sp_status);
  const ads = pausedOf(r.ads_status);
  if (sp) paused.sp = sp;
  if (ads) paused.ads = ads;
  return {
    tenantId: r.tenant_id,
    sellerAccountId: r.id,
    accountType: r.account_type,
    region: parseRegion(r.region_code.toLowerCase()),
    marketplaceIds: r.marketplace_ids ?? [],
    adsProfiles: (r.profiles ?? []).map((p) => ({
      profileId: p.profileId,
      marketplaceId: p.marketplaceId,
      accountType: p.accountType as "seller" | "vendor" | "agency",
    })),
    paused,
  };
}

const SELECT = sql`
  select sa.id, sa.tenant_id, sa.account_type, sa.region_code, sa.status,
         coalesce((select array_agg(m.marketplace_id order by m.marketplace_id)
                     from core.seller_account_marketplaces m
                    where m.seller_account_id = sa.id and m.is_enabled and coalesce(m.is_participating, true)),
                  '{}') as marketplace_ids,
         (select jsonb_agg(jsonb_build_object('profileId', p.amazon_profile_id,
                                              'marketplaceId', p.marketplace_id,
                                              'accountType', p.account_type) order by p.amazon_profile_id)
            from core.ads_profiles p
           where p.seller_account_id = sa.id and p.status = 'linked') as profiles,
         (select c.status from core.connections c where c.seller_account_id = sa.id and c.api = 'spapi') as sp_status,
         (select c.status from core.connections c where c.seller_account_id = sa.id and c.api = 'ads') as ads_status
    from core.seller_accounts sa`;

/**
 * Reads `core.*` with the SYSTEM (owner) connection: the scheduler is the one place that must see all tenants.
 * It returns ids and connection health only; no seller data and no credentials.
 */
export function createDbSellerDirectory(system: Database): SellerDirectory {
  return {
    async listTargets() {
      const res = await sql<TargetRow>`${SELECT} where sa.status = 'active'`.execute(system);
      return res.rows.map(toTarget);
    },
    async getTarget(scope) {
      const res = await sql<TargetRow>`${SELECT}
        where sa.id = ${scope.sellerAccountId} and sa.tenant_id = ${scope.tenantId} and sa.status = 'active'`.execute(
        system,
      );
      const row = res.rows[0];
      return row ? toTarget(row) : null;
    },
  };
}

/** In-memory directory for tests and the demo. */
export function staticSellerDirectory(targets: SyncTarget[]): SellerDirectory {
  return {
    async listTargets() {
      return targets;
    },
    async getTarget(scope) {
      return (
        targets.find(
          (t) => t.tenantId === scope.tenantId && t.sellerAccountId === scope.sellerAccountId,
        ) ?? null
      );
    },
  };
}
