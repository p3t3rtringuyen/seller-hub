// Host ports for the dev stack. Every default is offset from the usual ports so that nothing collides
// with a locally installed Postgres/Redis, and `SH_PORT_OFFSET` shifts the whole set so that several
// stacks (one per worktree) can run side by side. An explicit `SH_*_PORT` variable wins over the offset.

export const BASE_PORTS = {
  pg: 55432,
  redis: 56379,
  minio: 59000,
  minioConsole: 59001,
  api: 4100,
  web: 3100,
} as const;

export type PortName = keyof typeof BASE_PORTS;

const EXPLICIT_VAR: Record<PortName, string> = {
  pg: "SH_PG_PORT",
  redis: "SH_REDIS_PORT",
  minio: "SH_MINIO_PORT",
  minioConsole: "SH_MINIO_CONSOLE_PORT",
  api: "SH_API_PORT",
  web: "SH_WEB_PORT",
};

export function resolvePorts(env: Record<string, string | undefined>): Record<PortName, number> {
  const offset = Number(env.SH_PORT_OFFSET ?? "0");
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000) {
    throw new Error("SH_PORT_OFFSET must be an integer between 0 and 1000");
  }
  const out = {} as Record<PortName, number>;
  for (const name of Object.keys(BASE_PORTS) as PortName[]) {
    const explicit = env[EXPLICIT_VAR[name]];
    out[name] = explicit ? Number(explicit) : BASE_PORTS[name] + offset;
  }
  return out;
}

/** The resolved ports as environment variables, for docker compose and child processes. */
export function portEnv(env: Record<string, string | undefined>): Record<string, string> {
  const ports = resolvePorts(env);
  const out: Record<string, string> = {};
  for (const name of Object.keys(ports) as PortName[])
    out[EXPLICIT_VAR[name]] = String(ports[name]);
  return out;
}
