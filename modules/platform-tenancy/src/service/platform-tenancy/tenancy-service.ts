import { createHash, randomBytes } from "node:crypto";
import {
  DomainError,
  ROLES,
  uuidv7,
  validationFailed,
  type FieldError,
  type Role,
  type Scope,
} from "@seller-hub/core";
import { withScope, type Database } from "@seller-hub/db";
import type { AuditWriter } from "@seller-hub/mod-platform-audit";
import { sql } from "kysely";
import {
  effectiveRoles,
  permissionsFor,
  topRole,
  visibleSellerAccountIds,
  type Grant,
} from "../../access";
import { refRepository } from "../../repository/platform-tenancy/ref-repository";
import { tenancyRepository } from "../../repository/platform-tenancy/tenancy-repository";
import { INVITABLE_ROLES, userScope, type InvitableRole, type SellerAccountRow } from "../../types";

// Business rules of tenancy: who may change whom, the last-owner rule, invitation lifecycle, seller accounts,
// preferences. Statements run in the repository; audit rows are written in the same transaction as the change.

export const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PREF_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const MAX_PREF_BYTES = 16 * 1024;
const REGIONS = ["NA", "EU", "FE"] as const;

export const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest();
export const newToken = (): string => randomBytes(32).toString("base64url");
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export interface ActorContext {
  scope: Scope; // { tenantId, userId }
  email?: string | undefined;
  ip?: string | null | undefined;
  traceId?: string | undefined;
}

export interface TenancyServiceDeps {
  db: Database;
  audit: AuditWriter;
  permissionMatrix: ReadonlyMap<string, ReadonlySet<Role>>;
  webPublicUrl: string;
  onPrivilegeChange?: ((userId: string) => Promise<void>) | undefined;
  now?: (() => Date) | undefined;
}

export interface GrantInput {
  role: Role;
  sellerAccountId: string | null;
}

