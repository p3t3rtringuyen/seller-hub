import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  AmazonApiError,
  AmazonUpstreamError,
  DEFAULT_RETRY_POLICY,
  ReplayMissError,
  baseUrlFor,
  createAesGcmCipher,
  createAmazonRuntime,
  downloadDocument,
  fullJitterDelayMs,
  parseAmazonMode,
  parseRegion,
  parseRetryAfter,
} from "../src";
import {
  FAKE_REF,
  ManualClock,
  MockTransport,
  bytesResponse,
  createReplayTransport,
  createTestRuntime,
  fakeCredentialSource,
  jsonResponse,
} from "../src/testing";

describe("retry policy", () => {
  it("full jitter stays inside [0, min(cap, base·2^n)]", () => {
    const p = DEFAULT_RETRY_POLICY;
    expect(fullJitterDelayMs(1, p, () => 0.999)).toBeLessThan(1000);
    expect(fullJitterDelayMs(3, p, () => 0.999)).toBeLessThan(4000);
    expect(fullJitterDelayMs(10, p, () => 0.999)).toBeLessThan(60_001);
    expect(fullJitterDelayMs(5, p, () => 0)).toBe(0);
  });

  it("parses Retry-After as seconds or HTTP date", () => {
    expect(parseRetryAfter("3", 0)).toBe(3000);
    expect(parseRetryAfter("1.5", 0)).toBe(1500);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter("nonsense", 0)).toBeUndefined();
    expect(parseRetryAfter(undefined, 0)).toBeUndefined();
  });
});

describe("regions and modes", () => {
  it("parses regions and modes strictly", () => {
    expect(parseRegion("EU")).toBe("eu");
    expect(() => parseRegion("xx")).toThrow();
    expect(parseAmazonMode(undefined)).toBe("production");
    expect(() => parseAmazonMode("live")).toThrow();
  });

  it("sandbox only changes the SP-API host", () => {
    expect(baseUrlFor("sp", "na", "sandbox")).toBe(
      "https://sandbox.sellingpartnerapi-na.amazon.com",
    );
    expect(baseUrlFor("ads", "na", "sandbox")).toBe("https://advertising-api.amazon.com");
  });

  it("replay mode refuses to run without a fixture transport", () => {
    expect(() =>
      createAmazonRuntime({ credentials: fakeCredentialSource(), mode: "replay" }),
    ).toThrow(/fixture transport/);
  });

  it("requires a cipher before tokens may go to Redis", () => {
    expect(() =>
      createAmazonRuntime({
        credentials: fakeCredentialSource(),
        mode: "replay",
        transport: new MockTransport(),
        redis: {} as never,
      }),
    ).toThrow(/cipher/);
    expect(() => createAesGcmCipher(new Uint8Array(16))).toThrow();
  });
});

describe("document download", () => {
  const url = "https://tortuga.s3.amazonaws.com/doc/abc";
  it("gunzips, sends no Authorization header, and retries 5xx", async () => {
    const transport = new MockTransport();
    const text = "sku\tqty\nA\t1\n";
    transport.route(
      { url },
      bytesResponse(503, new Uint8Array()),
      bytesResponse(200, gzipSync(text)),
    );
    const clock = new ManualClock();
    const bytes = await downloadDocument({ transport, url, clock, random: () => 0.5 });
    expect(new TextDecoder().decode(bytes)).toBe(text);
    expect(transport.requests[0]?.headers.authorization).toBeUndefined();
    expect(transport.requests[0]?.headers["x-amz-access-token"]).toBeUndefined();
    expect(transport.requests).toHaveLength(2);
  });

  it("returns plain bodies untouched and fails fast on an expired URL", async () => {
    const transport = new MockTransport();
    transport.route({ url }, bytesResponse(200, new TextEncoder().encode("plain")));
    expect(new TextDecoder().decode(await downloadDocument({ transport, url }))).toBe("plain");
    transport.reset();
    transport.route({ url }, bytesResponse(403, new Uint8Array()));
    await expect(
      downloadDocument({ transport, url, clock: new ManualClock() }),
    ).rejects.toBeInstanceOf(AmazonApiError);
    expect(transport.requests).toHaveLength(1);
  });

  it("gives up after the retry budget", async () => {
    const transport = new MockTransport();
    transport.route({ url }, bytesResponse(500, new Uint8Array()));
    await expect(
      downloadDocument({
        transport,
        url,
        clock: new ManualClock(),
        retry: { ...DEFAULT_RETRY_POLICY, maxAttempts: 2 },
      }),
    ).rejects.toBeInstanceOf(AmazonUpstreamError);
  });

  it("refuses to inflate past the size cap", async () => {
    const transport = new MockTransport();
    transport.route({ url }, bytesResponse(200, gzipSync(new Uint8Array(100_000))));
    await expect(downloadDocument({ transport, url, maxBytes: 1000 })).rejects.toThrow();
  });
});

describe("replay transport", () => {
  it("serves fixtures by method, path (with *) and query, a sequence of responses, and a fake LWA token", async () => {
    const transport = createReplayTransport({
      fixtures: [
        {
          match: { method: "GET", path: "/reports/2021-06-30/reports/*", query: { x: "1" } },
          responses: [
            { status: 200, json: { processingStatus: "IN_PROGRESS" } },
            { status: 200, json: { processingStatus: "DONE" } },
          ],
        },
      ],
    });
    const t = createTestRuntime({ transport, mode: "replay" });
    const op = {
      id: "reports.getReport",
      api: "sp",
      family: "r",
      method: "GET",
      path: "/reports/2021-06-30/reports/{reportId}",
      idempotent: true,
    } as const;
    const a = await t.runtime.client.call<{ processingStatus: string }>({
      operation: op,
      ref: FAKE_REF("sp"),
      path: { reportId: "R1" },
      query: { x: "1" },
    });
    const b = await t.runtime.client.call<{ processingStatus: string }>({
      operation: op,
      ref: FAKE_REF("sp"),
      path: { reportId: "R1" },
      query: { x: "1" },
    });
    expect([a.body.processingStatus, b.body.processingStatus]).toEqual(["IN_PROGRESS", "DONE"]);
    await expect(
      t.runtime.client.call({ operation: op, ref: FAKE_REF("sp"), path: { reportId: "R1" } }),
    ).rejects.toBeInstanceOf(ReplayMissError);
  });

  it("the mock transport reports an unmatched route with the path, not the query", async () => {
    const transport = new MockTransport();
    await expect(
      transport.send({ method: "GET", url: "https://x.test/a/b?token=secret", headers: {} }),
    ).rejects.toThrow(/GET https:\/\/x\.test\/a\/b$/);
    void jsonResponse;
  });
});
