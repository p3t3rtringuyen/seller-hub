import { describe, expect, it } from "vitest";
import {
  clientIp,
  cookieNames,
  csrfFailure,
  isForwardedResponseHeader,
  parseCookies,
  serializeCookie,
} from "./bff-security";

const headers = (h: Record<string, string>) => ({
  get: (n: string) => h[n.toLowerCase()] ?? null,
});

describe("cookies", () => {
  it("uses __Host- names and Secure only behind https", () => {
    expect(cookieNames("http://127.0.0.1:3100")).toEqual({
      secure: false,
      session: "sh_session",
      csrf: "sh_csrf",
    });
    expect(cookieNames("https://staging.example.test")).toEqual({
      secure: true,
      session: "__Host-sh_session",
      csrf: "__Host-sh_csrf",
    });
  });
  it("serializes an httpOnly, SameSite session cookie; Secure only when asked", () => {
    const c = serializeCookie("__Host-sh_session", "tok", {
      secure: true,
      httpOnly: true,
      maxAgeSeconds: 100,
    });
    expect(c).toBe("__Host-sh_session=tok; Path=/; Max-Age=100; SameSite=Lax; HttpOnly; Secure");
    expect(serializeCookie("a", "b", { secure: false, httpOnly: false, maxAgeSeconds: 0 })).toBe(
      "a=b; Path=/; Max-Age=0; SameSite=Lax",
    );
  });
  it("parses a cookie header and keeps the first of duplicate names", () => {
    const jar = parseCookies("a=1; sh_session=abc; a=2; bad; =x");
    expect(jar.get("sh_session")).toBe("abc");
    expect(jar.get("a")).toBe("1");
  });
});

describe("CSRF (origin + double submit)", () => {
  const names = cookieNames("https://app.example.test");
  const base = {
    method: "POST",
    publicUrl: "https://app.example.test",
    names,
    cookies: new Map([[names.csrf, "tok123"]]),
  };
  it("lets safe methods through", () => {
    expect(
      csrfFailure({ ...base, method: "GET", headers: headers({}), cookies: new Map() }),
    ).toBeNull();
  });
  it("accepts a matching Origin and token", () => {
    expect(
      csrfFailure({
        ...base,
        headers: headers({ origin: "https://app.example.test", "x-csrf-token": "tok123" }),
      }),
    ).toBeNull();
  });
  it("rejects another Origin even with a valid token", () => {
    expect(
      csrfFailure({
        ...base,
        headers: headers({ origin: "https://evil.example", "x-csrf-token": "tok123" }),
      }),
    ).toBe("origin_mismatch");
  });
  it("in plain-http dev the origin the page was served from is accepted too (localhost vs 127.0.0.1); behind https it is not", () => {
    const dev = cookieNames("http://127.0.0.1:3100");
    const args = {
      method: "POST",
      publicUrl: "http://127.0.0.1:3100",
      names: dev,
      cookies: new Map([[dev.csrf, "tok123"]]),
      requestOrigin: "http://localhost:3100",
    };
    const h = headers({ origin: "http://localhost:3100", "x-csrf-token": "tok123" });
    expect(csrfFailure({ ...args, headers: h })).toBeNull();
    expect(
      csrfFailure({
        ...args,
        headers: headers({ origin: "http://evil.example", "x-csrf-token": "tok123" }),
      }),
    ).toBe("origin_mismatch");
    const prod = { ...base, requestOrigin: "https://other.example.test" };
    expect(
      csrfFailure({
        ...prod,
        headers: headers({ origin: "https://other.example.test", "x-csrf-token": "tok123" }),
      }),
    ).toBe("origin_mismatch");
  });
  it("rejects a cross-site browser request that sent no Origin", () => {
    expect(
      csrfFailure({
        ...base,
        headers: headers({ "sec-fetch-site": "cross-site", "x-csrf-token": "tok123" }),
      }),
    ).toBe("cross_site");
  });
  it("rejects a missing or wrong token", () => {
    const o = { origin: "https://app.example.test" };
    expect(csrfFailure({ ...base, headers: headers(o) })).toBe("token_missing");
    expect(csrfFailure({ ...base, headers: headers({ ...o, "x-csrf-token": "nope12" }) })).toBe(
      "token_mismatch",
    );
    expect(
      csrfFailure({
        ...base,
        cookies: new Map(),
        headers: headers({ ...o, "x-csrf-token": "tok123" }),
      }),
    ).toBe("token_missing");
  });
});

describe("client IP and response headers", () => {
  it("ignores forwarded headers unless a trusted proxy is declared", () => {
    const h = headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(clientIp(h, {})).toBeNull();
    expect(clientIp(h, { SH_TRUST_PROXY: "1" })).toBe("203.0.113.9");
    expect(clientIp(headers({ "cf-connecting-ip": "2001:db8::1" }), { SH_TRUST_PROXY: "1" })).toBe(
      "2001:db8::1",
    );
    expect(
      clientIp(headers({ "x-forwarded-for": "not an ip!" }), { SH_TRUST_PROXY: "1" }),
    ).toBeNull();
  });
  it("never forwards x-sh-* (session token), set-cookie or hop-by-hop headers to the browser", () => {
    for (const n of ["x-sh-session", "X-SH-Session-Max-Age", "set-cookie", "connection"])
      expect(isForwardedResponseHeader(n)).toBe(false);
    for (const n of ["content-type", "x-request-id"])
      expect(isForwardedResponseHeader(n)).toBe(true);
  });
});
