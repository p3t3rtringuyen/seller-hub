import * as nodeCrypto from "node:crypto";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DomainError } from "@seller-hub/core";

// Password hashing and opaque tokens (ADR-0004 decision 1): argon2id with the OWASP minimum parameters
// (19 MiB, t=2, p=1); sessions, setup tokens and invitation tokens are 32 random bytes shown once and stored as SHA-256.
//
// Argon2 is CPU- and memory-heavy (~100 ms). It runs on libuv's thread pool through node:crypto's async argon2 (Node >= 24.7),
// never on the event loop, and a semaphore bounds how many hashes run at once and how many may wait: when the queue is full
// the caller gets a 503-class error instead of the whole API stalling (review M1). Where node:crypto has no argon2 (older
// 24.x) the WebAssembly implementation (hash-wasm) is the fallback; it blocks the loop, so production should run Node >= 24.7.

const PARAMS = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 } as const; // memory in KiB
const MAX_RUNNING = 4;
const MAX_QUEUED = 32;

interface Argon2Params {
  memory: number;
  passes: number;
  parallelism: number;
  tagLength: number;
}
type Argon2Fn = (
  algorithm: "argon2id",
  params: Argon2Params & { message: Buffer; nonce: Buffer },
  cb: (err: Error | null, key: Buffer) => void,
) => void;
const nativeArgon2 = (nodeCrypto as unknown as { argon2?: Argon2Fn }).argon2;

let running = 0;
const waiting: (() => void)[] = [];

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_RUNNING) {
    if (waiting.length >= MAX_QUEUED)
      throw new DomainError(
        "upstream_throttled",
        "server_busy",
        "The server is busy. Try again in a moment.",
      );
    await new Promise<void>((resolve) => waiting.push(resolve)); // the finishing task hands its slot over
  } else running++;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

function rawArgon2(message: string, nonce: Buffer, p: Argon2Params): Promise<Buffer> {
  if (nativeArgon2) {
    return new Promise((resolve, reject) =>
      nativeArgon2("argon2id", { message: Buffer.from(message, "utf8"), nonce, ...p }, (e, k) =>
        e ? reject(e) : resolve(Buffer.from(k)),
      ),
    );
  }
  return import("hash-wasm").then(async ({ argon2id }) =>
    Buffer.from(
      await argon2id({
        password: message,
        salt: nonce,
        parallelism: p.parallelism,
        iterations: p.passes,
        memorySize: p.memory,
        hashLength: p.tagLength,
        outputType: "binary",
      }),
    ),
  );
}

const b64 = (b: Buffer): string => b.toString("base64").replace(/=+$/, "");

/** PHC string `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` (the format earlier hashes already use, so they still verify). */
export const hashPassword = (password: string): Promise<string> =>
  slot(async () => {
    const salt = randomBytes(16);
    const key = await rawArgon2(password, salt, PARAMS);
    return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(salt)}$${b64(key)}`;
  });

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const m = PHC.exec(stored);
  if (!m) return false;
  const memory = Number(m[1]);
  const passes = Number(m[2]);
  const parallelism = Number(m[3]);
  if (memory > 65536 || passes > 6 || parallelism > 4) return false; // a stored string never picks absurd costs
  const salt = Buffer.from(m[4]!, "base64");
  const expected = Buffer.from(m[5]!, "base64");
  const actual = await slot(() =>
    rawArgon2(password, salt, { memory, passes, parallelism, tagLength: expected.length }),
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
