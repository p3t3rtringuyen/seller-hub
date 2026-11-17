const UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "30s" | "5m" | "6h" | "1d" -> milliseconds. */
export function parseDurationMs(value: string): number {
  const m = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!m) throw new Error(`invalid duration "${value}" (use 30s, 5m, 6h, 1d)`);
  return Number(m[1]) * (UNITS[m[2] as string] as number);
}

/** Next run delay: `every` plus a random 0..jitter so thousands of accounts do not fire together. */
export function nextRunDelayMs(
  schedule: { every: string; jitter?: string | undefined },
  random: () => number = Math.random,
): number {
  const jitter = schedule.jitter ? parseDurationMs(schedule.jitter) : 0;
  return parseDurationMs(schedule.every) + Math.floor(random() * jitter);
}

export const DAY_MS = 86_400_000;

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
