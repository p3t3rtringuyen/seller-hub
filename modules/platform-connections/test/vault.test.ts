import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  envKeyProvider,
  memoryKeyProvider,
  open,
  rewrap,
  seal,
  VaultConfigError,
  type CredentialAad,
} from "../src/vault/envelope";

const key = () => randomBytes(32);
const aad: CredentialAad = {
  tenantId: "t1",
  sellerAccountId: "s1",
  kind: "ads_refresh",
  region: "NA",
};
const SECRET = "Atzr|super-secret-refresh-token";

describe("envelope encryption (ADR-0005)", () => {
  const keys = memoryKeyProvider(new Map([["k1", key()]]), "k1");

  it("round-trips and never stores the plaintext", async () => {
    const sealed = await seal(keys, aad, SECRET);
    expect(sealed.kekId).toBe("k1");
    for (const part of [sealed.ciphertext, sealed.wrappedDek, sealed.iv, sealed.authTag])
      expect(part.toString("utf8")).not.toContain("super-secret");
    expect(await open(keys, aad, sealed)).toBe(SECRET);
  });

  it("two seals of the same secret differ (fresh DEK and IV each time)", async () => {
    const a = await seal(keys, aad, SECRET);
    const b = await seal(keys, aad, SECRET);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
  });

  it.each([
    ["tenant", { ...aad, tenantId: "t2" }],
    ["seller account", { ...aad, sellerAccountId: "s2" }],
    ["kind", { ...aad, kind: "spapi_refresh" }],
    ["region", { ...aad, region: "EU" }],
  ])("a ciphertext moved to another %s fails to decrypt (AAD)", async (_n, other) => {
    const sealed = await seal(keys, aad, SECRET);
    await expect(open(keys, other, sealed)).rejects.toThrow();
  });

  it("a tampered ciphertext or tag fails", async () => {
    const sealed = await seal(keys, aad, SECRET);
    const bad = {
      ...sealed,
      ciphertext: Buffer.from(sealed.ciphertext.map((b, i) => (i === 0 ? b ^ 1 : b))),
    };
    await expect(open(keys, aad, bad)).rejects.toThrow();
    await expect(open(keys, aad, { ...sealed, authTag: randomBytes(16) })).rejects.toThrow();
  });

  it("KEK rotation re-wraps the DEK, keeps the plaintext, and the old key can then be retired", async () => {
    const k1 = key();
    const old = memoryKeyProvider(new Map([["k1", k1]]), "k1");
    const sealed = await seal(old, aad, SECRET);
    const ring = new Map([
      ["k1", k1],
      ["k2", key()],
    ]);
    const rotated = memoryKeyProvider(ring, "k2");
    const re = await rewrap(rotated, aad, sealed);
    expect(re.kekId).toBe("k2");
    expect(re.ciphertext.equals(sealed.ciphertext)).toBe(true); // ciphertext untouched
    const retired = memoryKeyProvider(new Map([["k2", ring.get("k2")!]]), "k2");
    expect(await open(retired, aad, re)).toBe(SECRET);
    await expect(open(retired, aad, sealed)).rejects.toThrow(VaultConfigError);
  });

  it("derives stable, purpose-bound subkeys", () => {
    expect(keys.derive("a").equals(keys.derive("a"))).toBe(true);
    expect(keys.derive("a").equals(keys.derive("b"))).toBe(false);
    expect(keys.derive("a")).toHaveLength(32);
  });
});

describe("envKeyProvider fails closed", () => {
  const b64 = (n = 32) => randomBytes(n).toString("base64");
  it("refuses to start without a key", () => {
    expect(() => envKeyProvider({})).toThrow(/required/);
    expect(() => envKeyProvider({ SH_MASTER_KEY: "  " })).toThrow(/required/);
  });
  it("refuses malformed keys without echoing them", () => {
    const bad = b64(16);
    expect(() => envKeyProvider({ SH_MASTER_KEY: bad })).toThrow(/32 bytes/);
    try {
      envKeyProvider({ SH_MASTER_KEY: bad });
    } catch (e) {
      expect((e as Error).message).not.toContain(bad);
    }
    expect(() => envKeyProvider({ SH_MASTER_KEY: "not base64 !!!" })).toThrow(VaultConfigError);
    expect(() => envKeyProvider({ SH_MASTER_KEYS: "nokid" })).toThrow(/kid:base64/);
  });
  it("refuses the dev-only placeholder in production, as a single key or in a ring (review m6)", () => {
    const dev = "ZGV2LW9ubHktbWFzdGVyLWtleS1zZWxsZXItaHViISE=";
    expect(() => envKeyProvider({ NODE_ENV: "production", SH_MASTER_KEY: dev })).toThrow(
      /dev-only/,
    );
    expect(() => envKeyProvider({ NODE_ENV: "production", SH_MASTER_KEYS: `k1:${dev}` })).toThrow(
      /dev-only/,
    );
    expect(envKeyProvider({ NODE_ENV: "development", SH_MASTER_KEYS: `k1:${dev}` }).activeKid).toBe(
      "k1",
    );
  });
  it("reads a single key, a key ring and the active kid", async () => {
    expect(envKeyProvider({ SH_MASTER_KEY: b64() }).activeKid).toBe("default");
    const ring = envKeyProvider({ SH_MASTER_KEYS: `a:${b64()},b:${b64()}` });
    expect(ring.activeKid).toBe("a");
    expect(
      envKeyProvider({ SH_MASTER_KEYS: `a:${b64()},b:${b64()}`, SH_MASTER_KEY_ACTIVE: "b" })
        .activeKid,
    ).toBe("b");
    expect(() =>
      envKeyProvider({ SH_MASTER_KEYS: `a:${b64()}`, SH_MASTER_KEY_ACTIVE: "zzz" }),
    ).toThrow(/not in/);
  });
});
