import { buildTenancyService, tenancyServices } from "@seller-hub/mod-platform-tenancy";
import { identityService, type IdentityService } from "./service/platform-auth/identity-service";
import { createLoginLimiter } from "./service/platform-auth/login-limiter";

// The IdentityService is built lazily from the tenancy services the composition root provided, and rebuilt when those
// are provided again (tests). The login limiter lives as long as the process.

const limiter = createLoginLimiter();
const cache = new WeakMap<object, IdentityService>();

export function authService(): IdentityService {
  const base = tenancyServices();
  let service = cache.get(base);
  if (!service) {
    service = identityService({
      db: base.db,
      audit: base.audit,
      tenancy: buildTenancyService(),
      limiter,
      ...(base.now ? { now: base.now } : {}),
    });
    cache.set(base, service);
  }
  return service;
}

/** What the tenancy module calls when roles change: revoke the member's sessions so the new roles apply at once. */
export const revokeSessionsOf = (userId: string): Promise<void> =>
  authService()
    .revokeUserSessions(userId)
    .then(() => undefined);
