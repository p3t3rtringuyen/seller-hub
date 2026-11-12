import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { Cipher } from "./cipher";
import type { Clock } from "./clock";
import { systemClock } from "./clock";

export interface CachedToken {
  accessToken: string;
  /** Epoch ms at which Amazon stops accepting the token. */
  expiresAtMs: number;
}

export interface TokenLock {
  release(): Promise<void>;
}

/** Where access tokens live between calls. Redis in production (shared by api + workers), memory in tests. */
export interface TokenCache {
  get(key: string): Promise<CachedToken | null>;
  /** Stores until `ttlMs` from now. */
  set(key: string, token: CachedToken, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Cross-process lock for single-flight refresh. `null` = somebody else holds it. */
  tryLock(key: string, ttlMs: number): Promise<TokenLock | null>;
}

export class MemoryTokenCache implements TokenCache {
  private readonly entries = new Map<string, { token: CachedToken; until: number }>();
  private readonly locks = new Map<string, number>();
  constructor(private readonly clock: Clock = systemClock) {}

  async get(key: string) {
    const e = this.entries.get(key);
    if (!e) return null;
    if (e.until <= this.clock.now()) {
      this.entries.delete(key);
      return null;
    }
    return e.token;
  }
  async set(key: string, token: CachedToken, ttlMs: number) {
    this.entries.set(key, { token, until: this.clock.now() + ttlMs });
  }
  async delete(key: string) {
    this.entries.delete(key);
  }
  async tryLock(key: string, ttlMs: number) {
    const held = this.locks.get(key);
    if (held !== undefined && held > this.clock.now()) return null;
    this.locks.set(key, this.clock.now() + ttlMs);
    return {
      release: async () => {
        this.locks.delete(key);
      },
    };
  }
}

const RELEASE_LOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

/** Encrypted token cache on Redis. Keys already start with the tenant id (conventions §10). */
export class RedisTokenCache implements TokenCache {
  constructor(
    private readonly redis: Redis,
    private readonly cipher: Cipher,
    private readonly prefix = "sh:",
  ) {}

  async get(key: string) {
    const sealed = await this.redis.get(this.prefix + key);
    if (!sealed) return null;
    try {
      return JSON.parse(this.cipher.decrypt(sealed)) as CachedToken;
    } catch {
      // Wrong key or corrupted entry: behave as a miss, the next refresh overwrites it.
      return null;
    }
  }
  async set(key: string, token: CachedToken, ttlMs: number) {
    if (ttlMs <= 0) return;
    await this.redis.set(
      this.prefix + key,
      this.cipher.encrypt(JSON.stringify(token)),
      "PX",
      Math.ceil(ttlMs),
    );
  }
  async delete(key: string) {
    await this.redis.del(this.prefix + key);
  }
  async tryLock(key: string, ttlMs: number) {
    const lockKey = `${this.prefix}${key}:lock`;
    const id = randomUUID();
    const got = await this.redis.set(lockKey, id, "PX", Math.ceil(ttlMs), "NX");
    if (got !== "OK") return null;
    return {
      release: async () => {
        await this.redis.eval(RELEASE_LOCK, 1, lockKey, id);
      },
    };
  }
}
