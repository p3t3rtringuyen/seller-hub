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
    expect(resolvePorts({ SH_PORT_OFFSET: "100" }).pg).toBe(55532);
    expect(resolvePorts({ SH_PORT_OFFSET: "100", SH_PG_PORT: "1234" }).pg).toBe(1234);
  });
});

describe("loadConfig", () => {
  it("fails closed on missing secrets and names only the variables", () => {
    expect(() => loadConfig({})).toThrow(/SH_PG_OWNER_PASSWORD/);
  });
  it("derives urls from the offset", () => {
    const c = loadConfig({ ...required, SH_PORT_OFFSET: "100" });
    expect(c.databaseUrl).toContain(":55532/");
    expect(c.redisUrl).toBe("redis://127.0.0.1:56479");
  });

  it("refuses dev-only placeholder secrets in production", () => {
    const dev = { ...required, SH_PG_OWNER_PASSWORD: "sh_owner_dev_only", NODE_ENV: "production" };
    expect(() => loadConfig(dev)).toThrow(/SH_PG_OWNER_PASSWORD/);
    expect(loadConfig({ ...dev, NODE_ENV: "development" }).env.NODE_ENV).toBe("development");
    expect(loadConfig({ ...required, NODE_ENV: "production" }).env.NODE_ENV).toBe("production");
  });
});

describe("port offsets (S8)", () => {
  it("accepts only multiples of 100 up to 900", () => {
    for (const bad of ["1", "50", "150", "1000", "-100"]) {
      expect(() => resolvePorts({ SH_PORT_OFFSET: bad })).toThrow(/multiple of 100/);
    }
    expect(resolvePorts({ SH_PORT_OFFSET: "900" }).web).toBe(4000);
  });
  it("never lets two services of any valid offset share a port", () => {
    const all = new Map<number, string>();
    for (let off = 0; off <= 900; off += 100) {
      for (const [name, port] of Object.entries(resolvePorts({ SH_PORT_OFFSET: String(off) }))) {
        expect(all.has(port), `${name}@${off} collides with ${all.get(port)}`).toBe(false);
        all.set(port, `${name}@${off}`);
      }
    }
  });
});
