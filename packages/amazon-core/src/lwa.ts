import type { Clock, Random } from "./clock";
import { systemClock } from "./clock";
import type { CredentialRef, CredentialSource, LwaCredential } from "./credentials";
import { credentialKey } from "./credentials";
import {
  AmazonApiError,
  AmazonAuthError,
  AmazonUpstreamError,
  ConnectionNeedsReauth,
} from "./errors";
import type { ApiFamily, Region } from "./regions";
import { lwaTokenUrl } from "./regions";
import { DEFAULT_RETRY_POLICY, fullJitterDelayMs, parseRetryAfter } from "./retry";
import type { RetryPolicy } from "./retry";
import type { CachedToken, TokenCache } from "./token-cache";
import type { HttpTransport } from "./types";
import { encodeText, jsonOf } from "./types";

// Login with Amazon token service (ADR-0006, ADR-0005): refresh token → access token, cached until
// expiry minus a margin, single-flight per credential (in-process promise + cross-process cache lock).
// Nothing in here logs or throws a token, a secret or an LWA request/response body (conventions §7).

export interface LwaOptions {
  transport: HttpTransport;
  credentials: CredentialSource;
  cache: TokenCache;
  clock?: Clock;
  random?: Random;
  /** Tokens are refreshed this long before Amazon expires them. Default 60 s (ADR-0006). */
  marginMs?: number;
  /** LWA's own retry budget (429 / 5xx). Smaller than the API budget: a token call should fail fast. */
  retry?: RetryPolicy;
  /** How long another process may hold the refresh lock before we refresh ourselves. */
  lockTtlMs?: number;
  /** How often to look at the cache while another process refreshes. */
  lockPollMs?: number;
}

interface LwaTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export class LwaTokenService {
  private readonly transport: HttpTransport;
  private readonly credentials: CredentialSource;
  private readonly cache: TokenCache;
  private readonly clock: Clock;
  private readonly random: Random;
  private readonly marginMs: number;
  private readonly retry: RetryPolicy;
  private readonly lockTtlMs: number;
  private readonly lockPollMs: number;
  private readonly inFlight = new Map<string, Promise<string>>();
  /** Counts real exchanges with LWA (tests and metrics). */
  exchanges = 0;

  constructor(options: LwaOptions) {
    this.transport = options.transport;
    this.credentials = options.credentials;
    this.cache = options.cache;
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.marginMs = options.marginMs ?? 60_000;
    this.retry = options.retry ?? { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 };
    this.lockTtlMs = options.lockTtlMs ?? 15_000;
    this.lockPollMs = options.lockPollMs ?? 100;
  }

  /** Access token for a seller account's credential. `forceRefresh` drops the cached one first (after a 401). */
  async getAccessToken(
    ref: CredentialRef,
    options: { forceRefresh?: boolean } = {},
  ): Promise<string> {
    return (await this.getAccess(ref, options)).accessToken;
  }

  /** Like `getAccessToken`, plus the (non-secret) LWA client id the Ads API wants in a header. */
  async getAccess(
    ref: CredentialRef,
    options: { forceRefresh?: boolean } = {},
  ): Promise<{ accessToken: string; clientId: string }> {
    const credential = await this.credentials.getCredential(ref);
    const key = credentialKey(ref, credential);
    const clientId = credential.clientId;
    if (options.forceRefresh) await this.cache.delete(key);
    else {
      const hit = await this.cache.get(key);
      if (hit && hit.expiresAtMs - this.marginMs > this.clock.now()) {
        return { accessToken: hit.accessToken, clientId };
      }
    }
    const accessToken = await this.singleFlight(key, () =>
      this.refreshShared(ref, credential, key, options.forceRefresh === true),
    );
    return { accessToken, clientId };
  }

  /** App-level token for operations that need no seller authorisation (notifications destinations, …). */
  async getGrantlessToken(api: ApiFamily, region: Region, scope: string): Promise<string> {
    const app = await this.credentials.getAppCredential?.(api, region);
    if (!app)
      throw new Error("this credential source does not provide app credentials (grantless calls)");
    const key = `app:lwa:${api}:${region}:${scope}:${app.clientId.slice(0, 6)}`;
    const hit = await this.cache.get(key);
    if (hit && hit.expiresAtMs - this.marginMs > this.clock.now()) return hit.accessToken;
    return this.singleFlight(key, async () => {
      const ref = { tenantId: "app", sellerAccountId: "app", api, region };
      const token = await this.exchange(ref, {
        grant_type: "client_credentials",
        scope,
        client_id: app.clientId,
        client_secret: app.clientSecret,
      });
      await this.store(key, token);
      return token.accessToken;
    });
  }

