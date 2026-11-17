import type { Role } from "@seller-hub/core";
import type { Database } from "@seller-hub/db";
import type { AuditWriter } from "@seller-hub/mod-platform-audit";

// Service holder for the modules of this domain. The API composition root (apps/api/src/main.ts) calls
// `provideTenancyServices()` once at boot; route modules resolve it lazily per request, so importing a route file has
// no side effect (the registry imports every route file at build time).

export interface TenancyServices {
  db: Database;
  audit: AuditWriter;
  /** permission -> roles, from every *.permissions.ts file (the API builds it from the generated registry). */
  permissionMatrix: ReadonlyMap<string, ReadonlySet<Role>>;
  /** Public URL of the web app, used for invitation links. */
  webPublicUrl: string;
  /** Called after a member's roles change or the member is removed: the auth module revokes their sessions. */
  onPrivilegeChange?: (userId: string) => Promise<void>;
  now?: () => Date;
}

let current: TenancyServices | undefined;

export function provideTenancyServices(services: TenancyServices): void {
  current = services;
}

export function tenancyServices(): TenancyServices {
  if (!current)
    throw new Error("platform-tenancy services were not provided by the composition root");
  return current;
}
