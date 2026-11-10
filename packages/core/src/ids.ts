import { randomBytes } from "node:crypto";

/** UUIDv7 (time-ordered) — the only way to create an internal primary key (conventions §2). */
export function uuidv7(nowMs: number = Date.now()): string {
  const b = randomBytes(16);
  b[0] = (nowMs / 2 ** 40) & 0xff;
  b[1] = (nowMs / 2 ** 32) & 0xff;
  b[2] = (nowMs / 2 ** 24) & 0xff;
  b[3] = (nowMs / 2 ** 16) & 0xff;
  b[4] = (nowMs / 2 ** 8) & 0xff;
  b[5] = nowMs & 0xff;
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

/** Accepts an incoming X-Request-Id only if well-formed, otherwise generates one (conventions §2). */
export function resolveRequestId(incoming: string | undefined): string {
  return incoming && REQUEST_ID_RE.test(incoming) ? incoming : uuidv7();
}
