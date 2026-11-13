import { describe, expect, it } from "vitest";
import {
  emptyColumnState,
  hideAll,
  moveColumn,
  orderedIds,
  pinColumn,
  pinningFor,
  resetOrder,
  showAll,
  toggleHidden,
  unpinAll,
  visibleIds,
} from "./datagrid/columnState";
import {
  addDays,
  autofillCompareEnd,
  compareParams,
  previousPeriod,
  presetRange,
  rangeLength,
  validateRange,
} from "./dates/dates";
import {
  carryOver,
  currencyDecimals,
  currencySymbol,
  sanitizeDecimal,
  sanitizeInteger,
  sanitizeNumeric,
} from "./fields/sanitize";
import { format } from "./messages";
import {
  buildQuery,
  historyMode,
  listingParam,
  parseChain,
  parseQuery,
  stringifyQuery,
  type UrlSchema,
} from "./url/urlState";

describe("numeric sanitizers (UX-01)", () => {
  it("money keeps digits and one dot: 1e5E.3-+x.9 -> 15.39", () => {
    expect(sanitizeNumeric("money", "1e5E.3-+x.9")).toBe("15.39");
  });
  it("whole numbers keep the integer part: 1e5E.3-+x.9 -> 15", () => {
    expect(sanitizeInteger("1e5E.3-+x.9")).toBe("15");
  });
  it("never strips the dot from money (a bid is 0.35)", () => {
    expect(sanitizeDecimal("0.35")).toBe("0.35");
    expect(sanitizeDecimal(".5")).toBe("0.5");
  });
  it("cuts the fraction to the currency exponent", () => {
    expect(sanitizeDecimal("1.239", { decimals: 2 })).toBe("1.23");
    expect(sanitizeDecimal("12.9", { decimals: 0 })).toBe("12");
  });
  it("caps while typing: the keystroke over the maximum is refused", () => {
    expect(sanitizeInteger("1000", { max: 900 }, "100")).toBe("100");
    expect(sanitizeDecimal("10001", { max: 10000 }, "1000")).toBe("1000");
  });
  it("trims a carried value when a field switches from money to percent", () => {
    expect(carryOver("12.50", "percent")).toBe("12");
  });
  it("takes the symbol and exponent from the currency, not a literal $", () => {
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("JPY")).toBe("¥");
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("USD")).toBe(2);
  });
});

describe("column state (UX-10)", () => {
  const cols = [
    { id: "a" },
    { id: "b" },
    { id: "c", hideable: false },
    { id: "d", pinnable: false },
  ];
  it("falls back to definition order and appends columns the saved order does not know", () => {
    expect(orderedIds(cols, { ...emptyColumnState, order: ["b", "zzz"] })).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });
  it("hides and shows, but never hides a non-hideable column", () => {
    const hidden = hideAll(cols, emptyColumnState);
    expect(visibleIds(cols, hidden)).toEqual(["c"]);
    expect(visibleIds(cols, showAll(cols, hidden))).toEqual(["a", "b", "c", "d"]);
    expect(toggleHidden(cols, emptyColumnState, "c")).toBe(emptyColumnState);
  });
  it("moves a column and resets to the default order", () => {
    const moved = moveColumn(cols, emptyColumnState, "d", 0);
    expect(orderedIds(cols, moved)).toEqual(["d", "a", "b", "c"]);
    expect(orderedIds(cols, resetOrder(moved))).toEqual(["a", "b", "c", "d"]);
  });
  it("pins to a side, unpins on the second click, and unpins all", () => {
    const left = pinColumn(cols, emptyColumnState, "a", "left");
    expect(pinningFor(cols, left)).toEqual({ left: ["a"], right: [] });
    expect(pinColumn(cols, left, "a", "left").pinned).toEqual({});
    const both = pinColumn(cols, left, "b", "right");
    expect(pinningFor(cols, both)).toEqual({ left: ["a"], right: ["b"] });
    expect(unpinAll(both).pinned).toEqual({});
    expect(pinColumn(cols, emptyColumnState, "d", "left")).toBe(emptyColumnState);
  });
});

