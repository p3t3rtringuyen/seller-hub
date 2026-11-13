// Sign-in throttle (legacy trap: unlimited password guessing). Failed attempts are counted per e-mail and per client IP
// in a sliding window; a success clears the e-mail counter. In-process: with several API replicas each has its own
// budget (a Redis-backed limiter is a P6-SEC follow-up). Entries expire, so memory stays bounded.

export interface LoginLimiterOptions {
  windowMs?: number;
  maxPerEmail?: number;
  maxPerIp?: number;
  now?: () => number;
}

export function createLoginLimiter(options: LoginLimiterOptions = {}) {
  const windowMs = options.windowMs ?? 15 * 60_000;
  const maxPerEmail = options.maxPerEmail ?? 8;
  const maxPerIp = options.maxPerIp ?? 40;
  const now = options.now ?? Date.now;
  const byEmail = new Map<string, number[]>();
  const byIp = new Map<string, number[]>();

  const recent = (map: Map<string, number[]>, key: string): number[] => {
    const t = now();
    const list = (map.get(key) ?? []).filter((x) => t - x < windowMs);
    if (list.length) map.set(key, list);
    else map.delete(key);
    return list;
  };

  return {
    /** Milliseconds to wait, or 0 when the attempt may proceed. */
    retryAfterMs(email: string, ip: string | null): number {
      const t = now();
      let wait = 0;
      const e = recent(byEmail, email.toLowerCase());
      if (e.length >= maxPerEmail) wait = Math.max(wait, e[0]! + windowMs - t);
      if (ip) {
        const i = recent(byIp, ip);
        if (i.length >= maxPerIp) wait = Math.max(wait, i[0]! + windowMs - t);
      }
      return wait;
    },
    failure(email: string, ip: string | null): void {
      const t = now();
      const e = email.toLowerCase();
      byEmail.set(e, [...recent(byEmail, e), t]);
      if (ip) byIp.set(ip, [...recent(byIp, ip), t]);
      if (byEmail.size > 10_000) byEmail.clear(); // bounded memory under a spray of random e-mails
      if (byIp.size > 10_000) byIp.clear();
    },
    success(email: string): void {
      byEmail.delete(email.toLowerCase());
    },
  };
}
export type LoginLimiter = ReturnType<typeof createLoginLimiter>;