  private singleFlight(key: string, work: () => Promise<string>): Promise<string> {
    const running = this.inFlight.get(key);
    if (running) return running;
    const p = work().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  private async refreshShared(
    ref: CredentialRef,
    credential: LwaCredential,
    key: string,
    forced: boolean,
  ): Promise<string> {
    const lock = await this.cache.tryLock(key, this.lockTtlMs);
    if (!lock) {
      // Another process is refreshing: wait for its result instead of spending a second exchange.
      const deadline = this.clock.now() + this.lockTtlMs;
      while (this.clock.now() < deadline) {
        await this.clock.sleep(this.lockPollMs);
        const hit = await this.cache.get(key);
        if (hit && hit.expiresAtMs - this.marginMs > this.clock.now()) return hit.accessToken;
      }
      // The holder died or is slow: refresh ourselves.
    }
    try {
      if (lock && !forced) {
        // Double-check: a peer may have stored a token between our miss and our lock.
        const hit = await this.cache.get(key);
        if (hit && hit.expiresAtMs - this.marginMs > this.clock.now()) return hit.accessToken;
      }
      const token = await this.exchange(ref, {
        grant_type: "refresh_token",
        refresh_token: credential.refreshToken,
        client_id: credential.clientId,
        client_secret: credential.clientSecret,
      });
      await this.store(key, token);
      return token.accessToken;
    } finally {
      await lock?.release();
    }
  }

  private async store(key: string, token: CachedToken): Promise<void> {
    await this.cache.set(key, token, token.expiresAtMs - this.marginMs - this.clock.now());
  }

  private async exchange(ref: CredentialRef, form: Record<string, string>): Promise<CachedToken> {
    const body = new URLSearchParams(form).toString();
    const url = lwaTokenUrl(ref.region);
    let lastStatus = 0;
    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      let status: number;
      let retryAfter: number | undefined;
      let parsed: LwaTokenResponse | undefined;
      try {
        this.exchanges++;
        const res = await this.transport.send({
          method: "POST",
          url,
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body: encodeText(body),
          timeoutMs: 15_000,
        });
        status = res.status;
        retryAfter = parseRetryAfter(res.headers["retry-after"], this.clock.now());
        parsed = jsonOf(res) as LwaTokenResponse | undefined;
      } catch (cause) {
        if (attempt >= this.retry.maxAttempts) {
          throw new AmazonUpstreamError(
            "LWA token endpoint unreachable",
            { api: ref.api, region: ref.region },
            true,
            { cause },
          );
        }
        await this.clock.sleep(fullJitterDelayMs(attempt, this.retry, this.random));
        continue;
      }
      lastStatus = status;
      if (status === 200 && parsed?.access_token && typeof parsed.expires_in === "number") {
        return {
          accessToken: parsed.access_token,
          expiresAtMs: this.clock.now() + parsed.expires_in * 1000,
        };
      }
      if (status === 400 || status === 401) {
        // `invalid_grant` = the refresh token was revoked or expired: the seller must reconnect.
        if (parsed?.error === "invalid_grant") {
          await this.credentials.markNeedsReauth?.(ref);
          throw new ConnectionNeedsReauth(ref);
        }
        // invalid_client / unauthorized_client / invalid_scope: our app configuration, not the seller's grant.
        throw new AmazonAuthError(
          `LWA rejected the token request (${parsed?.error ?? "unknown_error"})`,
          { api: ref.api, region: ref.region, status },
          parsed?.error,
          { error: parsed?.error },
          false,
        );
      }
      if ((status === 429 || status >= 500) && attempt < this.retry.maxAttempts) {
        await this.clock.sleep(
          Math.max(retryAfter ?? 0, fullJitterDelayMs(attempt, this.retry, this.random)),
        );
        continue;
      }
      throw new AmazonApiError(
        `LWA token endpoint answered ${status}`,
        { api: ref.api, region: ref.region, status },
        parsed?.error,
        { error: parsed?.error },
        status === 429 || status >= 500,
      );
    }
    throw new AmazonUpstreamError(
      `LWA token endpoint kept failing (last status ${lastStatus})`,
      { api: ref.api, region: ref.region },
      true,
    );
  }
}
