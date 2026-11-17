import { DomainError, validationFailed, type FieldError } from "@seller-hub/core";
import type { Database } from "@seller-hub/db";
import type { AuditWriter } from "@seller-hub/mod-platform-audit";
import { type TenancyService } from "@seller-hub/mod-platform-tenancy";
import {
  dummyHash,
  hashPassword,
  newOpaqueToken,
  passwordProblem,
  sha256,
  verifyPassword,
} from "../../crypto";
import { authRepository, type UserRow } from "../../repository/platform-auth/auth-repository";
import { createLoginLimiter, type LoginLimiter } from "./login-limiter";

// IdentityService (ADR-0004): the interface the rest of the system sees, so Keycloak/OIDC can be added later as another
// sign-in method behind it. This implementation is credential (e-mail + argon2id) sign-in with opaque server sessions
// stored hashed in `identity.sessions`; the BFF keeps the token in an httpOnly cookie and never exposes it to browser JS.

export const SESSION_IDLE_MS = 12 * 3600 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 3600 * 1000;
export const SETUP_TOKEN_TTL_MS = 24 * 3600 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ClientContext {
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  traceId?: string | undefined;
  /** The caller's current session token (BFF sends it when the browser already has one): revoked when a new session is issued. */
  previousToken?: string | undefined;
}

export interface SessionIssued {
  /** Opaque session token. Only the BFF ever sees it; it is never in a response body. */
  token: string;
  maxAgeSeconds: number;
  user: { id: string; email: string; displayName: string | null };
  tenantId: string;
}

export interface SessionPrincipal {
  sessionId: string;
  userId: string;
  tenantId: string;
}

export interface IdentityServiceDeps {
  db: Database;
  audit: AuditWriter;
  tenancy: TenancyService;
  limiter?: LoginLimiter;
  now?: () => Date;
}

