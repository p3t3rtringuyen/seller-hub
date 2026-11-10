import { pino, type Logger, type LoggerOptions } from "pino";

// Conventions §7: one logger per process, allow-list fields, never Authorization / cookies / bodies of
// /auth, /connections, LWA or RDT calls. `redact` is the second fence behind the allow-list.

export type { Logger };

export const REDACT_PATHS = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "refreshToken",
  "accessToken",
  "clientSecret",
  "token",
  "headers.authorization",
  "headers.cookie",
  "headers['set-cookie']",
  "req.headers",
  "res.headers",
  "*.authorization",
  "*.cookie",
  "*.password",
  "*.refreshToken",
  "*.accessToken",
  "*.clientSecret",
  "*.token",
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
