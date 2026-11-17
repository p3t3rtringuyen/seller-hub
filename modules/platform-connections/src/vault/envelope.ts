import { DEV_ONLY_VALUES } from "@seller-hub/config";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Credential vault, envelope encryption (ADR-0005). Per credential: a fresh 32-byte data key (DEK) encrypts the secret
// with AES-256-GCM; the DEK is wrapped by a key-encryption key (KEK) from a KeyProvider. The AAD binds the ciphertext to
// `tenant_id|seller_account_id|kind|region`, so a row copied to another seller account fails to decrypt.

export interface KeyProvider {
  /** Id of the KEK that wraps new data keys. */
  readonly activeKid: string;
  wrap(dek: Buffer, aad: Buffer): Promise<{ kid: string; wrapped: Buffer }>;
  unwrap(kid: string, wrapped: Buffer, aad: Buffer): Promise<Buffer>;
  /** True when this provider can unwrap keys of `kid` (a retired KEK must stay available until `vault.rewrap` ran). */
  has(kid: string): boolean;
  /** A 32-byte purpose-bound subkey of the active KEK (for example the Redis access-token cache cipher). */
  derive(purpose: string): Buffer;
}

export interface SealedSecret {
  kekId: string;
  wrappedDek: Buffer;
  iv: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
}

export interface CredentialAad {
  tenantId: string;
  sellerAccountId: string;
  kind: string;
  region: string;
}

export const aadOf = (a: CredentialAad): Buffer =>
  Buffer.from(`${a.tenantId}|${a.sellerAccountId}|${a.kind}|${a.region}`, "utf8");

export async function seal(
  keys: KeyProvider,
  aadFields: CredentialAad,
  plaintext: string,
): Promise<SealedSecret> {
  const aad = aadOf(aadFields);
  const dek = randomBytes(32);
  try {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", dek, iv);
    c.setAAD(aad);
    const ciphertext = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
    const { kid, wrapped } = await keys.wrap(dek, aad);
    return { kekId: kid, wrappedDek: wrapped, iv, ciphertext, authTag: c.getAuthTag() };
  } finally {
    dek.fill(0);
  }
}

export async function open(
  keys: KeyProvider,
  aadFields: CredentialAad,
  sealed: SealedSecret,
): Promise<string> {
  const aad = aadOf(aadFields);
  const dek = await keys.unwrap(sealed.kekId, sealed.wrappedDek, aad);
  try {
    const d = createDecipheriv("aes-256-gcm", dek, sealed.iv);
    d.setAAD(aad);
    d.setAuthTag(sealed.authTag);
    return Buffer.concat([d.update(sealed.ciphertext), d.final()]).toString("utf8");
  } finally {
    dek.fill(0);
  }
}

/** Re-wraps the DEK under the active KEK without touching the ciphertext (KEK rotation, ADR-0005 decision 5). */
export async function rewrap(
  keys: KeyProvider,
  aadFields: CredentialAad,
  sealed: SealedSecret,
): Promise<SealedSecret> {
  const aad = aadOf(aadFields);
  const dek = await keys.unwrap(sealed.kekId, sealed.wrappedDek, aad);
  try {
    const { kid, wrapped } = await keys.wrap(dek, aad);
    return { ...sealed, kekId: kid, wrappedDek: wrapped };
  } finally {
    dek.fill(0);
  }
}

// --- self-host KeyProvider: KEKs from the environment --------------------------------------------------------------

export class VaultConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultConfigError";
  }
}

/**
 * `SH_MASTER_KEYS` = comma list `kid:base64(32 bytes)` (first is active unless `SH_MASTER_KEY_ACTIVE` names another),
 * or the single-key `SH_MASTER_KEY` = base64(32 bytes) with kid `default`. Fails closed: absent or malformed is an
 * error at boot, never a silent fallback (conventions §7). Messages carry names and kids, never key material.
 */
export function envKeyProvider(env: Record<string, string | undefined> = process.env): KeyProvider {
  const ring = new Map<string, Buffer>();
  const list = env.SH_MASTER_KEYS?.trim();
  if (list) {
    for (const part of list.split(",")) {
      const idx = part.indexOf(":");
      const kid = part.slice(0, idx).trim();
      const b64 = part.slice(idx + 1).trim();
      if (idx < 1 || !/^[A-Za-z0-9_.-]{1,40}$/.test(kid))
        throw new VaultConfigError(
          "SH_MASTER_KEYS: each entry must be kid:base64 (kid of 1-40 safe characters)",
        );
      ring.set(kid, decodeKey(b64, `SH_MASTER_KEYS (${kid})`));
    }
  } else if (env.SH_MASTER_KEY?.trim()) {
    ring.set("default", decodeKey(env.SH_MASTER_KEY.trim(), "SH_MASTER_KEY"));
  } else {
    throw new VaultConfigError(
      "SH_MASTER_KEY (or SH_MASTER_KEYS) is required: the credential vault cannot start without a key",
    );
  }
  if (env.NODE_ENV === "production") {
    // The dev placeholder of .env.example must never protect real credentials, whichever variable carries it (review m6).
    for (const [kid, key] of ring)
      if (DEV_ONLY_VALUES.has(key.toString("base64")))
        throw new VaultConfigError(
          `master key "${kid}" is the dev-only placeholder; generate a real one for production`,
        );
  }
  const activeKid = env.SH_MASTER_KEY_ACTIVE?.trim() || [...ring.keys()][0]!;
  if (!ring.has(activeKid))
    throw new VaultConfigError(
      `SH_MASTER_KEY_ACTIVE names "${activeKid}", which is not in SH_MASTER_KEYS`,
    );
  return memoryKeyProvider(ring, activeKid);
}

function decodeKey(b64: string, name: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== b64.replace(/=+$/, ""))
    throw new VaultConfigError(`${name} must be 32 bytes, base64-encoded`);
  return key;
}

export function memoryKeyProvider(
  ring: ReadonlyMap<string, Buffer>,
  activeKid: string,
): KeyProvider {
  return {
    activeKid,
    has: (kid) => ring.has(kid),
    derive: (purpose) =>
      Buffer.from(
        hkdfSync("sha256", ring.get(activeKid)!, Buffer.alloc(0), `seller-hub:${purpose}`, 32),
      ),
    async wrap(dek, aad) {
      const kek = ring.get(activeKid)!;
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", kek, iv);
      c.setAAD(aad);
      const ct = Buffer.concat([c.update(dek), c.final()]);
      return { kid: activeKid, wrapped: Buffer.concat([iv, c.getAuthTag(), ct]) };
    },
    async unwrap(kid, wrapped, aad) {
      const kek = ring.get(kid);
      if (!kek)
        throw new VaultConfigError(`the key "${kid}" that sealed this credential is not available`);
      const d = createDecipheriv("aes-256-gcm", kek, wrapped.subarray(0, 12));
      d.setAAD(aad);
      d.setAuthTag(wrapped.subarray(12, 28));
      return Buffer.concat([d.update(wrapped.subarray(28)), d.final()]);
    },
  };
}
