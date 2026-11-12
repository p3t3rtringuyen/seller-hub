import type { HttpRequest, HttpResponse, HttpTransport } from "./types";

/** Production transport on the platform `fetch` (undici). Network errors propagate; the client layer classifies them. */
export function createFetchTransport(fetchImpl: typeof fetch = fetch): HttpTransport {
  return {
    async send(request: HttpRequest): Promise<HttpResponse> {
      const controller = new AbortController();
      const timer =
        request.timeoutMs !== undefined
          ? setTimeout(() => controller.abort(), request.timeoutMs)
          : undefined;
      try {
        const init: RequestInit = {
          method: request.method,
          headers: request.headers,
          signal: controller.signal,
          redirect: "manual",
        };
        if (request.body !== undefined) {
          init.body = typeof request.body === "string" ? request.body : Buffer.from(request.body);
        }
        const res = await fetchImpl(request.url, init);
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        return { status: res.status, headers, body: new Uint8Array(await res.arrayBuffer()) };
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
