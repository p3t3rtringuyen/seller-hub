import { defineRoutes } from "@seller-hub/core";
import { tenancyHandlers } from "../../handlers/platform-tenancy/tenancy-handlers";

// Binds the contract operations of contracts/modules/platform-tenancy/platform-tenancy.yaml to handlers.
// Services are resolved lazily per request (the composition root provides them at boot).
export default defineRoutes((router) => {
  const h = tenancyHandlers();
  router.operation("platform-tenancy.getMe", h.getMe);
  router.operation("platform-tenancy.getPreference", h.getPreference);
  router.operation("platform-tenancy.putPreference", h.putPreference);
  router.operation("platform-tenancy.deletePreference", h.deletePreference);
  router.operation("platform-tenancy.listMembers", h.listMembers);
  router.operation("platform-tenancy.setMemberRoles", h.setMemberRoles);
  router.operation("platform-tenancy.removeMember", h.removeMember);
  router.operation("platform-tenancy.listInvitations", h.listInvitations);
  router.operation("platform-tenancy.createInvitation", h.createInvitation);
  router.operation("platform-tenancy.revokeInvitation", h.revokeInvitation);
  router.operation("platform-tenancy.listSellerAccounts", h.listSellerAccounts);
  router.operation("platform-tenancy.createSellerAccount", h.createSellerAccount);
  router.operation("platform-tenancy.getSellerAccount", h.getSellerAccount);
  router.operation("platform-tenancy.listAccountMarketplaces", h.listAccountMarketplaces);
  router.operation("platform-tenancy.listMarketplaces", h.listMarketplaces);
  router.operation("platform-tenancy.listAdsLimits", h.listAdsLimits);
});
