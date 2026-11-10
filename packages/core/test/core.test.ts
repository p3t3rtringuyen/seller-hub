import { describe, expect, it } from "vitest";
import {
  addDays,
  dateRange,
  isUuid,
  localDateOf,
  money,
  addMoney,
  percentOf,
  ratio,
  requireScope,
  resolveRequestId,
  roundMoney,
  todayIn,
  uuidv7,
} from "../src";

describe("ids", () => {
  it("generates time-ordered v7 uuids", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe("7");
    expect(a < b).toBe(true);
  });
  it("keeps a well-formed request id and replaces a bad one", () => {
    expect(resolveRequestId("req-12345678")).toBe("req-12345678");
    expect(isUuid(resolveRequestId("bad id!"))).toBe(true);
  });
});

describe("money", () => {
  it("does decimal arithmetic without float error", () => {
    expect(addMoney(money("0.1", "USD"), money("0.2", "USD")).amount).toBe("0.3");
    expect(percentOf(money("12.34", "USD"), "10").amount).toBe("1.234");
    expect(roundMoney(money("1.005", "USD"), 2).amount).toBe("1.01");
    expect(roundMoney(money("10.5", "JPY"), 0).amount).toBe("11");
  });
  it("refuses to mix currencies", () => {
    expect(() => addMoney(money("1", "USD"), money("1", "EUR"))).toThrow(/currency mismatch/);
  });
  it("returns null ratios for a zero denominator", () => {
    expect(ratio("3", "0")).toBeNull();
    expect(ratio("3", "12")).toBe("0.2500");
  });
});

describe("time", () => {
  it("computes the marketplace-local date, not the UTC date", () => {
    // 2026-11-10T03:00Z is still 2026-11-09 in Los Angeles (UTC-8).
    expect(localDateOf("2026-11-10T03:00:00Z", "America/Los_Angeles")).toBe("2026-11-09");
    expect(todayIn("Asia/Tokyo", new Date("2026-11-10T20:00:00Z"))).toBe("2026-11-11");
  });
  it("adds days and builds inclusive ranges", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(dateRange("2026-11-08", "2026-11-10")).toEqual([
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
    ]);
  });
});

describe("scope", () => {
  it("fails at runtime when the scope is missing", () => {
    expect(() => requireScope(undefined)).toThrow(/Scope/);
    expect(() => requireScope({ tenantId: "" })).toThrow(/Scope/);
    expect(requireScope({ tenantId: "t" }).tenantId).toBe("t");
  });
});
