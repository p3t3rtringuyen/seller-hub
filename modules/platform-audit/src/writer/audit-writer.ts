import { isIP } from "node:net";
import { requireScope, uuidv7, type Scope } from "@seller-hub/core";
import { withScope, type Database, type ScopedTx } from "@seller-hub/db";
import { sql } from "kysely";

// Writer for `ops.audit_log` (append-only; sh_app has INSERT/SELECT only - db/design/07_ops.sql). One row per
// user-visible action: sign-in, membership, connection events (PLT-06). The History screen (S02) reads the table.
// Rules (conventions §7): never secrets, never buyer PII, no request bodies. `details` is for before/after values of
// settings and short codes; keys that look like credentials are replaced before anything is stored.

export type AuditActorType = "user" | "rule" | "assistant" | "system" | "api_token";

export interface AuditEvent {
  /** Dotted action name, e.g. `auth.login`, `member.invited`, `connection.connected`. */
  action: string;
  /** NULL for tenant-level actions (members, tenant settings). */
  sellerAccountId?: string | null;
  actorType?: AuditActorType;
  actorUserId?: string | null;
  /** E-mail of the tenant member (or rule name) at the time. Buyer data never goes here. */
  actorLabel?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  outcome?: "success" | "failure" | "partial";
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  traceId?: string | null;
  commandId?: string | null;
}

const SECRET_KEY =
  /token|secret|password|passwd|authorization|cookie|api[-_]?key|credential|code$/i;

/** Replaces values under secret-looking keys (any depth) so a careless caller cannot leak into the log. */
export function sanitizeDetails(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeDetails(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) ? "[redacted]" : sanitizeDetails(v, depth + 1),
      ]),
    );
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

/** Inserts one row inside an existing scoped transaction, so the audit row commits with the action it records. */
export async function insertAuditRow(
  trx: ScopedTx,
  scope: Scope,
  event: AuditEvent,
): Promise<string> {
  const s = requireScope(scope);
  const id = uuidv7();
  const ip = event.ipAddress && isIP(event.ipAddress) ? event.ipAddress : null;
  await sql`
    insert into ops.audit_log
      (id, tenant_id, seller_account_id, actor_type, actor_user_id, actor_label, action, target_type, target_id,
       command_id, outcome, details, ip_address, trace_id)
    values
      (${id}, ${s.tenantId}, ${event.sellerAccountId ?? s.sellerAccountId ?? null}, ${event.actorType ?? "user"},
       ${event.actorUserId ?? s.userId ?? null}, ${event.actorLabel ?? null}, ${event.action},
       ${event.targetType ?? null}, ${event.targetId ?? null}, ${event.commandId ?? null},
       ${event.outcome ?? "success"}, ${JSON.stringify(sanitizeDetails(event.details ?? {}))}::jsonb,
       ${ip}::inet, ${event.traceId ?? null})`.execute(trx);
  return id;
}

export interface AuditWriter {
  /** Writes in its own transaction (scope set for RLS). */
  write(scope: Scope, event: AuditEvent): Promise<string>;
  /** Writes inside the caller's transaction. */
  writeIn(trx: ScopedTx, scope: Scope, event: AuditEvent): Promise<string>;
}

export function createAuditWriter(db: Database): AuditWriter {
  return {
    write: (scope, event) => withScope(db, scope, (trx) => insertAuditRow(trx, scope, event)),
    writeIn: (trx, scope, event) => insertAuditRow(trx, scope, event),
  };
}
