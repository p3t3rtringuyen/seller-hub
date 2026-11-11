import { pino, type Logger, type LoggerOptions } from "pino";

// Conventions §7: one logger per process, allow-list fields, never Authorization / cookies / bodies of
// /auth, /connections, LWA or RDT calls. `redact` is the second fence behind the allow-list.

export type { Logger };

const SECRET_KEYS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-amz-access-token",
  "x-api-key",
  "password",
  "token",
  "refreshToken",
  "refresh_token",
  "accessToken",
  "access_token",
  "idToken",
  "id_token",
  "clientSecret",
  "client_secret",
];

const seg = (k: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `["${k}"]`);
const join = (prefix: string[], k: string) => [...prefix, seg(k)].join(".").replaceAll(".[", "[");

/**
 * Secret keys at the top level and up to three levels deep (`*`, `*.*`, `*.*.*`), which covers Amazon/LWA
 * bodies (`access_token`), request headers (`req.headers.authorization`) and axios/undici-style errors
 * (`err.config.headers.Authorization`). Header names are matched case-sensitively in lower case and in the
 * capitalised form; the request-log allow-list is the first fence, this is the second.
 */
export const REDACT_PATHS: string[] = [
  ...new Set(
    SECRET_KEYS.flatMap((k) =>
      [k, k[0]!.toUpperCase() + k.slice(1)].flatMap((name) =>
        [[], ["*"], ["*", "*"], ["*", "*", "*"]].map((prefix) => join(prefix, name)),
      ),
    ),
  ),
  "req.headers",
  "res.headers",
  "err.config.data",
  "err.config.body",
];

export interface LoggerConfig {
  name: string;
  level?: string;
  /** Pretty output for a terminal (development only). */
  pretty?: boolean;
  /** Destination stream; defaults to stdout. Tests pass a capturing stream. */
  stream?: NodeJS.WritableStream;
}

export function createLogger(config: LoggerConfig): Logger {
  const options: LoggerOptions = {
    name: config.name,
    level: config.level ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    base: { app: config.name },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return config.stream ? pino(options, config.stream) : pino(options);
}

export interface RequestLogFields {
  method: string;
  /** Route template (`/v1/seller-accounts/{id}/ads/campaigns`), never the raw URL with ids or query. */
  route: string;
  status: number;
  durationMs: number;
  traceId: string;
  userId?: string;
}

/** The only fields a request log line may carry. */
export const requestLogFields = (f: RequestLogFields): RequestLogFields => ({
  method: f.method,
  route: f.route,
  status: f.status,
  durationMs: Math.round(f.durationMs),
  traceId: f.traceId,
  ...(f.userId ? { userId: f.userId } : {}),
});
