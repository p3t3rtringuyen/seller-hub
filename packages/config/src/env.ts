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

  /** Vault master key (ADR-0005). Optional until P3-IDENTITY makes it required. */
  SH_MASTER_KEY: optionalString,
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
      ] as const
    ).filter((k) => DEV_ONLY_VALUES.has(env[k]));
    if (dev.length)
      throw new Error(`Dev-only placeholder values are set in production for: ${dev.join(", ")}`);
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
