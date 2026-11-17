// Sign-in throttle (legacy trap: unlimited password guessing). In-process, sliding window; with several API replicas each has
// its own budget (a Redis-backed limiter is a P6-SEC follow-up).
//
// Review M2 hardening:
//  - an attempt is RESERVED before the password is checked (`reserve`) and cleared on success, so parallel requests cannot all
//    pass a check that only counts finished failures;
//  - there is always an IP bucket: when no client IP is known (no trusted proxy) all such attempts share one `unknown` bucket
//    with a larger budget, so password spraying across many e-mails is limited too;
//  - when a map grows too large the OLDEST entries are evicted, never the whole map (an attacker cannot wipe the counters).

export interface LoginLimiterOptions {
  windowMs?: number;
  maxPerEmail?: number;
  maxPerIp?: number;
  maxUnknownIp?: number;
  maxKeys?: number;
  now?: () => number;
}

export function createLoginLimiter(options: LoginLimiterOptions = {}) {
  const windowMs = options.windowMs ?? 15 * 60_000;
  const maxPerEmail = options.maxPerEmail ?? 8;
  const maxPerIp = options.maxPerIp ?? 40;
  const maxUnknownIp = options.maxUnknownIp ?? 200;
  const maxKeys = options.maxKeys ?? 10_000;
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
  const evict = (map: Map<string, number[]>) => {
    while (map.size > maxKeys) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  };
  const add = (map: Map<string, number[]>, key: string, t: number) => {
    const list = recent(map, key);
    map.delete(key); // re-insert so the Map order is "least recently used first"
    map.set(key, [...list, t]);
    evict(map);
  };

  return {
    /**
     * Counts this attempt and returns 0 when it may proceed, else the milliseconds to wait (the attempt is then not counted
     * again). Call it BEFORE verifying the password.
     */
    reserve(email: string, ip: string | null): number {
      const t = now();
      const e = email.toLowerCase();
      const ipKey = ip ?? "unknown";
      const ipMax = ip ? maxPerIp : maxUnknownIp;
      const em = recent(byEmail, e);
      const ipList = recent(byIp, ipKey);
      let wait = 0;
      if (em.length >= maxPerEmail) wait = Math.max(wait, em[0]! + windowMs - t);
      if (ipList.length >= ipMax) wait = Math.max(wait, ipList[0]! + windowMs - t);
      if (wait > 0) return wait;
      add(byEmail, e, t);
      add(byIp, ipKey, t);
      return 0;
    },
    /** A successful sign-in forgives the e-mail's earlier failures (the IP bucket keeps counting). */
    success(email: string): void {
      byEmail.delete(email.toLowerCase());
    },
  };
}
export type LoginLimiter = ReturnType<typeof createLoginLimiter>;
