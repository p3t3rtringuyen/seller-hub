import { uuidv7 } from "@seller-hub/core";
import type { Database } from "@seller-hub/db";
import { sql } from "kysely";

// Repository for `identity.*` (users, sign-in methods, sessions, one-time tokens). These tables are GLOBAL (no tenant,
// no RLS - db/design/02_identity.sql), so the functions take ids instead of a Scope; they are only reachable through
// this module. Secrets (password hashes, token hashes) never leave it except as the hash a verifier needs.

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

export interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  locale: string;
  disabledAt: string | null;
}

export interface SessionRow {
  id: string;
  userId: string;
  activeTenantId: string | null;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  lastSeenAt: string;
}

export function authRepository(db: Database) {
  return {
    async findUserByEmail(
      email: string,
    ): Promise<(UserRow & { passwordHash: string | null }) | null> {
      const { rows } = await sql<{
        id: string;
        email: string;
        display_name: string | null;
        locale: string;
        disabled_at: Date | null;
        password_hash: string | null;
      }>`select u.id, u.email, u.display_name, u.locale, u.disabled_at, a.password_hash
           from identity.users u
           left join identity.auth_accounts a on a.user_id = u.id and a.provider = 'credential'
          where u.email_normalized = lower(${email})`.execute(db);
      const r = rows[0];
      return r
        ? {
            id: r.id,
            email: r.email,
            displayName: r.display_name,
            locale: r.locale,
            disabledAt: r.disabled_at ? iso(r.disabled_at) : null,
            passwordHash: r.password_hash,
          }
        : null;
    },

    async findUserById(id: string): Promise<UserRow | null> {
      const { rows } = await sql<{
        id: string;
        email: string;
        display_name: string | null;
        locale: string;
        disabled_at: Date | null;
      }>`select id, email, display_name, locale, disabled_at from identity.users where id = ${id}`.execute(
        db,
      );
      const r = rows[0];
      return r
        ? {
            id: r.id,
            email: r.email,
            displayName: r.display_name,
            locale: r.locale,
            disabledAt: r.disabled_at ? iso(r.disabled_at) : null,
          }
        : null;
    },

    /** Creates a user with a credential sign-in method. Throws a unique violation if the e-mail exists. */
    async createCredentialUser(input: {
      email: string;
      displayName: string | null;
      passwordHash: string;
      emailVerified: boolean;
    }): Promise<string> {
      const id = uuidv7();
      await db.transaction().execute(async (trx) => {
        await sql`insert into identity.users (id, email, display_name, email_verified_at)
                  values (${id}, ${input.email.trim()}, ${input.displayName},
                          ${input.emailVerified ? sql`now()` : null})`.execute(trx);
        await sql`insert into identity.auth_accounts (id, user_id, provider, provider_account_id, password_hash)
                  values (${uuidv7()}, ${id}, 'credential', ${input.email.trim().toLowerCase()}, ${input.passwordHash})`.execute(
          trx,
        );
      });
      return id;
    },

    async deleteUser(id: string): Promise<void> {
      await sql`delete from identity.users where id = ${id}`.execute(db);
    },

    async touchSignIn(userId: string): Promise<void> {
      await sql`update identity.users set last_sign_in_at = now() where id = ${userId}`.execute(db);
    },

    // --- sessions ------------------------------------------------------------------------------------------
    async createSession(input: {
      userId: string;
      tokenHash: Buffer;
      activeTenantId: string | null;
      ip: string | null;
      userAgent: string | null;
      idleMs: number;
      absoluteMs: number;
    }): Promise<{ id: string; idleExpiresAt: string; absoluteExpiresAt: string }> {
      const id = uuidv7();
      const { rows } = await sql<{ idle_expires_at: Date; absolute_expires_at: Date }>`
        insert into identity.sessions
          (id, user_id, token_hash, active_tenant_id, ip_address, user_agent, idle_expires_at, absolute_expires_at)
        values (${id}, ${input.userId}, ${input.tokenHash}, ${input.activeTenantId}, ${input.ip}::inet,
                ${input.userAgent?.slice(0, 300) ?? null},
                now() + ${input.idleMs / 1000} * interval '1 second',
                now() + ${input.absoluteMs / 1000} * interval '1 second')
        returning idle_expires_at, absolute_expires_at`.execute(db);
      return {
        id,
        idleExpiresAt: iso(rows[0]!.idle_expires_at),
        absoluteExpiresAt: iso(rows[0]!.absolute_expires_at),
      };
    },

    /** Live session by token hash: not revoked, not idle- or absolute-expired, user not disabled. */
    async findLiveSession(tokenHash: Buffer): Promise<SessionRow | null> {
      const { rows } = await sql<{
        id: string;
        user_id: string;
        active_tenant_id: string | null;
        idle_expires_at: Date;
        absolute_expires_at: Date;
        last_seen_at: Date;
      }>`select s.id, s.user_id, s.active_tenant_id, s.idle_expires_at, s.absolute_expires_at, s.last_seen_at
           from identity.sessions s join identity.users u on u.id = s.user_id
          where s.token_hash = ${tokenHash} and s.revoked_at is null
            and s.idle_expires_at > now() and s.absolute_expires_at > now() and u.disabled_at is null`.execute(
        db,
      );
      const r = rows[0];
      return r
        ? {
            id: r.id,
            userId: r.user_id,
            activeTenantId: r.active_tenant_id,
            idleExpiresAt: iso(r.idle_expires_at),
            absoluteExpiresAt: iso(r.absolute_expires_at),
            lastSeenAt: iso(r.last_seen_at),
          }
        : null;
    },

    /** Slides the idle window (at most once a minute per session; the update is skipped otherwise). */
    async touchSession(id: string, idleMs: number): Promise<void> {
      await sql`update identity.sessions
                   set last_seen_at = now(),
                       idle_expires_at = least(now() + ${idleMs / 1000} * interval '1 second', absolute_expires_at)
                 where id = ${id} and last_seen_at < now() - interval '1 minute'`.execute(db);
    },

    async setActiveTenant(sessionId: string, tenantId: string | null): Promise<void> {
      await sql`update identity.sessions set active_tenant_id = ${tenantId} where id = ${sessionId}`.execute(
        db,
      );
    },

    async revokeSession(id: string): Promise<void> {
      await sql`update identity.sessions set revoked_at = now() where id = ${id} and revoked_at is null`.execute(
        db,
      );
    },

    async revokeSessionByHash(tokenHash: Buffer): Promise<string | null> {
      const { rows } = await sql<{ user_id: string }>`
        update identity.sessions set revoked_at = now()
         where token_hash = ${tokenHash} and revoked_at is null returning user_id`.execute(db);
      return rows[0]?.user_id ?? null;
    },

    async revokeUserSessions(userId: string): Promise<number> {
      const r = await sql`update identity.sessions set revoked_at = now()
                           where user_id = ${userId} and revoked_at is null`.execute(db);
      return Number(r.numAffectedRows ?? 0);
    },

    // --- one-time tokens (setup, later verification / reset) ---------------------------------------------------
    async createOneTimeToken(input: {
      purpose: "setup" | "email_verification" | "password_reset";
      identifier: string;
      tokenHash: Buffer;
      ttlMs: number;
    }): Promise<void> {
      await sql`insert into identity.verifications (id, purpose, identifier, token_hash, expires_at)
                values (${uuidv7()}, ${input.purpose}, ${input.identifier}, ${input.tokenHash},
                        now() + ${input.ttlMs / 1000} * interval '1 second')`.execute(db);
    },

    /** Atomically consumes a live token; false when unknown, expired or already used (single use, race-safe). */
    async consumeOneTimeToken(purpose: "setup", tokenHash: Buffer): Promise<boolean> {
      const { rows } = await sql<{ id: string }>`
        update identity.verifications set consumed_at = now()
         where purpose = ${purpose} and token_hash = ${tokenHash}
           and consumed_at is null and expires_at > now() returning id`.execute(db);
      return rows.length === 1;
    },

    async restoreOneTimeToken(tokenHash: Buffer): Promise<void> {
      await sql`update identity.verifications set consumed_at = null where token_hash = ${tokenHash}`.execute(
        db,
      );
    },
  };
}

export type AuthRepository = ReturnType<typeof authRepository>;
