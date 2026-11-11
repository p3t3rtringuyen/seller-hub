import { describe, expect, it } from "vitest";
import { contractOperations, createApiClient, openapiDocument, zodForComponent } from "../src";

describe("contract bundle", () => {
  it("contains the system probes with x-public and no permission", () => {
    const health = contractOperations.find((o) => o.operationId === "system.getHealth");
    expect(health).toMatchObject({
      path: "/healthz",
      method: "get",
      permission: null,
      scope: "none",
    });
    expect(openapiDocument.openapi).toBe("3.1.0");
  });

  it("every operation declares a permission or is a system probe", () => {
    for (const op of contractOperations) {
      expect(op.permission !== null || op.scope === "none").toBe(true);
    }
  });
});

describe("zod from the contract", () => {
  it("validates Money like the contract does", () => {
    const money = zodForComponent("Money");
    expect(money.safeParse({ amount: "12.34", currency: "USD" }).success).toBe(true);
    expect(money.safeParse({ amount: 12.34, currency: "USD" }).success).toBe(false);
    expect(money.safeParse({ amount: "12.34", currency: "usd" }).success).toBe(false);
  });
});

describe("typed client", () => {
  it("calls the typed path and returns the typed body", async () => {
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetch: async () => Response.json({ status: "ok" }),
    });
    const { data, error } = await client.GET("/healthz");
    expect(error).toBeUndefined();
    expect(data?.status).toBe("ok");
  });
});
