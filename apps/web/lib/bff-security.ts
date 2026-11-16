import { randomBytes, timingSafeEqual } from "node:crypto";

// Session cookie and CSRF rules of the BFF (ADR-0003, ADR-0004). Pure functions so they are unit-tested; the route
// handler only wires them to Request/Response.
//
//  - The session token lives ONLY in an httpOnly cookie that the BFF sets from the API's `x-sh-session` header and turns
//    into `Authorization: Bearer` on the way back. No identity or Amazon token ever reaches browser JavaScript.
//  - Behind HTTPS (SH_WEB_PUBLIC_URL starts with https:// - for example Cloudflare Tunnel in front of the staging
//    server) cookies are `Secure` and `__Host-` prefixed (no Domain, Path=/), which also stops cookie tossing from
//    sibling subdomains.
//  - CSRF: every mutating request needs (1) an Origin that matches the public URL, and (2) the double-submit token: the
//    `x-csrf-token` header must equal the csrf cookie. SameSite=Lax on both cookies is the third layer.

export type SecurityEnv = Record<string, string | undefined>;

export interface CookieNames {
  session: string;
  csrf: string;
  secure: boolean;
}

export const isSecureUrl = (publicUrl: string): boolean =>
  publicUrl.toLowerCase().startsWith("https://");

export function cookieNames(publicUrl: string): CookieNames {
  const secure = isSecureUrl(publicUrl);
  return {
    secure,
    session: secure ? "__Host-sh_session" : "sh_session",
    csrf: secure ? "__Host-sh_csrf" : "sh_csrf",
  };
}

export function parseCookies(header: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    if (!out.has(name)) out.set(name, part.slice(i + 1).trim());
  }
  return out;
}

export interface CookieOptions {
  secure: boolean;
  httpOnly: boolean;
  maxAgeSeconds: number;
}

export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(o.maxAgeSeconds))}`,
    "SameSite=Lax",
    ...(o.httpOnly ? ["HttpOnly"] : []),
    ...(o.secure ? ["Secure"] : []),
  ].join("; ");
}

export const newCsrfToken = (): string => randomBytes(24).toString("base64url");

export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function equalConstantTime(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export type CsrfFailure = "origin_mismatch" | "cross_site" | "token_missing" | "token_mismatch";

/**
 * Null when the request may proceed. `headers` is a case-insensitive getter (a `Headers`), `cookies` the parsed cookie
 * jar. A missing Origin is tolerated only for non-browser clients (no Sec-Fetch-Site) - the token is still required.
 */
export function csrfFailure(input: {
  method: string;
  headers: { get(name: string): string | null };
  cookies: Map<string, string>;
  publicUrl: string;
  names: CookieNames;
  /**
   * Origin the request itself was served from. Accepted in addition to `publicUrl` ONLY when cookies are not Secure (plain-http
   * local development, where `localhost` and `127.0.0.1` are both reachable). Behind https only the configured public URL counts.
   */
  requestOrigin?: string;
}): CsrfFailure | null {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return null;
  const origin = input.headers.get("origin");
  const expected = new URL(input.publicUrl).origin;
  const accepted = new Set([expected]);
  if (!input.names.secure && input.requestOrigin) accepted.add(input.requestOrigin);
  if (origin !== null && !accepted.has(origin)) return "origin_mismatch";
  if (origin === null) {
    const site = input.headers.get("sec-fetch-site");
    if (site !== null && site !== "same-origin" && site !== "none") return "cross_site";
  }
  const header = input.headers.get("x-csrf-token");
  const cookie = input.cookies.get(input.names.csrf);
  if (!header || !cookie) return "token_missing";
  return equalConstantTime(header, cookie) ? null : "token_mismatch";
}

/**
 * Client IP for the audit log and the sign-in throttle. Forwarded headers are only believed when the operator says a
 * trusted proxy sits in front (SH_TRUST_PROXY=1, for example Cloudflare Tunnel); otherwise they are attacker-controlled.
 */
export function clientIp(
  headers: { get(name: string): string | null },
  env: SecurityEnv,
): string | null {
  if (env.SH_TRUST_PROXY !== "1") return null;
  const cf = headers.get("cf-connecting-ip");
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = cf?.trim() || forwarded || null;
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null;
}

/** Headers copied from the API response to the browser: everything except hop-by-hop, cookies and `x-sh-*` secrets. */
export function isForwardedResponseHeader(name: string): boolean {
  const n = name.toLowerCase();
  if (n.startsWith("x-sh-")) return false;
  return !HOP_BY_HOP.has(n) && n !== "set-cookie";
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "content-encoding",
]);