export function identityService(deps: IdentityServiceDeps) {
  const repo = authRepository(deps.db);
  const limiter = deps.limiter ?? createLoginLimiter();
  const now = deps.now ?? (() => new Date());

  async function issueSession(
    user: UserRow,
    tenantId: string,
    ctx: ClientContext,
  ): Promise<SessionIssued> {
    const token = newOpaqueToken();
    await repo.createSession({
      userId: user.id,
      tokenHash: sha256(token),
      activeTenantId: tenantId,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      idleMs: SESSION_IDLE_MS,
      absoluteMs: SESSION_ABSOLUTE_MS,
    });
    await repo.touchSignIn(user.id);
    if (ctx.previousToken) await repo.revokeSessionByHash(sha256(ctx.previousToken)); // one browser, one live session
    return {
      token,
      maxAgeSeconds: SESSION_ABSOLUTE_MS / 1000,
      user: { id: user.id, email: user.email, displayName: user.displayName },
      tenantId,
    };
  }

  const validateCredentials = (email: string, password: string): FieldError[] => {
    const errors: FieldError[] = [];
    if (!EMAIL_RE.test(email.trim()) || email.length > 254)
      errors.push({ path: "/email", code: "invalid_email" });
    const problem = passwordProblem(password, email);
    if (problem) errors.push({ path: "/password", code: problem });
    return errors;
  };

  return {
    /** Operator action (CLI): a one-time token that lets the first Owner of a tenant register. Shown once. */
    async createSetupToken(): Promise<{ token: string; expiresAt: Date }> {
      const token = newOpaqueToken();
      await repo.createOneTimeToken({
        purpose: "setup",
        identifier: "setup",
        tokenHash: sha256(token),
        ttlMs: SETUP_TOKEN_TTL_MS,
      });
      return { token, expiresAt: new Date(now().getTime() + SETUP_TOKEN_TTL_MS) };
    },

    /** Setup token -> user + tenant + Owner grant + session. There is no default admin and no open sign-up. */
    async setup(
      input: {
        setupToken: string;
        email: string;
        password: string;
        displayName?: string | null;
        tenantName: string;
      },
      ctx: ClientContext = {},
    ): Promise<SessionIssued> {
      const errors = validateCredentials(input.email, input.password);
      if (input.tenantName.trim().length < 1 || input.tenantName.length > 120)
        errors.push({ path: "/tenantName", code: "length", meta: { min: 1, max: 120 } });
      if (errors.length) throw validationFailed(errors);

      const tokenHash = sha256(input.setupToken);
      if (!(await repo.consumeOneTimeToken("setup", tokenHash)))
        throw new DomainError(
          "forbidden",
          "setup_token_invalid",
          "The setup token is invalid, used or expired",
        );
      let userId: string | null = null;
      try {
        const passwordHash = await hashPassword(input.password);
        try {
          userId = await repo.createCredentialUser({
            email: input.email,
            displayName: input.displayName?.trim() || null,
            passwordHash,
            emailVerified: true,
          });
        } catch (e) {
          if ((e as { code?: string }).code === "23505")
            throw new DomainError(
              "conflict",
              "email_taken",
              "An account with that e-mail already exists",
            );
          throw e;
        }
        const { tenantId } = await deps.tenancy.createTenantWithOwner({
          userId,
          email: input.email.trim(),
          tenantName: input.tenantName,
          ip: ctx.ip ?? null,
          traceId: ctx.traceId,
        });
        const user = (await repo.findUserById(userId))!;
        const session = await issueSession(user, tenantId, ctx);
        await deps.audit.write(
          { tenantId, userId },
          {
            action: "auth.login",
            actorLabel: user.email,
            details: { method: "setup" },
            ipAddress: ctx.ip ?? null,
            traceId: ctx.traceId ?? null,
          },
        );
        return session;
      } catch (e) {
        // Give the operator their token back and leave no half-created user behind.
        if (userId) await repo.deleteUser(userId).catch(() => undefined);
        await repo.restoreOneTimeToken(tokenHash).catch(() => undefined);
        throw e;
      }
    },

    async signIn(
      input: { email: string; password: string },
      ctx: ClientContext = {},
    ): Promise<SessionIssued> {
      const user = await checkCredentials(input.email, input.password, ctx);
      const memberships = await deps.tenancy.listUserMemberships(user.id);
      if (!memberships.length)
        throw new DomainError(
          "forbidden",
          "no_active_membership",
          "Your account is not a member of any active tenant",
        );
      limiter.success(input.email.trim());
      const session = await issueSession(user, memberships[0]!.tenantId, ctx);
      await deps.audit.write(
        { tenantId: session.tenantId, userId: user.id },
        {
          action: "auth.login",
          actorLabel: user.email,
          ipAddress: ctx.ip ?? null,
          traceId: ctx.traceId ?? null,
        },
      );
      return session;
    },

    async signOut(token: string, ctx: ClientContext = {}): Promise<void> {
      const session = await repo.findLiveSession(sha256(token));
      await repo.revokeSessionByHash(sha256(token));
      if (!session?.activeTenantId) return;
      const user = await repo.findUserById(session.userId);
      await deps.audit.write(
        { tenantId: session.activeTenantId, userId: session.userId },
        {
          action: "auth.logout",
          actorLabel: user?.email ?? null,
          ipAddress: ctx.ip ?? null,
          traceId: ctx.traceId ?? null,
        },
      );
    },

    /**
     * Resolves a session token to the user and an ACTIVE tenant. The tenant the session points at is used while the
     * membership is still active, otherwise the first active membership. Null = not signed in (answered 401).
     */
    async resolveSession(token: string): Promise<SessionPrincipal | null> {
      const session = await repo.findLiveSession(sha256(token));
      if (!session) return null;
      const memberships = await deps.tenancy.listUserMemberships(session.userId);
      if (!memberships.length) return null;
      const active =
        memberships.find((m) => m.tenantId === session.activeTenantId) ?? memberships[0]!;
      if (active.tenantId !== session.activeTenantId)
        await repo.setActiveTenant(session.id, active.tenantId);
      await repo.touchSession(session.id, SESSION_IDLE_MS);
      return { sessionId: session.id, userId: session.userId, tenantId: active.tenantId };
    },

    /** Switches the active tenant and rotates the token (privilege change, ADR-0004). */
    async switchTenant(
      current: { token: string; userId: string },
      tenantId: string,
      ctx: ClientContext = {},
    ): Promise<SessionIssued> {
      const memberships = await deps.tenancy.listUserMemberships(current.userId);
      if (!memberships.some((m) => m.tenantId === tenantId))
        throw new DomainError("not_found", "not_found", "tenant not found");
      const user = (await repo.findUserById(current.userId))!;
      await repo.revokeSessionByHash(sha256(current.token));
      return issueSession(user, tenantId, ctx);
    },

    revokeUserSessions: (userId: string) => repo.revokeUserSessions(userId),

    // --- invitations ---------------------------------------------------------------------------------------------
    previewInvitation: (token: string) => deps.tenancy.previewInvitation(token),

    /** A new person accepts an invitation: creates the account for the invited e-mail, joins, signs in. */
    async acceptInvitationNewUser(
      input: { token: string; password: string; displayName?: string | null },
      ctx: ClientContext = {},
    ): Promise<SessionIssued> {
      const preview = await deps.tenancy.previewInvitation(input.token);
      if (preview.accountExists)
        throw new DomainError(
          "conflict",
          "account_exists",
          "An account with this e-mail exists - sign in to accept",
        );
      const problem = passwordProblem(input.password, preview.email);
      if (problem) throw validationFailed([{ path: "/password", code: problem }]);
      let userId: string;
      try {
        userId = await repo.createCredentialUser({
          email: preview.email,
          displayName: input.displayName?.trim() || null,
          passwordHash: await hashPassword(input.password),
          emailVerified: true, // the invitation link proves control of the mailbox
        });
      } catch (e) {
        if ((e as { code?: string }).code === "23505")
          throw new DomainError(
            "conflict",
            "account_exists",
            "An account with this e-mail exists - sign in to accept",
          );
        throw e;
      }
      const user = (await repo.findUserById(userId))!;
      let tenantId: string;
      try {
        ({ tenantId } = await deps.tenancy.acceptInvitation(
          input.token,
          { id: userId, email: user.email },
          { ip: ctx.ip, traceId: ctx.traceId },
        ));
      } catch (e) {
        await repo.deleteUser(userId).catch(() => undefined); // no half-created account (review M3)
        throw e;
      }
      const session = await issueSession(user, tenantId, ctx);
      await deps.audit.write(
        { tenantId, userId },
        {
          action: "auth.login",
          actorLabel: user.email,
          details: { method: "invitation" },
          ipAddress: ctx.ip ?? null,
          traceId: ctx.traceId ?? null,
        },
      );
      return session;
    },

    /**
     * An existing account accepts an invitation with its password in ONE call. Unlike sign-in this works for a user who
     * currently belongs to no tenant (removed earlier, then re-invited - review M3).
     */
    async acceptInvitationWithPassword(
      input: { token: string; password: string },
      ctx: ClientContext = {},
    ): Promise<SessionIssued> {
      const preview = await deps.tenancy.previewInvitation(input.token);
      if (!preview.accountExists)
        throw new DomainError(
          "conflict",
          "account_missing",
          "No account exists for this e-mail - register instead",
        );
      const user = await checkCredentials(preview.email, input.password, ctx);
      const { tenantId } = await deps.tenancy.acceptInvitation(
        input.token,
        { id: user.id, email: user.email },
        { ip: ctx.ip, traceId: ctx.traceId },
      );
      limiter.success(preview.email);
      const session = await issueSession(user, tenantId, ctx);
      await deps.audit.write(
        { tenantId, userId: user.id },
        {
          action: "auth.login",
          actorLabel: user.email,
          details: { method: "invitation" },
          ipAddress: ctx.ip ?? null,
          traceId: ctx.traceId ?? null,
        },
      );
      return session;
    },

    /** A signed-in user accepts an invitation addressed to their e-mail; the session moves to that tenant. */
    async acceptInvitationSignedIn(
      current: { token: string; userId: string },
      inviteToken: string,
      ctx: ClientContext = {},
    ): Promise<SessionIssued> {
      const user = (await repo.findUserById(current.userId))!;
      const { tenantId } = await deps.tenancy.acceptInvitation(
        inviteToken,
        { id: user.id, email: user.email },
        { ip: ctx.ip, traceId: ctx.traceId },
      );
      await repo.revokeSessionByHash(sha256(current.token));
      return issueSession(user, tenantId, ctx);
    },
  };

  /**
   * E-mail + password check shared by sign-in and "accept invitation with my password": reserves a throttle slot BEFORE any
   * work, verifies against a dummy hash for unknown users (same answer, same cost), audits failures of known users.
   */
  async function checkCredentials(emailRaw: string, password: string, ctx: ClientContext) {
    const email = emailRaw.trim();
    const wait = limiter.reserve(email, ctx.ip ?? null);
    if (wait > 0)
      throw new DomainError(
        "rate_limited",
        "too_many_attempts",
        "Too many failed attempts. Try again later.",
        [],
        { retryAfterSeconds: Math.ceil(wait / 1000) },
      );
    const user = EMAIL_RE.test(email) ? await repo.findUserByEmail(email) : null;
    const stored = user && !user.disabledAt ? user.passwordHash : null;
    const valid = await verifyPassword(stored ?? (await dummyHash()), password);
    if (!user || !stored || !valid) {
      if (user) await auditFailure(user, ctx);
      throw new DomainError(
        "unauthenticated",
        "invalid_credentials",
        "E-mail or password is incorrect",
      );
    }
    return user;
  }

  async function auditFailure(user: UserRow, ctx: ClientContext): Promise<void> {
    const memberships = await deps.tenancy.listUserMemberships(user.id).catch(() => []);
    for (const m of memberships) {
      await deps.audit
        .write(
          { tenantId: m.tenantId, userId: user.id },
          {
            action: "auth.login_failed",
            outcome: "failure",
            actorLabel: user.email,
            ipAddress: ctx.ip ?? null,
            traceId: ctx.traceId ?? null,
          },
        )
        .catch(() => undefined);
    }
  }
}

export type IdentityService = ReturnType<typeof identityService>;
