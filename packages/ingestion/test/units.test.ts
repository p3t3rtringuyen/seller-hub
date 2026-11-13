import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import merchantListings from "../src/demo/merchant-listings.sync";
import { DefinitionError, toIngestDefinitions } from "../src/definitions";
import { nextRunDelayMs, parseDurationMs } from "../src/duration";
import { computeWindow } from "../src/engine";
import { MemoryObjectStore, rawObjectKey, S3ObjectStore } from "../src/object-store";
import { parseCsv, parseJsonRecords, parseTsv, parseXmlRecords } from "../src/parsers";
import { jobKeyOf } from "../src/repository";
import { scopesFor } from "../src/scheduler";
import { definePagedPull, type PullDefinition, type SyncTarget } from "../src/types";

describe("definitions (boot-time validation of the registry)", () => {
  const ok = {
    key: "x.a",
    family: "paged-pull",
    fetchPage: () => ({ rows: [] }),
    upsert: () => undefined,
  };

  it("accepts the demo definition", () => {
    expect(toIngestDefinitions([merchantListings as never])).toHaveLength(1);
  });
  it("rejects duplicate keys, unknown families, missing functions and bad schedules", () => {
    const e = (() => {
      try {
        toIngestDefinitions([
          ok,
          ok,
          { key: "x.b", family: "teleport" },
          { key: "x.c", family: "spapi-report", upsert: () => 1 },
          { ...ok, key: "x.d", schedule: { every: "soon" } },
        ] as never);
      } catch (err) {
        return err as DefinitionError;
      }
      return null;
    })();
    expect(e).toBeInstanceOf(DefinitionError);
    const text = e!.problems.join("\n");
    expect(text).toMatch(/x\.a: duplicate key/);
    expect(text).toMatch(/x\.b: unknown family/);
    expect(text).toMatch(/x\.c: family spapi-report needs "report"/);
    expect(text).toMatch(/x\.d: invalid duration/);
  });
  it("rejects an operation that is not in the client allow-lists (no Reporting v3, no unknown operation)", () => {
    expect(() =>
      toIngestDefinitions([
        { ...ok, operations: ["reports.createReport", "AdsReportingV3CreateReport"] },
      ] as never),
    ).toThrow(/AdsReportingV3CreateReport/);
    expect(() =>
      toIngestDefinitions([
        { ...ok, operations: ["reports.createReport", "SPQueryCampaign"] },
      ] as never),
    ).not.toThrow();
  });
  it("rejects a schedule on a push family", () => {
    expect(() =>
      toIngestDefinitions([
        {
          key: "x.p",
          family: "spapi-notification",
          messageType: "T",
          handle: () => undefined,
          schedule: { every: "1m" },
        },
      ] as never),
    ).toThrow(/push families take no schedule/);
  });
});

