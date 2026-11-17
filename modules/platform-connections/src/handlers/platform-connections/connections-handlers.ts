import { DomainError, respond, type OperationRequest, type Scope } from "@seller-hub/core";
import { connectionsServiceInstance } from "../../container";
import type { ActorInfo } from "../../service/platform-connections/connections-service";

// HTTP adapters of platform-connections. The guard checked the permission and, for seller-account operations, that the
// account belongs to the caller's tenant (404 otherwise). Bodies carry secrets (a refresh token, an OAuth code): they are
// read here and nowhere else; the request log never includes bodies or query strings (conventions §7).

function scopeOf(req: OperationRequest): Scope {
  if (!req.scope)
    throw new DomainError("unauthenticated", "unauthenticated", "Sign in to continue");
  return req.scope;
}
const actorOf = (req: OperationRequest): ActorInfo => ({
  scope: scopeOf(req),
  traceId: req.traceId,
});

export function connectionsHandlers(service = connectionsServiceInstance) {
  return {
    listConnections: async (req: OperationRequest) => ({
      items: await service().list(scopeOf(req)),
    }),

    connectSpapiSelfAuthorization: async (req: OperationRequest) =>
      respond(
        200,
        await service().connectSpapiSelfAuthorization(actorOf(req), {
          refreshToken: String((req.body as { refreshToken: string }).refreshToken),
        }),
      ),

    startAdsAuthorization: async (req: OperationRequest) =>
      respond(200, await service().startAdsAuthorization(actorOf(req))),

    completeAdsAuthorization: async (req: OperationRequest) => {
      const b = req.body as { code: string; state: string };
      return respond(
        200,
        await service().completeAdsAuthorization(actorOf(req), { code: b.code, state: b.state }),
      );
    },

    disconnect: async (req: OperationRequest) =>
      respond(200, await service().disconnect(actorOf(req), req.params.api as "spapi" | "ads")),

    listAdsProfiles: async (req: OperationRequest) => ({
      items: await service().listAdsProfiles(scopeOf(req)),
    }),

    refreshAdsProfiles: async (req: OperationRequest) =>
      respond(200, await service().refreshAdsProfiles(actorOf(req))),

    linkAdsProfile: async (req: OperationRequest) =>
      respond(
        200,
        await service().linkAdsProfile(
          actorOf(req),
          req.params.profileId!,
          (req.body as { marketplaceId: string }).marketplaceId,
        ),
      ),

    unlinkAdsProfile: async (req: OperationRequest) => {
      await service().unlinkAdsProfile(actorOf(req), req.params.profileId!);
      return respond(204);
    },
  };
}
