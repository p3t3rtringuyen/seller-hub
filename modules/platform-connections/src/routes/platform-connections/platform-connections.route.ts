import { defineRoutes } from "@seller-hub/core";
import { connectionsHandlers } from "../../handlers/platform-connections/connections-handlers";

export default defineRoutes((router) => {
  const h = connectionsHandlers();
  router.operation("platform-connections.listConnections", h.listConnections);
  router.operation(
    "platform-connections.connectSpapiSelfAuthorization",
    h.connectSpapiSelfAuthorization,
  );
  router.operation("platform-connections.startAdsAuthorization", h.startAdsAuthorization);
  router.operation("platform-connections.completeAdsAuthorization", h.completeAdsAuthorization);
  router.operation("platform-connections.disconnectApi", h.disconnect);
  router.operation("platform-connections.listAdsProfiles", h.listAdsProfiles);
  router.operation("platform-connections.refreshAdsProfiles", h.refreshAdsProfiles);
  router.operation("platform-connections.linkAdsProfile", h.linkAdsProfile);
  router.operation("platform-connections.unlinkAdsProfile", h.unlinkAdsProfile);
});
