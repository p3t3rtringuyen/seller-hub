// Builds the upstream URL for the BFF proxy. Defence against SSRF: Next decodes %2F inside a catch-all
// segment, so a raw `new URL("//host/x", base)` would leave the API origin. Every segment is re-encoded,
// the path must be under /v1/, and the result must stay on the API origin.
export function bffTarget(path: readonly string[], apiBase: string, search = ""): URL | null {
  const segments = path.map((s) => encodeURIComponent(s));
  if (segments.some((s) => s === "" || s === "." || s === ".." || s === "%2E" || s === "%2E%2E"))
    return null;
  const base = new URL(apiBase);
  const target = new URL(`${base.origin}/${segments.join("/")}`);
  if (target.origin !== base.origin) return null;
  if (!target.pathname.startsWith("/v1/")) return null;
  target.search = search;
  return target;
}
