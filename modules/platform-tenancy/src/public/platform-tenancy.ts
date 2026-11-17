// What other modules may import (through `@seller-hub/mod-platform-tenancy`).
export {
  effectiveRoles,
  permissionsFor,
  visibleSellerAccountIds,
  topRole,
  roleRank,
} from "../access";
export type { Grant } from "../access";
export { provideTenancyServices, tenancyServices, type TenancyServices } from "../container";
export {
  tenancyService,
  hashToken,
  newToken,
  normalizeEmail,
} from "../service/platform-tenancy/tenancy-service";
export type { TenancyService, ActorContext } from "../service/platform-tenancy/tenancy-service";
export { buildTenancyService } from "../handlers/platform-tenancy/tenancy-handlers";
export {
  tenancyRepository,
  type TenancyRepository,
} from "../repository/platform-tenancy/tenancy-repository";
export { NO_TENANT, userScope, INVITABLE_ROLES } from "../types";
export type { SellerAccountRow, UserMembership, InvitableRole } from "../types";
