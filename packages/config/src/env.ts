import { z } from "zod";
import { resolvePorts } from "./ports";

// Fail closed (legacy trap 7): a missing required value stops the process; there are no default secrets.
// Names are listed in `.env.example`, which carries dev-only placeholders for the local compose stack.

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SH_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  SH_PORT_OFFSET: z.coerce.number().int().min(0).max(900).multipleOf(100).default(0),

  SH_PG_HOST: z.string().default("127.0.0.1"),
  SH_PG_DATABASE: z.string().default("seller_hub"),
  SH_PG_OWNER_PASSWORD: z.string().min(1),
  SH_PG_APP_PASSWORD: z.string().min(1),
  SH_DATABASE_URL: optionalString,
  SH_DATABASE_OWNER_URL: optionalString,

  SH_REDIS_URL: optionalString,

  SH_S3_ENDPOINT: optionalString,
  SH_S3_REGION: z.string().default("us-east-1"),
  SH_S3_BUCKET: z.string().default("seller-hub"),
  SH_S3_ACCESS_KEY: z.string().min(1),
  SH_S3_SECRET_KEY: z.string().min(1),
  SH_RAW_RETENTION_DAYS: z.coerce.number().int().positive().default(35),

  SH_API_HOST: z.string().default("127.0.0.1"),
  SH_API_URL: optionalString,
  SH_WEB_PUBLIC_URL: optionalString,

  /** Vault key (ADR-0005), 32 bytes base64. Single-key form; `SH_MASTER_KEYS` takes precedence. Checked at API boot. */
  SH_MASTER_KEY: optionalString,
  /** Vault key ring (ADR-0005): comma list of `kid:base64(32 bytes)`. */
  SH_MASTER_KEYS: optionalString,
  /** Which kid of `SH_MASTER_KEYS` encrypts new credentials (default: the first). */
  SH_MASTER_KEY_ACTIVE: optionalString,
  /** `1` = the API/BFF sits behind a reverse proxy / tunnel whose forwarded headers can be trusted (client IP, https). */
  /** Shared secret by which the BFF vouches for the client IP/user-agent headers it sends to the API (required in production). */
  SH_BFF_SECRET: optionalString,
  SH_TRUST_PROXY: z.enum(["0", "1"]).default("0"),
  /** Amazon app (LWA) credentials of this deployment; per-seller refresh tokens live in the vault, not here. */
  SPAPI_LWA_CLIENT_ID: optionalString,
  SPAPI_LWA_CLIENT_SECRET: optionalString,
  ADS_LWA_CLIENT_ID: optionalString,
  ADS_LWA_CLIENT_SECRET: optionalString,
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  env: Env;
  ports: ReturnType<typeof resolvePorts>;
  /** Connection for `sh_app` (no BYPASSRLS): what the API and worker use. */
  databaseUrl: string;
  /** Connection for `sh_owner`: migrations and maintenance only. */
  databaseOwnerUrl: string;
  redisUrl: string;
  s3Endpoint: string;
  apiUrl: string;
  webUrl: string;
}

/** Placeholder values shipped in .env.example for the local compose stack. They must never run in production. */
export const DEV_ONLY_VALUES: ReadonlySet<string> = new Set([
  "sh_owner_dev_only",
  "sh_app_dev_only",
  "sh_minio_dev_only",
  "sh_minio_dev_only_secret",
  "ZGV2LW9ubHktbWFzdGVyLWtleS1zZWxsZXItaHViISE=",
]);

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Names only, never values.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment variables: ${names}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    const dev = (
      [
        "SH_PG_OWNER_PASSWORD",
        "SH_PG_APP_PASSWORD",
        "SH_S3_ACCESS_KEY",
        "SH_S3_SECRET_KEY",
        "SH_MASTER_KEY",
      ] as const
    ).filter((k) => DEV_ONLY_VALUES.has(env[k] ?? ""));
    if (dev.length)
      throw new Error(`Dev-only placeholder values are set in production for: ${dev.join(", ")}`);
    // Production is internet-facing: cookies must be Secure (https public URL) and the API must not believe forged
    // client headers (BFF secret). Names only in the message.
    const missing: string[] = [];
    if (!env.SH_WEB_PUBLIC_URL?.toLowerCase().startsWith("https://"))
      missing.push("SH_WEB_PUBLIC_URL (must start with https://)");
    if (!env.SH_BFF_SECRET || env.SH_BFF_SECRET.length < 32)
      missing.push("SH_BFF_SECRET (at least 32 characters)");
    if (missing.length) throw new Error(`Production needs: ${missing.join(", ")}`);
  }
  const ports = resolvePorts(source);
  const pg = (user: string, password: string) =>
    `postgres://${user}:${encodeURIComponent(password)}@${env.SH_PG_HOST}:${ports.pg}/${env.SH_PG_DATABASE}`;
  return {
    env,
    ports,
    databaseUrl: env.SH_DATABASE_URL ?? pg("sh_app", env.SH_PG_APP_PASSWORD),
    databaseOwnerUrl: env.SH_DATABASE_OWNER_URL ?? pg("sh_owner", env.SH_PG_OWNER_PASSWORD),
    redisUrl: env.SH_REDIS_URL ?? `redis://127.0.0.1:${ports.redis}`,
    s3Endpoint: env.SH_S3_ENDPOINT ?? `http://127.0.0.1:${ports.minio}`,
    apiUrl: env.SH_API_URL ?? `http://127.0.0.1:${ports.api}`,
    webUrl: env.SH_WEB_PUBLIC_URL ?? `http://127.0.0.1:${ports.web}`,
  };
}
