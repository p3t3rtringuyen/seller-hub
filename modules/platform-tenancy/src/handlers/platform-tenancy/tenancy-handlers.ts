import {
  DomainError,
  respond,
  type OperationRequest,
  type Role,
  type Scope,
} from "@seller-hub/core";
import { tenancyServices } from "../../container";
import {
  tenancyService,
  type ActorContext,
  type TenancyService,
} from "../../service/platform-tenancy/tenancy-service";

// HTTP adapters of platform-tenancy: map the operation request to the service and the result to the DTO. The guard
// has already authenticated the caller and checked the permission; `req.scope` is { tenantId, userId[, sellerAccountId] }.

export function buildTenancyService(): TenancyService {
  const s = tenancyServices();
  return tenancyService({
    db: s.db,
    audit: s.audit,
    permissionMatrix: s.permissionMatrix,
    webPublicUrl: s.webPublicUrl,
    onPrivilegeChange: s.onPrivilegeChange,
    now: s.now,
  });
}

function scopeOf(req: OperationRequest): Scope {
  if (!req.scope)
    throw new DomainError("unauthenticated", "unauthenticated", "Sign in to continue");
  return req.scope;
}
const actorOf = (req: OperationRequest): ActorContext => ({
  scope: scopeOf(req),
  traceId: req.traceId,
});

type Body = Record<string, unknown>;

export function tenancyHandlers(service: () => TenancyService = buildTenancyService) {
  return {
    getMe: async (req: OperationRequest) => service().getMe(scopeOf(req)),

    getPreference: async (req: OperationRequest) =>
      service().getPreference(scopeOf(req), req.params.prefKey!),
    putPreference: async (req: OperationRequest) =>
      service().putPreference(scopeOf(req), req.params.prefKey!, (req.body as Body).value),
    deletePreference: async (req: OperationRequest) => {
      await service().deletePreference(scopeOf(req), req.params.prefKey!);
      return respond(204);
    },

    listMembers: async (req: OperationRequest) => ({
      items: await service().listMembers(scopeOf(req)),
    }),
    setMemberRoles: async (req: OperationRequest) =>
      service().setMemberRoles(
        actorOf(req),
        req.params.membershipId!,
        (req.body as { grants: { role: Role; sellerAccountId: string | null }[] }).grants,
      ),
    removeMember: async (req: OperationRequest) => {
      await service().removeMember(actorOf(req), req.params.membershipId!);
      return respond(204);
    },

    listInvitations: async (req: OperationRequest) => ({
      items: await service().listInvitations(scopeOf(req)),
    }),
    createInvitation: async (req: OperationRequest) => {
      const body = req.body as { email: string; role: string; sellerAccountId?: string | null };
      const { invitation, link } = await service().createInvitation(actorOf(req), body);
      return respond(201, { invitation, link });
    },
    revokeInvitation: async (req: OperationRequest) => {
      await service().revokeInvitation(actorOf(req), req.params.invitationId!);
      return respond(204);
    },

    listSellerAccounts: async (req: OperationRequest) => ({
      items: await service().listSellerAccounts(scopeOf(req)),
    }),
    createSellerAccount: async (req: OperationRequest) =>
      respond(
        201,
        await service().createSellerAccount(
          actorOf(req),
          req.body as { name: string; regionCode: string; accountType?: "seller" | "vendor" },
        ),
      ),
    getSellerAccount: async (req: OperationRequest) =>
      service().getSellerAccount(scopeOf(req), req.params.sellerAccountId!),
    listAccountMarketplaces: async (req: OperationRequest) => ({
      items: await service().listAccountMarketplaces(scopeOf(req), req.params.sellerAccountId!),
    }),

    listMarketplaces: async () => ({ items: await service().listMarketplaces() }),
    listAdsLimits: async (req: OperationRequest) => ({
      items: await service().listAdsLimits(
        typeof req.query.marketplaceId === "string" ? req.query.marketplaceId : undefined,
      ),
    }),
  };
}
