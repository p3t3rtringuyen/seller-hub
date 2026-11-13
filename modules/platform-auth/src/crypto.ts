import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

// Password hashing and opaque tokens (ADR-0004 decision 1): argon2id with the OWASP minimum parameters
// (19 MiB, t=2, p=1); sessions, setup tokens and invitation tokens are 32 random bytes shown once and stored as SHA-256.

const ARGON2 = {
  algorithm: 2 /* Algorithm.Argon2id (const enum) */,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (password: string): Promise<string> => hash(password, ARGON2);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
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
