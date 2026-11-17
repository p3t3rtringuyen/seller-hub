import { buildTenancyService } from "@seller-hub/mod-platform-tenancy";
import type { Role } from "@seller-hub/core";
import { authService } from "./container";

// The API's Authenticator (apps/api/src/auth.ts is the seam): `Authorization: Bearer <session token>` -> user and
// active tenant -> Principal whose `resolve()` turns a seller account id into a Scope + roles, or null (404) when the
// account is not in the caller's tenant or not visible to them. The BFF is the only party that holds the token: it
// reads it from its httpOnly cookie and adds this header (ADR-0003). Machine tokens (identity.api_tokens, D50 b) are a
// schema seam: a bearer with the `shk_` prefix is not a session and is refused until that slice lands.

export interface AuthPrincipal {
  userId: string;
  tenantId: string;
  resolve(sellerAccountId: string | null): Promise<{
    scope: { tenantId: string; sellerAccountId?: string; userId?: string };
    roles: Role[];
  } | null>;
}

export function bearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const m = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(value);
  return m ? m[1]! : null;
}

export async function authenticate(request: {
  headers: Record<string, string | string[] | undefined>;
}): Promise<AuthPrincipal | null> {
  const token = bearerToken(request.headers.authorization);
  if (!token) return null;
  const session = await authService().resolveSession(token);
  if (!session) return null;
  const tenancy = buildTenancyService();
  return {
    userId: session.userId,
    tenantId: session.tenantId,
    async resolve(sellerAccountId) {
      const access = await tenancy.access(session.userId, session.tenantId, sellerAccountId);
      if (!access) return null;
      return {
        scope: {
          tenantId: access.scope.tenantId,
          ...(access.scope.sellerAccountId
            ? { sellerAccountId: access.scope.sellerAccountId }
            : {}),
          userId: session.userId,
        },
        roles: access.roles,
      };
    },
  };
}