export function tenancyService(deps: TenancyServiceDeps) {
  const repo = tenancyRepository(deps.db);
  const refRepo = refRepository(deps.db);
  const now = deps.now ?? (() => new Date());
  const actor = (a: ActorContext) => ({
    actorUserId: a.scope.userId ?? null,
    actorLabel: a.email ?? null,
    ipAddress: a.ip ?? null,
    traceId: a.traceId ?? null,
  });

  async function accountExists(scope: Scope, id: string): Promise<boolean> {
    return (await repo.getSellerAccount(scope, id)) !== null;
  }

  return {
    // --- access resolution (used by the authenticator) -------------------------------------------------------
    /**
     * Roles and scope of `userId` in `tenantId` for a seller account (or tenant level). Null when the user is not an
     * active member, the tenant is suspended, or the account is not in the tenant / not visible to the user - the
     * caller answers 404, so another tenant's ids are indistinguishable from missing ones (conventions §3).
     */
    async access(userId: string, tenantId: string, sellerAccountId: string | null) {
      const scope: Scope = { tenantId, userId };
      const tenant = await repo.getTenant(scope);
      if (!tenant || tenant.status !== "active") return null;
      const grants = await repo.listGrantsForUser(scope, userId);
      if (grants.length === 0) return null;
      if (sellerAccountId === null) {
        const roles = effectiveRoles(grants, null);
        return roles.length ? { scope, roles } : null;
      }
      if (!(await accountExists(scope, sellerAccountId))) return null;
      const roles = effectiveRoles(grants, sellerAccountId);
      if (!roles.length) return null;
      return { scope: { tenantId, userId, sellerAccountId } as Scope, roles };
    },

    /** Does the user hold `permission` on this seller account (or tenant-wide when null)? */
    async can(
      userId: string,
      tenantId: string,
      sellerAccountId: string | null,
      permission: string,
    ): Promise<boolean> {
      const access = await this.access(userId, tenantId, sellerAccountId);
      return !!access && permissionsFor(access.roles, deps.permissionMatrix).includes(permission);
    },

    async listUserMemberships(userId: string) {
      return (await repo.listUserMemberships(userScope(userId))).filter(
        (m) => m.status === "active" && m.tenantStatus === "active",
      );
    },

    // --- /v1/me ----------------------------------------------------------------------------------------------
    async getMe(scope: Scope) {
      const userId = scope.userId;
      if (!userId)
        throw new DomainError("unauthenticated", "unauthenticated", "Sign in to continue");
      const [profile, tenant, memberships, grants, accounts] = await Promise.all([
        repo.getUserProfile(scope),
        repo.getTenant(scope),
        repo.listUserMemberships(userScope(userId)),
        repo.listGrantsForUser(scope, userId),
        repo.listSellerAccounts(scope),
      ]);
      if (!profile || !tenant)
        throw new DomainError("unauthenticated", "unauthenticated", "Sign in to continue");
      const tenantRoles = effectiveRoles(grants, null);
      const visible = new Set(
        visibleSellerAccountIds(
          grants,
          accounts.map((a) => a.id),
        ),
      );
      return {
        user: profile,
        tenant: { id: tenant.id, name: tenant.name, requireTwoFactor: tenant.requireTwoFactor },
        tenants: memberships
          .filter((m) => m.status === "active" && m.tenantStatus === "active")
          .map((m) => ({ id: m.tenantId, name: m.tenantName })),
        roles: tenantRoles,
        permissions: permissionsFor(tenantRoles, deps.permissionMatrix),
        sellerAccounts: accounts
          .filter((a) => visible.has(a.id))
          .map((a) => {
            const roles = effectiveRoles(grants, a.id);
            return {
              id: a.id,
              name: a.name,
              regionCode: a.regionCode,
              accountType: a.accountType,
              status: a.status,
              roles,
              permissions: permissionsFor(roles, deps.permissionMatrix),
            };
          }),
      };
    },

    // --- preferences ------------------------------------------------------------------------------------------
    async getPreference(scope: Scope, key: string) {
      assertPrefKey(key);
      const value = await repo.getPreference(scope, requireUser(scope), key);
      if (value === null) throw new DomainError("not_found", "not_found", "preference not found");
      return { key, value };
    },
    async putPreference(scope: Scope, key: string, value: unknown) {
      assertPrefKey(key);
      if (value === null || typeof value !== "object")
        throw validationFailed([{ path: "/value", code: "must_be_object" }]);
      if (Buffer.byteLength(JSON.stringify(value)) > MAX_PREF_BYTES)
        throw validationFailed([
          { path: "/value", code: "too_large", meta: { maxBytes: MAX_PREF_BYTES } },
        ]);
      await repo.putPreference(scope, requireUser(scope), key, value);
      return { key, value };
    },
    async deletePreference(scope: Scope, key: string) {
      assertPrefKey(key);
      await repo.deletePreference(scope, requireUser(scope), key);
    },

    // --- members ----------------------------------------------------------------------------------------------
    async listMembers(scope: Scope) {
      const members = await repo.listMembers(scope);
      const out = [];
      for (const m of members) {
        const grants = await repo.listGrants(scope, m.membershipId);
        out.push({
          ...m,
          grants: grants.map(({ role, sellerAccountId }) => ({ role, sellerAccountId })),
        });
      }
      return out;
    },

    async setMemberRoles(a: ActorContext, membershipId: string, input: GrantInput[]) {
      const scope = a.scope;
      const errors = await validateGrants(scope, input);
      if (errors.length) throw validationFailed(errors);
      const grants = dedupeGrants(input);
      let affectedUserId = "";
      let before: GrantInput[] = [];
      await withScope(deps.db, scope, async (trx) => {
        await repo.lockTenant(scope, trx);
        const members = await repo.listMembers(scope, trx);
        const target = members.find((m) => m.membershipId === membershipId);
        if (!target) throw new DomainError("not_found", "not_found", "member not found");
        affectedUserId = target.userId;
        const actorGrants = await repo.listGrantsForUser(scope, a.scope.userId!, trx);
        const targetGrants = await repo.listGrants(scope, membershipId, trx);
        before = targetGrants.map(({ role, sellerAccountId }) => ({ role, sellerAccountId }));
        assertMayChange(topRole(actorGrants), targetGrants, grants);
        await repo.replaceGrants(scope, membershipId, grants, a.scope.userId ?? null, trx);
        if ((await repo.countOwners(scope, trx)) < 1)
          throw new DomainError("conflict", "last_owner", "A tenant needs at least one owner");
        await deps.audit.writeIn(trx, scope, {
          action: "member.roles_changed",
          targetType: "membership",
          targetId: membershipId,
          details: { before, after: grants },
          ...actor(a),
        });
      });
      await deps.onPrivilegeChange?.(affectedUserId);
      return { membershipId, grants };
    },

    async removeMember(a: ActorContext, membershipId: string) {
      const scope = a.scope;
      let affectedUserId = "";
      await withScope(deps.db, scope, async (trx) => {
        await repo.lockTenant(scope, trx);
        const members = await repo.listMembers(scope, trx);
        const target = members.find((m) => m.membershipId === membershipId);
        if (!target) throw new DomainError("not_found", "not_found", "member not found");
        affectedUserId = target.userId;
        const actorGrants = await repo.listGrantsForUser(scope, a.scope.userId!, trx);
        const targetGrants = await repo.listGrants(scope, membershipId, trx);
        assertMayChange(topRole(actorGrants), targetGrants, []);
        await repo.deleteMembership(scope, membershipId, trx);
        if ((await repo.countOwners(scope, trx)) < 1)
          throw new DomainError("conflict", "last_owner", "A tenant needs at least one owner");
        await deps.audit.writeIn(trx, scope, {
          action: "member.removed",
          targetType: "membership",
          targetId: membershipId,
          details: { roles: targetGrants.map((g) => g.role) },
          ...actor(a),
        });
      });
      await deps.onPrivilegeChange?.(affectedUserId);
    },

    // --- invitations ------------------------------------------------------------------------------------------
    async listInvitations(scope: Scope) {
      return repo.listInvitations(scope);
    },

    async createInvitation(
      a: ActorContext,
      input: { email: string; role: string; sellerAccountId?: string | null | undefined },
    ) {
      const scope = a.scope;
      const email = input.email.trim();
      const errors: FieldError[] = [];
      if (!EMAIL_RE.test(email) || email.length > 254)
        errors.push({ path: "/email", code: "invalid_email" });
      if (!(INVITABLE_ROLES as readonly string[]).includes(input.role))
        errors.push({
          path: "/role",
          code: "role_not_invitable",
          meta: { allowed: [...INVITABLE_ROLES] },
        });
      const sellerAccountId = input.sellerAccountId ?? null;
      if (sellerAccountId && !(await accountExists(scope, sellerAccountId)))
        errors.push({ path: "/sellerAccountId", code: "unknown_seller_account" });
      if (errors.length) throw validationFailed(errors);

      const token = newToken();
      const expiresAt = new Date(now().getTime() + INVITATION_TTL_MS);
      const id = await withScope(deps.db, scope, async (trx) => {
        const existing = await sql<{ id: string }>`
          select m.id from core.memberships m join identity.users u on u.id = m.user_id
           where m.tenant_id = ${scope.tenantId} and u.email_normalized = ${normalizeEmail(email)}`.execute(
          trx,
        );
        if (existing.rows.length)
          throw new DomainError("conflict", "already_member", "That person is already a member");
        await repo.revokeOpenInvitationsFor(scope, email, trx);
        const invitationId = await repo.createInvitation(
          scope,
          {
            email,
            role: input.role as InvitableRole,
            sellerAccountId,
            tokenHash: hashToken(token),
            expiresAt,
            invitedBy: a.scope.userId ?? null,
          },
          trx,
        );
        await deps.audit.writeIn(trx, scope, {
          action: "member.invited",
          targetType: "invitation",
          targetId: invitationId,
          details: { role: input.role, sellerAccountId },
          ...actor(a),
        });
        return invitationId;
      });
      const invitation = await repo.getInvitation(scope, id);
      // SMTP is not wired (ADR-0004: "if unset, the inviter copies the link"): the link is returned exactly once.
      const link = `${deps.webPublicUrl.replace(/\/$/, "")}/accept-invitation#token=${token}`;
      return { invitation: invitation!, token, link };
    },

    async revokeInvitation(a: ActorContext, id: string) {
      const scope = a.scope;
      await withScope(deps.db, scope, async (trx) => {
        if (!(await repo.revokeInvitation(scope, id, trx)))
          throw new DomainError("not_found", "not_found", "open invitation not found");
        await deps.audit.writeIn(trx, scope, {
          action: "member.invitation_revoked",
          targetType: "invitation",
          targetId: id,
          ...actor(a),
        });
      });
    },

    /** Preview for the accept page: who the invitation is for. No tenant data beyond the role. */
    async previewInvitation(token: string) {
      const inv = await findOpenInvitation(deps.db, hashToken(token));
      if (!inv)
        throw new DomainError(
          "not_found",
          "invitation_invalid",
          "This invitation is invalid or expired",
        );
      const user = await sql<{
        id: string;
      }>`select id from identity.users where email_normalized = ${inv.emailNormalized}`.execute(
        deps.db,
      );
      return { email: inv.emailNormalized, role: inv.role, accountExists: user.rows.length > 0 };
    },

    /**
     * Accepts an invitation for an existing user (`userId`, whose e-mail must match). Creates the membership and the
     * grant and closes the invitation in one transaction; writes the audit row.
     */
    async acceptInvitation(
      token: string,
      user: { id: string; email: string },
      ctx: { ip?: string | null | undefined; traceId?: string | undefined } = {},
    ) {
      const inv = await findOpenInvitation(deps.db, hashToken(token));
      if (!inv)
        throw new DomainError(
          "not_found",
          "invitation_invalid",
          "This invitation is invalid or expired",
        );
      if (normalizeEmail(user.email) !== inv.emailNormalized)
        throw new DomainError(
          "forbidden",
          "invitation_email_mismatch",
          "This invitation was sent to another e-mail address",
        );
      const scope: Scope = { tenantId: inv.tenantId, userId: user.id };
      await withScope(deps.db, scope, async (trx) => {
        if (await repo.findMembershipByUser(scope, user.id, trx))
          throw new DomainError(
            "conflict",
            "already_member",
            "You are already a member of this tenant",
          );
        const membershipId = await repo.createMembership(scope, user.id, trx);
        await repo.replaceGrants(
          scope,
          membershipId,
          [{ role: inv.role, sellerAccountId: inv.sellerAccountId }],
          null,
          trx,
        );
        if (!(await repo.markInvitationAccepted(scope, inv.id, user.id, trx)))
          throw new DomainError(
            "not_found",
            "invitation_invalid",
            "This invitation is invalid or expired",
          );
        await deps.audit.writeIn(trx, scope, {
          action: "member.joined",
          targetType: "membership",
          targetId: membershipId,
          actorLabel: user.email,
          details: { role: inv.role, sellerAccountId: inv.sellerAccountId, invitationId: inv.id },
          ipAddress: ctx.ip ?? null,
          traceId: ctx.traceId ?? null,
        });
      });
      return { tenantId: inv.tenantId, role: inv.role };
    },

    // --- tenants and seller accounts ---------------------------------------------------------------------------
    /** First Owner of a new tenant (setup token flow). */
    async createTenantWithOwner(input: {
      userId: string;
      email: string;
      tenantName: string;
      ip?: string | null | undefined;
      traceId?: string | undefined;
    }) {
      const name = input.tenantName.trim();
      if (name.length < 1 || name.length > 120)
        throw validationFailed([
          { path: "/tenantName", code: "length", meta: { min: 1, max: 120 } },
        ]);
      const tenantId = uuidv7();
      const scope: Scope = { tenantId, userId: input.userId };
      await withScope(deps.db, scope, async (trx) => {
        await repo.createTenant(scope, name, trx);
        const membershipId = await repo.createMembership(scope, input.userId, trx);
        await repo.replaceGrants(
          scope,
          membershipId,
          [{ role: "owner", sellerAccountId: null }],
          null,
          trx,
        );
        await deps.audit.writeIn(trx, scope, {
          action: "tenant.created",
          targetType: "tenant",
          targetId: tenantId,
          actorLabel: input.email,
          details: { name },
          ipAddress: input.ip ?? null,
          traceId: input.traceId ?? null,
        });
      });
      return { tenantId };
    },

    async listSellerAccounts(scope: Scope): Promise<SellerAccountRow[]> {
      const all = await repo.listSellerAccounts(scope);
      const grants = await repo.listGrantsForUser(scope, requireUser(scope));
      const visible = new Set(
        visibleSellerAccountIds(
          grants,
          all.map((x) => x.id),
        ),
      );
      return all.filter((x) => visible.has(x.id));
    },

    async getSellerAccount(scope: Scope, id: string): Promise<SellerAccountRow> {
      const row = await repo.getSellerAccount(scope, id);
      if (!row) throw new DomainError("not_found", "not_found", "seller account not found");
      return row;
    },

    async createSellerAccount(
      a: ActorContext,
      input: { name: string; regionCode: string; accountType?: "seller" | "vendor" | undefined },
    ) {
      const name = input.name.trim();
      const errors: FieldError[] = [];
      if (name.length < 1 || name.length > 120)
        errors.push({ path: "/name", code: "length", meta: { min: 1, max: 120 } });
      if (!(REGIONS as readonly string[]).includes(input.regionCode))
        errors.push({
          path: "/regionCode",
          code: "unknown_region",
          meta: { allowed: [...REGIONS] },
        });
      if (errors.length) throw validationFailed(errors);
      const id = await withScope(deps.db, a.scope, async (trx) => {
        const created = await repo.createSellerAccount(
          a.scope,
          { name, regionCode: input.regionCode, accountType: input.accountType ?? "seller" },
          trx,
        );
        await deps.audit.writeIn(trx, a.scope, {
          action: "seller_account.created",
          sellerAccountId: created,
          targetType: "seller_account",
          targetId: created,
          details: {
            name,
            regionCode: input.regionCode,
            accountType: input.accountType ?? "seller",
          },
          ...actor(a),
        });
        return created;
      });
      return (await repo.getSellerAccount(a.scope, id))!;
    },

    async listAccountMarketplaces(scope: Scope, sellerAccountId: string) {
      return repo.listAccountMarketplaces(scope, sellerAccountId);
    },

    // --- reference data (global) --------------------------------------------------------------------------------
    listMarketplaces: () => refRepo.listMarketplaces(),
    listAdsLimits: (marketplaceId?: string) => refRepo.listAdsLimits(marketplaceId),
  };

  // --- helpers that need the closure -----------------------------------------------------------------------------
  async function validateGrants(scope: Scope, input: GrantInput[]): Promise<FieldError[]> {
    const errors: FieldError[] = [];
    if (input.length < 1) errors.push({ path: "/grants", code: "required" });
    for (const [i, g] of input.entries()) {
      if (!(ROLES as readonly string[]).includes(g.role))
        errors.push({ path: `/grants/${i}/role`, code: "unknown_role" });
      if (g.sellerAccountId && !(await accountExists(scope, g.sellerAccountId)))
        errors.push({ path: `/grants/${i}/sellerAccountId`, code: "unknown_seller_account" });
    }
    return errors;
  }
}

