import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

// Password hashing and opaque tokens (ADR-0004 decision 1): argon2id with the OWASP minimum parameters
// (19 MiB, t=2, p=1); sessions, setup tokens and invitation tokens are 32 random bytes shown once and stored as SHA-256.
// hash-wasm (WebAssembly, no native add-on) so that apps/api still bundles into one self-contained dist/main.js.

export const hashPassword = (password: string): Promise<string> =>
  argon2id({
    password,
    salt: randomBytes(16),
    parallelism: 1,
    iterations: 2,
    memorySize: 19456, // KiB
    hashLength: 32,
    outputType: "encoded", // $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
  });

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: stored });
  } catch {
    return false;
  }
}

/** A hash to verify against when the e-mail is unknown, so unknown and wrong-password answers cost the same time. */
let dummy: Promise<string> | undefined;
export const dummyHash = (): Promise<string> =>
  (dummy ??= hashPassword(randomBytes(16).toString("hex")));

export const newOpaqueToken = (): string => randomBytes(32).toString("base64url");
export const sha256 = (value: string): Buffer => createHash("sha256").update(value).digest();
export const safeEqual = (a: Buffer, b: Buffer): boolean =>
  a.length === b.length && timingSafeEqual(a, b);

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** Length and trivial-pattern policy (NIST 800-63B style: no composition rules). Returns a field error code or null. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return "too_short";
  if (password.length > PASSWORD_MAX) return "too_long";
  if (new Set(password).size < 5) return "too_simple";
  if (
    email &&
    password.toLowerCase().includes(email.split("@")[0]!.toLowerCase()) &&
    email.split("@")[0]!.length >= 4
  )
    return "contains_email";
  return null;
}
