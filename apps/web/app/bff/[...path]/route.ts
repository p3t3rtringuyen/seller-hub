import { randomUUID } from "node:crypto";
import { resolvePorts } from "@seller-hub/config";

// The BFF is the only browser-facing API surface (ADR-0003). This is the placeholder: it forwards SAFE
// methods to apps/api with a correlation id and drops hop-by-hop and Set-Cookie headers. No session, no
// CSRF yet — P3-IDENTITY adds the sh_session cookie -> Authorization: Bearer hop and the double-submit
// CSRF check, and only then are mutating methods enabled. No business logic and no DB access belong here.

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
]);

function apiBase(): string {
  return process.env.SH_API_URL || `http://127.0.0.1:${resolvePorts(process.env).api}`;
}

async function forward(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params;
  const traceId = randomUUID();
  if (!["GET", "HEAD"].includes(request.method)) {
    return Response.json(
      {
        type: "https://seller-hub.dev/problems/not-implemented",
        title: "Not implemented",
        status: 501,
        code: "bff_writes_disabled",
        traceId,
      },
      {
        status: 501,
        headers: { "content-type": "application/problem+json", "x-request-id": traceId },
      },
    );
  }
  const target = new URL(`/${path.join("/")}`, apiBase());
  target.search = new URL(request.url).search;
  const upstream = await fetch(target, {
    method: request.method,
    headers: {
      accept: request.headers.get("accept") ?? "application/json",
      "x-request-id": traceId,
    },
  });
  const headers = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && name.toLowerCase() !== "set-cookie")
      headers.set(name, value);
  });
  return new Response(upstream.body, { status: upstream.status, headers });
}

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
