import { describe, expect, it } from "vitest";
import { bffTarget } from "./bff-target";

const API = "http://127.0.0.1:4100";

describe("bffTarget (SSRF guard)", () => {
  it("maps a /v1 path to the API origin and keeps the query", () => {
    expect(bffTarget(["v1", "seller-accounts", "x"], API, "?a=1")?.href).toBe(
      `${API}/v1/seller-accounts/x?a=1`,
    );
  });
  it("rejects a decoded %2F%2Fhost segment (protocol-relative URL)", () => {
    expect(bffTarget(["//127.0.0.1:4500", "steal"], API)).toBeNull();
    expect(bffTarget(["v1", "//evil.test", "x"], API)?.origin).toBe(API); // stays on the API origin, encoded
    expect(bffTarget(["v1", "//evil.test", "x"], API)?.pathname).toBe("/v1/%2F%2Fevil.test/x");
  });
  it("rejects paths outside /v1/, dot segments and empty segments", () => {
    expect(bffTarget(["healthz"], API)).toBeNull();
    expect(bffTarget(["v1", "..", "x"], API)).toBeNull();
    expect(bffTarget(["v1", "", "x"], API)).toBeNull();
    expect(bffTarget(["v1"], API)).toBeNull();
  });
});
