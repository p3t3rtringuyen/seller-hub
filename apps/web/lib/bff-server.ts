import { randomUUID } from "node:crypto";
import { resolvePorts } from "@seller-hub/config";
import { bffTarget } from "./bff-target";
import {
  clientIp,
  cookieNames,
  csrfFailure,
  isForwardedResponseHeader,
  newCsrfToken,
  parseCookies,
  SAFE_METHODS,
  serializeCookie,
} from "./bff-security";

// The BFF request pipeline (ADR-0003): cookie -> Authorization hop, CSRF, session cookie issuing. Server-only.

const MAX_BODY_BYTES = 1_000_000;
const CSRF_MAX_AGE = 7 * 24 * 3600;

function publicUrl(): string {
  return process.env.SH_WEB_PUBLIC_URL || `http://127.0.0.1:${resolvePorts(process.env).web}`;
}
function apiBase(): string {
  return process.env.SH_API_URL || `http://127.0.0.1:${resolvePorts(process.env).api}`;
}

function problem(status: number, code: string, title: string, traceId: string): Response {
  return Response.json(
    {
      type: `https://seller-hub.dev/problems/${code.replace(/_/g, "-")}`,
      title,
      status,
      code,
      traceId,
    },
    {
      status,
      headers: {
        "content-type": "application/problem+json",
        "x-request-id": traceId,
        "cache-control": "no-store",
      },
    },
  );
}

/** Adds the csrf cookie when the browser has none (readable by JS: it is not a secret from the page, only from other origins). */
function withCsrfCookie(response: Response, request: Request, force = false): Response {
  const names = cookieNames(publicUrl());
  const jar = parseCookies(request.headers.get("cookie"));
  if (jar.has(names.csrf) && !force) return response;
  response.headers.append(
    "set-cookie",
    serializeCookie(names.csrf, newCsrfToken(), {
      secure: names.secure,
      httpOnly: false,
      maxAgeSeconds: CSRF_MAX_AGE,
    }),
  );
  return response;
}

/** GET /bff/csrf - makes sure the browser has a csrf cookie before its first write (for example the sign-in form). */
export function csrfEndpoint(request: Request): Response {
  const res = Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  return withCsrfCookie(res, request);
}

export async function forward(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params;
  const traceId = randomUUID();
  const names = cookieNames(publicUrl());
  const jar = parseCookies(request.headers.get("cookie"));

  const failure = csrfFailure({
    method: request.method,
    headers: request.headers,
    cookies: jar,
    publicUrl: publicUrl(),
    names,
  });
  if (failure) return problem(403, "csrf_failed", "Request blocked (CSRF check)", traceId);

  const target = bffTarget(path, apiBase(), new URL(request.url).search);
  if (!target) return problem(400, "bff_bad_path", "Bad request", traceId);

  const headers: Record<string, string> = {
    accept: request.headers.get("accept") ?? "application/json",
    "x-request-id": traceId,
  };
  const session = jar.get(names.session);
  if (session) headers.authorization = `Bearer ${session}`;
  const ip = clientIp(request.headers, process.env);
  if (ip) headers["x-sh-client-ip"] = ip;
  const ua = request.headers.get("user-agent");
  if (ua) headers["x-sh-user-agent"] = ua.slice(0, 300);

  let body: ArrayBuffer | undefined;
  if (!SAFE_METHODS.has(request.method.toUpperCase())) {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES)
      return problem(413, "payload_too_large", "Payload too large", traceId);
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES)
      return problem(413, "payload_too_large", "Payload too large", traceId);
    // Only describe a body that exists: Fastify answers 400 to `content-type: application/json` with an empty body.
    if (body.byteLength > 0)
      headers["content-type"] = request.headers.get("content-type") ?? "application/json";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      ...(body && body.byteLength > 0 ? { body } : {}),
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return problem(502, "api_unreachable", "The API is not reachable", traceId);
  }

  const out = new Headers();
  upstream.headers.forEach((value, name) => {
    if (isForwardedResponseHeader(name)) out.set(name, value);
  });
  out.set("cache-control", "no-store");
  const response = new Response(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });

  // Session issuing: the token comes from a response HEADER meant for this server only and is stripped above.
  const token = upstream.headers.get("x-sh-session");
  if (token) {
    const maxAge = Number(upstream.headers.get("x-sh-session-max-age") ?? "0") || 7 * 24 * 3600;
    response.headers.append(
      "set-cookie",
      serializeCookie(names.session, token, {
        secure: names.secure,
        httpOnly: true,
        maxAgeSeconds: maxAge,
      }),
    );
    // A new session gets a new csrf token (login CSRF / fixation).
    withCsrfCookie(response, request, true);
  } else if (upstream.headers.get("x-sh-session-clear") === "1") {
    response.headers.append(
      "set-cookie",
      serializeCookie(names.session, "", {
        secure: names.secure,
        httpOnly: true,
        maxAgeSeconds: 0,
      }),
    );
  }
  return withCsrfCookie(response, request);
}
