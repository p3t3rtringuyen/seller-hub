import { describe, expect, it } from "vitest";
import { chunk, failedBatch, mapMultiStatus, mergeBatchResults } from "../src";

describe("207 mapping", () => {
  const inputs = [{ name: "a" }, { name: "b" }, { name: "c" }];

  it("v1: success[index] / error[index] become one result per input, in input order", () => {
    const r = mapMultiStatus(inputs, {
      success: [
        { index: 2, campaign: { campaignId: "C3" } },
        { index: 0, campaign: { campaignId: "C1" } },
      ],
      error: [
        {
          index: 1,
          errors: [{ code: "FIELD_VALUE_IS_INVALID", message: "bad name", fieldLocation: "/name" }],
        },
      ],
    });
    expect(r.items.map((i) => i.ok)).toEqual([true, false, true]);
    expect(r.items[0]).toMatchObject({
      index: 0,
      input: { name: "a" },
      entity: { campaignId: "C1" },
    });
    expect(r.items[1]).toMatchObject({
      ok: false,
      errors: [{ code: "FIELD_VALUE_IS_INVALID", message: "bad name", fieldLocation: "/name" }],
      retryable: false,
    });
    expect(r).toMatchObject({ succeeded: 2, failed: 1, allOk: false, partial: true });
  });

  it("never treats an item Amazon did not mention as success", () => {
    const r = mapMultiStatus(inputs, { success: [{ index: 0, campaign: {} }], error: [] });
    // A write whose outcome is unknown is never retryable: it may already have been applied (M3, ADR-0006).
    expect(r.items[1]).toMatchObject({
      ok: false,
      errors: [{ code: "outcome_unknown" }],
      retryable: false,
    });
    expect(r.items[2]?.ok).toBe(false);
    expect(r.allOk).toBe(false);
  });

  it("an item missing from a READ is retryable (repeating a read is harmless)", () => {
    const r = mapMultiStatus(
      inputs,
      { success: [{ index: 0, campaign: {} }] },
      { idempotent: true },
    );
    expect(r.items[1]).toMatchObject({ errors: [{ code: "missing_result" }], retryable: true });
  });

  it("a 207 with only errors is a total failure, not a success", () => {
    const r = mapMultiStatus(inputs, {
      error: inputs.map((_x, index) => ({ index, errors: [{ code: "FORBIDDEN", message: "no" }] })),
    });
    expect(r).toMatchObject({ succeeded: 0, failed: 3, partial: false, allOk: false });
  });

  it("marks transient item errors retryable", () => {
    const r = mapMultiStatus([{}, {}], {
      error: [
        { index: 0, errors: [{ code: "INTERNAL_ERROR" }] },
        { index: 1, errors: [{ code: "INTERNAL_ERROR" }, { code: "FIELD_VALUE_IS_INVALID" }] },
      ],
      success: [],
    });
    expect(r.items.map((i) => !i.ok && i.retryable)).toEqual([true, false]);
  });

  it("v0 (SP v3 style): reads the wrapper key and errorType/errorValue", () => {
    const r = mapMultiStatus(
      inputs.slice(0, 2),
      {
        campaigns: {
          success: [{ index: 0, campaignId: "C1", campaign: { campaignId: "C1" } }],
          error: [
            {
              index: 1,
              errors: [
                {
                  errorType: "malformedValueError",
                  errorValue: { malformedValueError: { message: "bad budget" } },
                },
              ],
            },
          ],
        },
      },
      { wrapperKey: "campaigns", entityKey: "campaign" },
    );
    expect(r.items[0]).toMatchObject({ ok: true, entity: { campaignId: "C1" } });
    expect(r.items[1]).toMatchObject({
      ok: false,
      errors: [{ code: "malformedValueError", message: "bad budget" }],
    });
  });

  it("applies an offset when a chunk is part of a bigger batch", () => {
    const r = mapMultiStatus(
      [{}, {}],
      {
        success: [
          { index: 1000, target: { id: "T1" } },
          { index: 1001, target: { id: "T2" } },
        ],
      },
      { offset: 1000 },
    );
    expect(r.allOk).toBe(true);
  });

  it("ignores out-of-range indexes instead of crashing", () => {
    const r = mapMultiStatus([{}], {
      success: [{ index: 5, x: {} }],
      error: [{ index: -1, errors: [] }],
    });
    expect(r.items[0]).toMatchObject({ ok: false });
  });
});

describe("chunking", () => {
  it("splits by the batch maximum and merges results back in order", () => {
    const items = Array.from({ length: 2500 }, (_, i) => i);
    const parts = chunk(items, 1000);
    expect(parts.map((p) => p.length)).toEqual([1000, 1000, 500]);
    const merged = mergeBatchResults(
      parts.map((p) =>
        mapMultiStatus(p, { success: p.map((_x, index) => ({ index, e: { ok: 1 } })) }),
      ),
    );
    expect(merged.items).toHaveLength(2500);
    expect(merged.items[1500]).toMatchObject({ index: 1500, input: 1500, ok: true });
    expect(merged.allOk).toBe(true);
  });

  it("rejects a nonsensical batch size", () => {
    expect(() => chunk([1], 0)).toThrow();
  });

  it("failedBatch fails every item with the same error", () => {
    const r = failedBatch([1, 2], { code: "TOO_MANY_REQUESTS" }, true);
    expect(r).toMatchObject({ failed: 2, succeeded: 0 });
    expect(r.items.every((i) => !i.ok && i.retryable)).toBe(true);
  });
});
