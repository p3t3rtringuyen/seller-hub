import { ReplayMissError } from "../errors";
import type { HttpMethod, HttpRequest, HttpResponse, HttpTransport } from "../types";
import { encodeText, textOf } from "../types";

// An in-memory Amazon: tests register routes, the client under test talks to it through the normal
// `HttpTransport` seam. No sockets, no credentials, no live call.

export interface RouteMatcher {
  method?: HttpMethod;
  /** Exact URL (with query) or a RegExp / predicate. */
  url?: string | RegExp;
  /** Match on the path only (no host, no query). */
  path?: string | RegExp;
  /** Extra predicate over the whole request (headers, body). */
  where?: (request: HttpRequest) => boolean;
}

export type MockResponse =
  | HttpResponse
  | ((request: HttpRequest) => HttpResponse | Promise<HttpResponse>)
  | { throw: Error };

export const jsonResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpResponse => ({
  status,
  headers: { "content-type": "application/json", ...lower(headers) },
  body: encodeText(JSON.stringify(body)),
});

export const bytesResponse = (
  status: number,
  body: Uint8Array,
  headers: Record<string, string> = {},
): HttpResponse => ({ status, headers: lower(headers), body });

export const emptyResponse = (
  status: number,
  headers: Record<string, string> = {},
): HttpResponse => ({
  status,
  headers: lower(headers),
  body: new Uint8Array(),
});

function lower(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
}

export function matches(m: RouteMatcher, r: HttpRequest): boolean {
  if (m.method && m.method !== r.method) return false;
  const u = new URL(r.url);
  if (m.url !== undefined) {
    if (typeof m.url === "string" ? m.url !== r.url : !m.url.test(r.url)) return false;
  }
  if (m.path !== undefined) {
    if (typeof m.path === "string" ? m.path !== u.pathname : !m.path.test(u.pathname)) return false;
  }
  return m.where ? m.where(r) : true;
}

interface Route {
  matcher: RouteMatcher;
  responses: MockResponse[];
  used: number;
}

export interface RecordedRequest extends HttpRequest {
  bodyText?: string;
}

export class MockTransport implements HttpTransport {
  private readonly routes: Route[] = [];
  readonly requests: RecordedRequest[] = [];

  /**
   * Registers a route. Several responses are served in order and the last one repeats, which is how a test says
   * "429, 429, then 200". Routes registered later win over earlier ones that match the same request.
   */
  route(matcher: RouteMatcher, ...responses: MockResponse[]): this {
    if (responses.length === 0) throw new Error("route() needs at least one response");
    this.routes.unshift({ matcher, responses, used: 0 });
    return this;
  }

  async send(request: HttpRequest): Promise<HttpResponse> {
    const recorded: RecordedRequest = { ...request };
    if (typeof request.body === "string") recorded.bodyText = request.body;
    else if (request.body) recorded.bodyText = textOf(request.body);
    this.requests.push(recorded);
    const route = this.routes.find((r) => matches(r.matcher, request));
    if (!route) {
      throw new ReplayMissError(`no mock route for ${request.method} ${request.url.split("?")[0]}`);
    }
    const response = route.responses[
      Math.min(route.used, route.responses.length - 1)
    ] as MockResponse;
    route.used++;
    if (typeof response === "function") return response(request);
    if ("throw" in response) throw response.throw;
    return response;
  }

  /** Requests that matched `matcher`, in order. */
  callsTo(matcher: RouteMatcher): RecordedRequest[] {
    return this.requests.filter((r) => matches(matcher, r));
  }

  reset(): void {
    this.requests.length = 0;
    this.routes.length = 0;
  }
}
