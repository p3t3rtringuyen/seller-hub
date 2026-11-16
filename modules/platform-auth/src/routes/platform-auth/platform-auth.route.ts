import { defineRoutes } from "@seller-hub/core";
import { authHandlers } from "../../handlers/platform-auth/auth-handlers";

// Binds contracts/modules/platform-auth/platform-auth.yaml. The public operations (`x-public`) are the only routes that
// skip the guard; everything else needs a live session.
export default defineRoutes((router) => {
  const h = authHandlers();
  router.operation("platform-auth.setupOwner", h.setup);
  router.operation("platform-auth.signIn", h.signIn);
  router.operation("platform-auth.signOut", h.signOut);
  router.operation("platform-auth.switchTenant", h.switchTenant);
  router.operation("platform-auth.previewInvitation", h.previewInvitation);
  router.operation("platform-auth.registerWithInvitation", h.registerWithInvitation);
  router.operation("platform-auth.acceptInvitation", h.acceptInvitation);
  router.operation("platform-auth.acceptInvitationWithPassword", h.acceptInvitationWithPassword);
});
