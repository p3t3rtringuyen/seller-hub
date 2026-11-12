import type { Clock } from "../clock";
import type {
  CredentialRef,
  CredentialSource,
  LwaAppCredential,
  LwaCredential,
} from "../credentials";
import type { ApiFamily, Region } from "../regions";
import { jsonResponse } from "./mock-transport";
import type { MockTransport } from "./mock-transport";

/** A clock whose `sleep` advances time instantly and records the delays, so backoff tests run in microseconds. */
export class ManualClock implements Clock {
  private t: number;
  readonly sleeps: number[] = [];
  constructor(startMs = 1_700_000_000_000) {
    this.t = startMs;
  }
  now(): number {
    return this.t;
  }
  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.t += Math.max(0, ms);
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** Obviously fake, never valid at Amazon. */
export const FAKE_LWA: LwaCredential = {
  clientId: "amzn1.application-oa2-client.fake0000000000000000000000000000",
  clientSecret: "fake-client-secret-not-real",
  refreshToken: "Atzr|fake-refresh-token-not-real",
};

export interface FakeCredentialSource extends CredentialSource {
  requested: CredentialRef[];
  reauth: CredentialRef[];
}

/** Credential source for tests and replay mode. `byRef` lets a test give two seller accounts different credentials. */
export function fakeCredentialSource(
  options: {
    credential?: LwaCredential;
    byRef?: (ref: CredentialRef) => LwaCredential | undefined;
  } = {},
): FakeCredentialSource {
  const requested: CredentialRef[] = [];
  const reauth: CredentialRef[] = [];
  const app: LwaAppCredential = {
    clientId: FAKE_LWA.clientId,
    clientSecret: FAKE_LWA.clientSecret,
  };
  return {
    requested,
    reauth,
    async getCredential(ref) {
      requested.push(ref);
      return options.byRef?.(ref) ?? options.credential ?? FAKE_LWA;
    },
    async getAppCredential() {
      return app;
    },
    async markNeedsReauth(ref) {
      reauth.push(ref);
    },
  };
}

export const FAKE_REF = (
  api: ApiFamily,
  region: Region = "na",
  sellerAccountId = "sa-1",
): CredentialRef => ({
  tenantId: "tenant-1",
  sellerAccountId,
  api,
  region,
});

/** Answers every region's LWA endpoint with a token (`expires_in` seconds), counting nothing — use `callsTo` for counts. */
export function mockLwa(
  transport: MockTransport,
  expiresIn = 3600,
  tokenPrefix = "Atza|fake-access",
): void {
  let n = 0;
  transport.route({ method: "POST", path: "/auth/o2/token" }, () =>
    jsonResponse(200, {
      access_token: `${tokenPrefix}-${++n}`,
      token_type: "bearer",
      expires_in: expiresIn,
    }),
  );
}

export const LWA_PATH = "/auth/o2/token";
