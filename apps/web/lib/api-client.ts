"use client";
import type { components } from "@seller-hub/contracts";

// Browser-side calls go to the BFF (`/bff/v1/...`), never to apps/api. The session cookie is httpOnly (JavaScript cannot
// read it); writes carry the double-submit csrf token read from the (non-httpOnly) csrf cookie (lib/bff-security.ts).

export type Schemas = components["schemas"];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly traceId?: string,
    readonly errors: { path: string; code: string; message?: string }[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const CSRF_COOKIES = ["__Host-sh_csrf", "sh_csrf"];

export function readCsrfCookie(
  cookie: string = typeof document === "undefined" ? "" : document.cookie,
): string | null {
  for (const part of cookie.split(";")) {
    const i = part.indexOf("=");
    const name = part.slice(0, i).trim();
    if (CSRF_COOKIES.includes(name)) return part.slice(i + 1).trim() || null;
  }
  return null;
}

async function ensureCsrf(): Promise<string> {
  const existing = readCsrfCookie();
  if (existing) return existing;
  await fetch("/bff/csrf", { credentials: "same-origin", cache: "no-store" });
  const token = readCsrfCookie();
  if (!token)
    throw new ApiError(0, "csrf_unavailable", "Cookies are blocked - enable cookies to sign in.");
  return token;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (method !== "GET") {
    headers["x-csrf-token"] = await ensureCsrf();
    if (body !== undefined) headers["content-type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(`/bff${path}`, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(
      0,
      "network_error",
      "The server could not be reached. Check your connection.",
    );
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? safeParse(text) : null;
  if (!res.ok) {
    const p = (json ?? {}) as {
      code?: string;
      detail?: string;
      title?: string;
      traceId?: string;
      errors?: ApiError["errors"];
    };
    throw new ApiError(
      res.status,
      p.code ?? "error",
      p.detail ?? p.title ?? `Request failed (${res.status})`,
      p.traceId,
      p.errors ?? [],
    );
  }
  return json as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const get = <T>(path: string) => api<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => api<T>("POST", path, body);
export const put = <T>(path: string, body?: unknown) => api<T>("PUT", path, body);
export const del = <T = void>(path: string) => api<T>("DELETE", path);