function dedupeGrants(input: GrantInput[]): GrantInput[] {
  const seen = new Set<string>();
  return input.filter((g) => {
    const k = `${g.role}|${g.sellerAccountId ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Who may change whom (D55 a): only an Owner may grant, keep or remove the owner role, or change a member who
 * holds it; everyone else with `members.manage` (Admin) manages the other roles.
 */
function assertMayChange(
  actorTop: Role | null,
  targetGrants: readonly Grant[],
  newGrants: readonly GrantInput[],
): void {
  if (actorTop === "owner") return;
  const touchesOwner =
    targetGrants.some((g) => g.role === "owner") || newGrants.some((g) => g.role === "owner");
  if (touchesOwner)
    throw new DomainError("forbidden", "owner_required", "Only an owner can change owner access");
  if (actorTop === null)
    throw new DomainError("forbidden", "forbidden", "You do not have permission for this action");
}

function assertPrefKey(key: string): void {
  if (!PREF_KEY_RE.test(key)) throw validationFailed([{ path: "/key", code: "invalid_key" }]);
}

function requireUser(scope: Scope): string {
  if (!scope.userId)
    throw new DomainError("unauthenticated", "unauthenticated", "Sign in to continue");
  return scope.userId;
}

interface OpenInvitation {
  id: string;
  tenantId: string;
  emailNormalized: string;
  role: InvitableRole;
  sellerAccountId: string | null;
}

/**
 * The one lookup that happens before a tenant scope exists: a SECURITY DEFINER function (db/design/03_core.sql) that
 * matches the token hash and returns only the invitation. Deliberately takes no Scope.
 */
async function findOpenInvitation(db: Database, tokenHash: Buffer): Promise<OpenInvitation | null> {
  const { rows } = await sql<{
    id: string;
    tenant_id: string;
    email_normalized: string;
    role: InvitableRole;
    seller_account_id: string | null;
  }>`select id, tenant_id, email_normalized, role, seller_account_id from core.find_open_invitation(${tokenHash})`.execute(
    db,
  );
  const r = rows[0];
  return r
    ? {
        id: r.id,
        tenantId: r.tenant_id,
        emailNormalized: r.email_normalized,
        role: r.role,
        sellerAccountId: r.seller_account_id,
      }
    : null;
}

export type TenancyService = ReturnType<typeof tenancyService>;
