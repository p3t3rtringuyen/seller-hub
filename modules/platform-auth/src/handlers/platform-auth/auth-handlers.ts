import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import {
  DomainError,
  respond,
  type OperationRequest,
  type OperationResponse,
} from "@seller-hub/core";
import { bearerToken } from "../../authenticator";
import { authService } from "../../container";
import type { ClientContext, SessionIssued } from "../../service/platform-auth/identity-service";

// HTTP adapters of platform-auth. The session token travels ONLY in response headers to the BFF (`x-sh-session`,
// `x-sh-session-max-age`); it is never in a body, and the BFF turns it into an httpOnly cookie before anything reaches
// the browser. `x-sh-client-ip` is set by the BFF (from the trusted proxy header when SH_TRUST_PROXY=1); the API listens
// on a private interface only.

export const SESSION_HEADER = "x-sh-session";
export const SESSION_MAX_AGE_HEADER = "x-sh-session-max-age";
export const SESSION_CLEAR_HEADER = "x-sh-session-clear";

function header(req: OperationRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * The BFF is the only legitimate caller (ADR-0003). It vouches for the client IP and user agent with `x-sh-bff-secret`
 * (`SH_BFF_SECRET`, required in production): without a matching secret those headers are ignored, so a direct caller cannot
 * forge audit IPs or dodge the per-IP throttle. With no secret configured (local dev) they are honoured.
 */
export function bffTrusted(
  req: OperationRequest,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const expected = env.SH_BFF_SECRET;
  if (!expected) return env.NODE_ENV !== "production";
  const given = header(req, "x-sh-bff-secret");
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function clientContext(req: OperationRequest): ClientContext {
  const trusted = bffTrusted(req);
  const ip = trusted ? header(req, "x-sh-client-ip") : undefined;
  return {
    ip: ip && isIP(ip) ? ip : null,
    userAgent: trusted ? (header(req, "x-sh-user-agent") ?? null) : null,
    traceId: req.traceId,
    previousToken: bearerToken(req.headers.authorization) ?? undefined,
  };
}

function currentSession(req: OperationRequest): { token: string; userId: string } {
  const token = bearerToken(req.headers.authorization);
  if (!token || !req.scope?.userId)
    throw new DomainError("unauthenticated", "unauthenticated", "Sign in to continue");
  return { token, userId: req.scope.userId };
}

function issued(status: number, s: SessionIssued): OperationResponse {
  return respond(
    status,
    { user: s.user, tenantId: s.tenantId },
    { [SESSION_HEADER]: s.token, [SESSION_MAX_AGE_HEADER]: String(s.maxAgeSeconds) },
  );
}

type Body = Record<string, string | null | undefined>;

export function authHandlers() {
  return {
    setup: async (req: OperationRequest) => {
      const b = req.body as Body;
      return issued(
        201,
        await authService().setup(
          {
            setupToken: b.setupToken!,
            email: b.email!,
            password: b.password!,
            displayName: b.displayName ?? null,
            tenantName: b.tenantName!,
          },
          clientContext(req),
        ),
      );
    },

    signIn: async (req: OperationRequest) => {
      const b = req.body as Body;
      return issued(
        200,
        await authService().signIn({ email: b.email!, password: b.password! }, clientContext(req)),
      );
    },

    signOut: async (req: OperationRequest) => {
      const { token } = currentSession(req);
      await authService().signOut(token, clientContext(req));
      return respond(204, undefined, { [SESSION_CLEAR_HEADER]: "1" });
    },

    switchTenant: async (req: OperationRequest) => {
      const cur = currentSession(req);
      return issued(
        200,
        await authService().switchTenant(cur, (req.body as Body).tenantId!, clientContext(req)),
      );
    },

    previewInvitation: async (req: OperationRequest) =>
      authService().previewInvitation((req.body as Body).token!),

    registerWithInvitation: async (req: OperationRequest) => {
      const b = req.body as Body;
      return issued(
        201,
        await authService().acceptInvitationNewUser(
          { token: b.token!, password: b.password!, displayName: b.displayName ?? null },
          clientContext(req),
        ),
      );
    },

    acceptInvitationWithPassword: async (req: OperationRequest) => {
      const b = req.body as Body;
      return issued(
        200,
        await authService().acceptInvitationWithPassword(
          { token: b.token!, password: b.password! },
          clientContext(req),
        ),
      );
    },

    acceptInvitation: async (req: OperationRequest) => {
      const cur = currentSession(req);
      return issued(
        200,
        await authService().acceptInvitationSignedIn(
          cur,
          (req.body as Body).token!,
          clientContext(req),
        ),
      );
    },
  };
}
