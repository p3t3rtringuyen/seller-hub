import { describe, expect, it } from "vitest";
import { metrics, sumRatio } from "../src";

describe("sumRatio", () => {
  it("divides summed numerators by summed denominators (never averages ratios)", () => {
    const rows = [
      { spend: "10", sales: "100" },
      { spend: "30", sales: "100" },
    ];
    // average of 10% and 30% would be 20%; the pooled ratio is 40/200 = 20% too, so use uneven rows:
    expect(
      sumRatio(
        [
          { spend: "10", sales: "10" },
          { spend: "30", sales: "90" },
        ],
        "spend",
        "sales",
      ),
    ).toBe("0.4000");
    expect(sumRatio(rows, "spend", "sales")).toBe("0.2000");
  });
  it("is null when the denominator is zero", () => {
    expect(sumRatio([{ spend: "5", sales: "0" }], "spend", "sales")).toBeNull();
  });
});

describe("registry", () => {
  it("exposes generated definitions", () => {
    expect(Array.isArray(metrics)).toBe(true);
  });
});
