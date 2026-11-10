import { describe, expect, it } from "vitest";
import { loadConfig, resolvePorts } from "../src";

const required = {
  SH_PG_OWNER_PASSWORD: "x",
  SH_PG_APP_PASSWORD: "y",
  SH_S3_ACCESS_KEY: "a",
  SH_S3_SECRET_KEY: "b",
};

describe("ports", () => {
  it("uses non-default ports and shifts with SH_PORT_OFFSET", () => {
    expect(resolvePorts({}).pg).toBe(55432);
    expect(resolvePorts({ SH_PORT_OFFSET: "10" }).pg).toBe(55442);
    expect(resolvePorts({ SH_PORT_OFFSET: "10", SH_PG_PORT: "1234" }).pg).toBe(1234);
  });
});

describe("loadConfig", () => {
  it("fails closed on missing secrets and names only the variables", () => {
    expect(() => loadConfig({})).toThrow(/SH_PG_OWNER_PASSWORD/);
  });
  it("derives urls from the offset", () => {
    const c = loadConfig({ ...required, SH_PORT_OFFSET: "5" });
    expect(c.databaseUrl).toContain(":55437/");
    expect(c.redisUrl).toBe("redis://127.0.0.1:56384");
  });
});
