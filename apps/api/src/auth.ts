import type { Role, Scope } from "@seller-hub/core";
import type { FastifyRequest } from "fastify";

// The authentication seam. P3-IDENTITY replaces `noAuthenticator` with the session/bearer resolver
// (ADR-0004); until then every non-public operation answers 401 (default-deny).

export interface ResolvedScope {
  scope: Scope;
  /** Roles the caller holds in that scope (union of grants). */
  roles: readonly Role[];
}

export interface Principal {
  userId: string;
  tenantId: string;
  /**
   * Resolves the scope for an operation. `sellerAccountId` is null for tenant-scoped operations.
   * Returns null when the account does not exist for the caller's tenant — the API answers 404, never 403,
   * for ids of another tenant (conventions §3).
   */
  resolve(sellerAccountId: string | null): Promise<ResolvedScope | null>;
}

export type Authenticator = (request: FastifyRequest) => Promise<Principal | null>;

export const noAuthenticator: Authenticator = async () => null;