describe("date ranges (UX-17)", () => {
  const ctx = { today: "2026-11-12", lifetimeStart: "2020-03-01" };
  it("computes presets from the marketplace 'today', Monday weeks", () => {
    expect(presetRange("today", ctx)).toEqual({ from: "2026-11-12", to: "2026-11-12" });
    expect(presetRange("last7", ctx)).toEqual({ from: "2026-11-06", to: "2026-11-12" });
    expect(presetRange("thisWeek", ctx)).toEqual({ from: "2026-11-09", to: "2026-11-12" });
    expect(presetRange("lastWeek", ctx)).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(presetRange("lastMonth", ctx)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetRange("thisYear", ctx)).toEqual({ from: "2026-01-01", to: "2026-11-12" });
    expect(presetRange("lifetime", ctx)).toEqual({ from: "2020-03-01", to: "2026-11-12" });
  });
  it("handles month and year boundaries", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(presetRange("lastMonth", { today: "2026-01-15" })).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });
  it("previous period has the same length and ends the day before", () => {
    const main = { from: "2026-10-14", to: "2026-11-12" };
    const prev = previousPeriod(main);
    expect(rangeLength(prev)).toBe(rangeLength(main));
    expect(prev.to).toBe("2026-10-13");
  });
  it("compare End autofills Start + length of the main range", () => {
    expect(autofillCompareEnd("2026-09-14", { from: "2026-10-14", to: "2026-11-12" })).toBe(
      "2026-10-13",
    );
  });
  it("rejects future days and End before Start; compare is sent only when both ends are set", () => {
    expect(
      validateRange({ from: "2026-11-10", to: "2026-11-20" }, { enabled: false }, ctx),
    ).toEqual([{ field: "to", code: "future" }]);
    expect(
      validateRange({ from: "2026-11-10", to: "2026-11-09" }, { enabled: false }, ctx),
    ).toEqual([{ field: "to", code: "endBeforeStart" }]);
    expect(compareParams({ enabled: true, from: "2026-11-01" })).toBeNull();
    expect(compareParams({ enabled: true, from: "2026-11-01", to: "2026-11-05" })).toEqual({
      from: "2026-11-01",
      to: "2026-11-05",
    });
  });
});

describe("URL state chain (UX-07..09)", () => {
  const schema: UrlSchema = {
    tabs: {
      campaigns: { modals: ["edit-rule"] },
      "ad-groups": { subs: ["settings", "history"], modals: ["edit-ad-group"] },
    },
    shared: ["profile", "from", "to", "pageSize"],
  };
  it("drops a level that is not valid under its parent", () => {
    const parsed = parseChain(
      { tab: "campaigns", sub: "history", modal: "edit-rule", id: "42" },
      schema,
    );
    // The sub-tab is not valid under this tab, so everything below it goes too.
    expect(parsed.state).toEqual({ tab: "campaigns" });
    expect(parsed.dropped).toEqual(["sub", "modal", "id"]);
    expect(parseChain({ tab: "campaigns", modal: "edit-rule", id: "42" }, schema).state).toEqual({
      tab: "campaigns",
      modal: "edit-rule",
      id: "42",
    });
  });
  it("drops an unknown tab and everything it owned", () => {
    expect(parseChain({ tab: "nope", modal: "edit-rule" }, schema).dropped).toEqual(["tab"]);
  });
  it("changing a level clears everything below it", () => {
    const current = { tab: "ad-groups", sub: "settings", modal: "edit-ad-group", id: "7", q: "x" };
    expect(buildQuery(current, { tab: "campaigns" }, schema)).toEqual({ q: "x" });
    expect(buildQuery(current, { sub: "history" }, schema)).toEqual({
      tab: "ad-groups",
      sub: "history",
      q: "x",
    });
    expect(buildQuery(current, { modal: undefined, id: undefined }, schema)).toEqual({
      tab: "ad-groups",
      sub: "settings",
      q: "x",
    });
  });
  it("opening a modal pushes, closing replaces", () => {
    expect(
      historyMode({ tab: "campaigns" }, { tab: "campaigns", modal: "edit-rule", id: "1" }),
    ).toBe("push");
    expect(historyMode({ tab: "campaigns", modal: "edit-rule" }, { tab: "campaigns" })).toBe(
      "replace",
    );
  });
  it("first tab keeps bare listing names, others are prefixed, shared params never are", () => {
    expect(listingParam(schema, "campaigns", "q")).toBe("q");
    expect(listingParam(schema, "ad-groups", "q")).toBe("ad-groups.q");
    expect(listingParam(schema, "ad-groups", "from")).toBe("from");
  });
  it("writes readable query strings", () => {
    expect(
      stringifyQuery({ range: "2026-11-01/2026-11-12", ids: "a,b", t: "10:30", empty: "" }),
    ).toBe("?range=2026-11-01/2026-11-12&ids=a,b&t=10:30");
    expect(parseQuery("?a=1%2F2&b=x+y")).toEqual({ a: "1/2", b: "x y" });
  });
});

describe("messages", () => {
  it("interpolates variables and leaves unknown ones", () => {
    expect(format("{from}–{to} of {total}", { from: 1, to: 25, total: 312 })).toBe("1–25 of 312");
    expect(format("hi {name}", {})).toBe("hi {name}");
  });
});
