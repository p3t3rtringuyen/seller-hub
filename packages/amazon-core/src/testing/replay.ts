import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ReplayMissError } from "../errors";
import type { HttpMethod, HttpRequest, HttpResponse, HttpTransport } from "../types";
import { encodeText } from "../types";
import { jsonResponse } from "./mock-transport";

// Replay transport (SH_AMAZON_MODE=replay, ADR-0006/0012): serves recorded or catalogue-shaped fixtures so CI,
// Storybook data and local development run without credentials and without the network.
//
// Fixture file = one fixture object or an array of them (UTF-8 JSON):
//   {
//     "name": "sellers.getMarketplaceParticipations ok",
//     "match": { "method": "GET", "path": "/sellers/v1/marketplaceParticipations", "query": { "x": "1" } },
//     "responses": [ { "status": 200, "headers": {…}, "json": {…} } ]   // or "response": {…}
//   }
// `path` may contain `*` (one segment). `query` is a subset match. Several responses are served in order and the
// last one repeats. A response body is `json`, `text` or `base64`.

export interface FixtureResponse {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
  base64?: string;
}

export interface Fixture {
  name?: string;
  match: {
    method?: HttpMethod;
    /** Path only, `*` = one path segment. */
    path: string;
    /** Every listed query parameter must be present with this exact value. */
    query?: Record<string, string>;
    /** Case-insensitive substring that must appear in the request body. */
    bodyIncludes?: string;
  };
  response?: FixtureResponse;
  responses?: FixtureResponse[];
}

export function toHttpResponse(r: FixtureResponse): HttpResponse {
  const headers = Object.fromEntries(
    Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  if (r.json !== undefined) return jsonResponse(r.status, r.json, headers);
  if (r.text !== undefined) return { status: r.status, headers, body: encodeText(r.text) };
  if (r.base64 !== undefined)
    return { status: r.status, headers, body: new Uint8Array(Buffer.from(r.base64, "base64")) };
  return { status: r.status, headers, body: new Uint8Array() };
}

const pathToRegExp = (p: string): RegExp =>
  new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+")}$`);

export function loadFixtureDir(dir: string): Fixture[] {
  const out: Fixture[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as Fixture | Fixture[];
    for (const f of Array.isArray(parsed) ? parsed : [parsed]) out.push(f);
  }
  return out;
}

export interface ReplayOptions {
  fixtures: Fixture[];
  /** Answer LWA token requests with a fake token (default true), so credentials are not needed in replay mode. */
  answerLwa?: boolean;
}

export function createReplayTransport(
  options: ReplayOptions,
): HttpTransport & { requests: HttpRequest[] } {
  const compiled = options.fixtures.map((f) => ({
    f,
    path: pathToRegExp(f.match.path),
    responses: (f.responses ?? (f.response ? [f.response] : [])).map(toHttpResponse),
    used: 0,
  }));
  const requests: HttpRequest[] = [];
  let tokens = 0;
  return {
    requests,
    async send(request) {
      requests.push(request);
      const url = new URL(request.url);
      const hit = compiled.find((c) => {
        if (c.f.match.method && c.f.match.method !== request.method) return false;
        if (!c.path.test(url.pathname)) return false;
        for (const [k, v] of Object.entries(c.f.match.query ?? {}))
          if (url.searchParams.get(k) !== v) return false;
        if (c.f.match.bodyIncludes) {
          const text =
            typeof request.body === "string"
              ? request.body
              : request.body
                ? new TextDecoder().decode(request.body)
                : "";
          if (!text.toLowerCase().includes(c.f.match.bodyIncludes.toLowerCase())) return false;
        }
        return c.responses.length > 0;
      });
      if (hit) {
        const r = hit.responses[Math.min(hit.used++, hit.responses.length - 1)] as HttpResponse;
        return r;
      }
      if (
        (options.answerLwa ?? true) &&
        request.method === "POST" &&
        url.pathname === "/auth/o2/token"
      ) {
        return jsonResponse(200, {
          access_token: `Atza|replay-${++tokens}`,
          token_type: "bearer",
          expires_in: 3600,
        });
      }
      throw new ReplayMissError(`replay: no fixture for ${request.method} ${url.pathname}`);
    },
  };
}
