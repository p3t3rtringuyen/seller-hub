import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/crypto";

describe("argon2id off the event loop", () => {
  it("hashes and verifies; a wrong password and a garbage hash fail", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(h.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
    expect(await verifyPassword(h, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect(await verifyPassword("nonsense", "x")).toBe(false);
    expect(await verifyPassword(h.replace("m=19456", "m=9999999"), "x")).toBe(false);
  });
  it("verifies a hash made by hash-wasm earlier (same PHC format)", async () => {
    const { argon2id } = await import("hash-wasm");
    const old = await argon2id({
      password: "legacy password here",
      salt: Buffer.alloc(16, 7),
      parallelism: 1,
      iterations: 2,
      memorySize: 19456,
      hashLength: 32,
      outputType: "encoded",
    });
    expect(await verifyPassword(old, "legacy password here")).toBe(true);
  });
  it("keeps the event loop responsive while hashing", async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    await Promise.all(Array.from({ length: 6 }, () => hashPassword("some long password")));
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(5);
  });
  it("answers server_busy when the queue is full instead of stalling", async () => {
    const jobs = Array.from({ length: 80 }, () =>
      hashPassword("queue test password").then(
        () => "ok",
        (e: { code?: string }) => e.code,
      ),
    );
    const results = await Promise.all(jobs);
    expect(results).toContain("server_busy");
    expect(results).toContain("ok");
  });
});
