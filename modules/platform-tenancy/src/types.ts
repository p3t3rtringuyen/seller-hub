import type { Scope } from "@seller-hub/core";

/** Scope for statements that look at one user across tenants (switcher, sign-in): the all-zero tenant matches no row. */
export const NO_TENANT = "00000000-0000-0000-0000-000000000000";
export const userScope = (userId: string): Scope => ({ tenantId: NO_TENANT, userId });

export const INVITABLE_ROLES = ["admin", "manager", "analyst", "viewer"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export interface TenantRow {
  id: string;
  name: string;
  status: "active" | "suspended";
  requireTwoFactor: boolean;
}

export interface UserMembership {
  membershipId: string;
  tenantId: string;
  tenantName: string;
  status: "active" | "suspended";
  tenantStatus: "active" | "suspended";
}

export interface SellerAccountRow {
  id: string;
  name: string;
  regionCode: "NA" | "EU" | "FE";
  accountType: "seller" | "vendor";
  sellingPartnerId: string | null;
  status: "active" | "disconnected" | "deleting";
}

export interface MemberRow {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  status: "active" | "suspended";
  createdAt: string;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: InvitableRole;
  sellerAccountId: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  invitedBy: string | null;
}
