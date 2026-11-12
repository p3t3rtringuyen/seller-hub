import { describe, expect, it } from "vitest";
import { ConnectionNeedsReauth } from "../src";
import { LwaTokenService } from "../src/lwa";
import { MemoryTokenCache } from "../src/token-cache";
import {
  FAKE_LWA,
  FAKE_REF,
  ManualClock,
  MockTransport,
  fakeCredentialSource,
  jsonResponse,
  mockLwa,
} from "../src/testing";

function setup(expiresIn = 3600) {
  const transport = new MockTransport();
  mockLwa(transport, expiresIn);
  const clock = new ManualClock();
  const credentials = fakeCredentialSource();
  const lwa = new LwaTokenService({
    transport,
    credentials,
    cache: new MemoryTokenCache(clock),
    clock,
    random: () => 0.5,
  });
  return { transport, clock, credentials, lwa };
}

const lwaCalls = (t: MockTransport) => t.callsTo({ method: "POST", path: "/auth/o2/token" });

describe("LWA token service", () => {
  it("exchanges the refresh token once and serves later calls from the cache", async () => {
    const { lwa, transport } = setup();
    const a = await lwa.getAccessToken(FAKE_REF("sp"));
    const b = await lwa.getAccessToken(FAKE_REF("sp"));
    expect(a).toBe(b);
    expect(lwaCalls(transport)).toHaveLength(1);
    const sent = new URLSearchParams(lwaCalls(transport)[0]?.bodyText);
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("refresh_token")).toBe(FAKE_LWA.refreshToken);
  });

  it("refreshes when the token is within the margin of its expiry", async () => {
    const { lwa, transport, clock } = setup(3600);
    const first = await lwa.getAccessToken(FAKE_REF("sp"));
    clock.advance((3600 - 59) * 1000); // 59 s left: inside the 60 s margin
    const second = await lwa.getAccessToken(FAKE_REF("sp"));
    expect(second).not.toBe(first);
    expect(lwaCalls(transport)).toHaveLength(2);
  });

  it("is single-flight: parallel callers share one exchange", async () => {
    const { lwa, transport } = setup();
    const tokens = await Promise.all(
      Array.from({ length: 10 }, () => lwa.getAccessToken(FAKE_REF("sp"))),
    );
    expect(new Set(tokens).size).toBe(1);
    expect(lwaCalls(transport)).toHaveLength(1);
  });

  it("keeps one cache entry per seller account and per API", async () => {
    const { lwa, transport } = setup();
    await lwa.getAccessToken(FAKE_REF("sp", "na", "sa-1"));
    await lwa.getAccessToken(FAKE_REF("sp", "na", "sa-2"));
    await lwa.getAccessToken(FAKE_REF("ads", "na", "sa-1"));
    expect(lwaCalls(transport)).toHaveLength(3);
  });

  it("uses the LWA endpoint of the credential's region", async () => {
    const { lwa, transport } = setup();
    await lwa.getAccessToken(FAKE_REF("sp", "eu"));
    await lwa.getAccessToken(FAKE_REF("sp", "fe"));
    expect(lwaCalls(transport).map((r) => new URL(r.url).host)).toEqual([
      "api.amazon.co.uk",
      "api.amazon.co.jp",
    ]);
  });

  it("forceRefresh drops the cached token", async () => {
    const { lwa, transport } = setup();
    await lwa.getAccessToken(FAKE_REF("sp"));
    await lwa.getAccessToken(FAKE_REF("sp"), { forceRefresh: true });
    expect(lwaCalls(transport)).toHaveLength(2);
  });

  it("maps invalid_grant to ConnectionNeedsReauth and tells the credential source", async () => {
    const { lwa, transport, credentials } = setup();
    transport.route(
      { path: "/auth/o2/token" },
      jsonResponse(400, { error: "invalid_grant", error_description: "revoked" }),
    );
    await expect(lwa.getAccessToken(FAKE_REF("sp"))).rejects.toBeInstanceOf(ConnectionNeedsReauth);
    expect(credentials.reauth).toHaveLength(1);
    expect(lwaCalls(transport)).toHaveLength(1); // not retried
  });

  it("retries LWA 5xx with backoff, then succeeds", async () => {
    const { lwa, transport, clock } = setup();
    transport.route(
      { path: "/auth/o2/token" },
      jsonResponse(503, { error: "temporarily_unavailable" }),
      jsonResponse(200, { access_token: "Atza|ok", expires_in: 3600, token_type: "bearer" }),
    );
    expect(await lwa.getAccessToken(FAKE_REF("sp"))).toBe("Atza|ok");
    expect(clock.sleeps).toHaveLength(1);
  });

  it("does not put the refresh token or secret in an error message", async () => {
    const { lwa, transport } = setup();
    transport.route({ path: "/auth/o2/token" }, jsonResponse(401, { error: "invalid_client" }));
    const err = (await lwa.getAccessToken(FAKE_REF("sp")).catch((e: unknown) => e)) as Error;
    const text = JSON.stringify({
      m: err.message,
      s: err.stack,
      c: (err as { context?: unknown }).context,
    });
    expect(text).not.toContain(FAKE_LWA.refreshToken);
    expect(text).not.toContain(FAKE_LWA.clientSecret);
  });

  it("supports grantless tokens (client_credentials) for app-level operations", async () => {
    const { lwa, transport } = setup();
    await lwa.getGrantlessToken("sp", "na", "sellingpartnerapi::notifications");
    const sent = new URLSearchParams(lwaCalls(transport)[0]?.bodyText);
    expect(sent.get("grant_type")).toBe("client_credentials");
    expect(sent.get("scope")).toBe("sellingpartnerapi::notifications");
    expect(sent.get("refresh_token")).toBeNull();
  });
});
