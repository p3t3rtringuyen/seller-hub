import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Symmetric encryption for values that sit in Redis (access tokens). ADR-0006: the token cache is encrypted. */
export interface Cipher {
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
}

/** AES-256-GCM; output is base64(iv ‖ tag ‖ ciphertext). The key is 32 bytes (e.g. derived from the vault master key). */
export function createAesGcmCipher(key: Uint8Array): Cipher {
  if (key.length !== 32) throw new Error("cipher key must be 32 bytes");
  const k = Buffer.from(key);
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", k, iv);
      const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
    },
    decrypt(sealed) {
      const raw = Buffer.from(sealed, "base64");
      if (raw.length < 28) throw new Error("sealed value too short");
      const d = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
    },
  };
}
