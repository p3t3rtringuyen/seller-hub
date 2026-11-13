import type { Logger, SellerScope } from "@seller-hub/core";
import type { Database } from "@seller-hub/db";
import * as repo from "./repository";
import type { InboxMessage, PushDefinition } from "./types";

// Push sources (ADR-0008 decision 10): SQS poller -> `ingest.inbox` (unique by message id) -> handler registry.
// SQS itself is a seam: the poller talks to the `SqsLike` port, so tests and the stubbed worker need no AWS.

export interface SqsMessage {
  /** SQS message id (the dedupe key when the body carries none). */
  messageId: string;
  receiptHandle: string;
  body: string;
}

export interface SqsLike {
  receive(max: number): Promise<SqsMessage[]>;
  delete(receiptHandle: string): Promise<void>;
}

export interface ParsedPush {
  /** Notification id / stream batch id. A repeat of the same id is ignored. */
  messageId: string;
  messageType: string;
  payload: unknown;
  /** Which seller account it is for; null = cannot be routed (dropped with a warning). */
  scope: SellerScope | null;
}

/**
 * Reads one batch from a queue. A message is deleted from SQS only after its inbox row exists (or it was a
 * duplicate), so a crash between the two re-delivers it and the unique key makes the replay harmless.
 */
export async function pollPushQueue(o: {
  sqs: SqsLike;
  db: Database;
  source: "spapi-notification" | "marketing-stream";
  parse: (message: SqsMessage) => ParsedPush | null;
  log: Logger;
  now?: () => Date;
  max?: number;
}): Promise<{ received: number; inserted: number; duplicates: number; dropped: number }> {
  const out = { received: 0, inserted: 0, duplicates: 0, dropped: 0 };
  const now = o.now ?? (() => new Date());
  for (const m of await o.sqs.receive(o.max ?? 10)) {
    out.received++;
    let parsed: ParsedPush | null = null;
    try {
      parsed = o.parse(m);
    } catch {
      parsed = null;
    }
    if (!parsed || !parsed.scope) {
      o.log.warn({ sqsMessageId: m.messageId }, "push message could not be routed to a seller account; dropped");
      out.dropped++;
      await o.sqs.delete(m.receiptHandle);
      continue;
    }
    const inserted = await repo.insertInbox(parsed.scope, o.db, {
      source: o.source,
      messageId: parsed.messageId,
      messageType: parsed.messageType,
      payload: parsed.payload,
      now: now(),
    });
    out[inserted ? "inserted" : "duplicates"]++;
    await o.sqs.delete(m.receiptHandle);
  }
  return out;
}

const SOURCE_OF: Record<PushDefinition["family"], InboxMessage["source"]> = {
  "spapi-notification": "spapi-notification",
  stream: "marketing-stream",
};

/**
 * Processes pending inbox rows of one account through the handlers. A handler error marks the row `failed` (it is
 * retried up to 5 times, then waits for a manual replay); a message with no handler is marked failed too, so a
 * missing handler is visible instead of silently dropped.
 */
export async function processInbox(o: {
  scope: SellerScope;
  db: Database;
  handlers: readonly PushDefinition[];
  log: Logger;
  now?: () => Date;
  limit?: number;
}): Promise<{ done: number; failed: number }> {
  const now = o.now ?? (() => new Date());
  const result = { done: 0, failed: 0 };
  const rows = await repo.claimInbox(o.scope, o.db, o.limit ?? 50);
  for (const row of rows) {
    const handler = o.handlers.find(
      (h) => SOURCE_OF[h.family] === row.source && h.messageType === row.messageType,
    );
    try {
      if (!handler) throw Object.assign(new Error("no handler"), { code: "no_handler" });
      await repo.scoped(o.scope, o.db, async (trx) => {
        await handler.handle(
          { scope: o.scope, trx, log: o.log, now },
          {
            id: row.id,
            messageId: row.messageId,
            source: row.source,
            messageType: row.messageType,
            payload: row.payload,
          },
        );
        await repo.finishInbox(trx, row.id, { ok: true, now: now() });
      });
      result.done++;
    } catch (e) {
      const code = ((e as { code?: unknown }).code as string | undefined) ?? "handler_error";
      await repo.scoped(o.scope, o.db, (trx) => repo.finishInbox(trx, row.id, { ok: false, errorCode: code.slice(0, 80) }));
      o.log.warn({ inboxId: row.id, code }, "inbox message failed");
      result.failed++;
    }
  }
  return result;
}
