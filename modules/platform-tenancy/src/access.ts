import type { Role } from "@seller-hub/core";

// Pure access rules (ADR-0004 decision 3): grants -> roles -> permissions. No I/O, fully unit-tested.

export interface Grant {
  role: Role;
  /** NULL = every seller account of the tenant. */
  sellerAccountId: string | null;
  /** Schema seam (narrowing by marketplace) - not exposed in the MVP UI, so a narrowed grant confers nothing here. */
  marketplaceId: string | null;
}

const RANK: Record<Role, number> = { owner: 5, admin: 4, manager: 3, analyst: 2, viewer: 1 };
export const roleRank = (r: Role): number => RANK[r];

const unique = (roles: Role[]): Role[] => [...new Set(roles)];

/**
 * Roles a member holds for one seller account (union of tenant-wide grants and grants on that account), or - with
 * `sellerAccountId = null` - at tenant level. At tenant level only tenant-wide grants count, except that a member
 * who holds ONLY seller-account grants gets the `viewer` floor so they can load their own profile and the accounts
 * they were given (the account list itself is filtered by grants).
 */
export function effectiveRoles(grants: readonly Grant[], sellerAccountId: string | null): Role[] {
  const live = grants.filter((g) => g.marketplaceId === null);
  if (sellerAccountId === null) {
    const wide = live.filter((g) => g.sellerAccountId === null).map((g) => g.role);
    if (wide.length) return unique(wide);
    return live.length ? ["viewer"] : [];
  }
  return unique(
    live
      .filter((g) => g.sellerAccountId === null || g.sellerAccountId === sellerAccountId)
      .map((g) => g.role),
  );
}

export function permissionsFor(
  roles: readonly Role[],
  matrix: ReadonlyMap<string, ReadonlySet<Role>>,
): string[] {
  const out: string[] = [];
  for (const [permission, allowed] of matrix) {
    if (roles.some((r) => allowed.has(r))) out.push(permission);
  }
  return out.sort();
}

/** Seller accounts a member may see: all when any tenant-wide grant exists, else the granted ones. */
export function visibleSellerAccountIds(
  grants: readonly Grant[],
  allIds: readonly string[],
): string[] {
  const live = grants.filter((g) => g.marketplaceId === null);
  if (live.some((g) => g.sellerAccountId === null)) return [...allIds];
  const granted = new Set(live.map((g) => g.sellerAccountId));
  return allIds.filter((id) => granted.has(id));
}

/** Highest role a member holds anywhere in the tenant (for "who may change whom"). */
export function topRole(grants: readonly Grant[]): Role | null {
  let best: Role | null = null;
  for (const g of grants) if (best === null || roleRank(g.role) > roleRank(best)) best = g.role;
  return best;
}