describe("scheduling helpers", () => {
  it("parses durations and adds jitter", () => {
    expect(parseDurationMs("6h")).toBe(21_600_000);
    expect(nextRunDelayMs({ every: "5m", jitter: "2m" }, () => 0.5)).toBe(300_000 + 60_000);
    expect(() => parseDurationMs("1w")).toThrow();
  });
  it("window: lookback re-pulls recent days, a gap is caught up, a long gap is chunked (no full re-pull)", () => {
    const def: PullDefinition = definePagedPull<unknown>({
      key: "x.w",
      family: "paged-pull",
      window: { lookbackDays: 3, maxRangeDays: 31 },
      fetchPage: async () => ({ rows: [] }),
      upsert: async () => undefined,
    });
    const now = new Date("2026-11-13T10:00:00Z");
    expect(computeWindow(def, {}, now).start?.toISOString()).toBe("2026-11-10T00:00:00.000Z");
    const gap = computeWindow(def, { windowEnd: "2026-11-01T00:00:00.000Z" }, now);
    expect(gap.start?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    const long = computeWindow(def, { windowEnd: "2026-06-01T00:00:00.000Z" }, now);
    expect((long.end!.getTime() - long.start!.getTime()) / 86_400_000).toBe(31);
  });
  it("scopes: Ads syncs run per Ads profile, SP syncs per account or marketplace; vendor accounts are filtered", () => {
    const target: SyncTarget = {
      tenantId: "t",
      sellerAccountId: "s",
      accountType: "seller",
      region: "na",
      marketplaceIds: ["M1", "M2"],
      adsProfiles: [
        { profileId: "P1", marketplaceId: "M1", accountType: "seller" },
        { profileId: "P2", marketplaceId: "M2", accountType: "agency" },
      ],
      paused: {},
    };
    const mk = (extra: object): PullDefinition =>
      ({
        key: "x.s",
        fetchPage: async () => ({ rows: [] }),
        upsert: async () => undefined,
        family: "paged-pull",
        ...extra,
      }) as PullDefinition;
    expect(scopesFor(mk({}), target)).toEqual([""]);
    expect(scopesFor(mk({ scopeKind: "marketplace" }), target)).toEqual(["M1", "M2"]);
    expect(scopesFor(mk({ appliesTo: { api: "ads" } }), target)).toEqual(["P1"]);
    expect(scopesFor(mk({ appliesTo: { accountTypes: ["vendor"] } }), target)).toEqual([]);
    expect(scopesFor(mk({}), { ...target, paused: { sp: "needs_reauth" } })).toEqual([]);
    expect(scopesFor(mk({ appliesTo: { api: "ads" } }), { ...target, adsProfiles: [] })).toEqual(
      [],
    );
  });
  it("job key follows ADR-0008 decision 5", () => {
    const k = jobKeyOf("sa-1", {
      syncKey: "ads.sp-report-daily",
      scopeKey: "",
      windowStart: new Date("2026-11-01T00:00:00Z"),
      windowEnd: new Date("2026-11-02T00:00:00Z"),
    });
    expect(k).toBe("ads.sp-report-daily:sa-1:2026-11-01T00:00:00.000Z:2026-11-02T00:00:00.000Z");
  });
});

describe("parsers", () => {
  it("TSV: header row, empty trailing lines, BOM", () => {
    expect(parseTsv("﻿a\tb\n1\t2\n\n")).toEqual([{ a: "1", b: "2" }]);
    expect(parseTsv("")).toEqual([]);
    expect(parseTsv("a\tb\n")).toEqual([]);
  });
  it("CSV: quotes, escaped quotes, CRLF", () => {
    expect(parseCsv('a,b\r\n"x ""q"" y",2\r\n')).toEqual([{ a: 'x "q" y', b: "2" }]);
  });
  it("JSON: array, lines, wrapped object", () => {
    expect(parseJsonRecords('[{"a":1}]')).toEqual([{ a: 1 }]);
    expect(parseJsonRecords('{"a":1}\n{"a":2}')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(parseJsonRecords('{"items":[1,2]}', "items")).toEqual([1, 2]);
    expect(parseJsonRecords("  ")).toEqual([]);
  });
  it("XML: flat records with entities", () => {
    expect(
      parseXmlRecords(
        "<r><item><sku>A&amp;B</sku><q>2</q></item><item><sku>C</sku></item></r>",
        "item",
      ),
    ).toEqual([{ sku: "A&B", q: "2" }, { sku: "C" }]);
  });
});

describe("object store", () => {
  it("key layout follows ADR-0008 decision 4", () => {
    expect(
      rawObjectKey({
        tenantId: "t",
        sellerAccountId: "s",
        syncKey: "k.k",
        at: new Date("2026-11-03T05:00:00Z"),
        runId: "r",
        part: 2,
      }),
    ).toBe("raw/t/s/k.k/2026/11/03/r/2");
  });
  it("memory store round-trips", async () => {
    const s = new MemoryObjectStore();
    await s.put("a", new Uint8Array([1]));
    expect(await s.get("a")).toEqual(new Uint8Array([1]));
    expect(await s.get("b")).toBeNull();
  });
  it("S3 store signs PUT/GET with SigV4 headers and never puts the secret on the wire", async () => {
    const seen: { url: string; method: string; headers: Record<string, string> }[] = [];
    const store = new S3ObjectStore({
      endpoint: "http://127.0.0.1:9000/",
      region: "us-east-1",
      bucket: "b",
      accessKey: "AK",
      secretKey: "SECRET-VALUE",
      fetchImpl: (async (url: URL, init: { method: string; headers: Record<string, string> }) => {
        seen.push({ url: String(url), method: init.method, headers: init.headers });
        return new Response(init.method === "GET" ? "hello" : "", { status: 200 });
      }) as never,
    });
    await store.put("raw/a b/1", new TextEncoder().encode("hello"), "text/plain");
    expect(new TextDecoder().decode((await store.get("raw/a b/1")) as Uint8Array)).toBe("hello");
    expect(seen[0]?.url).toBe("http://127.0.0.1:9000/b/raw/a%20b/1");
    expect(seen[0]?.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(seen[0]?.headers["x-amz-content-sha256"]).toBe(
      createHash("sha256").update("hello").digest("hex"),
    );
    expect(JSON.stringify(seen)).not.toContain("SECRET-VALUE");
  });
});
