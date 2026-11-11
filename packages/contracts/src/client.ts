import createClient from "openapi-fetch";
import type { paths } from "./generated/schema";

export interface ApiClientOptions {
  /** Base URL: the BFF (`/bff`) in the browser, the API URL on the server and in tests. */
  baseUrl: string;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
}

/** Typed fetch client over the bundle (ADR-0010 decision 4). Paths and bodies are checked by tsc. */
export function createApiClient(options: ApiClientOptions) {
  return createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
